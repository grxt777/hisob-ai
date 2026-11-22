// Live: create_document tool via /api/chat (skips if server/key down).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.HISOB_URL || 'http://127.0.0.1:5180';

describe('create_document (chat)', () => {
  it('LLM returns create_document with non-empty body', async (t) => {
    let up = false;
    try {
      const h = await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) });
      up = h.ok;
    } catch { up = false; }
    if (!up) { t.skip('server not running'); return; }

    const r = await fetch(BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: 'Компания: Пекарня DEMO, ИНН 305112200. Период: октябрь 2026. Продажи без НДС: 445215206.',
        docs: [{ id: 'esf-s', nm: 'ЭСФ · продажи' }, { id: 'app-6', nm: 'Заявление' }],
        messages: [{ role: 'user', content: 'Создай служебную записку об инвентаризации на 1 ноября 2026' }],
      }),
    });
    if (r.status === 503) { t.skip('OPENROUTER_API_KEY missing'); return; }
    assert.equal(r.status, 200);
    const j = await r.json();
    const act = (j.actions || []).find(a => a.name === 'create_document');
    assert.ok(act, 'expected create_document action');
    assert.ok((act.args?.body || '').length > 80);
    assert.ok(act.args?.title);
    assert.ok(['записка', 'письмо', 'приказ', 'заявление', 'другое'].includes(act.args.kind) || act.args.kind);
  });
});
