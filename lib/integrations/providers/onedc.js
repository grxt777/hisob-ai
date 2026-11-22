// 1C:Enterprise — OData / HTTP-сервис. Live: published base URL; sandbox: local demo.
import { invoice, bundle } from '../normalize.js';

const DEFAULT_URL = process.env.ONEC_API_URL || 'http://localhost/hisob/odata/standard.odata';

async function api(cfg, path, opts = {}) {
  const base = (cfg.apiUrl || DEFAULT_URL).replace(/\/$/, '');
  const headers = {
    Accept: 'application/json',
    ...(opts.headers || {}),
  };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  else if (cfg.login) headers.Authorization = 'Basic ' + Buffer.from(`${cfg.login}:${cfg.password || ''}`).toString('base64');
  const r = await fetch(base + path, { ...opts, headers, signal: AbortSignal.timeout(25000) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* */ }
  if (!r.ok) throw new Error(json?.['odata.error']?.message?.value || json?.message || `1C HTTP ${r.status}`);
  return json;
}

function mapRow(r, kind) {
  return invoice({
    name: r.КонтрагентНаименование || r.CounterpartyName || r.Partner || r.name,
    inn: r.КонтрагентИНН || r.INN || r.inn,
    num: r.Number || r.Номер || r.num,
    date: r.Date || r.Дата || r.date,
    base: r.Sum || r.СуммаДокумента || r.base,
    vat: r.VATSum || r.СуммаНДС || r.vat,
    note: r.НеПринимаетсяКВычету || r.notDeductible ? 'не в зачёт' : undefined,
  }, kind);
}

export async function test(cfg) {
  if (cfg.mode === 'sandbox') return { ok: true, mode: 'sandbox', message: 'Песочница 1С: синхронизация без публикации базы.' };
  if (!cfg.apiUrl) return { ok: false, message: 'Укажите URL опубликованного OData / HTTP-сервиса 1С.' };
  if (!cfg.login && !cfg.token) return { ok: false, message: 'Нужен логин 1С или token.' };
  try {
    await api(cfg, '/$metadata');
    return { ok: true, mode: 'live', message: '1С OData доступен. Можно забирать счета-фактуры.' };
  } catch (e) {
    // Some bases block $metadata but answer entity sets — try a light ping.
    try {
      await api(cfg, '/');
      return { ok: true, mode: 'live', message: 'Сервер 1С ответил.' };
    } catch {
      return { ok: false, message: e.message };
    }
  }
}

export async function sync(cfg, { demo, period } = {}) {
  if (cfg.mode === 'sandbox' || !cfg.apiUrl) {
    return bundle({
      sales: (demo?.sales || []).map(r => ({ ...r })),
      purchases: (demo?.purchases || []).map(r => ({ ...r })),
      company: { name: cfg.company || demo?.company?.name, inn: cfg.inn },
      source: 'onedc',
      period: period || 'октябрь 2026',
    });
  }
  const salesPaths = [
    '/Document_СчетФактураВыданный?$format=json&$top=500',
    '/Document_InvoiceIssued?$format=json&$top=500',
    '/hs/hisob/sales',
  ];
  const purchPaths = [
    '/Document_СчетФактураПолученный?$format=json&$top=500',
    '/Document_InvoiceReceived?$format=json&$top=500',
    '/hs/hisob/purchases',
  ];
  let salesRaw = null, purchRaw = null, err = null;
  for (const p of salesPaths) {
    try { salesRaw = await api(cfg, p); break; } catch (e) { err = e; }
  }
  for (const p of purchPaths) {
    try { purchRaw = await api(cfg, p); break; } catch (e) { err = e; }
  }
  const rows = x => Array.isArray(x) ? x : (x?.value || x?.data || []);
  const sales = rows(salesRaw).map(r => mapRow(r, 'sales'));
  const purchases = rows(purchRaw).map(r => mapRow(r, 'purchases'));
  if (!sales.length && !purchases.length) {
    throw new Error(err?.message || '1С не вернула счета-фактуры. Опубликуйте OData или HTTP-сервис hisob.');
  }
  return bundle({
    sales, purchases,
    company: { name: cfg.company, inn: cfg.inn },
    source: 'onedc',
    period: period || 'из 1С',
  });
}

export const meta = {
  id: 'onedc',
  name: '1C',
  title: '1С · бухгалтерия',
  blurb: 'OData или HTTP-сервис вашей базы 1С:Бухгалтерия. Логин пользователя 1С и URL публикации.',
  fields: [
    { key: 'apiUrl', label: 'OData / HTTP URL', placeholder: DEFAULT_URL },
    { key: 'inn', label: 'ИНН организации', placeholder: '300000001' },
    { key: 'company', label: 'Название', placeholder: '«BARAKA NON» MCHJ' },
    { key: 'login', label: 'Логин 1С', placeholder: 'Администратор' },
    { key: 'password', label: 'Пароль 1С', placeholder: '••••••••', secret: true },
    { key: 'token', label: 'Token (если используется)', placeholder: 'optional', secret: true },
  ],
  defaultUrl: DEFAULT_URL,
};
