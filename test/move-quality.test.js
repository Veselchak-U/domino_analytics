import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionQuality, probabilityDifference } from '../public/impact.js';
import { formatPointDifference } from '../public/format.js';

const candidate = (wins, leaves = '100', extra = {}) => ({ wins: wins.map(String), leaves, ...extra });

test('положительное влияние не скрывает потерю к лучшему; обе команды всех мест', () => {
  for (const turn of [0, 1, 2, 3]) {
    const own = turn % 2;
    const values = n => own ? [100 - n, n, 0] : [n, 100 - n, 0];
    const step = { turn, wins: values(40).map(String), leaves: '100', alternatives: [
      candidate(values(50), '100', { actual: true }), candidate(values(70)), candidate(values(0)),
    ] };
    const quality = decisionQuality(step);
    assert.equal(quality.kind, 'choice');
    assert.equal(quality.bestCount, 1);
    assert.equal(formatPointDifference(quality.actual.loss), '20,00 %');
    assert.equal(formatPointDifference(probabilityDifference(quality.actual.alternative, step, own), true), '+10,00 %');
    assert.equal(formatPointDifference(quality.entries[0].loss), '0,00 %');
  }
});

test('каждый точный максимум отмечен, реальный ход независим, порядок и исходные данные сохранены', () => {
  const first = candidate([1, 1, 0], '2');
  const second = candidate([2, 2, 0], '4', { actual: true });
  const worse = candidate([1, 3, 0], '4');
  const step = { turn: 0, alternatives: [worse, first, second] }, original = structuredClone(step);
  const quality = decisionQuality(step);
  assert.deepEqual(quality.entries.map(entry => entry.alternative), [first, second, worse]);
  assert.deepEqual(quality.entries.map(entry => entry.best), [true, true, false]);
  assert.equal(quality.bestCount, 2);
  assert.equal(quality.kind, 'choice');
  assert.equal(quality.actual.alternative, second);
  assert.equal(formatPointDifference(quality.entries[2].loss), '25,00 %');
  assert.deepEqual(step, original);
});

test('потеря команды B использует её победы, а не дополнение шанса A при наличии ничьих', () => {
  const drawHeavy = candidate([2, 1, 7], '10', { actual: true });
  const better = candidate([4, 3, 3], '10');
  const quality = decisionQuality({ turn: 1, alternatives: [drawHeavy, better] });
  assert.equal(quality.entries[0].alternative, better);
  assert.equal(formatPointDifference(quality.actual.loss), '20,00 %');
});

test('вынужденная выкладка и пас отличаются от нескольких равноценных вариантов', () => {
  for (const action of ['left', 'pass']) {
    const quality = decisionQuality({ turn: 1, alternatives: [candidate([1, 1, 0], '2', { action, actual: true })] });
    assert.equal(quality.kind, 'forced');
    assert.equal(quality.bestCount, 1);
    assert.equal(formatPointDifference(quality.actual.loss), '0,00 %');
  }
  const quality = decisionQuality({ turn: 0, alternatives: [candidate([1, 1, 0], '2'), candidate([3, 3, 0], '6')] });
  assert.equal(quality.kind, 'equivalent');
  assert.equal(quality.bestCount, 2);
  assert.ok(quality.entries.every(entry => entry.best && entry.loss.numerator === 0n));
});

test('большие W/N и одинаковые проценты не скрывают точное различие и малую потерю', () => {
  const low = candidate(['9007199254740992', '9007199254740993', '0'], '18014398509481985', { probabilities: [50, 50, 0] });
  const high = candidate(['18014398509481986', '18014398509481984', '0'], '36028797018963970', { probabilities: [50, 50, 0] });
  const quality = decisionQuality({ turn: 0, alternatives: [low, high] });
  assert.equal(quality.kind, 'choice');
  assert.equal(quality.bestCount, 1);
  assert.equal(quality.entries[0].alternative, high);
  assert.ok(quality.entries[1].loss.numerator > 0n);
  assert.equal(formatPointDifference(quality.entries[1].loss), '<0,01 %');
});

test('точная разность округляется один раз, границы 0 и 100 % сохранены', () => {
  assert.equal(formatPointDifference(probabilityDifference(candidate([1, 0, 0], '1'), candidate([1, 5, 0], '6'), 0)), '83,33 %');
  assert.equal(formatPointDifference({ numerator: 1n, denominator: 20000n }), '<0,01 %');
  assert.equal(formatPointDifference({ numerator: 1n, denominator: 10000n }), '0,01 %');
  assert.equal(formatPointDifference({ numerator: 10005n, denominator: 1000000n }), '1,00 %');
  assert.equal(formatPointDifference({ numerator: 10050n, denominator: 1000000n }), '1,01 %');
  assert.equal(formatPointDifference({ numerator: 0n, denominator: 7n }), '0,00 %');
  assert.equal(formatPointDifference({ numerator: 1n, denominator: 1n }), '100,00 %');
});

test('завершённая позиция и отсутствие реального выбора не создают фиктивного решения', () => {
  assert.deepEqual(decisionQuality({ turn: 0, alternatives: [] }), { kind: 'terminal', bestCount: 0, entries: [], actual: null });
  assert.equal(decisionQuality({ turn: 0, alternatives: [candidate([1, 0, 0], '1')] }).actual, null);
});
