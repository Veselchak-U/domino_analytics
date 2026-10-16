import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCacheSize } from '../public/format.js';

test('размер кеша форматируется в МБ или ГБ с двумя знаками', () => {
  assert.equal(formatCacheSize(0), '0,00 МБ');
  assert.equal(formatCacheSize(1024 ** 2), '1,00 МБ');
  assert.equal(formatCacheSize(1024 ** 3), '1,00 ГБ');
  assert.equal(formatCacheSize(1.25 * 1024 ** 3), '1,25 ГБ');
  assert.equal(formatCacheSize(1024 ** 3 - 1).replace(/\s/g, ' '), '1 024,00 МБ');
});
