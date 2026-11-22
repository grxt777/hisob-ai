// Hisob AI — workspace prototype.
// The manager plans, the bookkeeper / lawyer / analyst do the work on the canvas with their cursors.
// All numbers are computed from window.DEMO / synced Soliq·1C·Didox books — nothing is invented.
const $ = s => document.querySelector(s);
// Telegram Mini App: same page, only the chat + mic; documents slide up as a sheet and go to the user's chat.
const TG_MODE = location.pathname.startsWith('/tg') || new URLSearchParams(location.search).has('tg');
const TGW = window.Telegram?.WebApp;
let D = window.DEMO;

// ---------- company & assumptions ----------
const CO = { name: '«BARAKA NON» MCHJ', inn: '300 000 001', period: 'октябрь 2026', regime: 'Общий режим', regimeSub: 'НДС 12% + налог на прибыль 15%', source: 'demo' };
const BRV = 440000;            // базовая расчётная величина, сум. TODO: сверить актуальное значение
const TURNOVER_LIMIT = 12000;  // порог в БРВ для налога с оборота. TODO: сверить по lex.uz
const SIMPLIFIED_RATE = 0.06;  // упрощённый НДС по УП-100, со всего оборота

const AGENTS = [
  { id: 'm', name: 'Менеджер', color: '#0a0a0b', role: 'ведёт задачу' },
  { id: 'b', name: 'Бухгалтер', color: '#ff2e88', role: 'ЭСФ и расчёты' },
  { id: 'y', name: 'Юрист', color: '#71717a', role: 'нормы и риски' },
  { id: 'a', name: 'Аналитик', color: '#2563eb', role: 'режимы, прогноз, геомодель' },
  { id: 'k', name: 'Маркетолог', color: '#f59e0b', role: 'соцсети и конкуренты' },
];
const A = Object.fromEntries(AGENTS.map(a => [a.id, a]));

// ---------- numbers ----------
const sum = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0);
const C = { sb: 0, sv: 0, pb: 0, pv: 0, pay: 0, gross: 0, simp: 0, save: 0, annual: 0, limit: 0, nonded: [], b2b: 0 };
function recompute() {
  const sb = sum(D.sales, 'base'), sv = sum(D.sales, 'vat');
  const ded = D.purchases.filter(p => !p.note), nonded = D.purchases.filter(p => p.note);
  const pb = sum(D.purchases, 'base'), pv = sum(ded, 'vat');
  const pay = sv - pv, gross = sb + sv, simp = gross * SIMPLIFIED_RATE;
  Object.assign(C, { sb, sv, pb, pv, pay, gross, simp, save: pay - simp, annual: sb * 12, limit: TURNOVER_LIMIT * BRV, nonded, b2b: D.sales.filter(s => s.inn).length });
}
recompute();
function applyBooks(books) {
  if (!books) return;
  D = { sales: books.sales || [], purchases: books.purchases || [] };
  window.DEMO = D;
  if (books.company?.name) CO.name = books.company.name;
  if (books.company?.inn) CO.inn = String(books.company.inn).replace(/(\d{3})(?=\d)/g, '$1 ').trim();
  if (books.period) CO.period = books.period;
  CO.source = books.source || 'demo';
  recompute();
  reportDone = false; approved = false;
  $('#coName').textContent = CO.name;
  $('#coInn').textContent = 'ИНН ' + CO.inn;
  const tag = { demo: 'демо', soliq: 'Soliq', didox: 'Didox', onedc: '1С' }[CO.source] || CO.source;
  $('#regimeBox').innerHTML = `<div class="lbl">Режим налогообложения</div><b>${CO.regime}</b><span>${CO.regimeSub}</span><span style="display:block;margin-top:6px;color:var(--muted)">Источник ЭСФ: ${tag}${books.syncedAt ? ' · ' + new Date(books.syncedAt).toLocaleString('ru-RU') : ''}</span>`;
  // refresh open invoice docs if visible
  if (currentDoc === 'esf-s' || currentDoc === 'esf-p') openDoc(currentDoc);
  renderTree();
}
const fmt = n => Math.round(n).toLocaleString('ru-RU');
const mln = n => (n / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн';
const mlrd = n => (n / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' млрд';

// ---------- state ----------
let tool = 'select', busy = false, reportDone = false, approved = false, currentDoc = null, ttsOn = false;
const openTabs = []; // document ids currently open as browser tabs (home is always present)
const CREATED = {}; let docSeq = 0, lastCreated = null;
const SOCIAL = {};
const DOCS = [
  { g: 'Данные', items: [
    { id: 'esf-s', nm: 'ЭСФ · продажи', tag: String(D.sales.length), ic: 'file' },
    { id: 'esf-p', nm: 'ЭСФ · покупки', tag: String(D.purchases.length), ic: 'file' },
    { id: 'cashflow', nm: 'Пульс денег · октябрь', tag: 'банк+касса', ic: 'coins' },
    { id: 'bank', nm: 'Банк · движения', tag: '14', ic: 'card' },
    { id: 'cash', nm: 'Касса / наличные', tag: '6', ic: 'coins' },
  ] },
  { g: 'Обязательства', items: [
    { id: 'ar', nm: 'Дебиторка · нам должны', tag: 'Q/Z', ic: 'inbox' },
    { id: 'ap', nm: 'Кредиторка · мы должны', tag: 'Q/Z', ic: 'send' },
    { id: 'rent', nm: 'Аренда · график', tag: '18 млн', ic: 'calendar' },
    { id: 'credit', nm: 'Кредит · Uzmilliybank', tag: '24%', ic: 'card' },
  ] },
  { g: 'Отчёты', items: [
    { id: 'today', nm: 'Сегодня · 3 действия', tag: 'план', cls: 'new', ic: 'bolt' },
    { id: 'forecast', nm: 'Прогноз trade · XGBoost', tag: 'ноя', cls: 'new', ic: 'sparkle' },
    { id: 'opps', nm: 'Возможности · экономия', tag: 'AI', cls: 'new', ic: 'sparkle' },
    { id: 'vat-09', nm: 'Расчёт НДС · сентябрь', tag: 'сдан', cls: 'ok', ic: 'sheet' },
    { id: 'profit-q3', nm: 'Налог на прибыль · III кв', tag: 'сдан', cls: 'ok', ic: 'sheet' },
  ] },
  { g: 'Геомодель', items: [
    { id: 'geo', nm: 'Карта предприятия', tag: '2D/3D', ic: 'globe' },
  ] },
  { g: 'Прочее', items: [
    { id: 'memo', nm: 'Докладная · инвентаризация', tag: 'DOCX', ic: 'file' },
  ] },
];
const FIN = () => window.FINANCE.snapshot({ pay: C.pay, simp: C.simp, save: C.save });
const DATES = [ // TODO: сроки сверить с Налоговым кодексом перед питчем
  { d: '15', m: 'дек', t: 'НДФЛ и соцналог за ноябрь', s: 'ежемесячно', soon: true },
  { d: '20', m: 'дек', t: 'Расчёт НДС за ноябрь', s: 'ежемесячно', soon: true },
  { d: '20', m: 'янв', t: 'Налог на прибыль · IV квартал', s: 'ежеквартально' },
];

const page = $('#page'), inner = $('#inner'), canvas = $('#canvas'), overlay = $('#overlay');
const cursors = Object.fromEntries(AGENTS.map(a => [a.id, new AICursor(overlay, { name: a.name, color: a.color })]));

// ---------- shell ----------
$('#coName').textContent = CO.name;
$('#coInn').textContent = 'ИНН ' + CO.inn;
$('#agentsBar').innerHTML = AGENTS.map(a => `<span class="agent-av" id="av-${a.id}" style="background:${a.color}" title="${a.name} · ${a.role}">${a.name[0]}</span>`).join('');
$('#regimeBox').innerHTML = `<div class="lbl">Режим налогообложения</div><b>${CO.regime}</b><span>${CO.regimeSub}</span>`;

function renderTree() {
  $('#tree').innerHTML = DOCS.map(g => `<div class="grp"><div class="gh">${g.g}</div>${g.items.map(it =>
    `<div class="node ${currentDoc === it.id ? 'sel' : ''} ${it.fresh ? 'fresh' : ''}" data-doc="${it.id}">${icon(it.ic || 'file', 'sm')}<span class="nm">${esc(it.nm)}</span>${it.tag ? `<span class="tag ${it.cls || ''}">${esc(it.tag)}</span>` : ''}</div>`).join('')}</div>`).join('');
  DOCS.forEach(g => g.items.forEach(it => (it.fresh = false)));
}

// ---------- browser tabs (open docs like Chrome / Cursor) ----------
function tabMeta(id) {
  if (id == null) return { id: null, nm: 'Hisob AI — рабочее пространство', ic: 'globe' };
  const item = DOCS.flatMap(g => g.items).find(x => x.id === id);
  if (item) return { id, nm: item.nm, ic: item.ic || 'file' };
  if (CREATED[id]) return { id, nm: CREATED[id].title, ic: 'file' };
  if (SOCIAL[id]) return { id, nm: SOCIAL[id].title || SOCIAL[id].handle || id, ic: 'globe' };
  return { id, nm: String(id), ic: 'file' };
}
function ensureTab(id) {
  if (id != null && !openTabs.includes(id)) openTabs.push(id);
  renderTabs();
}
function renderTabs() {
  const el = $('#btabs'); if (!el) return;
  const ids = [null, ...openTabs];
  el.innerHTML = ids.map(id => {
    const m = tabMeta(id);
    const on = currentDoc === id || (id == null && currentDoc == null);
    const close = id != null
      ? `<span class="btab-x" data-close="${esc(id)}" title="Закрыть" role="button">${icon('x', 'sm')}</span>`
      : '';
    return `<button type="button" class="btab ${on ? 'on' : ''} ${id == null ? 'home' : ''}" role="tab" aria-selected="${on}" data-tab="${id == null ? '' : esc(id)}">${icon(m.ic, 'sm')}<span class="btab-nm">${esc(m.nm)}</span>${close}</button>`;
  }).join('');
}
function activateHome() {
  closePop(); if (targets.length) clearTargets();
  if (geoMap) { geoMap.remove(); geoMap = null; }
  currentDoc = null; renderTree(); renderTabs();
  page.innerHTML = ''; showStart(true); canvas.scrollTop = 0;
}
function closeTab(id) {
  if (busy || id == null) return;
  const i = openTabs.indexOf(id); if (i < 0) return;
  openTabs.splice(i, 1);
  if (currentDoc === id) {
    const next = openTabs[i] || openTabs[i - 1] || null;
    if (next) openDoc(next); else activateHome();
  } else renderTabs();
}
$('#btabs')?.addEventListener('click', e => {
  const x = e.target.closest('[data-close]');
  if (x) { e.preventDefault(); e.stopPropagation(); closeTab(x.dataset.close); return; }
  const t = e.target.closest('[data-tab]');
  if (!t || busy) return;
  const id = t.dataset.tab;
  if (!id) activateHome();
  else if (id !== currentDoc) openDoc(id);
});
function addDoc(group, item) {
  let g = DOCS.find(x => x.g === group);
  if (!g) { g = { g: group, items: [] }; DOCS.splice(1, 0, g); }
  const old = g.items.find(x => x.id === item.id);
  old ? Object.assign(old, item, { fresh: true }) : g.items.unshift({ ...item, fresh: true });
  renderTree();
  if (openTabs.includes(item.id)) renderTabs();
}
function renderDates() {
  $('#dates').innerHTML = DATES.map(x => `<div class="date ${x.soon ? 'soon' : ''} ${x.fresh ? 'fresh' : ''}"><div class="d"><b>${x.d}</b><small>${x.m}</small></div><div class="t">${esc(x.t)}<span>${esc(x.s)}</span></div></div>`).join('');
  $('#dateCount').textContent = DATES.length;
  DATES.forEach(x => (x.fresh = false));
}
renderTree(); renderDates(); renderTabs();

function setStatus(t, isBusy = false) { $('#statusTxt').textContent = t; $('#status').classList.toggle('busy', isBusy); }
function agentBusy(id, on) { $('#av-' + id)?.classList.toggle('busy', on); }

// ---------- chat ----------
const msgs = $('#msgs');
function scrollChat() { msgs.scrollTop = msgs.scrollHeight; }
function userMsg(t, voice, marks = []) {
  const m = document.createElement('div'); m.className = 'msg user' + (voice ? ' voice' : ''); m.textContent = t;
  if (marks.length) { const r = document.createElement('div'); r.className = 'marks-r'; r.innerHTML = marks.map((x, i) => `<span><b>${i + 1}</b>${esc(x)}</span>`).join(''); m.append(r); }
  msgs.append(m); scrollChat();
}
function aiMsg(html, who = 'm') {
  const m = document.createElement('div'); m.className = 'msg ai';
  m.innerHTML = `<span class="av" style="${who !== 'm' ? `background:${A[who].color};color:#fff` : ''}">${who === 'm' ? icon('sparkle', 'sm') : A[who].name[0]}</span><div class="body">${html}</div>`;
  msgs.append(m); scrollChat(); return m;
}
function logMsg(who, t) {
  const m = document.createElement('div'); m.className = 'msg log';
  m.innerHTML = `<span class="who" style="background:${A[who].color}">${A[who].name[0]}</span><span><b>${A[who].name}</b> · ${esc(t)}</span>`;
  msgs.append(m); scrollChat();
}
async function typing(ms = 700) {
  const m = document.createElement('div'); m.className = 'msg ai';
  m.innerHTML = `<span class="av">${icon('sparkle', 'sm')}</span><div class="body"><div class="typing"><i></i><i></i><i></i></div></div>`;
  msgs.append(m); scrollChat(); await sleep(ms); m.remove();
}
function speak(text) {
  if (!ttsOn || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, ''));
  u.lang = 'ru-RU'; u.rate = 1.05; speechSynthesis.speak(u);
}

function welcome() {
  if (TG_MODE) return aiMsg(`<div class="welcome"><h3>Ассалому алейкум${TGW?.initDataUnsafe?.user?.first_name ? ', ' + esc(TGW.initDataUnsafe.user.first_name) : ''}!</h3><p>Скажите голосом или напишите, какой документ нужен: «приказ о приёме», «расчёт НДС в Excel». Сделаю и пришлю в этот чат.</p></div>`);
  aiMsg(`<div class="welcome"><h3>Ассалому алейкум!</h3><p>Я менеджер вашей AI-команды. Скажите задачу голосом или текстом, остальное сделают агенты.</p>
    <div class="tip">${icon('mic', 'sm')}<span><b>Голос</b>: говорите по-узбекски или по-русски.</span></div>
    <div class="tip">${icon('ai-cursor', 'sm')}<span><b>ИИ-курсор</b> (клавиша A): клик по цифре, KPI или графику — сразу объясню. Shift+клик — несколько мест в чат.</span></div>
    <div class="tip">${icon('shield', 'sm')}<span>Ничего не отправляю и не подписываю <b>без вашего разрешения</b>.</span></div></div>`);
}

// ---------- canvas helpers ----------
function posOf(el, dx = 0.5, dy = 0.5) {
  const r = el.getBoundingClientRect(), b = inner.getBoundingClientRect();
  return [r.left - b.left + r.width * dx, r.top - b.top + r.height * dy];
}
async function cursorTo(id, el, say, ms = 700, dx = 0.3, dy = 0.5) {
  const c = cursors[id]; c.el.classList.remove('idle'); if (say !== undefined) c.say(say);
  const [x, y] = posOf(el, dx, dy); await c.moveTo(x, y, ms);
}
function parkCursors() {
  const w = inner.clientWidth;
  Object.values(cursors).forEach((c, i) => { c.say(''); c.el.classList.add('idle'); c.moveTo(w - 140 - i * 18, 70 + i * 34, 800); });
}
async function reveal(sec) {
  sec.hidden = false; sec.classList.add('live');
  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await sleep(450);
}
function countTo(el, to, ms = 900, f = fmt) {
  // timer-driven, not requestAnimationFrame: rAF stops in hidden/background tabs and would freeze the scenario
  const t0 = Date.now();
  return new Promise(res => {
    const step = () => { const k = Math.min(1, (Date.now() - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = f(to * e); k < 1 ? setTimeout(step, 16) : res(); };
    step();
  });
}
function showStart(on) { $('#start').hidden = !on; }

// ---------- documents ----------
const rowS = (s, i) => `<tr class="in" data-num="${s.num}"><td>${i + 1}</td><td class="nm">${esc(s.name)}</td><td class="inn">${s.inn || '—'}</td><td>${s.num}</td><td>${s.date}</td><td class="n">${fmt(s.base)}</td><td class="n">${fmt(s.vat)}</td></tr>`;
const rowP = (p, i) => `<tr class="in ${p.note ? 'flag' : ''}" data-num="${p.num}"><td>${i + 1}</td><td class="nm">${esc(p.name)}</td><td class="inn">${p.inn || '—'}</td><td>${p.num}</td><td>${p.date}</td><td class="n">${fmt(p.base)}</td><td class="n">${fmt(p.vat)}</td><td>${p.note ? `<span class="flag-note">${icon('alert')}не в зачёт</span>` : 'в зачёт'}</td></tr>`;
const headS = `<tr><th>№</th><th>Покупатель</th><th>ИНН</th><th>№ ЭСФ</th><th>Дата</th><th class="n">Без НДС</th><th class="n">НДС</th></tr>`;
const headP = `<tr><th>№</th><th>Поставщик</th><th>ИНН</th><th>№ ЭСФ</th><th>Дата</th><th class="n">Без НДС</th><th class="n">НДС</th><th>Зачёт</th></tr>`;

function reportShell() {
  return `<div class="doc">
    <div class="doc-h"><div><h1>Расчёт НДС · ${CO.period}</h1><p>${CO.name} · ИНН ${CO.inn} · данные из электронных счетов-фактур</p></div><span class="chip ${approved ? 'dark' : ''}" id="docState">${approved ? 'Готов к подписи' : 'Черновик'}</span></div>
    <section class="sec" id="secS" hidden><div class="sec-h"><span class="who" style="background:${A.b.color}">Б</span><h3>Реестр ЭСФ по реализации</h3><span class="meta" id="metaS"></span></div>
      <div class="tbl-wrap"><table class="rg"><thead>${headS}</thead><tbody id="bodyS"></tbody><tfoot><tr><td colspan="5">Итого</td><td class="n" data-x="sb" id="totSB">0</td><td class="n" data-x="sv" id="totSV">0</td></tr></tfoot></table></div></section>
    <section class="sec" id="secP" hidden><div class="sec-h"><span class="who" style="background:${A.b.color}">Б</span><h3>Реестр ЭСФ по приобретению</h3><span class="meta" id="metaP"></span></div>
      <div class="tbl-wrap"><table class="rg"><thead>${headP}</thead><tbody id="bodyP"></tbody><tfoot><tr><td colspan="5">Итого</td><td class="n" data-x="pb" id="totPB">0</td><td class="n" data-x="pv" id="totPV">0</td><td></td></tr></tfoot></table></div></section>
    <section class="sec" id="secT" hidden><div class="sec-h"><span class="who" style="background:${A.b.color}">Б</span><h3>Итог расчёта</h3></div>
      <div class="cards">
        <div class="card-n"><span>НДС начислен</span><b data-x="sv" id="cSV">0</b><small>12% с продаж</small></div>
        <div class="card-n"><span>НДС к зачёту</span><b data-x="pv" id="cPV">0</b><small>по ${D.purchases.length - C.nonded.length} из ${D.purchases.length} ЭСФ покупок</small></div>
        <div class="card-n main"><span>НДС к уплате</span><b data-x="pay" id="cPay">0</b><small>сум за ${CO.period}</small></div>
      </div></section>
    <section class="sec" id="secR" hidden><div class="sec-h"><span class="who" style="background:${A.a.color}">А</span><h3>Сравнение режимов налогообложения</h3><span class="meta">на ваших данных за месяц</span></div>
      <div class="regimes">
        <div class="rgm" id="rgGen"><div class="nm"><b>Общий (сейчас)</b><span>НДС 12% с зачётом + прибыль 15%</span></div><div class="bar"><i></i></div><div class="v" data-x="pay">${mln(C.pay)}<small>+ налог на прибыль</small></div></div>
        <div class="rgm best" id="rgSimp"><div class="nm"><b>Упрощённый НДС 6%</b><span>УП-100 · прибыль 0% · без зачёта</span></div><div class="bar"><i></i></div><div class="v" data-x="simp">${mln(C.simp)}<small>прибыль 0%</small></div></div>
        <div class="rgm off" id="rgTurn"><div class="nm"><b>Налог с оборота</b><span>для оборота до ${mlrd(C.limit)} в год</span></div><div class="bar"><i></i></div><div class="v" data-x="turn">недоступен<small>оборот выше порога</small></div></div>
        <div class="save" id="saveBox" hidden>${icon('coins', 'lg')}<div><b data-x="save">−${mln(C.save)} сум в месяц</b><span>≈ ${mln(C.save * 12)} в год только на НДС, плюс налог на прибыль 0% вместо 15%</span></div></div>
      </div></section>
    <section class="sec" id="secK" hidden><div class="sec-h"><span class="who" style="background:${A.y.color}">Ю</span><h3>Риски перехода</h3><span class="meta">проверьте до решения</span></div>
      <div class="risks">
        <div class="risk">${icon('alert', 'sm')}<span><b data-x="b2b">${C.b2b} из ${D.sales.length}</b> покупателей — компании. Если они плательщики НДС, при упрощённом режиме они могут потерять зачёт и уйти к другому поставщику.</span></div>
        <div class="risk">${icon('alert', 'sm')}<span>Годовой оборот <b data-x="annual">≈ ${mlrd(C.annual)}</b> — рядом с порогом ${mlrd(C.limit)} (12 000 БРВ). Небольшой рост или спад меняет доступные режимы.</span></div>
        <div class="risk">${icon('alert', 'sm')}<span>Входной НДС ${mln(C.pv)} в месяц больше не будет зачитываться. Режим по УП-100 действует до 01.01.2030.</span></div>
      </div></section>
  </div>`;
}
function fillReportInstant() {
  page.innerHTML = reportShell();
  ['secS', 'secP', 'secT', 'secR', 'secK'].forEach(id => ($('#' + id).hidden = false));
  $('#bodyS').innerHTML = D.sales.map(rowS).join(''); $('#bodyP').innerHTML = D.purchases.map(rowP).join('');
  setTotals(); bars(true); $('#saveBox').hidden = false;
}
function setTotals() {
  $('#totSB').textContent = fmt(C.sb); $('#totSV').textContent = fmt(C.sv); $('#totPB').textContent = fmt(C.pb); $('#totPV').textContent = fmt(C.pv);
  $('#cSV').textContent = fmt(C.sv); $('#cPV').textContent = fmt(C.pv); $('#cPay').textContent = fmt(C.pay);
  $('#metaS').textContent = D.sales.length + ' ЭСФ'; $('#metaP').textContent = D.purchases.length + ' ЭСФ';
}
function bars() {
  const max = Math.max(C.pay, C.simp);
  $('#rgGen .bar i').style.width = (C.pay / max * 100) + '%';
  $('#rgSimp .bar i').style.width = (C.simp / max * 100) + '%';
  $('#rgTurn .bar i').style.width = '0%';
}

function letterDoc({ title, chip, to, body, sign = true }) {
  return `<div class="doc"><div class="letter">${chip ? `<span class="chip draft">${chip}</span>` : ''}${to ? `<div class="to">${to}</div>` : ''}<h2>${title}</h2>${body}${sign ? `<div class="sign"><span>Руководитель ____________</span><span>«___» __________ 20__</span></div>` : ''}</div></div>`;
}
const applicationDoc = () => letterDoc({
  title: 'ЗАЯВЛЕНИЕ<br>о переходе на упрощённый порядок исчисления НДС',
  chip: 'Проект · форму сверить с официальной',
  to: `В государственную налоговую инспекцию<br>от ${CO.name}<br>ИНН ${CO.inn}`,
  body: `<p>Прошу применять упрощённый порядок исчисления налога на добавленную стоимость по ставке 6% в соответствии с Указом Президента Республики Узбекистан УП-100, начиная с первого числа месяца, следующего за месяцем подачи заявления.</p>
    <p>Вид деятельности: производство и торговля хлебобулочными изделиями. Оборот за ${CO.period}: ${fmt(C.sb)} сум без НДС.</p>
    <p>Подготовлено Hisob AI на основании ${D.sales.length + D.purchases.length} электронных счетов-фактур. Перед подачей требуется проверка и подпись ЭЦП руководителя.</p>`,
});

async function openDoc(id) {
  closePop(); if (targets.length) clearTargets();
  if (geoMap && id !== 'geo') { geoMap.remove(); geoMap = null; }
  const isAx = id === 'forecast';
  const isFin = /^(cashflow|bank|cash|ar|ap|rent|credit|opps|today)$/.test(id);
  $('#frame')?.classList.toggle('ax-wide', isAx);
  if (!isAx) HisobAnalytics?.killCharts?.();
  currentDoc = id; ensureTab(id); renderTree(); showStart(false);
  const item = DOCS.flatMap(g => g.items).find(x => x.id === id);
  if (id === 'vat-10') { if (reportDone) fillReportInstant(); return; }
  if (id === 'esf-s') page.innerHTML = `<div class="doc"><div class="doc-h"><div><h1>ЭСФ · продажи</h1><p>${D.sales.length} счетов-фактур за ${CO.period}</p></div></div><div class="tbl-wrap" style="max-height:none"><table class="rg"><thead>${headS}</thead><tbody>${D.sales.map(rowS).join('')}</tbody><tfoot><tr><td colspan="5">Итого</td><td class="n" data-x="sb">${fmt(C.sb)}</td><td class="n" data-x="sv">${fmt(C.sv)}</td></tr></tfoot></table></div></div>`;
  else if (id === 'esf-p') page.innerHTML = `<div class="doc"><div class="doc-h"><div><h1>ЭСФ · покупки</h1><p>${D.purchases.length} счетов-фактур за ${CO.period}</p></div></div><div class="tbl-wrap" style="max-height:none"><table class="rg"><thead>${headP}</thead><tbody>${D.purchases.map(rowP).join('')}</tbody><tfoot><tr><td colspan="5">Итого</td><td class="n" data-x="pb">${fmt(C.pb)}</td><td class="n" data-x="pv">${fmt(C.pv)}</td><td></td></tr></tfoot></table></div></div>`;
  else if (id === 'app-6') page.innerHTML = applicationDoc();
  else if (id === 'ecp') page.innerHTML = ecpPackHtml();
  else if (id === 'forecast') {
    await showAnalytics('forecast', false);
    return;
  }
  else if (isFin) {
    page.innerHTML = `<div class="doc fin"><p class="muted" style="padding:24px">Загрузка книг…</p></div>`;
    try { await window.FINANCE.ensure?.(); } catch (e) { console.warn(e); }
    // refresh tree tags with live op counts
    const S0 = FIN();
    const bankItem = DOCS.flatMap(g => g.items).find(x => x.id === 'bank');
    const cashItem = DOCS.flatMap(g => g.items).find(x => x.id === 'cash');
    if (bankItem) bankItem.tag = String((S0.bank || []).length);
    if (cashItem) cashItem.tag = String((S0.cash || []).length);
    renderTree();
    page.innerHTML = financeDocHtml(id);
    canvas.scrollTop = 0;
    bindFinanceActions();
    return;
  }
  else if (id === 'vat-09' || id === 'profit-q3') page.innerHTML = letterDoc({ title: item.nm, chip: 'Сдан · демо-данные', sign: false, body: `<p>Отчёт за прошлый период хранится здесь, чтобы агенты сравнивали динамику: рост продаж, изменение НДС к уплате, сезонность.</p><p class="muted">В рабочей версии сюда подгружается документ из кабинета налоговой или загруженный вами файл.</p>` });
  else if (id === 'geo') { renderGeo(); return; }
  else if (SOCIAL[id]) page.innerHTML = socialHtml(id);
  else if (CREATED[id]) page.innerHTML = createdDocHtml(id);
  else page.innerHTML = letterDoc({ title: item ? item.nm : 'Документ', chip: 'Файл не загружен в демо', sign: false, body: `<p>Здесь будет содержимое загруженного файла. В демо это заглушка без данных.</p><p>Загрузите настоящий документ через «Загрузить» слева, и агенты используют его: юрист — договоры, бухгалтер — выписки и докладные.</p>` });
  canvas.scrollTop = 0;
  bindFinanceActions();
}

function moneyRow(r, i) {
  const sign = r.type === 'in' ? '+' : '−';
  const cls = r.type === 'in' ? 'ok' : '';
  const note = [r.cat, r.note].filter(Boolean).join(' · ') || '—';
  return `<tr><td>${i + 1}</td><td>${r.date}</td><td class="nm">${esc(r.name)}</td><td>${esc(note)}</td><td class="n ${cls}">${sign}${fmt(r.amount)}</td></tr>`;
}
function financeDocHtml(id) {
  const S = FIN();
  const axBtn = (view) => `<button type="button" class="btn btn-outline btn-sm" data-ax-open="${view}">${icon('sparkle', 'sm')}Аналитика</button>`;
  if (id === 'cashflow') {
    return `<div class="doc fin"><div class="doc-h"><div><h1>Пульс денег · ${esc(S.period)}</h1><p>Банк + касса · остаток и ближайшие платежи</p></div><div class="fin-actions">${axBtn('cashflow')}<span class="chip dark">книги</span></div></div>
      <div class="kpis">
        <div class="kpi" data-ask="in_total"><span>Приход</span><b data-x="fin-in">${fmt(S.inTotal)}</b><small>банк ${fmt(S.bankIn)} · касса ${fmt(S.cashIn)}</small></div>
        <div class="kpi" data-ask="out_total"><span>Расход</span><b data-x="fin-out">${fmt(S.outTotal)}</b><small>банк ${fmt(S.bankOut)} · касса ${fmt(S.cashOut)}</small></div>
        <div class="kpi ${S.net >= 0 ? 'ok' : 'warn'}" data-ask="closing"><span>Чистый поток</span><b data-x="fin-net">${fmt(S.net)}</b><small>остаток ${fmt(S.closing)}</small></div>
      </div>
      <div class="sec-h"><h3>Ближайшие обязательства</h3></div>
      <div class="due-list">${(S.dueSoon || []).map(d => `<div class="due"><span class="when">${esc(d.date)}</span><div class="nm">${esc(d.title)}<span class="tag">${esc(d.kind)}</span></div><span class="amt">${fmt(d.amount)}</span></div>`).join('')}</div>
      <p class="hint-s">Свободно сейчас ≈ ${fmt(S.closing)}. Дебиторка ${fmt(S.arTotal)} · кредиторка ${fmt(S.apTotal)}.</p></div>`;
  }
  if (id === 'bank' || id === 'cash') {
    const rows = id === 'bank' ? (S.bank || []) : (S.cash || []);
    const title = id === 'bank' ? 'Банк · движения' : 'Касса / наличные';
    const inn = id === 'bank' ? S.bankIn : S.cashIn;
    const out = id === 'bank' ? S.bankOut : S.cashOut;
    return `<div class="doc fin"><div class="doc-h"><div><h1>${title}</h1><p>${rows.length} операций · ${esc(S.period)} · приход ${fmt(inn)} · расход ${fmt(out)}</p></div><div class="fin-actions">${axBtn(id)}</div></div>
      <div class="tbl-wrap" style="max-height:none"><table class="rg"><thead><tr><th>№</th><th>Дата</th><th>Операция</th><th>Категория / примечание</th><th class="n">Сумма</th></tr></thead><tbody>${rows.map(moneyRow).join('')}</tbody></table></div></div>`;
  }
  if (id === 'ar' || id === 'ap') {
    const rows = id === 'ar' ? (S.ar || []) : (S.ap || []);
    const title = id === 'ar' ? 'Дебиторка · нам должны' : 'Кредиторка · мы должны';
    const total = id === 'ar' ? S.arTotal : S.apTotal;
    return `<div class="doc fin"><div class="doc-h"><div><h1>${title}</h1><p>${rows.length} контрагентов · итого ${fmt(total)}</p></div><div class="fin-actions">${axBtn(id)}</div></div>
      <div class="tbl-wrap" style="max-height:none"><table class="rg"><thead><tr><th>Контрагент</th><th>ИНН</th><th>Срок</th><th>Дней</th><th class="n">Сумма</th><th>Примечание</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="nm">${esc(r.name)}</td><td class="inn">${r.inn || '—'}</td><td>${esc(r.due)}</td><td>${r.age}</td><td class="n">${fmt(r.amount)}</td><td>${esc(r.note)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  if (id === 'rent') {
    return `<div class="doc fin"><div class="doc-h"><div><h1>Аренда цеха · график</h1><p>18 000 000 сум / месяц</p></div><div class="fin-actions">${axBtn('rent')}</div></div>
      <div class="tbl-wrap" style="max-height:none"><table class="rg"><thead><tr><th>Месяц</th><th>Срок</th><th>Статус</th><th class="n">Сумма</th></tr></thead><tbody>
      ${(S.rent || []).map(r => `<tr><td>${esc(r.month)}</td><td>${r.date}</td><td>${esc(r.status)}</td><td class="n">${fmt(r.amount)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  if (id === 'credit') {
    const cr = S.credit || {};
    return `<div class="doc fin"><div class="doc-h"><div><h1>Кредит · ${esc(cr.bank || 'Uzmilliybank')}</h1><p>${esc(cr.product || '')} · ставка ${((cr.rate || 0) * 100).toFixed(0)}% · остаток ${fmt(cr.left || 0)}</p></div><div class="fin-actions">${axBtn('credit')}</div></div>
      <div class="kpis"><div class="kpi"><span>Ежемесячный платёж</span><b>${fmt(cr.monthly || 0)}</b></div><div class="kpi"><span>Следующий</span><b>${esc(cr.nextDue || '—')}</b></div><div class="kpi"><span>Тело кредита</span><b>${fmt(cr.principal || 0)}</b><small>было</small></div></div>
      <div class="tbl-wrap" style="max-height:none"><table class="rg"><thead><tr><th>Дата</th><th>Статус</th><th class="n">Платёж</th></tr></thead><tbody>
      ${(cr.schedule || []).map(r => `<tr><td>${r.date}</td><td>${esc(r.status)}</td><td class="n">${fmt(r.amount)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  if (id === 'opps') {
    return `<div class="doc fin"><div class="doc-h"><div><h1>Возможности · что сделать</h1><p>Анализ → оптимальное решение → действие с вашего разрешения</p></div><div class="fin-actions">${axBtn('opps')}</div></div>
      <div class="opp">${(S.opportunities || []).map((o, i) => `<div class="card-o ${i === 0 ? 'best' : ''}" data-opp="${o.id}">
        <div><b>${i + 1}. ${esc(o.title)}</b></div>
        <div class="save">${fmt(o.save)}<small>${o.saveYear !== o.save ? '≈ ' + fmt(o.saveYear) + ' / год' : 'эффект'}</small></div>
        <p>${esc(o.why)}</p>
        <button class="btn btn-primary btn-sm" data-opp-act="${o.action}">${esc(o.cta)}</button>
      </div>`).join('')}</div></div>`;
  }
  return `<div class="doc fin"><div class="doc-h"><div><h1>Сегодня · 3 действия</h1><p>${esc(CO.name)} · ${new Date().toLocaleDateString('ru-RU')}</p></div><span class="chip dark">план дня</span></div>
    <div class="opp">
      <div class="card-o best"><div><b>1. Собрать НДС и увидеть экономию</b></div><div class="save">${fmt(C.save)}<small>/ мес на 6%</small></div><p>ЭСФ уже в системе. Расчёт на холсте, сравнение режимов.</p><button class="btn btn-primary btn-sm" data-opp-act="build_vat">Собрать НДС</button></div>
      <div class="card-o"><div><b>2. Взыскать просроченную дебиторку</b></div><div class="save">${fmt(S.arOverdue)}<small>просрочено</small></div><p>Напомнить должникам — это сразу закрывает кассовый разрыв.</p><button class="btn btn-outline btn-sm" data-opp-act="open_ar">Открыть дебиторку</button></div>
      <div class="card-o"><div><b>3. Подготовить пакет к ЭЦП</b></div><div class="save">0 риск AI</div><p>Excel + заявление + чеклист. Отправка останавливается до вашей подписи.</p><button class="btn btn-outline btn-sm" data-opp-act="ecp_pack">Пакет к ЭЦП</button></div>
    </div>
    <div class="sec-h"><h3>Ближайшие платежи</h3></div>
    <div class="due-list">${(S.dueSoon || []).slice(0, 4).map(d => `<div class="due"><span class="when">${esc(d.date)}</span><div class="nm">${esc(d.title)}</div><span class="amt">${fmt(d.amount)}</span></div>`).join('')}</div></div>`;
}

function analyticsPayload() {
  // Only meta — books always rebuilt in analytics.html from finance.js
  return { co: { name: CO.name, inn: CO.inn, period: CO.period }, vat: { pay: C.pay, simp: C.simp, save: C.save, sb: C.sb, sv: C.sv } };
}
function openAnalyticsWindow(view = 'overview') {
  sessionStorage.setItem('hisob-analytics', JSON.stringify(analyticsPayload()));
  const w = window.open('/analytics.html?view=' + encodeURIComponent(view) + '&t=' + Date.now(), 'hisob-analytics', 'popup=yes,width=1280,height=860,left=80,top=40');
  if (!w) toast('Разрешите всплывающие окна для аналитики', 'alert');
  return w;
}
async function showAnalytics(view, pop = false) {
  const vat = { pay: C.pay, simp: C.simp, save: C.save };
  const v = view === 'overview' ? 'cashflow' : view;
  $('#frame')?.classList.add('ax-wide');
  page.innerHTML = `<div class="doc ax-wrap"><p class="muted" style="padding:24px">Загрузка XGBoost / книг…</p></div>`;
  try { await window.FINANCE.ensure?.(); } catch (e) { console.warn(e); }
  const S = FIN();
  page.innerHTML = `<div class="doc ax-wrap">${HisobAnalytics.dashHtml(v, S, vat, CO, { popout: true, icon: icon('arrow-up-right', 'sm') })}</div>`;
  canvas.scrollTop = 0;
  bindFinanceActions();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { HisobAnalytics.paint(v, S, vat); } catch (e) { console.error(e); }
  }));
  page.querySelectorAll('[data-ax-view]').forEach(b => b.onclick = () => {
    const id = b.dataset.axView === 'overview' ? 'cashflow' : b.dataset.axView;
    // chart tabs stay in analytics; data docs stay as tables
    if (/^(bank|cash|ar|ap|rent|credit|cashflow|opps|today)$/.test(id) && id !== 'forecast') {
      openDoc(id);
      return;
    }
    currentDoc = id;
    ensureTab(currentDoc); renderTree(); renderTabs();
    showAnalytics(currentDoc, false);
  });
  page.querySelectorAll('[data-ax-pop]').forEach(b => b.onclick = () => openAnalyticsWindow(b.dataset.axPop || v));
  if (pop) openAnalyticsWindow(v === 'today' ? 'opps' : v);
}
addEventListener('message', e => {
  if (e.origin !== location.origin || e.data?.type !== 'hisob-opp') return;
  runOppAction(e.data.action);
});

function ecpPackHtml() {
  const steps = [
    { t: 'Расчёт НДС в Excel', ok: approved || !!window._wb },
    { t: 'Заявление на упрощённый НДС 6%', ok: DOCS.some(g => g.items.some(i => i.id === 'app-6')) },
    { t: 'Сверка ЭСФ и банка (пульс денег)', ok: true },
    { t: 'Чеклист перед ЭЦП', ok: true },
    { t: 'Подпись руководителя ЭЦП', ok: false },
    { t: 'Отправка в my.soliq.uz', ok: false },
  ];
  return `<div class="doc"><div class="doc-h"><div><h1>Пакет к отправке · ЭЦП</h1><p>${CO.name} · ИНН ${CO.inn} · AI готовит, человек подписывает</p></div><span class="chip">стоп перед подписью</span></div>
    <div class="ecp">
      <h2>Готово к вашей ЭЦП</h2>
      <p class="muted">Агент заполнил формы. Дальше только вы: подпись и отправка. Без вашего разрешения ничего не уходит в налоговую.</p>
      <div class="steps">${steps.map((s, i) => `<div class="step ${s.ok ? 'on' : ''}"><span class="n">${i + 1}</span><div><b>${esc(s.t)}</b><div class="muted">${s.ok ? 'готово' : 'ждёт вас'}</div></div></div>`).join('')}</div>
      <div class="stop">${icon('shield', 'sm')} <b>Стоп-линия:</b> Hisob AI не подписывает и не отправляет. Кнопка «Отправить» в my.soliq.uz — только после вашей ЭЦП.</div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" data-ecp="prepare">${icon('send', 'sm')}Подготовить кабинет</button>
        <button class="btn btn-outline btn-sm" data-ecp="xlsx">Скачать Excel</button>
        <button class="btn btn-outline btn-sm" data-ecp="app">Открыть заявление</button>
      </div>
    </div></div>`;
}

function bindFinanceActions() {
  page.querySelectorAll('[data-opp-act]').forEach(b => b.onclick = () => runOppAction(b.dataset.oppAct));
  page.querySelectorAll('[data-ecp]').forEach(b => b.onclick = () => runEcpAction(b.dataset.ecp));
  page.querySelectorAll('[data-ax-open]').forEach(b => b.onclick = () => openAnalyticsWindow(b.dataset.axOpen));
}
async function runOppAction(act) {
  if (act === 'build_vat' || act === 'prepare_vat_switch') return reportDone ? (openDoc('opps'), prepareActionsCard()) : runReport();
  if (act === 'open_ar') return openDoc('ar');
  if (act === 'open_cashflow') return openDoc('cashflow');
  if (act === 'open_forecast') return openDoc('forecast');
  if (act === 'today_plan') return openDoc('today');
  // openDoc already launches analytics UI + pop-out window
  if (act === 'ecp_pack') return openEcpPack();
}
async function prepareActionsCard() {
  const m = aiMsg('<p>Пакет готов к вашему разрешению.</p>');
  permissionCard(m.querySelector('.body'));
}
async function openEcpPack() {
  if (!reportDone) {
    aiMsg('<p>Сначала соберу НДС — потом открою пакет к ЭЦП.</p>');
    return runReport();
  }
  if (!window._wb) { makeXlsx(); $('#export').disabled = false; }
  if (!DOCS.some(g => g.items.some(i => i.id === 'app-6'))) {
    addDoc('Заявления', { id: 'app-6', nm: 'Заявление · упрощённый НДС', tag: 'проект', cls: 'new', ic: 'file' });
  }
  approved = true;
  addDoc('Заявления', { id: 'ecp', nm: 'Пакет к ЭЦП · my.soliq', tag: 'стоп', cls: 'new', ic: 'shield' });
  openDoc('ecp');
  setStatus('Ждёт подписи ЭЦП');
  aiMsg('<p>Пакет к ЭЦП на холсте. Подпись и отправка — только ваши. AI на стоп-линии.</p>');
}
async function runEcpAction(act) {
  if (act === 'xlsx') {
    if (!window._wb) makeXlsx();
    $('#export').disabled = false;
    if (window._wb) XLSX.writeFile(window._wb, 'Raschet_NDS_oktyabr_2026.xlsx');
    toast('Excel скачан', 'download'); return;
  }
  if (act === 'app') { openDoc('app-6'); return; }
  if (act === 'prepare') {
    setStatus('Готовлю кабинет my.soliq.uz…', true);
    await typing(700);
    await confirmDialog({
      title: 'Стоп перед ЭЦП',
      icon: 'shield',
      ok: 'Оставить на подпись',
      cancel: 'Закрыть',
      html: `<p>Форма расчёта НДС и заявление заполнены в черновике кабинета.</p>
        <ul><li>НДС к уплате: <b>${fmt(C.pay)}</b> сум</li><li>Альтернатива 6%: <b>${fmt(C.simp)}</b> сум</li><li>Отправка <b>заблокирована</b> до ЭЦП руководителя</li></ul>
        <p class="muted">Hisob AI на этом останавливается — дальше только человек.</p>`,
    });
    setStatus('Ждёт подписи ЭЦП');
    aiMsg('<p>Кабинет подготовлен. Я остановился <b>до ЭЦП</b>. Когда подпишете — отправка ваша.</p>');
  }
}

// ---------- main scenario ----------
async function runReport() {
  if (busy) return;
  if (reportDone) { openDoc('vat-10'); await typing(400); aiMsg('Расчёт за октябрь уже готов, открыл его. Кликните по цифре ИИ-курсором, если нужно объяснение.'); return; }
  busy = true; showStart(false); if (TG_MODE) sheet(true);
  addDoc('Отчёты', { id: 'vat-10', nm: 'Расчёт НДС · октябрь', tag: 'черновик', cls: 'new', ic: 'sheet' });
  currentDoc = 'vat-10'; ensureTab('vat-10'); renderTree();
  if (targets.length) clearTargets();
  page.innerHTML = reportShell(); canvas.scrollTop = 0;
  parkCursors();

  await typing(800);
  aiMsg(`<p>Принял. План:</p><p>1. <b>Бухгалтер</b> сводит ${D.sales.length + D.purchases.length} ЭСФ за октябрь и считает НДС.<br>2. <b>Юрист</b> проверяет, что можно взять в зачёт.<br>3. <b>Аналитик</b> сравнивает режимы на ваших цифрах.</p><p class="muted">Ничего не отправлю без вашего «да».</p>`);
  await sleep(400);

  // 1. sales registry
  setStatus('Бухгалтер сводит ЭСФ продаж', true); agentBusy('b', true);
  logMsg('b', `читаю ${D.sales.length} ЭСФ по продажам`);
  const secS = $('#secS'); await reveal(secS);
  const bodyS = $('#bodyS'), wrapS = secS.querySelector('.tbl-wrap');
  await cursorTo('b', wrapS, 'реестр продаж', 600, 0.2, 0.2);
  for (let i = 0; i < D.sales.length; i++) {
    bodyS.insertAdjacentHTML('beforeend', rowS(D.sales[i], i));
    wrapS.scrollTop = wrapS.scrollHeight;
    $('#metaS').textContent = `${i + 1} из ${D.sales.length} ЭСФ`;
    if (i % 6 === 0) { const tr = bodyS.lastElementChild; cursorTo('b', tr, `ЭСФ ${D.sales[i].num}`, 220, 0.75, 0.5); }
    await sleep(28);
  }
  await cursorTo('b', $('#totSV'), 'итого', 500);
  await Promise.all([countTo($('#totSB'), C.sb), countTo($('#totSV'), C.sv)]);
  secS.classList.remove('live');
  logMsg('b', `продажи: ${mln(C.sb)} без НДС, НДС ${mln(C.sv)}`);

  // 2. purchases + lawyer check
  setStatus('Бухгалтер сводит ЭСФ покупок', true);
  const secP = $('#secP'); await reveal(secP);
  const bodyP = $('#bodyP'), wrapP = secP.querySelector('.tbl-wrap');
  await cursorTo('b', wrapP, 'реестр покупок', 500, 0.2, 0.2);
  for (let i = 0; i < D.purchases.length; i++) {
    bodyP.insertAdjacentHTML('beforeend', rowP(D.purchases[i], i).replace(' flag', ''));
    $('#metaP').textContent = `${i + 1} из ${D.purchases.length} ЭСФ`;
    cursorTo('b', bodyP.lastElementChild, `ЭСФ ${D.purchases[i].num}`, 160, 0.75, 0.5);
    await sleep(90);
  }
  agentBusy('y', true); setStatus('Юрист проверяет зачёт НДС', true);
  for (const p of C.nonded) {
    const idx = D.purchases.indexOf(p), tr = bodyP.children[idx];
    await cursorTo('y', tr, 'поставщик не плательщик НДС', 700, 0.4, 0.5);
    await cursors.y.click(); tr.classList.add('flag');
    logMsg('y', `ЭСФ ${p.num} (${p.name}) не идёт в зачёт: поставщик не плательщик НДС`);
  }
  await Promise.all([countTo($('#totPB'), C.pb), countTo($('#totPV'), C.pv)]);
  secP.classList.remove('live'); agentBusy('y', false);

  // 3. totals
  setStatus('Бухгалтер считает НДС к уплате', true);
  const secT = $('#secT'); await reveal(secT);
  await cursorTo('b', $('#cPay'), 'начислено − зачёт', 600);
  await Promise.all([countTo($('#cSV'), C.sv), countTo($('#cPV'), C.pv), countTo($('#cPay'), C.pay, 1200)]);
  secT.classList.remove('live'); agentBusy('b', false);
  logMsg('b', `НДС к уплате: ${fmt(C.pay)} сум`);
  cursors.b.say('');

  // 4. regimes
  setStatus('Аналитик сравнивает режимы', true); agentBusy('a', true);
  logMsg('a', 'считаю налоги на трёх режимах на ваших цифрах');
  const secR = $('#secR'); await reveal(secR);
  await cursorTo('a', $('#rgGen'), 'общий режим', 600, 0.55);
  bars(); await sleep(700);
  await cursorTo('a', $('#rgSimp'), 'упрощённый 6%', 600, 0.55);
  await sleep(500);
  await cursorTo('a', $('#rgTurn'), `оборот ${mlrd(C.annual)} > порога`, 600, 0.55);
  await sleep(500);
  $('#saveBox').hidden = false;
  await cursorTo('a', $('#saveBox'), 'экономия', 600, 0.4);
  secR.classList.remove('live'); agentBusy('a', false);
  logMsg('a', `упрощённый НДС 6% дешевле на ${mln(C.save)} в месяц`);

  // 5. risks
  setStatus('Юрист проверяет риски', true); agentBusy('y', true);
  const secK = $('#secK'); await reveal(secK);
  for (const r of secK.querySelectorAll('.risk')) { await cursorTo('y', r, 'риск', 450, 0.15); await sleep(250); }
  secK.classList.remove('live'); agentBusy('y', false);
  parkCursors();

  reportDone = true; busy = false;
  addDoc('Отчёты', { id: 'vat-10', nm: 'Расчёт НДС · октябрь', tag: 'проверен', cls: 'ok', ic: 'sheet' });
  setStatus('Расчёт готов · ждёт вашего решения');
  await typing(700);
  const text = `Готово. НДС к уплате за октябрь — ${mln(C.pay)} сум. На упрощённом НДС 6% вы платили бы ${mln(C.simp)}: это минус ${mln(C.save)} в месяц, и налог на прибыль 0%. Риски юрист отметил в отчёте.`;
  const m = aiMsg(`<p>${text}</p>`);
  permissionCard(m.querySelector('.body'));
  speak(text);
}

function permissionCard(host) {
  const el = document.createElement('div'); el.className = 'perm';
  el.innerHTML = `<h4>${icon('shield', 'sm')}Что сделать? Нужно ваше разрешение</h4>
    <label><input type="checkbox" checked data-a="xlsx"><span><b>Бухгалтер</b>: расчёт НДС в Excel</span></label>
    <label><input type="checkbox" checked data-a="app"><span><b>Юрист</b>: заявление на упрощённый НДС 6%</span></label>
    <label><input type="checkbox" checked data-a="remind"><span><b>Менеджер</b>: напомнить за 3 дня до срока</span></label>
    <label><input type="checkbox" checked data-a="debt"><span><b>Аналитик</b>: показать дебиторку и пульс денег</span></label>
    <div class="act"><button class="btn btn-primary btn-sm" data-ok>${icon('check', 'sm')}Разрешить</button><button class="btn btn-outline btn-sm" data-no>Не сейчас</button></div>`;
  host.append(el); scrollChat();
  el.querySelector('[data-no]').onclick = () => { el.classList.add('done'); aiMsg('Хорошо, ничего не делаю. Расчёт сохранён как черновик.'); };
  el.querySelector('[data-ok]').onclick = async () => {
    const pick = [...el.querySelectorAll('input:checked')].map(i => i.dataset.a);
    el.classList.add('done');
    userMsg('Разрешаю');
    await doActions(pick);
  };
}

async function doActions(pick) {
  busy = true;
  if (pick.includes('xlsx')) {
    setStatus('Бухгалтер формирует Excel', true); agentBusy('b', true);
    await cursorTo('b', $('#docState') || page, 'формирую Excel', 600);
    makeXlsx(); $('#export').disabled = false;
    addDoc('Отчёты', { id: 'vat-10', nm: 'Расчёт НДС · октябрь', tag: 'xlsx', cls: 'ok', ic: 'sheet' });
    logMsg('b', 'Excel готов: кнопка «Excel» вверху справа');
    agentBusy('b', false);
  }
  if (pick.includes('app')) {
    setStatus('Юрист готовит заявление', true); agentBusy('y', true);
    await sleep(500);
    addDoc('Заявления', { id: 'app-6', nm: 'Заявление · упрощённый НДС', tag: 'проект', cls: 'new', ic: 'file' });
    logMsg('y', 'проект заявления в Документах → Заявления');
    agentBusy('y', false);
  }
  if (pick.includes('remind')) {
    DATES.unshift({ d: '17', m: 'дек', t: 'Напоминание: проверить ЭСФ за ноябрь', s: 'за 3 дня до срока НДС', soon: true, fresh: true });
    renderDates(); logMsg('m', 'напоминание добавлено в Сроки');
  }
  if (pick.includes('debt')) {
    setStatus('Аналитик сводит деньги и долги', true); agentBusy('a', true);
    await sleep(400);
    openDoc('cashflow');
    logMsg('a', `остаток ${mln(FIN().closing)}, просроченная дебиторка ${mln(FIN().arOverdue)}`);
    agentBusy('a', false);
  }
  approved = true;
  if (currentDoc === 'vat-10' && $('#docState')) { $('#docState').textContent = 'Готов к подписи'; $('#docState').classList.add('dark'); }
  parkCursors(); busy = false;
  setStatus('Готово · ждёт подписи ЭЦП');
  await typing(600);
  const S = FIN();
  const m = aiMsg(`<p>Сделано. Плюс по деньгам: остаток ≈ <b>${fmt(S.closing)}</b>, просроченная дебиторка <b>${fmt(S.arOverdue)}</b>. Последний шаг — пакет к ЭЦП: AI готовит, вы подписываете.</p>`);
  const el = document.createElement('div'); el.className = 'perm';
  el.innerHTML = `<h4>${icon('send', 'sm')}Открыть пакет к ЭЦП (стоп до подписи)?</h4>
    <label><input type="checkbox" checked disabled><span>Excel + заявление уже в пакете</span></label>
    <label><input type="checkbox" checked disabled><span>Отправка в my.soliq.uz без вашей ЭЦП невозможна</span></label>
    <div class="act"><button class="btn btn-primary btn-sm" data-ok>Открыть пакет</button><button class="btn btn-outline btn-sm" data-no>Позже</button></div>`;
  m.querySelector('.body').append(el); scrollChat();
  el.querySelector('[data-no]').onclick = () => { el.classList.add('done'); aiMsg('Хорошо. Пакет можно открыть позже: «пакет к ЭЦП».'); };
  el.querySelector('[data-ok]').onclick = async () => { el.classList.add('done'); await openEcpPack(); };
}

function makeXlsx() {
  if (!window.XLSX) return;
  const wb = XLSX.utils.book_new();
  const sum1 = [['Расчёт НДС', CO.period], ['Компания', CO.name], ['ИНН', CO.inn], [], ['НДС начислен', Math.round(C.sv)], ['НДС к зачёту', Math.round(C.pv)], ['НДС к уплате', Math.round(C.pay)], [], ['Упрощённый НДС 6% (сравнение)', Math.round(C.simp)], ['Экономия в месяц', Math.round(C.save)]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum1), 'Итог');
  const s = [['№', 'Покупатель', 'ИНН', '№ ЭСФ', 'Дата', 'Стоимость без НДС', 'НДС'], ...D.sales.map((r, i) => [i + 1, r.name, r.inn, r.num, r.date, r.base, r.vat])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s), 'Прил.4 табл.2');
  const p = [['№', 'Поставщик', 'ИНН', '№ ЭСФ', 'Дата', 'Стоимость без НДС', 'НДС', 'Не в зачёт'], ...D.purchases.map((r, i) => [i + 1, r.name, r.inn, r.num, r.date, r.base, r.vat, r.note || 0])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(p), 'Прил.4 табл.1');
  window._wb = wb;
}
$('#export').onclick = () => { if (window._wb) XLSX.writeFile(window._wb, 'Raschet_NDS_oktyabr_2026.xlsx'); };

// ---------- explain (AI cursor) — like Cash-Flow-National: click any KPI/chart → explain ----------
const EXPLAIN = {
  sb: () => ({ t: 'Продажи без НДС', v: fmt(C.sb), h: `<p>Сумма колонки «Стоимость без НДС» по <b>${D.sales.length}</b> ЭСФ на реализацию за ${CO.period}.</p>`, s: ['Открыть ЭСФ продаж'] }),
  sv: () => ({ t: 'НДС начислен', v: fmt(C.sv), h: `<p>НДС по ставке 12% из ${D.sales.length} ЭСФ продаж. Проверка: ${fmt(C.sb)} × 12% ≈ ${fmt(C.sb * 0.12)}.</p>`, s: ['Открыть ЭСФ продаж'] }),
  pb: () => ({ t: 'Покупки без НДС', v: fmt(C.pb), h: `<p>Сумма по <b>${D.purchases.length}</b> ЭСФ от поставщиков: сырьё, газ, вода, банк.</p>`, s: ['Открыть ЭСФ покупок'] }),
  pv: () => ({ t: 'НДС к зачёту', v: fmt(C.pv), h: `<p>Входной НДС по ЭСФ покупок, который уменьшает налог. Не взято в зачёт: <b>${C.nonded.length}</b> ЭСФ — поставщик не плательщик НДС.</p>`, s: ['Открыть ЭСФ покупок'] }),
  pay: () => ({ t: 'НДС к уплате', v: fmt(C.pay), h: `<ul><li>Начислено: ${fmt(C.sv)}</li><li>Минус зачёт: ${fmt(C.pv)}</li><li><b>К уплате: ${fmt(C.pay)}</b></li></ul>`, s: ['Как платить меньше?'] }),
  simp: () => ({ t: 'Упрощённый НДС 6%', v: fmt(C.simp), h: `<p>6% со всего оборота, включая НДС: ${fmt(C.gross)} × 6%. Это консервативная оценка; если база без НДС — ${fmt(C.sb * SIMPLIFIED_RATE)}.</p><p>Входной НДС не зачитывается, налог на прибыль 0%.</p>`, s: ['Какие риски?'] }),
  save: () => ({ t: 'Экономия в месяц', v: fmt(C.save), h: `<p>${fmt(C.pay)} (общий) − ${fmt(C.simp)} (6%) = <b>${fmt(C.save)}</b> сум.</p><p>Плюс экономия на налоге на прибыль 15% — сумма зависит от прибыли, её посчитаем по выписке.</p>`, s: ['Какие риски?'] }),
  turn: () => ({ t: 'Налог с оборота', v: 'недоступен', h: `<p>Годовой оборот ≈ ${mlrd(C.annual)} (октябрь × 12) выше порога ${mlrd(C.limit)} = 12 000 БРВ.</p>` }),
  annual: () => ({ t: 'Годовой оборот', v: mlrd(C.annual), h: `<p>Оценка: оборот октября ${fmt(C.sb)} × 12. Порог 12 000 БРВ ≈ ${mlrd(C.limit)}.</p>` }),
  b2b: () => ({ t: 'Покупатели-компании', v: `${C.b2b} из ${D.sales.length}`, h: `<p>ЭСФ, где у покупателя есть ИНН юрлица. Остальные ${D.sales.length - C.b2b} — физлица и ИП без ИНН в ЭСФ.</p>` }),
};
function finSnap() { try { return window.FINANCE?.snapshot?.(C) || {}; } catch { return {}; } }
function financeExplain(el) {
  const S = finSnap();
  const ask = el.dataset.ask || el.closest('[data-ask]')?.dataset.ask || '';
  const name = el.dataset.askName || el.dataset.askTitle || '';
  const amount = Number(el.dataset.askAmount || 0);
  const age = Number(el.dataset.askAge || 0);
  const note = el.dataset.askNote || '';
  const map = {
    in_total: () => ({ t: 'Приход месяца', v: fmt(S.inTotal), h: `<p>Все поступления банка и кассы за ${S.period || 'октябрь'}: <b>${fmt(S.inTotal)}</b> сум (${S.opsCount || 0} операций).</p><p>Банк: ${fmt(S.bankIn || 0)}, касса: ${fmt(S.cashIn || 0)}.</p>`, s: ['Кто платил больше всех?', 'Открыть банк'] }),
    out_total: () => ({ t: 'Расход месяца', v: fmt(S.outTotal), h: `<p>Все исходящие платежи: <b>${fmt(S.outTotal)}</b>. Крупные статьи — аренда, сырьё, зарплата, кредит.</p>`, s: ['На что ушло больше всего?', 'Структура расходов'] }),
    closing: () => ({ t: 'Остаток', v: fmt(S.closing), h: `<p>Начало месяца ${fmt(S.opening)} + приход − расход = <b>${fmt(S.closing)}</b>.</p><p>Runway ≈ ${S.runwayDays} дней при текущем темпе расходов.</p>`, s: ['Хватит ли на аренду?', 'Ближайшие платежи'] }),
    runway: () => ({ t: 'Чистый поток / runway', v: `${fmt(S.net)} · ${S.runwayDays} дн.`, h: `<p>Чистый поток = приход − расход = <b>${fmt(S.net)}</b>.</p><p>Runway = остаток / (расход ÷ 30) ≈ <b>${S.runwayDays}</b> дней ликвидности без новых приходов.</p>`, s: ['Что делать сегодня?'] }),
    ar_total: () => ({ t: 'Дебиторка · итого', v: fmt(S.arTotal), h: `<p>Сколько контрагенты должны вам: <b>${fmt(S.arTotal)}</b> по ${(S.ar || []).length} должникам.</p><p>Это деньги «на бумаге» — пока не пришли на счёт.</p>`, s: ['Кто должен больше всех?', 'Что просрочено?'] }),
    ap_total: () => ({ t: 'Кредиторка · итого', v: fmt(S.apTotal), h: `<p>Сколько вы должны поставщикам: <b>${fmt(S.apTotal)}</b>.</p>`, s: ['Кому платить первым?'] }),
    ar_overdue: () => ({ t: 'Просроченная дебиторка', v: fmt(S.arOverdue), h: `<p>Долги с просрочкой срока оплаты: <b>${fmt(S.arOverdue)}</b>. Их можно возвращать звонком / письмом / сверкой.</p>`, s: ['Составить письмо должнику', 'Возможности'] }),
    ap_soon: () => ({ t: 'К оплате скоро', v: fmt(amount || (S.ap || []).slice(0, 2).reduce((s, x) => s + x.amount, 0)), h: `<p>Ближайшие исходящие обязательства перед поставщиками.</p>`, s: ['График платежей'] }),
    dso: () => ({ t: 'DSO · дни сбора', v: `${S.collectionDays || 0} дн.`, h: `<p>Days Sales Outstanding ≈ дебиторка ÷ (приход / 30) = <b>${S.collectionDays || 0}</b> дней.</p><p>Чем ниже — тем быстрее деньги от клиентов превращаются в остаток на счёте.</p>`, s: ['Как ускорить сбор?'] }),
    dpo: () => ({ t: 'DPO · дни оплаты', v: `${S.payDays || 0} дн.`, h: `<p>Days Payable Outstanding ≈ кредиторка ÷ (расход / 30) = <b>${S.payDays || 0}</b> дней.</p><p>Показывает, сколько в среднем вы «держите» деньги перед оплатой поставщикам.</p>`, s: ['Баланс DSO и DPO'] }),
    debt_share: () => ({ t: 'Доля долгов к обороту', v: `${Math.round((S.arTotal || 0) / Math.max(S.inTotal, 1) * 100)}%`, h: `<p>Дебиторка относительно прихода месяца. Высокая доля — деньги «заморожены» у клиентов.</p>`, s: ['Открыть дебиторку'] }),
    chart_ar_aging: () => ({ t: 'Aging дебиторки', v: '', h: `<p>Распределение долгов по возрасту: 0 / 1–30 / 31–60 / 60+ дней. Баucket «просрочено» — приоритет взыскания.</p>`, s: ['Кто в 60+?'] }),
    chart_ap_aging: () => ({ t: 'Aging кредиторки', v: '', h: `<p>Сроки ваших обязательств перед поставщиками по возрастам.</p>`, s: ['Что платить на этой неделе?'] }),
    chart_ar_mix: () => ({ t: 'Структура дебиторки', v: '', h: `<p>Доля каждого должника в общей сумме. Крупные куски — концентрация риска.</p>`, s: ['Топ должников'] }),
    chart_ap_mix: () => ({ t: 'Структура кредиторки', v: '', h: `<p>Кому вы должны больше всего — приоритет платежей и переговоров.</p>` }),
    ar_top: () => ({ t: 'Топ должников', v: fmt(S.arTotal), h: `<p>Список контрагентов, отсортированный по сумме долга. Клик по строке — детали.</p>` }),
    ap_top: () => ({ t: 'Топ кредиторов', v: fmt(S.apTotal), h: `<p>Крупнейшие исходящие долги.</p>` }),
    party: () => ({ t: name || 'Контрагент', v: amount ? fmt(amount) : '', h: `<p><b>${esc(name)}</b>${amount ? `: ${fmt(amount)} сум` : ''}${age ? `, ${age} дн.` : ''}${note ? `. ${esc(note)}` : ''}.</p><p>${el.dataset.askKind === 'ar' ? 'Это дебиторка — деньги, которые должны вам.' : 'Это кредиторка — ваши обязательства.'}</p>`, s: el.dataset.askKind === 'ar' ? ['Напомнить о долге', 'Сверка'] : ['Запланировать оплату'] }),
    rent_month: () => ({ t: 'Аренда / мес', v: '18 000 000', h: `<p>Фиксированная аренда цеха. Следующий платёж — ноябрь.</p>`, s: ['График аренды'] }),
    credit_pay: () => ({ t: 'Кредит · платёж', v: fmt(S.credit?.monthly || 0), h: `<p>Ежемесячный платёж по кредиту ${esc(S.credit?.bank || '')}. Ближайшая дата: ${esc(S.credit?.nextDue || '')}.</p>` }),
    credit_left: () => ({ t: 'Остаток кредита', v: fmt(S.credit?.left || 0), h: `<p>Остаток основного долга: <b>${fmt(S.credit?.left || 0)}</b> при ставке ${((S.credit?.rate || 0) * 100).toFixed(0)}%.</p>` }),
    fixed_load: () => ({ t: 'Фикс. нагрузка', v: fmt(18000000 + (S.credit?.monthly || 0)), h: `<p>Аренда + кредит каждый месяц — обязательный «пол» расходов, который должен покрываться выручкой.</p>` }),
    chart_flow: () => ({ t: 'Остаток накопительно', v: fmt(S.closing), h: `<p>Кривая остатка день за днём: видно провалы ликвидности и дни крупных расходов/приходов.</p>`, s: ['Где был минимум?'] }),
    chart_weeks: () => ({ t: '12 недель · маржа', v: '', h: `<p>Недельная динамика маржи (приход − расход) / приход. Падение — сигнал смотреть расходы или отсрочки.</p>` }),
    chart_pie: () => ({ t: 'Приход / расход', v: '', h: `<p>Соотношение входящих и исходящих потоков за месяц.</p>` }),
    chart_mix: () => ({ t: 'Структура расходов', v: '', h: `<p>Категории расходов: аренда, сырьё, ФОТ, кредит и прочее — где сидит основная нагрузка.</p>`, s: ['Что резать первым?'] }),
    chart_wd: () => ({ t: 'По дням недели', v: '', h: `<p>Когда деньги приходят и уходят чаще — полезно для кассового планирования.</p>` }),
    chart_days: () => ({ t: 'По дням октября', v: '', h: `<p>Дневной приход и расход. Пики часто совпадают с эквайрингом, поставками муки или арендой.</p>` }),
    chart_rent: () => ({ t: 'Аренда · 6 месяцев', v: '', h: `<p>План арендных платежей на полгода: статусы оплачено / к оплате / план.</p>` }),
    chart_credit: () => ({ t: 'Кредит · график', v: '', h: `<p>График погашения кредита: тело + проценты по датам.</p>` }),
    chart_opps: () => ({ t: 'Эффект по возможностям', v: '', h: `<p>Сколько сум можно высвободить действиями: НДС 6%, возврат дебиторки, оптимизация расходов.</p>`, s: ['Что делать сегодня?'] }),
    opp_plan: () => ({ t: 'Приоритетный план', v: '', h: `<p>Список действий, отсортированный по эффекту в сумах. Сверху — максимальная отдача.</p>` }),
    opp_item: () => ({ t: name || 'Возможность', v: amount ? fmt(amount) : '', h: `<p>${esc(name)}${amount ? `: эффект ≈ ${fmt(amount)} сум` : ''}.</p><p>Это рекомендация на основе ваших книг, не выдуманная цифра.</p>`, s: ['Сделать это'] }),
    vat_save: () => ({ t: 'Экономия НДС 6%', v: fmt(C.save), h: `<p>Разница общего режима и упрощённого 6%: <b>${fmt(C.save)}</b> сум/мес.</p>`, s: ['Какие риски?', 'Заявление на 6%'] }),
    year_potential: () => ({ t: 'Потенциал года', v: fmt((C.save || 0) * 12 + (S.arOverdue || 0)), h: `<p>Грубая оценка: экономия НДС × 12 + просроченная дебиторка, которую можно вернуть сейчас.</p>` }),
    due_soon: () => ({ t: 'Ближайшие платежи', v: '', h: `<p>Календарь исходящих обязательств на ближайшие дни — аренда, кредит, поставщики.</p>` }),
    due_item: () => ({ t: name || 'Платёж', v: amount ? fmt(amount) : '', h: `<p>${esc(name)}${amount ? `: ${fmt(amount)} сум` : ''}.</p>` }),
    top_in: () => ({ t: name || 'Приход', v: amount ? '+' + fmt(amount) : '', h: `<p>Крупный приход от <b>${esc(name)}</b>: ${fmt(amount)} сум.</p>` }),
    top_out: () => ({ t: name || 'Расход', v: amount ? '−' + fmt(amount) : '', h: `<p>Крупный расход <b>${esc(name)}</b>: ${fmt(amount)} сум.</p>` }),
    schedule_item: () => ({ t: el.dataset.askKind || 'Платёж', v: amount ? fmt(amount) : '', h: `<p>${esc(el.dataset.askKind || '')}: ${fmt(amount)} · статус «${esc(el.dataset.askStatus || '')}».</p>` }),
  };
  if (ask && map[ask]) return map[ask]();
  return null;
}
function genericExplain(el) {
  const fin = financeExplain(el); if (fin) return fin;
  const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
  const title = el.querySelector?.('h1,h2,h3,span,b')?.innerText?.trim() || describe(el);
  return { t: title.slice(0, 80), v: '', h: `<p>${esc(txt.slice(0, 400)) || 'Элемент на экране.'}</p><p class="muted">Спросите в чате подробнее — разберу по вашим данным.</p>`, s: ['Что это значит для меня?'] };
}
const pop = $('#pop');
let lastExplainEl = null;
function closePop() { pop.hidden = true; pop.classList.remove('loading'); }
function placePopNear(el) {
  pop.hidden = false;
  const r = el.getBoundingClientRect(), pw = pop.offsetWidth || 340, ph = pop.offsetHeight || 220;
  let left = Math.min(innerWidth - pw - 12, Math.max(12, r.left + r.width / 2 - pw / 2));
  let top = r.bottom + 10; if (top + ph > innerHeight - 12) top = Math.max(12, r.top - ph - 10);
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
}
function fillPop(x, el) {
  lastExplainEl = el;
  pop.dataset.key = el?.dataset?.x || el?.dataset?.ask || '';
  $('#popTitle').textContent = x.t || 'Объяснение';
  $('#popVal').textContent = x.v || '';
  $('#popExplain').innerHTML = x.h || '';
  $('#popSugg').innerHTML = (x.s || []).map(s => `<button type="button" class="chip">${esc(s)}</button>`).join('');
  $('#popSugg').querySelectorAll('button').forEach(b => b.onclick = () => { closePop(); if (el && !targets.some(t => t.el === el)) toggleTarget(el); handleText(b.textContent); });
  placePopNear(el || page);
}
function openPop(el) {
  if (!el) return;
  if (el.dataset.x && EXPLAIN[el.dataset.x]) fillPop(EXPLAIN[el.dataset.x](), el);
  else fillPop(genericExplain(el), el);
  explainWithAi(el);
}
async function explainWithAi(el) {
  const payload = describeElement(el);
  const localHtml = $('#popExplain').innerHTML;
  pop.classList.add('loading');
  const wait = document.createElement('p'); wait.className = 'muted'; wait.id = 'popAiWait'; wait.textContent = 'GLM разбирает…';
  $('#popExplain').append(wait);
  try {
    const r = await fetch('/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ element: payload, doc: currentDoc, lang: 'ru' }) });
    if (!r.ok) throw new Error('no api');
    const j = await r.json();
    if (j.reply && lastExplainEl === el) {
      $('#popExplain').innerHTML = `<div class="pop-ai">${md(j.reply)}</div><details class="pop-local"><summary>Краткая справка</summary>${localHtml}</details>`;
    } else wait.remove();
  } catch { wait.remove(); }
  finally { pop.classList.remove('loading'); }
}
function describeElement(el) {
  const cut = (s, n = 1200) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const d = { kind: 'element', label: describe(el), text: cut(el.innerText, 1500), section: currentDoc || '', doc: currentDoc || '' };
  if (el.dataset.x) { d.kind = 'VAT'; d.key = el.dataset.x; const x = EXPLAIN[el.dataset.x]?.(); if (x) { d.label = x.t; d.value = x.v; } }
  if (el.dataset.ask) { d.kind = 'KPI'; d.key = el.dataset.ask; d.label = el.querySelector('span')?.innerText || d.label; d.value = el.querySelector('b')?.innerText || el.dataset.askAmount || ''; d.hint = el.querySelector('small')?.innerText || el.dataset.askNote || ''; }
  if (el.matches('canvas') || el.querySelector?.('canvas')) {
    d.kind = 'chart';
    const canvas = el.matches('canvas') ? el : el.querySelector('canvas');
    try {
      const c = typeof Chart !== 'undefined' && Chart.getChart?.(canvas);
      if (c) d.chart = { type: c.config?.type, labels: (c.data?.labels || []).slice(-24), datasets: (c.data?.datasets || []).slice(0, 4).map(s => ({ label: s.label, data: (s.data || []).slice(-24) })) };
    } catch {}
    d.label = el.querySelector?.('h3')?.innerText || d.label;
  }
  if (el.matches('.ax-bar-row, .ax-opp, .ax-due-row, .ax-tl')) { d.kind = 'row'; d.label = el.dataset.askName || el.dataset.askTitle || d.label; d.value = el.dataset.askAmount || ''; }
  return d;
}

const PICK = '[data-x],[data-ask],.ax-kpi,.ax-panel,.ax-bar-row,.ax-opp,.ax-due-row,.ax-tl,.ax-ins,.ax-mini > div,.card-n,.rgm,.save,.risk,.sec-h,.doc-h,.rg tbody tr,.rg tfoot tr,.letter .to,.letter h2,.letter p,.letter .draft,canvas,.ax-chart';
const OWN_UI = '.chat,.pop,.tb,.lp,.ai-cursor-bar,[data-tool],#pickBtn';
let targets = [];
const hoverBox = $('#hoverBox');
const aiBar = $('#aiCursorBar');
function pickTarget(raw) {
  if (!raw || raw.closest?.(OWN_UI)) return null;
  let el = raw.closest?.(PICK);
  if (el && el.matches('canvas')) el = el.closest('.ax-panel,[data-ask]') || el;
  if (!el) {
    el = raw.closest?.('.ax-kpi, .ax-panel, .card, .sec, tr, p, li, button, a');
  }
  if (!el || !page.contains(el) || el === page) return null;
  if (el.matches('button[data-ax-view], button[data-ax-pop], button[data-opp-act]')) return null;
  return el;
}
function describe(el) {
  const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
  const cut = (x, n = 42) => x.length > n ? x.slice(0, n) + '…' : x;
  if (el.dataset.x && EXPLAIN[el.dataset.x]) return EXPLAIN[el.dataset.x]().t;
  if (el.dataset.ask) {
    const fin = financeExplain(el); if (fin?.t) return fin.t;
    return el.querySelector('span,h3,b')?.innerText?.trim() || cut(txt);
  }
  if (el.matches('.rg tfoot tr')) return 'Итого реестра';
  if (el.matches('.rg tbody tr')) { const td = [...el.cells].map(c => c.innerText.trim()); return `ЭСФ ${td[3]} · ${cut(td[1], 24)}`; }
  if (el.matches('.card-n')) return el.querySelector('span')?.innerText || cut(txt);
  if (el.matches('.rgm')) return 'Режим: ' + (el.querySelector('b')?.innerText || '');
  if (el.matches('.save')) return 'Экономия';
  if (el.matches('.risk')) return 'Риск: ' + cut(txt, 30);
  if (el.matches('.sec-h')) return 'Раздел: ' + (el.querySelector('h3')?.innerText || '');
  if (el.matches('.doc-h')) return 'Документ: ' + (el.querySelector('h1')?.innerText || '');
  if (el.matches('.ax-panel')) return el.querySelector('h3')?.innerText || 'Блок аналитики';
  return cut(txt);
}
function placeHover(el) {
  if (!el) { hoverBox.classList.remove('on'); return; }
  const r = el.getBoundingClientRect(), b = inner.getBoundingClientRect();
  Object.assign(hoverBox.style, { left: r.left - b.left - 3 + 'px', top: r.top - b.top - 3 + 'px', width: Math.max(24, r.width + 6) + 'px', height: Math.max(24, r.height + 6) + 'px' });
  $('#hoverTag').textContent = (e => e.shiftKey ? 'В чат · ' : 'Объяснить · ')(window._aiShift || { shiftKey: false }) + describe(el);
  hoverBox.classList.add('on');
}
function onAiMove(e) {
  if (tool !== 'ai') return;
  window._aiShift = e;
  placeHover(pickTarget(e.target));
}
function onAiClick(e) {
  if (tool !== 'ai') return;
  if (e.target.closest?.(OWN_UI)) return;
  const el = pickTarget(e.target); if (!el) return;
  e.preventDefault(); e.stopPropagation();
  if (e.shiftKey) { toggleTarget(el); placeHover(el); return; }
  el.classList.add('picked');
  setTimeout(() => { if (!targets.some(t => t.el === el)) el.classList.remove('picked'); }, 1400);
  openPop(el);
}
page.addEventListener('mousemove', onAiMove);
page.addEventListener('mouseleave', () => placeHover(null));
canvas.addEventListener('scroll', () => placeHover(null), true);
page.addEventListener('click', onAiClick, true);
page.addEventListener('contextmenu', e => {
  if (tool !== 'ai') return;
  const el = pickTarget(e.target); if (!el) return;
  e.preventDefault();
  openPop(el);
});
function toggleTarget(el) {
  const i = targets.findIndex(x => x.el === el);
  if (i >= 0) { el.classList.remove('picked'); targets.splice(i, 1); }
  else { el.classList.add('picked'); targets.push({ el, label: describe(el), text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500) }); }
  renderTargets();
  if (i < 0 && targets.length === 1) { $('#chat').classList.add('open'); $('#chatInput').focus(); }
}
function clearTargets() { targets.forEach(x => x.el.classList.remove('picked')); targets = []; renderTargets(); }
function renderTargets() {
  targets.forEach((x, i) => x.el.setAttribute('data-n', i + 1));
  $('#attached').innerHTML = targets.map((x, i) => `<span class="att target"><b>${i + 1}</b><span class="lbl">${esc(x.label)}</span><button type="button" data-i="${i}" title="Убрать">${icon('x', 'sm')}</button></span>`).join('')
    + (targets.length > 1 ? `<button type="button" class="att clear" id="clearT">Снять все · ${targets.length}</button>` : '');
  $('#attached').querySelectorAll('[data-i]').forEach(b => b.onclick = () => toggleTarget(targets[+b.dataset.i].el));
  $('#clearT')?.addEventListener('click', clearTargets);
  $('#chatInput').placeholder = targets.length ? 'Что спросить про отмеченное?' : 'Спросите про налоги, деньги, дебиторку…';
}
function sendMarked(q) { $('#chatInput').value = ''; handleText(q || 'Объясни отмеченное'); }
$('#popAsk').onclick = () => {
  const el = lastExplainEl;
  closePop();
  if (el && !targets.some(x => x.el === el)) toggleTarget(el);
  $('#chat').classList.add('open');
  $('#chatInput').focus();
};
$('#popClose').onclick = closePop;
addEventListener('mousedown', e => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('[data-x],[data-ask],.ax-kpi,.ax-panel,.ax-bar-row')) closePop(); });

function setTool(t) {
  tool = t;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  canvas.classList.toggle('ai', t === 'ai');
  document.documentElement.classList.toggle('ai-cursor-on', t === 'ai');
  if (aiBar) aiBar.hidden = t !== 'ai';
  if (t !== 'ai') { closePop(); placeHover(null); }
}
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
$('#pickBtn').onclick = () => { setTool('ai'); toast('ИИ-курсор: клик по цифре/графику — объяснить. Shift+клик — в чат', 'ai-cursor'); };
$('#aiCursorOff')?.addEventListener('click', () => setTool('select'));

// ---------- text intents (local), backend if available ----------
const chatHist = [];
async function handleText(t, voice = false) {
  t = t.trim();
  if (!t && targets.length) t = 'Объясни отмеченное';
  if (!t) return;
  const marked = targets.map((x, i) => `${i + 1}) ${x.label}: ${x.text}`);
  userMsg(t, voice, targets.map(x => x.label));
  chatHist.push({ role: 'user', content: marked.length ? `${t}\n\n[Пользователь отметил на экране ИИ-курсором:\n${marked.join('\n')}]` : t });
  if (targets.length) clearTargets();
  const s = t.toLowerCase();
  // Stage safety: the main scenario never depends on the network.
  if (!marked.length && !reportDone && !busy && /(подготов|собер|сдела|посчита|tayyorla|hisobla).*(ндс|qqs|расч|отч|hisobot)|(ндс|qqs|hisobot).*(подготов|собер|tayyorla)/.test(s)) return runReport();
  const dots = showTyping();
  const res = await askBackend(voice).catch(() => null);
  dots.remove();
  if (!res) return localAnswer(s);
  const { reply, actions = [] } = res;
  if (reply) { aiMsg(md(reply)); speak(reply); }
  // The model often calls a tool without text: confirm with a fixed phrase (no numbers, so nothing can be invented).
  if (!reply && actions.length) { const said = actions.map(confirmText).filter(Boolean).join(' '); if (said) { aiMsg(`<p>${esc(said)}</p>`); speak(said); } }
  for (const act of actions) await runAction(act);
  if (!reply && !actions.length) aiMsg('<p>Не понял задачу. Попробуйте сказать иначе.</p>');
  // History keeps plain sentences: a bracketed marker here gets copied by the model as its own answer.
  const did = { create_document: a => `Создал документ «${a.title}» (id ${lastCreated}) и открыл его на холсте.`, export_document: a => `Скачал документ в ${String(a.format || '').toUpperCase()}.`, open_document: a => `Открыл документ ${a.id}.`, query_invoices: () => '', highlight_rows: () => 'Подсветил найденные ЭСФ.' };
  chatHist.push({ role: 'assistant', content: reply || actions.map(x => (did[x.name] ? did[x.name](x.args || {}) : confirmText(x)) || 'Готово.').join(' ') });
}
function showTyping() {
  const m = document.createElement('div'); m.className = 'msg ai';
  m.innerHTML = `<span class="av">${icon('sparkle', 'sm')}</span><div class="body"><div class="typing"><i></i><i></i><i></i></div></div>`;
  msgs.append(m); scrollChat(); return m;
}

function confirmText({ name, args = {} }) {
  const doc = DOCS.flatMap(g => g.items).find(x => x.id === args.id);
  const ready = reportDone && !busy;
  return {
    build_vat_report: '',
    open_document: args.id === 'vat-10' && !reportDone ? '' : `Открыл «${doc ? doc.nm : 'документ'}».`,
    show_deadlines: 'Показал сроки слева.',
    explain_number: ready ? 'Показываю, из чего сложилась эта цифра.' : '',
    prepare_actions: '',
    show_home: 'Вернулся на старт. Что сделаем?',
    show_section: ready ? 'Показываю этот блок в отчёте.' : '',
    create_document: `Подготовил черновик «${args.title || 'документ'}», он на холсте.`,
    export_document: '',
    set_reminder: `Добавил напоминание на ${args.date || ''}.`,
    request_document: `Загрузите ${args.what || 'документ'}: зона загрузки слева подсвечена.`,
    show_map: `Переключил карту в ${String(args.mode || '').toUpperCase()}.`,
    show_geo: '', show_social: '', send_to_telegram: '',
    select_floor: `Выбрал ${args.floor} этаж: он подсвечен на 3D-модели, ниже — план этажа.`, set_unit: `Записал помещение «${args.name || ''}»${args.area_m2 ? `, ${args.area_m2} м²` : ''}.`,
  }[name] ?? '';
}
// Tools the model can call (definitions live in server.js). Anything with consequences goes through the permission card.
async function runAction({ name, args = {} }) {
  if (name === 'send_to_telegram') { while (busy) await sleep(300); return sendToTelegram(args); }
  if (busy && name !== 'show_deadlines') return aiMsg('<p>Агенты ещё работают, сделаю это сразу после них.</p>');
  if (TG_MODE && ['build_vat_report', 'open_document', 'show_section', 'explain_number', 'highlight_rows', 'show_geo', 'show_map', 'show_social', 'select_floor', 'create_document'].includes(name)) sheet(true);
  if (name === 'build_vat_report') return runReport();
  if (name === 'open_document') {
    if (args.id === 'vat-10' && !reportDone) return runReport();
    openDoc(args.id); return;
  }
  if (name === 'show_deadlines') { document.querySelector('[data-tab="dates"]').click(); return; }
  if (name === 'show_home') { activateHome(); return; }
  if (name === 'prepare_actions') {
    if (!reportDone) return runReport();
    if (approved) return aiMsg('<p>Excel и заявление уже подготовлены: они в «Документах».</p>');
    const m = aiMsg('<p>Вот что могу сделать:</p>'); permissionCard(m.querySelector('.body')); return;
  }
  if (name === 'explain_number') {
    if (!reportDone) return aiMsg('<p>Сначала соберу расчёт: скажите «подготовь НДС за октябрь».</p>');
    if (currentDoc !== 'vat-10') openDoc('vat-10');
    setTool('ai');
    const el = page.querySelector(`[data-x="${CSS.escape(args.key || '')}"]`); if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' }); await sleep(550);
    await cursorTo('m', el, 'вот эта цифра', 600, 0.5, 0.5);
    openPop(el);
    setTimeout(() => cursors.m.el.classList.add('idle'), 2500);
    return;
  }
  if (name === 'show_section') return showSection(args.section);
  if (name === 'create_document') { await createDocument(args); return; }
  if (name === 'export_document') return exportDoc(args.id, args.format);
  if (name === 'set_reminder') return setReminder(args.date, args.text);
  if (name === 'request_document') return requestDocument(args.what);
  if (name === 'highlight_rows') return highlightRows(args.type, args.nums || []);
  if (name === 'show_geo') return showGeo(args);
  if (name === 'select_floor') {
    if (currentDoc !== 'geo') openDoc('geo');
    if (!GEO.building) return aiMsg('<p>Сначала кликните по дому на карте: он раскроется по этажам.</p>');
    if (args.floor > GEO.building.levels) return aiMsg(`<p>В этом доме ${GEO.building.levels} эт. (${esc(GEO.building.levelsSrc)}), ${args.floor}-го нет.</p>`);
    return selectFloor(args.floor);
  }
  if (name === 'set_unit') {
    if (!GEO.floor) return aiMsg('<p>Сначала выберите здание и этаж на карте.</p>');
    GEO.unit = { ...(GEO.unit || {}), floor: GEO.floor, name: String(args.name || '').slice(0, 40), area: Number.isFinite(args.area_m2) ? args.area_m2 : GEO.unit?.area ?? null };
    drawBuilding(); renderBuilding(); renderGeoPanel(); return;
  }
  if (name === 'show_map') { if (currentDoc !== 'geo') openDoc('geo'); GEO.mode = args.mode; return setMapMode(args.mode); }
  if (name === 'show_social') return showSocial(args);
}

// ---------- documents written by the model ----------
function mdToHtml(md) {
  const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const out = []; let cur = null, buf = [];
  const emit = () => {
    if (!buf.length) { cur = null; return; }
    if (cur === 'p') out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    else if (cur === 'ul') out.push(`<ul>${buf.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`);
    else if (cur === 'to') out.push(`<div class="to">${buf.map(inline).join('<br>')}</div>`);
    else if (cur === 'tb') out.push('<table class="dt">' + buf.map((r, i) => '<tr>' + r.map(c => i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('') + '</tr>').join('') + '</table>');
    buf = []; cur = null;
  };
  const push = (t, v) => { if (cur !== t) emit(); cur = t; buf.push(v); };
  for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    if (!l) { emit(); continue; }
    if (l.startsWith('>>')) push('to', l.replace(/^>>\s?/, ''));
    else if (/^#\s/.test(l)) { emit(); out.push(`<h2>${inline(l.slice(2))}</h2>`); }
    else if (/^#{2,6}\s/.test(l)) { emit(); out.push(`<h3>${inline(l.replace(/^#+\s/, ''))}</h3>`); }
    else if (/^[-*•]\s/.test(l)) push('ul', l.slice(2));
    else if (/^\|.*\|$/.test(l)) { if (!/^\|[\s:|-]+\|$/.test(l)) push('tb', l.slice(1, -1).split('|').map(c => c.trim())); }
    else push('p', l);
  }
  emit(); return out.join('');
}
const createdDocHtml = id => `<div class="doc"><div class="letter"><span class="chip draft">Черновик · проверьте перед подписью</span>${mdToHtml(CREATED[id].md)}</div></div>`;
async function createDocument(a) {
  const draft = { title: String(a.title || 'Документ').slice(0, 80), kind: a.kind || 'другое', md: String(a.body || '') };
  let id = a.id && CREATED[a.id] ? a.id : null;
  try { const r = await fetch('/api/docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...draft, source: TG_MODE ? 'tg' : 'pc' }) }).then(x => x.json()); id = r.doc.id; docsVer = r.version; }
  catch { id = id || 'local-' + (++docSeq); }
  CREATED[id] = draft;
  lastCreated = id;
  if (TG_MODE) sheet(true);
  addDoc('Созданные', { id, nm: CREATED[id].title, tag: CREATED[id].kind, cls: 'new', ic: 'file' });
  closePop(); if (targets.length) clearTargets();
  currentDoc = id; ensureTab(id); renderTree(); showStart(false);
  if (geoMap) { geoMap.remove(); geoMap = null; }
  page.innerHTML = createdDocHtml(id); canvas.scrollTop = 0;
  // the agent "writes" the document block by block
  const who = /отч|акт|справ/.test(CREATED[id].kind) ? 'b' : 'y';
  const blocks = [...page.querySelectorAll('.letter > *')];
  blocks.forEach(b => b.classList.add('rv'));
  busy = true; agentBusy(who, true); setStatus(`${A[who].name} пишет «${CREATED[id].title}»`, true);
  for (const b of blocks) { b.classList.add('in'); cursorTo(who, b, 'пишу', 180, 0.92, 0.5); await sleep(120); }
  await sleep(300);
  agentBusy(who, false); busy = false; parkCursors(); setStatus('Черновик готов · можно скачать PDF или Word');
  return id;
}

// ---------- export: PDF (html2pdf), DOCX (docx), XLSX (SheetJS) ----------
function download(blob, filename) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
function runsOf(el, bold = false) {
  const { TextRun } = window.docx; const runs = [];
  el.childNodes.forEach(n => {
    if (n.nodeType === 3) { if (n.textContent) runs.push(new TextRun({ text: n.textContent.replace(/\s+/g, ' '), bold })); }
    else if (n.nodeName === 'BR') runs.push(new TextRun({ text: '', break: 1 }));
    else if (n.nodeType === 1 && !n.classList.contains('i')) runs.push(...runsOf(n, bold || /^(B|STRONG)$/.test(n.nodeName)));
  });
  return runs;
}
async function toDocx(root) {
  const { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType } = window.docx;
  const SEL = 'h1,h2,h3,p,li,table,.to,.card-n,.rgm,.save,.risk,.sign';
  const kids = [];
  [...root.querySelectorAll(SEL)].filter(el => !el.parentElement.closest(SEL)).forEach(el => {
    if (/^H[12]$/.test(el.tagName)) kids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 200 }, children: [new TextRun({ text: el.innerText.replace(/\s+/g, ' ').trim(), bold: true, size: 30 })] }));
    else if (el.tagName === 'H3') kids.push(new Paragraph({ spacing: { before: 200, after: 100 }, children: [new TextRun({ text: el.innerText.trim(), bold: true, size: 24 })] }));
    else if (el.tagName === 'LI') kids.push(new Paragraph({ bullet: { level: 0 }, children: runsOf(el) }));
    else if (el.tagName === 'TABLE') kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [...el.rows].map(r => new TableRow({ children: [...r.cells].map(c => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c.innerText.trim(), size: 18, bold: c.tagName === 'TH' })] })] })) })) }));
    else if (el.classList.contains('to')) kids.push(new Paragraph({ indent: { left: 4800 }, spacing: { after: 300 }, children: runsOf(el) }));
    else kids.push(new Paragraph({ spacing: { after: 160 }, children: el.matches('p') ? runsOf(el) : [new TextRun({ text: el.innerText.replace(/\s*\n\s*/g, ' · ').trim() })] }));
  });
  return Packer.toBlob(new Document({ sections: [{ properties: {}, children: kids }] }));
}
async function exportBlob(id, format = 'pdf') {
  const known = id && (CREATED[id] || DOCS.flatMap(g => g.items).some(x => x.id === id));
  const target = known ? id : (lastCreated || currentDoc);
  if (!target) { aiMsg('<p>Нечего экспортировать: сначала откройте или создайте документ.</p>'); return null; }
  if (target === 'vat-10' && !reportDone) { aiMsg('<p>Сначала соберу расчёт.</p>'); await runReport(); }
  if (target !== currentDoc) { openDoc(target); await sleep(250); }
  if (target === 'vat-10' && format === 'docx') format = 'pdf';
  const item = DOCS.flatMap(g => g.items).find(x => x.id === currentDoc);
  const title = item ? item.nm : 'Документ';
  const name = title.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'Документ';
  const root = page.querySelector('.doc'); if (!root) return null;
  if (format === 'xlsx') {
    let wb;
    if (currentDoc === 'vat-10') { makeXlsx(); wb = window._wb; }
    else { const t = root.querySelector('table'); if (!t) format = 'pdf'; else wb = XLSX.utils.table_to_book(t); }
    if (wb) return { blob: new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name: name + '.xlsx', title };
  }
  if (format === 'docx') return { blob: await toDocx(root), name: name + '.docx', title };
  root.classList.add('exporting');
  try {
    const blob = await html2pdf().set({ margin: [12, 12, 12, 12], image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'] } }).from(root).outputPdf('blob');
    return { blob, name: name + '.pdf', title };
  } finally { root.classList.remove('exporting'); }
}
async function exportDoc(id, format = 'pdf') {
  setStatus(`Готовлю ${format.toUpperCase()}…`, true);
  try {
    const r = await exportBlob(id, format); if (!r) return;
    download(r.blob, r.name);
    toast(`Скачан ${r.name}`, 'download'); logMsg('m', `скачан файл ${r.name}`);
  } catch (e) { console.error(e); aiMsg('<p>Не получилось сформировать файл. Попробуйте другой формат.</p>'); }
  finally { setStatus('Готово'); }
}
const toB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
async function sendToTelegram({ id, format = 'pdf' } = {}) {
  if (!TGW?.initData) { aiMsg('<p>Отправка в Telegram работает, когда приложение открыто из бота. Пока скачаю файл.</p>'); return exportDoc(id, format); }
  setStatus('Отправляю в Telegram', true);
  try {
    const r = await exportBlob(id, format || 'pdf'); if (!r) return;
    const res = await fetch('/api/tg/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: TGW.initData, filename: r.name, data: await toB64(r.blob), caption: r.title }) }).then(x => x.json());
    if (!res.ok) throw new Error(res.error || 'ошибка');
    aiMsg(`<p>Отправил «${esc(r.title)}» в чат ✅</p>`); TGW.HapticFeedback?.notificationOccurred('success');
    setTimeout(() => sheet(false), 1400);
  } catch (e) { aiMsg(`<p>Не удалось отправить: ${esc(e.message)}</p>`); TGW?.HapticFeedback?.notificationOccurred('error'); }
  finally { setStatus('Готово'); }
}

// ---------- other screen tools ----------
function showSection(sec) {
  const map = { sales: 'secS', purchases: 'secP', totals: 'secT', regimes: 'secR', risks: 'secK' };
  if (!reportDone) return runReport();
  if (currentDoc !== 'vat-10') openDoc('vat-10');
  const el = $('#' + map[sec]); if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.add('live'); setTimeout(() => el.classList.remove('live'), 1800);
}
async function highlightRows(type, nums) {
  const id = type === 'purchases' ? 'esf-p' : 'esf-s';
  if (currentDoc !== id) openDoc(id);
  const set = new Set(nums); let first = null;
  page.querySelectorAll('tr[data-num]').forEach(tr => { const on = set.has(tr.dataset.num); tr.classList.toggle('hl', on); if (on && !first) first = tr; });
  if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); await sleep(450); await cursorTo('a', first, `нашёл ${nums.length} ЭСФ`, 500, 0.6); setTimeout(() => cursors.a.el.classList.add('idle'), 2000); }
}
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function setReminder(date, text) {
  const m = String(date || '').match(/(\d{1,2})[./-](\d{1,2})/);
  DATES.unshift({ d: m ? String(+m[1]) : '—', m: m ? MONTHS[(+m[2] - 1) % 12] : '', t: String(text || 'Напоминание'), s: 'напоминание', soon: true, fresh: true });
  renderDates(); document.querySelector('[data-tab="dates"]').click();
}
function requestDocument(what) {
  document.querySelector('[data-tab="docs"]').click();
  const d = $('#drop'); d.classList.add('ask'); d.scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('Загрузите: ' + (what || 'документ'), 'upload');
  setTimeout(() => d.classList.remove('ask'), 7000);
}

/** Offline/local draft when LLM unavailable — same create_document path as online */
function localDraftDocument(s) {
  const isApp = /заявлен|ariza|упрощ|6\s*%|уп-?100/.test(s);
  const isOrder = /приказ|buyruq|назнач/.test(s);
  const isMemo = /записк|doklad|доклад|inventar|инвентар/.test(s);
  const kind = isApp ? 'заявление' : isOrder ? 'приказ' : isMemo ? 'записка' : 'письмо';
  const title = isApp ? 'Заявление · упрощённый НДС 6%'
    : isOrder ? 'Приказ · черновик'
    : isMemo ? 'Служебная записка · черновик'
    : 'Письмо · черновик';
  const body = isApp
    ? `>> В государственную налоговую инспекцию\n>> от ${CO.name}\n>> ИНН ${CO.inn}\n\n# ЗАЯВЛЕНИЕ\n## о переходе на упрощённый порядок исчисления НДС\n\nПрошу применять упрощённый порядок исчисления НДС по ставке 6% в соответствии с УП-100, начиная с первого числа месяца, следующего за месяцем подачи.\n\nВид деятельности: производство и торговля хлебобулочными изделиями.\nОборот за ${CO.period}: ${fmt(C.sb)} сум без НДС.\n\nЧерновик Hisob AI — перед подачей сверить официальную форму и подписать ЭЦП.\n\nРуководитель ____________\n«___» __________ 20__`
    : `>> Кому: ________\n>> От кого: ${CO.name} · ИНН ${CO.inn}\n\n# ${title.replace(' · черновик', '')}\n\nТекст черновика (офлайн-режим). Уточните детали в чате при подключении AI — перепишу полностью.\n\nТема: ${s.slice(0, 120)}\n\nРуководитель ____________\n«___» __________ 20__`;
  return { title, kind, body };
}

// Offline fallback (no server / no key): keyword intents.
async function localAnswer(s) {
  if (/сегодня|bugun|план дня|3 действ|nima qil/.test(s)) return openDoc('today'), aiMsg('<p>План на сегодня на холсте: НДС, дебиторка, пакет к ЭЦП.</p>');
  if (/деньг|касс|банк|pul|cash|поток|оқим|kirim|chiqim/.test(s)) return openDoc('cashflow'), aiMsg(`<p>Пульс денег: приход <b>${fmt(FIN().inTotal)}</b>, расход <b>${fmt(FIN().outTotal)}</b>, остаток ≈ <b>${fmt(FIN().closing)}</b>.</p>`);
  if (/дебитор|должн|qarz|нам должны|kechik/.test(s)) return openDoc('ar'), aiMsg(`<p>Дебиторка <b>${fmt(FIN().arTotal)}</b>, просрочено <b>${fmt(FIN().arOverdue)}</b>.</p>`);
  if (/кредитор|мы должны|ijara|аренд|кредит|ssuda/.test(s)) return openDoc(/аренд|ijara/.test(s) ? 'rent' : /кредит|ssuda/.test(s) ? 'credit' : 'ap'), aiMsg('<p>Открыл обязательства на холсте.</p>');
  if (/возможност|imkon|оптимал|что выгод|qayerda.*tej/.test(s)) return openDoc('opps'), aiMsg('<p>Возможности на холсте: НДС 6%, дебиторка, кассовый разрыв.</p>');
  if (/прогноз|forecast|bashorat|prediction|trade.*прог|следующ.*(недел|месяц)|kelasi.*(hafta|oy)|xgboost/.test(s)) {
    openDoc('forecast');
    return window.FINANCE.ensure?.().then(() => {
      const F = FIN().forecast || {};
      aiMsg(`<p>XGBoost · ноябрь: приход <b>${fmt(F.nextMonthIn || 0)}</b> (${F.growthIn >= 0 ? '+' : ''}${F.growthIn || 0}% к октябрю), WAPE нед. ${F.wapeIn || 0}%. Категории: сырьё, коммунальные, налог, аренда…</p>`);
    }).catch(() => aiMsg('<p>Открыл прогноз. Модель ещё считается на сервере.</p>'));
  }
  if (/(созда|напиш|подготов|ёзиб|yoz|tayyorla).*(документ|hujjat|заявлен|приказ|письм|записк|ariza|buyruq)|(заявлен|приказ|письм|записк).*(созда|напиш|подготов)/.test(s)
    || /заявлен.*ндс|ariza.*qqs|упрощённ.*ндс/.test(s)) {
    const draft = localDraftDocument(s);
    await createDocument(draft);
    return aiMsg(`<p>Черновик «${esc(draft.title)}» на холсте. Можно скачать PDF/Word. Полный AI-текст — когда сервер онлайн.</p>`);
  }

  if (/эцп|ecp|отправ|soliq.*yubor|пакет/.test(s)) return openEcpPack();
  if (/ндс|qqs|расч[её]т|отч[её]т|hisobot|подготов|tayyorla|собер/.test(s)) return runReport();
  if (/риск|xavf/.test(s)) return aiMsg(reportDone ? `<p>Юрист выделил три риска: покупатели-компании (${C.b2b} из ${D.sales.length}) могут потерять зачёт НДС, оборот рядом с порогом ${mlrd(C.limit)}, и входной НДС ${mln(C.pv)} в месяц больше не зачитывается.</p>` : '<p>Сначала соберу расчёт — скажите «подготовь НДС за октябрь».</p>');
  if (/срок|muddat|когда|qachon/.test(s)) { document.querySelector('[data-tab="dates"]').click(); return aiMsg(`<p>Ближайшие сроки:</p><p>${DATES.slice(0, 3).map(d => `<b>${d.d} ${d.m}</b> — ${esc(d.t)}`).join('<br>')}</p>`); }
  if (/soliq|дидокс|didox|1[cс]|одинэс|подключ|ulanish|связ/.test(s)) { document.querySelector('[data-tab="links"]')?.click(); return aiMsg('<p>Открыл вкладку <b>Связи</b>: Soliq, 1С и Didox. Песочница работает сразу; для боя вставьте token или логин кабинета и нажмите «Синхронизировать».</p>'); }
  if (/сэконом|экономи|меньше|режим|tejash|ortiqcha|переплач/.test(s)) return aiMsg(reportDone ? `<p>Упрощённый НДС 6% вместо общего режима: минус <b>${mln(C.save)}</b> в месяц на НДС и налог на прибыль 0%.</p>` : '<p>Посчитаю на ваших данных — скажите «подготовь НДС за октябрь».</p>');
  if (/почему|откуда|nega|qayerdan/.test(s)) { setTool('ai'); return aiMsg('<p>Включил ИИ-курсор: кликните по цифре в отчёте.</p>'); }
  aiMsg('<p>Могу: НДС, документы (заявление/приказ/письмо), пульс денег, прогноз trade, дебиторка, пакет к ЭЦП, сроки.</p>');

}
const md = t => esc(t).split(/\n{2,}/).map(p => '<p>' + p.replace(/^#{1,6}\s*(.+)$/gm, '<b>$1</b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>') + '</p>').join('');
async function askBackend(voice = false) {
  // Everything the model may cite. Numbers outside this block are rejected by the server.
  const n = x => String(Math.round(x));
  const ctx = [
    `Компания: ${CO.name}, ИНН ${CO.inn}. Режим: ${CO.regime} (${CO.regimeSub}).`,
    `Период: ${CO.period}. Источник данных ЭСФ: ${CO.source || 'demo'} (${ { demo: 'демо-файл', soliq: 'my.soliq / выгрузка', didox: 'Didox', onedc: '1С' }[CO.source] || CO.source }). Реестры: ${D.sales.length} ЭСФ продаж и ${D.purchases.length} ЭСФ покупок.`,
    `Продажи без НДС: ${n(C.sb)} сум. НДС начислен (12%): ${n(C.sv)} сум. Оборот с НДС: ${n(C.gross)} сум.`,
    `Покупки без НДС: ${n(C.pb)} сум. НДС к зачёту: ${n(C.pv)} сум. Не в зачёт: ${C.nonded.length} ЭСФ (поставщик не плательщик НДС).`,
    `НДС к уплате на общем режиме: ${n(C.pay)} сум.`,
    `Упрощённый НДС по УП-100: ставка 6% со всего оборота, налог на прибыль 0%, входной НДС не зачитывается, действует до 01.01.2030. Сумма: ${n(C.simp)} сум. Экономия на НДС: ${n(C.save)} сум в месяц, ${n(C.save * 12)} сум в год.`,
    `Налог на прибыль на общем режиме: 15%. Сумма прибыли неизвестна (нужна детализация расходов сверх выписки).`,
    `Налог с оборота: недоступен, годовой оборот (октябрь × 12) ${n(C.annual)} сум выше порога 12000 БРВ = ${n(C.limit)} сум.`,
    `Покупатели-компании: ${C.b2b} из ${D.sales.length} ЭСФ продаж.`,
    ...window.FINANCE.contextLines({ pay: C.pay, simp: C.simp, save: C.save }),
    `Сроки: ${DATES.map(d => `${d.d} ${d.m} — ${d.t}`).join('; ')}.`,
    `Отчёт ${reportDone ? 'собран' : 'ещё не собран'}${approved ? ', Excel и заявление подготовлены' : ''}.`,
    `Документы в пространстве: ${DOCS.flatMap(g => g.items).map(x => x.nm).join(', ')}.`,
    `Сейчас на холсте открыт: ${currentDoc ? (DOCS.flatMap(g => g.items).find(x => x.id === currentDoc)?.nm || currentDoc) : 'стартовый экран'}.`,
    `Сегодня: ${new Date().toLocaleDateString('ru-RU')}.`,
    geoContext(),
    ...Object.values(SOCIAL).map(x => `Соцсеть ${x.platform} @${x.handle || x.url} (${x.title || ''}): подписчики ${x.followers ?? '—'}; ${x.stats ? `разобрано ${x.stats.posts_analyzed} постов, средние ${x.stats.metric} ${x.stats['avg_' + x.stats.metric]}, медиана ${x.stats['median_' + x.stats.metric]}, вовлечённость ${x.stats.engagement_pct}%, постов в неделю ${x.stats.posts_per_week}; лучший формат ${x.stats.by_type[0]?.key} (${x.stats.by_type[0]?.avg}); лучший день ${x.stats.by_weekday[0]?.key}` : 'только публичные счётчики'}${x.advice?.summary ? '; вывод маркетолога: ' + x.advice.summary : ''}`),
    `Неизвестно (не называть цифры): рыночные цены, расходы на внешнего бухгалтера, прибыль после всех затрат, данные других компаний. ФИО руководителя, адрес, банковские реквизиты, список сотрудников — неизвестны.`,
    `Зарплатный фонд за октябрь (аванс из банка): 28000000 сум — это факт из банковской выписки, полный ФОТ за месяц может быть выше.`,
    ...(Object.keys(CREATED).length ? ['Созданные документы (id, название, текст):', ...Object.entries(CREATED).slice(-10).map(([k, v]) => `[${k}] ${v.title}:\n${v.md.slice(0, 1500)}`)] : []),
  ].join('\n');
  const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ctx, voice, tg: TG_MODE, docs: DOCS.flatMap(g => g.items).map(({ id, nm }) => ({ id, nm })), messages: chatHist.slice(-10) }) });
  if (!r.ok) return null;
  return await r.json();
}

$('#composer').addEventListener('submit', e => { e.preventDefault(); const t = $('#chatInput').value; $('#chatInput').value = ''; handleText(t); });
$('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
$('#startForm').addEventListener('submit', e => { e.preventDefault(); handleText($('#startInput').value || $('#startInput').placeholder); });
$('#startInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#startForm').requestSubmit(); } });
const CHIPS = ['Подготовь НДС и найди, где переплачиваю', 'Напиши заявление на упрощённый НДС 6%', 'Покажи пульс денег и долги', 'Сегодня: 3 действия', 'Пакет к ЭЦП'];
$('#startChips').innerHTML = CHIPS.map(c => `<button class="chip">${esc(c)}</button>`).join('');
$('#startChips').querySelectorAll('button').forEach(b => b.onclick = () => handleText(b.textContent));

// ---------- voice ----------
let lang = 'uz-UZ', rec = null;
const DEMO_PHRASE = { 'uz-UZ': "Oktabr oyi uchun QQS hisobotini tayyorla va qayerda ortiqcha soliq to'layotganimni ko'rsat", 'ru-RU': 'Подготовь расчёт НДС за октябрь и покажи, где я переплачиваю' };
$('#langLbl').addEventListener('click', e => { e.stopPropagation(); lang = lang === 'uz-UZ' ? 'ru-RU' : 'uz-UZ'; $('#langLbl').textContent = lang === 'uz-UZ' ? 'UZ' : 'RU'; });
function listenUI(on, txt = 'Слушаю…') {
  $('#listening').hidden = !on; $('#listenTxt').textContent = txt;
  $('#composer').classList.toggle('rec', on); $('#micBtn').classList.toggle('on', on); $('#micTool').classList.toggle('rec', on);
}
async function fakeVoice() {
  // No Web Speech in this browser: show the phrase as if it was recognized, so the demo never breaks on stage.
  listenUI(true); const p = DEMO_PHRASE[lang];
  for (let i = 0; i <= p.length; i += 3) { $('#listenTxt').textContent = p.slice(0, i) || 'Слушаю…'; await sleep(40); }
  await sleep(300); listenUI(false); handleText(p, true);
}
let mediaRec = null;
async function recordVoice() {
  if (mediaRec) { mediaRec.stop(); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return toast('Нет доступа к микрофону: разрешите его в настройках Telegram', 'mic'); }
  const chunks = [];
  mediaRec = new MediaRecorder(stream);
  mediaRec.ondataavailable = e => e.data.size && chunks.push(e.data);
  mediaRec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop()); mediaRec = null;
    listenUI(true, 'Распознаю…');
    const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
    const r = await fetch('/api/stt?lang=' + lang.slice(0, 2), { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }).then(x => x.json()).catch(() => ({ error: 'сервер недоступен' }));
    listenUI(false);
    if (r.text?.trim()) handleText(r.text.trim(), true); else toast(r.error || 'Не расслышал, попробуйте ещё раз', 'mic');
  };
  mediaRec.start(); listenUI(true, 'Говорите… нажмите микрофон ещё раз, чтобы отправить'); TGW?.HapticFeedback?.impactOccurred('light');
}
function startVoice() {
  if (busy) return;
  $('#chat').classList.add('open');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return TG_MODE ? recordVoice() : fakeVoice();
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = lang; rec.interimResults = true; rec.maxAlternatives = 1;
  let final = '', failed = false;
  rec.onresult = e => { final = [...e.results].map(r => r[0].transcript).join(' '); $('#listenTxt').textContent = final; };
  rec.onerror = () => { failed = true; };
  rec.onend = () => { rec = null; listenUI(false); if (final.trim()) handleText(final, true); else if (failed) (TG_MODE ? recordVoice() : fakeVoice()); };
  listenUI(true); rec.start();
}
$('#micBtn').onclick = startVoice; $('#micTool').onclick = startVoice; $('#startMic').onclick = startVoice;
$('#ttsBtn').onclick = () => { ttsOn = !ttsOn; $('#ttsBtn').classList.toggle('btn-primary', ttsOn); $('#ttsBtn').classList.toggle('btn-ghost', !ttsOn); toast(ttsOn ? 'Ответы будут озвучиваться' : 'Озвучка выключена', 'volume'); };

// ---------- upload + Soliq/1C/Didox ----------
const INT_LABEL = { soliq: 'Soliq', didox: 'Didox', onedc: '1С' };
let intState = null;

async function apiJSON(url, opts) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

function setSourcePill(st) {
  const src = st?.activeSource;
  const prov = (st?.providers || []).find(p => p.id === src)?.connection;
  const real = src && src !== 'demo' && prov?.mode === 'live' && prov?.hasSecret;
  const sand = src && src !== 'demo' && !real;
  $('#srcPill')?.classList.toggle('live', !!real);
  const n = st?.live ? `${st.live.sales}/${st.live.purchases} ЭСФ` : '';
  $('#srcTxt').textContent = real
    ? `Источник: ${INT_LABEL[src]} (боевой) · ${n}`
    : sand
      ? `Источник: ${INT_LABEL[src] || src} · песочница · ${n}`
      : 'Источник: демо-данные';
}

function renderIntegrations(st) {
  intState = st;
  setSourcePill(st);
  const box = $('#intList'); if (!box) return;
  box.innerHTML = (st.providers || []).map(p => {
    const c = p.connection || {};
    const live = c.status === 'connected' && c.mode === 'live' && c.hasSecret;
    const sand = c.status === 'connected' && !live;
    const stCls = live ? 'on' : sand ? 'sand' : c.status === 'error' ? 'err' : '';
    const stTxt = live ? 'боевой' : sand ? 'песочница' : c.status === 'error' ? 'ошибка' : 'нет связи';
    const fields = (p.fields || []).map(f => `<label>${esc(f.label)}<input data-f="${esc(f.key)}" type="${f.secret ? 'password' : 'text'}" placeholder="${esc(f.placeholder || '')}" value="${f.secret ? '' : esc(c[f.key] || '')}" autocomplete="off"></label>`).join('');
    const hint = c.lastError
      ? esc(c.lastError)
      : live
        ? `Боевой API · синхр. ${c.lastSync ? new Date(c.lastSync).toLocaleString('ru-RU') : '—'}`
        : sand
          ? `Песочница (не Didox/Soliq/1С кабинет). Синхр. ${c.lastSync ? new Date(c.lastSync).toLocaleString('ru-RU') : '—'}`
          : 'Песочница — сразу. Боевой — нужен token/логин кабинета.';
    return `<div class="int" data-id="${p.id}">
      <div class="int-h"><span class="badge ${p.id}">${esc(p.name).slice(0, 2).toUpperCase()}</span><div class="meta"><b>${esc(p.title)}</b><span>${esc(p.blurb)}</span></div><span class="int-st ${stCls}">${stTxt}</span></div>
      <div class="int-mode"><button type="button" data-mode="sandbox" class="${(c.mode || 'sandbox') !== 'live' ? 'on' : ''}">Песочница</button><button type="button" data-mode="live" class="${c.mode === 'live' ? 'on' : ''}">Боевой API</button></div>
      <div class="int-fields">${fields}</div>
      <div class="int-actions">
        <button type="button" class="btn btn-primary btn-sm" data-act="sync">Синхр. ЭСФ</button>
        <div class="row">
          <button type="button" class="btn btn-outline btn-sm" data-act="toggle">Настроить</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="disconnect" ${c.status === 'connected' ? '' : 'hidden'}>Отключить</button>
        </div>
      </div>
      <div class="int-msg ${c.lastError ? 'err' : sand ? '' : live ? 'ok' : ''}">${hint}</div>
    </div>`;
  }).join('');
}

async function refreshIntegrations() {
  try { renderIntegrations(await apiJSON('/api/integrations')); } catch (e) { console.warn(e); }
}

function intPayload(card) {
  const mode = card.querySelector('.int-mode button.on')?.dataset.mode || 'sandbox';
  const body = { mode };
  card.querySelectorAll('[data-f]').forEach(inp => { if (inp.value) body[inp.dataset.f] = inp.value; });
  return body;
}

$('#intList')?.addEventListener('click', async e => {
  const card = e.target.closest('.int'); if (!card) return;
  const id = card.dataset.id;
  const modeBtn = e.target.closest('[data-mode]');
  if (modeBtn) {
    card.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b === modeBtn));
    card.classList.toggle('open', modeBtn.dataset.mode === 'live');
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
  const msg = card.querySelector('.int-msg');
  try {
    if (act === 'toggle') { card.classList.toggle('open'); return; }
    if (act === 'disconnect') {
      renderIntegrations(await apiJSON(`/api/integrations/${id}/disconnect`, { method: 'POST', body: '{}' }));
      const books = (await apiJSON('/api/integrations/data')).books;
      applyBooks(books); toast('Отключено: ' + (INT_LABEL[id] || id), 'link'); return;
    }
    if (act === 'sync') {
      msg.textContent = 'Подключаю и синхронизирую…'; msg.className = 'int-msg';
      const body = intPayload(card);
      await apiJSON(`/api/integrations/${id}/connect`, { method: 'POST', body: JSON.stringify(body) });
      const out = await apiJSON(`/api/integrations/${id}/sync`, { method: 'POST', body: JSON.stringify({ period: CO.period }) });
      applyBooks(out.books);
      await refreshIntegrations();
      addDoc('Данные', { id: 'esf-s', nm: 'ЭСФ · продажи', tag: String(D.sales.length), ic: 'file' });
      addDoc('Данные', { id: 'esf-p', nm: 'ЭСФ · покупки', tag: String(D.purchases.length), ic: 'file' });
      toast(`${INT_LABEL[id] || id}: ${out.data.sales} продаж, ${out.data.purchases} покупок`, 'check');
      logMsg('b', `синхронизировал ЭСФ из ${INT_LABEL[id] || id}`);
      aiMsg(`<p>Подтянул ЭСФ из <b>${INT_LABEL[id] || id}</b>: ${out.data.sales} продаж и ${out.data.purchases} покупок. Могу сразу собрать расчёт НДС.</p>`);
      return;
    }
  } catch (err) {
    msg.textContent = err.message; msg.className = 'int-msg err';
    toast(err.message, 'alert');
  }
});

function sheetToInvoices(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const sales = [], purchases = [];
  const pick = (r, keys) => { for (const k of keys) { const hit = Object.keys(r).find(x => x.toLowerCase().replace(/\s/g, '') === k.toLowerCase().replace(/\s/g, '')); if (hit != null && r[hit] !== '') return r[hit]; } return ''; };
  for (const r of rows) {
    const kind = String(pick(r, ['type', 'вид', 'тип', 'направление']) || '');
    const row = {
      name: pick(r, ['name', 'контрагент', 'покупатель', 'поставщик', 'наименование']),
      inn: pick(r, ['inn', 'инн', 'stir']),
      num: pick(r, ['num', 'номер', '№', 'esf', 'эсф']),
      date: pick(r, ['date', 'дата']),
      base: pick(r, ['base', 'без ндс', 'сумма без ндс', 'deliverySum']),
      vat: pick(r, ['vat', 'ндс', 'сумма ндс']),
      note: pick(r, ['note', 'зачёт', 'примечание']),
    };
    const asPurchase = /покуп|purchase|in|вход/i.test(kind) || /поставщик/i.test(String(Object.keys(r).join(' ')));
    (asPurchase ? purchases : sales).push(row);
  }
  // if all went to sales but file looks like purchases registry
  if (!purchases.length && /покуп|purchase/i.test(wb.SheetNames[0])) return { sales: [], purchases: sales };
  return { sales, purchases };
}

async function ingestEsfFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'json') {
    const text = await file.text();
    const body = JSON.parse(text);
    const out = await apiJSON('/api/integrations/import', { method: 'POST', body: JSON.stringify(body) });
    applyBooks(out.books); await refreshIntegrations();
    return out;
  }
  if (ext === 'csv') {
    const csv = await file.text();
    const out = await apiJSON('/api/integrations/import', { method: 'POST', body: JSON.stringify({ csv, source: 'soliq' }) });
    applyBooks(out.books); await refreshIntegrations();
    return out;
  }
  if (/xlsx|xls/i.test(ext) && window.XLSX) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const parsed = sheetToInvoices(wb);
    if (!parsed.sales.length && !parsed.purchases.length) throw new Error('В Excel не нашёл колонки ЭСФ (контрагент, сумма, НДС)');
    const out = await apiJSON('/api/integrations/import', { method: 'POST', body: JSON.stringify({ ...parsed, source: 'soliq', period: CO.period }) });
    applyBooks(out.books); await refreshIntegrations();
    return out;
  }
  return null;
}

async function addFiles(files) {
  for (const f of [...files]) {
    addDoc('Загружено', { id: 'up-' + crypto.randomUUID(), nm: f.name, tag: (f.name.split('.').pop() || '').toUpperCase().slice(0, 4), ic: /xls|csv|json/i.test(f.name) ? 'sheet' : 'file' });
    try {
      const out = await ingestEsfFile(f);
      if (out) {
        logMsg('b', `загрузил ЭСФ из «${f.name}»: ${out.data.sales} / ${out.data.purchases}`);
        toast(`ЭСФ из файла: ${out.data.sales} продаж, ${out.data.purchases} покупок`, 'check');
        document.querySelector('[data-tab="links"]')?.click();
      } else logMsg('b', `прочитал «${f.name}», положил в Документы`);
    } catch (e) {
      logMsg('b', `«${f.name}»: ${e.message}`);
      toast(e.message, 'alert');
    }
  }
}
$('#file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('#uploadTool').onclick = () => $('#file').click();
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
refreshIntegrations().then(async () => {
  try {
    const { books } = await apiJSON('/api/integrations/data');
    if (books?.source && books.source !== 'demo') applyBooks(books);
  } catch { /* first run */ }
});

// ---------- misc ----------
$('#tree').addEventListener('click', e => { const n = e.target.closest('[data-doc]'); if (n && !busy) openDoc(n.dataset.doc); });
document.querySelectorAll('.lp-tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.lp-tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.lp-body').forEach(p => (p.hidden = p.dataset.pane !== b.dataset.tab));
});
$('#resetBtn').onclick = () => location.reload();
$('#chatToggle').onclick = () => $('#chat').classList.toggle('open');
$('#chatClose').onclick = () => $('#chat').classList.remove('open');
addEventListener('keydown', e => {
  if (e.target.closest('textarea,input')) return;
  if (e.key === 'a' || e.key === 'ф') setTool('ai');
  else if (e.key === 'v' || e.key === 'м') setTool('select');
  else if (e.key === 'm' || e.key === 'ь') startVoice();
  else if (e.key === 'Escape') { closePop(); if (targets.length) clearTargets(); else setTool('select'); }
});

let docsVer = -1;
async function syncDocs(first = false) {
  try {
    const r = await fetch('/api/docs?since=' + docsVer).then(x => x.json());
    if (r.unchanged) return; docsVer = r.version;
    for (const d of r.docs) {
      const was = CREATED[d.id];
      if (was && was.md === d.md && was.title === d.title) continue;
      CREATED[d.id] = { title: d.title, kind: d.kind, md: d.md };
      if (!was && !first) logMsg(d.source === 'tg' ? 'm' : 'm', `новый документ «${d.title}»${d.source === 'tg' ? ' из Telegram' : ' с компьютера'}`);
      const g = DOCS.find(x => x.g === 'Созданные'), item = { id: d.id, nm: d.title, tag: d.kind, cls: 'new', ic: 'file' };
      if (first) { if (g) g.items.unshift(item); else DOCS.splice(1, 0, { g: 'Созданные', items: [item] }); } else addDoc('Созданные', item);
      if (currentDoc === d.id && !busy) openDoc(d.id);
    }
    renderTree();
  } catch {}
}
syncDocs(true); setInterval(() => { if (!busy) syncDocs(); }, 4000);

// ---- Telegram Mini App shell ----
function sheet(on) { if (!TG_MODE) return; document.body.classList.toggle('sheet', on); if (on) TGW?.BackButton?.show(); else { TGW?.BackButton?.hide(); closePop(); } }
if (TG_MODE) {
  document.body.classList.add('tg');
  TGW?.ready(); TGW?.expand(); TGW?.setHeaderColor?.('#ffffff'); TGW?.BackButton?.onClick(() => sheet(false));
  const x = document.createElement('button'); x.className = 'sheet-x btn btn-primary btn-sm'; x.innerHTML = icon('x', 'sm') + 'Закрыть'; x.onclick = () => sheet(false);
  $('#canvas').append(x);
}
welcome();
parkCursors();


// =====================================================================
// GEO MODEL: where the business is, 2D/3D map, foot-traffic index
// =====================================================================
let geoMap = null, geoMarker = null;
const GEO = { lat: null, lon: null, address: '', type: 'bakery', mode: '3d', analysis: null, picking: false };
const BIZ = {
  bakery:     { nm: 'Пекарня, кондитерская', need: true,  why: 'покупатели приходят с улицы' },
  retail:     { nm: 'Магазин, торговля',     need: true,  why: 'выручка зависит от проходящих людей' },
  horeca:     { nm: 'Кафе, ресторан, фастфуд', need: true, why: 'гости приходят с улицы' },
  beauty:     { nm: 'Салон, барбершоп, клиника', need: true, why: 'часть клиентов приходит без записи' },
  pharmacy:   { nm: 'Аптека',                need: true,  why: 'покупки по пути' },
  education:  { nm: 'Учебный центр',         need: true,  why: 'видимость для родителей и учеников рядом' },
  auto:       { nm: 'Автосервис, мойка',     need: false, why: 'важен автомобильный, а не пешеходный трафик' },
  office:     { nm: 'Офис, IT, консалтинг',  need: false, why: 'клиенты не приходят с улицы' },
  production: { nm: 'Производство, склад',   need: false, why: 'клиенты не приходят с улицы' },
  online:     { nm: 'Онлайн-магазин',        need: false, why: 'продажи идут через интернет' },
};
// OpenMapTiles POI classes -> categories that attract people. Weights are the model's assumptions, shown in the UI.
const CATS = [
  { k: 'transit',   nm: 'Остановки, метро',  w: 6,   cls: ['bus', 'railway', 'aerialway'], color: '#2563eb' },
  { k: 'market',    nm: 'Рынки',             w: 8,   cls: ['marketplace'], color: '#dc2626' },
  { k: 'edu',       nm: 'Школы, вузы, сады', w: 4,   cls: ['school', 'college', 'kindergarten', 'university', 'library'], color: '#7c3aed' },
  { k: 'health',    nm: 'Медицина, аптеки',  w: 3,   cls: ['hospital', 'pharmacy', 'doctors', 'dentist', 'clinic'], color: '#059669' },
  { k: 'food',      nm: 'Кафе, рестораны',   w: 2,   cls: ['fast_food', 'cafe', 'restaurant', 'bar', 'beer', 'ice_cream'], color: '#f59e0b' },
  { k: 'shop',      nm: 'Магазины',          w: 2,   cls: ['shop', 'grocery', 'clothing_store', 'alcohol_shop', 'bakery', 'butcher', 'jewelry', 'mobile_phone', 'furniture', 'shoes', 'gift', 'books', 'hardware', 'electronics', 'florist', 'optician', 'beauty', 'hairdresser', 'convenience', 'supermarket', 'department_store', 'mall', 'laundry'], color: '#ff2e88' },
  { k: 'finance',   nm: 'Банки, банкоматы',  w: 1,   cls: ['bank', 'atm'], color: '#0891b2' },
  { k: 'attract',   nm: 'Парки, мечети, ТЦ, культура', w: 3, cls: ['attraction', 'theatre', 'cinema', 'stadium', 'park', 'place_of_worship', 'town_hall', 'museum', 'art_gallery'], color: '#65a30d' },
];
const RADIUS = 300;

function renderGeo() {
  currentDoc = 'geo'; ensureTab('geo'); renderTree(); showStart(false);
  page.innerHTML = `<div class="doc geo">
    <div class="doc-h"><div><h1>Где находится ваше предприятие</h1><p>${CO.name} · кликните на карте или найдите адрес</p></div>
      <div class="seg" id="mapMode"><button data-m="2d">2D</button><button data-m="3d">3D</button></div></div>
    <div class="geo-bar">
      <form id="geoSearch" class="geo-search">${icon('search', 'sm')}<input id="geoQ" placeholder="Адрес или ориентир: Чиланзар 9 квартал, рынок Алайский…" autocomplete="off"><button class="btn btn-primary btn-sm">Найти</button></form>
      <select id="geoType">${Object.entries(BIZ).map(([k, v]) => `<option value="${k}" ${k === GEO.type ? 'selected' : ''}>${v.nm}</option>`).join('')}</select>
    </div>
    <div class="geo-results" id="geoResults" hidden></div>
    <div class="map-wrap"><div id="map"></div><div class="map-hint" id="mapHint">${icon('target', 'sm')}Кликните на карте, где находится предприятие</div></div>
    <div class="bld" id="bldPanel"></div>
    <div class="geo-panel" id="geoPanel"></div>
  </div>`;
  canvas.scrollTop = 0;
  if (!window.maplibregl) { $('#geoPanel').innerHTML = '<p class="muted">Карта не загрузилась: нет доступа к интернету.</p>'; return; }
  geoMap = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty', center: GEO.lat ? [GEO.lon, GEO.lat] : [69.2797, 41.3111], zoom: GEO.lat ? 16 : 12, pitch: GEO.mode === '3d' ? 55 : 0, bearing: GEO.mode === '3d' ? -18 : 0, attributionControl: { compact: true } });
  geoMap.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  geoMap.on('load', () => {
    ensure3d(); setMapMode(GEO.mode, true);
    geoMap.addSource('radius', { type: 'geojson', data: emptyFC() });
    geoMap.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#ff2e88', 'fill-opacity': 0.08 } });
    geoMap.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#ff2e88', 'line-width': 2, 'line-dasharray': [2, 2] } });
    geoMap.addSource('pois', { type: 'geojson', data: emptyFC() });
    geoMap.addLayer({ id: 'pois', type: 'circle', source: 'pois', paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    geoMap.addSource('floors', { type: 'geojson', data: emptyFC() });
    geoMap.addLayer({ id: 'floors', type: 'fill-extrusion', source: 'floors', paint: { 'fill-extrusion-color': ['match', ['get', 'state'], 'sel', '#ff2e88', 'hov', '#ffb3d1', '#d9d9df'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-opacity': 0.93 } });
    geoMap.addSource('unit', { type: 'geojson', data: emptyFC() });
    geoMap.addLayer({ id: 'unit', type: 'fill-extrusion', source: 'unit', paint: { 'fill-extrusion-color': '#ff2e88', 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-opacity': 0.95 } });
    GEO.baseFilter = GEO.layer3d ? geoMap.getFilter(GEO.layer3d) : null;
    GEO.baseOpacity = GEO.layer3d ? (geoMap.getPaintProperty(GEO.layer3d, 'fill-extrusion-opacity') ?? 1) : 1;
    geoMap.on('mousemove', 'floors', e => { const l = e.features[0]?.properties.level; geoMap.getCanvas().style.cursor = 'pointer'; if (l !== floorHover) { floorHover = l; drawBuilding(); } });
    geoMap.on('mouseleave', 'floors', () => { floorHover = null; geoMap.getCanvas().style.cursor = ''; drawBuilding(); });
    if (GEO.lat) { placeMarker(); drawAnalysis(); }
    drawBuilding(); renderBuilding();
  });
  geoMap.on('click', onMapClick);
  $('#mapMode').querySelectorAll('button').forEach(b => b.onclick = () => { GEO.mode = b.dataset.m; setMapMode(GEO.mode); });
  $('#geoType').onchange = e => { GEO.type = e.target.value; if (GEO.lat) analyzeTraffic(); else renderGeoPanel(); };
  $('#geoSearch').onsubmit = async e => { e.preventDefault(); await searchAddress($('#geoQ').value); };
  renderGeoPanel();
}
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
function ensure3d() {
  const has = geoMap.getStyle().layers.find(l => l.type === 'fill-extrusion');
  if (has) { GEO.layer3d = has.id; return; }
  const src = Object.keys(geoMap.getStyle().sources).find(k => geoMap.getStyle().sources[k].type === 'vector');
  geoMap.addLayer({ id: 'hisob-3d', type: 'fill-extrusion', source: src, 'source-layer': 'building', minzoom: 14, paint: { 'fill-extrusion-color': '#d9d9de', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.85 } });
  GEO.layer3d = 'hisob-3d';
}
function setMapMode(mode, instant = false) {
  GEO.mode = mode;
  document.querySelectorAll('#mapMode button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  if (!geoMap || !geoMap.isStyleLoaded()) return;
  if (GEO.layer3d) geoMap.setLayoutProperty(GEO.layer3d, 'visibility', mode === '3d' ? 'visible' : 'none');
  geoMap.easeTo({ pitch: mode === '3d' ? 55 : 0, bearing: mode === '3d' ? -18 : 0, duration: instant ? 0 : 900 });
}
async function searchAddress(q) {
  q = String(q || '').trim(); if (!q) return;
  const box = $('#geoResults'); box.hidden = false; box.innerHTML = '<div class="muted">Ищу…</div>';
  const r = await fetch('/api/geo/search?q=' + encodeURIComponent(q)).then(x => x.json()).catch(() => ({ results: [] }));
  if (!r.results.length) { box.innerHTML = '<div class="muted">Не нашёл. Кликните на карте, где находится предприятие.</div>'; return; }
  box.innerHTML = r.results.map((x, i) => `<button data-i="${i}">${icon('target', 'sm')}<span>${esc(x.name)}</span></button>`).join('');
  box.querySelectorAll('button').forEach(b => b.onclick = () => { const x = r.results[+b.dataset.i]; box.hidden = true; setPoint(x.lat, x.lon, x.name); });
}
function placeMarker() {
  if (!geoMap) return;
  if (!geoMarker) {
    const el = document.createElement('div'); el.className = 'geo-pin'; el.innerHTML = `<span>${icon('home', 'sm')}</span>`;
    geoMarker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' });
    geoMarker.on('dragend', () => { const p = geoMarker.getLngLat(); setPoint(p.lat, p.lng, ''); });
  }
  geoMarker.setLngLat([GEO.lon, GEO.lat]).addTo(geoMap);
  $('#mapHint')?.classList.add('off');
}
async function setPoint(lat, lon, address, opts = {}) {
  const same = GEO.lat && distM(GEO.lat, GEO.lon, +lat, +lon) < 30; // same point: keep the found address
  GEO.address = address || (same ? GEO.address : ''); GEO.lat = +lat; GEO.lon = +lon; GEO.analysis = null;
  if (GEO.building && !insideBuilding(GEO.lon, GEO.lat)) clearBuilding();
  if (!geoMap) return;
  if (geoMarker) geoMarker.remove(), geoMarker = null;
  placeMarker();
  if (opts.fly !== false) geoMap.flyTo({ center: [GEO.lon, GEO.lat], zoom: 16.3, pitch: GEO.mode === '3d' ? 55 : 0, bearing: GEO.mode === '3d' ? -18 : 0, duration: 1400 });
  if (!GEO.address) reverseLabel();
  await analyzeTraffic();
  if (opts.building !== false && !GEO.building) { await waitIdle(); await selectBuildingAt(GEO.lon, GEO.lat); }
}
function reverseLabel() { GEO.address = `${GEO.lat.toFixed(5)}, ${GEO.lon.toFixed(5)}`; }
const distM = (a, b, c, d) => { const R = 6371000, r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return Math.sqrt(x * x + y * y) * R; };
function circle(lat, lon, m) { const pts = []; for (let i = 0; i <= 64; i++) { const t = i / 64 * 2 * Math.PI; pts.push([lon + m / (111320 * Math.cos(lat * Math.PI / 180)) * Math.cos(t), lat + m / 110540 * Math.sin(t)]); } return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} }] }; }
const waitIdle = () => new Promise(r => { if (geoMap.loaded() && !geoMap.isMoving()) setTimeout(r, 300); else geoMap.once('idle', () => r()); });

async function analyzeTraffic() {
  const biz = BIZ[GEO.type] || BIZ.retail;
  renderGeoPanel(true);
  if (!biz.need) { GEO.analysis = { need: false }; drawAnalysis(); renderGeoPanel(); geoReport(); return; }
  if (!geoMap) return;
  setStatus('Аналитик считает трафик', true); agentBusy('a', true);
  await new Promise(r => setTimeout(r, 1500)); await waitIdle();
  const src = Object.keys(geoMap.getStyle().sources).find(k => geoMap.getStyle().sources[k].type === 'vector');
  const seen = new Set(), found = [];
  for (const f of geoMap.querySourceFeatures(src, { sourceLayer: 'poi' })) {
    if (f.geometry.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates, key = (f.properties.name || '') + lon.toFixed(5) + lat.toFixed(5);
    if (seen.has(key)) continue; seen.add(key);
    const d = distM(GEO.lat, GEO.lon, lat, lon); if (d > RADIUS) continue;
    const cls = f.properties.subclass === 'marketplace' ? 'marketplace' : f.properties.class;
    const cat = CATS.find(c => c.cls.includes(cls)) || CATS.find(c => c.cls.includes(f.properties.subclass));
    found.push({ lat, lon, d: Math.round(d), name: f.properties.name || '', cat: cat ? cat.k : 'other' });
  }
  const counts = Object.fromEntries(CATS.map(c => [c.k, found.filter(x => x.cat === c.k).length]));
  const other = found.filter(x => x.cat === 'other').length;
  const score = CATS.reduce((s, c) => s + counts[c.k] * c.w, 0) + other * 0.3;
  const index = Math.round(100 * (1 - Math.exp(-score / 100))); // ~80 at a big bazaar, ~20 on a quiet street
  GEO.analysis = { need: true, index, level: index >= 60 ? 'высокий' : index >= 30 ? 'средний' : 'низкий', counts, other, total: found.length, points: found, nearestTransit: found.filter(x => x.cat === 'transit').sort((a, b) => a.d - b.d)[0] || null };
  agentBusy('a', false); setStatus('Геомодель готова');
  drawAnalysis(); renderGeoPanel(); geoReport();
}
function drawAnalysis() {
  if (!geoMap || !geoMap.getSource('radius')) return;
  const a = GEO.analysis;
  geoMap.getSource('radius').setData(GEO.lat && a?.need ? circle(GEO.lat, GEO.lon, RADIUS) : emptyFC());
  geoMap.getSource('pois').setData({ type: 'FeatureCollection', features: (a?.points || []).map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { color: (CATS.find(c => c.k === p.cat) || { color: '#a1a1aa' }).color } })) });
}
function renderGeoPanel(loading = false) {
  const el = $('#geoPanel'); if (!el) return;
  const biz = BIZ[GEO.type] || BIZ.retail, a = GEO.analysis;
  if (!GEO.lat) { el.innerHTML = `<div class="geo-empty">${icon('target')}<div><b>Точка не выбрана</b><span>Найдите адрес или кликните на карте. Тип бизнеса: ${esc(biz.nm)} — трафик ${biz.need ? 'будет посчитан' : 'не нужен'}.</span></div></div>`; return; }
  const head = `<div class="geo-addr">${icon('home', 'sm')}<span><b>${esc(GEO.address)}</b><small>${esc(biz.nm)}</small></span></div>`;
  if (loading) { el.innerHTML = head + '<div class="sk-line" style="width:70%"></div><div class="sk-line" style="width:45%"></div>'; return; }
  if (!a || !a.need) { el.innerHTML = head + `<div class="geo-skip">${icon('check', 'sm')}<span>Пешеходный трафик для этого типа бизнеса не считаем: ${esc(biz.why)}.</span></div>`; return; }
  const max = Math.max(1, ...CATS.map(c => a.counts[c.k]));
  el.innerHTML = head + `<div class="geo-grid">
      <div class="geo-index ${a.level === 'высокий' ? 'hi' : a.level === 'средний' ? 'mid' : 'lo'}"><span>Индекс проходимости</span><b>${a.index}</b><small>из 100 · ${a.level}</small></div>
      <div class="geo-cats">${CATS.map(c => `<div class="gc"><i style="background:${c.color}"></i><span>${c.nm}</span><em><u style="width:${a.counts[c.k] / max * 100}%;background:${c.color}"></u></em><b>${a.counts[c.k]}</b></div>`).join('')}</div>
    </div>
    <p class="geo-note">${icon('alert', 'sm')}<span>Это оценка, а не подсчёт людей: ${a.total} точек притяжения из OpenStreetMap в радиусе ${RADIUS} м, взвешенных по типу (остановка ×6, рынок ×8, школа ×4…). ${a.nearestTransit ? `Ближайшая остановка — ${a.nearestTransit.d} м.` : 'Остановок в радиусе нет.'} ${a.total < 5 ? 'Данных OSM вокруг мало, индекс может быть занижен.' : ''}</span></p>${floorNote() ? `<p class="geo-floor">${icon('layers', 'sm')}<span>${floorNote()}</span></p>` : ''}`;
}
function geoReport() {
  const biz = BIZ[GEO.type] || BIZ.retail, a = GEO.analysis;
  if (!a) return;
  if (!a.need) { logMsg('a', `геомодель: точка на карте; трафик не нужен — ${biz.why}`); return; }
  logMsg('a', `геомодель: индекс проходимости ${a.index}/100 (${a.level}), ${a.total} точек притяжения в ${RADIUS} м`);
}
function geoContext() {
  if (!GEO.lat) return 'Геомодель: адрес предприятия не указан.';
  const biz = BIZ[GEO.type] || BIZ.retail, a = GEO.analysis;
  let t = `Геомодель: предприятие на карте — ${GEO.address} (${GEO.lat.toFixed(5)}, ${GEO.lon.toFixed(5)}), тип: ${biz.nm}. `;
  if (!a) return t + buildingContext() + 'Трафик ещё считается.';
  t += buildingContext();
  if (!a.need) return t + `Пешеходный трафик не нужен: ${biz.why}.`;
  return t + `Индекс проходимости ${a.index} из 100 (${a.level}) — оценка по ${a.total} точкам OSM в радиусе ${RADIUS} м, не число людей. ` + CATS.map(c => `${c.nm}: ${a.counts[c.k]}`).join(', ') + (a.nearestTransit ? `. Ближайшая остановка ${a.nearestTransit.d} м.` : '. Остановок рядом нет.');
}
async function showGeo(a = {}) {
  if (a.business_type && BIZ[a.business_type]) GEO.type = a.business_type;
  if (currentDoc !== 'geo') openDoc('geo');
  if (Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
    const go = () => setPoint(a.lat, a.lon, a.address || '');
    geoMap && geoMap.loaded() ? go() : geoMap?.once('load', go);
  } else {
    if (a.query) { $('#geoQ').value = a.query; searchAddress(a.query); }
    toast('Кликните на карте, где находится предприятие', 'target');
  }
}

// =====================================================================
// SOCIAL: what the marketer read with Playwright
// =====================================================================
const nf = n => n == null ? '—' : Math.round(n).toLocaleString('ru-RU');
const TYPE_COLOR = { фото: '#ff2e88', видео: '#2563eb', альбом: '#7c3aed', текст: '#71717a', медиа: '#a1a1aa', опрос: '#f59e0b', файл: '#059669', голос: '#0891b2', reels: '#2563eb', карусель: '#7c3aed' };
function socialHtml(id) {
  const x = SOCIAL[id], st = x.stats, m = st?.metric || 'views';
  const mName = { views: 'просмотры', reach: 'охват', likes: 'лайки' }[m] || m;
  const rKey = x.platform === 'instagram' ? 'interactions' : 'reactions';
  const posts = x.posts || [];
  const kpi = st ? `<div class="kpis">
      <div class="kpi"><span>Подписчики</span><b>${nf(x.followers)}</b></div>
      <div class="kpi"><span>Постов разобрано</span><b>${st.posts_analyzed}</b><small>${st.period ? esc(st.period.from.slice(5, 10) + ' — ' + st.period.to.slice(5, 10)) : ''}</small></div>
      <div class="kpi"><span>Средние ${mName}</span><b>${nf(st['avg_' + m])}</b><small>медиана ${nf(st['median_' + m])}</small></div>
      <div class="kpi"><span>Вовлечённость</span><b>${st.engagement_pct ?? '—'}%</b><small>реакции к ${mName}</small></div>
      <div class="kpi"><span>Охват подписчиков</span><b>${st.reach_pct_of_followers ?? '—'}%</b><small>${mName} / подписчики</small></div>
      <div class="kpi"><span>Частота</span><b>${st.posts_per_week ?? '—'}</b><small>постов в неделю</small></div>
    </div>` : '';
  // bar chart: every post, oldest → newest, colored by type
  const chrono = posts.filter(p => p[m] != null).slice().reverse(), max = Math.max(1, ...chrono.map(p => p[m]));
  const chart = chrono.length ? `<div class="sec-h"><span class="who" style="background:${A.k.color}">М</span><h3>${mName[0].toUpperCase() + mName.slice(1)} каждого поста</h3><span class="meta">${chrono.length} постов · цвет — формат</span></div>
    <div class="pchart">${chrono.map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener" title="${esc((p.date || '') + ' · ' + p.type + ' · ' + nf(p[m]) + ' ' + mName + '\n' + (p.text || '').slice(0, 90))}" style="height:${Math.max(3, p[m] / max * 100)}%;background:${TYPE_COLOR[p.type] || '#a1a1aa'}"></a>`).join('')}</div>
    <div class="plegend">${[...new Set(chrono.map(p => p.type))].map(t => `<span><i style="background:${TYPE_COLOR[t] || '#a1a1aa'}"></i>${esc(t)}</span>`).join('')}</div>` : '';
  const bars = (title, rows, label = r => r.key) => { const mx = Math.max(1, ...rows.map(r => r.avg || 0)); return `<div class="gb"><h4>${title}</h4>${rows.map(r => `<div class="gbr"><span>${esc(String(label(r)))}</span><em><u style="width:${(r.avg || 0) / mx * 100}%"></u></em><b>${nf(r.avg)}</b><small>${r.posts} п.</small></div>`).join('')}</div>`; };
  const groups = st ? `<div class="groups">
      ${bars('По формату', st.by_type)}
      ${bars('По дням недели', st.by_weekday)}
      ${bars('По времени (Ташкент)', [...st.by_hour].sort((a, b) => a.key - b.key), r => String(r.key).padStart(2, '0') + ':00')}
      ${bars('По длине текста', st.by_text_length)}
    </div>${st.hashtags.posts_with ? `<p class="soc-d">Хэштеги: в ${st.hashtags.posts_with} постах, среднее ${nf(st.hashtags.avg_with)} против ${nf(st.hashtags.avg_without)} без них. Чаще всего: ${st.hashtags.top.map(t => esc(t.tag)).join(', ')}</p>` : ''}` : '';
  const adv = x.advice;
  const advice = adv && (adv.recommendations?.length || adv.summary) ? `<div class="sec-h"><span class="who" style="background:${A.k.color}">М</span><h3>Рекомендации маркетолога</h3><span class="meta">по этим данным</span></div>
    ${adv.summary ? `<p class="adv-sum">${esc(adv.summary)}</p>` : ''}
    <div class="advs">${(adv.recommendations || []).map((r, i) => `<div class="adv"><b><i>${i + 1}</i>${esc(r.title)}</b><p>${esc(r.why)}</p><p class="do">${icon('arrow-right', 'sm')}${esc(r.do)}</p></div>`).join('')}</div>
    ${adv.post_ideas?.length ? `<div class="ideas"><h4>Идеи следующих постов</h4>${adv.post_ideas.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}` : '';
  const table = posts.length ? `<div class="sec-h"><span class="who" style="background:${A.k.color}">М</span><h3>Все посты</h3><span class="meta">клик — подробности</span></div>
    <div class="tbl-wrap" style="max-height:420px"><table class="rg ptab"><thead><tr><th>Дата</th><th>Формат</th><th>Текст</th><th class="n">${mName}</th>${x.platform === 'instagram' ? '<th class="n">лайки</th><th class="n">комм.</th><th class="n">сохр.</th>' : '<th class="n">реакции</th>'}<th class="n">Δ с прошлой проверки</th></tr></thead><tbody>
    ${posts.map((p, i) => `<tr data-pi="${i}"><td>${esc(p.date || '—')}</td><td><span class="ptype" style="--c:${TYPE_COLOR[p.type] || '#a1a1aa'}">${esc(p.type)}</span></td><td class="nm">${esc((p.text || '—').replace(/\s+/g, ' ').slice(0, 70))}</td><td class="n">${nf(p[m])}</td>${x.platform === 'instagram' ? `<td class="n">${nf(p.likes)}</td><td class="n">${nf(p.comments)}</td><td class="n">${nf(p.saved)}</td>` : `<td class="n">${nf(p[rKey])}</td>`}<td class="n">${p.delta != null ? `<span class="${p.delta > 0 ? 'up' : ''}">${p.delta > 0 ? '+' : ''}${nf(p.delta)}</span><small> за ${p.delta_hours} ч</small>` : '<small>первая проверка</small>'}</td></tr>
      <tr class="pdet" data-pd="${i}" hidden><td colspan="7"><p>${esc(p.text || '')}</p><div class="pdm">${p.reactions_detail ? `<span>${esc(p.reactions_detail)}</span>` : ''}${p.reach != null ? `<span>охват ${nf(p.reach)}</span>` : ''}${p.shares != null ? `<span>репосты ${nf(p.shares)}</span>` : ''}<span>проверок: ${p.checks || 1}</span><a href="${esc(p.url)}" target="_blank" rel="noopener">открыть пост ↗</a></div></td></tr>`).join('')}
    </tbody></table></div>` : '';
  return `<div class="doc soc"><div class="doc-h"><div><h1>${esc(x.title || x.handle || x.url)}</h1><p>${esc(x.platform)} · <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a> · ${esc(x.source || 'браузер')} · ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p></div>${x.ours ? '<span class="chip dark">наш аккаунт</span>' : ''}</div>
    ${x.needs_connection ? `<div class="risk">${icon('alert', 'sm')}<span>${esc(x.needs_connection)}</span></div>` : ''}
    ${x.description || x.summary ? `<p class="soc-d">${esc(x.description || x.summary)}</p>` : ''}
    ${kpi}${chart}${groups}${advice}${table}
    ${x.text ? `<p class="soc-d">${esc(x.text.slice(0, 900))}</p>` : ''}</div>`;
}
async function showSocial(x) {
  const id = 'soc-' + x.platform + '-' + String(x.handle || x.url || 'site').replace(/[^\w.-]/g, '').slice(0, 40);
  SOCIAL[id] = x;
  addDoc('Соцсети', { id, nm: (x.platform === 'telegram' ? 'Telegram · @' : x.platform === 'instagram' ? 'Instagram · @' : 'Сайт · ') + (x.handle || String(x.url).replace(/^https?:\/\//, '').slice(0, 30)), tag: x.stats ? x.stats.posts_analyzed + ' п.' : 'live', cls: 'new', ic: 'globe' });
  openDoc(id);
  page.querySelectorAll('.ptab tr[data-pi]').forEach(tr => tr.onclick = () => { const d = page.querySelector(`[data-pd="${tr.dataset.pi}"]`); d.hidden = !d.hidden; });
  busy = true; agentBusy('k', true); setStatus('Маркетолог разбирает посты', true);
  const bars = [...page.querySelectorAll('.pchart a')];
  for (const el of bars.filter((_, i) => i % Math.max(1, Math.floor(bars.length / 8)) === 0).slice(0, 8)) { await cursorTo('k', el, 'пост', 200, 0.5, 0.2); await sleep(90); }
  const adv = page.querySelector('.advs');
  if (adv) { adv.scrollIntoView({ behavior: 'smooth', block: 'center' }); await sleep(400); await cursorTo('k', adv, 'рекомендации', 500, 0.3, 0.2); }
  agentBusy('k', false); busy = false; parkCursors(); setStatus('Готово');
  logMsg('k', x.stats ? `разобрал ${x.stats.posts_analyzed} постов, ${x.advice?.recommendations?.length || 0} рекомендаций` : 'снял публичные данные профиля');
}

// =====================================================================
// BUILDING → FLOORS → UNIT: click a house, it opens floor by floor
// =====================================================================
const FLOOR_H = 3; // м на этаж, когда этажности нет в OSM
let floorHover = null, drawing = null;
GEO.building = null; GEO.floor = null; GEO.unit = null; GEO.plan = null;
const vecSrc = () => Object.keys(geoMap.getStyle().sources).find(k => geoMap.getStyle().sources[k].type === 'vector');
const inRing = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
const insideBuilding = (lon, lat) => GEO.building && inRing(lon, lat, GEO.building.poly[0]);
function localXY(lat0, lon0) { const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540; return { to: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky], from: ([x, y]) => [lon0 + x / kx, lat0 + y / ky] }; }
const ringArea = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

function buildingAt(lon, lat) {
  let best = null;
  for (const f of geoMap.querySourceFeatures(vecSrc(), { sourceLayer: 'building' })) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) if (inRing(lon, lat, poly[0])) {
      const h = +f.properties.render_height || 0;
      if (!best || h > best.h) best = { id: f.id, poly, h, minH: +f.properties.render_min_height || 0 };
    }
  }
  return best;
}
async function onMapClick(e) {
  const hit = geoMap.queryRenderedFeatures(e.point, { layers: ['floors'] })[0];
  if (hit) return selectFloor(hit.properties.level);
  const { lat, lng } = e.lngLat;
  const ok = await selectBuildingAt(lng, lat);
  setPoint(lat, lng, '', { fly: !ok, building: false });
}
async function selectBuildingAt(lon, lat, { fly = true } = {}) {
  if (!geoMap) return false;
  const b = buildingAt(lon, lat);
  if (!b) return false;
  if (GEO.building && GEO.building.id === b.id) return true;
  const ring = b.poly[0], c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
  const L = localXY(c[1], c[0]);
  GEO.building = { id: b.id, poly: b.poly, height: b.h, minH: b.minH, center: c, footprint: Math.round(ringArea(ring.map(L.to))), osm: null };
  GEO.floor = null; GEO.unit = null; GEO.plan = null; drawing = null;
  setLevels(); drawBuilding(); renderBuilding();
  if (fly) { const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]); geoMap.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 110, pitch: GEO.mode === '3d' ? 60 : 0, bearing: GEO.mode === '3d' ? (geoMap.getBearing() || -18) : 0, maxZoom: 18.6, duration: 1200 }); }
  const r = await fetch('/api/osm/building?id=' + encodeURIComponent(b.id)).then(x => x.json()).catch(() => ({}));
  if (!GEO.building || GEO.building.id !== b.id) return true;
  GEO.building.osm = r.building || null;
  setLevels(); drawBuilding(); renderBuilding();
  logMsg('a', `здание: ${GEO.building.levels} эт. (${GEO.building.levelsSrc}), пятно ≈ ${GEO.building.footprint} м²`);
  return true;
}
function setLevels() {
  const B = GEO.building, t = B.osm?.tags || {}, h = B.height - B.minH;
  const byH = Math.max(1, Math.round(h / FLOOR_H)), osmL = parseInt(t['building:levels']);
  B.address = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ') || t.name || '';
  B.warning = '';
  if (osmL > 0 && (h <= 1 || Math.abs(osmL * FLOOR_H - h) <= Math.max(6, h * 0.5))) { B.levels = osmL; B.levelsSrc = 'OpenStreetMap'; }
  else if (osmL > 0) { B.levels = byH; B.levelsSrc = `оценка по высоте ${h} м`; B.warning = `В OSM указано ${osmL} эт., но высота дома ${h} м — данные противоречат друг другу, взята оценка по высоте.`; }
  else { B.levels = byH; B.levelsSrc = `оценка: высота ${h} м, ~${FLOOR_H} м на этаж`; }
  B.levels = Math.min(B.levels, 120);
  if (GEO.floor > B.levels) { GEO.floor = null; GEO.unit = null; }
}
function floorGeom() { const B = GEO.building, total = Math.max(B.height - B.minH, B.levels * 2.6); return { fh: total / B.levels, base: B.minH }; }
function floorFeatures() {
  const B = GEO.building; if (!B) return emptyFC();
  const { fh, base } = floorGeom();
  return { type: 'FeatureCollection', features: Array.from({ length: B.levels }, (_, i) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: B.poly }, properties: { level: i + 1, base: base + i * fh, top: base + (i + 1) * fh - Math.min(0.4, fh * 0.14), state: i + 1 === GEO.floor ? 'sel' : i + 1 === floorHover ? 'hov' : 'n' } })) };
}
function unitFeatures() {
  const U = GEO.unit; if (!GEO.building || !U?.poly || U.floor !== GEO.floor) return emptyFC();
  const { fh, base } = floorGeom(), b0 = base + (U.floor - 1) * fh;
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [U.poly] }, properties: { base: b0 + 0.05, top: b0 + fh * 0.86 } }] };
}
function drawBuilding() {
  if (!geoMap || !geoMap.getSource('floors')) return;
  geoMap.getSource('floors').setData(floorFeatures());
  geoMap.getSource('unit').setData(unitFeatures());
  geoMap.setPaintProperty('floors', 'fill-extrusion-opacity', GEO.unit?.poly ? 0.45 : 0.93);
  const L = GEO.layer3d; if (!L) return;
  const hide = GEO.building ? ['!=', ['id'], GEO.building.id] : null;
  geoMap.setFilter(L, hide ? (GEO.baseFilter ? ['all', GEO.baseFilter, hide] : hide) : (GEO.baseFilter || null));
  geoMap.setPaintProperty(L, 'fill-extrusion-opacity', GEO.building ? 0.3 : GEO.baseOpacity);
}
function clearBuilding() { GEO.building = null; GEO.floor = null; GEO.unit = null; GEO.plan = null; drawing = null; drawBuilding(); renderBuilding(); renderGeoPanel(); }
function selectFloor(n) {
  if (!GEO.building) return;
  GEO.floor = +n; if (GEO.unit && GEO.unit.floor !== GEO.floor) GEO.unit = null; drawing = null;
  drawBuilding(); renderBuilding(); renderGeoPanel();
  if (geoMap && GEO.mode === '3d') geoMap.easeTo({ pitch: 62, duration: 600 });
  $('#bldPanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function floorNote() {
  if (!GEO.floor || !GEO.analysis?.need) return '';
  return GEO.floor === 1 ? '1 этаж: вход прямо с улицы, поток прохожих доступен — индекс применим полностью.'
    : `${GEO.floor} этаж: прохожие с улицы заходят редко. Индекс описывает окружение, а не ваш поток — важнее вывеска, заметный вход и онлайн-продвижение.`;
}
function buildingContext() {
  const B = GEO.building; if (!B) return 'Здание на карте не выбрано. ';
  let t = `Здание: ${B.address || 'адрес в OSM не указан'}, ${B.levels} эт. (${B.levelsSrc}), высота ${B.height - B.minH} м, пятно застройки ${B.footprint} м². `;
  if (B.warning) t += B.warning + ' ';
  if (GEO.floor) t += `Выбран ${GEO.floor}-й этаж. `;
  if (GEO.unit) t += `Помещение: ${GEO.unit.name || 'без номера'}${GEO.unit.area ? `, ${GEO.unit.area} м²` : ''}${GEO.unit.poly ? ' (контур нарисован на плане)' : ''}. `;
  return t;
}

// ---------- panel: building card, floors, floor plan ----------
function renderBuilding() {
  const el = $('#bldPanel'); if (!el) return;
  const B = GEO.building;
  $('#mapHint')?.classList.toggle('off', !!(B || GEO.lat));
  if (!B) { el.innerHTML = `<div class="bld-empty">${icon('layers', 'sm')}<span>Кликните по дому на карте — он раскроется по этажам, и можно будет выбрать этаж и помещение.</span></div>`; return; }
  const floors = Array.from({ length: B.levels }, (_, i) => B.levels - i);
  el.innerHTML = `<div class="bld-card">
      <div class="bld-h">${icon('home', 'sm')}<div><b>${esc(B.address || 'Здание без адреса в OSM')}</b><small>${B.levels} эт. · ${esc(B.levelsSrc)} · пятно ≈ ${B.footprint} м²${B.osm ? ` · <a href="${esc(B.osm.url)}" target="_blank" rel="noopener">OSM</a>` : ''}</small></div><button class="btn btn-ghost btn-icon btn-sm" id="bldX" title="Снять выбор">${icon('x', 'sm')}</button></div>
      ${B.warning ? `<p class="bld-warn">${icon('alert', 'sm')}<span>${esc(B.warning)}</span></p>` : ''}
      <div class="bld-body">
        <div class="lift">${floors.map(f => `<button data-f="${f}" class="${f === GEO.floor ? 'on' : ''}">${f}</button>`).join('')}</div>
        <div class="plan" id="planBox">${GEO.floor ? planHtml() : `<div class="plan-empty">${icon('layers')}<span>Выберите этаж: кнопкой слева или кликом по этажу на 3D-модели</span></div>`}</div>
      </div></div>`;
  $('#bldX').onclick = () => clearBuilding();
  el.querySelectorAll('.lift button').forEach(b => b.onclick = () => selectFloor(+b.dataset.f));
  if (GEO.floor) wirePlan();
}
function planHtml() {
  const U = GEO.unit && GEO.unit.floor === GEO.floor ? GEO.unit : null;
  return `<div class="plan-h"><b>План ${GEO.floor} этажа</b>
      <label class="btn btn-outline btn-sm">${icon('upload', 'sm')}Загрузить план<input type="file" id="planFile" accept="image/*" hidden></label>
      ${GEO.plan ? `<button class="btn btn-ghost btn-sm" id="planRot">${icon('undo', 'sm')}90°</button>` : ''}
      <button class="btn ${drawing ? 'btn-primary' : 'btn-outline'} btn-sm" id="planDraw">${icon('shapes', 'sm')}${drawing ? 'Кликайте углы…' : 'Нарисовать помещение'}</button></div>
    <svg id="planSvg" class="${drawing ? 'drawing' : ''}"></svg>
    <p class="hint-s">${drawing ? 'Кликайте по углам помещения. Чтобы закончить, кликните по первой точке или дважды.' : GEO.plan ? 'План вписан в контур дома. Нарисуйте своё помещение поверх него.' : 'Контур этажа — настоящий, из OpenStreetMap. Загрузите план из техпаспорта или договора аренды, чтобы выбрать помещение точно.'}</p>
    <form class="unit-f" id="unitForm"><input id="unitName" placeholder="№ помещения или квартиры" value="${esc(U?.name || '')}"><input id="unitArea" type="number" step="0.1" min="0" placeholder="Площадь, м²" value="${U?.area ?? ''}"><button class="btn btn-primary btn-sm">Сохранить</button></form>
    ${U ? `<div class="unit-ok">${icon('check', 'sm')}Помещение ${esc(U.name || 'без номера')} · ${GEO.floor} этаж${U.area ? ` · ${U.area} м²` : ''}${U.poly ? ' · контур на 3D-модели' : ''}</div>` : ''}`;
}
function wirePlan() {
  const svg = $('#planSvg'), B = GEO.building, L = localXY(B.center[1], B.center[0]);
  const rings = B.poly.map(r => r.map(L.to)), xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 640, H = 340, pad = 20, k = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxY - minY || 1));
  const ox = (W - (maxX - minX) * k) / 2, oy = (H - (maxY - minY) * k) / 2;
  const sx = x => ox + (x - minX) * k, sy = y => H - (oy + (y - minY) * k); // north up
  const ux = X => (X - ox) / k + minX, uy = Y => (H - Y - oy) / k + minY;
  const path = rings.map(r => 'M' + r.map(p => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('L') + 'Z').join('');
  const U = GEO.unit && GEO.unit.floor === GEO.floor ? GEO.unit : null;
  const unitPts = U?.poly ? U.poly.slice(0, -1).map(L.to).map(p => [sx(p[0]), sy(p[1])]) : null;
  const bx = sx(minX), by = sy(maxY), bw = (maxX - minX) * k, bh = (maxY - minY) * k;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `<defs><clipPath id="fpClip"><path d="${path}" clip-rule="evenodd"/></clipPath></defs>
    ${GEO.plan ? `<image href="${GEO.plan.url}" x="${bx}" y="${by}" width="${bw}" height="${bh}" preserveAspectRatio="none" opacity="0.8" transform="rotate(${GEO.plan.rot} ${bx + bw / 2} ${by + bh / 2})" clip-path="url(#fpClip)"/>` : ''}
    <path d="${path}" fill="${GEO.plan ? 'none' : '#f4f4f5'}" fill-rule="evenodd" stroke="#0a0a0b" stroke-width="2.5"/>
    ${unitPts ? `<polygon points="${unitPts.map(p => p.join(',')).join(' ')}" fill="rgba(255,46,136,.28)" stroke="#ff2e88" stroke-width="2.5"/>` : ''}
    ${drawing ? `<polyline points="${drawing.map(p => p.join(',')).join(' ')}" fill="none" stroke="#ff2e88" stroke-width="2.5" stroke-dasharray="6 4"/>${drawing.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i ? 4 : 7}" fill="${i ? '#ff2e88' : '#fff'}" stroke="#ff2e88" stroke-width="2.5"/>`).join('')}` : ''}
    <text x="${W - 14}" y="22" text-anchor="end" font-size="12" fill="#6b6b73">N ↑ · 10 м = ${(10 * k).toFixed(0)} px</text>`;
  const pt = e => { const m = svg.getScreenCTM().inverse(), q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m); return [q.x, q.y]; };
  const finish = () => {
    if (!drawing || drawing.length < 3) { drawing = null; renderBuilding(); return; }
    const ring = drawing.map(([X, Y]) => L.from([ux(X), uy(Y)]));
    ring.push(ring[0]);
    const area = Math.round(ringArea(drawing.map(([X, Y]) => [ux(X), uy(Y)])) * 10) / 10;
    GEO.unit = { ...(GEO.unit || {}), floor: GEO.floor, poly: ring, area: GEO.unit?.area ?? area, drawnArea: area };
    drawing = null; drawBuilding(); renderBuilding(); renderGeoPanel();
    logMsg('a', `помещение отмечено на ${GEO.floor} этаже, по контуру ≈ ${area} м²`);
  };
  svg.onclick = e => {
    if (!drawing) return;
    const p = pt(e);
    if (drawing.length >= 3 && Math.hypot(p[0] - drawing[0][0], p[1] - drawing[0][1]) < 12) return finish();
    drawing.push(p); renderBuilding();
  };
  svg.ondblclick = e => { e.preventDefault(); if (drawing) { drawing.pop(); finish(); } };
  $('#planDraw').onclick = () => { drawing = drawing ? null : []; renderBuilding(); };
  $('#planRot')?.addEventListener('click', () => { GEO.plan.rot = (GEO.plan.rot + 90) % 360; renderBuilding(); });
  $('#planFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    if (!/^image\//.test(f.type)) return toast('Нужна картинка плана: PNG или JPG', 'alert');
    if (GEO.plan) URL.revokeObjectURL(GEO.plan.url);
    GEO.plan = { url: URL.createObjectURL(f), rot: 0, name: f.name };
    addDoc('Геомодель', { id: 'plan-' + GEO.floor, nm: `План ${GEO.floor} этажа · ${f.name}`.slice(0, 50), tag: 'план', cls: 'new', ic: 'image' });
    currentDoc = 'geo'; renderTree(); renderBuilding();
    logMsg('a', `план ${GEO.floor} этажа вписан в контур дома`);
  };
  $('#unitForm').onsubmit = e => {
    e.preventDefault();
    const area = parseFloat($('#unitArea').value);
    GEO.unit = { ...(GEO.unit || {}), floor: GEO.floor, name: $('#unitName').value.trim(), area: Number.isFinite(area) ? area : null };
    drawBuilding(); renderBuilding(); renderGeoPanel();
    logMsg('a', `помещение ${GEO.unit.name || 'без номера'}, ${GEO.floor} этаж${GEO.unit.area ? ', ' + GEO.unit.area + ' м²' : ''}`);
  };
}
