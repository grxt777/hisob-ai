// Office AI — FAB in analytics window (Cash-Flow-National style: Chat + AI cursor).
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cut = (s, n = 1200) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const md = t => esc(t).split(/\n{2,}/).map(p => '<p>' + p.replace(/^#{1,6}\s*(.+)$/gm, '<b>$1</b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>') + '</p>').join('');

  const svg = (d, w = 20) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I = {
    spark: svg('<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 1.9 1.7.8-1.7.8L19 20.5l-.8-1.9-1.9-.8 1.9-.8z"/>', 22),
    chat: svg('<path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.4A8.5 8.5 0 1 1 21 12z"/>'),
    cursor: svg('<path d="M4 3l7 17 2.3-6.7L20 11z"/><path d="M14 14l5.5 5.5"/>'),
    close: svg('<path d="M18 6L6 18M6 6l12 12"/>', 18),
    send: svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>', 18),
  };

  const root = document.createElement('div');
  root.id = 'axAiRoot';
  root.innerHTML = `
  <div class="ax-fab-wrap" id="axFab">
    <div class="ax-minis" role="menu">
      <button type="button" class="ax-mini" data-act="cursor" role="menuitem"><span class="ax-mini-ico">${I.cursor}</span><span class="ax-mini-tip">ИИ-курсор</span></button>
      <button type="button" class="ax-mini" data-act="chat" role="menuitem"><span class="ax-mini-ico">${I.chat}</span><span class="ax-mini-tip">Чат</span></button>
    </div>
    <button type="button" class="ax-fab" aria-haspopup="menu" aria-expanded="false" aria-label="AI">
      <span class="ax-fab-ico ax-fab-spark">${I.spark}</span>
      <span class="ax-fab-ico ax-fab-x">${I.close}</span>
    </button>
  </div>

  <section class="ax-ai-chat" id="axChat" hidden>
    <header class="ax-ai-head">
      <span class="ax-ai-av">${I.spark}</span>
      <div class="ax-ai-title"><b>AI-ассистент</b><span id="axAiModel">GLM · аналитика</span></div>
      <button type="button" class="ax-ai-ico" data-act="close" title="Закрыть">${I.close}</button>
    </header>
    <div class="ax-ai-msgs" id="axMsgs"></div>
    <form class="ax-ai-form" id="axForm">
      <textarea id="axText" rows="1" placeholder="Спросите про долги, DSO, остаток…"></textarea>
      <button type="submit" class="ax-ai-send" aria-label="Отправить">${I.send}</button>
    </form>
  </section>

  <div class="ax-ai-hl" id="axHl" hidden><span class="ax-ai-hl-tag">${I.cursor}<span>Нажмите — ИИ объяснит</span></span></div>
  <div class="ax-ai-bar" id="axBar" hidden>${I.cursor}<span>ИИ-курсор: кликните по цифре или графику</span><kbd>Esc</kbd><button type="button" data-act="cursor-off">Выйти</button></div>

  <div class="ax-ai-modal" id="axModal" hidden>
    <div class="ax-ai-modal-back" data-act="modal-close"></div>
    <div class="ax-ai-modal-card">
      <header><span class="ax-ai-av sm">${I.cursor}</span><div><b>ИИ-курсор</b><span id="axModalWhat"></span></div>
        <button type="button" class="ax-ai-ico" data-act="modal-close">${I.close}</button></header>
      <div class="ax-ai-modal-body" id="axModalBody"></div>
      <footer>
        <button type="button" class="ax-ai-btn ghost" data-act="again">${I.cursor} Другое</button>
        <button type="button" class="ax-ai-btn" data-act="ask-more">${I.chat} В чат</button>
      </footer>
    </div>
  </div>`;
  document.body.appendChild(root);

  const fab = $('#axFab'), fabBtn = $('.ax-fab', fab), chatEl = $('#axChat'), msgsEl = $('#axMsgs');
  const form = $('#axForm'), ta = $('#axText'), hl = $('#axHl'), bar = $('#axBar');
  const modal = $('#axModal'), modalBody = $('#axModalBody'), modalWhat = $('#axModalWhat');

  let cursorOn = false, hoverEl = null, history = [], busy = false, lastExplained = '', lastLocal = '';

  function fin() {
    try { return window.__AX_S || window.FINANCE?.snapshot?.({}) || {}; } catch { return {}; }
  }
  function viewName() {
    return document.querySelector('.ax-tab.on')?.textContent?.trim()
      || document.querySelector('.ax h1')?.textContent?.trim()
      || 'аналитика';
  }
  function contextBlock() {
    const S = fin();
    const lines = [
      `Раздел: ${viewName()}`,
      `Период: ${S.period || 'октябрь 2026'}`,
      `Приход: ${S.inTotal}`, `Расход: ${S.outTotal}`, `Остаток: ${S.closing}`, `Чистый: ${S.net}`,
      `Дебиторка: ${S.arTotal} (просрочено ${S.arOverdue}), DSO ${S.collectionDays} дн.`,
      `Кредиторка: ${S.apTotal}, DPO ${S.payDays} дн.`,
      `Runway: ${S.runwayDays} дн., операций: ${S.opsCount}`,
    ];
    if (S.ar?.length) lines.push('Должники: ' + S.ar.slice(0, 8).map(r => `${r.name}=${r.amount}`).join('; '));
    if (S.forecast) {
      const F = S.forecast;
      lines.push(`Прогноз trade 4нед: приход ${F.nextMonthIn}, расход ${F.nextMonthOut}, рост ${F.growthIn}%, WAPE ${F.wapeIn}%`);
      lines.push(`Сценарии: ${(F.scenarios || []).map(s => `${s.title}=${s.inn}/${s.marginPct}%`).join('; ')}`);
    }
    if (S.insights?.length) lines.push('Инсайты: ' + S.insights.slice(0, 4).join(' | '));
    return lines.join('\n');
  }

  const LOCAL = {
    dso: (S) => ({ t: 'DSO', h: `Days Sales Outstanding ≈ дебиторка ÷ (приход/30) = <b>${S.collectionDays || 0}</b> дн. Чем ниже — тем быстрее деньги от клиентов.` }),
    dpo: (S) => ({ t: 'DPO', h: `Days Payable Outstanding ≈ кредиторка ÷ (расход/30) = <b>${S.payDays || 0}</b> дн.` }),
    ar_total: (S) => ({ t: 'Дебиторка', h: `Вам должны <b>${fmt(S.arTotal)}</b> сум по ${(S.ar || []).length} контрагентам.` }),
    ar_overdue: (S) => ({ t: 'Просрочено', h: `Просроченная дебиторка: <b>${fmt(S.arOverdue)}</b> — приоритет взыскания.` }),
    ap_total: (S) => ({ t: 'Кредиторка', h: `Вы должны <b>${fmt(S.apTotal)}</b> сум.` }),
    in_total: (S) => ({ t: 'Приход', h: `Поступления за месяц: <b>${fmt(S.inTotal)}</b>.` }),
    out_total: (S) => ({ t: 'Расход', h: `Исходящие платежи: <b>${fmt(S.outTotal)}</b>.` }),
    closing: (S) => ({ t: 'Остаток', h: `Текущий остаток <b>${fmt(S.closing)}</b>, runway ≈ ${S.runwayDays} дн.` }),
    runway: (S) => ({ t: 'Runway', h: `Чистый поток ${fmt(S.net)}. Ликвидности хватит ≈ <b>${S.runwayDays}</b> дней.` }),
    debt_share: (S) => ({ t: 'Доля к обороту', h: `Дебиторка относительно прихода ≈ <b>${Math.round((S.arTotal || 0) / Math.max(S.inTotal, 1) * 100)}%</b>.` }),
    chart_ar_aging: () => ({ t: 'Aging', h: 'Распределение долгов по возрасту: 0 / 1–30 / 31–60 / 60+ дней. Старшие бакеты — срочный сбор.' }),
    chart_ar_mix: () => ({ t: 'Структура', h: 'Доля каждого должника. Крупные куски = концентрация риска.' }),
    ar_top: (S) => ({ t: 'Топ суммы', h: `Крупнейшие должники на сумму ${fmt(S.arTotal)}.` }),
    party: (el) => ({ t: el.dataset.askName || 'Контрагент', h: `<b>${esc(el.dataset.askName || '')}</b>: ${fmt(+el.dataset.askAmount || 0)}${el.dataset.askAge ? `, ${el.dataset.askAge} дн.` : ''}${el.dataset.askNote ? `. ${esc(el.dataset.askNote)}` : ''}.` }),
    fc_next_in: (S) => { const F = S.forecast || {}; return { t: 'Прогноз прихода · 4 нед', h: `<p>Следующие 4 недели: приход ≈ <b>${fmt(F.nextMonthIn)}</b> (${F.growthIn >= 0 ? '+' : ''}${F.growthIn}% к последним 4 неделям).</p><p>Модель: ${esc(F.method || '')}. WAPE на истории ${F.wapeIn}%.</p><p>${esc(F.tip || '')}</p>` }; },
    fc_next_out: (S) => { const F = S.forecast || {}; return { t: 'Прогноз расхода · 4 нед', h: `<p>Расход на 4 недели ≈ <b>${fmt(F.nextMonthOut)}</b> (${F.growthOut >= 0 ? '+' : ''}${F.growthOut}%).</p><p>Сравнивайте с приходом ${fmt(F.nextMonthIn)} — запас маржи ${fmt(F.nextMargin)}.</p>` }; },
    fc_margin: (S) => { const F = S.forecast || {}; return { t: 'Маржа прогноза', h: `<p>Прогнозная маржа = приход − расход = <b>${fmt(F.nextMargin)}</b> (${F.scenarios?.[0]?.marginPct ?? 0}%).</p><p>Если сценарий «Пессимизм» — смотрите кассовый разрыв и дебиторку.</p>` }; },
    fc_wape: (S) => { const F = S.forecast || {}; return { t: 'Точность WAPE', h: `<p>WAPE прихода на истории 12 недель: <b>${F.wapeIn}%</b>. Чем ниже — тем устойчивее тренд для trade-прогноза.</p><p>${esc(F.method || '')}</p>` }; },
    chart_fc_flow: (S) => { const F = S.forecast || {}; return { t: 'Приход: история + прогноз', h: `<p>XGBoost по 3 мес (авг–окт). Ноябрь ≈ <b>${fmt(F.nextMonthIn)}</b> (${F.growthIn >= 0 ? '+' : ''}${F.growthIn}% к октябрю). WAPE нед. ${F.wapeIn}%.</p>` }; },
    chart_fc_out: (S) => { const F = S.forecast || {}; return { t: 'Расход: история + прогноз', h: `<p>Расход ноября ≈ <b>${fmt(F.nextMonthOut)}</b>. В модели якоря: аренда (5), коммунальные (10), кредит (17), налоги (22/30).</p>` }; },
    chart_fc_scen: (S) => { const F = S.forecast || {}; return { t: 'Сценарии ноября', h: `<p>${(F.scenarios || []).map(s => `<b>${esc(s.title)}</b>: приход ${fmt(s.inn)}, маржа ${s.marginPct}% — ${esc(s.note)}`).join('</p><p>')}</p>` }; },
    chart_fc_months: (S) => { const F = S.forecast || {}; return { t: 'Месяцы', h: `<p>${(F.months || []).map(m => `${esc(m.label)}: приход ${fmt(m.inn)}, маржа ${fmt(m.margin)}`).join('<br>')}</p>` }; },
    chart_fc_cats: (S) => { const F = S.forecast || {}; return { t: 'Категории ноября', h: `<p>${(F.categoryMonth || []).slice(0, 8).map(c => `${esc(c.cat)}: ${fmt(c.amount)}`).join('<br>')}</p>` }; },
    chart_fc_daily: (S) => { const F = S.forecast || {}; return { t: 'Ноябрь по дням', h: `<p>Дневной recursive XGBoost. Итого приход ${fmt(F.nextMonthIn)}, расход ${fmt(F.nextMonthOut)}.</p>` }; },
    fc_drivers: () => ({ t: 'Модель XGBoost', h: '<p>Признаки: календарь (аренда/НДС/зарплата/кредит), лаги 1/7/14, rolling 7/14. Цель — log1p суммы.</p>' }),
    fc_scen: (el) => ({ t: el.dataset.askTitle || 'Сценарий', h: `<p>Сценарий <b>${esc(el.dataset.askTitle || '')}</b>: приход ${fmt(+el.dataset.askAmount || 0)}.</p>` }),
    fc_driver: (el) => ({ t: el.dataset.askTitle || 'Драйвер', h: `<p>${esc(el.dataset.askTitle || '')} — метрика/признак XGBoost.</p>` }),
    fc_cat: (el) => ({ t: el.dataset.askTitle || 'Категория', h: `<p>Статья <b>${esc(el.dataset.askTitle || '')}</b>: ноябрь ≈ ${fmt(+el.dataset.askAmount || 0)} сум.</p>` }),
  };
  function fmt(n) { return Math.round(n || 0).toLocaleString('ru-RU'); }

  function localExplain(el) {
    const S = fin();
    const ask = el.dataset.ask || el.closest('[data-ask]')?.dataset.ask || '';
    if (ask === 'party') return LOCAL.party(el.closest('[data-ask]') || el);
    if (LOCAL[ask]) return LOCAL[ask](S, el);
    const title = el.querySelector?.('h3,span,b')?.innerText?.trim() || cut(el.innerText, 60);
    return { t: title, h: `<p>${esc(cut(el.innerText, 320))}</p>` };
  }

  function describeEl(el) {
    const d = { kind: 'element', label: '', text: cut(el.innerText, 1500), section: viewName() };
    if (el.dataset.ask) {
      d.kind = 'KPI'; d.key = el.dataset.ask;
      d.label = el.querySelector('span,h3')?.innerText || el.dataset.askName || el.dataset.askTitle || d.key;
      d.value = el.querySelector('b')?.innerText || el.dataset.askAmount || '';
      d.hint = el.querySelector('small')?.innerText || el.dataset.askNote || '';
    }
    const canvas = el.matches('canvas') ? el : el.querySelector?.('canvas');
    if (canvas && typeof Chart !== 'undefined') {
      d.kind = 'chart';
      try {
        const c = Chart.getChart?.(canvas);
        if (c) d.chart = { type: c.config?.type, labels: (c.data?.labels || []).slice(-20), datasets: (c.data?.datasets || []).slice(0, 3).map(s => ({ label: s.label, data: (s.data || []).slice(-20) })) };
      } catch {}
      d.label = el.querySelector?.('h3')?.innerText || d.label || 'график';
    }
    if (!d.label) d.label = cut(el.innerText, 80);
    return d;
  }

  const PICK = '[data-ask],.ax-kpi,.ax-panel,.ax-bar-row,.ax-opp,.ax-due-row,.ax-tl,.ax-ins,.ax-mini > div,canvas,.ax-chart';
  const OWN = '#axAiRoot,.ax-fab-wrap,.ax-ai-chat,.ax-ai-modal,.ax-ai-bar,.ax-top';

  function pickTarget(raw) {
    if (!raw || raw.closest?.(OWN)) return null;
    let el = raw.closest?.(PICK);
    if (el?.matches('canvas')) el = el.closest('.ax-panel,[data-ask]') || el;
    if (!el) el = raw.closest?.('.ax-kpi,.ax-panel,.ax-bar-row');
    if (!el || el.matches('button[data-ax-view],button[data-opp-act]')) return null;
    return el;
  }

  function setMenu(open) {
    fab.classList.toggle('open', open);
    fabBtn.setAttribute('aria-expanded', String(open));
  }
  function openChat() {
    cursorOff();
    chatEl.hidden = false;
    requestAnimationFrame(() => chatEl.classList.add('in'));
    fab.classList.add('chat-open');
    setMenu(false);
    renderMsgs();
    ta.focus();
  }
  function closeChat() {
    chatEl.classList.remove('in');
    fab.classList.remove('chat-open');
    setTimeout(() => { chatEl.hidden = true; }, 180);
  }

  function cursorStart() {
    if (cursorOn) return;
    cursorOn = true;
    closeChat();
    setMenu(false);
    document.documentElement.classList.add('ai-cursor-on');
    fab.classList.add('cursor-mode');
    bar.hidden = false;
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onPick, true);
    ['pointerdown', 'mousedown'].forEach(ev => document.addEventListener(ev, swallow, true));
  }
  function cursorOff() {
    cursorOn = false;
    document.documentElement.classList.remove('ai-cursor-on');
    fab.classList.remove('cursor-mode');
    bar.hidden = true; hl.hidden = true; hoverEl = null;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onPick, true);
    ['pointerdown', 'mousedown'].forEach(ev => document.removeEventListener(ev, swallow, true));
  }
  function swallow(e) { if (!e.target.closest(OWN)) { e.preventDefault(); e.stopPropagation(); } }
  function onMove(e) {
    const t = pickTarget(e.target);
    if (t === hoverEl) return;
    hoverEl = t;
    if (!t) { hl.hidden = true; return; }
    const r = t.getBoundingClientRect();
    hl.hidden = false;
    Object.assign(hl.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    hl.classList.toggle('tag-below', r.top < 48);
  }
  function onPick(e) {
    if (e.target.closest(OWN)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const t = pickTarget(e.target) || hoverEl;
    cursorOff();
    if (t) explain(t);
  }

  async function explain(el) {
    const local = localExplain(el);
    lastExplained = local.t;
    lastLocal = local.h;
    el.classList.add('ax-picked');
    setTimeout(() => el.classList.remove('ax-picked'), 1400);
    modalWhat.textContent = local.t;
    modalBody.innerHTML = `<div class="ax-ai-local">${local.h}</div><p class="ax-ai-wait muted">GLM разбирает…</p>`;
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('in'));
    try {
      const r = await fetch('/api/explain', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ element: describeEl(el), doc: viewName(), lang: 'ru' }),
      });
      if (!r.ok) throw new Error('no api');
      const j = await r.json();
      if (j.reply && !modal.hidden) {
        modalBody.innerHTML = `<div class="ax-ai-md">${md(j.reply)}</div><details class="ax-ai-details"><summary>Краткая справка</summary>${local.h}</details>`;
      }
    } catch {
      $('.ax-ai-wait', modalBody)?.remove();
    }
  }
  function closeModal() {
    modal.classList.remove('in');
    setTimeout(() => { modal.hidden = true; }, 160);
  }
  function continueInChat() {
    history.push({ role: 'user', content: `Объясни: ${lastExplained}` });
    history.push({ role: 'assistant', content: lastLocal.replace(/<[^>]+>/g, ' ') });
    openChat();
  }

  const SUGGEST = [
    'Какой прогноз прихода на следующие 4 недели?',
    'Сравни базовый и пессимистичный сценарий',
    'Кто должен больше всех и что просрочено?',
    'Хватит ли остатка на аренду и кредит?',
  ];
  function renderMsgs() {
    if (!history.length) {
      msgsEl.innerHTML = `<div class="ax-ai-empty">
        <span class="ax-ai-av lg">${I.spark}</span>
        <h3>Спросите про цифры</h3>
        <p>Дебиторка, DSO, остаток, возможности — отвечаю по данным этой панели.</p>
        <div class="ax-ai-suggest">${SUGGEST.map(s => `<button type="button" data-act="suggest">${esc(s)}</button>`).join('')}</div>
      </div>`;
      return;
    }
    msgsEl.innerHTML = history.map(m => {
      if (m.role === 'user') return `<div class="ax-ai-msg user"><div class="ax-ai-bubble">${esc(m.content)}</div></div>`;
      return `<div class="ax-ai-msg bot"><div class="ax-ai-bubble">${m.html || md(m.content)}</div></div>`;
    }).join('');
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function sendMsg(text) {
    const q = (text || ta.value || '').trim();
    if (!q || busy) return;
    ta.value = ''; ta.style.height = 'auto';
    history.push({ role: 'user', content: q });
    renderMsgs();
    busy = true;
    const think = document.createElement('div');
    think.className = 'ax-ai-msg bot';
    think.innerHTML = `<div class="ax-ai-bubble ax-ai-think"><span class="ax-dots"><i></i><i></i><i></i></span> думаю…</div>`;
    msgsEl.append(think); msgsEl.scrollTop = msgsEl.scrollHeight;
    try {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: contextBlock(),
          docs: [{ id: 'cashflow', nm: 'Пульс денег' }, { id: 'ar', nm: 'Дебиторка' }, { id: 'opps', nm: 'Возможности' }],
          messages: history.slice(-10).map(m => ({ role: m.role, content: m.content })),
        }),
      });
      think.remove();
      if (!r.ok) throw new Error(r.status === 503 ? 'Нет OPENROUTER_API_KEY — локальный ответ' : 'ошибка');
      const j = await r.json();
      history.push({ role: 'assistant', content: j.reply || 'Готово.' });
    } catch (e) {
      think.remove();
      const S = fin();
      const low = q.toLowerCase();
      let ans = `Сейчас на экране «${viewName()}»: дебиторка ${fmt(S.arTotal)}, просрочено ${fmt(S.arOverdue)}, DSO ${S.collectionDays || 0} дн., остаток ${fmt(S.closing)}.`;
      if (/dso|дсо|сбор/.test(low)) ans = LOCAL.dso(S).h.replace(/<[^>]+>/g, '');
      else if (/просроч|overdue/.test(low)) ans = LOCAL.ar_overdue(S).h.replace(/<[^>]+>/g, '');
      else if (/кто долж|топ|крупн/.test(low)) ans = (S.ar || []).slice(0, 5).map(r => `${r.name}: ${fmt(r.amount)}`).join('; ') || ans;
      else if (/остат|runway|хватит/.test(low)) ans = LOCAL.closing(S).h.replace(/<[^>]+>/g, '');
      history.push({ role: 'assistant', content: ans + (String(e.message).includes('OPENROUTER') ? '\n\n(Для GLM добавьте OPENROUTER_API_KEY в .env)' : '') });
    }
    busy = false;
    renderMsgs();
  }

  fabBtn.addEventListener('click', () => {
    if (cursorOn) return cursorOff();
    if (!chatEl.hidden && !fab.classList.contains('open')) { closeChat(); return; }
    setMenu(!fab.classList.contains('open'));
  });
  document.addEventListener('click', e => { if (!fab.contains(e.target) && !cursorOn) setMenu(false); });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'chat') openChat();
    if (act === 'cursor') cursorStart();
    if (act === 'close') closeChat();
    if (act === 'cursor-off') cursorOff();
    if (act === 'modal-close') closeModal();
    if (act === 'again') { closeModal(); cursorStart(); }
    if (act === 'ask-more') { closeModal(); continueInChat(); }
    if (act === 'suggest') sendMsg(b.textContent.trim());
  });
  form.addEventListener('submit', e => { e.preventDefault(); sendMsg(); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!modal.hidden) closeModal();
    else if (cursorOn) cursorOff();
    else if (!chatEl.hidden) closeChat();
    else if (fab.classList.contains('open')) setMenu(false);
  });
  window.addEventListener('scroll', () => { if (cursorOn) { hl.hidden = true; hoverEl = null; } }, true);

  fetch('/api/chat', { method: 'OPTIONS' }).catch(() => {});
})();
