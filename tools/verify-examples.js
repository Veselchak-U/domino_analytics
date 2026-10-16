import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { parseGame } from '../src/input.js';

const directory = process.argv[2];
if (!directory) throw new Error('Укажите каталог out; необязательно добавьте --full для перебора каждого кона');
const full = process.argv.includes('--full');
const report = [];
function analyze(text, round) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../src/worker.js', import.meta.url), { workerData: { text, round } });
    let result, error;
    worker.on('message', m => { if (m.type === 'result') result = m.result; if (m.type === 'error') error = new Error(m.message); });
    worker.on('error', reject);
    worker.on('exit', code => error ? reject(error) : result ? resolve(result) : reject(new Error(`worker exit ${code}`)));
  });
}
for (const name of (await readdir(directory)).filter(n => n.endsWith('.json') && !n.includes('needs-review')).sort()) {
  const text = await readFile(path.join(directory, name), 'utf8');
  const entry = { name, sha256: createHash('sha256').update(text).digest('hex'), rounds: [] };
  try {
    const game = parseGame(text);
    entry.valid = true;
    console.log(`${name}: проверка ${game.rounds.length} конов OK`);
    if (full) for (const round of game.rounds) {
      const result = await analyze(text, round.number);
      entry.rounds.push({ number: round.number, ...result.base, stats: result.stats });
      console.log(`  кон ${round.number}: ${result.base.leaves} листьев, глубина ${result.base.depth}, ${result.stats.elapsedMs} мс`);
    }
  } catch (e) { entry.error = e.message; console.log(`  ОШИБКА: ${e.message}`); }
  report.push(entry);
  await writeFile('.analysis/examples-report.json', JSON.stringify(report, null, 2));
}
console.log('Отчёт: .analysis/examples-report.json');
