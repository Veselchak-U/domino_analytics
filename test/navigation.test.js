import test from 'node:test';
import assert from 'node:assert/strict';
import { revealChartStep } from '../public/navigation.js';

function viewport({ scrollLeft = 100, width = 300, content = 1200 } = {}) {
  let writes = 0;
  return { clientWidth: width, scrollWidth: content, clientLeft: 0,
    getBoundingClientRect: () => ({ left: 50 }),
    get scrollLeft() { return scrollLeft; },
    set scrollLeft(value) { scrollLeft = value; writes++; },
    get writes() { return writes; } };
}
const target = (left, right) => ({ getBoundingClientRect: () => ({ left, right }) });

test('группа справа и слева становится видна с небольшим отступом', () => {
  const right = viewport();
  revealChartStep(right, target(360, 416));
  assert.equal(right.scrollLeft, 178);
  const left = viewport();
  revealChartStep(left, target(15, 71));
  assert.equal(left.scrollLeft, 53);
});

test('видимый ход и полностью помещающийся график не вызывают прокрутку', () => {
  const scroller = viewport();
  revealChartStep(scroller, target(100, 156));
  assert.equal(scroller.scrollLeft, 100);
  assert.equal(scroller.writes, 0);
  const wide = viewport({ scrollLeft: 0, width: 1200 });
  revealChartStep(wide, target(80, 136));
  assert.equal(wide.writes, 0);
});

test('края истории ограничены началом и концом прокрутки; нет группы — нет действий', () => {
  const first = viewport({ scrollLeft: 10 });
  revealChartStep(first, target(48, 104));
  assert.equal(first.scrollLeft, 0);
  const last = viewport({ scrollLeft: 890 });
  revealChartStep(last, target(315, 371));
  assert.equal(last.scrollLeft, 900);
  revealChartStep(last, null);
  assert.equal(last.writes, 1);
});
