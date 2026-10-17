import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyMove, legalMoves, maskOf, settle } from '../src/game.js';
import { assertOutcomeCounts, createSolver, summarize } from '../src/solver.js';
import { parseGame } from '../src/input.js';
const context = extra => ({ fishVariant: 'withoutEggs', scoreLimit: 50, score: [0, 0], fence: [0, 0], eggs: 0, ...extra });
const state = hands => ({ hands: hands.map(maskOf), left: 6, right: 6, turn: 0, fisher: 1, forcedStart: null });
const sum = a => a.reduce((n, v) => n + v, 0n);

test('терминальные пересечения: выход, рыба/ничья, яйца/рыбак', () => {
  const cases = [
    [state([[], ['0-2'], ['1-1'], ['2-2']]), context(), 0],
    [state([['0-0'], ['0-2'], ['1-1'], ['2-2']]), context({ score: [38, 44] }), 5],
    [state([['0-1'], ['0-2'], ['2-2'], ['1-2']]), context({ fishVariant: 'withEggs' }), 7],
  ];
  for (const [s, c, index] of cases) {
    const solver = createSolver(c), result = solver.solve(s), expected = Array(9).fill(0n); expected[index] = 1n;
    assert.deepEqual(result.outcomes, expected);
    assertOutcomeCounts(result);
    assert.strictEqual(solver.solve(s), result);
  }
});
test('пересечения равны независимому развёрнутому дереву, включая вытеснение кеша', () => {
  const game = parseGame(readFileSync(new URL('./fixtures/real-game.json', import.meta.url), 'utf8'));
  const round = game.rounds[0];
  for (const c of [round.context, context({ fishVariant: 'withEggs', score: [30, 48], eggs: 12 })]) {
    function unrolled(s, counts = Array(9).fill(0n)) {
      const o = settle(s, c);
      if (o) counts[['emptyHand', 'fish', 'eggs'].indexOf(o.reason) * 3 + o.analyticsWinner]++;
      else for (const move of legalMoves(s)) unrolled(applyMove(s, move), counts);
      return counts;
    }
    for (const cacheEntries of [16, 2000000]) {
      const solver = createSolver(c, undefined, { cacheEntries });
      for (const { state: s } of round.history.slice(8)) {
        const actual = solver.solve(s), expected = unrolled(s);
        assert.deepEqual(actual.outcomes, expected);
        assert.equal(sum(expected), actual.leaves);
        assertOutcomeCounts(actual);
      }
      assert.ok(solver.stats().hits > 0);
      if (cacheEntries === 16) assert.ok(solver.stats().evicted > 0);
    }
  }
});
test('сериализация выше MAX_SAFE_INTEGER и обнаружение испорченных счётчиков', () => {
  const n = 9007199254740993n;
  const result = { leaves: n, wins: [n - 1n, 1n, 0n], fish: 1n, eggs: 0n, minDepth: 0, depth: 0,
    outcomes: [n - 1n, 0n, 0n, 0n, 1n, 0n, 0n, 0n, 0n] };
  const view = summarize(result);
  assert.deepEqual(view.outcomes.emptyHand, ['9007199254740992', '0', '0']);
  assert.deepEqual(view.outcomes.fish, ['0', '1', '0']);
  assert.equal(view.fish, '1');
  assert.equal(view.eggs, '0');
  for (const change of [r => r.outcomes[0]++, r => r.wins[0]--, r => r.fish++, r => r.eggs++, r => r.outcomes[8] = -1n]) {
    const broken = structuredClone(result); change(broken);
    assert.throws(() => summarize(broken), /состав исходов/i);
  }
});
