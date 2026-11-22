// Office AI — dense visual analytics (charts + insights, not spreadsheets).
(function (global) {
  const mln = n => (n / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const VIEWS = {
    cashflow: { title: 'Пульс денег', sub: 'Поток, ликвидность, структура' },
    bank: { title: 'Банк', sub: 'Безналичный оборот' },
    cash: { title: 'Касса', sub: 'Наличный оборот' },
    ar: { title: 'Дебиторка', sub: 'Aging · кто должен' },
    ap: { title: 'Кредиторка', sub: 'Aging · кому должны' },
    rent: { title: 'Аренда и кредит', sub: 'Фиксированные обязательства' },
    credit: { title: 'Аренда и кредит', sub: 'Фиксированные обязательства' },
    opps: { title: 'Возможности', sub: 'Эффект в сумах · приоритеты' },
    today: { title: 'Сегодня', sub: 'Три действия с максимальным эффектом' },
    forecast: { title: 'Прогноз trade', sub: 'XGBoost · ноябрь · категории' },
    overview: { title: 'Финансовая аналитика', sub: 'Полный обзор октября' },
  };

  const key = s => { const m = String(s).match(/(\d+)\.(\d+)\.(\d+)/); return m ? +m[3] * 10000 + +m[2] * 100 + +m[1] : 0; };

  function seriesByDay(rows) {
    const map = new Map();
    [...rows].sort((a, b) => key(a.date) - key(b.date)).forEach(r => {
      const d = r.date.slice(0, 5);
      const x = map.get(d) || { in: 0, out: 0 };
      if (r.type === 'in') x.in += r.amount; else x.out += r.amount;
      map.set(d, x);
    });
    const labels = [...map.keys()];
    return { labels, inn: labels.map(k => map.get(k).in), out: labels.map(k => map.get(k).out) };
  }

  function cumulative(opening, rows) {
    const sorted = [...rows].sort((a, b) => key(a.date) - key(b.date));
    let bal = opening;
    const labels = [], vals = [];
    sorted.forEach(r => {
      bal += r.type === 'in' ? r.amount : -r.amount;
      labels.push(r.date.slice(0, 5));
      vals.push(bal);
    });
    return { labels, vals };
  }

  function ensure(S) {
    // Harden against partial/stale payloads
    const out = S || {};
    out.ar = out.ar || [];
    out.ap = out.ap || [];
    out.bank = out.bank || [];
    out.cash = out.cash || [];
    out.rent = out.rent || [];
    out.credit = out.credit || { schedule: [], monthly: 0, left: 0, rate: 0, bank: '', nextDue: '' };
    out.credit.schedule = out.credit.schedule || [];
    out.weeks = out.weeks || [];
    out.expenseMix = out.expenseMix || [];
    out.weekdays = out.weekdays || [];
    out.opportunities = out.opportunities || [];
    out.insights = out.insights || [];
    out.dueSoon = out.dueSoon || [];
    out.topIn = out.topIn || [];
    out.topOut = out.topOut || [];
    out.forecast = out.forecast || window.FINANCE?.buildForecast?.() || {
      hist: out.weeks, forward: [], series: out.weeks, scenarios: [], months: [], drivers: [],
      nextMonthIn: 0, nextMonthOut: 0, nextMargin: 0, growthIn: 0, growthOut: 0, wapeIn: 0, tip: '',
      method: 'нет данных',
    };
    out.arTotal = out.arTotal ?? out.ar.reduce((s, x) => s + x.amount, 0);
    out.apTotal = out.apTotal ?? out.ap.reduce((s, x) => s + x.amount, 0);
    out.arOverdue = out.arOverdue ?? out.ar.filter(x => x.age > 14 || /просроч/i.test(x.note || '')).reduce((s, x) => s + x.amount, 0);
    out.inTotal = out.inTotal ?? 0;
    out.outTotal = out.outTotal ?? 0;
    out.opening = out.opening ?? 0;
    out.closing = out.closing ?? 0;
    out.net = out.net ?? (out.inTotal - out.outTotal);
    out.opsCount = out.opsCount ?? (out.bank.length + out.cash.length);
    out.collectionDays = out.collectionDays ?? Math.max(1, Math.round(out.arTotal / Math.max(1, out.inTotal / 30)));
    out.payDays = out.payDays ?? Math.max(1, Math.round(out.apTotal / Math.max(1, out.outTotal / 30)));
    out.runwayDays = out.runwayDays ?? Math.max(1, Math.round(out.closing / Math.max(1, out.outTotal / 30)));
    const ageBuckets = (rows) => {
      const b = { '0': 0, '1–30': 0, '31–60': 0, '60+': 0 };
      rows.forEach(r => {
        const k = r.bucket || (r.age > 60 ? '60+' : r.age > 30 ? '31–60' : r.age > 0 ? '1–30' : '0');
        b[k] = (b[k] || 0) + r.amount;
      });
      return b;
    };
    out.arAging = out.arAging || ageBuckets(out.ar);
    out.apAging = out.apAging || ageBuckets(out.ap);
    return out;
  }

  function hero(view, S, co, opts) {
    const v = VIEWS[view] || VIEWS.overview;
    const on = (id) => {
      if (view === id) return true;
      if (id === 'cashflow' && (view === 'bank' || view === 'cash' || view === 'overview')) return true;
      if (id === 'ar' && (view === 'ap')) return true;
      if (id === 'credit' && view === 'rent') return true;
      if (id === 'opps' && view === 'today') return true;
      if (id === 'forecast' && view === 'forecast') return true;
      return false;
    };
    return `<div class="ax-hero">
      <div>
        <div class="ax-kicker">Office AI · аналитика · ${S.opsCount} операций</div>
        <h1>${esc(v.title)}</h1>
        <p>${esc(co.name || '')} · ${esc(S.period || 'октябрь 2026')} · ${esc(v.sub)}</p>
      </div>
      <div class="ax-hero-actions">
        ${opts.popout !== false ? `<button type="button" class="btn btn-primary btn-sm" data-ax-pop="${esc(view)}">${opts.icon || ''}Открыть в окне</button>` : ''}
        <div class="ax-nav">
          ${[['overview','Обзор'],['cashflow','Деньги'],['ar','Долги'],['credit','Обязат.'],['forecast','Прогноз'],['opps','Возможн.']].map(([id, t]) =>
            `<button type="button" class="ax-tab ${on(id) ? 'on' : ''}" data-ax-view="${id}">${t}</button>`).join('')}
        </div>
      </div>
    </div>`;
  }

  function insightStrip(S) {
    return `<div class="ax-insights">${(S.insights || []).map(t => `<div class="ax-ins">${esc(t)}</div>`).join('')}</div>`;
  }

  function dashHtml(view, S0, vat = {}, co = {}, opts = {}) {
    const S = ensure(S0);
    const h = hero(view, S, co, opts);

    if (view === 'forecast') {
      const F = S.forecast;
      const cats = (F.categoryMonth || []).slice().sort((a, b) => b.amount - a.amount);
      return `<div class="ax" data-ax="forecast">${h}
        <div class="ax-kpis">
          <div class="ax-kpi ok" data-ask="fc_next_in"><span>Приход · ноябрь</span><b>${fmt(F.nextMonthIn)}</b><small>${F.growthIn >= 0 ? '+' : ''}${F.growthIn}% к октябрю</small></div>
          <div class="ax-kpi warn" data-ask="fc_next_out"><span>Расход · ноябрь</span><b>${fmt(F.nextMonthOut)}</b><small>${F.growthOut >= 0 ? '+' : ''}${F.growthOut}%</small></div>
          <div class="ax-kpi pink" data-ask="fc_margin"><span>Маржа ноября</span><b>${fmt(F.nextMargin)}</b><small>${F.scenarios?.[0]?.marginPct ?? 0}%</small></div>
          <div class="ax-kpi" data-ask="fc_wape"><span>WAPE (нед.)</span><b>${F.wapeIn}%</b><small>XGBoost · 3 мес истории</small></div>
        </div>
        <div class="ax-grid-2">
          <div class="ax-panel" data-ask="chart_fc_flow"><div class="ax-ph"><h3>Приход: недели + прогноз</h3><span>авг–окт факт · ноябрь XGB</span></div><div class="ax-chart tall"><canvas id="ax-fc-in"></canvas></div></div>
          <div class="ax-panel" data-ask="chart_fc_out"><div class="ax-ph"><h3>Расход: недели + прогноз</h3><span>аренда · налог · сырьё</span></div><div class="ax-chart tall"><canvas id="ax-fc-out"></canvas></div></div>
        </div>
        <div class="ax-grid-3">
          <div class="ax-panel" data-ask="chart_fc_scen"><div class="ax-ph"><h3>Сценарии ноября</h3></div><div class="ax-chart"><canvas id="ax-fc-scen"></canvas></div>
            <div class="ax-mini" style="margin-top:10px">${(F.scenarios || []).map(s => `<div data-ask="fc_scen" data-ask-title="${esc(s.title)}" data-ask-amount="${s.inn}"><span>${esc(s.title)}</span><b>${mln(s.inn)} · ${s.marginPct}%</b></div>`).join('')}</div>
          </div>
          <div class="ax-panel" data-ask="chart_fc_months"><div class="ax-ph"><h3>Месяцы: факт + ноябрь</h3></div><div class="ax-chart"><canvas id="ax-fc-months"></canvas></div></div>
          <div class="ax-panel" data-ask="chart_fc_cats"><div class="ax-ph"><h3>Категории ноября</h3><span>XGB по статьям</span></div><div class="ax-chart"><canvas id="ax-fc-cats"></canvas></div>
            <div class="ax-mini" style="margin-top:10px">${cats.slice(0, 8).map(c => `<div data-ask="fc_cat" data-ask-title="${esc(c.cat)}" data-ask-amount="${c.amount}"><span>${esc(c.cat)} · ${esc(c.side || '')}</span><b>${mln(c.amount)}</b></div>`).join('')}</div>
          </div>
        </div>
        <div class="ax-grid-2">
          <div class="ax-panel" data-ask="chart_fc_daily"><div class="ax-ph"><h3>Ноябрь по дням</h3><span>recursive XGB</span></div><div class="ax-chart tall"><canvas id="ax-fc-daily"></canvas></div></div>
          <div class="ax-panel" data-ask="fc_drivers"><div class="ax-ph"><h3>Модель и драйверы</h3></div>
            <div class="ax-opp-list">${(F.drivers || []).map((d, i) => `
              <div class="ax-opp" data-ask="fc_driver" data-ask-title="${esc(d.title)}">
                <div class="ax-opp-rank">${i + 1}</div>
                <div class="ax-opp-body"><b>${esc(d.title)}</b><p>${esc(d.hint)}</p></div>
                <div class="ax-opp-save">${esc(d.value)}</div>
              </div>`).join('')}</div>
            <p class="hint-s" style="margin-top:12px">${esc(F.tip || '')}</p>
            <p class="hint-s">${esc(F.method || '')}</p>
          </div>
        </div>
        ${insightStrip(S)}
      </div>`;
    }

    if (view === 'opps' || view === 'today') {
      return `<div class="ax" data-ax="${view}">${h}
        <div class="ax-kpis">
          <div class="ax-kpi pink" data-ask="vat_save"><span>Экономия НДС 6%</span><b>${fmt(vat.save || 0)}</b><small>/ месяц</small></div>
          <div class="ax-kpi warn" data-ask="ar_overdue"><span>Просроченная дебиторка</span><b>${fmt(S.arOverdue)}</b><small>вернуть сейчас</small></div>
          <div class="ax-kpi ok" data-ask="closing"><span>Свободный остаток</span><b>${fmt(S.closing)}</b><small>runway ${S.runwayDays} дн.</small></div>
          <div class="ax-kpi" data-ask="year_potential"><span>Потенциал года</span><b>${fmt((vat.save || 0) * 12 + (S.arOverdue || 0))}</b><small>НДС×12 + дебиторка</small></div>
        </div>
        <div class="ax-grid-2">
          <div class="ax-panel" data-ask="chart_opps"><div class="ax-ph"><h3>Эффект по возможностям</h3></div><div class="ax-chart tall"><canvas id="ax-opp"></canvas></div></div>
          <div class="ax-panel" data-ask="opp_plan"><div class="ax-ph"><h3>Приоритетный план</h3></div>
            <div class="ax-opp-list">${S.opportunities.map((o, i) => `
              <div class="ax-opp ${i === 0 ? 'best' : ''}" data-ask="opp_item" data-ask-title="${esc(o.title)}" data-ask-save="${o.save}">
                <div class="ax-opp-rank">${i + 1}</div>
                <div class="ax-opp-body"><b>${esc(o.title)}</b><p>${esc(o.why)}</p>
                  <button type="button" class="btn btn-sm ${i === 0 ? 'btn-primary' : 'btn-outline'}" data-opp-act="${esc(o.action)}">${esc(o.cta)}</button>
                </div>
                <div class="ax-opp-save">${fmt(o.save)}<small>${o.saveYear !== o.save ? '≈ ' + mln(o.saveYear) + ' млн/год' : 'эффект'}</small></div>
              </div>`).join('')}</div>
          </div>
        </div>
        ${insightStrip(S)}
      </div>`;
    }

    if (view === 'ar' || view === 'ap') {
      const rows = view === 'ar' ? S.ar : S.ap;
      const total = view === 'ar' ? S.arTotal : S.apTotal;
      const aging = view === 'ar' ? S.arAging : S.apAging;
      const sorted = rows.slice().sort((a, b) => b.amount - a.amount);
      const topMix = sorted.slice(0, 5);
      const restMix = sorted.slice(5);
      const restSum = restMix.reduce((s, r) => s + r.amount, 0);
      const mixItems = restSum > 0 ? [...topMix, { name: `Прочие (${restMix.length})`, amount: restSum }] : topMix;
      const colors = ['#0a0a0b', '#ff2e88', '#16a34a', '#2563eb', '#c2410c', '#a1a1aa'];
      const aKeys = Object.keys(aging || {});
      return `<div class="ax ax-debt" data-ax="${view}">${h}
        <div class="ax-kpis ax-kpis-compact">
          <div class="ax-kpi ${view === 'ar' ? 'warn' : ''}" data-ask="${view === 'ar' ? 'ar_total' : 'ap_total'}"><span>Итого</span><b>${fmt(total)}</b><small>${rows.length} контрагентов</small></div>
          <div class="ax-kpi" data-ask="${view === 'ar' ? 'ar_overdue' : 'ap_soon'}"><span>${view === 'ar' ? 'Просрочено' : 'К оплате скоро'}</span><b>${view === 'ar' ? fmt(S.arOverdue) : fmt(rows.slice(0, 2).reduce((s, x) => s + x.amount, 0))}</b></div>
          <div class="ax-kpi" data-ask="${view === 'ar' ? 'dso' : 'dpo'}"><span>${view === 'ar' ? 'DSO' : 'DPO'}</span><b>${view === 'ar' ? (S.collectionDays || 0) : (S.payDays || 0)} дн.</b><small>оборотный цикл</small></div>
          <div class="ax-kpi" data-ask="debt_share"><span>Доля к обороту</span><b>${Math.round(total / Math.max(S.inTotal, 1) * 100)}%</b><small>от прихода месяца</small></div>
        </div>
        <div class="ax-debt-top">
          <div class="ax-panel" data-ask="${view === 'ar' ? 'chart_ar_aging' : 'chart_ap_aging'}">
            <div class="ax-ph"><h3>Срок долга</h3><span>млн сум</span></div>
            <div class="ax-aging-list">${(aKeys.length ? aKeys : ['0', '1–30', '31–60', '60+']).map((k, i) => {
              const v = (aging && aging[k]) || 0;
              const maxA = Math.max(1, ...Object.values(aging || { x: 1 }));
              const pct = Math.round(v / maxA * 100);
              const col = ['#a1a1aa', '#2563eb', '#c2410c', '#ff2e88'][i % 4];
              const lab = k === '0' ? 'Текущие' : k === '60+' ? '60+ дн.' : k + ' дн.';
              return `<div class="ax-aging-row"><span class="ax-aging-lab">${esc(lab)}</span><div class="ax-aging-track"><i style="width:${v > 0 ? Math.max(8, pct) : 0}%;background:${col}"></i></div><b>${mln(v)}</b></div>`;
            }).join('')}</div>
          </div>
          <div class="ax-panel" data-ask="${view === 'ar' ? 'chart_ar_mix' : 'chart_ap_mix'}">
            <div class="ax-ph"><h3>Кто сколько должен</h3><span>доля от итога</span></div>
            <div class="ax-donut-split">
              <div class="ax-chart ax-chart-donut"><canvas id="ax-debt"></canvas></div>
              <ul class="ax-legend">${mixItems.map((r, i) => {
                const pct = Math.round(r.amount / Math.max(total, 1) * 100);
                return `<li><i style="background:${colors[i % colors.length]}"></i><span class="ax-leg-nm">${esc(String(r.name).replace(/[«»]/g, ''))}</span><b>${pct}%</b><em>${mln(r.amount)}</em></li>`;
              }).join('')}</ul>
            </div>
          </div>
        </div>
        <div class="ax-panel wide" data-ask="${view === 'ar' ? 'ar_top' : 'ap_top'}">
          <div class="ax-ph"><h3>${view === 'ar' ? 'Все должники' : 'Всем должны'}</h3><span>${sorted.length} · ${mln(total)} млн</span></div>
          <div class="ax-debt-table">
            <div class="ax-debt-head"><span>Контрагент</span><span>Срок</span><span>Дней</span><span>Доля</span><span class="n">Сумма</span></div>
            ${sorted.map(r => {
              const pct = Math.round(r.amount / Math.max(total, 1) * 100);
              const overdue = r.age > 14 || /просроч|сомнитель/i.test(r.note || '');
              return `<div class="ax-debt-row ${overdue ? 'late' : ''}" data-ask="party" data-ask-name="${esc(r.name)}" data-ask-amount="${r.amount}" data-ask-note="${esc(r.note || '')}" data-ask-age="${r.age}" data-ask-kind="${view}">
                <div class="ax-debt-who"><b>${esc(r.name)}</b><span>${esc(r.note || '—')}</span>
                  <div class="ax-debt-bar"><i style="width:${Math.max(4, pct)}%"></i></div></div>
                <span>${esc(r.due)}</span>
                <span>${r.age}</span>
                <span>${pct}%</span>
                <strong class="n">${fmt(r.amount)}</strong>
              </div>`;
            }).join('')}
          </div>
        </div>
        ${insightStrip(S)}
      </div>`;
    }

    if (view === 'rent' || view === 'credit') {
      const cr = S.credit;
      return `<div class="ax" data-ax="${view}">${h}
        <div class="ax-kpis">
          <div class="ax-kpi" data-ask="rent_month"><span>Аренда / мес</span><b>18 000 000</b><small>ноябрь к оплате</small></div>
          <div class="ax-kpi" data-ask="credit_pay"><span>Кредит · платёж</span><b>${fmt(cr.monthly)}</b><small>${cr.nextDue}</small></div>
          <div class="ax-kpi" data-ask="credit_left"><span>Остаток кредита</span><b>${fmt(cr.left)}</b><small>${(cr.rate * 100).toFixed(0)}% · ${esc(cr.bank)}</small></div>
          <div class="ax-kpi warn" data-ask="fixed_load"><span>Фикс. нагрузка / мес</span><b>${fmt(18000000 + cr.monthly)}</b><small>аренда + кредит</small></div>
        </div>
        <div class="ax-grid-2">
          <div class="ax-panel" data-ask="chart_rent"><div class="ax-ph"><h3>Аренда · 6 месяцев</h3></div><div class="ax-chart tall"><canvas id="ax-rent"></canvas></div></div>
          <div class="ax-panel" data-ask="chart_credit"><div class="ax-ph"><h3>Кредит · график</h3></div><div class="ax-chart tall"><canvas id="ax-credit"></canvas></div></div>
        </div>
        <div class="ax-timeline">${[...S.rent.map(r => ({ ...r, kind: 'аренда' })), ...cr.schedule.map(r => ({ month: r.date, date: r.date, amount: r.amount, status: r.status, kind: 'кредит' }))].map(r => `
          <div class="ax-tl ${r.status === 'оплачено' ? 'ok' : r.status === 'к оплате' ? 'due' : ''}" data-ask="schedule_item" data-ask-kind="${esc(r.kind)}" data-ask-amount="${r.amount}" data-ask-status="${esc(r.status)}">
            <span class="ax-tl-d">${esc(r.date || r.month)}</span>
            <span class="ax-tl-k">${esc(r.kind)}</span>
            <b>${mln(r.amount)} млн</b>
            <span class="ax-tl-s">${esc(r.status)}</span>
          </div>`).join('')}</div>
        ${insightStrip(S)}
      </div>`;
    }

    // overview / cashflow / bank / cash — dense
    const inn = view === 'cash' ? S.cashIn : view === 'bank' ? S.bankIn : S.inTotal;
    const out = view === 'cash' ? S.cashOut : view === 'bank' ? S.bankOut : S.outTotal;
    return `<div class="ax" data-ax="${view}">${h}
      <div class="ax-kpis">
        <div class="ax-kpi ok" data-ask="in_total"><span>Приход</span><b>${fmt(inn)}</b><small>${mln(inn)} млн</small></div>
        <div class="ax-kpi warn" data-ask="out_total"><span>Расход</span><b>${fmt(out)}</b><small>${mln(out)} млн</small></div>
        <div class="ax-kpi pink" data-ask="closing"><span>Остаток</span><b>${fmt(S.closing)}</b><small>начало ${mln(S.opening)} млн</small></div>
        <div class="ax-kpi" data-ask="runway"><span>Чистый / runway</span><b>${fmt(S.net)}</b><small>${S.runwayDays} дней ликвидности</small></div>
      </div>
      <div class="ax-grid-2">
        <div class="ax-panel" data-ask="chart_flow"><div class="ax-ph"><h3>Остаток накопительно</h3><span>день за днём</span></div><div class="ax-chart tall"><canvas id="ax-flow"></canvas></div></div>
        <div class="ax-panel" data-ask="chart_weeks"><div class="ax-ph"><h3>12 недель · маржа</h3><span>%</span></div><div class="ax-chart tall"><canvas id="ax-weeks"></canvas></div></div>
      </div>
      <div class="ax-grid-3">
        <div class="ax-panel" data-ask="chart_pie"><div class="ax-ph"><h3>Приход / расход</h3></div><div class="ax-chart"><canvas id="ax-pie"></canvas></div></div>
        <div class="ax-panel" data-ask="chart_mix"><div class="ax-ph"><h3>Структура расходов</h3></div><div class="ax-chart"><canvas id="ax-mix"></canvas></div></div>
        <div class="ax-panel" data-ask="chart_wd"><div class="ax-ph"><h3>По дням недели</h3></div><div class="ax-chart"><canvas id="ax-wd"></canvas></div></div>
      </div>
      <div class="ax-grid-2">
        <div class="ax-panel" data-ask="chart_days"><div class="ax-ph"><h3>По дням октября</h3></div><div class="ax-chart tall"><canvas id="ax-days"></canvas></div></div>
        <div class="ax-panel" data-ask="due_soon"><div class="ax-ph"><h3>Ближайшие платежи</h3></div>
          <div class="ax-due">${S.dueSoon.slice(0, 7).map(d => `
            <div class="ax-due-row" data-ask="due_item" data-ask-title="${esc(d.title)}" data-ask-amount="${d.amount}"><div><b>${esc(d.title)}</b><span>${esc(d.date)} · ${esc(d.kind)}</span></div><strong>${mln(d.amount)} млн</strong></div>`).join('')}
          </div>
          <div class="ax-ph" style="margin-top:14px"><h3>Крупнейшие приходы</h3></div>
          <div class="ax-mini">${(S.topIn || []).map(r => `<div data-ask="top_in" data-ask-name="${esc(r.name)}" data-ask-amount="${r.amount}"><span>${esc(r.name)}</span><b>+${mln(r.amount)}</b></div>`).join('')}</div>
          <div class="ax-ph" style="margin-top:12px"><h3>Крупнейшие расходы</h3></div>
          <div class="ax-mini out">${(S.topOut || []).map(r => `<div data-ask="top_out" data-ask-name="${esc(r.name)}" data-ask-amount="${r.amount}"><span>${esc(r.name)}</span><b>−${mln(r.amount)}</b></div>`).join('')}</div>
        </div>
      </div>
      ${insightStrip(S)}
    </div>`;
  }

  let charts = [];
  function killCharts() { charts.forEach(c => { try { c.destroy(); } catch {} }); charts = []; }

  function paint(view0, S0, vat = {}) {
    killCharts();
    if (!global.Chart) return;
    const view = view0 === 'overview' ? 'cashflow' : view0;
    const S = ensure(S0);
    Chart.defaults.font.family = "'Inter Tight', system-ui, sans-serif";
    Chart.defaults.color = '#6b6b73';
    Chart.defaults.borderColor = 'rgba(0,0,0,.06)';
    const ink = '#0a0a0b', pink = '#ff2e88', ok = '#16a34a', warn = '#ea580c', mute = '#a1a1aa';
    const blue = '#2563eb', soft = ['#ff2e88', '#0a0a0b', '#16a34a', '#ea580c', '#2563eb', '#a1a1aa', '#f59e0b', '#0891b2'];

    const add = (id, cfg) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const parent = el.parentElement;
      if (parent && parent.clientHeight < 40) parent.style.height = '220px';
      const c = new Chart(el, cfg);
      charts.push(c);
      return c;
    };

    if (view === 'forecast') {
      const F = S.forecast;
      const labels = (F.series || []).map(w => w.label);
      const histN = (F.hist || []).length;
      const baseLine = (key, color) => ({
        label: key === 'inn' ? 'Приход' : 'Расход',
        data: (F.series || []).map(w => w[key]),
        borderColor: color,
        backgroundColor: color === pink ? 'rgba(255,46,136,.08)' : 'rgba(22,163,74,.08)',
        tension: 0.35,
        pointRadius: (F.series || []).map((w, i) => (i < histN ? 2 : 3)),
        borderWidth: 2.2,
        segment: {
          borderDash: ctx => (ctx.p0DataIndex >= histN - 1 ? [5, 4] : undefined),
        },
      });
      const bandHi = (keyHi, color) => ({
        label: 'Верх 90%',
        data: (F.series || []).map((w, i) => (i < histN ? null : w[keyHi])),
        borderColor: color,
        borderDash: [2, 4],
        pointRadius: 0,
        borderWidth: 1.2,
        fill: false,
      });
      const bandLo = (keyLo, color) => ({
        label: 'Низ 90%',
        data: (F.series || []).map((w, i) => (i < histN ? null : w[keyLo])),
        borderColor: color,
        borderDash: [2, 4],
        pointRadius: 0,
        borderWidth: 1.2,
        fill: '-1',
        backgroundColor: 'rgba(255,46,136,.10)',
      });
      add('ax-fc-in', {
        type: 'line',
        data: { labels, datasets: [baseLine('inn', ok), bandHi('innHi', 'rgba(22,163,74,.45)'), bandLo('innLo', 'rgba(22,163,74,.45)')] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 10 } } } }, scales: { y: { ticks: { callback: v => mln(v) } } } },
      });
      add('ax-fc-out', {
        type: 'line',
        data: { labels, datasets: [baseLine('out', ink), bandHi('outHi', 'rgba(10,10,11,.35)'), bandLo('outLo', 'rgba(10,10,11,.35)')] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 10 } } } }, scales: { y: { ticks: { callback: v => mln(v) } } } },
      });
      add('ax-fc-scen', {
        type: 'bar',
        data: {
          labels: (F.scenarios || []).map(s => s.title),
          datasets: [
            { label: 'Приход', data: (F.scenarios || []).map(s => s.inn), backgroundColor: ok, borderRadius: 8 },
            { label: 'Расход', data: (F.scenarios || []).map(s => s.out), backgroundColor: ink, borderRadius: 8 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 10 } } } }, scales: { y: { ticks: { callback: v => mln(v) } }, x: { grid: { display: false } } } },
      });
      add('ax-fc-months', {
        type: 'bar',
        data: {
          labels: (F.months || []).map(m => m.label),
          datasets: [
            { label: 'Приход', data: (F.months || []).map(m => m.inn), backgroundColor: ok, borderRadius: 8 },
            { label: 'Маржа', data: (F.months || []).map(m => m.margin), backgroundColor: pink, borderRadius: 8 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 10 } } } }, scales: { y: { ticks: { callback: v => mln(v) } }, x: { grid: { display: false } } } },
      });
      const cats = (F.categoryMonth || []).slice().sort((a, b) => b.amount - a.amount).slice(0, 10);
      add('ax-fc-cats', {
        type: 'bar',
        data: {
          labels: cats.map(c => c.cat),
          datasets: [{ data: cats.map(c => c.amount), backgroundColor: cats.map(c => c.side === 'in' ? ok : soft[cats.indexOf(c) % soft.length]), borderRadius: 8 }],
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => mln(v) } }, y: { grid: { display: false } } } },
      });
      const days = (F.daily || []).filter(d => !d.closed);
      add('ax-fc-daily', {
        type: 'bar',
        data: {
          labels: days.map(d => d.label || d.iso?.slice(8)),
          datasets: [
            { label: 'Приход', data: days.map(d => d.inn), backgroundColor: ok, borderRadius: 3 },
            { label: 'Расход', data: days.map(d => d.out), backgroundColor: ink, borderRadius: 3 },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 10 } } } }, scales: { y: { ticks: { callback: v => mln(v) } }, x: { ticks: { maxTicksLimit: 12 }, grid: { display: false } } } },
      });
      return;
    }

    if (view === 'opps' || view === 'today') {
      add('ax-opp', {
        type: 'bar',
        data: {
          labels: (S.opportunities.length ? S.opportunities : [{ title: 'Нет данных', save: 0 }]).map(o => String(o.title).split(/[·:]/)[0].trim().slice(0, 28)),
          datasets: [{ data: (S.opportunities.length ? S.opportunities : [{ save: 0 }]).map(o => o.save), backgroundColor: soft, borderRadius: 10, barThickness: 26 }],
        },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => mln(v) + ' млн' } }, y: { grid: { display: false } } } },
      });
      return;
    }

    if (view === 'ar' || view === 'ap') {
      const rows = (view === 'ar' ? S.ar : S.ap).slice();
      const sorted = rows.slice().sort((a, b) => b.amount - a.amount);
      const top = sorted.slice(0, 5);
      const restSum = sorted.slice(5).reduce((s, r) => s + r.amount, 0);
      const slice = restSum > 0
        ? [...top, { name: `Прочие (${sorted.length - 5})`, amount: restSum }]
        : (top.length ? top : [{ name: 'Нет', amount: 1 }]);
      const colors = ['#0a0a0b', '#ff2e88', '#16a34a', '#2563eb', '#c2410c', '#a1a1aa'];
      add('ax-debt', {
        type: 'doughnut',
        data: {
          labels: slice.map(r => String(r.name).replace(/[«»]/g, '').slice(0, 18)),
          datasets: [{ data: slice.map(r => r.amount), backgroundColor: colors.slice(0, slice.length), borderWidth: 0, hoverOffset: 4 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const v = ctx.raw || 0;
                  const sum = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
                  return ` ${ctx.label}: ${mln(v)} млн (${Math.round(v / sum * 100)}%)`;
                },
              },
            },
          },
        },
      });
      return;
    }

    if (view === 'rent' || view === 'credit') {
      add('ax-rent', {
        type: 'bar',
        data: {
          labels: S.rent.map(r => r.month.split(' ')[0].slice(0, 3)),
          datasets: [{ data: S.rent.map(r => r.amount), backgroundColor: S.rent.map(r => r.status === 'оплачено' ? ok : r.status === 'к оплате' ? pink : mute), borderRadius: 8, barThickness: 26 }],
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => mln(v) } }, x: { grid: { display: false } } } },
      });
      add('ax-credit', {
        type: 'line',
        data: {
          labels: S.credit.schedule.map(r => r.date.slice(0, 5)),
          datasets: [{ data: S.credit.schedule.map(r => r.amount), borderColor: ink, backgroundColor: 'rgba(10,10,11,.07)', fill: true, tension: 0.35, pointRadius: 5, pointBackgroundColor: S.credit.schedule.map(r => r.status === 'к оплате' ? pink : r.status === 'оплачено' ? ok : mute) }],
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => mln(v) } } } },
      });
      return;
    }

    const rows = view === 'cash' ? S.cash : view === 'bank' ? S.bank : [...S.bank, ...S.cash];
    const cum = cumulative(S.opening, rows);
    const days = seriesByDay(rows);
    const inn = view === 'cash' ? S.cashIn : view === 'bank' ? S.bankIn : S.inTotal;
    const out = view === 'cash' ? S.cashOut : view === 'bank' ? S.bankOut : S.outTotal;

    const base = { responsive: true, maintainAspectRatio: false };
    add('ax-flow', {
      type: 'line',
      data: { labels: cum.labels, datasets: [{ data: cum.vals, borderColor: pink, backgroundColor: 'rgba(255,46,136,.12)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2.4 }] },
      options: { ...base, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => mln(v) + ' млн' } }, x: { ticks: { maxTicksLimit: 10 }, grid: { display: false } } } },
    });
    add('ax-weeks', {
      type: 'line',
      data: {
        labels: S.weeks.map(w => w.label),
        datasets: [
          { label: 'Приход', data: S.weeks.map(w => w.inn), borderColor: ok, tension: 0.35, pointRadius: 2, borderWidth: 2 },
          { label: 'Расход', data: S.weeks.map(w => w.out), borderColor: ink, tension: 0.35, pointRadius: 2, borderWidth: 2 },
          { label: 'Маржа', data: S.weeks.map(w => w.margin), borderColor: pink, tension: 0.35, pointRadius: 2, borderWidth: 2, borderDash: [5, 4] },
        ],
      },
      options: { ...base, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } } }, scales: { y: { ticks: { callback: v => mln(v) } } } },
    });
    add('ax-pie', {
      type: 'doughnut',
      data: { labels: ['Приход', 'Расход'], datasets: [{ data: [inn || 1, out || 1], backgroundColor: [ok, ink], borderWidth: 0 }] },
      options: { ...base, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } } },
    });
    add('ax-mix', {
      type: 'doughnut',
      data: { labels: (S.expenseMix.length ? S.expenseMix : [{ cat: 'прочее', amount: 1 }]).map(x => x.cat), datasets: [{ data: (S.expenseMix.length ? S.expenseMix : [{ amount: 1 }]).map(x => x.amount), backgroundColor: soft, borderWidth: 0 }] },
      options: { ...base, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 10 } } } } },
    });
    add('ax-wd', {
      type: 'bar',
      data: {
        labels: S.weekdays.map(w => w.name),
        datasets: [
          { label: 'Приход', data: S.weekdays.map(w => w.in), backgroundColor: ok, borderRadius: 5 },
          { label: 'Расход', data: S.weekdays.map(w => w.out), backgroundColor: ink, borderRadius: 5 },
        ],
      },
      options: { ...base, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 10 } } } }, scales: { y: { ticks: { callback: v => mln(v) } }, x: { grid: { display: false } } } },
    });
    add('ax-days', {
      type: 'bar',
      data: {
        labels: days.labels,
        datasets: [
          { label: 'Приход', data: days.inn, backgroundColor: ok, borderRadius: 3, stack: 's' },
          { label: 'Расход', data: days.out.map(x => -x), backgroundColor: ink, borderRadius: 3, stack: 's' },
        ],
      },
      options: { ...base, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 10 } } } }, scales: { x: { stacked: true, ticks: { maxTicksLimit: 12 }, grid: { display: false } }, y: { stacked: true, ticks: { callback: v => mln(Math.abs(v)) } } } },
    });
  }

  global.HisobAnalytics = { dashHtml, paint, killCharts, VIEWS, fmt, mln };
})(window);
