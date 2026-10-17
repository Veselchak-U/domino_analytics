import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGame } from '../src/input.js';
import { applyMove, legalMoves, maskOf, positionKey, settle } from '../src/game.js';
import { createSolver, summarize } from '../src/solver.js';
import { alternativeImpact, bestOptionsAtSteps, worstOptionsAtSteps } from '../public/impact.js';

const compare = (a, b, team) => a.wins[team] * b.leaves - b.wins[team] * a.leaves;

test('реальный solver: суммы W/N, взвешенные границы и влияние во всех продолжениях поздней позиции', () => {
  const game = parseGame(readFileSync(new URL('./fixtures/real-game.json', import.meta.url), 'utf8'));
  const round = game.rounds[0], solver = createSolver(round.context);
  const seen = new Set(), coverage = new Set();
  function visit(state) {
    const key = positionKey(state);
    if (seen.has(key)) { coverage.add('shared'); return; }
    seen.add(key);
    const parent = solver.solve(state), moves = legalMoves(state);
    assert.ok(parent.leaves > 0n);
    assert.equal(parent.wins.reduce((a, b) => a + b, 0n), parent.leaves);
    if (!moves.length) {
      assert.equal(parent.leaves, 1n);
      coverage.add('terminal');
      return;
    }
    const states = moves.map(move => applyMove(state, move));
    const children = states.map(child => solver.solve(child));
    assert.equal(parent.leaves, children.reduce((sum, child) => sum + child.leaves, 0n));
    for (let team = 0; team < 3; team++) {
      assert.equal(parent.wins[team], children.reduce((sum, child) => sum + child.wins[team], 0n));
      const minimum = children.reduce((a, b) => compare(a, b, team) < 0n ? a : b);
      const maximum = children.reduce((a, b) => compare(a, b, team) > 0n ? a : b);
      assert.ok(compare(minimum, parent, team) <= 0n);
      assert.ok(compare(maximum, parent, team) >= 0n);
      if (children.length === 1 || compare(minimum, maximum, team) === 0n) {
        for (const child of children) assert.equal(compare(child, parent, team), 0n);
      }
    }
    const team = state.turn % 2;
    coverage.add(`team-${team}`);
    if (children.length === 1) {
      coverage.add(moves[0].action === 'pass' ? 'pass' : 'forced-tile');
      assert.deepEqual(parent.wins, children[0].wins);
      assert.equal(parent.leaves, children[0].leaves);
    } else if (children.some(child => child.leaves !== children[0].leaves)) {
      coverage.add('unequal-weights');
      if (children.every(child => compare(child, children[0], team) === 0n)) coverage.add('equal-with-different-weights');
      else coverage.add('different-values-and-weights');
    }
    const before = { ...summarize(parent), turn: state.turn,
      alternatives: children.map((child, i) => ({ ...moves[i], ...summarize(child) })) };
    const steps = [before, { ...summarize(children[0]), move: { player: game.players[state.turn].name } }];
    const best = bestOptionsAtSteps(steps, game.players)[1];
    const worst = worstOptionsAtSteps(steps, game.players)[1];
    assert.ok(best.impact.value >= 0);
    assert.ok(worst.impact.value <= 0);
    const influences = before.alternatives.map(a => alternativeImpact(before, a));
    assert.equal(best.impact.value, Math.max(...influences));
    assert.equal(worst.impact.value, Math.min(...influences));
    for (const child of states) visit(child);
  }
  visit(round.history[8].state);
  for (const category of ['shared', 'terminal', 'team-0', 'team-1', 'pass', 'forced-tile',
    'unequal-weights', 'equal-with-different-weights', 'different-values-and-weights']) {
    assert.ok(coverage.has(category), `Не достигнут случай: ${category}`);
  }
});

test('терминальные результаты solver: выход, оба варианта рыбы, яйца и окончательная ничья', () => {
  const context = { fishVariant: 'withoutEggs', scoreLimit: 50, score: [0, 0], fence: [0, 0], eggs: 0 };
  const state = { hands: [['0-0'], ['0-2'], ['1-1'], ['2-2']].map(maskOf),
    left: 6, right: 6, turn: 0, fisher: 1, forcedStart: null };
  const cases = [
    { state: { ...state, hands: [0, ...state.hands.slice(1)] }, context, reason: 'emptyHand', winner: 0 },
    { state, context, reason: 'fish', winner: 1 },
    { state, context: { ...context, fishVariant: 'withEggs' }, reason: 'fish', winner: 1 },
    { state: { ...state, hands: [['0-1'], ['0-2'], ['2-2'], ['1-2']].map(maskOf) },
      context: { ...context, fishVariant: 'withEggs' }, reason: 'eggs', winner: 1 },
    { state, context: { ...context, score: [38, 44] }, reason: 'fish', winner: 2 },
  ];
  for (const sample of cases) {
    assert.equal(settle(sample.state, sample.context).reason, sample.reason);
    assert.deepEqual(legalMoves(sample.state), []);
    const result = createSolver(sample.context).solve(sample.state);
    assert.equal(result.leaves, 1n);
    assert.deepEqual(result.wins, [0, 1, 2].map(team => team === sample.winner ? 1n : 0n));
  }
});
