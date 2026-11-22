// Unit tests: 3-month realistic books + daily series integrity.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateBooks, dailySeries, monthTotals, forXgb, expenseMix } from '../lib/forecast/generate.mjs';

const REQUIRED_OUT = ['аренда', 'коммунальные', 'зарплата', 'налог', 'кредит', 'сырьё'];
const REQUIRED_IN = ['эквайринг', 'розница', 'B2B'];

describe('generateBooks', () => {
  const books = generateBooks(20261022);

  it('covers Aug–Oct 2026 with bank+cash ops', () => {
    const all = [...books.bank, ...books.cash];
    assert.ok(all.length > 100, `ops=${all.length}`);
    const months = new Set(all.map(r => r.date.slice(3, 10))); // MM.YYYY
    assert.ok(months.has('08.2026'));
    assert.ok(months.has('09.2026'));
    assert.ok(months.has('10.2026'));
    assert.ok(![...months].some(m => m.startsWith('11.')), 'nov must not be in history books');
  });

  it('includes fixed obligation categories', () => {
    const cats = new Set([...books.bank, ...books.cash].map(r => r.cat));
    for (const c of [...REQUIRED_OUT, ...REQUIRED_IN]) assert.ok(cats.has(c), `missing ${c}`);
  });

  it('has AR/AP/rent/credit schedules', () => {
    assert.ok(books.ar.length >= 5);
    assert.ok(books.ap.length >= 4);
    assert.ok(books.rent.some(r => /ноябрь/i.test(r.month)));
    assert.equal(books.credit.monthly, 12500000);
  });

  it('is deterministic for same seed', () => {
    const b2 = generateBooks(20261022);
    assert.equal(books.bank.length, b2.bank.length);
    assert.equal(books.bank[0].amount, b2.bank[0].amount);
  });
});

describe('dailySeries / months', () => {
  const books = generateBooks();
  const days = dailySeries(books);
  const months = monthTotals(books);

  it('builds daily inn/out with JS dow', () => {
    assert.ok(days.length >= 70);
    const sample = days.find(d => d.inn > 0);
    assert.ok(sample.dow >= 0 && sample.dow <= 6);
    assert.ok(sample.cats);
  });

  it('month totals: Oct ≈ peak season vs Aug', () => {
    const aug = months.find(m => m.month === '2026-08');
    const oct = months.find(m => m.month === '2026-10');
    assert.ok(aug && oct);
    assert.ok(oct.inn > aug.inn * 0.95, 'oct should be >= ~aug seasonally');
    assert.ok(oct.out > 0 && oct.inn > oct.out);
  });

  it('forXgb payload has daily + cats', () => {
    const p = forXgb(books);
    assert.ok(p.daily.length === days.length);
    assert.ok(p.cats.includes('аренда'));
  });

  it('expenseMix ranks categories', () => {
    const mix = expenseMix(books);
    assert.ok(mix[0].amount >= mix[mix.length - 1].amount);
  });
});
