import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Only the checked-in public fixture and loopback API are used.
const phase = process.argv[2];
if (!['seed', 'verify'].includes(phase)) throw new Error('Используйте: node tools/docker-smoke.js seed|verify');
const base = 'http://127.0.0.1:3210/api/v1';
const stateFile = new URL('../.analysis/docker-smoke-state.json', import.meta.url);
const request = async (route, data) => {
  const response = await fetch(base + route, data === undefined ? {} : { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3210' }, body: JSON.stringify(data) });
  const result = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(result)}`);
  return result;
};
async function finish(job) {
  for (let i = 0; job.status === 'running' && i < 1200; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    job = await request(`/jobs/${job.id}`);
  }
  assert.equal(job.status, 'done', job.error);
  return job;
}
assert.equal((await request('/health')).storage, 'sqlite');
if (phase === 'seed') {
  const text = await readFile(new URL('../test/fixtures/real-game.json', import.meta.url), 'utf8');
  const game = await request('/import', { text, name: 'Проверочная партия.json' });
  assert.equal((await request('/import', { text, name: 'Повтор.json' })).id, game.id);
  const round = await finish(await request('/analyze', { gameId: game.id, round: 1 }));
  assert.equal(round.result.base.leaves, '7328406');
  assert.deepEqual(round.result.base.wins, ['4255456', '3072949', '1']);
  const branch = await finish(await request('/branch', { gameId: game.id, round: 1, position: 14, moves: [] }));
  const lessonId = (await request('/lessons')).lessons[0].id;
  const lesson = await finish(await request('/lesson', { id: lessonId }));
  await mkdir(new URL('../.analysis/', import.meta.url), { recursive: true });
  await writeFile(stateFile, JSON.stringify({ gameId: game.id, round: round.result, branch: branch.result, lessonId, lesson: lesson.result }));
  console.log('Docker seed: игра, точный раунд, ветвь и урок сохранены в SQLite');
} else {
  const saved = JSON.parse(await readFile(stateFile, 'utf8'));
  const game = await request(`/games/${saved.gameId}`);
  assert.deepEqual(game.completedRounds, [1]);
  assert.equal(game.fileName, 'Проверочная партия.json');
  const round = await request('/analyze', { gameId: game.id, round: 1 });
  assert.equal(round.cached, true); assert.deepEqual(round.result, saved.round);
  const branch = await request('/branch', { gameId: game.id, round: 1, position: 14, moves: [] });
  assert.equal(branch.cached, true); assert.deepEqual(branch.result, saved.branch);
  const lesson = await request('/lesson', { id: saved.lessonId });
  assert.equal(lesson.cached, true); assert.deepEqual(lesson.result, saved.lesson);
  assert.deepEqual((await request(`/games/${game.id}/analyses`)).analyses, [saved.round]);
  const source = await (await fetch(base + `/games/${game.id}/source`)).text();
  assert.equal(source, await readFile(new URL('../test/fixtures/real-game.json', import.meta.url), 'utf8'));
  console.log('Docker verify: после перезапуска игра и все точные результаты восстановлены из БД, cached=true');
}
