import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chainTeams, pipCoordinates } from '../public/domino.js';
import { parseGame } from '../src/input.js';
import { stonesOf } from '../src/game.js';

test('команда камня не зависит от края, ориентации и номера в цепочке', () => {
  const hands = [['1-1', '1-6'], ['0-2'], ['3-4'], ['5-5']];
  const saved = structuredClone(hands);
  assert.deepEqual(chainTeams(['2-0', '1-1', '6-1', '4-3', '5-5'], hands), [1, 0, 0, 0, 1]);
  assert.deepEqual(chainTeams([], hands), []);
  assert.deepEqual(hands, saved);
});
test('неизвестный камень и неоднозначный владелец не получают выдуманной команды', () => {
  assert.throws(() => chainTeams(['1-2'], [[], [], [], []]), /владелец/i);
  assert.throws(() => chainTeams([], [['1-2'], ['2-1'], [], []]), /владелец/i);
});
test('все префиксы реальных раундов, включая пасы, совпадают с авторами ходов', () => {
  for (const path of ['./fixtures/real-game.json', '../contracts/kozel-game.example.json']) {
    const game = parseGame(readFileSync(new URL(path, import.meta.url), 'utf8'));
    for (const round of game.rounds) {
      const hands = round.history[0].state.hands.map(stonesOf), expected = [];
      for (const step of round.history) {
        const move = step.move;
        if (move && move.action !== 'pass') {
          const player = game.players.find(p => p.name === move.player), team = (player.seat - 1) % 2;
          if (move.action === 'left') expected.unshift(team); else expected.push(team);
        }
        assert.deepEqual(chainTeams(step.chain, hands), expected);
      }
    }
  }
});
test('шесть точек: горизонтальная фишка — два ряда, вертикальная — две колонки', () => {
  for (const vertical of [false, true]) {
    const points = pipCoordinates(6, vertical);
    assert.equal(points.length, 6);
    assert.equal(new Set(points.map(p => p[0])).size, vertical ? 2 : 3);
    assert.equal(new Set(points.map(p => p[1])).size, vertical ? 3 : 2);
  }
});
