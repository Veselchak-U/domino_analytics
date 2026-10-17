const canonical = stone => stone.split('-').map(Number).sort((a, b) => a - b).join('-');

/** Team of each chain tile, from the four seat-ordered initial hands.
 * Ownership is fixed throughout a round, including reverse orientation and passes.
 * @param {string[]} chain
 * @param {string[][]} initialHands
 * @returns {number[]} 0 for seats 1/3, 1 for seats 2/4.
 */
export function chainTeams(chain, initialHands) {
  const owners = new Map();
  initialHands.forEach((hand, player) => hand.forEach(stone => {
    const key = canonical(stone);
    if (owners.has(key)) throw new Error(`Неоднозначный владелец камня ${stone}`);
    owners.set(key, player % 2);
  }));
  return chain.map(stone => {
    const team = owners.get(canonical(stone));
    if (team === undefined) throw new Error(`Не найден владелец камня ${stone}`);
    return team;
  });
}
