// Hisob AI — 3 months (Aug–Oct 2026) realistic bakery trade books (deterministic seed).
// Categories: эквайринг, розница, B2B | сырьё, упаковка, коммунальные, логистика,
// аренда, зарплата, налог, кредит, хоз.

const pad = n => String(n).padStart(2, '0');
const dstr = (y, m, d) => `${pad(d)}.${pad(m)}.${y}`;
const sum = (arr, pred = () => true) => arr.filter(pred).reduce((s, x) => s + (x.amount || 0), 0);

function rng(seed) {
  let x = seed % 2147483647;
  return () => (x = (x * 48271) % 2147483647) / 2147483647;
}

const BUYERS = [
  { name: '«SAMO TRADE» OK', inn: '300910111' },
  { name: '«BARAKA SHOP» MCHJ', inn: '306235241' },
  { name: '«KAMALAK SAVDO» XK', inn: '303702037' },
  { name: '«SHIRIN TA`M» OK', inn: '307115764' },
  { name: '«OQ YO`L MARKET» OK', inn: '302630829' },
  { name: '«ISTIQLOL MARKET» MCHJ', inn: '304137655' },
  { name: '«ZARAFSHON FOOD» MCHJ', inn: '309090608' },
  { name: '«TONG OTAR» XK', inn: '301073060' },
];
const SUPPLIERS = [
  { name: '«OLTIN BUG`DOY» MCHJ', inn: '301541955', cat: 'сырьё' },
  { name: '«NONPAKET» MCHJ', inn: '308441120', cat: 'упаковка' },
  { name: 'Газ / электричество', inn: '201122301', cat: 'коммунальные' },
  { name: '«LOGISTIKA PLUS»', inn: '306778901', cat: 'логистика' },
];

/** Month growth vs Aug base: bakery late summer → autumn school season */
const MONTH_MULT = { 8: 0.92, 9: 1.0, 10: 1.08 };

export function generateBooks(seed = 20261022) {
  const R = rng(seed);
  const bank = [];
  const cash = [];

  const months = [
    { y: 2026, m: 8, days: 31 },
    { y: 2026, m: 9, days: 30 },
    { y: 2026, m: 10, days: 31 },
  ];

  for (const { y, m, days } of months) {
    const mm = MONTH_MULT[m] || 1;
    for (let day = 1; day <= days; day++) {
      const wd = new Date(y, m - 1, day).getDay();
      if (wd === 0) continue; // rest Sunday
      const weekendBoost = wd === 6 ? 1.22 : wd === 5 ? 1.08 : 1;
      // cooler mornings in Oct → slightly higher bread demand
      const seasonDay = 1 + 0.04 * Math.sin((day / days) * Math.PI);
      const retail = Math.round((8.2 + R() * 5.8) * 1e6 * mm * weekendBoost * seasonDay);
      const cardShare = 0.70 + R() * 0.12;
      const card = Math.round(retail * cardShare);
      bank.push({ date: dstr(y, m, day), type: 'in', ch: 'bank', cat: 'эквайринг', name: 'Эквайринг / карта', inn: '', amount: card, note: `розница ${pad(day)}.${pad(m)}` });
      cash.push({ date: dstr(y, m, day), type: 'in', ch: 'cash', cat: 'розница', name: 'Наличная розница', amount: retail - card, note: 'касса цех' });

      if (day % 3 === 0 || (day % 5 === 0 && R() > 0.35)) {
        const b = BUYERS[Math.floor(R() * BUYERS.length)];
        const amt = Math.round((3.5 + R() * 16) * 1e6 * mm);
        bank.push({ date: dstr(y, m, day), type: 'in', ch: 'bank', cat: 'B2B', name: `Оплата от ${b.name}`, inn: b.inn, amount: amt, note: 'по ЭСФ / счёт' });
      }
      if (day % 2 === 0) {
        // variable COGS/ops only — коммунальные go on calendar day 10
        const variable = SUPPLIERS.filter(s => s.cat !== 'коммунальные');
        const s = variable[Math.floor(R() * variable.length)];
        const base = s.cat === 'сырьё' ? (1.2 + R() * 5.5) : s.cat === 'логистика' ? (0.6 + R() * 2.2) : (0.5 + R() * 2.8);
        bank.push({ date: dstr(y, m, day), type: 'out', ch: 'bank', cat: s.cat, name: s.name, inn: s.inn, amount: Math.round(base * 1e6 * mm), note: 'оплата поставщику' });
      }
      if (R() > 0.58) {
        cash.push({ date: dstr(y, m, day), type: 'out', ch: 'cash', cat: 'хоз', name: 'Мелкие хозрасходы', amount: Math.round((0.2 + R() * 0.95) * 1e6), note: 'пакеты, размен' });
      }
    }

    // Fixed monthly cycle (realistic Uzbek SMB calendar)
    const rent = m >= 9 ? 18000000 : 17000000;
    const kommunal = Math.round((5.8 + R() * 1.4) * 1e6 * (m === 10 ? 1.08 : 1)); // heating starts
    const vatPrev = Math.round((28 + R() * 8) * 1e6 * (MONTH_MULT[m === 8 ? 8 : m - 1] || 1));
    const social = Math.round((9.5 + R() * 2.2) * 1e6);
    bank.push(
      { date: dstr(y, m, 5), type: 'out', ch: 'bank', cat: 'аренда', name: `Аренда цеха · ${pad(m)}.${y}`, inn: '305112200', amount: rent, note: 'договор аренды' },
      { date: dstr(y, m, 10), type: 'out', ch: 'bank', cat: 'коммунальные', name: 'Газ и электричество', inn: '201122301', amount: kommunal, note: 'счёт за прошлый месяц' },
      { date: dstr(y, m, 15), type: 'out', ch: 'bank', cat: 'зарплата', name: 'Зарплата (аванс)', inn: '', amount: Math.round(26e6 * mm), note: '12 сотрудников' },
      { date: dstr(y, m, 17), type: 'out', ch: 'bank', cat: 'кредит', name: 'Кредит · Uzmilliybank', inn: '207274265', amount: 12500000, note: 'транш кредита' },
      { date: dstr(y, m, 22), type: 'out', ch: 'bank', cat: 'налог', name: 'НДС (уплата)', inn: '', amount: vatPrev, note: 'my.soliq.uz' },
      { date: dstr(y, m, 28), type: 'out', ch: 'bank', cat: 'зарплата', name: 'Зарплата (остаток)', inn: '', amount: Math.round(24e6 * mm), note: '12 сотрудников' },
      { date: dstr(y, m, Math.min(30, days)), type: 'out', ch: 'bank', cat: 'налог', name: 'Соцналог + НДФЛ', inn: '', amount: social, note: 'за предыдущий месяц' },
    );
  }

  const ar = [
    { name: '«SAMO TRADE» OK', inn: '300910111', amount: 12500000, due: '05.11.2026', age: 12, bucket: '1–30', note: 'остаток по ЭСФ' },
    { name: '«BARAKA SHOP» MCHJ', inn: '306235241', amount: 4800000, due: '28.10.2026', age: 25, bucket: '1–30', note: 'просрочено' },
    { name: '«ISTIQLOL MARKET» MCHJ', inn: '304137655', amount: 3200000, due: '10.11.2026', age: 8, bucket: '1–30', note: 'ЭСФ октябрь' },
    { name: '«KAMALAK SAVDO» XK', inn: '303702037', amount: 7600000, due: '12.11.2026', age: 6, bucket: '1–30', note: 'отсрочка 14 дней' },
    { name: '«ZARAFSHON FOOD» MCHJ', inn: '309090608', amount: 2150000, due: '15.10.2026', age: 38, bucket: '31–60', note: 'просрочено · претензия' },
    { name: '«TONG OTAR» XK', inn: '301073060', amount: 1900000, due: '20.09.2026', age: 62, bucket: '60+', note: 'сомнительный долг' },
    { name: '«OQ YO`L MARKET» OK', inn: '302630829', amount: 4100000, due: '08.11.2026', age: 10, bucket: '1–30', note: 'частичная оплата была' },
    { name: '«SHIRIN TA`M» OK', inn: '307115764', amount: 5400000, due: '18.11.2026', age: 4, bucket: '1–30', note: 'новая отгрузка' },
  ];
  const ap = [
    { name: '«OLTIN BUG`DOY» MCHJ', inn: '301541955', amount: 9200000, due: '03.11.2026', age: 8, bucket: '1–30', note: 'мука · счёт' },
    { name: '«NONPAKET» MCHJ', inn: '308441120', amount: 2450000, due: '06.11.2026', age: 5, bucket: '1–30', note: 'упаковка' },
    { name: 'Газ / электричество', inn: '201122301', amount: 7100000, due: '08.11.2026', age: 2, bucket: '1–30', note: 'октябрь' },
    { name: 'Арендодатель цеха', inn: '305112200', amount: 18000000, due: '05.11.2026', age: 0, bucket: '1–30', note: 'ноябрьская аренда' },
    { name: '«LOGISTIKA PLUS»', inn: '306778901', amount: 3600000, due: '11.11.2026', age: 3, bucket: '1–30', note: 'доставка сырья' },
    { name: 'Uzmilliybank · %%', inn: '207274265', amount: 1950000, due: '17.11.2026', age: 0, bucket: '1–30', note: 'проценты в составе платежа' },
  ];
  const rent = [
    { month: 'август 2026', amount: 17000000, status: 'оплачено', date: '05.08.2026' },
    { month: 'сентябрь 2026', amount: 18000000, status: 'оплачено', date: '05.09.2026' },
    { month: 'октябрь 2026', amount: 18000000, status: 'оплачено', date: '05.10.2026' },
    { month: 'ноябрь 2026', amount: 18000000, status: 'к оплате', date: '05.11.2026' },
    { month: 'декабрь 2026', amount: 18500000, status: 'план', date: '05.12.2026' },
  ];
  const credit = {
    bank: 'Uzmilliybank', product: 'Оборотный кредит МСП', principal: 150000000, rate: 0.24,
    monthly: 12500000, left: 97500000, nextDue: '17.11.2026',
    schedule: [
      { date: '17.08.2026', amount: 12500000, status: 'оплачено' },
      { date: '17.09.2026', amount: 12500000, status: 'оплачено' },
      { date: '17.10.2026', amount: 12500000, status: 'оплачено' },
      { date: '17.11.2026', amount: 12500000, status: 'к оплате' },
      { date: '17.12.2026', amount: 12500000, status: 'план' },
      { date: '17.01.2027', amount: 12500000, status: 'план' },
    ],
  };

  return { bank, cash, ar, ap, rent, credit, period: 'август–октябрь 2026', seed };
}

function parseDate(s) {
  const m = String(s).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function weekKey(dt) {
  const t = new Date(dt.getFullYear(), 0, 1);
  const w = Math.floor((dt - t) / 86400000 / 7) + 1;
  return `${dt.getFullYear()}-W${pad(w)}`;
}

export function dailySeries(books) {
  const map = new Map();
  const add = (row) => {
    const dt = parseDate(row.date); if (!dt) return;
    const k = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    if (!map.has(k)) map.set(k, { date: k, iso: dt.toISOString().slice(0, 10), inn: 0, out: 0, byCat: {} });
    const x = map.get(k);
    const cat = row.cat || 'прочее';
    if (row.type === 'in') { x.inn += row.amount; x.byCat[cat] = (x.byCat[cat] || 0) + row.amount; }
    else { x.out += row.amount; x.byCat[cat] = (x.byCat[cat] || 0) - row.amount; } // out as negative in byCat for clarity? better separate
  };
  // rebuild byCat properly
  map.clear();
  for (const row of [...books.bank, ...books.cash]) {
    const dt = parseDate(row.date); if (!dt) continue;
    const k = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    if (!map.has(k)) map.set(k, { date: k, iso: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`, dow: dt.getDay(), dom: dt.getDate(), month: dt.getMonth() + 1, inn: 0, out: 0, cats: {} });
    const x = map.get(k);
    const cat = row.cat || 'прочее';
    if (!x.cats[cat]) x.cats[cat] = { in: 0, out: 0 };
    if (row.type === 'in') { x.inn += row.amount; x.cats[cat].in += row.amount; }
    else { x.out += row.amount; x.cats[cat].out += row.amount; }
  }
  return [...map.values()].sort((a, b) => a.iso.localeCompare(b.iso));
}

export function buildWeeks(books) {
  const days = dailySeries(books);
  const map = new Map();
  days.forEach(d => {
    const dt = new Date(d.iso);
    const label = weekKey(dt);
    if (!map.has(label)) map.set(label, { label, inn: 0, out: 0, n: 0 });
    const w = map.get(label);
    w.inn += d.inn; w.out += d.out; w.n++;
  });
  return [...map.values()].map((w, i) => ({
    ...w, week: i + 1,
    margin: w.inn - w.out,
    marginPct: Math.round(((w.inn - w.out) / Math.max(1, w.inn)) * 1000) / 10,
  }));
}

export function monthTotals(books) {
  const days = dailySeries(books);
  const map = new Map();
  days.forEach(d => {
    const key = d.iso.slice(0, 7);
    if (!map.has(key)) map.set(key, { month: key, inn: 0, out: 0, cats: {} });
    const m = map.get(key);
    m.inn += d.inn; m.out += d.out;
    for (const [c, v] of Object.entries(d.cats)) {
      if (!m.cats[c]) m.cats[c] = { in: 0, out: 0 };
      m.cats[c].in += v.in; m.cats[c].out += v.out;
    }
  });
  return [...map.values()];
}

export function expenseMix(books) {
  const m = {};
  [...books.bank, ...books.cash].filter(r => r.type === 'out').forEach(r => {
    const k = r.cat || 'прочее';
    m[k] = (m[k] || 0) + r.amount;
  });
  return Object.entries(m).map(([cat, amount]) => ({ cat, amount })).sort((a, b) => b.amount - a.amount);
}

export function openingBalance() { return 48500000; }

export function forXgb(books) {
  return {
    daily: dailySeries(books),
    months: monthTotals(books),
    cats: [...new Set([...books.bank, ...books.cash].map(r => r.cat || 'прочее'))].sort(),
  };
}
