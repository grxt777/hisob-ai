// Telegram: Mini App user verification, sending files to the user, and the bot itself (/start, menu button).
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const API = m => `https://api.telegram.org/bot${TOKEN()}/${m}`;
export const botEnabled = () => !!TOKEN();
export const miniAppUrl = () => { const u = (process.env.PUBLIC_URL || '').replace(/\/$/, ''); return /^https:\/\//.test(u) ? u + '/tg' : null; };

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyInitData(initData, maxAgeSec = 86400) {
  if (!TOKEN() || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash'); if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN()).digest();
  const calc = createHmac('sha256', secret).update(check).digest('hex');
  if (calc.length !== hash.length || !timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date') || 0) > maxAgeSec) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

async function call(method, body) {
  const r = await fetch(API(method), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json(); if (!d.ok) throw new Error(d.description || method + ' failed'); return d.result;
}
export async function sendDocument(chatId, buffer, filename, caption = '') {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('document', new Blob([buffer]), filename);
  if (caption) fd.append('caption', caption.slice(0, 1000));
  const r = await fetch(API('sendDocument'), { method: 'POST', body: fd });
  const d = await r.json(); if (!d.ok) throw new Error(d.description || 'sendDocument failed'); return d.result;
}

// ---------- the bot: long polling, so it works locally and on Railway without a webhook ----------
export async function startBot(log = console.log) {
  if (!TOKEN() || process.env.BOT_POLLING === '0') return log('Telegram bot: off');
  const me = await call('getMe', {}).catch(e => { log('Telegram bot: bad token —', e.message); return null; });
  if (!me) return;
  const url = miniAppUrl();
  if (url) await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Hisob AI', web_app: { url } } }).catch(e => log('menu button:', e.message));
  await call('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
  log(`Telegram bot: @${me.username}${url ? ', Mini App ' + url : ' (Mini App needs PUBLIC_URL with https)'}`);
  let offset = 0;
  for (;;) {
    try {
      const ups = await call('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      for (const u of ups) { offset = u.update_id + 1; await onMessage(u.message, url).catch(e => log('bot reply failed:', e.message)); }
    } catch (e) {
      if (/Conflict/i.test(e.message)) { log('Telegram bot: another instance is polling with this token — stopping here'); return; }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}
async function onMessage(m, url) {
  if (!m?.chat) return;
  const open = url ? { reply_markup: { inline_keyboard: [[{ text: '📊 Открыть Hisob AI', web_app: { url } }]] } } : {};
  if (/^\/start|^\/app/.test(m.text || '')) {
    return call('sendMessage', { chat_id: m.chat.id, text: url ? 'Ассалому алейкум! Я AI-команда вашей бухгалтерии: менеджер, бухгалтер, юрист, аналитик и маркетолог.\n\nОткройте приложение и скажите голосом, что нужно: «сделай приказ о приёме», «пришли расчёт НДС». Готовые документы пришлю сюда.' : 'Мини-приложение ещё не опубликовано: на сервере не задан PUBLIC_URL с https.', ...open });
  }
  return call('sendMessage', { chat_id: m.chat.id, text: 'Задачи принимаю в приложении: там голос, документы и отчёты. Нажмите кнопку ниже.', ...open });
}
