import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {readFileSync} from './helpers/fixtures.js';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../src/server.js';
import {parseGame} from '../src/input.js';
import {analyzeRound,analyzeBranch} from '../src/analysis.js';
import {analyzeLesson} from '../src/lessons.js';
import {resultKey,resultEnvelope,RESULT_VERSION} from '../shared/contract.js';
import {lessonManifest} from '../shared/lesson-manifest.js';
import {backupDatabase} from '../src/backup.js';
const text=readFileSync(new URL('./fixtures/real-game.json',import.meta.url),'utf8');
function location(){const root=path.resolve('.analysis/persistence-tests');mkdirSync(root,{recursive:true});return path.join(mkdtempSync(path.join(root,'client-')),'games.sqlite');}
async function open(databasePath,extra={}){
 const app=createApp({databasePath,...extra});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port+'/api/v1';
 const api=async(route,data,method=data?'POST':'GET')=>{const res=await fetch(base+route,{method,headers:{Connection:'close',...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:res.status,data:await res.json()};};
 return {app,base,api};
}
test('SQLite: клиентские раунд, ветка, урок, версии, перезапуск и backup',{timeout:120000},async()=>{
 const db=location();let running=await open(db);const game=parseGame(text);const expected=[];let id;
 try{
  const imported=await running.api('/import',{text,name:'Моя партия.json'});assert.equal(imported.status,201);id=imported.data.id;
  const cases=[[{version:RESULT_VERSION,kind:'round',gameId:id,round:1},analyzeRound(game,0)], [{version:RESULT_VERSION,kind:'branch',gameId:id,round:1,position:14,moves:[],example:null},analyzeBranch(game,0,14,[])], [{version:RESULT_VERSION,kind:'lesson',lessonId:'figure9',lessonDataHash:lessonManifest.hash,mirror:false},analyzeLesson('figure9')]];
  for(const [descriptor,result] of cases){const key=await resultKey(descriptor),envelope=await resultEnvelope(descriptor,result);const saved=await running.api('/results/'+key,envelope,'PUT');assert.equal(saved.status,201,saved.data.error);expected.push([key,envelope]);}
  assert.equal((await running.api('/import',{text,name:'Другое.json'})).data.fileName,'Моя партия.json');
  backupDatabase(db,db+'.backup');
 }finally{await running.app.close();}
 running=await open(db);
 try{
  assert.deepEqual((await running.api('/games/'+id)).data.completedRounds,[1]);
  assert.equal(await(await fetch(running.base+'/games/'+id+'/source')).text(),text);
  for(const [key,envelope]of expected){const saved=await running.api('/results/'+key);assert.equal(saved.status,200);assert.deepEqual(saved.data.result,envelope.result);assert.equal(saved.data.cached,true);}
  assert.equal((await running.api('/games?limit=0')).status,400);assert.equal((await running.api('/games?cursor=invalid')).status,400);
  assert.equal((await running.api('/games/missing')).status,404);
 }finally{await running.app.close();}
 running=await open(db,{resultVersion:'different'});try{assert.deepEqual((await running.api('/games/'+id)).data.completedRounds,[]);assert.equal((await running.api('/results/'+expected[0][0])).status,404);}finally{await running.app.close();}
 running=await open(db+'.backup');try{assert.equal((await running.api('/games')).data.games.length,1);}finally{await running.app.close();}
});
test('старая БД заменяется пустой новой без миграции и legacy',async()=>{
 const db=location(),raw=new DatabaseSync(db);
 raw.exec(`CREATE TABLE games(id TEXT PRIMARY KEY,text TEXT NOT NULL,file_name TEXT NOT NULL,summary_json TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE results(key TEXT PRIMARY KEY,game_id TEXT,round_number INTEGER,kind TEXT,version TEXT,payload_json TEXT); CREATE TABLE jobs(id TEXT PRIMARY KEY,key TEXT,status TEXT,stats_json TEXT,error TEXT,cached INTEGER,interrupted INTEGER);PRAGMA user_version=1;`);
 const legacy=JSON.parse(text);delete legacy.playedAt;
 raw.prepare('INSERT INTO games VALUES(?,?,?,?,?)').run('legacy',JSON.stringify(legacy),'Legacy.json','{}','2026-01-01T00:00:00.000Z');
 raw.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?)').run('old','key','running','{}',null,0,0);raw.close();
 const running=await open(db);
 try{assert.equal((await fetch(running.base+'/games/legacy/source')).status,404);assert.equal((await running.api('/games')).data.games.length,0);assert.equal((await running.api('/jobs/old')).status,410);}finally{await running.app.close();}
 const check=new DatabaseSync(db,{readOnly:true});try{assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('jobs','game_aliases','migration_conflicts')").get().n,0);assert.equal(check.prepare('SELECT count(*) AS n FROM games').get().n,0);assert.equal(check.prepare('PRAGMA user_version').get().user_version,3);}finally{check.close();}
});
test('слишком большое HTTP-тело: 413 и доступность следующего запроса',async()=>{
 const running=await open(':memory:');try{assert.equal((await running.api('/import',{text:'x'.repeat(11*1024*1024)})).status,413);assert.equal((await running.api('/games')).status,200);}finally{await running.app.close();}
});
