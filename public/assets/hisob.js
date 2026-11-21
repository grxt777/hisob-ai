// Hisob AI — workspace prototype.
// The manager plans, the bookkeeper / lawyer / analyst do the work on the canvas with their cursors.
// All numbers are computed from window.DEMO (anonymized e-invoice registries), nothing is hardcoded.
const $ = s => document.querySelector(s);
const D = window.DEMO;

// ---------- company & assumptions ----------
const CO = { name: '«BARAKA NON» MCHJ', inn: '300 000 001', period: 'октябрь 2026', regime: 'Общий режим', regimeSub: 'НДС 12% + налог на прибыль 15%' };
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
const C = (() => {
  const sb = sum(D.sales, 'base'), sv = sum(D.sales, 'vat');
  const ded = D.purchases.filter(p => !p.note), nonded = D.purchases.filter(p => p.note);
  const pb = sum(D.purchases, 'base'), pv = sum(ded, 'vat');
  const pay = sv - pv;
  const gross = sb + sv;
  const simp = gross * SIMPLIFIED_RATE;
  const annual = sb * 12, limit = TURNOVER_LIMIT * BRV;
  return { sb, sv, pb, pv, pay, gross, simp, save: pay - simp, annual, limit, nonded, b2b: D.sales.filter(s => s.inn).length };
})();
const fmt = n => Math.round(n).toLocaleString('ru-RU');
const mln = n => (n / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн';
const mlrd = n => (n / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' млрд';

// ---------- state ----------
let tool = 'select', busy = false, reportDone = false, approved = false, currentDoc = null, ttsOn = false;
const DOCS = [
  { g: 'Данные', items: [
    { id: 'esf-s', nm: 'ЭСФ · продажи', tag: String(D.sales.length), ic: 'file' },
    { id: 'esf-p', nm: 'ЭСФ · покупки', tag: String(D.purchases.length), ic: 'file' },
    { id: 'bank', nm: 'Банковская выписка · окт', tag: 'PDF', ic: 'file' },
  ] },
  { g: 'Отчёты', items: [
    { id: 'vat-09', nm: 'Расчёт НДС · сентябрь', tag: 'сдан', cls: 'ok', ic: 'sheet' },
    { id: 'profit-q3', nm: 'Налог на прибыль · III кв', tag: 'сдан', cls: 'ok', ic: 'sheet' },
  ] },
  { g: 'Геомодель', items: [
    { id: 'geo', nm: 'Карта предприятия', tag: '2D/3D', ic: 'globe' },
  ] },
  { g: 'Прочее', items: [
    { id: 'rent', nm: 'Договор аренды цеха', tag: 'DOCX', ic: 'file' },
    { id: 'memo', nm: 'Докладная · инвентаризация', tag: 'DOCX', ic: 'file' },
  ] },
];
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
function addDoc(group, item) {
  let g = DOCS.find(x => x.g === group);
  if (!g) { g = { g: group, items: [] }; DOCS.splice(1, 0, g); }
  const old = g.items.find(x => x.id === item.id);
  old ? Object.assign(old, item, { fresh: true }) : g.items.unshift({ ...item, fresh: true });
  renderTree();
}
function renderDates() {
  $('#dates').innerHTML = DATES.map(x => `<div class="date ${x.soon ? 'soon' : ''} ${x.fresh ? 'fresh' : ''}"><div class="d"><b>${x.d}</b><small>${x.m}</small></div><div class="t">${esc(x.t)}<span>${esc(x.s)}</span></div></div>`).join('');
  $('#dateCount').textContent = DATES.length;
  DATES.forEach(x => (x.fresh = false));
}
renderTree(); renderDates();

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
  aiMsg(`<div class="welcome"><h3>Ассалому алейкум!</h3><p>Я менеджер вашей AI-команды. Скажите задачу голосом или текстом, остальное сделают агенты.</p>
    <div class="tip">${icon('mic', 'sm')}<span><b>Голос</b>: говорите по-узбекски или по-русски.</span></div>
    <div class="tip">${icon('ai-cursor', 'sm')}<span><b>ИИ-курсор</b> (клавиша A): отметьте любое место в документе, хоть несколько, и спросите о нём. Правый клик — сразу объясню.</span></div>
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

function openDoc(id) {
  closePop(); if (targets.length) clearTargets();
  if (geoMap && id !== 'geo') { geoMap.remove(); geoMap = null; }
  currentDoc = id; renderTree(); showStart(false);
  const item = DOCS.flatMap(g => g.items).find(x => x.id === id);
  $('#frameUrl').textContent = item ? item.nm : 'hisob.ai';
  if (id === 'vat-10') { if (reportDone) fillReportInstant(); return; }
  if (id === 'esf-s') page.innerHTML = `<div class="doc"><div class="doc-h"><div><h1>ЭСФ · продажи</h1><p>${D.sales.length} счетов-фактур за ${CO.period}</p></div></div><div class="tbl-wrap" style="max-height:none"><table class="rg"><thead>${headS}</thead><tbody>${D.sales.map(rowS).join('')}</tbody><tfoot><tr><td colspan="5">Итого</td><td class="n" data-x="sb">${fmt(C.sb)}</td><td class="n" data-x="sv">${fmt(C.sv)}</td></tr></tfoot></table></div></div>`;
  else if (id === 'esf-p') page.innerHTML = `<div class="doc"><div class="doc-h"><div><h1>ЭСФ · покупки</h1><p>${D.purchases.length} счетов-фактур за ${CO.period}</p></div></div><div class="tbl-wrap" style="max-height:none"><table class="rg"><thead>${headP}</thead><tbody>${D.purchases.map(rowP).join('')}</tbody><tfoot><tr><td colspan="5">Итого</td><td class="n" data-x="pb">${fmt(C.pb)}</td><td class="n" data-x="pv">${fmt(C.pv)}</td><td></td></tr></tfoot></table></div></div>`;
  else if (id === 'app-6') page.innerHTML = applicationDoc();
  else if (id === 'vat-09' || id === 'profit-q3') page.innerHTML = letterDoc({ title: item.nm, chip: 'Сдан · демо-данные', sign: false, body: `<p>Отчёт за прошлый период хранится здесь, чтобы агенты сравнивали динамику: рост продаж, изменение НДС к уплате, сезонность.</p><p class="muted">В рабочей версии сюда подгружается документ из кабинета налоговой или загруженный вами файл.</p>` });
  else if (id === 'geo') { renderGeo(); return; }
  else if (SOCIAL[id]) page.innerHTML = socialHtml(id);
  else if (CREATED[id]) page.innerHTML = createdDocHtml(id);
  else page.innerHTML = letterDoc({ title: item ? item.nm : 'Документ', chip: 'Файл не загружен в демо', sign: false, body: `<p>Здесь будет содержимое загруженного файла. В демо это заглушка без данных.</p><p>Загрузите настоящий документ через «Загрузить» слева, и агенты используют его: юрист — договоры, бухгалтер — выписки и докладные.</p>` });
  canvas.scrollTop = 0;
}

// ---------- main scenario ----------
async function runReport() {
  if (busy) return;
  if (reportDone) { openDoc('vat-10'); await typing(400); aiMsg('Расчёт за октябрь уже готов, открыл его. Кликните по цифре ИИ-курсором, если нужно объяснение.'); return; }
  busy = true; showStart(false);
  addDoc('Отчёты', { id: 'vat-10', nm: 'Расчёт НДС · октябрь', tag: 'черновик', cls: 'new', ic: 'sheet' });
  currentDoc = 'vat-10'; renderTree();
  $('#frameUrl').textContent = 'Расчёт НДС · октябрь 2026 · черновик';
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
    <label><input type="checkbox" checked data-a="xlsx"><span><b>Бухгалтер</b>: сформировать расчёт НДС в Excel</span></label>
    <label><input type="checkbox" checked data-a="app"><span><b>Юрист</b>: подготовить заявление на упрощённый НДС 6%</span></label>
    <label><input type="checkbox" checked data-a="remind"><span><b>Менеджер</b>: напомнить за 3 дня до срока следующего отчёта</span></label>
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
  approved = true;
  if (currentDoc === 'vat-10' && $('#docState')) { $('#docState').textContent = 'Готов к подписи'; $('#docState').classList.add('dark'); }
  parkCursors(); busy = false;
  setStatus('Готово · ждёт подписи ЭЦП');
  await typing(600);
  const m = aiMsg(`<p>Сделано. Последний шаг — отправка в налоговую. Её подписываете вы, своей ЭЦП: AI готовит, человек решает.</p>`);
  const el = document.createElement('div'); el.className = 'perm';
  el.innerHTML = `<h4>${icon('send', 'sm')}Подготовить отправку в my.soliq.uz?</h4><div class="act"><button class="btn btn-primary btn-sm" data-ok>Подготовить</button><button class="btn btn-outline btn-sm" data-no>Позже</button></div>`;
  m.querySelector('.body').append(el); scrollChat();
  el.querySelector('[data-no]').onclick = () => { el.classList.add('done'); aiMsg('Хорошо. Напомню ближе к сроку.'); };
  el.querySelector('[data-ok]').onclick = async () => {
    el.classList.add('done');
    await confirmDialog({ title: 'Демо-режим', icon: 'shield', ok: 'Понятно', cancel: 'Закрыть',
      html: 'В рабочей версии агент сам откроет кабинет <b>my.soliq.uz</b>, заполнит форму расчёта и <b>остановится перед подписью ЭЦП</b>. В демо отправка не выполняется.' });
    aiMsg('Форма заполнена и ждёт вашей подписи ЭЦП.');
    setStatus('Ждёт подписи ЭЦП');
  };
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

// ---------- explain (AI cursor) ----------
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
const pop = $('#pop');
function closePop() { pop.hidden = true; }
function openPop(el) {
  const f = EXPLAIN[el.dataset.x]; if (!f) return;
  const x = f();
  pop.dataset.key = el.dataset.x;
  $('#popTitle').textContent = x.t; $('#popVal').textContent = x.v; $('#popExplain').innerHTML = x.h;
  $('#popSugg').innerHTML = (x.s || []).map(s => `<button class="chip">${esc(s)}</button>`).join('');
  $('#popSugg').querySelectorAll('button').forEach(b => b.onclick = () => { closePop(); handleText(b.textContent); });
  pop.hidden = false;
  const r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.min(innerWidth - pw - 12, Math.max(12, r.left + r.width / 2 - pw / 2));
  let top = r.bottom + 10; if (top + ph > innerHeight - 12) top = Math.max(12, r.top - ph - 10);
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
}
// ---------- AI cursor: mark any place on the canvas, then ask about it in chat ----------
const PICKABLE = '[data-x], .rg tbody tr, .rg tfoot tr, .card-n, .rgm, .save, .risk, .sec-h, .doc-h, .letter .to, .letter h2, .letter p, .letter .draft';
let targets = []; // [{ el, label, text }]
const hoverBox = $('#hoverBox');
function pickTarget(t) {
  const el = t.closest(PICKABLE);
  return el && page.contains(el) ? el : null;
}
function describe(el) {
  const txt = el.innerText.replace(/\s+/g, ' ').trim();
  const cut = (x, n = 38) => x.length > n ? x.slice(0, n) + '…' : x;
  if (el.dataset.x && EXPLAIN[el.dataset.x]) return EXPLAIN[el.dataset.x]().t + ': ' + txt;
  if (el.matches('.rg tfoot tr')) return 'Итого реестра';
  if (el.matches('.rg tbody tr')) { const td = [...el.cells].map(c => c.innerText.trim()); return `ЭСФ ${td[3]} · ${cut(td[1], 24)}`; }
  if (el.matches('.card-n')) return el.querySelector('span').innerText;
  if (el.matches('.rgm')) return 'Режим: ' + el.querySelector('b').innerText;
  if (el.matches('.save')) return 'Экономия';
  if (el.matches('.risk')) return 'Риск: ' + cut(txt, 30);
  if (el.matches('.sec-h')) return 'Раздел: ' + el.querySelector('h3').innerText;
  if (el.matches('.doc-h')) return 'Документ: ' + el.querySelector('h1').innerText;
  return cut(txt);
}
function placeHover(el) {
  if (!el) { hoverBox.classList.remove('on'); return; }
  const r = el.getBoundingClientRect(), b = inner.getBoundingClientRect();
  Object.assign(hoverBox.style, { left: r.left - b.left - 3 + 'px', top: r.top - b.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' });
  $('#hoverTag').textContent = (targets.some(x => x.el === el) ? 'Снять · ' : 'Отметить · ') + describe(el);
  hoverBox.classList.add('on');
}
page.addEventListener('mousemove', e => { if (tool === 'ai') placeHover(pickTarget(e.target)); });
page.addEventListener('mouseleave', () => placeHover(null));
canvas.addEventListener('scroll', () => placeHover(null), true);
page.addEventListener('click', e => {
  if (tool !== 'ai') return;
  const el = pickTarget(e.target); if (!el) return;
  e.preventDefault(); toggleTarget(el); placeHover(el);
});
page.addEventListener('contextmenu', e => { // right click: explain right away
  if (tool !== 'ai') return;
  const el = pickTarget(e.target); if (!el) return;
  e.preventDefault();
  if (el.dataset.x) return openPop(el);
  if (!targets.some(x => x.el === el)) toggleTarget(el);
  sendMarked('Объясни, что здесь написано и что это значит для меня');
});
function toggleTarget(el) {
  const i = targets.findIndex(x => x.el === el);
  if (i >= 0) { el.classList.remove('picked'); targets.splice(i, 1); }
  else { el.classList.add('picked'); targets.push({ el, label: describe(el), text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 500) }); }
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
  $('#chatInput').placeholder = targets.length ? 'Что спросить про отмеченное?' : 'Спросите про налоги, отчёты, сроки…';
}
function sendMarked(q) { $('#chatInput').value = ''; handleText(q || 'Объясни отмеченное'); }
$('#popAsk').onclick = () => { const key = $('#pop').dataset.key; const el = page.querySelector(`[data-x="${CSS.escape(key || '')}"]`); closePop(); if (el && !targets.some(x => x.el === el)) toggleTarget(el); $('#chatInput').focus(); };
$('#popClose').onclick = closePop;
addEventListener('mousedown', e => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('[data-x]')) closePop(); });

function setTool(t) {
  tool = t;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  canvas.classList.toggle('ai', t === 'ai');
  if (t !== 'ai') { closePop(); placeHover(null); }
}
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
$('#pickBtn').onclick = () => { setTool('ai'); toast('Кликайте по местам в документе: они добавятся в чат. Правый клик — сразу объяснить', 'ai-cursor'); };

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
    show_geo: '', show_social: '',
    select_floor: `Выбрал ${args.floor} этаж: он подсвечен на 3D-модели, ниже — план этажа.`, set_unit: `Записал помещение «${args.name || ''}»${args.area_m2 ? `, ${args.area_m2} м²` : ''}.`,
  }[name] ?? '';
}
// Tools the model can call (definitions live in server.js). Anything with consequences goes through the permission card.
async function runAction({ name, args = {} }) {
  if (busy && name !== 'show_deadlines') return aiMsg('<p>Агенты ещё работают, сделаю это сразу после них.</p>');
  if (name === 'build_vat_report') return runReport();
  if (name === 'open_document') {
    if (args.id === 'vat-10' && !reportDone) return runReport();
    openDoc(args.id); return;
  }
  if (name === 'show_deadlines') { document.querySelector('[data-tab="dates"]').click(); return; }
  if (name === 'show_home') { closePop(); currentDoc = null; renderTree(); page.innerHTML = ''; $('#frameUrl').textContent = 'hisob.ai'; showStart(true); return; }
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
const CREATED = {}; let docSeq = 0, lastCreated = null;
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
  const id = a.id && CREATED[a.id] ? a.id : 'doc-' + (++docSeq);
  CREATED[id] = { title: String(a.title || 'Документ').slice(0, 80), kind: a.kind || 'другое', md: String(a.body || '') };
  lastCreated = id;
  addDoc('Созданные', { id, nm: CREATED[id].title, tag: CREATED[id].kind, cls: 'new', ic: 'file' });
  closePop(); if (targets.length) clearTargets();
  currentDoc = id; renderTree(); showStart(false);
  $('#frameUrl').textContent = CREATED[id].title + ' · черновик';
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
async function exportDoc(id, format = 'pdf') {
  const known = id && (CREATED[id] || DOCS.flatMap(g => g.items).some(x => x.id === id));
  const target = known ? id : (lastCreated || currentDoc);
  if (!target) return aiMsg('<p>Нечего экспортировать: сначала откройте или создайте документ.</p>');
  if (target === 'vat-10' && !reportDone) { aiMsg('<p>Сначала соберу расчёт.</p>'); return runReport(); }
  if (target !== currentDoc) { openDoc(target); await sleep(250); }
  const item = DOCS.flatMap(g => g.items).find(x => x.id === currentDoc);
  const name = (item ? item.nm : 'Документ').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'Документ';
  const root = page.querySelector('.doc'); if (!root) return;
  setStatus(`Готовлю ${format.toUpperCase()}…`, true);
  try {
    if (format === 'xlsx') {
      if (currentDoc === 'vat-10') { makeXlsx(); XLSX.writeFile(window._wb, name + '.xlsx'); }
      else { const t = root.querySelector('table'); if (!t) { aiMsg('<p>В этом документе нет таблицы, сохраню в PDF.</p>'); return exportDoc(currentDoc, 'pdf'); } XLSX.writeFile(XLSX.utils.table_to_book(t), name + '.xlsx'); }
    } else if (format === 'docx') {
      download(await toDocx(root), name + '.docx');
    } else {
      root.classList.add('exporting');
      await html2pdf().set({ margin: [12, 12, 12, 12], filename: name + '.pdf', image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'] } }).from(root).save();
      root.classList.remove('exporting');
    }
    toast(`Скачан ${name}.${format}`, 'download');
    logMsg('m', `скачан файл ${name}.${format}`);
  } catch (e) { console.error(e); aiMsg('<p>Не получилось сформировать файл. Попробуйте другой формат.</p>'); }
  setStatus('Готово');
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

// Offline fallback (no server / no key): keyword intents.
async function localAnswer(s) {
  if (/ндс|qqs|расч[её]т|отч[её]т|hisobot|подготов|tayyorla|собер/.test(s)) return runReport();
  if (/риск|xavf/.test(s)) return aiMsg(reportDone ? `<p>Юрист выделил три риска: покупатели-компании (${C.b2b} из ${D.sales.length}) могут потерять зачёт НДС, оборот рядом с порогом ${mlrd(C.limit)}, и входной НДС ${mln(C.pv)} в месяц больше не зачитывается.</p>` : '<p>Сначала соберу расчёт — скажите «подготовь НДС за октябрь».</p>');
  if (/срок|muddat|когда|qachon/.test(s)) { document.querySelector('[data-tab="dates"]').click(); return aiMsg(`<p>Ближайшие сроки:</p><p>${DATES.slice(0, 3).map(d => `<b>${d.d} ${d.m}</b> — ${esc(d.t)}`).join('<br>')}</p>`); }
  if (/сэконом|экономи|меньше|режим|tejash|ortiqcha|переплач/.test(s)) return aiMsg(reportDone ? `<p>Упрощённый НДС 6% вместо общего режима: минус <b>${mln(C.save)}</b> в месяц на НДС и налог на прибыль 0%.</p>` : '<p>Посчитаю на ваших данных — скажите «подготовь НДС за октябрь».</p>');
  if (/почему|откуда|nega|qayerdan/.test(s)) { setTool('ai'); return aiMsg('<p>Включил ИИ-курсор: кликните по цифре в отчёте.</p>'); }
  aiMsg('<p>Сервер AI сейчас недоступен. Без него я понимаю задачи про НДС, сроки, режимы и риски.</p>');
}
const md = t => esc(t).split(/\n{2,}/).map(p => '<p>' + p.replace(/^#{1,6}\s*(.+)$/gm, '<b>$1</b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>') + '</p>').join('');
async function askBackend(voice = false) {
  // Everything the model may cite. Numbers outside this block are rejected by the server.
  const n = x => String(Math.round(x));
  const ctx = [
    `Компания: ${CO.name}, ИНН ${CO.inn}. Режим: ${CO.regime} (${CO.regimeSub}).`,
    `Период: ${CO.period}. Источник: ${D.sales.length} ЭСФ продаж и ${D.purchases.length} ЭСФ покупок.`,
    `Продажи без НДС: ${n(C.sb)} сум. НДС начислен (12%): ${n(C.sv)} сум. Оборот с НДС: ${n(C.gross)} сум.`,
    `Покупки без НДС: ${n(C.pb)} сум. НДС к зачёту: ${n(C.pv)} сум. Не в зачёт: ${C.nonded.length} ЭСФ (поставщик не плательщик НДС).`,
    `НДС к уплате на общем режиме: ${n(C.pay)} сум.`,
    `Упрощённый НДС по УП-100: ставка 6% со всего оборота, налог на прибыль 0%, входной НДС не зачитывается, действует до 01.01.2030. Сумма: ${n(C.simp)} сум. Экономия на НДС: ${n(C.save)} сум в месяц, ${n(C.save * 12)} сум в год.`,
    `Налог на прибыль на общем режиме: 15%. Сумма прибыли неизвестна (нужна банковская выписка).`,
    `Налог с оборота: недоступен, годовой оборот (октябрь × 12) ${n(C.annual)} сум выше порога 12000 БРВ = ${n(C.limit)} сум.`,
    `Покупатели-компании: ${C.b2b} из ${D.sales.length} ЭСФ продаж.`,
    `Сроки: ${DATES.map(d => `${d.d} ${d.m} — ${d.t}`).join('; ')}.`,
    `Отчёт ${reportDone ? 'собран' : 'ещё не собран'}${approved ? ', Excel и заявление подготовлены' : ''}.`,
    `Документы в пространстве: ${DOCS.flatMap(g => g.items).map(x => x.nm).join(', ')}.`,
    `Сейчас на холсте открыт: ${currentDoc ? (DOCS.flatMap(g => g.items).find(x => x.id === currentDoc)?.nm || currentDoc) : 'стартовый экран'}.`,
    `Сегодня: ${new Date().toLocaleDateString('ru-RU')}.`,
    geoContext(),
    ...Object.values(SOCIAL).map(x => `Соцсеть ${x.platform} @${x.handle || x.url} (${x.title || ''}): подписчики ${x.followers ?? '—'}; ${x.stats ? `разобрано ${x.stats.posts_analyzed} постов, средние ${x.stats.metric} ${x.stats['avg_' + x.stats.metric]}, медиана ${x.stats['median_' + x.stats.metric]}, вовлечённость ${x.stats.engagement_pct}%, постов в неделю ${x.stats.posts_per_week}; лучший формат ${x.stats.by_type[0]?.key} (${x.stats.by_type[0]?.avg}); лучший день ${x.stats.by_weekday[0]?.key}` : 'только публичные счётчики'}${x.advice?.summary ? '; вывод маркетолога: ' + x.advice.summary : ''}`),
    `Неизвестно (не называть цифры): зарплаты, цены на рынке, расходы на бухгалтера, прибыль, данные других компаний. ФИО руководителя, адрес, банковские реквизиты, список сотрудников — неизвестны.`,
    `Файлы-заглушки без содержимого (в демо не загружены): Банковская выписка · окт, Договор аренды цеха, Докладная · инвентаризация.`,
    ...(Object.keys(CREATED).length ? ['Созданные документы (id, название, текст):', ...Object.entries(CREATED).map(([k, v]) => `[${k}] ${v.title}:\n${v.md.slice(0, 1500)}`)] : []),
  ].join('\n');
  const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ctx, voice, docs: DOCS.flatMap(g => g.items).map(({ id, nm }) => ({ id, nm })), messages: chatHist.slice(-10) }) });
  if (!r.ok) return null;
  return await r.json();
}

$('#composer').addEventListener('submit', e => { e.preventDefault(); const t = $('#chatInput').value; $('#chatInput').value = ''; handleText(t); });
$('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
$('#startForm').addEventListener('submit', e => { e.preventDefault(); handleText($('#startInput').value || $('#startInput').placeholder); });
$('#startInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#startForm').requestSubmit(); } });
const CHIPS = ['Подготовь НДС за октябрь и найди, где переплачиваю', 'Какие у меня сроки?', 'Oktabr uchun QQS hisobotini tayyorla'];
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
function startVoice() {
  if (busy) return;
  $('#chat').classList.add('open');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return fakeVoice();
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = lang; rec.interimResults = true; rec.maxAlternatives = 1;
  let final = '', failed = false;
  rec.onresult = e => { final = [...e.results].map(r => r[0].transcript).join(' '); $('#listenTxt').textContent = final; };
  rec.onerror = () => { failed = true; };
  rec.onend = () => { rec = null; listenUI(false); if (final.trim()) handleText(final, true); else if (failed) fakeVoice(); };
  listenUI(true); rec.start();
}
$('#micBtn').onclick = startVoice; $('#micTool').onclick = startVoice; $('#startMic').onclick = startVoice;
$('#ttsBtn').onclick = () => { ttsOn = !ttsOn; $('#ttsBtn').classList.toggle('btn-primary', ttsOn); $('#ttsBtn').classList.toggle('btn-ghost', !ttsOn); toast(ttsOn ? 'Ответы будут озвучиваться' : 'Озвучка выключена', 'volume'); };

// ---------- upload ----------
function addFiles(files) {
  [...files].forEach(f => {
    addDoc('Загружено', { id: 'up-' + crypto.randomUUID(), nm: f.name, tag: (f.name.split('.').pop() || '').toUpperCase().slice(0, 4), ic: /xls|csv/i.test(f.name) ? 'sheet' : 'file' });
    logMsg('b', `прочитал «${f.name}», положил в Документы`);
  });
}
$('#file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('#uploadTool').onclick = () => $('#file').click();
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));

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
  currentDoc = 'geo'; renderTree(); showStart(false);
  $('#frameUrl').textContent = 'Геомодель · карта предприятия';
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
const SOCIAL = {};
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
