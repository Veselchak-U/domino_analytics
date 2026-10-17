import { applyMove, countBits, handPoints, isTerminal, legalMoves, STONES, SUITS } from './game.js';

function handFacts(mask) {
  return { count: countBits(mask), points: handPoints(mask),
    doubles: STONES.reduce((n, [a, b], i) => n + (a === b && !!(mask & (1 << i)) ? 1 : 0), 0),
    coverage: SUITS.flatMap((suit, n) => mask & suit ? [n] : []) };
}
const compatible = (mask, s) => countBits(mask & ((SUITS[s.left] ?? 0) | (SUITS[s.right] ?? 0)));

/** Verified local transitions, with all hands known. No probability or tactical weights.
 * Partner replies are counted AFTER each legal intervening opponent action.
 */
export function moveFacts(position, action) {
  const next = applyMove(position, action), terminal = isTerminal(next);
  const result = { terminal, ends: [next.left, next.right],
    before: position.hands.map(handFacts), after: next.hands.map(handFacts),
    actorCompatible: compatible(next.hands[position.turn], next), next: null, partner: null };
  if (terminal) return result;
  const moves = legalMoves(next), partner = (position.turn + 2) % 4;
  result.next = { player: next.turn, choices: moves.filter(m => m.action !== 'pass').length,
    forcedPass: moves.length === 1 && moves[0].action === 'pass' };
  result.partner = { player: partner, compatible: compatible(next.hands[partner], next),
    branches: moves.length, replies: 0, ended: 0 };
  for (const reply of moves) {
    const later = applyMove(next, reply);
    if (isTerminal(later)) result.partner.ended++;
    else if (legalMoves(later).some(m => m.action !== 'pass')) result.partner.replies++;
  }
  return result;
}
