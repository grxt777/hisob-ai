// Live HTTP smoke against running server (skips if down).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.HISOB_URL || 'http://127.0.0.1:5180';

async function get(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, json: await r.json().catch(() => null), text: null };
}

describe('API smoke (localhost:5180)', () => {
  it('finance bundle + forecast + static + path block', async (t) => {
    let up = false;
    try {
      const h = await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) });
      up = h.ok;
    } catch { up = false; }
    if (!up) {
      t.skip('server not running');
      return;
    }

    const bundle = await get('/api/finance/bundle');
    assert.equal(bundle.status, 200);
    assert.ok(bundle.json.snapshot.inTotal > 0);
    assert.ok(bundle.json.forecast.nextMonthIn > 0);
    assert.ok((bundle.json.books?.bank || []).length > 0);

    const fc = await get('/api/forecast');
    assert.equal(fc.status, 200);
    assert.ok(fc.json.wapeIn < 50);

    const trav = await fetch(BASE + '/assets/../../../.env');
    assert.ok([403, 404].includes(trav.status), `traversal status ${trav.status}`);

    const js = await fetch(BASE + '/assets/hisob.js');
    assert.equal(js.status, 200);
    const body = await js.text();
    assert.match(body, /financeDocHtml/);
    assert.doesNotMatch(body, /showAnalytics\(id, true\)/);
  });
});
