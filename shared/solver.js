import { applyMove, isTerminal, legalMoves, positionKey, settle } from './game.js';

// Approximate owned storage, not process heap usage. V8 layouts may differ.
const entryBytes = key => 48 + (typeof key === 'number' ? 16 : 24 + Math.ceil(key.length * 2 / 8) * 8);
const resultBytes = result => 80 + 48 + 96 + 15 * (16 + Math.ceil(result.leaves.toString(16).length / 16) * 8);
const endings = ['emptyHand', 'fish', 'eggs'];

/** Memo owned by one deal and one scoring context; counters remain BigInt. */
export function createSolver(context, onProgress = () => {}, { cacheEntries = 2000000 } = {}) {
  if (!Number.isInteger(cacheEntries) || cacheEntries < 2) throw new Error('Кеш должен вмещать минимум две позиции');
  // Two generations bound memory without per-entry LRU overhead. Eviction only
  // causes recomputation: it never removes a branch from the exact search.
  const generationSize = Math.floor(cacheEntries / 2);
  let recent = new Map(), previous = new Map();
  const terminals = new Map();
  let recentBytes = 0, previousBytes = 0, terminalBytes = 0;
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
          eggs: outcome.reason === 'eggs' ? 1n : 0n, outcomes: Array(9).fill(0n), minDepth: 0, depth: 0 };
        result.outcomes[endings.indexOf(outcome.reason) * 3 + outcome.analyticsWinner] = 1n;
        terminals.set(terminalKey, result);
        terminalBytes += entryBytes(terminalKey) + resultBytes(result);
      }
    } else {
      result = { leaves: 0n, wins: [0n, 0n, 0n], fish: 0n, eggs: 0n, outcomes: Array(9).fill(0n), minDepth: Infinity, depth: 0 };
      for (const move of legalMoves(s)) {
        const child = solve(applyMove(s, move));
        result.leaves += child.leaves;
        for (let t = 0; t < 3; t++) result.wins[t] += child.wins[t];
        for (let i = 0; i < 9; i++) result.outcomes[i] += child.outcomes[i];
        result.fish += child.fish; result.eggs += child.eggs;
        result.depth = Math.max(result.depth, child.depth + 1);
        result.minDepth = Math.min(result.minDepth, child.minDepth + 1);
      }
    }
    if (recent.size >= generationSize) {
      evicted += previous.size;
      previous = recent; recent = new Map();
      previousBytes = recentBytes; recentBytes = 0;
    }
    recent.set(key, result);
    recentBytes += entryBytes(key) + (result.depth === 0 ? 0 : resultBytes(result));
    return result;
  }
  function stats() { return { nodes, hits, cached: recent.size + previous.size, evicted,
    cacheBytesEstimate: recentBytes + previousBytes + terminalBytes,
    elapsedMs: Math.round(performance.now() - started) }; }
  return { solve, stats };
}
export function percentage(numerator, denominator) {
  return Number((numerator * 1000000n + denominator / 2n) / denominator) / 10000;
}
export function summarize(result) {
  assertOutcomeCounts(result);
  return { leaves: String(result.leaves), wins: result.wins.map(String), minDepth: result.minDepth, depth: result.depth,
    fish: String(result.fish), eggs: String(result.eggs),
    outcomes: Object.fromEntries(endings.map((reason, i) => [reason, result.outcomes.slice(i * 3, i * 3 + 3).map(String)])),
    probabilities: result.wins.map(w => percentage(w, result.leaves)),
    fishProbability: percentage(result.fish, result.leaves), eggsProbability: percentage(result.eggs, result.leaves) };
}

/** Validate exact cross counts at the serialization boundary, without burdening every search node. */
export function assertOutcomeCounts(result) {
  const counts = result.outcomes;
  const fail = () => { throw new Error('Несогласованный состав исходов solver'); };
  if (!Array.isArray(counts) || counts.length !== 9 || counts.some(n => typeof n !== 'bigint' || n < 0n)) fail();
  const sum = values => values.reduce((n, v) => n + v, 0n);
  if (sum(counts) !== result.leaves || sum(counts.slice(3)) !== result.fish || sum(counts.slice(6)) !== result.eggs) fail();
  for (let t = 0; t < 3; t++) if (counts[t] + counts[t + 3] + counts[t + 6] !== result.wins[t]) fail();
}
