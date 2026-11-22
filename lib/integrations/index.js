import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import * as didox from './providers/didox.js';
import * as onedc from './providers/onedc.js';
import * as soliq from './providers/soliq.js';
import { invoice, bundle } from './normalize.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PROVIDERS = { soliq, didox, onedc };

const FILE_DEMO = (() => {
  const src = readFileSync(join(ROOT, 'public', 'assets', 'data.js'), 'utf8');
  return JSON.parse(src.slice(src.indexOf('=') + 1).trim().replace(/;\s*$/, ''));
})();

export function catalog() {
  return Object.values(PROVIDERS).map(p => ({
    ...p.meta,
    connection: store.publicProvider(p.meta.id, store.loadConnections().providers[p.meta.id]),
  }));
}

export function status() {
  const c = store.loadConnections();
  const live = store.loadLive();
  return {
    activeSource: c.activeSource || 'demo',
    providers: catalog(),
    live: live ? {
      source: live.source,
      period: live.period,
      syncedAt: live.syncedAt,
      sales: live.sales?.length || 0,
      purchases: live.purchases?.length || 0,
      company: live.company || null,
    } : null,
  };
}

/** Invoice books used by chat tools and UI — live sync wins over file demo. */
export function getInvoiceData() {
  const live = store.loadLive();
  if (live && (live.sales?.length || live.purchases?.length) && live.source !== 'demo') {
    return {
      sales: live.sales || [],
      purchases: live.purchases || [],
      company: live.company || {},
      source: live.source,
      period: live.period || '',
      syncedAt: live.syncedAt,
    };
  }
  return {
    sales: FILE_DEMO.sales || [],
    purchases: FILE_DEMO.purchases || [],
    company: {},
    source: 'demo',
    period: 'октябрь 2026',
    syncedAt: null,
  };
}

export function fileDemo() { return FILE_DEMO; }

export async function connect(id, body = {}) {
  const p = PROVIDERS[id];
  if (!p) throw Object.assign(new Error('unknown provider'), { status: 404 });
  const mode = body.mode === 'live' ? 'live' : 'sandbox';
  const patch = {
    enabled: true,
    mode,
    status: 'connecting',
    inn: String(body.inn || '').replace(/\D/g, '').slice(0, 14),
    login: String(body.login || '').slice(0, 120),
    company: String(body.company || '').slice(0, 160),
    apiUrl: String(body.apiUrl || p.meta.defaultUrl || '').slice(0, 400),
    dateFrom: body.dateFrom || '',
    dateTo: body.dateTo || '',
    lastError: null,
  };
  if (body.password != null) patch.password = String(body.password).slice(0, 200);
  if (body.token != null) patch.token = String(body.token).slice(0, 500);
  if (body.apiKey != null) patch.apiKey = String(body.apiKey).slice(0, 500);

  store.setProvider(id, patch);
  const cfg = store.loadConnections().providers[id];
  const t = await p.test(cfg);
  const next = store.setProvider(id, {
    status: t.ok ? 'connected' : 'error',
    connectedAt: t.ok ? new Date().toISOString() : cfg.connectedAt || null,
    lastError: t.ok ? null : t.message,
  });
  return { ok: t.ok, message: t.message, provider: next };
}

export async function testConnection(id) {
  const p = PROVIDERS[id];
  if (!p) throw Object.assign(new Error('unknown provider'), { status: 404 });
  const cfg = store.loadConnections().providers[id];
  if (!cfg) return { ok: false, message: 'Сначала сохраните подключение.' };
  const t = await p.test(cfg);
  store.setProvider(id, { status: t.ok ? 'connected' : 'error', lastError: t.ok ? null : t.message });
  return t;
}

export async function sync(id, { upload, period } = {}) {
  const p = PROVIDERS[id];
  if (!p) throw Object.assign(new Error('unknown provider'), { status: 404 });
  let cfg = store.loadConnections().providers[id];
  if (!cfg?.enabled) {
    // auto-connect sandbox so one-click sync works for businessmen
    await connect(id, { mode: 'sandbox', company: '«BARAKA NON» MCHJ', inn: '300000001' });
    cfg = store.loadConnections().providers[id];
  }
  try {
    const data = await p.sync(cfg, { demo: FILE_DEMO, period, upload });
    store.saveLive(data);
    store.setActiveSource(id);
    const stats = { sales: data.sales.length, purchases: data.purchases.length, period: data.period };
    store.setProvider(id, { lastSync: data.syncedAt, lastError: null, status: 'connected', stats });
    return { ok: true, data: summarize(data), books: data };
  } catch (e) {
    store.setProvider(id, { lastError: e.message, status: 'error' });
    throw e;
  }
}

function summarize(data) {
  return {
    source: data.source,
    period: data.period,
    syncedAt: data.syncedAt,
    company: data.company,
    sales: data.sales.length,
    purchases: data.purchases.length,
    sales_base: Math.round(data.sales.reduce((s, r) => s + r.base, 0)),
    sales_vat: Math.round(data.sales.reduce((s, r) => s + r.vat, 0)),
    purchases_base: Math.round(data.purchases.reduce((s, r) => s + r.base, 0)),
    purchases_vat: Math.round(data.purchases.reduce((s, r) => s + r.vat, 0)),
  };
}

export function disconnect(id) {
  store.disconnectProvider(id);
  const live = store.loadLive();
  if (live?.source === id) {
    store.saveLive({ source: 'demo', sales: FILE_DEMO.sales, purchases: FILE_DEMO.purchases, period: 'октябрь 2026', syncedAt: new Date().toISOString(), company: {} });
    store.setActiveSource('demo');
  }
  return status();
}

export function useDemo() {
  store.saveLive({ source: 'demo', sales: FILE_DEMO.sales, purchases: FILE_DEMO.purchases, period: 'октябрь 2026', syncedAt: new Date().toISOString(), company: {} });
  store.setActiveSource('demo');
  return status();
}

/** Parse pasted JSON / simple CSV-like ЭСФ export into books. */
export function parseUpload(body = {}) {
  if (body.sales || body.purchases) {
    return bundle({
      sales: (body.sales || []).map(r => invoice(r, 'sales')),
      purchases: (body.purchases || []).map(r => invoice(r, 'purchases')),
      company: body.company || {},
      source: body.source || 'soliq',
      period: body.period || 'импорт',
    });
  }
  if (typeof body.csv === 'string') {
    const lines = body.csv.trim().split(/\r?\n/).filter(Boolean);
    const sales = [], purchases = [];
    for (const line of lines.slice(1)) {
      const [kind, name, inn, num, date, base, vat, note] = line.split(/;|\t|,/).map(x => x?.trim());
      const row = { name, inn, num, date, base, vat, note };
      if (/purch|покуп|in/i.test(kind)) purchases.push(invoice(row, 'purchases'));
      else sales.push(invoice(row, 'sales'));
    }
    return bundle({ sales, purchases, company: body.company || {}, source: 'soliq', period: body.period || 'CSV импорт' });
  }
  throw Object.assign(new Error('Ожидался JSON { sales, purchases } или csv'), { status: 400 });
}

export async function importUpload(body) {
  const data = parseUpload(body);
  store.saveLive(data);
  store.setActiveSource(data.source || 'soliq');
  if (PROVIDERS[data.source]) {
    store.setProvider(data.source, {
      enabled: true,
      mode: 'live',
      status: 'connected',
      lastSync: data.syncedAt,
      stats: { sales: data.sales.length, purchases: data.purchases.length, period: data.period },
      company: data.company?.name || '',
      inn: data.company?.inn || '',
    });
  }
  return { ok: true, data: summarize(data), books: data };
}
