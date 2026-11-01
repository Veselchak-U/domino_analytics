import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Storage} from '../src/storage.js';
import {RESULT_VERSION} from '../shared/contract.js';
import {backupDatabase} from '../src/backup.js';
function directory(){const root=path.resolve('.analysis/storage-tests');mkdirSync(root,{recursive:true});return mkdtempSync(path.join(root,'client-'));}
test('SQLite: точные строки, атомарная ошибка, конфликт, backup и версия',()=>{
 const dir=directory(),db=path.join(dir,'source.sqlite'),copy=path.join(dir,'copy.sqlite');const store=new Storage(db);
 const result={leaves:'9007199254740993123456789',wins:['9007199254740993123456788','1','0'],stats:{}};
 const envelope={descriptor:{kind:'lesson',version:RESULT_VERSION},result,payloadHash:'first'};
 try{
  assert.equal(store.publish('one',envelope).created,true);assert.deepEqual(store.clientResult('one').result,result);
  assert.equal(store.publish('one',envelope).created,false);
  assert.throws(()=>store.publish('one',{...envelope,payloadHash:'different'}),e=>e.statusCode===409);
  store.db.exec("CREATE TRIGGER reject_results BEFORE INSERT ON results BEGIN SELECT RAISE(ABORT,'test full disk'); END");
  assert.throws(()=>store.publish('two',envelope));assert.equal(store.clientResult('two'),null);store.db.exec('DROP TRIGGER reject_results');
  backupDatabase(db,copy);assert.throws(()=>backupDatabase(db,copy),/уже существует/);
 }finally{store.close();}
 const recovered=new Storage(copy);try{assert.deepEqual(recovered.clientResult('one').result,result);}finally{recovered.close();}
 const raw=new DatabaseSync(db);raw.exec('PRAGMA user_version=999');raw.close();assert.throws(()=>new Storage(db),/новее/);assert.ok(readFileSync(copy).length>0);
});
test('каталог: стабильные страницы более восьми записей',()=>{
 const store=new Storage();try{
  for(let i=0;i<25;i++)store.importSource(i.toString(16).padStart(64,'0'),'{}',{rounds:[]},'Игра '+i,String(i));
  const first=store.library(20),cursor=JSON.parse(Buffer.from(first.nextCursor,'base64url').toString()),second=store.library(20,cursor);
  assert.equal(first.games.length,20);assert.equal(second.games.length,5);assert.equal(new Set([...first.games,...second.games].map(g=>g.id)).size,25);assert.equal(second.nextCursor,null);
 }finally{store.close();}
});
