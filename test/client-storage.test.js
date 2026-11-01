import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { identityOf, sourceDigest, normalizeInstant, resultEnvelope, resultKey, RESULT_VERSION } from '../shared/contract.js';
import { createApp } from '../src/server.js';

const text = JSON.stringify({ playedAt: '2026-09-12T19:30:00+03:00', ...JSON.parse(readFileSync(new URL('./fixtures/real-game.json', import.meta.url))) });
test('идентичность по времени и игрокам, оформление и конфликт содержания', async () => {
  const a = JSON.parse(text), b = structuredClone(a);
  b.playedAt = '2026-09-12T16:30:00Z'; b.teams.reverse(); b.teams.forEach(t => t.players.reverse());
  Object.values(b.rounds[0].deal).forEach(h => h.reverse());
  assert.equal(await identityOf(a), await identityOf(b));
  assert.equal(await sourceDigest(a), await sourceDigest(b));
  b.rounds[0].moves[0].stone = '2-2';
  assert.equal(await identityOf(a), await identityOf(b));
  assert.notEqual(await sourceDigest(a), await sourceDigest(b));
  assert.notEqual(normalizeInstant('2026-01-01T00:00:00.0000001Z'), normalizeInstant('2026-01-01T00:00:00.0000002Z'));
  for (const value of ['', null, '2026-02-30T00:00:00Z', '2026-01-01', '2026-01-01T00:00:00']) assert.throws(() => normalizeInstant(value));
});

test('API v1 хранит клиентские данные без вычислений; конкурентный повтор и конфликт', async () => {
  const app = createApp(); await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}/api/v1`;
  const request = async (route, data, method = data ? 'POST' : 'GET') => {
    const response = await fetch(base + route, { method, ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const first = await request('/import', { text, name: 'Первый.json' }); assert.equal(first.status, 201);
    const game = first.data;
    const again = await request('/import', { text: JSON.stringify(JSON.parse(text), null, 4), name: 'Второй.json' });
    assert.equal(again.status, 200); assert.equal(again.data.id, game.id); assert.equal(again.data.fileName, 'Первый.json');
    const changed = JSON.parse(text); changed.rounds[0].moves[0].stone = '2-2';
    assert.equal((await request('/import', { text: JSON.stringify(changed) })).status, 409);
    assert.equal((await request('/analyze', { gameId: game.id, round: 1 })).status, 410);
    assert.equal((await request('/health')).data.computation, 'client');
    const descriptor = { version: RESULT_VERSION, kind: 'round', gameId: game.id, round: 1 };
    // Mathematical authenticity is deliberately outside the storage boundary.
    const distribution = { leaves: '1', wins: ['1', '0', '0'], minDepth: 0, depth: 0, fish: '0', eggs: '0', outcomes: { emptyHand: ['1','0','0'], fish: ['0','0','0'], eggs: ['0','0','0'] } };
    const result = { number: 1, teams: ['A','B'], players: [{name:'a',seat:1},{name:'b',seat:2},{name:'c',seat:3},{name:'d',seat:4}], base: distribution, steps: [{ ...distribution, index: 0, terminal: true, alternatives: [], hands: [[],[],[],[]], chain: [], turn: 0, ends: [] }], stats: { elapsedMs: 1 } };
    const envelope = await resultEnvelope(descriptor, result), key = await resultKey(descriptor);
    const replies = await Promise.all([request('/results/'+key, envelope, 'PUT'), request('/results/'+key, envelope, 'PUT')]);
    assert.deepEqual(replies.map(r=>r.status).sort(), [200,201]);
    result.stats.elapsedMs = 100;
    assert.equal((await request('/results/'+key, await resultEnvelope(descriptor,result), 'PUT')).status, 200);
    const conflict = structuredClone(result); conflict.base.wins = ['0','1','0']; conflict.steps[0].wins = ['0','1','0']; conflict.base.outcomes.emptyHand = ['0','1','0'];
    assert.equal((await request('/results/'+key, await resultEnvelope(descriptor,conflict), 'PUT')).status,409);
    const saved = await request('/results/'+key); assert.equal(saved.data.result.stats.elapsedMs,1); assert.equal(saved.data.provenance.verification,'structural-only');
    const manifest = await request(`/games/${game.id}/analyses`); assert.equal(manifest.data.analyses.length,1); assert.equal(manifest.data.analyses[0].result,undefined);
    assert.deepEqual((await request(`/games/${game.id}`)).data.completedRounds,[1]);
    assert.equal((await request('/results/'+'0'.repeat(64))).status,404);
    assert.equal((await fetch(base+'/import',{method:'POST',body:'{}'})).status,415);
  } finally { await app.close(); }
});
