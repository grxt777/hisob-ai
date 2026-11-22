// Unit tests: VAT, invoices, calculator (Node built-in test runner).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { vatSummary, queryInvoices, calculate } from '../lib/tools.js';

describe('vatSummary', () => {
  it('returns positive sales and payable VAT from books', () => {
    const v = vatSummary();
    assert.ok(v.sales_invoices > 0);
    assert.ok(v.purchase_invoices > 0);
    assert.ok(v.sales_base > 0);
    assert.ok(v.vat_charged >= v.vat_deductible);
    assert.ok(Math.abs(v.vat_payable - (v.vat_charged - v.vat_deductible)) <= 1);
    assert.ok(v.monthly_saving > 0);
  });
});

describe('queryInvoices', () => {
  it('finds top sales counterparty', () => {
    const { result } = queryInvoices({ type: 'sales', group_by: 'counterparty', limit: 1, sort: 'sum_desc' });
    assert.equal(result.counterparties.length, 1);
    assert.ok(result.counterparties[0].base > 0);
    assert.ok(result.counterparties[0].name);
  });

  it('filters by counterparty substring', () => {
    const top = queryInvoices({ type: 'sales', group_by: 'counterparty', limit: 1 }).result.counterparties[0];
    const needle = top.name.split(/\s+/)[0].replace(/[«»"]/g, '').slice(0, 4);
    const { result } = queryInvoices({ type: 'sales', counterparty: needle, group_by: 'none', limit: 20 });
    assert.ok(result.invoices_found >= 1);
    assert.ok(result.invoices.every(r => r.name.toLowerCase().includes(needle.toLowerCase())));
  });

  it('caps limit at 60', () => {
    const { result } = queryInvoices({ type: 'sales', group_by: 'none', limit: 999 });
    assert.ok(result.invoices.length <= 60);
  });
});

describe('calculate', () => {
  it('evaluates safe arithmetic', () => {
    const { result } = calculate({ expression: '100+20*3', label: 't' });
    assert.equal(result.value, 160);
  });

  it('rejects letters / injection', () => {
    const { result } = calculate({ expression: 'process.exit(1)' });
    assert.ok(result.error);
  });

  it('handles percent', () => {
    const { result } = calculate({ expression: '200*6%' });
    assert.equal(result.value, 12);
  });
});
