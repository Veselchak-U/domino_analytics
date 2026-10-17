import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePlayerQuality } from '../public/quality.js';
import { formatPointDifference } from '../public/format.js';

const players = ['А', 'Б', 'В', 'Г'].map((name, i) => ({ name, seat: i + 1 }));
const option = (w, n, actual = false) => ({ wins: [String(w), String(BigInt(n) - BigInt(w)), '0'], leaves: String(n), actual });
const decision = alternatives => ({ turn: 0, alternatives });
const round = (number, steps) => ({ number, steps: [...steps, { turn: 1, alternatives: [] }] });
const mixed = () => round(1, [
  decision([option(3, 4, true), option(1, 2)]),
  decision([option(1, 2, true), option(3, 4)]),
  decision([option(1, 2, true)]),
  decision([option(1, 2, true), option(2, 4)]),
]);

test('значимые решения, лучшие из нескольких максимумов, средняя и максимум потерь', () => {
  const result = summarizePlayerQuality([mixed()], players, 1);
  const p = result.players[0];
  assert.equal(result.complete, true);
  assert.deepEqual([p.decisions, p.best, p.forced, p.equivalent], [2, 1, 1, 1]);
  assert.equal(formatPointDifference(p.bestShare), '50,00 %');
  assert.equal(formatPointDifference(p.averageLoss), '12,50 %');
  assert.equal(formatPointDifference(p.maxLoss), '25,00 %');
  const ties = round(1, [decision([option(2, 4, true), option(1, 2), option(1, 4)])]);
  assert.equal(summarizePlayerQuality([ties], players, 1).players[0].best, 1);
});

test('все места используют шанс своей команды, в том числе при ничьих', () => {
  for (const turn of [0, 1, 2, 3]) {
    const steps = [{ turn, alternatives: [
      { wins: ['2', '1', '7'], leaves: '10', actual: true },
      { wins: ['4', '3', '3'], leaves: '10', actual: false },
    ] }];
    assert.equal(formatPointDifference(summarizePlayerQuality([round(1, steps)], players, 1).players[turn].averageLoss), '20,00 %');
  }
});

test('неполные данные не дают итога партии, отсутствующие решения не считаются идеальными', () => {
  const result = summarizePlayerQuality([mixed()], players, 2);
  assert.equal(result.complete, false);
  assert.equal(result.completedRounds, 1);
  assert.equal(result.players, null);
  assert.equal(result.byRound[1].players, null);
  const noDecisions = summarizePlayerQuality([round(1, [decision([option(1, 2, true)])])], players, 1).players[0];
  assert.equal(noDecisions.decisions, 0);
  assert.equal(noDecisions.bestShare, null);
  assert.equal(noDecisions.averageLoss, null);
  assert.equal(noDecisions.maxLoss, null);
  const missingActual = summarizePlayerQuality([round(1, [decision([option(1, 2)])])], players, 1);
  assert.equal(missingActual.complete, false);
  assert.equal(missingActual.byRound[0].players[0].unavailable, 1);
});

test('партия агрегирует решения, а повтор номера заменяет результат без удвоения', () => {
  const second = round(2, [decision([option(0, 1, true), option(1, 2)])]);
  const result = summarizePlayerQuality([mixed(), second, mixed()], players, 2);
  const p = result.players[0];
  assert.equal(result.completedRounds, 2);
  assert.equal(p.decisions, 3);
  assert.equal(p.best, 1);
  assert.equal(formatPointDifference(p.averageLoss), '25,00 %');
  assert.equal(formatPointDifference(p.maxLoss), '50,00 %');
  const replacement = round(1, [decision([option(1, 1, true), option(0, 1)])]);
  assert.equal(summarizePlayerQuality([mixed(), replacement], players, 1).players[0].decisions, 1);
});

test('точные малые потери не становятся лучшим выбором после округления', () => {
  const r = round(1, [decision([option(9007199254740992n, 18014398509481985n, true),
    option(9007199254740993n, 18014398509481985n)])]);
  const p = summarizePlayerQuality([r], players, 1).players[0];
  assert.equal(p.best, 0);
  assert.equal(formatPointDifference(p.averageLoss), '<0,01 %');
});
