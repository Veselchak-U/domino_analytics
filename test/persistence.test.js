import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/server.js';

const text = readFileSync(new URL('./fixtures/real-game.json', import.meta.url), 'utf8');
async function open(databasePath, extra = {}) {
  const app = createApp({ databasePath, ...extra });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}/api/v1`;
  const api = async (route, data, method = data === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + route, { method, ...(data === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    }) });
    return { status: response.status, data: await response.json() };
  };
  return { app, api, base };
}
async function finish(api, job) {
  for (let i = 0; job.status === 'running' && i < 1200; i++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    job = (await api(`/jobs/${job.id}`)).data;
  }
  assert.equal(job.status, 'done', job.error);
  return job;
}
function database() {
  const parent = path.resolve('.analysis/persistence-tests');
  mkdirSync(parent, { recursive: true });
  return path.join(mkdtempSync(path.join(parent, 'run-')), 'games.sqlite');
}

test('SQLite: импорт, точный анализ, ветвь и кеш после перезапуска', { timeout: 120000 }, async () => {
  const db = database();
  let running = await open(db);
  let id, round, branch, lesson;
  try {
    const imported = await running.api('/import', { text, name: 'Моя партия.json' });
    assert.equal(imported.status, 200);
    id = imported.data.id;
    assert.equal((await running.api('/import', { text, name: 'Другое имя.json' })).data.fileName, 'Моя партия.json');
    assert.equal((await running.api('/import', { text: '{}' })).status, 400);
    assert.equal((await running.api('/import', { text, name: 'Неверное\nимя' })).status, 400);
    round = await finish(running.api, (await running.api('/analyze', { gameId: id, round: 1 })).data);
    assert.equal(round.result.base.leaves, '7328406');
    assert.deepEqual(round.result.base.wins, ['4255456', '3072949', '1']);
    branch = await finish(running.api, (await running.api('/branch', { gameId: id, round: 1, position: 14, moves: [] })).data);
    const catalog = (await running.api('/lessons')).data.lessons;
    lesson = await finish(running.api, (await running.api('/lesson', { id: catalog[0].id })).data);
  } finally { await running.app.close(); }
  running = await open(db);
  try {
    const library = (await running.api('/games')).data;
    assert.equal(library.games.length, 1);
    assert.equal(library.games[0].fileName, 'Моя партия.json');
    assert.deepEqual(library.games[0].completedRounds, [1]);
    assert.equal(await (await fetch(running.base + `/games/${id}/source`)).text(), text);
    assert.equal((await running.api(`/games/${id}`)).data.id, id);
    assert.deepEqual((await running.api(`/games/${id}/analyses`)).data.analyses[0], round.result);
    const cached = (await running.api('/analyze', { gameId: id, round: 1 })).data;
    assert.equal(cached.cached, true);
    assert.deepEqual(cached.result, round.result);
    assert.equal((await running.api('/branch', { gameId: id, round: 1, position: 14, moves: [] })).data.cached, true);
    assert.deepEqual((await running.api(`/jobs/${branch.id}`)).data.result, branch.result);
    assert.equal((await running.api('/lesson', { id: lesson.result.lesson.id })).data.cached, true);
    assert.equal((await running.api('/games/missing')).status, 404);
    assert.equal((await running.api('/games?limit=0')).status, 400);
    assert.equal((await running.api('/games?cursor=invalid')).status, 400);
    assert.equal((await fetch(running.base.replace('/api/v1', '/'))).status, 404);
  } finally { await running.app.close(); }
  running = await open(db, { resultVersion: 'next-test-version' });
  try { assert.deepEqual((await running.api(`/games/${id}`)).data.completedRounds, []); }
  finally { await running.app.close(); }
});

test('SQLite: прерванный расчёт не выдаётся за готовый, игра сохранена', async () => {
  const db = database();
  let running = await open(db);
  let job;
  try {
    const game = (await running.api('/import', { text })).data;
    job = (await running.api('/analyze', { gameId: game.id, round: 1 })).data;
    assert.equal(job.status, 'running');
  } finally { await running.app.close(); }
  running = await open(db);
  try {
    const interrupted = (await running.api(`/jobs/${job.id}`)).data;
    assert.equal(interrupted.status, 'error');
    assert.equal(interrupted.interrupted, true);
    assert.equal(interrupted.result, undefined);
    assert.equal((await running.api('/games')).data.games.length, 1);
  } finally { await running.app.close(); }
});

test('слишком большое HTTP-тело получает 413 и не ломает следующий запрос', async () => {
  const running = await open(':memory:');
  try {
    assert.equal((await running.api('/import', { text: 'x'.repeat(11 * 1024 * 1024) })).status, 413);
    assert.equal((await running.api('/games')).status, 200);
  } finally { await running.app.close(); }
});
