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
  { id: 'a', name: 'Аналитик', color: '#2563eb', role: 'режимы и прогноз' },
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
  const t0 = performance.now();
  return new Promise(res => {
    const step = t => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = f(to * e); k < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
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
  currentDoc = id; renderTree(); showStart(false);
  const item = DOCS.flatMap(g => g.items).find(x => x.id === id);
  $('#frameUrl').textContent = item ? item.nm : 'hisob.ai';
  if (id === 'vat-10') { if (reportDone) fillReportInstant(); return; }
  if (id === 'esf-s') page.innerHTML = `<div class="doc"><div class="doc-h"><div><h1>ЭСФ · продажи</h1><p>${D.sales.length} счетов-фактур за ${CO.period}</p></div></div><div class="tbl-wrap" style="max-height:none"><table class="rg"><thead>${headS}</thead><tbody>${D.sales.map(rowS).join('')}</tbody><tfoot><tr><td colspan="5">Итого</td><td class="n" data-x="sb">${fmt(C.sb)}</td><td class="n" data-x="sv">${fmt(C.sv)}</td></tr></tfoot></table></div></div>`;
  else if (id === 'esf-p') page.innerHTML = `<div class="doc"><div class="doc-h"><div><h1>ЭСФ · покупки</h1><p>${D.purchases.length} счетов-фактур за ${CO.period}</p></div></div><div class="tbl-wrap" style="max-height:none"><table class="rg"><thead>${headP}</thead><tbody>${D.purchases.map(rowP).join('')}</tbody><tfoot><tr><td colspan="5">Итого</td><td class="n" data-x="pb">${fmt(C.pb)}</td><td class="n" data-x="pv">${fmt(C.pv)}</td><td></td></tr></tfoot></table></div></div>`;
  else if (id === 'app-6') page.innerHTML = applicationDoc();
  else if (id === 'vat-09' || id === 'profit-q3') page.innerHTML = letterDoc({ title: item.nm, chip: 'Сдан · демо-данные', sign: false, body: `<p>Отчёт за прошлый период хранится здесь, чтобы агенты сравнивали динамику: рост продаж, изменение НДС к уплате, сезонность.</p><p class="muted">В рабочей версии сюда подгружается документ из кабинета налоговой или загруженный вами файл.</p>` });
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
