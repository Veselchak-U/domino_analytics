import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonCatalog, lessonDefinition, validateLesson, analyzeLesson } from '../src/lessons.js';
import { motifApplies, mirrorAction } from '../public/tactics.js';
import { decisionQuality } from '../public/impact.js';
import { trainingQuestion, gradeTrainingChoice } from '../public/training.js';
import { legalMoves, stonesOf } from '../src/game.js';
import { createApp } from '../src/server.js';

test('четыре мотива имеют подтверждение и исключение по результатам реального solver', () => {
  const catalog = lessonCatalog();
  assert.doesNotMatch(JSON.stringify(catalog), /kind|explanation|wins|best|подтверждение|исключение/i);
  for (const motif of ['control', 'partner', 'change', 'block']) {
    const pair = catalog.filter(l => l.motif === motif);
    assert.equal(pair.length, 2);
    const kinds = [];
    for (const item of pair) {
      const definition = lessonDefinition(item.id), saved = structuredClone(definition);
      const { state, chain } = validateLesson(definition);
      assert.equal(state.hands.flatMap(stonesOf).length + chain.length, 28);
      const result = analyzeLesson(item.id, false), step = result.steps[0], quality = decisionQuality(step);
      const marked = e => motifApplies(step, e.alternative, motif);
      kinds.push(result.lesson.kind);
      assert.equal(quality.kind, 'choice');
      if (result.lesson.kind === 'confirmation') {
        assert.ok(quality.entries.some(e => e.best && marked(e)));
        assert.ok(quality.entries.some(e => !e.best && !marked(e)));
      } else {
        assert.ok(quality.entries.some(e => !e.best && marked(e)));
        assert.ok(quality.entries.filter(e => e.best).every(e => !marked(e)));
      }
      for (const e of quality.entries) assert.equal(gradeTrainingChoice(step, e.alternative).best, e.best);
      assert.doesNotMatch(JSON.stringify(trainingQuestion(step)), /wins|best|actual|facts|loss/);
      assert.deepEqual(definition, saved);
      const reflected = analyzeLesson(item.id, true);
      assert.deepEqual(reflected.steps[0].wins, step.wins);
      assert.equal(reflected.steps[0].leaves, step.leaves);
      assert.deepEqual(reflected.lesson.owners, [...result.lesson.owners].reverse());
    }
    assert.deepEqual(kinds.sort(), ['confirmation', 'exception']);
  }
});

test('полная история проверяется до solver: дубли, неполный состав, неверный ход и обязательный заход', () => {
  const def = lessonDefinition(lessonCatalog()[0].id);
  const duplicate = structuredClone(def); duplicate.initial[0][0] = duplicate.initial[1][0];
  assert.throws(() => validateLesson(duplicate), /кам|повтор/i);
  const missing = structuredClone(def); missing.initial[0].pop();
  assert.throws(() => validateLesson(missing), /28|семь|7|кам/i);
  const bad = structuredClone(def); bad.path[0] = { action: 'pass' };
  assert.throws(() => validateLesson(bad), /заход|пропуск|допустим/i);
  const wrongHand = structuredClone(def);
  wrongHand.path[0] = { action: 'start', stone: def.initial[(def.starter + 1) % 4][0] };
  assert.throws(() => validateLesson(wrongHand), /нет в руке/i);
  const forced = { ...structuredClone(def), path: [] };
  assert.deepEqual(legalMoves(validateLesson(forced).state), [{ action: 'start', stone: '1-1' }]);
  forced.forcedStart = false;
  assert.throws(() => validateLesson(forced), /контекст/i);
  forced.context.score = [13, 0];
  assert.equal(legalMoves(validateLesson(forced).state).length, 7);
  forced.path = [{ action: 'start', stone: forced.initial[forced.starter].find(s => s !== '1-1') }];
  assert.equal(validateLesson(forced).chain.length, 1);
  assert.throws(() => analyzeLesson('unknown', false), /упражнен/i);
  const badContext = structuredClone(def); badContext.context.fence[0] = -1;
  assert.throws(() => validateLesson(badContext), /контекст/i);
});

test('рисунок 5 не доказывает сохранённую масть и не задаёт полные руки', () => {
  const partial = ['1-2', '1-3', '1-4', '1-5', '0-0', '0-6', '6-6'];
  for (const played of partial.slice(0, 4)) assert.ok(partial.filter(s => s !== played).every(s => !s.includes(played[2])));
  assert.throws(() => analyzeLesson('figure5', false), /упражнен/i);
});

test('рисунок 9: явная заданная позиция, точные доли и зеркало без изменения оригинала', () => {
  const source = lessonDefinition('figure9'), saved = structuredClone(source);
  const normal = analyzeLesson('figure9', false), mirrored = analyzeLesson('figure9', true);
  assert.equal(normal.lesson.sourceMode, 'given-position');
  assert.match(normal.lesson.contextNote, /истори.*не восстановлена/i);
  const step = normal.steps[0];
  for (const [action, stone, wins, leaves] of [['right', '0-0', '55', '83'], ['left', '6-5', '185', '405']]) {
    const a = step.alternatives.find(a => a.action === action && a.stone === stone);
    assert.equal(a.wins[0], wins); assert.equal(a.leaves, leaves);
  }
  assert.deepEqual(mirrored.steps[0].ends, [...step.ends].reverse());
  for (const a of step.alternatives) {
    const m = mirrorAction(a), other = mirrored.steps[0].alternatives.find(b => b.action === m.action && b.stone === m.stone);
    assert.ok(other); assert.deepEqual(other.wins, a.wins); assert.equal(other.leaves, a.leaves);
  }
  assert.deepEqual(source, saved);
  const broken = structuredClone(source); broken.chain[1] = '2-1';
  assert.throws(() => validateLesson(broken), /стык|цепоч/i);
});

test('HTTP коллекции: без импорта, строгие параметры, кеш, отмена и повтор', async () => {
  const app = createApp(); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const req = async (path, data, method = data ? 'POST' : 'GET') => {
    const res = await fetch(base + path, { method, ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
    return { status: res.status, data: await res.json() };
  };
  const done = async job => { while (job.status === 'running') { await new Promise(r => setTimeout(r, 10)); job = (await req('/api/jobs/' + job.id)).data; } return job; };
  try {
    assert.equal((await req('/api/lessons')).data.lessons.length, 9);
    assert.equal((await req('/api/lesson', { id: 'unknown' })).status, 400);
    assert.equal((await req('/api/lesson', { id: 'figure9', mirror: 'yes' })).status, 400);
    assert.equal((await req('/api/lesson', { id: 'figure9', hands: [] })).status, 400);
    const first = await done((await req('/api/lesson', { id: 'figure9' })).data);
    assert.equal(first.status, 'done');
    assert.equal((await req('/api/lesson', { id: 'figure9' })).data.cached, true);
    const running = (await req('/api/lesson', { id: 'figure9', mirror: true })).data;
    assert.equal((await req('/api/jobs/' + running.id, null, 'DELETE')).data.status, 'cancelled');
    const retry = await done((await req('/api/lesson', { id: 'figure9', mirror: true })).data);
    assert.equal(retry.status, 'done'); assert.equal(retry.cached, false);
  } finally { await app.close(); }
});
