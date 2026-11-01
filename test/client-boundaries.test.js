import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from './helpers/fixtures.js';
import { createApp } from '../src/server.js';
import { validateSource, LIMITS, resultEnvelope, resultKey, RESULT_VERSION, validateEnvelope } from '../shared/contract.js';
import { lessonManifest } from '../shared/lesson-manifest.js';
import { strictJson } from '../shared/json.js';
import { Computation } from '../public/computation.js';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const text=readFileSync(new URL('./fixtures/real-game.json',import.meta.url),'utf8');
test('границы исходника, playedAt и строгий JSON',()=>{
  const padding=' '.repeat(LIMITS.source-Buffer.byteLength(text));
  assert.equal(validateSource(text+padding).playedAt,'2026-09-12T19:30:00+03:00');
  assert.throws(()=>validateSource(text+padding+' '),e=>e.statusCode===413);
  for(const playedAt of [undefined,null,'','2026-02-30T00:00:00Z','2026-01-01T00:00:00']){
    const data=JSON.parse(text);data.playedAt=playedAt;assert.throws(()=>validateSource(JSON.stringify(data)));
  }
  const reordered=JSON.parse(text),playedAt=reordered.playedAt;delete reordered.playedAt;
  assert.ok(validateSource(JSON.stringify({...reordered,playedAt})));
  assert.throws(()=>strictJson('{"x":1,"\\u0078":2}'),/Повтор/);
  assert.throws(()=>strictJson('['.repeat(66)+'0'+']'.repeat(66)),/глубоко/);
  assert.throws(()=>strictJson('{"x":9007199254740993}'),/диапазон/);
});
test('ограниченные загрузки не занимают вычислительную очередь, чтения доступны',async()=>{
  const app=createApp();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const port=app.server.address().port,base='http://127.0.0.1:'+port;
  const held=[];
  try{
    for(let i=0;i<2;i++){
      await new Promise((resolve,reject)=>{
        const req=http.request(base+'/api/v1/import',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':1000000}},()=>{});
        req.on('error',()=>{});req.on('socket',()=>{});held.push(req);req.write('{"text":');
        // A read round trip ensures admission has been handled before starting the next request.
        fetch(base+'/api/v1/health').then(()=>setTimeout(resolve,10)).catch(reject);
      });
    }
    const busy=await fetch(base+'/api/v1/import',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(busy.status,429);assert.equal((await busy.json()).code,'UPLOAD_BUSY');
    assert.equal((await fetch(base+'/api/games')).status,200);
  }finally{held.forEach(r=>r.destroy());await app.close();}
});
test('локальный вычислитель: отмена, позднее сообщение, отказ загрузки и повтор',async()=>{
  const workers=[];
  const computation=new Computation({workerFactory:()=>{const w={postMessage(message){this.message=message;},terminate(){this.stopped=true;}};workers.push(w);return w;}});
  const first=computation.run('round',{}).catch(e=>e.code);computation.cancel();assert.equal(await first,'CANCELLED');
  const second=computation.run('lesson',{});
  workers[0].onmessage({data:{runId:1,type:'result',result:'late'}});
  assert.equal(computation.active.runId,2);
  workers[1].onmessage({data:{runId:2,type:'result',result:'correct'}});
  assert.equal(await second,'correct');computation.dispose();assert.ok(workers.every(w=>w.stopped));
  const failed=new Computation({workerFactory:()=>{throw new Error();}});
  await assert.rejects(failed.run('round',{}),/Web Worker/);assert.equal(failed.active,null);
});
test('проверка envelope отвергает неверные счётчики, версии и неподдержанные поля',async()=>{
  const descriptor={version:RESULT_VERSION,kind:'lesson',lessonId:'figure9',lessonDataHash:lessonManifest.hash,mirror:false};
  const {analyzeLesson}=await import('../shared/lessons.js');
  const good=await resultEnvelope(descriptor,analyzeLesson('figure9')),key=await resultKey(descriptor);
  await validateEnvelope(key,good,lessonManifest);
  for(const mutate of [e=>e.result.base.leaves='-1',e=>e.result.base.outcomes.fish[0]='999',e=>e.result.steps[0].depth=-1,e=>e.result.graph=[],e=>e.payloadHash='0'.repeat(64),e=>e.descriptor.mirror='yes']){
    const bad=structuredClone(good);mutate(bad);await assert.rejects(validateEnvelope(key,bad,lessonManifest));
  }
  const next=structuredClone(good);next.descriptor.version.engine=2;await assert.rejects(validateEnvelope(key,next,lessonManifest),e=>e.statusCode===422);
});

test('HTTP: предел результата 16 МиБ, 415, 503 и отсутствие серверной игровой проверки',async()=>{
  const root=path.resolve('.analysis/boundary-tests');mkdirSync(root,{recursive:true});const file=path.join(mkdtempSync(path.join(root,'run-')),'store.sqlite');
  const app=createApp({databasePath:file});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port+'/api/v1';
  const request=(route,data,method='POST',extra={})=>fetch(base+route,{method,headers:{'Content-Type':'application/json',Connection:'close',...extra},body:typeof data==='string'?data:JSON.stringify(data)});
  let raw;
  try{
    const broken=JSON.parse(text);broken.rounds[0].moves[0].player='wrong';
    const imported=await request('/import',{text:JSON.stringify(broken)});assert.equal(imported.status,201);
    const {parseGame}=await import('../shared/input.js');assert.throws(()=>parseGame(JSON.stringify(broken)),/очеред/);
    const {analyzeLesson}=await import('../shared/lessons.js');
    const descriptor={version:RESULT_VERSION,kind:'lesson',lessonId:'figure9',lessonDataHash:lessonManifest.hash,mirror:false};
    const envelope=await resultEnvelope(descriptor,analyzeLesson('figure9')),key=await resultKey(descriptor),payload=JSON.stringify(envelope);
    const exact=payload+' '.repeat(LIMITS.result-Buffer.byteLength(payload));
    assert.equal((await request('/results/'+key,exact,'PUT')).status,201);
    assert.equal((await request('/results/'+key,exact+' ','PUT')).status,413);
    assert.equal((await request('/results/'+key,envelope,'PUT',{'Content-Encoding':'gzip'})).status,415);
    raw=new DatabaseSync(file);raw.exec("CREATE TRIGGER reject_new BEFORE INSERT ON results BEGIN SELECT RAISE(ABORT,'test full disk'); END");
    const nextDescriptor={...descriptor,mirror:true},nextKey=await resultKey(nextDescriptor);
    assert.equal((await request('/results/'+nextKey,await resultEnvelope(nextDescriptor,analyzeLesson('figure9',true)),'PUT')).status,503);
    assert.equal((await fetch(base+'/results/'+nextKey)).status,404);
    assert.equal((await fetch(base+'/health')).status,200);
  }finally{raw?.close();await app.close();}
});
