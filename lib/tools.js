// Data tools shared by the web server (server.js) and the MCP server (mcp-server.js).
// Every number they return comes from the data or from a real page — never from the model.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEMO = (() => {
  const src = readFileSync(join(ROOT, 'public', 'assets', 'data.js'), 'utf8');
  return JSON.parse(src.slice(src.indexOf('=') + 1).trim().replace(/;\s*$/, ''));
})();
const round = x => Math.round(x);
const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);

// ---------- VAT summary (same formulas as the browser) ----------
export function vatSummary() {
  const sb = sum(DEMO.sales, 'base'), sv = sum(DEMO.sales, 'vat');
  const ded = DEMO.purchases.filter(p => !p.note);
  const pv = sum(ded, 'vat'), pay = sv - pv, simp = (sb + sv) * 0.06;
  return { period: 'октябрь 2026', sales_invoices: DEMO.sales.length, purchase_invoices: DEMO.purchases.length, sales_base: round(sb), vat_charged: round(sv), vat_deductible: round(pv), vat_payable: round(pay), simplified_vat_6pct: round(simp), monthly_saving: round(pay - simp) };
}

// ---------- invoices ----------
const dnum = s => { const m = String(s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/); return m ? +m[3] * 10000 + +m[2] * 100 + +m[1] : null; };
export function queryInvoices(a = {}) {
  const list = a.type === 'purchases' ? DEMO.purchases : DEMO.sales;
  const q = String(a.counterparty || '').toLowerCase().trim(), from = dnum(a.date_from), to = dnum(a.date_to);
  const rows = list.filter(r => (!q || r.name.toLowerCase().includes(q)) && (!from || dnum(r.date) >= from) && (!to || dnum(r.date) <= to));
  const limit = Math.min(Math.max(parseInt(a.limit) || 10, 1), 60);
  const res = { type: a.type === 'purchases' ? 'покупки' : 'продажи', invoices_found: rows.length, total_base: round(sum(rows, 'base')), total_vat: round(sum(rows, 'vat')) };
  if (a.group_by === 'counterparty') {
    const g = new Map();
    rows.forEach(r => { const k = r.name + '|' + r.inn; const x = g.get(k) || { name: r.name, inn: r.inn || '—', invoices: 0, base: 0, vat: 0 }; x.invoices++; x.base += r.base; x.vat += r.vat; g.set(k, x); });
    const arr = [...g.values()].map(x => ({ ...x, base: round(x.base), vat: round(x.vat) }));
    arr.sort((x, y) => a.sort === 'sum_asc' ? x.base - y.base : y.base - x.base);
    res.counterparties_total = arr.length; res.counterparties = arr.slice(0, limit);
  } else {
    const arr = rows.slice();
    if (a.sort === 'sum_desc') arr.sort((x, y) => y.base - x.base); else if (a.sort === 'sum_asc') arr.sort((x, y) => x.base - y.base); else arr.sort((x, y) => dnum(x.date) - dnum(y.date));
    res.invoices = arr.slice(0, limit).map(r => ({ num: r.num, date: r.date, name: r.name, inn: r.inn || '—', base: round(r.base), vat: round(r.vat) }));
  }
  // highlight exactly what the answer is about
  const shown = res.counterparties ? rows.filter(r => res.counterparties.some(g => g.name === r.name && g.inn === (r.inn || '—'))) : rows.filter(r => res.invoices.some(x => x.num === r.num));
  return { result: res, highlight: { type: a.type === 'purchases' ? 'purchases' : 'sales', nums: shown.map(r => r.num) } };
}

// ---------- calculator ----------
export function calculate(a = {}) {
  const expr = String(a.expression || '').replace(/(\d)[\s ](?=\d{3}\b)/g, '$1').replace(/,/g, '.').replace(/%/g, '/100');
  if (!/^[\d+\-*/().\s]+$/.test(expr) || expr.length > 200) return { result: { error: 'Недопустимое выражение: только числа и + - * / ( ) %' } };
  try {
    const v = Function('"use strict";return (' + expr + ')')();
    if (!Number.isFinite(v)) return { result: { error: 'Результат не число' } };
    return { result: { label: a.label || '', expression: a.expression, value: Math.round(v * 100) / 100 } };
  } catch { return { result: { error: 'Не удалось посчитать' } }; }
}

// ---------- geocoding (OpenStreetMap Nominatim, 1 request/second policy) ----------
let lastGeo = 0;
export async function geocode(q) {
  const wait = 1100 - (Date.now() - lastGeo); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastGeo = Date.now();
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q: String(q).slice(0, 200), format: 'jsonv2', limit: '5', countrycodes: 'uz', 'accept-language': 'ru' });
  const r = await fetch(url, { headers: { 'User-Agent': 'hisob-ai-prototype/0.1' } });
  if (!r.ok) return [];
  return (await r.json()).map(x => ({ name: x.display_name, lat: +x.lat, lon: +x.lon, type: x.type }));
}

// ---------- social monitoring (Playwright, public pages only, no login) ----------
let browser = null;
async function page() {
  if (!browser) { const { chromium } = await import('playwright'); browser = await chromium.launch({ headless: true }); }
  const ctx = await browser.newContext({ locale: 'ru-RU', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
  return { p: await ctx.newPage(), close: () => ctx.close() };
}
const handleOf = (s, host) => String(s || '').trim().replace(new RegExp('^https?://(www\\.)?' + host + '/(s/)?', 'i'), '').replace(/^@/, '').split(/[/?#]/)[0];
export async function socialMonitor(a = {}) {
  const platform = a.platform || 'telegram';
  const { p, close } = await page();
  try {
    if (platform === 'telegram') {
      const h = handleOf(a.handle, 't\\.me');
      if (!/^[A-Za-z0-9_]{3,64}$/.test(h)) return { error: 'Нужен публичный Telegram-канал, например @channel' };
      await p.goto('https://t.me/s/' + h, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const r = await p.evaluate(() => ({
        title: document.querySelector('.tgme_channel_info_header_title')?.innerText || null,
        description: document.querySelector('.tgme_channel_info_description')?.innerText?.slice(0, 300) || null,
        counters: Object.fromEntries([...document.querySelectorAll('.tgme_channel_info_counter')].map(c => [c.querySelector('.counter_type')?.innerText, c.querySelector('.counter_value')?.innerText])),
        posts: [...document.querySelectorAll('.tgme_widget_message_wrap')].slice(-10).reverse().map(m => ({ date: m.querySelector('time')?.getAttribute('datetime')?.slice(0, 10) || null, views: m.querySelector('.tgme_widget_message_views')?.innerText || null, text: (m.querySelector('.tgme_widget_message_text')?.innerText || '[медиа без текста]').slice(0, 220) })),
      }));
      if (!r.title) return { error: `Канал @${h} не найден или закрыт` };
      return { platform, handle: h, url: 'https://t.me/s/' + h, ...r };
    }
    if (platform === 'instagram') {
      const h = handleOf(a.handle, 'instagram\\.com');
      if (!/^[A-Za-z0-9_.]{2,30}$/.test(h)) return { error: 'Нужен публичный профиль Instagram' };
      await p.goto(`https://www.instagram.com/${h}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const meta = await p.evaluate(() => ({ d: document.querySelector('meta[property="og:description"]')?.content || null, t: document.querySelector('meta[property="og:title"]')?.content || null }));
      if (!meta.d) return { platform, handle: h, error: 'Instagram не показал профиль без входа (антибот). Публичные данные недоступны.' };
      return { platform, handle: h, url: `https://www.instagram.com/${h}/`, title: meta.t, summary: meta.d.slice(0, 300) };
    }
    // any public website
    const url = /^https?:\/\//.test(a.handle) ? a.handle : 'https://' + a.handle;
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const r = await p.evaluate(() => ({ title: document.title, description: document.querySelector('meta[name="description"]')?.content || null, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 1200) }));
    return { platform: 'website', url, ...r };
  } catch (e) { return { platform, error: 'Страница не открылась: ' + e.message.split('\n')[0] }; }
  finally { await close(); }
}
export async function closeBrowser() { if (browser) await browser.close().catch(() => {}); browser = null; }
