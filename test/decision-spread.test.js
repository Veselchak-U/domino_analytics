import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionSpread } from '../public/impact.js';
import { formatPointDifference } from '../public/format.js';

const option = (w, n) => ({ wins: [String(w), String(BigInt(n) - BigInt(w)), '0'], leaves: String(n) });

test('разброс и отрыв используют команду ходящего и не меняют варианты', () => {
  for (const turn of [0, 1, 2, 3]) {
    const step = { turn, alternatives: [option(1, 4), option(3, 4), option(1, 2)] };
    const original = structuredClone(step), result = decisionSpread(step);
    assert.equal(formatPointDifference(result.range), '50,00 %');
    assert.equal(formatPointDifference(result.gap), '25,00 %');
    assert.deepEqual(step, original);
  }
});

test('равные лидеры дают нулевой отрыв; равноценный выбор также нулевой разброс', () => {
  const result = decisionSpread({ turn: 0, alternatives: [option(1, 2), option(2, 4), option(1, 4)] });
  assert.equal(formatPointDifference(result.range), '25,00 %');
  assert.equal(result.gap.numerator, 0n);
  assert.equal(decisionSpread({ turn: 0, alternatives: [option(1, 2), option(2, 4)] }).range.numerator, 0n);
});

test('единственная выкладка и пас не имеют второго кандидата; терминал не имеет метрик', () => {
  for (const action of ['left', 'pass']) {
    const result = decisionSpread({ turn: 0, alternatives: [{ ...option(1, 2), action }] });
    assert.equal(result.range.numerator, 0n);
    assert.equal(result.gap, null);
  }
  assert.deepEqual(decisionSpread({ turn: 0, alternatives: [] }), { range: null, gap: null });
});

test('большие счётчики и одинаковые проценты сохраняют малый ненулевой отрыв', () => {
  const result = decisionSpread({ turn: 0, alternatives: [option(9007199254740992n, 18014398509481985n),
    option(9007199254740993n, 18014398509481985n)] });
  assert.ok(result.gap.numerator > 0n);
  assert.equal(formatPointDifference(result.gap), '<0,01 %');
});
