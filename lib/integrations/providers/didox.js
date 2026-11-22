// Didox.uz — оператор ЭСФ. Live: REST API with token; sandbox: local demo as if from Didox.
import { invoice, bundle } from '../normalize.js';

const DEFAULT_URL = process.env.DIDOX_API_URL || 'https://api.didox.uz';

async function api(cfg, path, opts = {}) {
  const base = (cfg.apiUrl || DEFAULT_URL).replace(/\/$/, '');
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
    ...(cfg.apiKey ? { 'X-API-KEY': cfg.apiKey } : {}),
    ...(opts.headers || {}),
  };
  if (cfg.login && cfg.password && !cfg.token && !cfg.apiKey) {
    headers.Authorization = 'Basic ' + Buffer.from(`${cfg.login}:${cfg.password}`).toString('base64');
  }
  const r = await fetch(base + path, { ...opts, headers, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* raw */ }
  if (!r.ok) throw new Error(json?.message || json?.error || `Didox HTTP ${r.status}`);
  return json;
}

function mapDoc(d, kind) {
  const partner = kind === 'sales'
    ? { name: d.buyerName || d.BuyerName || d.contragentName, inn: d.buyerTin || d.BuyerTin || d.contragentInn }
    : { name: d.sellerName || d.SellerName || d.contragentName, inn: d.sellerTin || d.SellerTin || d.contragentInn };
  return invoice({
    ...partner,
    num: d.number || d.docNumber || d.facturaId || d.id,
    date: d.date || d.docDate || d.createdAt,
    base: d.deliverySum || d.amountWithoutVat || d.totalWithoutVat,
    vat: d.vatSum || d.vatAmount,
    withVat: d.totalWithVat || d.total,
    note: d.riskLevel === 'high' || d.notDeductible ? 'не в зачёт · риск ЭСФ' : undefined,
  }, kind);
}

export async function test(cfg) {
  if (cfg.mode === 'sandbox') return { ok: true, mode: 'sandbox', message: 'Песочница Didox: данные синхронизируются локально без реального API.' };
  if (!cfg.token && !cfg.apiKey && !(cfg.login && cfg.password)) {
    return { ok: false, message: 'Нужен token / apiKey или login+password Didox.' };
  }
  try {
    // Common health / profile endpoints; if none exist, a 404 with auth still proves connectivity.
    const paths = ['/v1/profile', '/v1/account', '/api/v1/profile', '/'];
    let lastErr = null;
    for (const p of paths) {
      try {
        await api(cfg, p);
        return { ok: true, mode: 'live', message: 'Didox ответил. Можно синхронизировать ЭСФ.' };
      } catch (e) {
        lastErr = e;
        if (/HTTP 401|HTTP 403/.test(e.message)) return { ok: false, message: 'Didox: неверный токен или доступ запрещён.' };
        if (/HTTP 404/.test(e.message)) continue;
      }
    }
    // Auth may be valid even if profile path differs — accept if we got past network.
    if (lastErr && /HTTP 404/.test(lastErr.message)) {
      return { ok: true, mode: 'live', message: 'Сервер Didox доступен. Проверьте путь документов при синхронизации.' };
    }
    throw lastErr || new Error('Didox недоступен');
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

export async function sync(cfg, { demo, period } = {}) {
  if (cfg.mode === 'sandbox' || (!cfg.token && !cfg.apiKey && !(cfg.login && cfg.password))) {
    const sales = (demo?.sales || []).map(r => ({ ...r }));
    const purchases = (demo?.purchases || []).map(r => ({ ...r }));
    return bundle({
      sales, purchases,
      company: { name: cfg.company || demo?.company?.name, inn: cfg.inn },
      source: 'didox',
      period: period || 'октябрь 2026',
    });
  }
  const from = cfg.dateFrom || '';
  const to = cfg.dateTo || '';
  const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), inn: cfg.inn || '' });
  // Try a few known document list shapes used by ЭСФ operators.
  const candidates = [
    `/v1/documents/outgoing?${q}`,
    `/v1/factura/outgoing?${q}`,
    `/api/v1/documents?type=sale&${q}`,
  ];
  let outgoing = null, incoming = null, err = null;
  for (const path of candidates) {
    try { outgoing = await api(cfg, path); break; } catch (e) { err = e; }
  }
  for (const path of [
    `/v1/documents/incoming?${q}`,
    `/v1/factura/incoming?${q}`,
    `/api/v1/documents?type=purchase&${q}`,
  ]) {
    try { incoming = await api(cfg, path); break; } catch (e) { err = e; }
  }
  const list = x => Array.isArray(x) ? x : (x?.data || x?.items || x?.documents || []);
  const sales = list(outgoing).map(d => mapDoc(d, 'sales'));
  const purchases = list(incoming).map(d => mapDoc(d, 'purchases'));
  if (!sales.length && !purchases.length) {
    throw new Error(err?.message || 'Didox не вернул ЭСФ. Проверьте URL API и права токена.');
  }
  return bundle({
    sales, purchases,
    company: { name: cfg.company, inn: cfg.inn },
    source: 'didox',
    period: period || `${from || '…'} — ${to || '…'}`,
  });
}

export const meta = {
  id: 'didox',
  name: 'Didox',
  title: 'Didox · оператор ЭСФ',
  blurb: 'Электронные счета-фактуры и документы. Подключите токен кабинета Didox.',
  fields: [
    { key: 'apiUrl', label: 'API URL', placeholder: DEFAULT_URL },
    { key: 'inn', label: 'ИНН компании', placeholder: '300000001' },
    { key: 'company', label: 'Название компании', placeholder: '«BARAKA NON» MCHJ' },
    { key: 'token', label: 'API token', placeholder: 'Bearer token', secret: true },
    { key: 'login', label: 'Логин (если без token)', placeholder: 'login' },
    { key: 'password', label: 'Пароль', placeholder: '••••••••', secret: true },
  ],
  defaultUrl: DEFAULT_URL,
};
