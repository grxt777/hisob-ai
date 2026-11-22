// Checks: initData signature verification, shared docs API, /tg page, /healthz, STT without keys.
// Run with the server up: node test/telegram.test.mjs
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
for (const l of readFileSync(envFile, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const { verifyInitData } = await import('../lib/telegram.js');
const BASE = process.env.TEST_BASE || 'http://localhost:5180';

// sign initData the way Telegram does
function sign(fields, token) {
  const check = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
}
const user = JSON.stringify({ id: 1, first_name: 'Test' });
const good = sign({ auth_date: String(Math.floor(Date.now() / 1000)), user, query_id: 'x' }, process.env.TELEGRAM_BOT_TOKEN);
const forged = sign({ auth_date: String(Math.floor(Date.now() / 1000)), user, query_id: 'x' }, '123:wrong-token');
const old = sign({ auth_date: String(Math.floor(Date.now() / 1000) - 3 * 86400), user }, process.env.TELEGRAM_BOT_TOKEN);
const ok = (name, cond) => console.log((cond ? 'PASS ' : 'FAIL ') + name);

ok('valid initData accepted', verifyInitData(good)?.id === 1);
ok('forged initData rejected', verifyInitData(forged) === null);
ok('expired initData rejected', verifyInitData(old) === null);

ok('/healthz', (await fetch(BASE + '/healthz').then(r => r.json())).ok === true);
ok('/tg serves the app', /Hisob AI/.test(await fetch(BASE + '/tg').then(r => r.text())));
const saved = await fetch(BASE + '/api/docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Тестовый документ', kind: 'записка', md: '# Тест', source: 'tg' }) }).then(r => r.json());
ok('doc saved with server id', /^doc-/.test(saved.doc?.id));
const list = await fetch(BASE + '/api/docs').then(r => r.json());
ok('doc visible to the other device', list.docs.some(d => d.id === saved.doc.id && d.source === 'tg'));
ok('unchanged poll is cheap', (await fetch(BASE + '/api/docs?since=' + list.version).then(r => r.json())).unchanged === true);
const send = await fetch(BASE + '/api/tg/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: forged, filename: 'a.pdf', data: 'AAAA' }) });
ok('send with forged initData → 401', send.status === 401);
const stt = await fetch(BASE + '/api/stt', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: new Uint8Array(10) });
console.log('stt without key →', stt.status, (await stt.json()).error?.slice(0, 60));
