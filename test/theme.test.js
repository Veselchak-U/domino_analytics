import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function openPage({ stored, dark = false, broken = false } = {}) {
  const root = { dataset: {} };
  const handlers = {};
  const attributes = {};
  const button = { setAttribute: (name, value) => { attributes[name] = value; },
    addEventListener: (name, handler) => { handlers[name] = handler; } };
  const storage = { value: stored,
    getItem() { if (broken) throw new Error('blocked'); return this.value; },
    setItem(key, value) { assert.equal(key, 'domino-theme'); if (broken) throw new Error('blocked'); this.value = value; } };
  runInNewContext(readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8'), {
    document: { documentElement: root, getElementById: () => button,
      addEventListener: (name, handler) => { handlers[name] = handler; } },
    localStorage: storage,
    matchMedia: () => ({ matches: dark, addEventListener() {} }),
  });
  const firstTheme = root.dataset.theme;
  handlers.DOMContentLoaded();
  return { root, attributes, button, storage, firstTheme, click: () => handlers.click() };
}

test('по умолчанию тёмная тема применяется до готовности DOM независимо от системы', () => {
  for (const stored of [undefined, 'invalid']) {
    for (const dark of [false, true]) {
      const page = openPage({ stored, dark });
      assert.equal(page.firstTheme, 'dark');
      assert.equal(page.root.dataset.theme, 'dark');
      assert.equal(page.attributes['aria-pressed'], 'true');
    }
  }
});

test('ручной выбор переключается, сохраняется и восстанавливается независимо от системы', () => {
  const page = openPage({ stored: 'light' });
  page.click();
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.storage.value, 'dark');
  assert.equal(page.attributes['aria-pressed'], 'true');
  assert.equal(openPage({ stored: page.storage.value }).root.dataset.theme, 'dark');
  page.click();
  assert.equal(page.storage.value, 'light');
  assert.equal(openPage({ stored: 'light', dark: true }).root.dataset.theme, 'light');
});

test('недоступное хранилище не мешает открытию и ручному переключению', () => {
  const page = openPage({ broken: true, dark: true });
  assert.equal(page.root.dataset.theme, 'dark');
  page.click();
  assert.equal(page.root.dataset.theme, 'light');
  page.click();
  assert.equal(page.root.dataset.theme, 'dark');
});
