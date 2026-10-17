import { applyMove, countBits, handPoints, isTerminal, legalMoves, settle, STONES, SUITS } from './game.js';

function handFacts(mask) {
  return { count: countBits(mask), points: handPoints(mask),
    doubles: STONES.reduce((n, [a, b], i) => n + (a === b && !!(mask & (1 << i)) ? 1 : 0), 0),
    coverage: SUITS.flatMap((suit, n) => mask & suit ? [n] : []) };
}
const compatible = (mask, s) => countBits(mask & ((SUITS[s.left] ?? 0) | (SUITS[s.right] ?? 0)));

/** Complete double-six deal: no stock, every unheld tile has already been played.
 * Tile counts and half counts differ for doubles. Control is possession, not a turn guarantee.
 */
export function suitProfile(position) {
  const suits = SUITS.map((mask, value) => {
    const players = position.hands.map(hand => ({ tiles: countBits(hand & mask),
      halves: STONES.reduce((n, [a, b], i) => n + (hand & (1 << i) ? Number(a === value) + Number(b === value) : 0), 0) }));
    const teams = [0, 1].map(t => ({ tiles: players[t].tiles + players[t + 2].tiles,
      halves: players[t].halves + players[t + 2].halves }));
    const remainingTiles = teams[0].tiles + teams[1].tiles, remainingHalves = teams[0].halves + teams[1].halves;
    return { value, players, teams, remainingTiles, remainingHalves, playedTiles: 7 - remainingTiles, playedHalves: 8 - remainingHalves };
  });
  const ends = position.left === null ? [] : [position.left, position.right].map(value => {
    const players = suits[value].players.flatMap((p, i) => p.tiles ? [i] : []);
    const teams = [...new Set(players.map(p => p % 2))];
    return { value, players, kind: !players.length ? 'closed' : players.length === 1 ? 'player' : teams.length === 1 ? 'team' : 'shared',
      team: teams.length === 1 ? teams[0] : null };
  });
  return { suits, ends, terminal: isTerminal(position) };
}

/** Verified local transitions, with all hands known. No probability or tactical weights.
 * Partner replies are counted AFTER each legal intervening opponent action.
 */
export function moveFacts(position, action) {
  const next = applyMove(position, action), terminal = isTerminal(next);
  const beforeProfile = suitProfile(position);
  const result = { terminal, ends: [next.left, next.right],
    profile: suitProfile(next), freshSuits: [...new Set(action.stone?.split('-').map(Number) ?? [])]
      .filter(n => beforeProfile.suits[n].playedTiles === 0),
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

/** Immediate settlement only. Keep the scoring context alongside its result for audit. */
export function terminalDecision(position, action, context) {
  const outcome = settle(applyMove(position, action), context);
  return outcome ? { before: { score: [...context.score], fence: [...context.fence], eggs: context.eggs }, outcome } : null;
}
