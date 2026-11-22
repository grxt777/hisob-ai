// my.soliq.uz / налоговый кабинет.
// Официального открытого API для МСБ часто нет — поддерживаем:
//  1) песочницу, 2) URL+token оператора/шлюза, 3) импорт выгрузки ЭСФ (Excel/JSON) как канал Soliq.
import { invoice, bundle } from '../normalize.js';

const DEFAULT_URL = process.env.SOLIQ_API_URL || 'https://my.soliq.uz';

async function api(cfg, path, opts = {}) {
  const base = (cfg.apiUrl || DEFAULT_URL).replace(/\/$/, '');
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
    ...(cfg.apiKey ? { 'X-API-KEY': cfg.apiKey } : {}),
    ...(opts.headers || {}),
  };
  if (cfg.login && cfg.password && !cfg.token) {
    headers.Authorization = 'Basic ' + Buffer.from(`${cfg.login}:${cfg.password}`).toString('base64');
  }
  const r = await fetch(base + path, { ...opts, headers, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* */ }
  if (!r.ok) throw new Error(json?.message || json?.error || `Soliq HTTP ${r.status}`);
  return json;
}

export async function test(cfg) {
  if (cfg.mode === 'sandbox') {
    return { ok: true, mode: 'sandbox', message: 'Песочница Soliq: ЭСФ подтянутся локально. Для боя — token шлюза или выгрузка из my.soliq.uz.' };
  }
  if (!cfg.token && !cfg.apiKey && !(cfg.login && cfg.password)) {
    return { ok: false, message: 'Укажите token шлюза my.soliq / оператора ЭСФ, либо используйте песочницу / импорт выгрузки.' };
  }
  try {
    const paths = ['/api/profile', '/api/v1/taxpayer', '/cabinet/api/me'];
    let last = null;
    for (const p of paths) {
      try {
        await api(cfg, p);
        return { ok: true, mode: 'live', message: 'Шлюз Soliq ответил. Можно синхронизировать реестры ЭСФ.' };
      } catch (e) {
        last = e;
        if (/HTTP 401|HTTP 403/.test(e.message)) return { ok: false, message: 'Soliq: доступ запрещён — проверьте token.' };
      }
    }
    if (last && /HTTP 404/.test(last.message)) {
      return { ok: true, mode: 'live', message: 'Сервер доступен. Если sync пустой — загрузите выгрузку ЭСФ из кабинета.' };
    }
    throw last || new Error('Soliq недоступен');
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

export async function sync(cfg, { demo, period, upload } = {}) {
  // Direct JSON upload from my.soliq Excel→JSON converter or client parse
  if (upload?.sales || upload?.purchases) {
    return bundle({
      sales: (upload.sales || []).map(r => invoice(r, 'sales')),
      purchases: (upload.purchases || []).map(r => invoice(r, 'purchases')),
      company: { name: cfg.company || upload.company?.name, inn: cfg.inn || upload.company?.inn },
      source: 'soliq',
      period: period || upload.period || 'из выгрузки my.soliq',
    });
  }

  if (cfg.mode === 'sandbox' || (!cfg.token && !cfg.apiKey && !(cfg.login && cfg.password))) {
    return bundle({
      sales: (demo?.sales || []).map(r => ({ ...r })),
      purchases: (demo?.purchases || []).map(r => ({ ...r })),
      company: { name: cfg.company || demo?.company?.name, inn: cfg.inn },
      source: 'soliq',
      period: period || 'октябрь 2026',
    });
  }

  const q = new URLSearchParams({ inn: cfg.inn || '', ...(cfg.dateFrom ? { from: cfg.dateFrom } : {}), ...(cfg.dateTo ? { to: cfg.dateTo } : {}) });
  let salesRaw = null, purchRaw = null, err = null;
  for (const p of [`/api/esf/sales?${q}`, `/api/v1/invoices/out?${q}`, `/cabinet/api/esf/out?${q}`]) {
    try { salesRaw = await api(cfg, p); break; } catch (e) { err = e; }
  }
  for (const p of [`/api/esf/purchases?${q}`, `/api/v1/invoices/in?${q}`, `/cabinet/api/esf/in?${q}`]) {
    try { purchRaw = await api(cfg, p); break; } catch (e) { err = e; }
  }
  const list = x => Array.isArray(x) ? x : (x?.data || x?.items || x?.rows || []);
  const sales = list(salesRaw).map(r => invoice(r, 'sales'));
  const purchases = list(purchRaw).map(r => invoice({
    ...r,
    note: r.riskLevel === 'high' || r.risk === 'high' ? 'не в зачёт · высокий риск ЭСФ (2026)' : r.note,
  }, 'purchases'));

  if (!sales.length && !purchases.length) {
    throw new Error(err?.message || 'Soliq не вернул ЭСФ. Загрузите выгрузку из my.soliq.uz или укажите рабочий API шлюза.');
  }
  return bundle({
    sales, purchases,
    company: { name: cfg.company, inn: cfg.inn },
    source: 'soliq',
    period: period || 'из Soliq',
  });
}

export const meta = {
  id: 'soliq',
  name: 'Soliq',
  title: 'my.soliq.uz',
  blurb: 'Налоговый кабинет. Песочница, шлюз API или выгрузка реестра ЭСФ из кабинета.',
  fields: [
    { key: 'apiUrl', label: 'API / шлюз URL', placeholder: DEFAULT_URL },
    { key: 'inn', label: 'ИНН', placeholder: '300000001' },
    { key: 'company', label: 'Название компании', placeholder: '«BARAKA NON» MCHJ' },
    { key: 'login', label: 'Логин кабинета', placeholder: 'login' },
    { key: 'password', label: 'Пароль', placeholder: '••••••••', secret: true },
    { key: 'token', label: 'Token шлюза', placeholder: 'optional', secret: true },
  ],
  defaultUrl: DEFAULT_URL,
  supportsUpload: true,
};
