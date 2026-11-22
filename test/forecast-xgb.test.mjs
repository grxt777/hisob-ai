// Integration: Python XGBoost next-month forecast (requires python3 + xgboost).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateBooks, forXgb } from '../lib/forecast/generate.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const PY = join(DIR, '../lib/forecast/xgboost_forecast.py');

function runXgb(payload, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [PY], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('xgboost timeout')); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(t); reject(e); });
    child.on('close', code => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(err || `exit ${code}`));
      try { resolve(JSON.parse(out)); }
      catch (e) { reject(new Error('bad json: ' + e.message + '\n' + out.slice(0, 300))); }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

describe('xgboost_forecast.py', () => {
  it('forecasts November within realistic band vs October', async () => {
    const payload = forXgb(generateBooks());
    const oct = payload.months.find(m => m.month === '2026-10');
    const fc = await runXgb(payload);
    assert.equal(fc.horizon, '2026-11');
    assert.match(fc.model || '', /XGBoost/i);
    assert.ok(fc.nextMonthIn > oct.inn * 0.7 && fc.nextMonthIn < oct.inn * 1.25);
    assert.ok(fc.nextMonthOut > oct.out * 0.7 && fc.nextMonthOut < oct.out * 1.35);
    assert.ok(fc.wapeIn < 40, `wapeIn=${fc.wapeIn}`);
    assert.ok(fc.wapeOut < 40, `wapeOut=${fc.wapeOut}`);
    assert.ok((fc.daily || []).length === 30);
    assert.ok((fc.categoryMonth || []).length >= 8);

    const inSum = fc.categoryMonth.filter(c => c.side === 'in').reduce((s, c) => s + c.amount, 0);
    const outSum = fc.categoryMonth.filter(c => c.side === 'out').reduce((s, c) => s + c.amount, 0);
    assert.ok(Math.abs(inSum - fc.nextMonthIn) / fc.nextMonthIn < 0.02);
    assert.ok(Math.abs(outSum - fc.nextMonthOut) / fc.nextMonthOut < 0.05);

    const fixed = Object.fromEntries(fc.categoryMonth.map(c => [c.cat, c.amount]));
    assert.ok(fixed['аренда'] >= 17e6);
    assert.ok(fixed['зарплата'] >= 40e6);
    assert.ok(fixed['налог'] >= 20e6);
  });
});
