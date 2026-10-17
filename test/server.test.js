import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server.js';
import { decisionQuality } from '../public/impact.js';
import { keyEpisodes, summarizePlayerQuality } from '../public/quality.js';

test('локальный HTTP: проверка, worker, отмена, повтор, кеш и восстановление после ошибки', { timeout: 120000 }, async () => {
  const app = createApp({ examplesDir: new URL('./fixtures', import.meta.url).pathname });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (route, data, method = data === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + route, { method, ...(data === undefined ? {} : {
      body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' },
    }) });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(base + '/app.js')).status, 200);
    const theme = await fetch(base + '/theme.js');
    assert.equal(theme.status, 200);
    assert.match(theme.headers.get('content-type'), /text\/javascript/);
    assert.equal((await fetch(base + '/impact.js')).status, 200);
    assert.equal((await fetch(base + '/quality.js')).status, 200);
    assert.equal((await fetch(base + '/format.js')).status, 200);
    const navigation = await fetch(base + '/navigation.js');
    assert.equal(navigation.status, 200);
    assert.match(navigation.headers.get('content-type'), /text\/javascript/);
    assert.equal((await fetch(base, { headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await request('/api/import', { text: '{}' })).status, 400);
    assert.equal((await request('/api/example', { name: '../package.json' })).status, 400);
    const text = readFileSync(new URL('./fixtures/real-game.json', import.meta.url), 'utf8');
    const { data: game } = await request('/api/import', { text });
    assert.equal(game.rounds.length, 1);
    const { data: cancelled } = await request('/api/analyze', { gameId: game.id, round: 1 });
    assert.equal(cancelled.status, 'running');
    assert.equal(cancelled.stats.cacheBytesEstimate, 0);
    assert.equal((await request(`/api/jobs/${cancelled.id}`, undefined, 'DELETE')).data.status, 'cancelled');
    const { data: started } = await request('/api/analyze', { gameId: game.id, round: 1 });
    let job = started;
    while (job.status === 'running') {
      assert.ok(Number.isInteger(job.stats.cacheBytesEstimate) && job.stats.cacheBytesEstimate >= 0);
      await new Promise(resolve => setTimeout(resolve, 100));
      job = (await request(`/api/jobs/${job.id}`)).data;
    }
    assert.equal(job.status, 'done', job.error);
    assert.ok(job.stats.cacheBytesEstimate > 0);
    const { result } = job;
    assert.equal(result.base.leaves, '7328406');
    assert.equal(result.base.depth, 40);
    assert.ok(Number.isInteger(result.base.minDepth) && result.base.minDepth > 0 && result.base.minDepth <= result.base.depth);
    assert.equal(result.steps.at(-1).minDepth, 0);
    assert.deepEqual(result.base.wins, ['4255456', '3072949', '1']);
    assert.equal(result.steps.length, 16);
    assert.deepEqual(result.steps[0].delta, [0, 0, 0]);
    assert.deepEqual(result.steps.at(-1).probabilities, [100, 0, 0]);
    assert.equal(result.steps[11].impact.player, 2);
    assert.equal(result.steps[11].impact.value, 8.9445);
    assert.equal(result.playerImpacts.length, 4);
    assert.equal(result.steps.at(-1).leaves, '1');
    const qualitySummary = summarizePlayerQuality([result], result.players, 1);
    assert.equal(qualitySummary.complete, true);
    qualitySummary.players.forEach((p, index) => {
      const actions = result.steps.filter(s => s.move?.player === result.players[index].name).length;
      assert.equal(p.decisions + p.forced + p.equivalent + p.unavailable, actions);
      assert.ok(p.best <= p.decisions);
      if (p.averageLoss) assert.ok(p.averageLoss.numerator >= 0n);
    });
    for (const [category, episodes] of Object.entries(keyEpisodes(result))) {
      assert.ok(episodes.length <= 5);
      for (const e of episodes) {
        const before = result.steps[e.position], after = result.steps[e.actionStep];
        const team = before.turn % 2;
        assert.equal(e.actionStep, e.position + 1);
        assert.equal(e.move, after.move);
        assert.equal(e.actual.actual, true);
        // The actual child and the next real solver position are the same distribution.
        assert.equal(BigInt(e.actual.wins[team]) * BigInt(after.leaves), BigInt(after.wins[team]) * BigInt(e.actual.leaves));
        assert.ok(e.best.length > 0);
        assert.ok(e.loss.numerator >= 0n && e.range.numerator > 0n);
        if (category === 'losses') assert.ok(e.loss.numerator > 0n);
        if (category === 'gains') assert.ok(e.impact.numerator > 0n);
        if (category === 'drops') assert.ok(e.impact.numerator < 0n);
        const metric = category === 'losses' ? e.loss : category === 'spreads' ? e.range : e.impact;
        const magnitude = metric.numerator < 0n ? -metric.numerator : metric.numerator;
        assert.ok(magnitude * 100n >= 3n * metric.denominator);
      }
    }
    for (const step of result.steps) {
      assert.equal(step.hands.flat().length + step.chain.length, 28);
      assert.equal(step.wins.reduce((n, s) => n + BigInt(s), 0n), BigInt(step.leaves));
      if (!step.terminal) assert.equal(step.alternatives.filter(a => a.actual).length, 1);
      if (!step.terminal) {
        const quality = decisionQuality(step);
        assert.equal(quality.entries.length, step.alternatives.length);
        assert.ok(quality.actual);
        assert.ok(quality.entries.every(entry => entry.loss.numerator >= 0n));
        assert.equal(quality.bestCount, quality.entries.filter(entry => entry.loss.numerator === 0n).length);
        const next = result.steps[step.index + 1];
        assert.deepEqual(quality.actual.alternative.facts.after.map(h => h.count), next.hands.map(h => h.length));
        assert.equal(quality.actual.alternative.facts.terminal, next.terminal);
        assert.deepEqual(quality.actual.alternative.facts.profile, next.suits);
        if (next.terminal) assert.deepEqual(quality.actual.alternative.settlement.outcome, result.outcome);
        else assert.equal(quality.actual.alternative.settlement, null);
        assert.deepEqual(quality.actual.alternative.wins, next.wins);
        assert.equal(quality.actual.alternative.leaves, next.leaves);
        assert.equal(BigInt(step.leaves), step.alternatives.reduce((sum, a) => sum + BigInt(a.leaves), 0n));
        for (let team = 0; team < 3; team++) {
          assert.equal(BigInt(step.wins[team]), step.alternatives.reduce((sum, a) => sum + BigInt(a.wins[team]), 0n));
          const differences = step.alternatives.map(a => BigInt(a.wins[team]) * BigInt(step.leaves)
            - BigInt(step.wins[team]) * BigInt(a.leaves));
          assert.ok(differences.some(value => value >= 0n));
          assert.ok(differences.some(value => value <= 0n));
          if (step.alternatives.length === 1) assert.equal(differences[0], 0n);
        }
      }
      for (let team = 0; team < 2; team++) {
        assert.ok(step.best.probabilities[team] >= step.probabilities[team]);
        assert.ok(step.worst.probabilities[team] <= step.probabilities[team]);
      }
      if (step.move) {
        assert.ok(step.best.impact.value >= 0);
        assert.ok(step.worst.impact.value <= 0);
        assert.ok(step.best.impact.value >= step.impact.value - 0.000001);
        if (result.steps[step.index - 1].alternatives.length === 1) {
          assert.equal(step.impact.value, 0);
          assert.equal(step.best.impact.value, 0);
          assert.equal(step.worst.impact.value, 0);
        }
      }
    }
    const cached = (await request('/api/analyze', { gameId: game.id, round: 1 })).data;
    assert.equal(cached.cached, true);
    assert.deepEqual(cached.result.base, result.base);
    assert.equal((await request('/api/analyze', { gameId: game.id, round: 0 })).status, 400);
  } finally { await app.close(); }
});
