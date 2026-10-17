import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingQuestion, gradeTrainingChoice, trainingProgress, trainingPositions } from '../public/training.js';
import { formatPointDifference } from '../public/format.js';
const option = (w, n, action, actual = false) => ({ wins: [String(w), String(n - w), '0'], leaves: String(n), action, stone: '1-2', actual });
const step = alternatives => ({ turn: 0, chain: [], ends: [], hands: [['1-2'], ['2-3'], ['3-4'], ['4-5']], alternatives });
const choices = () => [option(1, 2, 'left'), option(2, 4, 'right', true), option(1, 4, 'start')];
test('вопрос не раскрывает оценки, фактический ответ и ранжирование', () => {
  const s = step(choices()), saved = structuredClone(s), q = trainingQuestion(s);
  assert.deepEqual(q.choices, [{ action: 'left', stone: '1-2' }, { action: 'right', stone: '1-2' }, { action: 'start', stone: '1-2' }]);
  assert.doesNotMatch(JSON.stringify(q), /wins|leaves|actual|best|probabilit|facts|loss/);
  q.hands[0].pop(); assert.deepEqual(s, saved);
});
test('любой точный максимум принят, край обязателен, округление не создаёт равенства', () => {
  const s = step(choices());
  assert.equal(gradeTrainingChoice(s, { action: 'right', stone: '1-2' }).best, true);
  assert.equal(formatPointDifference(gradeTrainingChoice(s, { action: 'start', stone: '1-2' }).loss), '25,00 %');
  assert.throws(() => gradeTrainingChoice(s, { action: 'pass' }), /допустим/i);
  const n = 18014398509481985n;
  const tiny = step([option(n / 2n, n, 'left'), option(n / 2n + 1n, n, 'right')]);
  const result = gradeTrainingChoice(tiny, { action: 'left', stone: '1-2' });
  assert.equal(result.best, false); assert.equal(formatPointDifference(result.loss), '<0,01 %');
});
test('пас, вынужденный, равноценный, терминал и прогресс отдельно от побед', () => {
  const s = step(choices()), forced = step([{ action: 'pass', wins: ['1', '1', '0'], leaves: '2' }]);
  const equal = step(choices().slice(0, 2));
  const attempts = [
    { id: 1, ...gradeTrainingChoice(s, { action: 'left', stone: '1-2' }) },
    { id: 2, ...gradeTrainingChoice(s, { action: 'start', stone: '1-2' }) },
    { id: 3, ...gradeTrainingChoice(forced, { action: 'pass' }) },
    { id: 4, ...gradeTrainingChoice(equal, { action: 'right', stone: '1-2' }) },
  ];
  const p = trainingProgress([...attempts, attempts[1]]);
  assert.deepEqual([p.attempts, p.decisions, p.best, p.forced, p.equivalent], [4, 2, 1, 1, 1]);
  assert.equal(formatPointDifference(p.bestShare), '50,00 %');
  assert.equal(formatPointDifference(p.averageLoss), '12,50 %');
  assert.equal(trainingProgress([attempts[2]]).averageLoss, null);
  assert.throws(() => trainingQuestion(step([])), /заверш/i);
});
test('темы не создают фиктивных позиций, нет темы — нет вопросов', () => {
  const s = step(choices());
  const a = { steps: [s, step([])] };
  assert.deepEqual(trainingPositions(a, 'all'), [0]);
  assert.deepEqual(trainingPositions(a, 'pass'), []);
  s.alternatives[0].facts = { next: { forcedPass: true }, after: [{ count: 1 }], profile: { ends: [{ kind: 'closed', team: null }] } };
  assert.deepEqual(trainingPositions(a, 'pass'), [0]);
  assert.deepEqual(trainingPositions(a, 'exit'), [0]);
  assert.deepEqual(trainingPositions(a, 'block'), [0]);
});
