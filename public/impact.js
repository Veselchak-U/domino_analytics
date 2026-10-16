const units = value => Math.round(value * 10000) || 0;

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
