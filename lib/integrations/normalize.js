// Normalize ЭСФ rows from Soliq / 1C / Didox into the shape Hisob uses.
const num = v => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const inn = v => String(v || '').replace(/\D/g, '').slice(0, 14);
const dateOf = v => {
  if (!v) return '';
  const s = String(v).trim();
  const m1 = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m1) {
    const y = m1[3].length === 2 ? '20' + m1[3] : m1[3];
    return `${m1[1].padStart(2, '0')}.${m1[2].padStart(2, '0')}.${y}`;
  }
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[3]}.${m2[2]}.${m2[1]}`;
  return s.slice(0, 10);
};

export function invoice(row = {}, kind = 'sales') {
  const name = String(row.name || row.partnerName || row.contragent || row.BuyerName || row.SellerName || row.Наименование || '').trim();
  const base = num(row.base ?? row.amountWithoutVat ?? row.DeliverySum ?? row.СуммаБезНДС ?? row.sum);
  let vat = num(row.vat ?? row.vatAmount ?? row.VatSum ?? row.СуммаНДС);
  if (!vat && row.withVat != null) vat = Math.max(0, num(row.withVat) - base);
  const out = {
    name: name || (kind === 'sales' ? 'Покупатель' : 'Поставщик'),
    inn: inn(row.inn || row.partnerInn || row.INN || row.BuyerTin || row.SellerTin || row.ИНН),
    num: String(row.num || row.number || row.docNumber || row.FacturaId || row.Номер || '').trim() || '—',
    date: dateOf(row.date || row.docDate || row.FacturaDate || row.Дата),
    base: Math.round(base * 100) / 100,
    vat: Math.round(vat * 100) / 100,
  };
  if (row.note || row.notDeductible || row.riskHigh) out.note = String(row.note || 'не в зачёт');
  return out;
}

export function bundle({ sales = [], purchases = [], company = {}, source, period } = {}) {
  return {
    source: source || 'demo',
    period: period || '',
    syncedAt: new Date().toISOString(),
    company: {
      name: company.name || '',
      inn: inn(company.inn),
    },
    sales: sales.map(r => invoice(r, 'sales')),
    purchases: purchases.map(r => invoice(r, 'purchases')),
  };
}
