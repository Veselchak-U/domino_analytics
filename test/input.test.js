import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGame } from '../src/input.js';

const text = readFileSync(new URL('../contracts/kozel-game.example.json', import.meta.url), 'utf8');
test('полный пример воспроизводится: яйца, выход, рыба и свободный заход', () => {
  const game = parseGame(text);
  assert.equal(game.rounds.length, 3);
  assert.equal(game.rounds[0].outcome.reason, 'eggs');
  assert.deepEqual(game.rounds[2].outcome.totalScore, [163, 0]);
  assert.equal(game.rounds[2].history[0].state.forcedStart, null);
});
test('повторные ключи и неверные итоги отклоняются без исправления', () => {
  assert.throws(() => parseGame(text.replace('"format":', '"format":"kozel-game-v1","format":')), /повтор/i);
  const data = JSON.parse(text);
  data.rounds[0].result.finished_player = 'Неизвестный';
  assert.throws(() => parseGame(JSON.stringify(data)), /кон 1.*результат/i);
});
test('некорректная очередь, ориентация и дублирование камней обнаруживаются', () => {
  const data = JSON.parse(text);
  data.rounds[0].moves[0].player = data.rounds[0].moves[1].player;
  assert.throws(() => parseGame(JSON.stringify(data)), /кон 1, ход 1.*очеред/i);
});

for (const [name, mutate, pattern] of [
  ['неверная ориентация', d => { const m = d.rounds[0].moves.find(m => m.action === 'left' && m.stone[0] !== m.stone[2]); m.stone = m.stone.split('-').reverse().join('-'); }, /ориентац/],
  ['дублирование камня между руками', d => { const names = Object.keys(d.rounds[0].deal); d.rounds[0].deal[names[1]][0] = d.rounds[0].deal[names[0]][0]; }, /28 разных|Повтор/],
  ['неизвестное поле', d => { d.extra = true; }, /схемы/],
  ['отсутствие лимита', d => { delete d.scoreLimit; }, /схемы/],
  ['повтор места', d => { d.teams[1].players[0].seat = d.teams[0].players[0].seat; }, /места/],
  ['неизвестное имя раздачи', d => { const deal = d.rounds[0].deal; deal.Unknown = deal[Object.keys(deal)[0]]; delete deal[Object.keys(deal)[0]]; }, /Имена раздачи/],
  ['несовпадение начислений', d => { const r = d.rounds[1].result; r.round_score[Object.keys(r.round_score)[0]]++; }, /Результат/],
  ['обрыв журнала кона', d => { d.rounds[0].moves.pop(); }, /закончился до/],
  ['непоследовательный номер', d => { d.rounds[1].number = 3; }, /номеров/],
  ['незавершённая партия', d => { d.rounds.pop(); }, /Партия не завершена/],
]) {
  test(`проверка входа: ${name}`, () => {
    const data = JSON.parse(text); mutate(data);
    assert.throws(() => parseGame(JSON.stringify(data)), pattern);
  });
}

test('порядок команд, игроков и ключей раздачи не определяет очередь', () => {
  const data = JSON.parse(text);
  data.teams.reverse();
  for (const team of data.teams) team.players.reverse();
  const result = parseGame(JSON.stringify(data));
  assert.deepEqual(result.teams, ['Север', 'Юг']);
  assert.deepEqual(result.rounds.at(-1).outcome.totalScore, [163, 0]);
});

test('экранированные повторные ключи также отклоняются', () => {
  assert.throws(() => parseGame('{"format":"kozel-game-v1","for\\u006dat":"kozel-game-v1"}'), /Повтор ключа/);
});
