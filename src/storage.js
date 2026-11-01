import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { canonical, fault, RESULT_VERSION as CLIENT_VERSION, VERSION_ID } from '../shared/contract.js';
export { VERSION_ID as RESULT_VERSION } from '../shared/contract.js';
export const STORAGE_SCHEMA=3;
/** The backend owns one SQLite connection and stores only sources and compact finished results. */
export class Storage {
  constructor(filename=':memory:',version=VERSION_ID) {
    if(filename!==':memory:')mkdirSync(path.dirname(path.resolve(filename)),{recursive:true});
    this.db=new DatabaseSync(filename);this.clientVersion=version===VERSION_ID?canonical(CLIENT_VERSION):version;
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
      const schema=this.db.prepare('PRAGMA user_version').get().user_version;
      if(schema>STORAGE_SCHEMA)throw new Error('Версия БД новее приложения; используйте совместимый релиз');
      if(schema<STORAGE_SCHEMA)this.transaction(()=>{
        // Explicit project policy: replace old data, do not migrate or keep legacy tables.
        for(const name of ['client_results','results','jobs','game_aliases','migration_conflicts','library_games','games'])this.db.exec('DROP TABLE IF EXISTS '+name);
        this.db.exec(`CREATE TABLE games(id TEXT PRIMARY KEY,text TEXT NOT NULL,file_name TEXT NOT NULL,summary_json TEXT NOT NULL,created_at TEXT NOT NULL,source_hash TEXT NOT NULL);
          CREATE TABLE results(key TEXT PRIMARY KEY,game_id TEXT REFERENCES games(id),round_number INTEGER,kind TEXT NOT NULL,version TEXT NOT NULL,envelope_json TEXT NOT NULL,payload_hash TEXT NOT NULL);
          CREATE INDEX results_game ON results(game_id,version,kind,round_number);
          PRAGMA user_version=3;`);
      });
      if(schema<STORAGE_SCHEMA)this.db.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
    } catch(e) {this.db.close();throw e;}
  }
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.close();}
  libraryGame(id) {
    const row=this.db.prepare('SELECT * FROM games WHERE id=?').get(id);
    return row?{id:row.id,text:row.text,fileName:row.file_name,createdAt:row.created_at,sourceHash:row.source_hash,summary:JSON.parse(row.summary_json)}:null;
  }
  importSource(id,text,summary,fileName,sourceHash) {
    return this.transaction(()=>{
      const prior=this.libraryGame(id);
      if(prior){if(prior.sourceHash!==sourceHash)throw fault('Та же партия содержит другой журнал',409,'GAME_SOURCE_CONFLICT');return {created:false,game:prior};}
      this.db.prepare('INSERT INTO games VALUES(?,?,?,?,?,?)').run(id,text,fileName,JSON.stringify(summary),new Date().toISOString(),sourceHash);
      return {created:true,game:this.libraryGame(id)};
    });
  }
  libraryCard(game) {
    const completedRounds=this.db.prepare("SELECT round_number FROM results WHERE game_id=? AND version=? AND kind='round' ORDER BY round_number").all(game.id,this.clientVersion).map(r=>r.round_number);
    return {id:game.id,...game.summary,fileName:game.fileName,createdAt:game.createdAt,validation:'structural-only',completedRounds};
  }
  library(limit=20,cursor=null) {
    const rows=cursor?this.db.prepare('SELECT id FROM games WHERE created_at < ? OR (created_at=? AND id < ?) ORDER BY created_at DESC,id DESC LIMIT ?').all(cursor[0],cursor[0],cursor[1],limit+1):this.db.prepare('SELECT id FROM games ORDER BY created_at DESC,id DESC LIMIT ?').all(limit+1);
    const games=rows.slice(0,limit).map(r=>this.libraryCard(this.libraryGame(r.id))),last=games.at(-1);
    return {games,nextCursor:rows.length>limit?Buffer.from(JSON.stringify([last.createdAt,last.id])).toString('base64url'):null};
  }
  manifest(id,limit=20,after=0) {
    const rows=this.db.prepare("SELECT key,round_number,payload_hash FROM results WHERE game_id=? AND version=? AND kind='round' AND round_number>? ORDER BY round_number LIMIT ?").all(id,this.clientVersion,after,limit+1);
    return {analyses:rows.slice(0,limit).map(r=>({key:r.key,number:r.round_number,payloadHash:r.payload_hash,version:CLIENT_VERSION})),nextCursor:rows.length>limit?String(rows[limit-1].round_number):null};
  }
  clientResult(key) {
    const row=this.db.prepare('SELECT envelope_json FROM results WHERE key=? AND version=?').get(key,this.clientVersion);
    return row?{...JSON.parse(row.envelope_json),cached:true}:null;
  }
  insertClientResult(key,envelope) {
    const d=envelope.descriptor;
    const prior=this.db.prepare('SELECT payload_hash,envelope_json FROM results WHERE key=?').get(key);
    if(prior){if(prior.payload_hash!==envelope.payloadHash)throw fault('Другой результат для того же запроса',409,'RESULT_CONFLICT');return {created:false,envelope:JSON.parse(prior.envelope_json)};}
    this.db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?)').run(key,d.gameId??null,d.round??null,d.kind,canonical(d.version),JSON.stringify(envelope),envelope.payloadHash);
    return {created:true,envelope};
  }
  publish(key,envelope) { return this.transaction(()=>this.insertClientResult(key,envelope)); }
}
