import { parentPort, workerData } from 'node:worker_threads';
import { parseGame } from './input.js';
import { analyzeRound, analyzeBranch } from './analysis.js';

try {
  const game = parseGame(workerData.text);
  const progress = stats => parentPort.postMessage({ type: 'progress', stats });
  const branch = workerData.branch;
  const result = branch ? analyzeBranch(game, workerData.round - 1, branch.position, branch.moves, progress, branch.example)
    : analyzeRound(game, workerData.round - 1, progress);
  parentPort.postMessage({ type: 'result', result });
} catch (e) {
  parentPort.postMessage({ type: 'error', message: e.message });
}
