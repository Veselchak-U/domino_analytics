import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Consistent snapshot, including committed WAL pages, without modifying source. */
export function backupDatabase(source, destination) {
  const output = path.resolve(destination);
  if (existsSync(output)) throw new Error('Файл резервной копии уже существует');
  mkdirSync(path.dirname(output), { recursive: true });
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    database.exec('PRAGMA busy_timeout=5000');
    database.prepare('VACUUM INTO ?').run(output);
  } finally { database.close(); }
  const copy = new DatabaseSync(output, { readOnly: true });
  try {
    const integrity = copy.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error('Проверка целостности резервной копии не пройдена');
  } finally { copy.close(); }
  return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error('Укажите путь резервной копии');
    console.log(backupDatabase(process.env.DATABASE_PATH ?? '.analysis/domino.sqlite', process.argv[2]));
  } catch (error) { console.error(`Не удалось создать резервную копию: ${error.message}`); process.exitCode = 1; }
}
