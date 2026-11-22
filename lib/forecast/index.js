// Hisob AI — books + XGBoost next-month forecast (Python).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateBooks, forXgb, buildWeeks, expenseMix, dailySeries, monthTotals, openingBalance } from './generate.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const PY = join(DIR, 'xgboost_forecast.py');

let cache = null;

function runPython(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [PY], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(err || `xgboost exit ${code}`));
      try { resolve(JSON.parse(out)); }
      catch (e) { reject(new Error('bad xgboost json: ' + e.message + '\n' + out.slice(0, 400))); }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function weekdayMix(rows) {
  const names = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const acc = names.map(name => ({ name, in: 0, out: 0, n: 0 }));
  rows.forEach(r => {
    const m = String(r.date).match(/(\d+)\.(\d+)\.(\d+)/);
    if (!m) return;
    const wd = new Date(+m[3], +m[2] - 1, +m[1]).getDay();
    acc[wd].n++;
    if (r.type === 'in') acc[wd].in += r.amount; else acc[wd].out += r.amount;
  });
  return acc;
}

function aging(rows) {
  const buckets = { '0': 0, '1–30': 0, '31–60': 0, '60+': 0 };
  rows.forEach(r => {
    const b = r.bucket || (r.age > 60 ? '60+' : r.age > 30 ? '31–60' : r.age > 0 ? '1–30' : '0');
    buckets[b] += r.amount;
  });
  return buckets;
}

function snapshotFrom(books, forecast, vat = {}) {
  const all = [...books.bank, ...books.cash];
  const bankIn = all.filter(x => x.ch === 'bank' && x.type === 'in').reduce((s, x) => s + x.amount, 0);
  const bankOut = all.filter(x => x.ch === 'bank' && x.type === 'out').reduce((s, x) => s + x.amount, 0);
  const cashIn = all.filter(x => x.ch === 'cash' && x.type === 'in').reduce((s, x) => s + x.amount, 0);
  const cashOut = all.filter(x => x.ch === 'cash' && x.type === 'out').reduce((s, x) => s + x.amount, 0);
  // UI "current month" focus = October 2026 (last hist month)
  const oct = (r) => /\.10\.2026$/.test(r.date);
  const octRows = all.filter(oct);
  const inTotal = octRows.filter(x => x.type === 'in').reduce((s, x) => s + x.amount, 0);
  const outTotal = octRows.filter(x => x.type === 'out').reduce((s, x) => s + x.amount, 0);
  const net = inTotal - outTotal;
  const opening = openingBalance();
  const closing = opening + net;
  const arTotal = books.ar.reduce((s, x) => s + x.amount, 0);
  const apTotal = books.ap.reduce((s, x) => s + x.amount, 0);
  const arOverdue = books.ar.filter(x => /просроч|сомнитель/i.test(x.note) || x.age > 14).reduce((s, x) => s + x.amount, 0);
  const weeks = buildWeeks(books);
  const mix = expenseMix(books);
  const F = forecast || {};
  const hist = weeks.map(w => ({ ...w, kind: 'hist' }));
  const forward = F.forward || [];
  const series = [...hist, ...forward];

  const enrichedForecast = {
    ...F,
    hist,
    series,
    method: F.method || 'XGBoost',
    tip: F.tip || '',
    drivers: F.drivers || [],
    scenarios: F.scenarios || [],
    months: (F.months || []).map(m => ({
      ...m,
      marginPct: m.marginPct ?? Math.round(((m.inn - m.out) / Math.max(1, m.inn)) * 1000) / 10,
    })),
  };

  const insights = [
    `История trade: 3 месяца (авг–окт 2026), ${all.length} операций.`,
    `Октябрь: приход ${Math.round(inTotal).toLocaleString('ru-RU')}, расход ${Math.round(outTotal).toLocaleString('ru-RU')}.`,
    `XGBoost → ноябрь: приход ${Math.round(F.nextMonthIn || 0).toLocaleString('ru-RU')} (WAPE ${F.wapeIn ?? '—'}%).`,
    F.tip || '',
  ].filter(Boolean);

  const vatPay = vat.pay || 0;
  const vatSave = vat.save || 0;
  const opportunities = [
    vatSave > 0 && {
      id: 'vat6', priority: 1, title: 'Перейти на упрощённый НДС 6%',
      save: vatSave, saveYear: vatSave * 12,
      why: `На общем режиме НДС к уплате ${vatPay}, на 6% экономия ${vatSave}/мес.`,
      action: 'prepare_vat_switch', cta: 'Подготовить заявление',
    },
    {
      id: 'collect', priority: 2, title: 'Взыскать просроченную дебиторку',
      save: arOverdue, saveYear: arOverdue,
      why: `Просрочено ${arOverdue} — риск для ноябрьского cashflow.`,
      action: 'open_ar', cta: 'Открыть дебиторку',
    },
    {
      id: 'fc', priority: 3, title: 'Спланировать ноябрь по XGBoost',
      save: Math.round((F.nextMargin || 0) * 0.1),
      saveYear: Math.round((F.nextMargin || 0) * 0.1),
      why: F.tip || 'Прогноз trade на ноябрь готов.',
      action: 'open_forecast', cta: 'Открыть прогноз',
    },
  ].filter(Boolean);

  return {
    period: 'октябрь 2026',
    histPeriod: books.period,
    opening, closing, net, inTotal, outTotal,
    bankIn: octRows.filter(x => x.ch === 'bank' && x.type === 'in').reduce((s, x) => s + x.amount, 0),
    bankOut: octRows.filter(x => x.ch === 'bank' && x.type === 'out').reduce((s, x) => s + x.amount, 0),
    cashIn: octRows.filter(x => x.ch === 'cash' && x.type === 'in').reduce((s, x) => s + x.amount, 0),
    cashOut: octRows.filter(x => x.ch === 'cash' && x.type === 'out').reduce((s, x) => s + x.amount, 0),
    arTotal, apTotal, arOverdue,
    runwayDays: Math.max(1, Math.round(closing / Math.max(1, outTotal / 30))),
    collectionDays: Math.max(1, Math.round(arTotal / Math.max(1, inTotal / 30))),
    payDays: Math.max(1, Math.round(apTotal / Math.max(1, outTotal / 30))),
    bank: books.bank.filter(oct),
    cash: books.cash.filter(oct),
    bankAll: books.bank,
    cashAll: books.cash,
    ar: books.ar, ap: books.ap, rent: books.rent, credit: books.credit,
    weeks, expenseMix: mix, insights, forecast: enrichedForecast, opportunities,
    arAging: aging(books.ar), apAging: aging(books.ap),
    weekdays: weekdayMix(octRows),
    opsCount: octRows.length,
    opsCountAll: all.length,
    topIn: [...octRows].filter(x => x.type === 'in').sort((a, b) => b.amount - a.amount).slice(0, 6),
    topOut: [...octRows].filter(x => x.type === 'out').sort((a, b) => b.amount - a.amount).slice(0, 6),
    dueSoon: [
      { id: 'rent', title: 'Аренда цеха · ноябрь', amount: 18000000, date: '05.11.2026', kind: 'аренда' },
      { id: 'credit', title: 'Кредит · транш', amount: 12500000, date: '17.11.2026', kind: 'кредит' },
      ...books.ap.slice(0, 4).map(x => ({ id: 'ap-' + x.inn, title: x.name, amount: x.amount, date: x.due, kind: 'кредиторка' })),
    ],
    monthHist: monthTotals(books),
    dailyHist: dailySeries(books),
  };
}

export async function buildBundle(vat = {}) {
  if (cache && !vat.pay) return cache;
  const books = generateBooks();
  const payload = forXgb(books);
  const forecast = await runPython(payload);
  const snapshot = snapshotFrom(books, forecast, vat);
  const bundle = { books, forecast, snapshot, builtAt: new Date().toISOString() };
  if (!vat.pay)   cache = bundle;
  return bundle;
}

export function getCache() { return cache; }
export function clearCache() { cache = null; }

export async function warm() {
  const t0 = Date.now();
  clearCache();
  const b = await buildBundle();
  console.log(`Forecast XGBoost ready in ${Date.now() - t0}ms · Nov in=${Math.round((b.forecast.nextMonthIn || 0) / 1e6)}m WAPE=${b.forecast.wapeIn}%`);
  return b;
}
