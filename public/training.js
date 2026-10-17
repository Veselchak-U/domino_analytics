import { decisionQuality } from './impact.js';

/** Projection for a question: intentionally excludes scores, facts, ranking and recorded choice. */
export function trainingQuestion(step) {
  if (!step.alternatives.length) throw new Error('Раунд завершён: упражнение недоступно');
  return { turn: step.turn, chain: [...step.chain], ends: [...step.ends], hands: step.hands.map(h => [...h]),
    choices: step.alternatives.map(({ action, stone }) => ({ action, ...(stone ? { stone } : {}) })) };
}
/** Verify the complete legal action, including the selected end, using exact W/N. */
export function gradeTrainingChoice(step, choice) {
  const quality = decisionQuality(step);
  const entry = quality.entries.find(e => e.alternative.action === choice.action && e.alternative.stone === choice.stone);
  if (!entry) throw new Error('Выберите допустимый камень и край');
  return { kind: quality.kind, best: entry.best, loss: entry.loss };
}
export function trainingTopics(step) {
  const actor = step.turn, alternatives = step.alternatives;
  return {
    pass: alternatives.some(a => a.action === 'pass' || a.facts?.next?.forcedPass),
    control: alternatives.some(a => a.facts?.profile?.ends.some(e => e.team === actor % 2)),
    exit: alternatives.some(a => a.facts?.after[actor]?.count <= 1),
    block: alternatives.some(a => (a.settlement && a.settlement.outcome.reason !== 'emptyHand')
      || a.facts?.profile?.ends.some(e => e.kind === 'closed')),
  };
}
export function trainingPositions(analysis, topic = 'all') {
  return analysis.steps.flatMap((s, i) => s.alternatives.length && (topic === 'all' || trainingTopics(s)[topic]) ? [i] : []);
}
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
/** One submitted answer per question id; quality denominator excludes forced and equivalent choices. */
export function trainingProgress(attempts) {
  const unique = [...new Map(attempts.map(a => [a.id, a])).values()];
  const choices = unique.filter(a => a.kind === 'choice');
  let numerator = 0n, denominator = 1n;
  for (const a of choices) {
    numerator = numerator * a.loss.denominator + a.loss.numerator * denominator;
    denominator *= a.loss.denominator;
    const divisor = gcd(numerator, denominator); numerator /= divisor; denominator /= divisor;
  }
  const best = choices.filter(a => a.best).length;
  return { attempts: unique.length, decisions: choices.length, best,
    forced: unique.filter(a => a.kind === 'forced').length, equivalent: unique.filter(a => a.kind === 'equivalent').length,
    bestShare: choices.length ? { numerator: BigInt(best), denominator: BigInt(choices.length) } : null,
    averageLoss: choices.length ? { numerator, denominator: denominator * BigInt(choices.length) } : null };
}
