import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { maskOf, legalMoves, applyMove, countBits, isTerminal } from '../src/game.js';
import { parseGame } from '../src/input.js';
import { moveFacts } from '../src/facts.js';

const state = (hands, extra = {}) => ({ hands: hands.map(maskOf), left: 1, right: 1,
  turn: 0, fisher: 3, forcedStart: null, ...extra });
const move = { action: 'left', stone: '2-1' };
test('факты: обязательный ближайший пас и проверенный ответ партнёра', () => {
  const s = state([['1-2', '4-4'], ['0-0', '3-3'], ['2-5', '6-6'], ['0-3']]);
  const saved = structuredClone(s), f = moveFacts(s, move);
  assert.deepEqual(f.ends, [2, 1]);
  assert.equal(f.next.forcedPass, true);
  assert.deepEqual(f.partner, { player: 2, compatible: 1, branches: 1, replies: 1, ended: 0 });
  assert.deepEqual([f.before[0].count, f.after[0].count], [2, 1]);
  assert.deepEqual([f.before[0].points, f.after[0].points], [11, 8]);
  assert.deepEqual([f.before[0].doubles, f.after[0].doubles], [1, 1]);
  assert.deepEqual(s, saved);
});
test('совместимый камень не гарантирует ответ через соперника; завершение отдельно', () => {
  const s = state([['1-2', '4-4'], ['2-3', '1-4'], ['2-5', '6-6'], ['0-3']]);
  assert.deepEqual(moveFacts(s, move).partner, { player: 2, compatible: 1, branches: 2, replies: 1, ended: 0 });
  s.hands[1] = maskOf(['2-3']);
  const f = moveFacts(s, move);
  assert.deepEqual(f.partner, { player: 2, compatible: 1, branches: 1, replies: 0, ended: 1 });
});
test('завершивший ход не обещает ответа, пас сохраняет руку, одиночный ноль стоит 10', () => {
  const s = state([['1-2'], ['0-0'], ['2-5'], ['0-3']]);
  const f = moveFacts(s, move);
  assert.equal(f.terminal, true);
  assert.equal(f.next, null);
  assert.equal(f.partner, null);
  assert.equal(f.after[1].points, 10);
  const p = state([['0-0'], ['1-2'], ['2-5'], ['0-3']]);
  const pass = moveFacts(p, { action: 'pass' });
  assert.deepEqual(pass.before, pass.after);
  assert.equal(pass.next.player, 1);
});
test('факты всех кандидатов реального журнала согласованы с переходами и 28 камнями', () => {
  const game = parseGame(readFileSync(new URL('./fixtures/real-game.json', import.meta.url), 'utf8'));
  for (const round of game.rounds) for (const { state: s, chain } of round.history) {
    for (const action of legalMoves(s)) {
      const f = moveFacts(s, action), next = applyMove(s, action);
      assert.equal(f.terminal, isTerminal(next));
      assert.deepEqual(f.after.map(h => h.count), next.hands.map(countBits));
      assert.equal(f.after.reduce((n, h) => n + h.count, 0) + chain.length + (action.action === 'pass' ? 0 : 1), 28);
      if (f.next) assert.equal(f.next.forcedPass, legalMoves(next).every(m => m.action === 'pass'));
    }
  }
});
