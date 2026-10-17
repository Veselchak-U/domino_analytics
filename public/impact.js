const units = value => Math.round(value * 10000) || 0;

/** Display extrema only for the author of this action; use actual odds for the other team. */
export function comparisonChance(step, team, kind) {
  if (!step.impact || step.impact.player % 2 !== team) {
    return { probability: step.probabilities[team], wins: step.wins[team], leaves: step.leaves };
  }
  const comparison = step[kind], move = comparison.moves[team];
  return { probability: comparison.probabilities[team], wins: move.wins[team], leaves: move.leaves };
}

/** Change in the next player's team chance from the currently selected position. */
export function alternativeImpact(step, alternative) {
  const team = step.turn % 2;
  return units(alternative.probabilities[team] - step.probabilities[team]) / 10000;
}

/** A shared baseline makes descending team win probability also descending impact. */
export function rankAlternatives(step) {
  const team = step.turn % 2;
  return step.alternatives.toSorted((a, b) => {
    const left = BigInt(a.wins[team]) * BigInt(b.leaves);
    const right = BigInt(b.wins[team]) * BigInt(a.leaves);
    return left > right ? -1 : left < right ? 1 : 0;
  });
}

/** Exact probability difference before conversion to percent or display rounding.
 * @returns {{numerator: bigint, denominator: bigint}} A fraction of one, not percent.
 */
export function probabilityDifference(left, right, team) {
  return { numerator: BigInt(left.wins[team]) * BigInt(right.leaves) - BigInt(right.wins[team]) * BigInt(left.leaves),
    denominator: BigInt(left.leaves) * BigInt(right.leaves) };
}

/** Classify the next decision using the actor's exact W/N; preserve every unique action.
 * @returns {{kind: 'terminal'|'forced'|'equivalent'|'choice', bestCount: number,
 * entries: Array<{alternative: object, best: boolean, loss: {numerator: bigint, denominator: bigint}}>, actual: object|null}}
 */
export function decisionQuality(step) {
  const ranked = rankAlternatives(step);
  const entries = ranked.map(alternative => {
    const loss = probabilityDifference(ranked[0], alternative, step.turn % 2);
    return { alternative, best: loss.numerator === 0n, loss };
  });
  const bestCount = entries.filter(entry => entry.best).length;
  const kind = !entries.length ? 'terminal' : entries.length === 1 ? 'forced'
    : bestCount === entries.length ? 'equivalent' : 'choice';
  return { kind, bestCount, entries, actual: entries.find(entry => entry.alternative.actual) ?? null };
}

/** Exact spread and first-to-second gap; null means the comparison does not exist.
 * @returns {{range: {numerator: bigint, denominator: bigint}|null, gap: {numerator: bigint, denominator: bigint}|null}}
 */
export function decisionSpread(step) {
  const ranked = rankAlternatives(step), team = step.turn % 2;
  if (!ranked.length) return { range: null, gap: null };
  return { range: probabilityDifference(ranked[0], ranked.at(-1), team),
    gap: ranked.length > 1 ? probabilityDifference(ranked[0], ranked[1], team) : null };
}

/** Independent maxima from the position before each recorded action. */
export function bestOptionsAtSteps(steps, players) {
  return optionsAtSteps(steps, players, false);
}

/** Independent minima from the same real positions as the maxima. */
export function worstOptionsAtSteps(steps, players) {
  return optionsAtSteps(steps, players, true);
}

function optionsAtSteps(steps, players, minimum) {
  return steps.map((step, index) => {
    if (!index) return { probabilities: step.probabilities.slice(0, 2), moves: [null, null], impact: null };
    const previous = steps[index - 1];
    if (!previous.alternatives.length) throw new Error(`Нет допустимых действий перед ходом ${index}`);
    const selected = [0, 1].map(team => previous.alternatives.reduce((best, candidate) => {
      const lhs = BigInt(candidate.wins[team]) * BigInt(best.leaves);
      const rhs = BigInt(best.wins[team]) * BigInt(candidate.leaves);
      return (minimum ? lhs < rhs : lhs > rhs) || (lhs === rhs && candidate.actual) ? candidate : best;
    }));
    const moves = selected.map(({ action, stone, wins, leaves, probabilities }) => ({ action, stone, wins, leaves, probabilities }));
    const player = players.findIndex(p => p.name === step.move.player);
    if (player < 0) throw new Error(`Неизвестный автор хода: ${step.move.player}`);
    const team = (players[player].seat - 1) % 2;
    return { probabilities: selected.map((move, t) => move.probabilities[t]), moves,
      impact: { player, value: units(selected[team].probabilities[team] - previous.probabilities[team]) / 10000, move: moves[team] } };
  });
}

/** Attribute each real action to its author's team; sum in integer display units. */
export function attributeImpacts(steps, players) {
  const totals = players.map(() => 0), moves = players.map(() => 0);
  const impacts = steps.map(step => {
    if (!step.move) return null;
    const player = players.findIndex(p => p.name === step.move.player);
    if (player < 0) throw new Error(`Неизвестный автор хода: ${step.move.player}`);
    const team = (players[player].seat - 1) % 2;
    const value = units(step.delta[team]);
    totals[player] += value; moves[player]++;
    return { player, value: value / 10000 };
  });
  return { impacts, players: players.map((p, player) => ({ player, name: p.name,
    team: (p.seat - 1) % 2, moves: moves[player], impact: totals[player] / 10000 })) };
}

/** Missing rounds never become an apparently complete total; last duplicate wins. */
export function aggregateImpacts(analyses, players, totalRounds) {
  const rounds = new Map(analyses.map(a => [a.number, a.playerImpacts]));
  const byRound = Array.from({ length: totalRounds }, (_, i) => ({ number: i + 1,
    values: rounds.has(i + 1) ? players.map((_, p) => rounds.get(i + 1)[p].impact) : null }));
  const completedRounds = byRound.filter(r => r.values !== null).length;
  const complete = completedRounds === totalRounds;
  const totals = players.map((_, p) => complete
    ? byRound.reduce((sum, r) => sum + units(r.values[p]), 0) / 10000 : null);
  return { byRound, completedRounds, complete, totals };
}
