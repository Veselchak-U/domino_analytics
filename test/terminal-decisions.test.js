import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { maskOf, applyMove, legalMoves, settle } from '../src/game.js';
import { terminalDecision } from '../src/facts.js';
import { parseGame } from '../src/input.js';
const context = extra => ({ fishVariant: 'withoutEggs', scoreLimit: 50, score: [0, 0], fence: [0, 0], eggs: 0, ...extra });
const state = hands => ({ hands: hands.map(maskOf), left: 6, right: 6, turn: 0, fisher: 1, forcedStart: null });
const double = { action: 'left', stone: '6-6' };

test('разбор рыбы: одиночный 0–0, оба варианта, прежний рыбак после дубля', () => {
  const s = state([['6-6', '0-0'], ['0-2'], ['1-1'], ['2-2']]);
  const c = context({ fence: [8, 12], eggs: 28 });
  const saved = structuredClone({ s, c });
  const noEggs = terminalDecision(s, double, c);
  assert.deepEqual(noEggs.outcome.residual, [12, 6]);
  assert.equal(noEggs.outcome.finishedPlayer, 1);
  assert.equal(noEggs.outcome.winnerTeam, null);
  assert.equal(noEggs.outcome.analyticsWinner, 1);
  const withEggs = terminalDecision(s, double, { ...c, fishVariant: 'withEggs' });
  assert.equal(withEggs.outcome.winnerTeam, 1);
  assert.deepEqual(withEggs.outcome.fence, [48, 0]);
  assert.deepEqual(noEggs.before, { score: [0, 0], fence: [8, 12], eggs: 28 });
  assert.deepEqual({ s, c }, saved);
});
test('завершающая рыба использует исход партии, включая ничью', () => {
  const s = state([['6-6', '0-0'], ['0-2'], ['1-1'], ['2-2']]);
  const draw = terminalDecision(s, double, context({ score: [38, 44] })).outcome;
  assert.deepEqual(draw.totalScore, [50, 50]);
  assert.equal(draw.analyticsWinner, 2);
  const other = terminalDecision(s, double, context({ score: [30, 48] })).outcome;
  assert.equal(other.finishedPlayer % 2, 1);
  assert.equal(other.gameWinner, 0);
  assert.equal(other.analyticsWinner, 0);
});
test('яйца переносятся, выход имеет приоритет, нетерминал не получает исход', () => {
  const s = state([['6-6', '0-1'], ['0-2'], ['2-2'], ['1-2']]);
  const eggs = terminalDecision(s, double, context({ fishVariant: 'withEggs', eggs: 28, fence: [8, 12] })).outcome;
  assert.equal(eggs.reason, 'eggs');
  assert.equal(eggs.eggs, 38);
  assert.deepEqual(eggs.fence, [8, 12]);
  s.hands[0] = maskOf(['6-6']);
  assert.equal(terminalDecision(s, double, context()).outcome.reason, 'emptyHand');
  s.hands[1] = maskOf(['0-6']);
  s.hands[0] = maskOf(['6-6', '0-1']);
  assert.equal(terminalDecision(s, double, context()), null);
});
test('исходы кандидатов реальных раундов равны правилам settle', () => {
  const game = parseGame(readFileSync(new URL('../contracts/kozel-game.example.json', import.meta.url), 'utf8'));
  const reasons = new Set();
  for (const round of game.rounds) for (const { state: s } of round.history) for (const move of legalMoves(s)) {
    const decision = terminalDecision(s, move, round.context), outcome = settle(applyMove(s, move), round.context);
    assert.deepEqual(decision?.outcome ?? null, outcome);
    if (outcome) reasons.add(outcome.reason);
  }
  assert.deepEqual([...reasons].sort(), ['eggs', 'emptyHand', 'fish']);
});
