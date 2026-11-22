// One store for the PC workspace and the Telegram Mini App.
// JSON file in DATA_DIR (on Railway: a mounted volume, e.g. /data), written atomically.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || join(fileURLToPath(new URL('..', import.meta.url)), 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const FILE = join(DATA_DIR, 'workspace.json');

let db = (() => { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return { docs: [], version: 0 }; } })();
function persist() { db.version++; const tmp = FILE + '.tmp'; writeFileSync(tmp, JSON.stringify(db)); renameSync(tmp, FILE); }

export const docsVersion = () => db.version;
export const listDocs = () => db.docs.map(({ id, title, kind, source, createdAt, updatedAt }) => ({ id, title, kind, source, createdAt, updatedAt }));
export const getDoc = id => db.docs.find(d => d.id === id) || null;
export const allDocs = () => db.docs;

// Create (no id / unknown id) or update (known id). Returns the stored document.
export function saveDoc({ id, title, kind, md, source }) {
  const now = new Date().toISOString();
  const clean = { title: String(title || 'Документ').slice(0, 120), kind: String(kind || 'другое').slice(0, 30), md: String(md || '').slice(0, 60000) };
  let d = id && db.docs.find(x => x.id === id);
  if (d) Object.assign(d, clean, { updatedAt: now });
  else { d = { id: 'doc-' + Date.now().toString(36) + randomBytes(3).toString('hex'), ...clean, source: source === 'tg' ? 'tg' : 'pc', createdAt: now, updatedAt: now }; db.docs.push(d); }
  if (db.docs.length > 500) db.docs.splice(0, db.docs.length - 500);
  persist();
  return d;
}
