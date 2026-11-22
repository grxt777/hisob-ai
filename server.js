// Office AI — tiny server: static files + /api/chat (OpenRouter, tool loop).
// Run: node server.js  →  http://localhost:5180
// .env: OPENROUTER_API_KEY, OPENROUTER_MODEL (z-ai/glm-5.3-flash), OPENROUTER_PROVIDER (relace/fp4)
//
// Tools come in two kinds:
//   server tools  — run here, result goes back to the model (query_invoices, calculate)
//   client tools  — returned to the browser, which acts on the screen (open, create document, export…)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryInvoices, calculate, socialMonitor, geocode, osmBuilding } from './lib/tools.js';
import { telegramDeep, instagramDeep, accounts, rememberAccount } from './lib/social.js';
import { listDocs, allDocs, saveDoc, docsVersion } from './lib/store.js';
import { verifyInitData, sendDocument, startBot, botEnabled } from './lib/telegram.js';
import { loadMcp, mcpToolDefs, isMcpTool, callMcp, mcpStatus } from './lib/mcp.js';
import { transcribeOpenRouter, sttModel } from './lib/stt.js';
import * as integrations from './lib/integrations/index.js';
import * as forecast from './lib/forecast/index.js';

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
- ЭСФ могут приходить из Soliq / 1С / Didox (вкладка «Связи»). Если данных нет — попроси подключить источник или загрузить выгрузку.
- Деньги и обязательства: open_document id=cashflow|bank|cash|ar|ap|rent|credit|opps|today|forecast|ecp. «Что делать сегодня» → today; возможности → opps; прогноз продаж/trade → forecast; пакет к ЭЦП (стоп до подписи) → ecp.
- Соцсети — social_monitor: маркетолог разбирает КАЖДЫЙ пост (просмотры, реакции, тип, время) и даёт рекомендации, что публиковать. Если пользователь говорит, что это его/наш аккаунт, передай ours=true — аккаунт запомнится и будет отслеживаться. «Наши соцсети», «проверь наши каналы» — бери их из списка НАШИ СОЦСЕТИ. Instagram: аналитика по постам и охват только через подключённый официальный API владельца; без него — только счётчики профиля, так и скажи. Для любых других сайтов есть браузер mcp_playwright_*.
- Здание, этаж, помещение: пользователь кликает дом на карте, видит его по этажам; этаж — select_floor, номер и площадь помещения — set_unit (площадь только со слов пользователя или с его плана).
- Геомодель: где находится предприятие, карта, трафик — locate_business (адрес или координаты и тип бизнеса). Если адрес неизвестен, вызови locate_business без адреса: пользователь отметит точку на карте. Карта 2D/3D — show_map. Трафик модель считает сама и только для бизнеса, которому он нужен.
- «Главный экран», «отчёт», «расчёт», «hisobot» = расчёт НДС: open_document vat-10, а если отчёт не собран — build_vat_report. show_home только по явной просьбе «на старт».
- Не задавай много уточнений: если просят документ, сразу сделай черновик, неизвестные поля оставь «________» и предложи дополнить.
- Вызвав инструмент, добавь одну короткую фразу о том, что сделал.
- Черновики можно делать сразу. Отправлять, подписывать и подавать документы нельзя без разрешения. Пакет к ЭЦП — open_document ecp.

ЗАПРЕТ НА ВЫДУМЫВАНИЕ ДАННЫХ (и в ответах, и в документах):
- Любая цифра (сумма, процент, ставка, срок, количество, зарплата, цена, статистика) должна быть в ДАННЫХ, в словах пользователя или в результате инструмента.
- Нельзя писать цифры «из общих знаний», «примерно», «по рынку», вилки и оценки. Нельзя ссылаться на статьи закона и номера форм, которых нет в ДАННЫХ.
- Если цифры нет — «Этих данных у меня нет» и какой документ загрузить, или «________» в документе.`;
const TG = '\nПользователь в Telegram Mini App на телефоне. Когда просит документ («сделай», «пришли», «скинь») — если такой документ уже есть, сразу send_to_telegram с его id; если нет — create_document и затем send_to_telegram в том же ответе. Отвечай очень коротко.';
const VOICE = '\nПользователь говорит голосом: ответ будет озвучен. Максимум 2 коротких предложения, без списков.';
const EXPLAIN_KEYS = ['sb', 'sv', 'pb', 'pv', 'pay', 'simp', 'save', 'turn', 'annual', 'b2b'];
const SECTIONS = ['sales', 'purchases', 'totals', 'regimes', 'risks'];
const BUSINESS_TYPES = ['bakery', 'retail', 'horeca', 'beauty', 'pharmacy', 'education', 'auto', 'office', 'production', 'online'];
const CLIENT_TOOLS = ['send_to_telegram', 'select_floor', 'set_unit', 'show_map', 'build_vat_report', 'open_document', 'show_deadlines', 'explain_number', 'prepare_actions', 'show_home', 'show_section', 'create_document', 'export_document', 'set_reminder', 'request_document'];
const SERVER_TOOLS = ['query_invoices', 'calculate', 'social_monitor', 'locate_business', 'remember_social'];

function tools(docs, tg = false) {
  const t = baseTools(docs).concat(mcpToolDefs());
  return tg ? t.concat([{ type: 'function', function: { name: 'send_to_telegram', description: 'Отправить документ пользователю в Telegram-чат файлом. Если документа ещё нет — сначала create_document в этом же ответе, id можно не указывать (возьмётся только что созданный).', parameters: { type: 'object', properties: { id: { type: 'string', description: 'id документа' }, format: { type: 'string', enum: ['pdf', 'docx', 'xlsx'], description: 'pdf по умолчанию; xlsx — для расчёта НДС и таблиц' } }, required: [] } } }]) : t;
}
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
    fn('prepare_actions', 'Карточка разрешения: Excel НДС, заявление на 6%, напоминание, пульс денег. После — пакет к ЭЦП (стоп до подписи).'),
    // ---- documents ----
    fn('create_document', 'Создать или переписать любой документ и открыть его на холсте. Текст в markdown: строки, начинающиеся с ">>", — шапка «кому/от кого» справа; "# " — название документа по центру; "## " — подзаголовок; "- " — пункт списка; таблица — строки "| a | b |"; **жирный**. Реквизиты компании бери из ДАННЫХ, неизвестное — «________». В конце строка подписи.',
      { id: S('id существующего документа, чтобы переписать его; пусто для нового'), title: S('короткое название для панели документов'), kind: S('тип', { enum: ['заявление', 'приказ', 'договор', 'письмо', 'записка', 'акт', 'справка', 'отчёт', 'доверенность', 'другое'] }), body: S('полный текст документа в markdown') }, ['title', 'kind', 'body']),
    fn('export_document', 'Скачать документ файлом. pdf — для любого, docx — Word, xlsx — таблицы и расчёт НДС.', { id: S('id документа (созданного или из списка)'), format: S('формат', { enum: ['pdf', 'docx', 'xlsx'] }) }, ['id', 'format']),
    // ---- data (run on the server) ----
    fn('query_invoices', 'Запрос к электронным счетам-фактурам за октябрь. Возвращает точные суммы. Найденные ЭСФ подсветятся на экране.',
      { type: S('sales — продажи (покупатели), purchases — покупки (поставщики)', { enum: ['sales', 'purchases'] }), counterparty: S('часть названия контрагента'), date_from: S('ДД.ММ.ГГГГ'), date_to: S('ДД.ММ.ГГГГ'), group_by: S('counterparty — по контрагентам, none — список ЭСФ', { enum: ['counterparty', 'none'] }), sort: S('порядок', { enum: ['sum_desc', 'sum_asc', 'date'] }), limit: { type: 'integer', description: 'сколько строк вернуть: «крупнейший/самый» = 1, «топ-5» = 5, по умолчанию 10' } }, ['type']),
    // ---- marketing & geo ----
    fn('social_monitor', 'Глубокая аналитика соцсети: маркетолог заходит в каждый пост (до 60), снимает просмотры, реакции, тип, время, считает статистику и даёт рекомендации, что публиковать. Telegram — публичный канал; Instagram — по постам только через API владельца; website — текст сайта. Результат открывается на холсте.', { platform: S('площадка', { enum: ['telegram', 'instagram', 'website'] }), handle: S('@канал, ник или адрес сайта'), ours: { type: 'boolean', description: 'true, если это аккаунт пользователя (запомнить и отслеживать)' } }, ['platform', 'handle']),
    fn('remember_social', 'Запомнить соцсеть пользователя как «нашу», чтобы отслеживать её посты.', { platform: S('площадка', { enum: ['telegram', 'instagram'] }), handle: S('@канал или ник') }, ['platform', 'handle']),
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
// Sentence-level filter: drop only the sentences/lines with numbers that are not in the sources.
function keepSupported(text, sources) {
  // a new sentence starts with a capital letter, so «232 тыс. просмотров» is not split
  const parts = String(text).split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁЎҚҒҲ«"(\-–•*])|\n+/).map(x => x.trim()).filter(Boolean);
  return parts.filter(x => !unsupported(x, sources).length).join(' ').trim();
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
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY, 'X-Title': 'Office AI' },
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
  if (x.name === 'send_to_telegram') return !x.args.format || ['pdf', 'docx', 'xlsx'].includes(x.args.format);
  if (x.name === 'select_floor') return Number.isInteger(x.args.floor) && x.args.floor >= 1 && x.args.floor <= 200;
  if (x.name === 'export_document') return ['pdf', 'docx', 'xlsx'].includes(x.args.format);
  return true;
}

// One user turn: up to 4 model rounds. Server tools are executed and fed back; client tools are collected for the browser.
async function marketerAdvice(r) {
  const facts = JSON.stringify({ platform: r.platform, channel: r.title, followers: r.followers, stats: r.stats, posts: r.posts.slice(0, 20).map(p => ({ date: p.date, type: p.type, views: p.views, reach: p.reach, reactions: p.reactions ?? p.interactions, text: (p.text || '').slice(0, 140) })) });
  const sys = `Ты маркетолог малого бизнеса в Узбекистане. По ДАННЫМ о постах дай рекомендации, что и когда публиковать.
Ответ — только JSON без пояснений: {"summary":"2 предложения: что работает, что нет","recommendations":[{"title":"коротко","why":"почему, с цифрами из ДАННЫХ","do":"конкретное действие: формат, тема, день/время"}],"post_ideas":["идея поста 1","идея 2","идея 3"]}
4–5 рекомендаций. Цифры — только из ДАННЫХ. Группы из 1–2 постов не считай закономерностью и так и пиши. Пиши по-русски.`;
  const out = await llm([{ role: 'system', content: sys }, { role: 'user', content: 'ДАННЫЕ:\n' + facts }]);
  const m = out.text.match(/\{[\s\S]*\}/); if (!m) return null;
  const j = JSON.parse(m[0]);
  const ok = t => !unsupported(String(t || ''), facts).length;
  return { summary: keepSupported(j.summary || '', facts), recommendations: (j.recommendations || []).filter(x => ok(x.title) && ok(x.why) && ok(x.do)).slice(0, 5), post_ideas: (j.post_ideas || []).filter(ok).slice(0, 5) };
}

async function runServerTool(name, a) {
  if (name === 'query_invoices') return queryInvoices(a);
  if (name === 'calculate') return calculate(a);
  if (name === 'remember_social') return { result: { saved: true, accounts: rememberAccount(a.platform, a.handle) } };
  if (name === 'social_monitor') {
    let r;
    try { r = a.platform === 'telegram' ? await telegramDeep(a.handle) : a.platform === 'instagram' ? await instagramDeep(a.handle) : await socialMonitor(a); }
    catch (e) { r = { platform: a.platform, error: 'Не удалось получить данные: ' + e.message.split('\n')[0] }; }
    if (r.error) return { result: r };
    if (a.ours && r.handle) rememberAccount(r.platform, r.handle, r.title || '');
    r.ours = accounts().some(x => x.ours && x.platform === r.platform && x.handle.toLowerCase() === String(r.handle || '').toLowerCase());
    if (r.stats) r.advice = await marketerAdvice(r).catch(() => null);
    // the model gets the numbers and the advice, not 60 full post texts
    const brief = { platform: r.platform, handle: r.handle, title: r.title, source: r.source, followers: r.followers, needs_connection: r.needs_connection, stats: r.stats, advice: r.advice, latest_posts: (r.posts || []).slice(0, 8).map(p => ({ date: p.date, type: p.type, views: p.views, reach: p.reach, reactions: p.reactions ?? p.interactions, text: (p.text || '').slice(0, 80) })), summary: r.summary, text: r.text?.slice(0, 600) };
    return { result: brief, action: { name: 'show_social', args: r } };
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

async function runTurn(messages, docs, stats, tg = false) {
  const toolDefs = tools(docs, tg), actions = [], toolResults = [];
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

const EXPLAIN_SYS = `Ты — ИИ-курсор в Office AI (бухгалтерия малого бизнеса в Узбекистане). Пользователь кликнул элемент на экране.
Объясни простым языком, 3–6 предложений:
1) что это за показатель / блок и как считается;
2) что значит текущее значение (если видно) — хорошо или плохо и почему;
3) на что обратить внимание.
Цифры бери ТОЛЬКО из данных элемента. Не выдумывай. Формат: первая строка «## короткий заголовок», далее текст. Язык — язык пользователя (русский или узбекский).

Глоссарий:
- DSO = дебиторка ÷ (приход месяца / 30) — сколько дней в среднем ждут оплату от клиентов.
- DPO = кредиторка ÷ (расход месяца / 30) — сколько дней в среднем платите поставщикам.
- Runway = остаток ÷ (расход / 30) — на сколько дней хватит денег без новых приходов.
- Aging — разбивка долгов по возрасту (0 / 1–30 / 31–60 / 60+ дней).
- Дебиторка — кто должен вам; кредиторка — кому должны вы.
- НДС общий: начислено − зачёт; упрощённый 6% — с оборота без зачёта входного НДС.
- Пульс денег / cashflow — банк + касса: приход, расход, остаток.
- Прогноз trade: XGBoost (дневной recursive) по 3 месяцам истории (авг–окт), горизонт — следующий месяц (ноябрь). Категории: эквайринг, розница, B2B, сырьё, коммунальные, аренда, зарплата, налог, кредит и др. WAPE — на holdout.`;

async function explainApi(req, res) {
  let body = '';
  for await (const c of req) { body += c; if (body.length > 8e4) return send(res, 413, { error: 'too large' }); }
  if (!KEY) return send(res, 503, { error: 'OPENROUTER_API_KEY not set' });
  let j; try { j = JSON.parse(body); } catch { return send(res, 400, { error: 'bad json' }); }
  const el = j.element && typeof j.element === 'object' ? j.element : {};
  const keep = {};
  for (const k of ['kind', 'key', 'label', 'value', 'hint', 'text', 'section', 'doc', 'chart']) {
    if (el[k] != null && el[k] !== '') keep[k] = el[k];
  }
  const lang = j.lang === 'uz' ? 'uz' : 'ru';
  try {
    const r = await llm([
      { role: 'system', content: EXPLAIN_SYS + (lang === 'uz' ? '\nJavobni o\'zbekcha yoz.' : '') },
      { role: 'user', content: 'Объясни этот элемент:\n' + JSON.stringify(keep).slice(0, 6000) },
    ]);
    console.log(`explain ${r.provider || ''} tok=${r.tokens} $${(r.cost || 0).toFixed(5)} | ${(keep.label || keep.key || '').toString().slice(0, 60)}`);
    send(res, 200, { reply: r.text || '—', model: MODEL });
  } catch (e) {
    console.error('explain', e.message);
    send(res, 502, { error: 'llm error' });
  }
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
  const ours = accounts().filter(x => x.ours).map(x => `${x.platform} @${x.handle}${x.title ? ' (' + x.title + ')' : ''}${x.lastCheck ? ', последняя проверка ' + x.lastCheck.slice(0, 16).replace('T', ' ') : ''}`);
  const messages = [{ role: 'system', content: SYSTEM + (j.voice ? VOICE : '') + (j.tg ? TG : '') + '\n\nНАШИ СОЦСЕТИ: ' + (ours.join('; ') || 'не указаны') + '\n\nДАННЫЕ:\n' + context }, ...history];
  const stats = { tokens: 0, cost: 0, provider: '', log: [] };
  let retried = false, blocked = false;
  try {
    let { reply, actions, toolResults } = await runTurn(messages, docs, stats, !!j.tg);
    const sources = () => context + '\n' + userText + '\n' + toolResults.join('\n');
    const docText = acts => acts.filter(a => a.name === 'create_document').map(a => a.args.body).join('\n');
    let bad = unsupported(reply + '\n' + docText(actions), sources());
    if (bad.length) { // one retry: name the numbers that are not in the data
      retried = true;
      messages.push({ role: 'assistant', content: reply || '(документ создан)' }, { role: 'user', content: `Проверка: в ответе или документе есть цифры, которых нет в ДАННЫХ, словах пользователя или результатах инструментов: ${bad.join(', ')}. Сделай заново без них (в документе вместо них «________»). Если без них нельзя — скажи, каких данных не хватает.` });
      const again = await runTurn(messages, docs, stats, !!j.tg);
      toolResults = toolResults.concat(again.toolResults);
      const keep = actions.filter(a => a.name !== 'create_document');
      reply = again.reply; actions = keep.concat(again.actions.filter(a => a.name === 'create_document' || !keep.some(k => k.name === a.name)));
      bad = unsupported(reply + '\n' + docText(actions), sources());
      if (bad.length) {
        blocked = true;
        actions = actions.filter(a => a.name !== 'create_document' || !unsupported(a.args.body, sources()).length);
        console.warn('blocked numbers:', bad.join(' | '));
        // keep every sentence whose numbers are backed by the data; drop only the rest
        const kept = keepSupported(reply, sources());
        reply = kept ? kept + (kept.length < reply.length ? '\n\n_(убрал фразы с цифрами, которых нет в данных)_' : '') : NO_DATA;
      }
    }
    // Flash models often do only the first of "open X and save it as Y": add the export ourselves.
    const fmtAsked = /(pdf|пдф)/i.test(question) ? 'pdf' : /(word|ворд|docx)/i.test(question) ? 'docx' : /(excel|эксель|xlsx)/i.test(question) ? 'xlsx' : null;
    if (fmtAsked && /(сохран|скача|экспорт|выгруз|в виде|как |файл|saqla|yukla)/i.test(question) && !actions.some(a => a.name === 'export_document')) {
      const src = [...actions].reverse().find(a => a.name === 'open_document' || a.name === 'create_document');
      // empty id → browser uses lastCreated after create_document
      actions.push({ name: 'export_document', args: { id: src?.name === 'open_document' ? src.args.id : '', format: fmtAsked } });
      stats.log.push(`export_document(auto,${fmtAsked})`);
    }
    // Prefer create before export so lastCreated is set when id is empty
    const ci = actions.findIndex(a => a.name === 'create_document');
    const ei = actions.findIndex(a => a.name === 'export_document');
    if (ci >= 0 && ei >= 0 && ei < ci) {
      const [ex] = actions.splice(ei, 1);
      actions.push(ex);
    }
    // Mini App: a document the user asked for always ends up in their Telegram chat.
    if (j.tg && !actions.some(a => a.name === 'send_to_telegram')) {
      const src = [...actions].reverse().find(a => a.name === 'create_document' || a.name === 'open_document');
      const wantsSend = /(пришли|скинь|отправ|скача|дай файл|yubor|tashla|jo.?nat)/i.test(question);
      if (src && (src.name === 'create_document' || wantsSend)) {
        const id = src.name === 'open_document' ? src.args.id : '';
        const fmt = /(excel|эксель|xlsx)/i.test(question) ? 'xlsx' : /(word|ворд|docx)/i.test(question) ? 'docx' : id === 'vat-10' ? 'xlsx' : 'pdf';
        actions.push({ name: 'send_to_telegram', args: { id, format: fmt } }); stats.log.push(`send_to_telegram(auto,${fmt})`);
      }
    }
    console.log(`chat ${Date.now() - t0}ms ${stats.provider} tok=${stats.tokens} $${stats.cost.toFixed(5)}${j.voice ? ' voice' : ''}${retried ? ' RETRY' : ''}${blocked ? ' BLOCKED' : ''} | ${question.slice(0, 70).replace(/\s+/g, ' ')} -> ${stats.log.join(', ') || 'text'}`);
    send(res, 200, { reply, actions });
  } catch (e) { console.error('openrouter', e.message); send(res, 502, { error: 'llm error' }); }
}
async function readJsonOrNull(req, limit) {
  let body = '';
  for await (const c of req) { body += c; if (body.length > limit) return null; }
  try { return JSON.parse(body); } catch { return null; }
}
// Mini App → user's Telegram chat. The user id comes only from initData signed by Telegram, never from the client.
async function tgSend(req, res) {
  if (!botEnabled()) return send(res, 503, { error: 'бот не настроен (TELEGRAM_BOT_TOKEN)' });
  const b = await readJsonOrNull(req, 15e6); if (!b) return send(res, 413, { error: 'файл слишком большой' });
  const user = verifyInitData(b.initData);
  if (!user?.id) return send(res, 401, { error: 'откройте приложение из Telegram' });
  const buf = Buffer.from(String(b.data || ''), 'base64');
  if (!buf.length || buf.length > 10e6) return send(res, 400, { error: 'пустой или слишком большой файл' });
  const name = String(b.filename || 'document.pdf').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  try { await sendDocument(user.id, buf, name, b.caption || ''); console.log(`tg send ${name} ${Math.round(buf.length / 1024)}KB -> ${user.id}`); send(res, 200, { ok: true }); }
  catch (e) { console.error('tg send failed', e.message); send(res, 502, { error: e.message }); }
}
// Speech-to-text for the Mini App (Telegram's WebView has no SpeechRecognition).
// ELEVENLABS_API_KEY → Scribe (understands Uzbek and Russian), else OPENAI_API_KEY → Whisper.
async function stt(req, res, lang) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 10e6) return send(res, 413, { error: 'запись слишком длинная' }); chunks.push(c); }
  const audio = new Blob([Buffer.concat(chunks)], { type: req.headers['content-type'] || 'audio/webm' });
  const ext = /mp4|m4a|aac/.test(audio.type) ? 'm4a' : /ogg/.test(audio.type) ? 'ogg' : 'webm';
  try {
    if (process.env.ELEVENLABS_API_KEY) {
      const fd = new FormData(); fd.append('file', audio, 'voice.' + ext); fd.append('model_id', 'scribe_v1');
      if (lang === 'uz' || lang === 'ru') fd.append('language_code', lang === 'uz' ? 'uzb' : 'rus');
      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, body: fd });
      const d = await r.json(); if (!r.ok) throw new Error(d.detail?.message || 'ElevenLabs ' + r.status);
      return send(res, 200, { text: d.text || '' });
    }
    if (process.env.OPENAI_API_KEY) {
      const fd = new FormData(); fd.append('file', audio, 'voice.' + ext); fd.append('model', 'whisper-1');
      if (lang === 'uz' || lang === 'ru') fd.append('language', lang);
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY }, body: fd });
      const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || 'OpenAI ' + r.status);
      return send(res, 200, { text: d.text || '' });
    }
    if (KEY) {
      const t0 = Date.now(), r = await transcribeOpenRouter(Buffer.from(await audio.arrayBuffer()), ext, lang);
      console.log(`stt ${Date.now() - t0}ms ${r.model || sttModel()} ${r.seconds}s audio ${Math.round(size / 1024)}KB ${audio.type} $${(r.cost || 0).toFixed(5)} -> "${r.text.slice(0, 60)}"`);
      return send(res, 200, { text: r.text });
    }
    return send(res, 503, { error: 'Голос не настроен: на сервере нет ключа OpenRouter. Пока напишите текстом.' });
  } catch (e) { console.error('stt', e.message); return send(res, 502, { error: 'Не удалось распознать: ' + e.message }); }
}
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

async function readJson(req, limit = 2e6) {
  let body = '';
  for await (const c of req) { body += c; if (body.length > limit) throw Object.assign(new Error('too large'), { status: 413 }); }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
}

async function integrationsApi(req, res, url) {
  const path = url.pathname;
  try {
    if (path === '/api/integrations' && req.method === 'GET') return send(res, 200, integrations.status());
    if (path === '/api/integrations/data' && req.method === 'GET') return send(res, 200, { books: integrations.getInvoiceData() });
    if (path === '/api/integrations/demo' && req.method === 'POST') return send(res, 200, integrations.useDemo());
    if (path === '/api/integrations/import' && req.method === 'POST') {
      const body = await readJson(req);
      return send(res, 200, await integrations.importUpload(body));
    }
    const m = path.match(/^\/api\/integrations\/(soliq|didox|onedc)\/(connect|test|sync|disconnect)$/);
    if (m) {
      const [, id, action] = m;
      if (action === 'disconnect' && req.method === 'POST') return send(res, 200, integrations.disconnect(id));
      if (action === 'test' && req.method === 'POST') return send(res, 200, await integrations.testConnection(id));
      if (action === 'connect' && req.method === 'POST') return send(res, 200, await integrations.connect(id, await readJson(req)));
      if (action === 'sync' && req.method === 'POST') {
        const body = await readJson(req);
        return send(res, 200, await integrations.sync(id, { upload: body.upload, period: body.period }));
      }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message || 'integrations error' });
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') return send(res, 200, { ok: true });
  if (url.pathname === '/api/chat' && req.method === 'POST') return chat(req, res);
  if (url.pathname === '/api/explain' && req.method === 'POST') return explainApi(req, res);
  if (url.pathname === '/api/finance/bundle' && req.method === 'GET') {
    try { return send(res, 200, await forecast.buildBundle()); }
    catch (e) { console.error('forecast', e.message); return send(res, 500, { error: e.message }); }
  }
  if (url.pathname === '/api/forecast' && req.method === 'GET') {
    try {
      const b = await forecast.buildBundle();
      return send(res, 200, b.forecast);
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (url.pathname.startsWith('/api/integrations')) return integrationsApi(req, res, url);
  if (url.pathname === '/api/docs' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since'));
    return send(res, 200, since === docsVersion() ? { version: docsVersion(), unchanged: true } : { version: docsVersion(), docs: allDocs() });
  }
  if (url.pathname === '/api/docs' && req.method === 'POST') { const b = await readJsonOrNull(req, 2e5); if (!b) return send(res, 400, { error: 'bad json' }); return send(res, 200, { doc: saveDoc(b), version: docsVersion() }); }
  if (url.pathname === '/api/tg/send' && req.method === 'POST') return tgSend(req, res);
  if (url.pathname === '/api/stt' && req.method === 'POST') return stt(req, res, url.searchParams.get('lang'));
  if (url.pathname === '/tg' || url.pathname === '/tg/') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(await readFile(join(ROOT, 'index.html'))); }
  if (url.pathname === '/api/social/accounts') return send(res, 200, { accounts: accounts() });
  if (url.pathname === '/api/osm/building') return send(res, 200, { building: await osmBuilding(url.searchParams.get('id')).catch(() => null) });
  if (url.pathname === '/api/geo/search') { const q = url.searchParams.get('q') || ''; return send(res, 200, { results: q.trim() ? await geocode(q).catch(() => []) : [] }); }
  // Static files: never escape ROOT (block .. and absolute join quirks)
  const raw = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  const rel = raw.replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const filePath = resolve(ROOT, rel);
  if (!(filePath === ROOT || filePath.startsWith(ROOT + sep))) {
    res.writeHead(403); return res.end('forbidden');
  }
  try {
    const file = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream' }); res.end(file);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, process.env.HOST || '0.0.0.0', () => { console.log('Office AI → http://localhost:' + PORT); startBot().catch(e => console.log('bot:', e.message)); });
loadMcp().then(() => console.log('MCP:', mcpStatus.join('; ') || 'no servers'));
forecast.warm().catch(e => console.error('forecast warm failed:', e.message));
// Track our own accounts: every 6 hours re-read every post, so each post gets a history of views.
const REFRESH_H = Number(process.env.SOCIAL_REFRESH_HOURS) || 6;
setInterval(async () => {
  for (const a of accounts().filter(x => x.ours)) {
    try { a.platform === 'telegram' ? await telegramDeep(a.handle) : await instagramDeep(a.handle); console.log('social refresh', a.platform, a.handle); }
    catch (e) { console.log('social refresh failed', a.handle, e.message.split('\n')[0]); }
  }
}, REFRESH_H * 36e5).unref();
