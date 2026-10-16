import { parentPort, workerData } from 'node:worker_threads';
import { parseGame } from './input.js';
import { analyzeRound } from './analysis.js';

try {
  const game = parseGame(workerData.text);
  const result = analyzeRound(game, workerData.round - 1, stats => parentPort.postMessage({ type: 'progress', stats }));
  parentPort.postMessage({ type: 'result', result });
} catch (e) {
  parentPort.postMessage({ type: 'error', message: e.message });
}
