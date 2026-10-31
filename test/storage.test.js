import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Storage } from '../src/storage.js';
import { backupDatabase } from '../src/backup.js';

function directory() {
  const root = path.resolve('.analysis/storage-tests'); mkdirSync(root, { recursive: true });
  return mkdtempSync(path.join(root, 'run-'));
}
test('SQLite: числа больше 2^53, атомарная ошибка записи, согласованная копия и версия схемы', () => {
  const dir = directory(), db = path.join(dir, 'source.sqlite'), copy = path.join(dir, 'backup.sqlite');
  const store = new Storage(db);
  const result = { leaves: '9007199254740993123456789', wins: ['9007199254740993123456788', '1', '0'], stats: {} };
  try {
    store.saveJob({ id: 'one', key: 'lesson-key', status: 'running' });
    store.complete({ id: 'one', key: 'lesson-key' }, result, { kind: 'lesson' });
    assert.deepEqual(store.result('lesson-key'), result);
    store.saveJob({ id: 'two', key: 'rejected-key', status: 'running' });
    store.db.exec("CREATE TRIGGER reject_results BEFORE INSERT ON results BEGIN SELECT RAISE(ABORT,'test full disk'); END");
    assert.throws(() => store.complete({ id: 'two', key: 'rejected-key' }, result, { kind: 'lesson' }));
    assert.equal(store.result('rejected-key'), null);
    assert.equal(store.job('two').status, 'running');
    store.db.exec('DROP TRIGGER reject_results');
    backupDatabase(db, copy);
    assert.throws(() => backupDatabase(db, copy), /уже существует/);
  } finally { store.close(); }
  const recovered = new Storage(copy);
  try {
    assert.deepEqual(recovered.result('lesson-key'), result);
    assert.equal(recovered.job('two').interrupted, true);
  } finally { recovered.close(); }
  const raw = new DatabaseSync(db); raw.exec('PRAGMA user_version=999'); raw.close();
  assert.throws(() => new Storage(db), /новее/);
  assert.ok(readFileSync(copy).length > 0);
});

test('каталог SQLite: стабильные страницы и отсутствие лимита восьми игр', () => {
  const store = new Storage();
  try {
    for (let i = 0; i < 25; i++) store.putGame(i.toString(16).padStart(64, '0'), '{}', { rounds: [] }, `Игра ${i}`);
    const page1 = store.listGames(20);
    const cursor = JSON.parse(Buffer.from(page1.nextCursor, 'base64url').toString());
    const page2 = store.listGames(20, cursor);
    assert.equal(page1.games.length, 20); assert.equal(page2.games.length, 5);
    assert.equal(new Set([...page1.games, ...page2.games].map(game => game.id)).size, 25);
    assert.equal(page2.nextCursor, null);
  } finally { store.close(); }
});
