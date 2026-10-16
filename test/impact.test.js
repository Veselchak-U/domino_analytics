import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeImpacts, aggregateImpacts, bestOptionsAtSteps, worstOptionsAtSteps } from '../public/impact.js';
const players = ['Анна', 'Борис', 'Вера', 'Глеб'].map((name, i) => ({ name, seat: i + 1 }));
const alternative = (stone, wins, leaves = '100') => ({ action: 'left', stone,
  wins: wins.map(String), leaves, probabilities: wins.map(w => Number(w) / Number(leaves) * 100) });

test('худшие шансы независимы, шаг 0 сохраняет базу, последний берёт предыдущие альтернативы', () => {
  const result = worstOptionsAtSteps([
    { move: null, probabilities: [40, 60, 0], alternatives: [alternative('1-2', [70, 30, 0]), alternative('1-3', [20, 80, 0])] },
    { move: { player: 'Анна' }, probabilities: [70, 30, 0], alternatives: [] },
  ], players);
  assert.deepEqual(result[0].probabilities, [40, 60]);
  assert.deepEqual(result[0].moves, [null, null]);
  assert.deepEqual(result[1].probabilities, [20, 30]);
  assert.deepEqual(result[1].moves.map(m => m.stone), ['1-3', '1-2']);
});

test('худший шанс при вынужденном пасе равен реальному', () => {
  const result = worstOptionsAtSteps([
    { move: null, probabilities: [40, 60, 0], alternatives: [{ ...alternative(undefined, [40, 60, 0]), action: 'pass' }] },
    { move: { player: 'Борис', action: 'pass' }, probabilities: [40, 60, 0], alternatives: [] },
  ], players);
  assert.deepEqual(result[1].probabilities, [40, 60]);
  assert.equal(result[1].impact.value, 0);
});

test('худший шанс сравнивается по точным долям с учётом ничьей', () => {
  const a = alternative('1-2', ['9007199254740992', '9007199254740993', '1'], '18014398509481986');
  const b = alternative('1-3', ['9007199254740993', '9007199254740992', '1'], '18014398509481986');
  a.probabilities = b.probabilities = [50, 50, 0];
  const result = worstOptionsAtSteps([
    { move: null, probabilities: [40, 60, 0], alternatives: [a, b] },
    { move: { player: 'Анна' }, probabilities: [50, 50, 0], alternatives: [] },
  ], players);
  assert.deepEqual(result[1].moves.map(m => m.stone), ['1-2', '1-3']);
});
test('лучшие шансы A и B независимы и берутся до реального действия', () => {
  const options = [alternative('1-2', [70, 30, 0]), alternative('1-3', [20, 80, 0])];
  const result = bestOptionsAtSteps([
    { move: null, probabilities: [40, 60, 0], alternatives: options },
    { move: { player: 'Анна' }, probabilities: [20, 80, 0], alternatives: [] },
  ], players);
  assert.deepEqual(result[0].probabilities, [40, 60]);
  assert.equal(result[0].impact, null);
  assert.deepEqual(result[1].probabilities, [70, 80]);
  assert.equal(result[1].impact.value, 30);
  assert.equal(result[1].impact.move.stone, '1-2');
});
test('лучший ход для B учитывает шанс B, а не максимум A', () => {
  const result = bestOptionsAtSteps([
    { move: null, probabilities: [40, 60, 0], alternatives: [alternative('1-2', [70, 30, 0]), alternative('1-3', [20, 80, 0])] },
    { move: { player: 'Борис' }, probabilities: [70, 30, 0], alternatives: [] },
  ], players);
  assert.equal(result[1].impact.value, 20);
  assert.equal(result[1].impact.player, 1);
  assert.equal(result[1].impact.move.stone, '1-3');
});
test('лучшее влияние сохраняет минус, если все допустимые действия ухудшают шансы', () => {
  const result = bestOptionsAtSteps([
    { move: null, probabilities: [40, 60, 0], alternatives: [alternative('1-2', [10, 90, 0]), alternative('1-3', [20, 80, 0])] },
    { move: { player: 'Анна' }, probabilities: [10, 90, 0], alternatives: [] },
  ], players);
  assert.equal(result[1].impact.value, -20);
});
test('вынужденный пас имеет нулевое лучшее влияние', () => {
  const pass = { ...alternative(undefined, [40, 60, 0]), action: 'pass' };
  const result = bestOptionsAtSteps([
    { move: null, probabilities: [40, 60, 0], alternatives: [pass] },
    { move: { player: 'Анна', action: 'pass' }, probabilities: [40, 60, 0], alternatives: [] },
  ], players);
  assert.equal(result[1].impact.value, 0);
  assert.equal(result[1].impact.move.action, 'pass');
});
test('лучший ход выбирается по точным дробям, даже когда проценты округлены одинаково', () => {
  const a = alternative('1-2', ['9007199254740992', '9007199254740993', '0'], '18014398509481985');
  const b = alternative('1-3', ['9007199254740993', '9007199254740992', '0'], '18014398509481985');
  a.probabilities = b.probabilities = [50, 50, 0];
  const result = bestOptionsAtSteps([
    { move: null, probabilities: [40, 60, 0], alternatives: [a, b] },
    { move: { player: 'Анна' }, probabilities: [50, 50, 0], alternatives: [] },
  ], players);
  assert.equal(result[1].moves[0].stone, '1-3');
  assert.equal(result[1].moves[1].stone, '1-2');
});
const steps = [
  { move: null, delta: [0, 0, 0] },
  { move: { player: 'Анна', action: 'start' }, delta: [10, -10, 0] },
  { move: { player: 'Борис', action: 'left' }, delta: [-10, 10, 0] },
  { move: { player: 'Вера', action: 'pass' }, delta: [0, 0, 0] },
  { move: { player: 'Глеб', action: 'right' }, delta: [5, -5, 0] },
  { move: { player: 'Анна', action: 'left' }, delta: [-3, 3, 0] },
];
test('автор и знак импакта определяются командой ходившего; шаг 0 и пас', () => {
  const result = attributeImpacts(steps, players);
  assert.equal(result.impacts[0], null);
  assert.deepEqual(result.impacts[2], { player: 1, value: 10 });
  assert.deepEqual(result.impacts[4], { player: 3, value: -5 });
  assert.deepEqual(result.players.map(p => p.impact), [7, 10, 0, -5]);
  assert.equal(result.players[2].moves, 1);
});
test('суммы хранят точность 0,0001, большие суммарные значения не обрезаются', () => {
  const repeated = Array.from({ length: 1001 }, () => ({ move: { player: 'Анна' }, delta: [0.1, -0.1, 0] }));
  assert.equal(attributeImpacts(repeated, players).players[0].impact, 100.1);
});
test('импакт B учитывает собственный шанс при изменении доли ничьих', () => {
  const result = attributeImpacts([{ move: { player: 'Борис' }, delta: [0, 5, -5] }], players);
  assert.equal(result.impacts[0].value, 5);
  assert.equal(result.players[1].impact, 5);
});
test('итоги всей партии отсутствуют до готовности всех раундов, повторы не удваивают', () => {
  const a = { number: 1, playerImpacts: attributeImpacts(steps, players).players };
  const b = { number: 2, playerImpacts: a.playerImpacts.map(p => ({ ...p, impact: -p.impact })) };
  const partial = aggregateImpacts([a], players, 2);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.totals, [null, null, null, null]);
  const result = aggregateImpacts([a, b, a], players, 2);
  assert.equal(result.complete, true);
  assert.equal(result.completedRounds, 2);
  assert.deepEqual(result.totals, [0, 0, 0, 0]);
  assert.deepEqual(result.byRound[0].values, [7, 10, 0, -5]);
});
