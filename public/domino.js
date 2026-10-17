const canonical = stone => stone.split('-').map(Number).sort((a, b) => a - b).join('-');
const pips = [[], [[50, 50]], [[24, 24], [76, 76]], [[24, 24], [50, 50], [76, 76]],
  [[24, 24], [76, 24], [24, 76], [76, 76]],
  [[24, 24], [76, 24], [50, 50], [24, 76], [76, 76]],
  [[24, 24], [76, 24], [24, 50], [76, 50], [24, 76], [76, 76]]];
/** Every six follows the tile's physical orientation, regardless of the other half. */
export function pipCoordinates(value, vertical) {
  return value === 6 && !vertical ? [[24, 24], [50, 24], [76, 24], [24, 76], [50, 76], [76, 76]] : pips[value];
}

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
