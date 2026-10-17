import { applyMove, countBits, handPoints, legalMoves, positionKey, stonesOf } from './game.js';
import { createSolver, summarize } from './solver.js';
import { attributeImpacts, bestOptionsAtSteps, worstOptionsAtSteps } from '../public/impact.js';
import { moveFacts, suitProfile, terminalDecision } from './facts.js';

export function gameSummary(game) {
  return { teams: game.teams, players: game.players, fishVariant: game.fishVariant,
    scoreLimit: game.scoreLimit, result: game.result,
    rounds: game.rounds.map(r => ({ number: r.number, moves: r.history.length - 1,
      reason: r.outcome.reason, analyticsWinner: r.outcome.analyticsWinner,
      finishedPlayer: game.players[r.outcome.finishedPlayer].name,
      score: r.outcome.totalScore, context: r.context })) };
}

/** Analyze the whole round first, then reuse its memo for every recorded prefix. */
export function analyzeRound(game, roundIndex, onProgress) {
  const round = game.rounds[roundIndex];
  if (!round) throw new Error('Такого раунда нет');
  const solver = createSolver(round.context, onProgress);
  const base = summarize(solver.solve(round.history[0].state));
  let previous = base.probabilities;
  const steps = round.history.map(({ state, chain, move }, index) => {
    const result = summarize(solver.solve(state));
    const nextRecorded = round.history[index + 1];
    const alternatives = legalMoves(state).map(action => {
      const next = applyMove(state, action);
      return { ...action, ...summarize(solver.solve(next)), facts: moveFacts(state, action),
        settlement: terminalDecision(state, action, round.context),
        actual: !!nextRecorded && positionKey(next) === positionKey(nextRecorded.state) };
    });
    const hands = state.hands.map(stonesOf);
    const counts = state.hands.map(countBits), points = state.hands.map(handPoints);
    const delta = result.probabilities.map((p, t) => +(p - previous[t]).toFixed(4));
    previous = result.probabilities;
    return { index, move, chain, hands, suits: suitProfile(state), turn: state.turn, fisher: state.fisher,
      ends: state.left === null ? [] : [state.left, state.right], ...result, delta,
      counts: [counts[0] + counts[2], counts[1] + counts[3]],
      points: [points[0] + points[2], points[1] + points[3]],
      alternatives, terminal: alternatives.length === 0 };
  });
  const attributed = attributeImpacts(steps, game.players);
  const best = bestOptionsAtSteps(steps, game.players);
  const worst = worstOptionsAtSteps(steps, game.players);
  steps.forEach((step, i) => { step.impact = attributed.impacts[i]; step.best = best[i]; step.worst = worst[i]; });
  return { number: round.number, teams: game.teams, players: game.players, playerImpacts: attributed.players,
    context: round.context, outcome: round.outcome, recorded: round.recorded,
    base, steps, stats: solver.stats() };
}
