// Hisob AI — tiny server: static files + /api/chat (OpenRouter, tool loop).
// Run: node server.js  →  http://localhost:5180
// .env: OPENROUTER_API_KEY, OPENROUTER_MODEL (z-ai/glm-5.3-flash), OPENROUTER_PROVIDER (relace/fp4)
//
// Tools come in two kinds:
//   server tools  — run here, result goes back to the model (query_invoices, calculate)
//   client tools  — returned to the browser, which acts on the screen (open, create document, export…)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryInvoices, calculate, socialMonitor, geocode, osmBuilding } from './lib/tools.js';
import { loadMcp, mcpToolDefs, isMcpTool, callMcp, mcpStatus } from './lib/mcp.js';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(DIR, 'public');
for (const line of (existsSync(join(DIR, '.env')) ? readFileSync(join(DIR, '.env'), 'utf8') : '').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'z-ai/glm-5.3-flash';
const PROVIDER = process.env.OPENROUTER_PROVIDER || 'relace/fp4';
if (!KEY) console.warn('OPENROUTER_API_KEY is missing in .env — chat will use local answers only.');
const PORT = Number(process.env.PORT) || 5180;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const SYSTEM = `Ты менеджер AI-команды бухгалтерии для малого бизнеса в Узбекистане (бухгалтер, юрист, аналитик).
Отвечай коротко: 2–4 предложения или до 4 пунктов, без заголовков, на языке пользователя (узбекский или русский).

ТЫ УПРАВЛЯЕШЬ РАБОЧИМ ПРОСТРАНСТВОМ ЧЕРЕЗ ИНСТРУМЕНТЫ:
- Холст в центре, документы слева, сроки, экспорт файлов. Никогда не говори, что не можешь открыть холст, создать документ, PDF или Word — вызови инструмент.
- Любой документ (заявление, приказ, договор, служебная записка, письмо или пояснение в налоговую, акт, доверенность, справка, отчёт) — create_document. Он сразу откроется на холсте.
- «Покажи как PDF», «скачай», «сохрани в Word/Excel» — export_document (если документа ещё нет, сначала create_document в том же ответе).
- Вопросы по продажам, покупкам, контрагентам, датам («кто крупнейший покупатель», «сколько купили у…») — query_invoices. Любые расчёты (налоги, проценты, «а если») — calculate. Не считай в уме.
- Соцсети и сайты (Telegram-канал, Instagram, сайт конкурента или свой) — social_monitor: настоящие публичные данные через браузер. Для сложных сайтов есть инструменты браузера mcp_playwright_*.
- Здание, этаж, помещение: пользователь кликает дом на карте, видит его по этажам; этаж — select_floor, номер и площадь помещения — set_unit (площадь только со слов пользователя или с его плана).
- Геомодель: где находится предприятие, карта, трафик — locate_business (адрес или координаты и тип бизнеса). Если адрес неизвестен, вызови locate_business без адреса: пользователь отметит точку на карте. Карта 2D/3D — show_map. Трафик модель считает сама и только для бизнеса, которому он нужен.
- «Главный экран», «отчёт», «расчёт», «hisobot» = расчёт НДС: open_document vat-10, а если отчёт не собран — build_vat_report. show_home только по явной просьбе «на старт».
- Не задавай много уточнений: если просят документ, сразу сделай черновик, неизвестные поля оставь «________» и предложи дополнить.
- Вызвав инструмент, добавь одну короткую фразу о том, что сделал.
- Черновики можно делать сразу. Отправлять, подписывать и подавать документы нельзя без разрешения пользователя.

ЗАПРЕТ НА ВЫДУМЫВАНИЕ ДАННЫХ (и в ответах, и в документах):
- Любая цифра (сумма, процент, ставка, срок, количество, зарплата, цена, статистика) должна быть в ДАННЫХ, в словах пользователя или в результате инструмента.
- Нельзя писать цифры «из общих знаний», «примерно», «по рынку», вилки и оценки. Нельзя ссылаться на статьи закона и номера форм, которых нет в ДАННЫХ.
- Если цифры нет — «Этих данных у меня нет» и какой документ загрузить, или «________» в документе.`;
const VOICE = '\nПользователь говорит голосом: ответ будет озвучен. Максимум 2 коротких предложения, без списков.';
const EXPLAIN_KEYS = ['sb', 'sv', 'pb', 'pv', 'pay', 'simp', 'save', 'turn', 'annual', 'b2b'];
const SECTIONS = ['sales', 'purchases', 'totals', 'regimes', 'risks'];
const BUSINESS_TYPES = ['bakery', 'retail', 'horeca', 'beauty', 'pharmacy', 'education', 'auto', 'office', 'production', 'online'];
const CLIENT_TOOLS = ['select_floor', 'set_unit', 'show_map', 'build_vat_report', 'open_document', 'show_deadlines', 'explain_number', 'prepare_actions', 'show_home', 'show_section', 'create_document', 'export_document', 'set_reminder', 'request_document'];
const SERVER_TOOLS = ['query_invoices', 'calculate', 'social_monitor', 'locate_business'];

function tools(docs) { return baseTools(docs).concat(mcpToolDefs()); }
function baseTools(docs) {
  const fn = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
  const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
  return [
    // ---- screen ----
    fn('build_vat_report', 'Собрать расчёт НДС за октябрь: агенты заполняют документ на холсте. Если отчёт ещё не собран.'),
    fn('open_document', 'Открыть документ на холсте. ' + docs.map(d => `${d.id} = ${d.nm}`).join('; '), { id: S('id документа', { enum: docs.map(d => d.id) }) }, ['id']),
    fn('show_section', 'Прокрутить расчёт НДС к блоку и подсветить его.', { section: S('sales реестр продаж, purchases реестр покупок, totals итог, regimes сравнение режимов, risks риски', { enum: SECTIONS }) }, ['section']),
    fn('explain_number', 'Объяснение цифры в отчёте: sb продажи, sv НДС начислен, pb покупки, pv к зачёту, pay к уплате, simp упрощённый 6%, save экономия, turn налог с оборота, annual годовой оборот, b2b покупатели-компании.', { key: S('ключ', { enum: EXPLAIN_KEYS }) }, ['key']),
    fn('show_deadlines', 'Показать вкладку «Сроки».'),
    fn('set_reminder', 'Добавить напоминание в «Сроки».', { date: S('дата ДД.ММ или ДД.ММ.ГГГГ'), text: S('о чём напомнить') }, ['date', 'text']),
    fn('request_document', 'Попросить пользователя загрузить документ, которого не хватает: подсветить зону загрузки.', { what: S('что загрузить, например «банковскую выписку за октябрь»') }, ['what']),
    fn('show_home', 'Стартовый экран. Только по явной просьбе «на старт», «начать заново».'),
    fn('prepare_actions', 'Карточка разрешения для пакета по НДС: Excel расчёта, заявление на упрощённый НДС, напоминание.'),
    // ---- documents ----
    fn('create_document', 'Создать или переписать любой документ и открыть его на холсте. Текст в markdown: строки, начинающиеся с ">>", — шапка «кому/от кого» справа; "# " — название документа по центру; "## " — подзаголовок; "- " — пункт списка; таблица — строки "| a | b |"; **жирный**. Реквизиты компании бери из ДАННЫХ, неизвестное — «________». В конце строка подписи.',
      { id: S('id существующего документа, чтобы переписать его; пусто для нового'), title: S('короткое название для панели документов'), kind: S('тип', { enum: ['заявление', 'приказ', 'договор', 'письмо', 'записка', 'акт', 'справка', 'отчёт', 'доверенность', 'другое'] }), body: S('полный текст документа в markdown') }, ['title', 'kind', 'body']),
    fn('export_document', 'Скачать документ файлом. pdf — для любого, docx — Word, xlsx — таблицы и расчёт НДС.', { id: S('id документа (созданного или из списка)'), format: S('формат', { enum: ['pdf', 'docx', 'xlsx'] }) }, ['id', 'format']),
    // ---- data (run on the server) ----
    fn('query_invoices', 'Запрос к электронным счетам-фактурам за октябрь. Возвращает точные суммы. Найденные ЭСФ подсветятся на экране.',
      { type: S('sales — продажи (покупатели), purchases — покупки (поставщики)', { enum: ['sales', 'purchases'] }), counterparty: S('часть названия контрагента'), date_from: S('ДД.ММ.ГГГГ'), date_to: S('ДД.ММ.ГГГГ'), group_by: S('counterparty — по контрагентам, none — список ЭСФ', { enum: ['counterparty', 'none'] }), sort: S('порядок', { enum: ['sum_desc', 'sum_asc', 'date'] }), limit: { type: 'integer', description: 'сколько строк вернуть: «крупнейший/самый» = 1, «топ-5» = 5, по умолчанию 10' } }, ['type']),
    // ---- marketing & geo ----
    fn('social_monitor', 'Открыть публичную страницу в браузере (Playwright) и снять данные: Telegram-канал (подписчики, последние посты, просмотры), Instagram-профиль, любой сайт. Результат покажется на холсте.', { platform: S('площадка', { enum: ['telegram', 'instagram', 'website'] }), handle: S('@канал, ник или адрес сайта') }, ['platform', 'handle']),
    fn('locate_business', 'Геомодель: показать предприятие на карте и оценить пешеходный трафик (если он нужен этому типу бизнеса). Можно передать адрес (найдём координаты), координаты, или ничего — тогда пользователь отметит точку на карте сам.', { address: S('адрес или ориентир в Узбекистане'), lat: { type: 'number' }, lon: { type: 'number' }, business_type: S('bakery пекарня, retail магазин, horeca кафе/ресторан, beauty салон/клиника, pharmacy аптека, education учебный центр, auto автосервис, office офис, production производство/склад, online онлайн', { enum: BUSINESS_TYPES }) }),
    fn('show_map', 'Переключить карту геомодели в 2D или 3D.', { mode: S('режим', { enum: ['2d', '3d'] }) }, ['mode']),
    fn('select_floor', 'Выбрать этаж в выбранном здании на карте (3D-модель по этажам).', { floor: { type: 'integer', description: 'номер этажа, 1 — первый' } }, ['floor']),
    fn('set_unit', 'Записать помещение предприятия на выбранном этаже: номер и площадь со слов пользователя.', { name: S('номер или название помещения'), area_m2: { type: 'number', description: 'площадь, м² — только если пользователь назвал' } }, ['name']),
    fn('calculate', 'Точный калькулятор. Только числа и + - * / ( ) %. Например "445215206*0.06" или "(53425825-12813484)*12".', { expression: S('выражение'), label: S('что считаем') }, ['expression']),
  ];
}
const NO_DATA = 'Этих данных у меня нет, а выдумывать цифры я не буду. Загрузите нужный документ в «Документы» (выписку, ЭСФ, договор), и я посчитаю точно.';

// ---------- anti-hallucination check: every number must come from the data, the user or a tool ----------
const MULT = { 'млн': 1e6, 'mln': 1e6, 'млрд': 1e9, 'mlrd': 1e9, 'тыс': 1e3, 'ming': 1e3 };
const stripDates = t => String(t).replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, ' ').replace(/\b\d{1,2}:\d{2}\b/g, ' ');
function numbers(text) {
  const out = [];
  const re = /(\d[\d   ]*(?:[.,]\d+)*)\s*(млрд|млн|тыс|mlrd|mln|ming)?/gi;
  for (const m of stripDates(text).matchAll(re)) {
    let raw = m[1].replace(/[   ]/g, '');
    if (/^\d{1,3}([.,]\d{3})+$/.test(raw) && !m[2]) raw = raw.replace(/[.,]/g, ''); // 500.000 / 1,200,000 = thousands
    raw = raw.replace(',', '.');
    const v = parseFloat(raw); if (!Number.isFinite(v)) continue;
    out.push({ raw: m[0].trim(), v: v * (MULT[(m[2] || '').toLowerCase()] || 1), plain: !m[2] });
  }
  return out;
}
// 9.92M / 739K / 1.2B (Telegram, Instagram counters) -> full numbers
const expandKMB = t => String(t).replace(/(\d+(?:[.,]\d+)?)\s?([KMB])\b/g, (_, n, u) => String(Math.round(parseFloat(n.replace(',', '.')) * { K: 1e3, M: 1e6, B: 1e9 }[u])));
function unsupported(text, sources) {
  const allowed = numbers(expandKMB(sources)).map(n => n.v);
  return numbers(expandKMB(text)).filter(n => {
    if (n.plain && Number.isInteger(n.v) && n.v <= 31) return false;          // list numbers, days, small counts
    if (n.plain && n.v >= 2024 && n.v <= 2030) return false;                   // years
    return !allowed.some(a => Math.abs(a - n.v) <= Math.max(Math.abs(a) * 0.01, 0.5)); // allow rounding (40,6 млн ≈ 40 612 340)
  }).map(n => n.raw);
}

async function llm(messages, toolDefs) {
  // Model is fixed (no model fallbacks). The provider is preferred; if it is down, OpenRouter serves the same model elsewhere.
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY, 'X-Title': 'Hisob AI' },
    body: JSON.stringify({ model: MODEL, provider: { order: [PROVIDER], allow_fallbacks: true }, messages, temperature: 0, reasoning: { effort: 'low' }, usage: { include: true }, max_tokens: 3000, ...(toolDefs ? { tools: toolDefs, tool_choice: 'auto' } : {}) }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'llm error ' + r.status);
  const m = d.choices?.[0]?.message || {};
  return { text: m.content || '', calls: m.tool_calls || [], provider: d.provider, tokens: d.usage?.total_tokens || 0, cost: d.usage?.cost || 0 };
}
const args = c => { try { return JSON.parse(c.function?.arguments || '{}'); } catch { return {}; } };
function validClient(x, docs) {
  if (!CLIENT_TOOLS.includes(x.name)) return false;
  if (x.name === 'open_document') return docs.some(d => d.id === x.args.id);
  if (x.name === 'explain_number') return EXPLAIN_KEYS.includes(x.args.key);
  if (x.name === 'show_section') return SECTIONS.includes(x.args.section);
  if (x.name === 'create_document') return typeof x.args.body === 'string' && x.args.body.trim().length > 0;
  if (x.name === 'show_map') return ['2d', '3d'].includes(x.args.mode);
  if (x.name === 'select_floor') return Number.isInteger(x.args.floor) && x.args.floor >= 1 && x.args.floor <= 200;
  if (x.name === 'export_document') return ['pdf', 'docx', 'xlsx'].includes(x.args.format);
  return true;
}

// One user turn: up to 4 model rounds. Server tools are executed and fed back; client tools are collected for the browser.
async function runServerTool(name, a) {
  if (name === 'query_invoices') return queryInvoices(a);
  if (name === 'calculate') return calculate(a);
  if (name === 'social_monitor') {
    const r = await socialMonitor(a);
    return { result: r, action: r.error ? null : { name: 'show_social', args: r } };
  }
  if (name === 'locate_business') {
    const type = BUSINESS_TYPES.includes(a.business_type) ? a.business_type : '';
    if (Number.isFinite(a.lat) && Number.isFinite(a.lon)) return { result: { found: true, lat: a.lat, lon: a.lon, note: 'точка показана на карте, трафик считается на экране' }, action: { name: 'show_geo', args: { lat: a.lat, lon: a.lon, address: a.address || '', business_type: type } } };
    if (a.address) {
      const hits = await geocode(a.address).catch(() => []);
      if (!hits.length) return { result: { found: false, note: 'адрес не найден, пользователь отметит точку на карте' }, action: { name: 'show_geo', args: { business_type: type, ask: true, query: a.address } } };
      const h = hits[0];
      return { result: { found: true, address: h.name, lat: h.lat, lon: h.lon, note: 'точка показана на карте, трафик считается на экране' }, action: { name: 'show_geo', args: { lat: h.lat, lon: h.lon, address: h.name, business_type: type } } };
    }
    return { result: { found: false, note: 'пользователь отметит точку на карте' }, action: { name: 'show_geo', args: { business_type: type, ask: true } } };
  }
  return { result: { error: 'unknown tool' } };
}

async function runTurn(messages, docs, stats) {
  const toolDefs = tools(docs), actions = [], toolResults = [];
  let reply = '';
  for (let round = 0; round < 4; round++) {
    const r = await llm(messages, toolDefs); stats.tokens += r.tokens; stats.cost += r.cost; stats.provider = r.provider;
    if (r.text) reply = r.text;
    if (!r.calls.length) break;
    messages.push({ role: 'assistant', content: r.text || '', tool_calls: r.calls });
    let needMore = false;
    for (const c of r.calls) {
      const name = c.function?.name, a = args(c);
      let out;
      if (SERVER_TOOLS.includes(name)) {
        const res = await runServerTool(name, a);
        out = res.result; toolResults.push(JSON.stringify(out)); needMore = true;
        if (res.highlight && res.highlight.nums.length) actions.push({ name: 'highlight_rows', args: res.highlight });
        if (res.action) actions.push(res.action);
        stats.log.push(name + `(${a.counterparty || a.expression || a.handle || a.address || a.type || a.business_type || ''})`);
      } else if (isMcpTool(name)) {
        try { const r2 = await callMcp(name, a); out = { error: r2.isError || undefined, text: r2.text }; toolResults.push(r2.text); }
        catch (e) { out = { error: 'MCP: ' + e.message }; }
        needMore = true; stats.log.push(name);
      } else if (validClient({ name, args: a }, docs)) {
        actions.push({ name, args: a }); out = { ok: true, note: 'выполнено на экране пользователя' };
        stats.log.push(name + (a.id || a.key || a.section || a.format ? `(${[a.id, a.key, a.section, a.format].filter(Boolean).join(',')})` : a.title ? `(${a.title})` : ''));
      } else out = { ok: false, error: 'неизвестный инструмент или неверные параметры' };
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out) });
    }
    if (!needMore) break; // only screen actions: nothing more to ask the model
  }
  // the start screen next to other actions would hide what they show
  const acts = actions.some(x => x.name !== 'show_home') ? actions.filter(x => x.name !== 'show_home') : actions;
  return { reply, actions: acts, toolResults };
}

async function chat(req, res) {
  let body = '';
  for await (const c of req) { body += c; if (body.length > 2e5) return send(res, 413, { error: 'too large' }); }
  if (!KEY) return send(res, 503, { error: 'OPENROUTER_API_KEY not set' });
  let j; try { j = JSON.parse(body); } catch { return send(res, 400, { error: 'bad json' }); }
  const t0 = Date.now();
  const context = String(j.context || '').slice(0, 20000);
  const docs = (Array.isArray(j.docs) ? j.docs : []).filter(d => d && typeof d.id === 'string').slice(0, 80).map(d => ({ id: d.id.slice(0, 80), nm: String(d.nm || '').slice(0, 120) }));
  const history = (Array.isArray(j.messages) ? j.messages.slice(-12) : []).filter(m => m && (m.role === 'user' || m.role === 'assistant')).map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  const question = history.filter(m => m.role === 'user').at(-1)?.content || '';
  const userText = history.filter(m => m.role === 'user').map(m => m.content).join('\n');
  const messages = [{ role: 'system', content: SYSTEM + (j.voice ? VOICE : '') + '\n\nДАННЫЕ:\n' + context }, ...history];
  const stats = { tokens: 0, cost: 0, provider: '', log: [] };
  let retried = false, blocked = false;
  try {
    let { reply, actions, toolResults } = await runTurn(messages, docs, stats);
    const sources = () => context + '\n' + userText + '\n' + toolResults.join('\n');
    const docText = acts => acts.filter(a => a.name === 'create_document').map(a => a.args.body).join('\n');
    let bad = unsupported(reply + '\n' + docText(actions), sources());
    if (bad.length) { // one retry: name the numbers that are not in the data
      retried = true;
      messages.push({ role: 'assistant', content: reply || '(документ создан)' }, { role: 'user', content: `Проверка: в ответе или документе есть цифры, которых нет в ДАННЫХ, словах пользователя или результатах инструментов: ${bad.join(', ')}. Сделай заново без них (в документе вместо них «________»). Если без них нельзя — скажи, каких данных не хватает.` });
      const again = await runTurn(messages, docs, stats);
      toolResults = toolResults.concat(again.toolResults);
      const keep = actions.filter(a => a.name !== 'create_document');
      reply = again.reply; actions = keep.concat(again.actions.filter(a => a.name === 'create_document' || !keep.some(k => k.name === a.name)));
      bad = unsupported(reply + '\n' + docText(actions), sources());
      if (bad.length) {
        blocked = true;
        actions = actions.filter(a => a.name !== 'create_document' || !unsupported(a.args.body, sources()).length);
        reply = unsupported(reply, sources()).length ? NO_DATA : reply + `\n\nНе стал вписывать цифры, которых нет в данных: ${bad.join(', ')}. Уточните их, и я дополню.`;
      }
    }
    // Flash models often do only the first of "open X and save it as Y": add the export ourselves.
    const fmtAsked = /(pdf|пдф)/i.test(question) ? 'pdf' : /(word|ворд|docx)/i.test(question) ? 'docx' : /(excel|эксель|xlsx)/i.test(question) ? 'xlsx' : null;
    if (fmtAsked && /(сохран|скача|экспорт|выгруз|в виде|как |файл|saqla|yukla)/i.test(question) && !actions.some(a => a.name === 'export_document')) {
      const src = [...actions].reverse().find(a => a.name === 'open_document' || a.name === 'create_document');
      actions.push({ name: 'export_document', args: { id: src?.name === 'open_document' ? src.args.id : '', format: fmtAsked } });
      stats.log.push(`export_document(auto,${fmtAsked})`);
    }
    console.log(`chat ${Date.now() - t0}ms ${stats.provider} tok=${stats.tokens} $${stats.cost.toFixed(5)}${j.voice ? ' voice' : ''}${retried ? ' RETRY' : ''}${blocked ? ' BLOCKED' : ''} | ${question.slice(0, 70).replace(/\s+/g, ' ')} -> ${stats.log.join(', ') || 'text'}`);
    send(res, 200, { reply, actions });
  } catch (e) { console.error('openrouter', e.message); send(res, 502, { error: 'llm error' }); }
}
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/chat' && req.method === 'POST') return chat(req, res);
  if (url.pathname === '/api/osm/building') return send(res, 200, { building: await osmBuilding(url.searchParams.get('id')).catch(() => null) });
  if (url.pathname === '/api/geo/search') { const q = url.searchParams.get('q') || ''; return send(res, 200, { results: q.trim() ? await geocode(q).catch(() => []) : [] }); }
  const p = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const file = await readFile(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(file);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, () => console.log('Hisob AI → http://localhost:' + PORT));
loadMcp().then(() => console.log('MCP:', mcpStatus.join('; ') || 'no servers'));
