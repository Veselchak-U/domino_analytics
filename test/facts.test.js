import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { maskOf, legalMoves, applyMove, countBits, isTerminal } from '../src/game.js';
import { parseGame } from '../src/input.js';
import { moveFacts, suitProfile } from '../src/facts.js';

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

test('профиль мастей различает камни и половинки, команды и сыгранные', () => {
  const s = state([['3-3', '3-4'], ['0-3'], ['3-5'], ['0-0']]);
  const p = suitProfile(s), three = p.suits[3];
  assert.deepEqual(three.players[0], { tiles: 2, halves: 3 });
  assert.deepEqual(three.teams[0], { tiles: 3, halves: 4 });
  assert.equal(three.playedTiles, 3);
  assert.equal(three.playedHalves, 3);
  assert.equal(three.remainingTiles, 4);
  assert.equal(three.remainingHalves, 5);
});
test('контроль конца: закрытый, команда, один игрок, совместное владение', () => {
  const s = state([['3-3', '3-4'], ['0-0'], ['3-5'], ['2-2']], { left: 1, right: 3 });
  let p = suitProfile(s);
  assert.equal(p.ends[0].kind, 'closed');
  assert.equal(p.ends[0].team, null);
  assert.equal(p.ends[1].kind, 'team');
  assert.equal(p.ends[1].team, 0);
  s.hands[2] = maskOf(['4-5']);
  assert.equal(suitProfile(s).ends[1].kind, 'player');
  s.hands[1] = maskOf(['0-3']);
  assert.equal(suitProfile(s).ends[1].kind, 'shared');
  s.right = 6;
  assert.equal(suitProfile(s).terminal, true);
  s.left = s.right = null;
  assert.deepEqual(suitProfile(s).ends, []);
});
test('свежая масть берётся из цепочки до действия, а не из чужих рук', () => {
  const game = parseGame(readFileSync(new URL('./fixtures/real-game.json', import.meta.url), 'utf8'));
  for (const round of game.rounds) for (const { state: s, chain } of round.history) {
    const seen = new Set(chain.flatMap(stone => stone.split('-').map(Number)));
    const p = suitProfile(s);
    for (const suit of p.suits) {
      assert.equal(suit.remainingTiles + suit.playedTiles, 7);
      assert.equal(suit.remainingHalves + suit.playedHalves, 8);
      assert.equal(suit.playedTiles > 0, seen.has(suit.value));
    }
    for (const action of legalMoves(s)) {
      assert.deepEqual(moveFacts(s, action).freshSuits,
        [...new Set(action.stone?.split('-').map(Number) ?? [])].filter(n => !seen.has(n)));
    }
  }
});
