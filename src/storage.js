import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const RESULT_VERSION = 'rules-1.engine-1.metrics-1.schema-1';

/** Single backend-owned SQLite connection. Exact counters stay JSON strings. */
export class Storage {
  constructor(filename = ':memory:', version = RESULT_VERSION) {
    if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.version = version;
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
      const schema = this.db.prepare('PRAGMA user_version').get().user_version;
      if (schema > 1) throw new Error('Версия БД новее приложения; используйте совместимый релиз');
      if (schema === 0) this.transaction(() => this.db.exec(`
        CREATE TABLE games (id TEXT PRIMARY KEY, text TEXT NOT NULL, file_name TEXT NOT NULL,
          summary_json TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE results (key TEXT PRIMARY KEY, game_id TEXT REFERENCES games(id), round_number INTEGER,
          kind TEXT NOT NULL, version TEXT NOT NULL, payload_json TEXT NOT NULL);
        CREATE INDEX results_game ON results(game_id, version, kind, round_number);
        CREATE TABLE jobs (id TEXT PRIMARY KEY, key TEXT NOT NULL, status TEXT NOT NULL,
          stats_json TEXT, error TEXT, cached INTEGER NOT NULL DEFAULT 0, interrupted INTEGER NOT NULL DEFAULT 0);
        PRAGMA user_version=1;
      `));
      this.db.prepare("UPDATE jobs SET status='error', interrupted=1, error=? WHERE status='running'")
        .run('Расчёт прерван перезапуском бэкенда. Запустите расчёт повторно.');
    } catch (error) { this.db.close(); throw error; }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  getGame(id) {
    const row = this.db.prepare('SELECT * FROM games WHERE id=?').get(id);
    return row && { id: row.id, text: row.text, fileName: row.file_name,
      summary: JSON.parse(row.summary_json), createdAt: row.created_at };
  }
  putGame(id, text, summary, fileName) {
    this.db.prepare('INSERT OR IGNORE INTO games VALUES(?,?,?,?,?)')
      .run(id, text, fileName, JSON.stringify(summary), new Date().toISOString());
    return this.getGame(id);
  }
  card(game) {
    const completedRounds = this.db.prepare("SELECT round_number FROM results WHERE game_id=? AND version=? AND kind='round' ORDER BY round_number")
      .all(game.id, this.version).map(row => row.round_number);
    return { id: game.id, ...game.summary, fileName: game.fileName, createdAt: game.createdAt, completedRounds };
  }
  listGames(limit = 20, cursor = null) {
    const rows = cursor
      ? this.db.prepare('SELECT id FROM games WHERE created_at < ? OR (created_at=? AND id < ?) ORDER BY created_at DESC,id DESC LIMIT ?')
        .all(cursor[0], cursor[0], cursor[1], limit + 1)
      : this.db.prepare('SELECT id FROM games ORDER BY created_at DESC,id DESC LIMIT ?').all(limit + 1);
    const games = rows.slice(0, limit).map(row => this.card(this.getGame(row.id)));
    const last = games.at(-1);
    return { games, nextCursor: rows.length > limit
      ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString('base64url') : null };
  }
  analyses(id) {
    return this.db.prepare("SELECT payload_json FROM results WHERE game_id=? AND kind='round' AND version=? ORDER BY round_number")
      .all(id, this.version).map(row => JSON.parse(row.payload_json));
  }
  result(key) {
    const row = this.db.prepare('SELECT payload_json FROM results WHERE key=? AND version=?').get(key, this.version);
    return row ? JSON.parse(row.payload_json) : null;
  }
  saveJob(job) {
    this.db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?,?,?,?,?,?)')
      .run(job.id, job.key, job.status, JSON.stringify(job.stats ?? {}), job.error ?? null,
        job.cached ? 1 : 0, job.interrupted ? 1 : 0);
  }
  job(id) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if (!row) return null;
    const completed = row.status === 'done' ? this.db.prepare('SELECT payload_json,version FROM results WHERE key=?').get(row.key) : null;
    return { id: row.id, key: row.key, status: row.status, stats: JSON.parse(row.stats_json),
      error: row.error ?? undefined, cached: !!row.cached, interrupted: !!row.interrupted,
      ...(completed ? { result: JSON.parse(completed.payload_json), stale: completed.version !== this.version } : {}) };
  }
  complete(job, result, { gameId = null, round = null, kind }) {
    this.transaction(() => {
      this.db.prepare('INSERT OR REPLACE INTO results VALUES(?,?,?,?,?,?)')
        .run(job.key, gameId, round, kind, this.version, JSON.stringify(result));
      this.saveJob({ ...job, status: 'done', stats: result.stats });
    });
  }
  close() { this.db.close(); }
}
