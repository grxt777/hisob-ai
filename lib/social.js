// Social analytics for the marketer agent.
//   Telegram  — public channel feed t.me/s/<channel>: every post, views, reactions, type, date (no login).
//   Instagram — official Instagram Graph API with the OWNER's token (INSTAGRAM_ACCESS_TOKEN): every post,
//               likes, comments, saves, shares, views, reach. Without a token only public profile counters.
// Every run is stored in data/social.json, so each post gets a history (views growth between checks).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
const STORE = join(DATA_DIR, 'social.json');
const TZ = 5; // Asia/Tashkent, UTC+5
const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

// ---------- store: our accounts + per-post history ----------
function load() { try { return JSON.parse(readFileSync(STORE, 'utf8')); } catch { return { accounts: [], history: {} }; } }
function save(db) { if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(STORE, JSON.stringify(db, null, 1)); }
export function accounts() { return load().accounts; }
export function rememberAccount(platform, handle, title = '') {
  const db = load(), h = String(handle).replace(/^@/, '');
  const a = db.accounts.find(x => x.platform === platform && x.handle.toLowerCase() === h.toLowerCase());
  if (a) { a.ours = true; if (title) a.title = title; } else db.accounts.push({ platform, handle: h, title, ours: true, added: new Date().toISOString() });
  save(db); return db.accounts;
}
function track(platform, handle, posts, metric) {
  const db = load(), now = Date.now();
  for (const p of posts) {
    const key = `${platform}:${handle}/${p.id}`, h = db.history[key] || (db.history[key] = []);
    const last = h.at(-1);
    if (last && last[metric] != null && p[metric] != null) { p.delta = p[metric] - last[metric]; p.delta_hours = Math.round((now - last.t) / 36e5 * 10) / 10; }
    p.checks = h.length + 1;
    if (!last || now - last.t > 30 * 60e3) h.push({ t: now, [metric]: p[metric] ?? null, reactions: p.reactions ?? p.likes ?? null });
    if (h.length > 200) h.splice(0, h.length - 200);
  }
  const acc = db.accounts.find(x => x.platform === platform && x.handle.toLowerCase() === handle.toLowerCase());
  if (acc) acc.lastCheck = new Date(now).toISOString();
  save(db);
}

// ---------- helpers ----------
export const parseCount = s => { if (s == null) return null; const m = String(s).replace(/\s/g, '').replace(',', '.').match(/^([\d.]+)([KMB])?$/i); return m ? Math.round(parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1)) : null; };
const local = iso => { const d = new Date(new Date(iso).getTime() + TZ * 36e5); return { day: d.getUTCDay(), hour: d.getUTCHours(), date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }; };
const avg = a => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const group = (posts, key, metric) => { const g = new Map(); posts.forEach(p => { const k = key(p); if (k == null) return; (g.get(k) || g.set(k, []).get(k)).push(p); }); return [...g.entries()].map(([k, ps]) => ({ key: k, posts: ps.length, avg: avg(ps.map(p => p[metric]).filter(v => v != null)) })); };

// ---------- analytics (all numbers computed here, the model only interprets them) ----------
export function computeStats(posts, { followers = null, metric = 'views', reactKey = 'reactions' } = {}) {
  const ps = posts.filter(p => p[metric] != null);
  if (!ps.length) return null;
  const dated = ps.filter(p => p.date_iso).sort((a, b) => a.date_iso.localeCompare(b.date_iso));
  const spanDays = dated.length > 1 ? Math.max(1, (new Date(dated.at(-1).date_iso) - new Date(dated[0].date_iso)) / 864e5) : null;
  const vals = ps.map(p => p[metric]);
  const er = ps.filter(p => p[reactKey] != null && p[metric]).map(p => p[reactKey] / p[metric] * 100);
  const sorted = [...ps].sort((a, b) => b[metric] - a[metric]);
  const brief = p => ({ id: p.id, url: p.url, date: p.date, type: p.type, [metric]: p[metric], [reactKey]: p[reactKey] ?? null, text: (p.text || '').slice(0, 120) });
  const lenBucket = p => { const n = (p.text || '').length; return n === 0 ? 'без текста' : n < 200 ? 'короткий (<200)' : n < 600 ? 'средний (200–600)' : 'длинный (600+)'; };
  const tags = new Map(); ps.forEach(p => (p.hashtags || []).forEach(t => tags.set(t, (tags.get(t) || 0) + 1)));
  return {
    metric, posts_analyzed: ps.length, period: dated.length ? { from: dated[0].date, to: dated.at(-1).date } : null,
    posts_per_week: spanDays ? Math.round(ps.length / spanDays * 7 * 10) / 10 : null,
    followers, [`avg_${metric}`]: avg(vals), [`median_${metric}`]: median(vals), [`max_${metric}`]: Math.max(...vals), [`min_${metric}`]: Math.min(...vals),
    [`avg_${reactKey}`]: avg(ps.map(p => p[reactKey]).filter(v => v != null)),
    engagement_pct: er.length ? Math.round(er.reduce((s, x) => s + x, 0) / er.length * 100) / 100 : null,
    reach_pct_of_followers: followers ? Math.round(avg(vals) / followers * 1000) / 10 : null,
    top_posts: sorted.slice(0, 3).map(brief), weak_posts: sorted.slice(-3).reverse().map(brief),
    by_type: group(ps, p => p.type, metric).sort((a, b) => b.avg - a.avg),
    by_weekday: group(ps, p => p.date_iso ? DAYS[local(p.date_iso).day] : null, metric).sort((a, b) => b.avg - a.avg),
    by_hour: group(ps, p => p.date_iso ? local(p.date_iso).hour : null, metric).sort((a, b) => b.avg - a.avg),
    by_text_length: group(ps, lenBucket, metric).sort((a, b) => b.avg - a.avg),
    hashtags: { posts_with: ps.filter(p => p.hashtags?.length).length, avg_with: avg(ps.filter(p => p.hashtags?.length).map(p => p[metric])), avg_without: avg(ps.filter(p => !p.hashtags?.length).map(p => p[metric])), top: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => ({ tag: t, posts: n })) },
    growth_since_last_check: ps.some(p => p.delta != null) ? { posts_compared: ps.filter(p => p.delta != null).length, total_new: ps.reduce((s, p) => s + (p.delta || 0), 0) } : null,
  };
}

// ---------- Telegram ----------
let browser = null;
async function newPage() {
  if (!browser) { const { chromium } = await import('playwright'); browser = await chromium.launch({ headless: true }); }
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  return { p: await ctx.newPage(), close: () => ctx.close() };
}
export async function closeSocialBrowser() { if (browser) await browser.close().catch(() => {}); browser = null; }
const tgVariants = h => [...new Set([h, h.replace(/\./g, '_'), h.replace(/\./g, '')])].filter(x => /^[A-Za-z0-9_]{4,64}$/.test(x));

async function tgScrapePage(p) {
  return p.evaluate(() => {
    const kind = m => m.querySelector('.tgme_widget_message_grouped_wrap') ? 'альбом' : m.querySelector('.tgme_widget_message_video_player, .tgme_widget_message_roundvideo_player') ? 'видео' : m.querySelector('.tgme_widget_message_photo_wrap') ? 'фото' : m.querySelector('.tgme_widget_message_poll') ? 'опрос' : m.querySelector('.tgme_widget_message_document_wrap') ? 'файл' : m.querySelector('.tgme_widget_message_voice_player') ? 'голос' : m.querySelector('.tgme_widget_message_text') ? 'текст' : 'медиа';
    return {
      title: document.querySelector('.tgme_channel_info_header_title')?.innerText || null,
      description: document.querySelector('.tgme_channel_info_description')?.innerText?.slice(0, 400) || null,
      counters: Object.fromEntries([...document.querySelectorAll('.tgme_channel_info_counter')].map(c => [c.querySelector('.counter_type')?.innerText, c.querySelector('.counter_value')?.innerText])),
      more: document.querySelector('a.tme_messages_more')?.getAttribute('href') || null,
      posts: [...document.querySelectorAll('.tgme_widget_message')].map(m => {
        const text = m.querySelector('.tgme_widget_message_text')?.innerText || '';
        const reacts = [...m.querySelectorAll('.tgme_reaction')].map(r => ({ e: r.querySelector('.emoji, i')?.innerText || r.innerText.replace(/[\d.,KM\s]/g, ''), n: r.innerText.replace(/[^\d.,KM]/g, '') }));
        return { post: m.getAttribute('data-post'), date_iso: m.querySelector('.tgme_widget_message_date time, time')?.getAttribute('datetime') || null, views: m.querySelector('.tgme_widget_message_views')?.innerText || null, text, type: kind(m), reacts, links: m.querySelectorAll('.tgme_widget_message_text a[href^="http"]').length, forwarded: !!m.querySelector('.tgme_widget_message_forwarded_from') };
      }),
    };
  });
}
export async function telegramDeep(handle, maxPosts = 60) {
  const raw = String(handle || '').trim().replace(/^https?:\/\/t\.me\/(s\/)?/i, '').replace(/^@/, '').split(/[/?#]/)[0];
  const tried = [];
  const { p, close } = await newPage();
  try {
    for (const h of tgVariants(raw)) {
      tried.push('@' + h);
      try { await p.goto('https://t.me/s/' + h, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch { continue; }
      if (!/\/s\//.test(p.url())) continue; // redirected to t.me/<h>: not a public channel feed
      let page = await tgScrapePage(p);
      if (!page.title) continue;
      const all = new Map(); page.posts.forEach(x => all.set(x.post, x));
      for (let i = 0; i < 5 && page.more && all.size < maxPosts; i++) {
        await p.goto('https://t.me' + page.more, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const next = await tgScrapePage(p); next.posts.forEach(x => all.set(x.post, x)); page = { ...page, more: next.more };
      }
      const posts = [...all.values()].filter(x => x.post).sort((a, b) => b.post.localeCompare(a.post, undefined, { numeric: true })).slice(0, maxPosts).map(x => {
        const reactions = x.reacts.reduce((s, r) => s + (parseCount(r.n) || 0), 0);
        const l = x.date_iso ? local(x.date_iso) : null;
        return { id: x.post.split('/')[1], url: 'https://t.me/' + x.post, date_iso: x.date_iso, date: l ? `${l.date} ${l.time}` : null, type: x.type, text: x.text.slice(0, 1500), views: parseCount(x.views), reactions: x.reacts.length ? reactions : null, reactions_detail: x.reacts.slice(0, 8).map(r => `${r.e} ${r.n}`).join(' '), hashtags: (x.text.match(/#[\p{L}\d_]+/gu) || []).map(t => t.toLowerCase()), links: x.links, forwarded: x.forwarded };
      });
      const followers = parseCount(Object.entries(page.counters).find(([k]) => /subscriber|подписч|obunachi/i.test(k || ''))?.[1]);
      track('telegram', h, posts, 'views');
      return { platform: 'telegram', handle: h, url: 'https://t.me/s/' + h, source: 'публичная лента t.me/s', title: page.title, description: page.description, followers, counters: page.counters, posts, stats: computeStats(posts, { followers, metric: 'views', reactKey: 'reactions' }) };
    }
    return { platform: 'telegram', error: `Публичный канал не найден (проверил ${tried.join(', ') || raw}). Либо это не канал, либо у канала выключен публичный просмотр. Пришлите точную ссылку t.me/…` };
  } finally { await close(); }
}

// ---------- Instagram ----------
const IG = process.env.INSTAGRAM_API_BASE || 'https://graph.instagram.com/v21.0';
async function ig(path, params = {}) {
  const r = await fetch(`${IG}/${path}?` + new URLSearchParams({ ...params, access_token: process.env.INSTAGRAM_ACCESS_TOKEN }));
  const d = await r.json(); if (!r.ok || d.error) throw new Error(d.error?.message || 'Instagram API ' + r.status); return d;
}
async function insights(id) {
  for (const metric of ['reach,views,saved,shares,total_interactions', 'reach,saved,total_interactions', 'reach']) {
    try { const d = await ig(`${id}/insights`, { metric }); return Object.fromEntries(d.data.map(x => [x.name, x.values?.[0]?.value ?? x.total_value?.value ?? null])); } catch {}
  }
  return {};
}
export async function instagramDeep(handle, maxPosts = 40) {
  const h = String(handle || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  if (process.env.INSTAGRAM_ACCESS_TOKEN) {
    const me = await ig('me', { fields: 'user_id,username,name,followers_count,follows_count,media_count' });
    if (!h || me.username.toLowerCase() === h.toLowerCase()) {
      const media = await ig('me/media', { fields: 'id,caption,media_type,media_product_type,timestamp,like_count,comments_count,permalink', limit: String(maxPosts) });
      const posts = [];
      for (const m of media.data || []) {
        const ins = await insights(m.id), l = local(m.timestamp), text = m.caption || '';
        posts.push({ id: m.id, url: m.permalink, date_iso: m.timestamp, date: `${l.date} ${l.time}`, type: m.media_product_type === 'REELS' ? 'reels' : m.media_type === 'CAROUSEL_ALBUM' ? 'карусель' : m.media_type === 'VIDEO' ? 'видео' : 'фото', text: text.slice(0, 1500), likes: m.like_count ?? null, comments: m.comments_count ?? null, reach: ins.reach ?? null, views: ins.views ?? null, saved: ins.saved ?? null, shares: ins.shares ?? null, interactions: ins.total_interactions ?? ((m.like_count || 0) + (m.comments_count || 0)), hashtags: (text.match(/#[\p{L}\d_]+/gu) || []).map(t => t.toLowerCase()) });
      }
      const metric = posts.some(p => p.reach != null) ? 'reach' : 'likes';
      track('instagram', me.username, posts, metric);
      return { platform: 'instagram', handle: me.username, url: `https://www.instagram.com/${me.username}/`, source: 'Instagram Graph API (данные владельца)', title: me.name || me.username, followers: me.followers_count, counters: { подписчики: String(me.followers_count), подписки: String(me.follows_count), публикации: String(me.media_count) }, posts, stats: computeStats(posts, { followers: me.followers_count, metric, reactKey: 'interactions' }) };
    }
  }
  // Public profile only: counters from the page's meta description (no login, no per-post data).
  const { p, close } = await newPage();
  try {
    await p.goto(`https://www.instagram.com/${h}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const meta = await p.evaluate(() => ({ d: document.querySelector('meta[property="og:description"]')?.content || null, t: document.querySelector('meta[property="og:title"]')?.content || null }));
    const need = 'Без входа Instagram показывает только счётчики профиля. Чтобы маркетолог разбирал каждый пост (охват, просмотры, лайки, сохранения), подключите аккаунт через официальный Instagram API: добавьте INSTAGRAM_ACCESS_TOKEN владельца в .env.';
    if (!meta.d) return { platform: 'instagram', handle: h, error: 'Instagram не показал профиль без входа. ' + need };
    // "6,273 Followers" / "Подписчики: 6,273" / "1.2M Followers" (comma = thousands separator)
    const m = meta.d.match(/([\d][\d.,]*\s?[KM]?)\s*(?:Followers|подписчик)/i) || meta.d.match(/(?:Followers|Подписчики)\s*:?\s*([\d][\d.,]*\s?[KM]?)/i);
    const raw = m ? m[1].trim().replace(/[.,]+$/, '') : null;
    const followers = raw ? (/^\d{1,3}(,\d{3})+$/.test(raw) ? +raw.replace(/,/g, '') : parseCount(raw)) : null;
    return { platform: 'instagram', handle: h, url: `https://www.instagram.com/${h}/`, source: 'публичный профиль (без входа)', title: meta.t, summary: meta.d.slice(0, 300), posts: [], stats: null, needs_connection: need, followers };
  } finally { await close(); }
}
