import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseGame} from '../shared/input.js';
import {analyzeRound,analyzeBranch} from '../shared/analysis.js';
import {analyzeLesson} from '../shared/lessons.js';
import {resultKey,resultEnvelope,RESULT_VERSION} from '../shared/contract.js';
import {lessonManifest} from '../shared/lesson-manifest.js';
// Runs on the developer's client computer; the container only stores and returns data.
const phase=process.argv[2];if(!['seed','verify'].includes(phase))throw new Error('Используйте seed|verify');
const base=process.env.DOMINO_SMOKE_URL??'http://127.0.0.1:3210/api/v1';
const stateFile=new URL('../.analysis/docker-smoke-state.json',import.meta.url);
async function request(route,data,method=data?'POST':'GET'){
 const response=await fetch(base+route,{method,...(data?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;
}
assert.equal((await request('/health')).computation,'client');
if(phase==='seed'){
 const legacy=JSON.parse(await readFile(new URL('../test/fixtures/real-game.json',import.meta.url),'utf8'));
 const text=JSON.stringify({playedAt:'2026-09-12T19:30:00+03:00',...legacy}),game=await request('/import',{text,name:'Проверочная партия.json'}),parsed=parseGame(text);
 const cases=[[{version:RESULT_VERSION,kind:'round',gameId:game.id,round:1},analyzeRound(parsed,0)],[{version:RESULT_VERSION,kind:'branch',gameId:game.id,round:1,position:14,moves:[],example:null},analyzeBranch(parsed,0,14,[])],[{version:RESULT_VERSION,kind:'lesson',lessonId:'figure9',lessonDataHash:lessonManifest.hash,mirror:false},analyzeLesson('figure9')]];
 const results=[];
 for(const[d,r]of cases){const key=await resultKey(d),e=await resultEnvelope(d,r);const saved=await request('/results/'+key,e,'PUT');assert.deepEqual(saved.result,e.result);results.push({key,result:e.result});}
 await mkdir(new URL('../.analysis/',import.meta.url),{recursive:true});await writeFile(stateFile,JSON.stringify({gameId:game.id,text,results}));console.log('Docker seed: рассчитано на клиенте, компактные результаты сохранены');
}else{
 const saved=JSON.parse(await readFile(stateFile,'utf8'));
 assert.deepEqual((await request('/games/'+saved.gameId)).completedRounds,[1]);
 for(const r of saved.results){const e=await request('/results/'+r.key);assert.equal(e.cached,true);assert.deepEqual(e.result,r.result);}
 assert.equal(await(await fetch(base+'/games/'+saved.gameId+'/source')).text(),saved.text);
 console.log('Docker verify: исходник и готовые результаты восстановлены без вычислений на сервере');
}
