import { applyMove, isTerminal, legalMoves, positionKey, settle } from './game.js';

/** Memo owned by one deal and one scoring context; counters remain BigInt. */
export function createSolver(context, onProgress = () => {}, { cacheEntries = 2000000 } = {}) {
  if (!Number.isInteger(cacheEntries) || cacheEntries < 2) throw new Error('Кеш должен вмещать минимум две позиции');
  // Two generations bound memory without per-entry LRU overhead. Eviction only
  // causes recomputation: it never removes a branch from the exact search.
  const generationSize = Math.floor(cacheEntries / 2);
  let recent = new Map(), previous = new Map();
  const terminals = new Map();
  let hits = 0, nodes = 0, evicted = 0, lastReport = performance.now();
  const started = lastReport;
  function solve(s) {
    const key = positionKey(s), cached = recent.get(key) ?? previous.get(key);
    if (cached) { hits++; return cached; }
    nodes++;
    if ((nodes & 32767) === 0 && performance.now() - lastReport > 250) {
      lastReport = performance.now(); onProgress(stats());
    }
    let result;
    if (isTerminal(s)) {
      const outcome = settle(s, context), terminalKey = `${outcome.analyticsWinner}:${outcome.reason}`;
      result = terminals.get(terminalKey);
      if (!result) {
        const wins = [0n, 0n, 0n]; wins[outcome.analyticsWinner] = 1n;
        result = { leaves: 1n, wins, fish: outcome.reason === 'emptyHand' ? 0n : 1n,
          eggs: outcome.reason === 'eggs' ? 1n : 0n, depth: 0 };
        terminals.set(terminalKey, result);
      }
    } else {
      result = { leaves: 0n, wins: [0n, 0n, 0n], fish: 0n, eggs: 0n, depth: 0 };
      for (const move of legalMoves(s)) {
        const child = solve(applyMove(s, move));
        result.leaves += child.leaves;
        for (let t = 0; t < 3; t++) result.wins[t] += child.wins[t];
        result.fish += child.fish; result.eggs += child.eggs;
        result.depth = Math.max(result.depth, child.depth + 1);
      }
    }
    if (recent.size >= generationSize) {
      evicted += previous.size;
      previous = recent; recent = new Map();
    }
    recent.set(key, result);
    return result;
  }
  function stats() { return { nodes, hits, cached: recent.size + previous.size, evicted, elapsedMs: Math.round(performance.now() - started) }; }
  return { solve, stats };
}
export function percentage(numerator, denominator) {
  return Number((numerator * 1000000n + denominator / 2n) / denominator) / 10000;
}
export function summarize(result) {
  return { leaves: String(result.leaves), wins: result.wins.map(String), depth: result.depth,
    probabilities: result.wins.map(w => percentage(w, result.leaves)),
    fishProbability: percentage(result.fish, result.leaves), eggsProbability: percentage(result.eggs, result.leaves) };
}
