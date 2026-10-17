import test from 'node:test';
import assert from 'node:assert/strict';
import { maskOf, handPoints, legalMoves, applyMove, settle, isTerminal } from '../src/game.js';
import { createSolver, summarize } from '../src/solver.js';

const context = (extra = {}) => ({ fishVariant: 'withoutEggs', scoreLimit: 50,
  score: [0, 0], fence: [0, 0], eggs: 0, ...extra });
const state = (hands, extra = {}) => ({ hands: hands.map(maskOf), left: 6, right: 6,
  turn: 0, fisher: 1, forcedStart: null, ...extra });

test('оценка памяти кеша учитывает живые записи, попадания и вытеснение поколений', () => {
  const positions = [
    state([['0-0'], ['0-2'], ['1-1'], ['2-2']]),
    state([['0-1'], ['0-2'], ['1-1'], ['2-2']]),
    state([['0-1'], ['0-3'], ['1-1'], ['2-2']]),
  ];
  const solver = createSolver(context(), undefined, { cacheEntries: 2 });
  assert.equal(solver.stats().cacheBytesEstimate, 0);
  solver.solve(positions[0]);
  const first = solver.stats().cacheBytesEstimate;
  assert.ok(Number.isInteger(first) && first > 0);
  solver.solve(positions[0]);
  assert.equal(solver.stats().cacheBytesEstimate, first);
  solver.solve(positions[1]);
  assert.ok(solver.stats().cacheBytesEstimate > first);
  solver.solve(positions[2]);
  assert.ok(solver.stats().evicted > 0);
  const fresh = createSolver(context(), undefined, { cacheEntries: 2 });
  fresh.solve(positions[1]); fresh.solve(positions[2]);
  assert.equal(solver.stats().cacheBytesEstimate, fresh.stats().cacheBytesEstimate);
  assert.equal(createSolver(context()).stats().cacheBytesEstimate, 0);
});

test('стоимость одиночного 0-0 считается отдельно от руки партнёра', () => {
  assert.equal(handPoints(maskOf(['0-0'])), 10);
  assert.equal(handPoints(maskOf(['0-0', '1-2'])), 3);
  assert.equal(handPoints(0), 0);
});

test('зеркальные продолжения одного узла объединяются, дерево имеет 2 листа и глубину 3', () => {
  const s = state([['1-2', '1-3'], ['2-4'], ['3-4'], ['0-0']], { left: 1, right: 1, fisher: 3 });
  assert.equal(legalMoves(s).length, 2);
  const solver = createSolver(context());
  const result = solver.solve(s);
  assert.deepEqual(result.wins, [1n, 1n, 0n]);
  assert.equal(result.leaves, 2n);
  assert.equal(result.depth, 3);
  assert.equal(result.minDepth, 2);
  const hits = solver.stats().hits;
  assert.strictEqual(solver.solve(s), result);
  assert.equal(summarize(solver.solve(s)).minDepth, 2);
  assert.ok(solver.stats().hits > hits);
});

test('границы ходов учитывают обязательный пас, завершённая позиция имеет 0/0', () => {
  const s = state([['0-0'], ['6-6'], ['2-2'], ['3-3']]);
  const solver = createSolver(context());
  const result = solver.solve(s);
  assert.deepEqual([result.minDepth, result.depth], [2, 2]);
  const end = applyMove(applyMove(s, { action: 'pass' }), { action: 'left', stone: '6-6' });
  const terminal = solver.solve(end);
  assert.deepEqual([terminal.minDepth, terminal.depth], [0, 0]);
  const fish = solver.solve(state([['0-0'], ['0-2'], ['1-1'], ['2-2']]));
  assert.deepEqual([fish.minDepth, fish.depth], [0, 0]);
});

test('рыба без завершения партии принадлежит рыбаку; счёт остаётся по исходным правилам', () => {
  const s = state([['0-0'], ['0-2'], ['1-1'], ['2-2']]);
  const result = settle(s, context());
  assert.equal(result.winnerTeam, null);
  assert.equal(result.analyticsWinner, 1);
  assert.deepEqual(result.fence, [12, 6]);
});

test('последняя рыба даёт победителя партии либо отдельную ничью', () => {
  const s = state([['0-0'], ['0-2'], ['1-1'], ['2-2']]);
  const result = settle(s, context({ score: [38, 44] }));
  assert.equal(result.gameWinner, 2);
  assert.equal(result.analyticsWinner, 2);
  assert.deepEqual(createSolver(context({ score: [38, 44] })).solve(s).wins, [0n, 0n, 1n]);
  assert.equal(settle(s, context({ score: [45, 40] })).analyticsWinner, 1);
});

test('яйца сохраняют забор и дают аналитическую победу рыбаку', () => {
  const s = state([['0-1'], ['0-2'], ['2-2'], ['1-2']]);
  const result = settle(s, context({ fishVariant: 'withEggs', eggs: 28, fence: [8, 12] }));
  assert.equal(result.reason, 'eggs');
  assert.equal(result.eggs, 38);
  assert.deepEqual(result.fence, [8, 12]);
  assert.equal(result.analyticsWinner, 1);
});

test('дубль не меняет рыбака, неверная ориентация и добровольный пас запрещены', () => {
  const s = state([['1-1', '0-3'], ['0-2'], ['2-2'], ['3-3']], { left: 1, right: 5 });
  const next = applyMove(s, { action: 'left', stone: '1-1' });
  assert.equal(next.fisher, 1);
  assert.throws(() => applyMove(s, { action: 'pass' }), /пропуск/i);
  assert.throws(() => applyMove(s, { action: 'left', stone: '3-0' }), /конец|ориентац/i);
  assert.equal(s.hands[0], maskOf(['1-1', '0-3']));
});

test('точность целых сохраняется за пределами Number.MAX_SAFE_INTEGER', () => {
  const n = 9007199254740993n;
  const result = summarize({ leaves: n, wins: [n - 1n, 1n, 0n], fish: 1n, eggs: 0n, minDepth: 7, depth: 40,
    outcomes: [n - 1n, 0n, 0n, 0n, 1n, 0n, 0n, 0n, 0n] });
  assert.equal(result.minDepth, 7);
  assert.equal(result.leaves, '9007199254740993');
  assert.deepEqual(result.wins, ['9007199254740992', '1', '0']);
});

test('перенос яиц не открывает счёт без собственного остатка 13', () => {
  const s = state([['0-0'], ['0-2'], ['1-1'], ['2-2']]);
  const result = settle(s, context({ fishVariant: 'withEggs', eggs: 28, fence: [8, 12] }));
  assert.deepEqual(result.totalScore, [0, 0]);
  assert.deepEqual(result.roundScore, [40, 0]);
  assert.deepEqual(result.fence, [48, 0]);
  assert.equal(result.eggs, 0);
});

test('выход имеет приоритет перед полной блокировкой', () => {
  const s = state([['0-0'], ['1-1'], ['2-2'], ['3-3']], { left: 0, right: 0 });
  const result = settle(applyMove(s, { action: 'left', stone: '0-0' }), context());
  assert.equal(result.reason, 'emptyHand');
  assert.equal(result.winnerTeam, 0);
});

test('оставшийся допустимый дубль предотвращает рыбу и требует обычной очереди', () => {
  const s = state([['0-0'], ['6-6'], ['2-2'], ['3-3']]);
  assert.equal(isTerminal(s), false);
  assert.deepEqual(legalMoves(s), [{ action: 'pass' }]);
  const next = applyMove(s, { action: 'pass' });
  assert.equal(legalMoves(next).length, 1);
  assert.equal(settle(applyMove(next, legalMoves(next)[0]), context()).winnerTeam, 1);
});

test('ровно 13 открывает запись с прежним забором и яйцами', () => {
  const s = state([['0-0'], ['0-1'], ['1-2'], ['1-1']]);
  const result = settle(s, context({ fishVariant: 'withEggs', fence: [8, 0], eggs: 28 }));
  assert.deepEqual(result.totalScore, [49, 0]);
  assert.deepEqual(result.roundScore, [41, 0]);
  assert.deepEqual(result.fence, [0, 0]);
});

test('мемоизация совпадает с развёрнутым перебором поздних позиций, сохраняя кратность', async () => {
  const { parseGame } = await import('../src/input.js');
  const { readFileSync } = await import('node:fs');
  const game = parseGame(readFileSync(new URL('./fixtures/real-game.json', import.meta.url), 'utf8'));
  const round = game.rounds[0], solver = createSolver(round.context);
  function terminalLengths(s, distance = 0, lengths = []) {
    if (isTerminal(s)) lengths.push(distance);
    else for (const move of legalMoves(s)) terminalLengths(applyMove(s, move), distance + 1, lengths);
    return lengths;
  }
  // Independent aggregation without a memo checks that shared subtrees keep path multiplicity.
  function unrolled(s) {
    const outcome = settle(s, round.context);
    if (outcome) { const wins = [0n, 0n, 0n]; wins[outcome.analyticsWinner] = 1n; return { leaves: 1n, wins, depth: 0 }; }
    const result = { leaves: 0n, wins: [0n, 0n, 0n], depth: 0 };
    for (const move of legalMoves(s)) {
      const child = unrolled(applyMove(s, move));
      result.leaves += child.leaves;
      result.depth = Math.max(result.depth, child.depth + 1);
      child.wins.forEach((v, i) => { result.wins[i] += v; });
    }
    return result;
  }
  for (const { state: s } of round.history.slice(8)) {
    const expected = unrolled(s), actual = solver.solve(s);
    assert.equal(actual.leaves, expected.leaves);
    assert.equal(actual.depth, expected.depth);
    assert.equal(actual.minDepth, Math.min(...terminalLengths(s)));
    assert.deepEqual(actual.wins, expected.wins);
  }
  assert.ok(solver.stats().hits > 0);
  const bounded = createSolver(round.context, undefined, { cacheEntries: 16 });
  const s = round.history[8].state;
  const expected = unrolled(s), actual = bounded.solve(s);
  assert.equal(actual.leaves, expected.leaves);
  assert.deepEqual(actual.wins, expected.wins);
  assert.equal(actual.depth, expected.depth);
  assert.equal(actual.minDepth, Math.min(...terminalLengths(s)));
  assert.ok(bounded.stats().cached <= 16);
  assert.ok(bounded.stats().evicted > 0);
});
