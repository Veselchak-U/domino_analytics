import { readFileSync } from 'node:fs';
import { parseGame } from './input.js';
import { analyzeRound, gameSummary } from './analysis.js';

const [file, round = '1'] = process.argv.slice(2);
if (!file) {
  console.log('Использование: npm run analyze -- <путь.json> [номер кона | validate]');
  process.exitCode = 1;
} else {
  try {
    const game = parseGame(readFileSync(file, 'utf8'));
    if (round === 'validate') console.log(JSON.stringify(gameSummary(game), null, 2));
    else {
      if (!/^\d+$/.test(round)) throw new Error('Номер кона должен быть целым числом');
      const result = analyzeRound(game, Number(round) - 1, s => console.error(`${s.nodes.toLocaleString('ru')} позиций; ${s.elapsedMs} мс`));
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
