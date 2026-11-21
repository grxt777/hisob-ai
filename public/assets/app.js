// Shared helpers: API client, auth, projects, toast, AI cursor element.
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// JSON request to our server. Throws Error(message) with .status on failure.
async function request(path, { method = 'GET', body, signal, keepalive } = {}) {
  let r;
  try {
    r = await fetch(path, { method, signal, keepalive, credentials: 'same-origin', headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw Object.assign(new Error('Сервер недоступен — проверьте, что он запущен'), { status: 0 });
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    if (r.status === 401 && !path.startsWith('/api/auth/')) location.href = '/auth?next=' + encodeURIComponent(location.pathname + location.search);
    throw Object.assign(new Error(d.error || 'Ошибка ' + r.status), { status: r.status });
  }
  return d;
}

const auth = {
  _u: undefined,
  async user() {
    if (this._u === undefined) this._u = (await request('/api/auth/me').catch(() => ({ user: null }))).user;
    return this._u;
  },
  // Resolves with the user, or sends the visitor to /auth and never resolves.
  async require() {
    const u = await this.user();
    if (!u) { location.href = '/auth?next=' + encodeURIComponent(location.pathname + location.search); return new Promise(() => {}); }
    return u;
  },
  async login(email, password) { this._u = (await request('/api/auth/login', { method: 'POST', body: { email, password } })).user; return this._u; },
  async signup(name, email, password) { this._u = (await request('/api/auth/signup', { method: 'POST', body: { name, email, password } })).user; return this._u; },
  async logout() { await request('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {}); this._u = null; location.href = '/auth'; },
};

const projects = {
  async all() { return (await request('/api/projects')).projects; },
  get(id) { return request('/api/projects/' + encodeURIComponent(id)); },
  save(p, opts = {}) {
    const { id, name, prompt, plan, blocks, chat, edits } = p;
    return request('/api/projects/' + encodeURIComponent(id), { method: 'PUT', body: { name, prompt, plan, blocks, chat, edits }, ...opts });
  },
  remove(id) { return request('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' }); },
  uploadAsset(projectId, asset) { return request(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: 'POST', body: asset }); },
  removeAsset(id) { return request('/api/assets/' + encodeURIComponent(id), { method: 'DELETE' }); },
  // Projects saved by the old browser-only version: move them to the account once.
  async importLocal() {
    const old = store.get('dm_projects', []);
    if (!Array.isArray(old) || !old.length) return 0;
    let n = 0;
    for (const p of old) {
      try { await request('/api/projects/import', { method: 'POST', body: { project: p } }); n++; }
      catch (e) { console.warn('import failed', p?.name, e.message); }
    }
    store.del('dm_projects'); store.del('dm_user');
    return n;
  },
};

function toast(msg, ic = 'check') {
  let host = document.querySelector('.toast-host');
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; document.body.append(host); }
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `${icon(ic, 'sm')}<span></span>`;
  t.querySelector('span').textContent = msg;
  host.append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = 0; t.style.transform = 'translateY(6px)'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

// Styled replacement for window.confirm(). Resolves true (confirm) or false (cancel / Esc / backdrop).
// confirmDialog({ title, text, html, ok: 'Удалить', cancel: 'Отмена', icon: 'trash', danger: true })
function confirmDialog({ title = 'Вы уверены?', text = '', html = '', ok = 'Подтвердить', cancel = 'Отмена', icon: ic = 'shield', danger = false } = {}) {
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${danger ? 'danger' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="m-title" aria-describedby="m-text">
      <button type="button" class="btn btn-ghost btn-icon btn-sm m-x" data-a="cancel" aria-label="Закрыть">${icon('x', 'sm')}</button>
      <div class="m-ic">${icon(ic)}</div>
      <h3 id="m-title"></h3>
      <p id="m-text"></p>
      <div class="m-act">
        <button type="button" class="btn btn-outline" data-a="cancel"></button>
        <button type="button" class="btn btn-primary" data-a="ok">${danger ? icon(ic, 'sm') : ''}<span></span></button>
      </div>
    </div>`;
    back.querySelector('#m-title').textContent = title;
    const p = back.querySelector('#m-text');
    html ? (p.innerHTML = html) : (p.textContent = text);
    back.querySelector('.m-act [data-a="cancel"]').textContent = cancel;
    back.querySelector('[data-a="ok"] span').textContent = ok;
    const okBtn = back.querySelector('[data-a="ok"]');

    let done = false;
    const close = v => {
      if (done) return; done = true;
      removeEventListener('keydown', onKey, true);
      back.classList.add('out');
      setTimeout(() => back.remove(), 170);
      prevFocus?.focus?.();
      resolve(v);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Tab') { // keep focus inside the dialog
        const f = [...back.querySelectorAll('button')], i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    };
    back.addEventListener('mousedown', e => { if (e.target === back) close(false); });
    back.querySelectorAll('[data-a]').forEach(b => b.onclick = () => close(b.dataset.a === 'ok'));
    addEventListener('keydown', onKey, true);
    document.body.append(back);
    // destructive actions get focus on Cancel, so a stray Enter never deletes anything
    (danger ? back.querySelector('.m-act [data-a="cancel"]') : okBtn).focus();
  });
}

// Animated AI cursor. Moves via transform inside a positioned parent.
class AICursor {
  constructor(parent, { name, color = '#0a0a0b', initial }) {
    this.el = document.createElement('div');
    this.el.className = 'ai-cursor';
    this.el.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 3.5 19.5 10.6l-6.4 2-2.8 6.4L5 3.5Z" fill="${color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
      <div class="tag" style="background:${color}"><i>${initial || name[0]}</i><span>${name}</span><em></em></div>`;
    parent.append(this.el);
    this.x = 0; this.y = 0;
    this.el.style.transform = 'translate(-60px,-60px)';
  }
  say(t) { this.el.querySelector('em').textContent = t ? '· ' + t : ''; }
  moveTo(x, y, ms = 900) {
    this.x = x; this.y = y;
    this.el.style.transitionDuration = ms + 'ms';
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    return new Promise(r => setTimeout(r, ms));
  }
  async click() { this.el.classList.remove('click'); void this.el.offsetWidth; this.el.classList.add('click'); await sleep(260); }
  remove() { this.el.remove(); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-logo]').forEach(n => (n.innerHTML = LOGO));
});
