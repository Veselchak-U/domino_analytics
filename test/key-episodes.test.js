import test from 'node:test';
import assert from 'node:assert/strict';
import { keyEpisodes } from '../public/quality.js';
import { formatPointDifference } from '../public/format.js';

const option = (w, n = 100n, actual = false) => ({ wins: [String(w), String(BigInt(n) - BigInt(w)), '0'], leaves: String(n), actual });
const position = (w, alternatives, n = 100n, turn = 0) => ({ ...option(w, n), turn, alternatives });
function analysis(positions) {
  return { steps: [...positions, position(100, [])].map((s, i) => ({ ...s, index: i,
    move: i ? { player: 'Игрок', action: 'pass' } : null })) };
}

test('эпизоды различают рост, снижение, потерю и разброс; указывают позицию перед действием', () => {
  const result = keyEpisodes(analysis([
    position(40, [option(50, 100n, true), option(70), option(0)]),
    position(40, [option(30, 100n, true), option(50)]),
    position(40, [option(60, 100n, true), option(20)]),
  ]));
  assert.deepEqual(result.losses.map(e => e.actionStep), [1, 2]);
  assert.deepEqual(result.gains.map(e => e.actionStep), [3, 1]);
  assert.deepEqual(result.drops.map(e => e.actionStep), [2]);
  assert.deepEqual(result.spreads.map(e => e.actionStep), [1, 3, 2]);
  const e = result.losses[0];
  assert.equal(e.position, 0);
  assert.equal(e.move.player, 'Игрок');
  assert.equal(e.best.length, 1);
  assert.equal(formatPointDifference(e.loss), '20,00 %');
  assert.equal(formatPointDifference(e.impact, true), '+10,00 %');
  assert.equal(formatPointDifference(e.range), '70,00 %');
});

test('эпизоды сортируются по точным дробям, равные по ходу; не более пяти', () => {
  const n = 18014398509481985n;
  const a = analysis(Array.from({ length: 7 }, (_, i) => position(n / 2n,
    [option(n / 2n, n, true), option(n / 2n + BigInt(i === 0 ? 1 : i), n)], n)));
  const saved = structuredClone(a);
  const result = keyEpisodes(a, 5, 0);
  assert.deepEqual(result.losses.map(e => e.actionStep), [7, 6, 5, 4, 3]);
  assert.equal(formatPointDifference(result.losses[0].loss), '<0,01 %');
  assert.deepEqual(keyEpisodes(a, 7, 0).losses.slice(-2).map(e => e.actionStep), [1, 2]);
  assert.deepEqual(a, saved);
});

test('нулевые, терминальные и незаписанные решения не создают эпизодов', () => {
  const a = analysis([
    position(50, [option(50, 100n, true)]),
    position(50, [option(50, 100n, true), option(1, 2n)]),
    position(30, [option(50), option(10)]),
  ]);
  assert.deepEqual(keyEpisodes(a), { losses: [], gains: [], drops: [], spreads: [] });
  assert.deepEqual(keyEpisodes({ steps: [position(40, [option(50, 100n, true), option(30)])] }),
    { losses: [], gains: [], drops: [], spreads: [] });
});

test('автор второй команды, ничьи и несколько лучших вариантов', () => {
  const a = analysis([position(30, [
    { wins: ['30', '50', '20'], leaves: '100', actual: true },
    { wins: ['20', '60', '20'], leaves: '100' },
    { wins: ['1', '3', '1'], leaves: '5' },
  ], 100n, 3)]);
  const e = keyEpisodes(a).losses[0];
  assert.equal(e.best.length, 2);
  assert.equal(formatPointDifference(e.loss), '10,00 %');
  assert.equal(formatPointDifference(e.impact, true), '−20,00 %');
  assert.equal(e.position, 0);
});

test('общий порог по умолчанию 3 %, включительно и без учёта знака', () => {
  const a = analysis([
    position(47, [option(50, 100n, true), option(53)]),
    position(53, [option(50, 100n, true), option(53)]),
    position(4701, [option(5000, 10000n, true), option(5299, 10000n)], 10000n),
    position(5299, [option(5000, 10000n, true), option(5299, 10000n)], 10000n),
  ]);
  const result = keyEpisodes(a);
  assert.deepEqual(result.losses.map(e => e.actionStep), [1, 2]);
  assert.deepEqual(result.gains.map(e => e.actionStep), [1]);
  assert.deepEqual(result.drops.map(e => e.actionStep), [2]);
  assert.deepEqual(result.spreads.map(e => e.actionStep), [1, 2]);
  const all = keyEpisodes(a, 5, 0);
  assert.equal(all.losses.length, 4);
  assert.equal(all.gains.length, 2);
  assert.equal(all.drops.length, 2);
  assert.equal(all.spreads.length, 4);
  assert.deepEqual(keyEpisodes(a, 5, 3.01), { losses: [], gains: [], drops: [], spreads: [] });
});

test('фильтр сравнивает точную величину до округления и каждую категорию отдельно', () => {
  const n = 1000000000000000000n, half = n / 2n, three = n * 3n / 100n;
  const a = analysis([
    position(half, [option(half + three - 1n, n, true), option(half, n)], n),
    position(half, [option(half + three, n, true), option(half, n)], n),
    position(48, [option(50, 100n, true), option(58)]),
  ]);
  assert.equal(formatPointDifference(keyEpisodes(a, 5, 0).gains.find(e => e.actionStep === 1).impact, true), '+3,00 %');
  assert.deepEqual(keyEpisodes(a).gains.map(e => e.actionStep), [2]);
  assert.deepEqual(keyEpisodes(a).losses.map(e => e.actionStep), [3]);
  assert.deepEqual(keyEpisodes(a).spreads.map(e => e.actionStep), [3, 2]);
  for (const threshold of [-1, 101, NaN, Infinity, 3.001]) {
    assert.throws(() => keyEpisodes(a, 5, threshold), RangeError);
  }
});
