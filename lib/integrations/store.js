import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIR = join(ROOT, 'data');
const CONN = join(DIR, 'connections.json');
const LIVE = join(DIR, 'live-esf.json');
const SECRET_KEYS = ['password', 'token', 'apiKey', 'secret'];

function ensure() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  if (!existsSync(CONN)) writeFileSync(CONN, JSON.stringify({ providers: {}, activeSource: 'demo' }, null, 2));
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export function loadConnections() {
  ensure();
  const raw = readJson(CONN, { providers: {}, activeSource: 'demo' });
  raw.providers ||= {};
  return raw;
}

export function saveConnections(data) {
  ensure();
  writeFileSync(CONN, JSON.stringify(data, null, 2));
}

export function loadLive() {
  ensure();
  return existsSync(LIVE) ? readJson(LIVE, null) : null;
}

export function saveLive(data) {
  ensure();
  writeFileSync(LIVE, JSON.stringify(data, null, 2));
  return data;
}

export function clearLive() {
  if (existsSync(LIVE)) writeFileSync(LIVE, JSON.stringify({ source: 'demo', sales: [], purchases: [], clearedAt: new Date().toISOString() }, null, 2));
}

/** Mask secrets for API responses to the browser. */
export function publicProvider(id, p = {}) {
  const out = {
    id,
    enabled: !!p.enabled,
    mode: p.mode || 'sandbox',
    status: p.status || 'disconnected',
    inn: p.inn || '',
    login: p.login || '',
    apiUrl: p.apiUrl || '',
    company: p.company || '',
    connectedAt: p.connectedAt || null,
    lastSync: p.lastSync || null,
    lastError: p.lastError || null,
    stats: p.stats || null,
    hasSecret: SECRET_KEYS.some(k => !!p[k]),
  };
  return out;
}

export function setProvider(id, patch) {
  const data = loadConnections();
  const prev = data.providers[id] || {};
  const next = { ...prev, ...patch };
  for (const k of SECRET_KEYS) {
    if (patch[k] === '' || patch[k] === undefined) next[k] = prev[k] || '';
  }
  data.providers[id] = next;
  saveConnections(data);
  return publicProvider(id, next);
}

export function disconnectProvider(id) {
  const data = loadConnections();
  delete data.providers[id];
  if (data.activeSource === id) data.activeSource = 'demo';
  saveConnections(data);
  return { ok: true };
}

export function setActiveSource(source) {
  const data = loadConnections();
  data.activeSource = source;
  saveConnections(data);
  return data.activeSource;
}

/** Soft fingerprint so we never return raw secrets. */
export function secretHint(p = {}) {
  const raw = SECRET_KEYS.map(k => p[k]).filter(Boolean).join('|');
  if (!raw) return null;
  return createHash('sha256').update(raw).digest('hex').slice(0, 8);
}

export function newToken() {
  return randomBytes(24).toString('hex');
}
