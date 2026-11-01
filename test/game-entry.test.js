import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from './helpers/fixtures.js';
import { createEntry, appendEntryMove, undoEntryMove, entryPosition, setRemainders, confirmEntryRound, nextEntryRound, exportEntry, importEntry, entryFileName, moveSuggestions } from '../shared/game-entry.js';
import { parseGame } from '../shared/input.js';
import { validateSource, sourceDigest } from '../shared/contract.js';
import { stoneId } from '../shared/game.js';
import { createApp } from '../src/server.js';

const full=JSON.parse(readFileSync(new URL('../contracts/kozel-game.example.json',import.meta.url),'utf8'));
const {rounds,result,...header}=full;
const players=full.teams.flatMap(t=>t.players).sort((a,b)=>a.seat-b.seat);
function recordRound(entry,round){
  for(const move of round.moves)entry=appendEntryMove(entry,move);
  assert.ok(entryPosition(entry).terminal);
  const remaining=players.map(p=>round.deal[p.name].filter(s=>!round.moves.some(m=>m.player===p.name&&m.stone&&stoneId(m.stone)===stoneId(s))));
  return confirmEntryRound(setRemainders(entry,remaining));
}
test('редактор восстанавливает все раунды, раздачи и результат без начальных рук',()=>{
  let entry=createEntry(header);const snapshot=structuredClone(entry);
  assert.throws(()=>exportEntry(entry),/завершённ.*раунд/i);
  for(let i=0;i<rounds.length;i++){
    entry=recordRound(entry,rounds[i]);
    assert.deepEqual(entry.document.rounds[i],rounds[i]);
    assert.deepEqual(entry.document.teams,header.teams);assert.equal(entry.document.playedAt,header.playedAt);
    if(i<rounds.length-1){
      assert.equal(entry.document.status,'incomplete');
      const text=exportEntry(entry);assert.ok(entryFileName(entry).endsWith('_incomplete.json'));
      assert.equal(parseGame(text,{allowIncomplete:true}).rounds.length,i+1);
      assert.throws(()=>validateSource(text),e=>e.code==='INCOMPLETE_GAME');
      entry=importEntry(text);
    }
  }
  assert.equal(entry.document.status,'complete');assert.deepEqual(entry.document.result,result);
  assert.deepEqual(parseGame(exportEntry(entry)).result,result);
  assert.throws(()=>nextEntryRound(entry),/завершена/);
  assert.throws(()=>importEntry(exportEntry(entry)),/незавершённ/);
  assert.deepEqual(snapshot,createEntry(header));
});
test('подсказки, очередь, ориентация, повтор и отмена не меняют прежнюю запись',()=>{
  let entry=createEntry(header);const actor=players[0].name;
  assert.deepEqual(moveSuggestions(entry,actor).map(m=>m.stone),['1-1']);
  assert.throws(()=>appendEntryMove(entry,{player:actor,action:'start',stone:'2-2'}),/1-1/);
  entry=appendEntryMove(entry,{player:actor,action:'start',stone:'1-1'});
  assert.throws(()=>exportEntry(entry),/текущ.*раунд/i);
  assert.throws(()=>appendEntryMove(entry,{player:actor,action:'pass'}),/очеред/);
  assert.throws(()=>appendEntryMove(entry,{player:players[1].name,action:'left',stone:'1-1'}),/повтор|сыгран/i);
  assert.throws(()=>appendEntryMove(entry,{player:players[1].name,action:'left',stone:'1-5'}),/ориентац|край|конец/i);
  assert.equal(undoEntryMove(entry).active.moves.length,0);assert.equal(entry.active.moves.length,1);
});
test('последующие действия не могут опровергать ранее записанный пас',()=>{
  let e=createEntry(header);const names=players.map(p=>p.name);
  for(const [p,action,stone] of [[0,'start','1-1'],[1,'left','0-1'],[2,'pass'],[3,'left','2-0'],[0,'left','3-2'],[1,'right','1-4']])e=appendEntryMove(e,{player:names[p],action,...(stone?{stone}:{})});
  assert.throws(()=>appendEntryMove(e,{player:names[2],action:'left',stone:'0-3'}),/пас/);
});
test('явный complete равен отсутствию статуса, incomplete не обходит сервер',async()=>{
  assert.equal(await sourceDigest(full),await sourceDigest({...full,status:'complete'}));
  const incomplete={...full,status:'incomplete',rounds:[rounds[0]]};delete incomplete.result;
  const app=createApp();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  try{
    const res=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/v1/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:JSON.stringify(incomplete),name:'complete.json'})});
    assert.equal(res.status,400);assert.equal((await res.json()).code,'INCOMPLETE_GAME');
    const library=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/v1/games').then(r=>r.json());assert.equal(library.games.length,0);
    const url='http://127.0.0.1:'+app.server.address().port+'/api/v1/import';
    const send=d=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:JSON.stringify(d)})});
    const original=await send(full);assert.equal(original.status,201);const id=(await original.json()).id;
    const duplicate=await send({...full,status:'complete'});assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).id,id);
  }finally{await app.close();}
  assert.throws(()=>parseGame(JSON.stringify({...incomplete,result})),/схем/);
  for(const invalid of [{...full,status:'draft'},{...full,result:undefined},{...incomplete,result:null},{...incomplete,rounds:[]}])assert.throws(()=>importEntry(JSON.stringify(invalid)),/схем/);
  assert.throws(()=>parseGame(JSON.stringify({...full,status:'incomplete',result:undefined}),{allowIncomplete:true}),/завершена/);
  const broken=structuredClone(incomplete);broken.rounds[0].moves.pop();assert.throws(()=>importEntry(JSON.stringify(broken)),/раунд|заверш|результат/i);
});

test('заход withoutEggs со второго раунда свободный даже при нулевой записи',async()=>{
  const {forcedOpening}=await import('../shared/game.js');
  assert.equal(forcedOpening({fishVariant:'withoutEggs',score:[0,0]},1),stoneId('1-1'));
  assert.equal(forcedOpening({fishVariant:'withoutEggs',score:[0,0]},2),null);
  assert.equal(forcedOpening({fishVariant:'withEggs',score:[0,0]},2),stoneId('1-1'));
  assert.equal(forcedOpening({fishVariant:'withEggs',score:[13,0]},2),null);
});

test('оставшийся дубль не завершает раунд; неверные остатки не меняют ввод',()=>{
  let e=createEntry(header);
  for(const m of rounds[0].moves.slice(0,-1))e=appendEntryMove(e,m);
  assert.equal(entryPosition(e).terminal,false);
  assert.ok(moveSuggestions(e,players[2].name).some(m=>m.stone==='2-2'));
  assert.throws(()=>confirmEntryRound(e),/не завершён/);
  e=appendEntryMove(e,rounds[0].moves.at(-1));
  assert.throws(()=>appendEntryMove(e,{player:players[3].name,action:'pass'}),/завершения/);
  assert.throws(()=>confirmEntryRound(e),/остатки/);
  const snapshot=structuredClone(e);
  assert.throws(()=>setRemainders(e,[['0-0'],['0-0'],[],[]]),/нескольких/);
  assert.throws(()=>setRemainders(e,[['1-1'],[],[],[]]),/сыгран/);
  assert.throws(()=>setRemainders(e,[['0-0','0-3','0-4'],[],[],[]]),/размер/);
  assert.deepEqual(e,snapshot);
});

test('полная проверка остатков запрещает пересдачу и противоречие пасу',()=>{
  let e=recordRound(createEntry(header),rounds[0]);e=nextEntryRound(e);
  for(const m of rounds[1].moves)e=appendEntryMove(e,m);
  assert.throws(()=>setRemainders(e,[['0-0'],[],[],[]]),/пас/);
  const closed=recordRound(importEntry(exportEntry(recordRound(createEntry(header),rounds[0]))),rounds[1]);
  let terminal=nextEntryRound(closed);
  for(const m of rounds[2].moves)terminal=appendEntryMove(terminal,m);
  const p=entryPosition(terminal),pool=Array.from({length:7},(_,a)=>Array.from({length:7-a},(_,i)=>`${a}-${a+i}`)).flat().filter(s=>!(p.played&(1<<stoneId(s))));
  const five=['0-0','1-1','4-4','5-5','6-6'];const rest=pool.filter(s=>!five.includes(s));
  const invalid=setRemainders(terminal,[rest.slice(0,4),rest.slice(4,8),five,rest.slice(8)]);
  assert.throws(()=>confirmEntryRound(invalid),/пересдач/);
  assert.equal(invalid.active.moves.length,rounds[2].moves.length);
});

test('нулевая запись и забор: заход второго раунда зависит от варианта',()=>{
  const deal=[['1-3','5-6','2-4','3-4','0-6','2-2','2-3'],['2-5','0-5','1-2','1-6','5-5','0-3','1-1'],['0-1','4-4','6-6','1-5','4-6','4-5','3-5'],['0-0','3-3','0-4','0-2','3-6','1-4','2-6']];
  const moves=[[1,'start','1-1'],[2,'left','0-1'],[3,'left','0-0'],[0,'right','1-3'],[1,'left','3-0'],[2,'left','5-3'],[3,'right','3-3'],[0,'right','3-2'],[1,'left','2-5'],[2,'pass'],[3,'left','6-2'],[0,'left','0-6'],[1,'right','2-1'],[2,'right','1-5'],[3,'left','4-0'],[0,'left','3-4'],[1,'right','5-0'],[2,'pass'],[3,'left','6-3'],[0,'left','5-6'],[1,'left','5-5'],[2,'left','4-5'],[3,'right','0-2'],[0,'left','2-4'],[1,'pass'],[2,'pass'],[3,'pass'],[0,'left','2-2']].map(([p,action,stone])=>({player:players[p].name,action,...(stone?{stone}:{})}));
  const r={number:1,deal:Object.fromEntries(players.map((p,i)=>[p.name,deal[i]])),moves};
  for(const fishVariant of ['withoutEggs','withEggs']){
    let e=recordRound(createEntry({...header,fishVariant}),r);
    assert.deepEqual(e.document.rounds[0].result.total_score,{'Север':0,'Юг':0});
    assert.deepEqual(e.document.rounds[0].result.fence,{'Юг':12});
    e=importEntry(exportEntry(e));
    if(fishVariant==='withoutEggs'){
      assert.equal(entryPosition(e).turn,0);
      assert.ok(moveSuggestions(e,players[0].name).some(m=>m.stone==='3-4'));
      assert.equal(appendEntryMove(e,{player:players[0].name,action:'start',stone:'3-4'}).active.moves.length,1);
      assert.throws(()=>appendEntryMove(e,{player:players[1].name,action:'start',stone:'3-4'}),/очеред/);
    }else{
      assert.equal(entryPosition(e).turn,null);
      assert.deepEqual(moveSuggestions(e,players[1].name).map(m=>m.stone),['1-1']);
      assert.throws(()=>appendEntryMove(e,{player:players[0].name,action:'start',stone:'3-4'}),/1-1/);
    }
  }
});
