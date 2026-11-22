// Office AI — finance books + XGBoost forecast (bundle from /api/finance/bundle).
window.FINANCE = (() => {
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  let bundle = window.__FINANCE_BUNDLE || null;
  let ready = null;

  function ensure() {
    if (bundle?.snapshot) return Promise.resolve(bundle);
    if (ready) return ready;
    ready = fetch('/api/finance/bundle').then(r => {
      if (!r.ok) throw new Error('finance bundle ' + r.status);
      return r.json();
    }).then(b => { bundle = b; window.__FINANCE_BUNDLE = b; return b; });
    return ready;
  }

  function snapshot(vat = {}) {
    const S = bundle?.snapshot;
    if (!S) {
      // sync fallback until bundle loads — empty shell
      return {
        period: 'октябрь 2026', opening: 0, closing: 0, net: 0, inTotal: 0, outTotal: 0,
        bankIn: 0, bankOut: 0, cashIn: 0, cashOut: 0, arTotal: 0, apTotal: 0, arOverdue: 0,
        runwayDays: 1, collectionDays: 1, payDays: 1, bank: [], cash: [], ar: [], ap: [],
        rent: [], credit: { schedule: [], monthly: 0, left: 0, rate: 0, bank: '', nextDue: '' },
        dueSoon: [], opportunities: [], weeks: [], expenseMix: [], insights: ['Загрузка XGBoost…'],
        forecast: { hist: [], forward: [], series: [], scenarios: [], months: [], drivers: [], nextMonthIn: 0, nextMonthOut: 0, nextMargin: 0, growthIn: 0, wapeIn: 0, tip: '', method: 'XGBoost loading' },
        arAging: {}, apAging: {}, weekdays: [], opsCount: 0, topIn: [], topOut: [],
      };
    }
    // refresh VAT-linked opportunities lightly
    const out = { ...S, forecast: { ...S.forecast } };
    if (vat && (vat.pay || vat.save)) {
      out.opportunities = (S.opportunities || []).map(o => ({ ...o }));
      const v = out.opportunities.find(o => o.id === 'vat6');
      if (v && vat.save) { v.save = vat.save; v.saveYear = vat.save * 12; }
    }
    return out;
  }

  function contextLines(vat = {}) {
    const S = snapshot(vat);
    const F = S.forecast || {};
    return [
      `Денежный поток ${S.period}: ${S.opsCount} операций (история 3 мес · ${S.opsCountAll || S.opsCount}). Приход ${S.inTotal}, расход ${S.outTotal}, чистый ${S.net}, остаток ${S.closing}.`,
      `Банк приход ${S.bankIn} / расход ${S.bankOut}. Касса приход ${S.cashIn} / расход ${S.cashOut}.`,
      `Дебиторка ${S.arTotal} (просрочено ${S.arOverdue}). Кредиторка ${S.apTotal}. DSO ${S.collectionDays} дн., DPO ${S.payDays} дн., runway ${S.runwayDays} дн.`,
      `Структура расходов: ${(S.expenseMix || []).slice(0, 6).map(x => `${x.cat} ${x.amount}`).join('; ')}.`,
      `Прогноз trade XGBoost (ноябрь): приход ${F.nextMonthIn}, расход ${F.nextMonthOut}, рост ${F.growthIn}%, WAPE нед. ${F.wapeIn}%. ${F.method || ''}`,
      `Категории ноября: ${(F.categoryMonth || []).slice(0, 8).map(c => `${c.cat} ${c.amount}`).join('; ')}.`,
      `Инсайты: ${(S.insights || []).join(' ')}`,
    ];
  }

  function buildForecast() {
    return snapshot().forecast || {};
  }

  // kick off load immediately
  ensure().catch(e => console.warn('FINANCE bundle', e));

  return {
    ensure, snapshot, contextLines, buildForecast, fmt,
    get bank() { return snapshot().bank || []; },
    get cash() { return snapshot().cash || []; },
    get ar() { return snapshot().ar || []; },
    get ap() { return snapshot().ap || []; },
    get rent() { return snapshot().rent || []; },
    get credit() { return snapshot().credit || {}; },
    get weeks() { return snapshot().weeks || []; },
  };
})();
