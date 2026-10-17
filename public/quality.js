import { decisionQuality } from './impact.js';

/** @typedef {{numerator: bigint, denominator: bigint}} Fraction */
/** @typedef {{decisions:number,best:number,forced:number,equivalent:number,unavailable:number,
 * sumLoss:Fraction,maxLoss:Fraction|null,bestShare:Fraction|null,averageLoss:Fraction|null}} PlayerQuality */
const zero = () => ({ numerator: 0n, denominator: 1n });
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function reduce(numerator, denominator) {
  const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
function add(a, b) {
  const common = gcd(a.denominator, b.denominator);
  return reduce(a.numerator * (b.denominator / common) + b.numerator * (a.denominator / common),
    a.denominator * (b.denominator / common));
}
function compare(a, b) { return a.numerator * b.denominator - b.numerator * a.denominator; }
function empty() { return { decisions: 0, best: 0, forced: 0, equivalent: 0, unavailable: 0,
  sumLoss: zero(), maxLoss: null }; }
function finish(stats) {
  return { ...stats, bestShare: stats.decisions ? reduce(BigInt(stats.best), BigInt(stats.decisions)) : null,
    averageLoss: stats.decisions ? reduce(stats.sumLoss.numerator, stats.sumLoss.denominator * BigInt(stats.decisions)) : null };
}

function roundQuality(analysis, players) {
  const stats = players.map(empty);
  for (const step of analysis.steps) {
    const quality = decisionQuality(step);
    if (quality.kind === 'terminal') continue;
    const player = players.findIndex(p => p.seat === step.turn + 1);
    if (player < 0) throw new Error(`Раунд ${analysis.number}: неизвестное место ${step.turn + 1}`);
    const row = stats[player];
    if (!quality.actual) { row.unavailable++; continue; }
    if (quality.kind === 'forced') { row.forced++; continue; }
    if (quality.kind === 'equivalent') { row.equivalent++; continue; }
    row.decisions++;
    if (quality.actual.best) row.best++;
    row.sumLoss = add(row.sumLoss, quality.actual.loss);
    if (!row.maxLoss || compare(quality.actual.loss, row.maxLoss) > 0n) row.maxLoss = quality.actual.loss;
  }
  return stats.map(finish);
}

/** Aggregate completed analyses without averaging round means or counting duplicates.
 * @returns {{byRound:Array<{number:number,players:PlayerQuality[]|null,complete:boolean}>,
 * completedRounds:number,complete:boolean,players:PlayerQuality[]|null}}
 */
export function summarizePlayerQuality(analyses, players, totalRounds) {
  const latest = new Map(analyses.map(a => [a.number, a]));
  const byRound = Array.from({ length: totalRounds }, (_, index) => {
    const number = index + 1, analysis = latest.get(number);
    const values = analysis ? roundQuality(analysis, players) : null;
    return { number, players: values, complete: !!values && values.every(p => p.unavailable === 0) };
  });
  const completedRounds = byRound.filter(r => r.complete).length;
  const complete = totalRounds > 0 && completedRounds === totalRounds;
  const totals = players.map(empty);
  if (complete) for (const round of byRound) round.players.forEach((row, i) => {
    for (const key of ['decisions', 'best', 'forced', 'equivalent', 'unavailable']) totals[i][key] += row[key];
    totals[i].sumLoss = add(totals[i].sumLoss, row.sumLoss);
    if (row.maxLoss && (!totals[i].maxLoss || compare(row.maxLoss, totals[i].maxLoss) > 0n)) totals[i].maxLoss = row.maxLoss;
  });
  return { byRound, completedRounds, complete, players: complete ? totals.map(finish) : null };
}
