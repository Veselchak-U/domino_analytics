import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from './helpers/fixtures.js';
import { parseGame } from '../src/input.js';
import { analyzeBranch } from '../src/analysis.js';
import { legalMoves, applyMove, positionKey, stonesOf, settle } from '../src/game.js';
import { createApp } from '../src/server.js';
const text = readFileSync(new URL('./fixtures/real-game.json', import.meta.url), 'utf8');
const game = () => parseGame(text);

test('ветка вне журнала воспроизводится, сохраняет исходник и 28 камней', () => {
  const g = game(), saved = structuredClone(g), origin = g.rounds[0].history[8];
  const action = legalMoves(origin.state).find(m => positionKey(applyMove(origin.state, m)) !== positionKey(g.rounds[0].history[9].state));
  const result = analyzeBranch(g, 0, 8, [action]);
  assert.deepEqual(result.steps[1].hands, applyMove(origin.state, action).hands.map(stonesOf));
  assert.deepEqual(result.branch.path, [action]);
  assert.equal(result.branch.origin, 8);
  for (const s of result.steps) assert.equal(s.hands.flat().length + s.chain.length, 28);
  assert.deepEqual(g, saved);
});
test('примеры выигрыша и поражения доходят до нужного аналитического терминала', () => {
  const g = game();
  for (const kind of ['win', 'loss']) {
    const result = analyzeBranch(g, 0, 8, [], undefined, kind);
    assert.equal(result.steps.at(-1).terminal, true);
    const target = kind === 'win' ? result.branch.referenceTeam : 1 - result.branch.referenceTeam;
    assert.equal(result.outcome.analyticsWinner, target);
    let s = g.rounds[0].history[8].state;
    for (const move of result.branch.path) s = applyMove(s, move);
    assert.deepEqual(settle(s, result.context), result.outcome);
  }
});
test('нелегальный путь, край, индекс, терминал и недостижимый исход отклоняются', () => {
  const g = game();
  assert.throws(() => analyzeBranch(g, 0, 8, [{ action: 'pass' }]), /допустим/i);
  assert.throws(() => analyzeBranch(g, 0, 8, [{ action: 'left', stone: '4-6' }]), /допустим/i);
  assert.throws(() => analyzeBranch(g, 0, -1, []), /позици/i);
  assert.throws(() => analyzeBranch(g, 0, 15, [{ action: 'pass' }]), /допустим/i);
  assert.throws(() => analyzeBranch(g, 0, 15, [], undefined, 'draw'), /нет продолжения/i);
  assert.throws(() => analyzeBranch(g, 0, 8, [], undefined, 'other'), /режим/i);
});
test('сервер не вычисляет: прежний маршрут возвращает 410',async()=>{
 const app=createApp();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{const res=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/branch',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(res.status,410);assert.equal((await res.json()).code,'CLIENT_COMPUTATION_REQUIRED');}finally{await app.close();}
});
