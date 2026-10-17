import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeImpacts, aggregateImpacts, bestOptionsAtSteps, worstOptionsAtSteps, alternativeImpact, rankAlternatives, comparisonChance } from '../public/impact.js';
const players = ['Анна', 'Борис', 'Вера', 'Глеб'].map((name, i) => ({ name, seat: i + 1 }));
const alternative = (stone, wins, leaves = '100') => ({ action: 'left', stone,
  wins: wins.map(String), leaves, probabilities: wins.map(w => Number(w) / Number(leaves) * 100) });

test('дополнительные точки отличаются только на ходе своей команды, автор не равен очереди', () => {
  for (const player of [0, 1, 2, 3]) {
    const step = { impact: { player }, turn: (player + 1) % 4,
      probabilities: [40, 60, 0], wins: ['40', '60', '0'], leaves: '100',
      best: { probabilities: [70, 90], moves: [alternative('1-2', [70, 30, 0]), alternative('1-3', [10, 90, 0])] },
      worst: { probabilities: [20, 30], moves: [alternative('1-4', [20, 80, 0]), alternative('1-5', [70, 30, 0])] } };
    const original = structuredClone(step), own = player % 2, other = 1 - own;
    assert.equal(comparisonChance(step, own, 'best').probability, own ? 90 : 70);
    assert.equal(comparisonChance(step, own, 'worst').probability, own ? 30 : 20);
    for (const kind of ['best', 'worst']) assert.deepEqual(comparisonChance(step, other, kind), {
      probability: step.probabilities[other], wins: step.wins[other], leaves: '100',
    });
    assert.deepEqual(step, original);
  }
});

test('точки начала и вынужденного хода совпадают, на последнем ходе чужая команда показывает факт', () => {
  const base = { impact: null, probabilities: [40, 60, 0], wins: ['40', '60', '0'], leaves: '100' };
  for (const kind of ['best', 'worst']) for (const team of [0, 1]) {
    assert.equal(comparisonChance(base, team, kind).probability, base.probabilities[team]);
  }
  const forced = { ...base, impact: { player: 1 },
    best: { probabilities: [40, 60], moves: [base, base] }, worst: { probabilities: [40, 60], moves: [base, base] } };
  for (const kind of ['best', 'worst']) for (const team of [0, 1]) {
    assert.equal(comparisonChance(forced, team, kind).probability, base.probabilities[team]);
  }
  const last = { impact: { player: 2 }, probabilities: [100, 0, 0], wins: ['1', '0', '0'], leaves: '1',
    worst: { probabilities: [20, 10], moves: [alternative('1-2', [20, 80, 0]), alternative('1-3', [90, 10, 0])] } };
  assert.equal(comparisonChance(last, 0, 'worst').probability, 20);
  assert.deepEqual(comparisonChance(last, 1, 'worst'), { probability: 0, wins: '0', leaves: '1' });
});

test('подписи используют точные счётчики отображённой альтернативы или фактической позиции', () => {
  const chosen = alternative('1-2', ['9007199254740993', '9007199254740992', '0'], '18014398509481985');
  const step = { impact: { player: 0 }, probabilities: [60, 40, 0], wins: ['6', '4', '0'], leaves: '10',
    best: { probabilities: [50, 90], moves: [chosen, alternative('1-3', [10, 90, 0])] } };
  assert.deepEqual(comparisonChance(step, 0, 'best'), { probability: 50, wins: '9007199254740993', leaves: '18014398509481985' });
  assert.deepEqual(comparisonChance(step, 1, 'best'), { probability: 40, wins: '4', leaves: '10' });
});

test('варианты сортируются от лучшего к худшему для команды любого места, реальный ход участвует наравне', () => {
  const bad = { ...alternative('1-2', [30, 70, 0]), actual: true };
  const good = alternative('1-3', [70, 30, 0]);
  const middle = alternative('1-4', [50, 50, 0]);
  const alternatives = [bad, good, middle];
  for (const turn of [0, 2]) assert.deepEqual(rankAlternatives({ turn, alternatives }), [good, middle, bad]);
  for (const turn of [1, 3]) assert.deepEqual(rankAlternatives({ turn, alternatives }), [bad, middle, good]);
  assert.deepEqual(alternatives, [bad, good, middle]);
});

test('сортировка включает улучшение, равенство и ухудшение относительно исходной доли', () => {
  const step = { turn: 0, probabilities: [50, 50, 0], alternatives: [
    alternative('1-2', [45, 55, 0]), alternative('1-3', [55, 45, 0]), alternative('1-4', [50, 50, 0]),
  ] };
  assert.deepEqual(rankAlternatives(step).map(a => alternativeImpact(step, a)), [5, 0, -5]);
});

test('сортировка точная при одинаковых округлённых шансах и разных знаменателях', () => {
  const low = alternative('1-2', ['9007199254740992', '9007199254740993', '0'], '18014398509481985');
  const high = alternative('1-3', ['9007199254740993', '9007199254740992', '0'], '18014398509481985');
  low.probabilities = high.probabilities = [50, 50, 0];
  const smallerCountBetter = alternative('1-4', [2, 1, 0], '3');
  assert.deepEqual(rankAlternatives({ turn: 0, alternatives: [low, high, smallerCountBetter] }), [smallerCountBetter, high, low]);
});

test('равные шансы сохраняют порядок, единственный пас и завершённая позиция поддерживаются', () => {
  const first = alternative('1-2', [1, 1, 0], '2');
  const second = { ...alternative('1-3', [50, 50, 0]), actual: true };
  assert.deepEqual(rankAlternatives({ turn: 0, alternatives: [first, second] }), [first, second]);
  const pass = { ...first, action: 'pass', stone: undefined };
  assert.deepEqual(rankAlternatives({ turn: 1, alternatives: [pass] }), [pass]);
  assert.deepEqual(rankAlternatives({ turn: 0, alternatives: [] }), []);
});

test('влияние альтернативы считается для следующего игрока всех четырёх мест', () => {
  for (const turn of [0, 2]) {
    const step = { turn, probabilities: [60, 35, 5] };
    assert.equal(alternativeImpact(step, { probabilities: [70, 20, 10] }), 10);
    assert.equal(alternativeImpact(step, { probabilities: [45, 50, 5] }), -15);
  }
  for (const turn of [1, 3]) {
    const step = { turn, probabilities: [35, 60, 5] };
    assert.equal(alternativeImpact(step, { probabilities: [20, 70, 10] }), 10);
    assert.equal(alternativeImpact(step, { probabilities: [50, 45, 5] }), -15);
  }
});

test('влияние единственного хода и паса нулевое, точность малых изменений сохранена', () => {
  const step = { turn: 1, probabilities: [62.1212, 37.8788, 0] };
  for (const action of ['pass', 'left']) assert.equal(alternativeImpact(step, { action, probabilities: step.probabilities }), 0);
  assert.equal(alternativeImpact(step, { probabilities: [62.1209, 37.8791, 0] }), 0.0003);
});

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
test('исходная доля взвешена по листьям: лучшее влияние положительно, худшее отрицательно', () => {
  const steps = [
    { move: null, probabilities: [17.5, 82.5, 0], alternatives: [
      alternative('1-2', [10, 90, 0]), alternative('1-3', [60, 240, 0], '300'),
    ] },
    { move: { player: 'Анна' }, probabilities: [10, 90, 0], alternatives: [] },
  ];
  assert.equal(bestOptionsAtSteps(steps, players)[1].impact.value, 2.5);
  assert.equal(worstOptionsAtSteps(steps, players)[1].impact.value, -7.5);
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
