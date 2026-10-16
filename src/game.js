/** @typedef {{hands:number[],left:number|null,right:number|null,turn:number,fisher:number,forcedStart:number|null}} Position */
export const STONES = [];
for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) STONES.push([a, b]);
export const SUITS = Array.from({ length: 7 }, (_, n) => STONES.reduce((m, [a, b], i) => m | (a === n || b === n ? 1 << i : 0), 0));
const IDS = new Map(STONES.map(([a, b], i) => [`${a}-${b}`, i]));

export function stoneId(stone) {
  if (typeof stone !== 'string' || !/^[0-6]-[0-6]$/.test(stone)) throw new Error(`Неверный камень: ${stone}`);
  const [a, b] = stone.split('-').map(Number);
  return IDS.get(`${Math.min(a, b)}-${Math.max(a, b)}`);
}
export function maskOf(stones) {
  let mask = 0;
  for (const stone of stones) {
    const bit = 1 << stoneId(stone);
    if (mask & bit) throw new Error(`Повтор камня ${stone}`);
    mask |= bit;
  }
  return mask;
}
export function countBits(mask) {
  let count = 0;
  for (; mask; mask &= mask - 1) count++;
  return count;
}
export function stonesOf(mask) {
  const stones = [];
  for (let i = 0; i < 28; i++) if (mask & (1 << i)) stones.push(STONES[i].join('-'));
  return stones;
}
export function handPoints(mask) {
  if (mask === 1) return 10;
  let points = 0;
  for (; mask; mask &= mask - 1) {
    const i = 31 - Math.clz32(mask & -mask);
    points += STONES[i][0] + STONES[i][1];
  }
  return points;
}
export function teamRemainders(hands) {
  return [handPoints(hands[0]) + handPoints(hands[2]), handPoints(hands[1]) + handPoints(hands[3])];
}
/** Exact within one deal: each remaining tile has a fixed owner. */
export function positionKey(s) {
  const mask = s.hands[0] | s.hands[1] | s.hands[2] | s.hands[3];
  const lo = s.left === null ? 7 : Math.min(s.left, s.right);
  const hi = s.right === null ? 7 : Math.max(s.left, s.right);
  return (((mask * 64 + lo * 8 + hi) * 4 + s.turn) * 5 + s.fisher + 1);
}
export function isTerminal(s) {
  if (s.hands.some(h => h === 0)) return true;
  if (s.left === null) return false;
  const remaining = s.hands[0] | s.hands[1] | s.hands[2] | s.hands[3];
  return !(remaining & (SUITS[s.left] | SUITS[s.right]));
}
/** Equivalent children, including mirrored chains, appear once. */
export function legalMoves(s) {
  if (isTerminal(s)) return [];
  const moves = [], seen = new Set();
  for (let bits = s.hands[s.turn]; bits; bits &= bits - 1) {
    const i = 31 - Math.clz32(bits & -bits), [a, b] = STONES[i];
    if (s.left === null) {
      if (s.forcedStart === null || s.forcedStart === i) moves.push({ action: 'start', stone: `${a}-${b}` });
      continue;
    }
    for (const action of ['left', 'right']) {
      const end = action === 'left' ? s.left : s.right;
      if (a !== end && b !== end) continue;
      const other = a === end ? b : a;
      const lo = Math.min(other, action === 'left' ? s.right : s.left);
      const hi = Math.max(other, action === 'left' ? s.right : s.left);
      const key = i * 64 + lo * 8 + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      moves.push({ action, stone: action === 'left' ? `${other}-${end}` : `${end}-${other}` });
    }
  }
  return moves.length ? moves : [{ action: 'pass' }];
}
/** Strict replay never silently flips a recorded tile. */
export function applyMove(s, move) {
  if (isTerminal(s)) throw new Error('Ход после завершения кона');
  const next = { ...s, hands: [...s.hands], turn: (s.turn + 1) % 4, forcedStart: null };
  if (move.action === 'pass') {
    if (s.left === null || (s.hands[s.turn] & (SUITS[s.left] | SUITS[s.right]))) throw new Error('Пропуск запрещён: есть допустимый камень');
    return next;
  }
  const id = stoneId(move.stone);
  if (!(s.hands[s.turn] & (1 << id))) throw new Error(`Камня ${move.stone} нет в руке`);
  const [a, b] = move.stone.split('-').map(Number);
  if (s.left === null) {
    if (move.action !== 'start') throw new Error('Первым действием должен быть заход');
    if (s.forcedStart !== null && id !== s.forcedStart) throw new Error('Обязателен заход с 1-1');
    next.left = a; next.right = b;
  } else if (move.action === 'left' && b === s.left) next.left = a;
  else if (move.action === 'right' && a === s.right) next.right = b;
  else throw new Error('Неверный конец или ориентация камня');
  next.hands[s.turn] ^= 1 << id;
  if (a !== b) next.fisher = s.turn;
  return next;
}
/** 0/1: winner, 2: final draw, null: game continues. */
export function gameWinner(score, limit) {
  const [a, b] = score;
  if (a < limit && b < limit) return null;
  if (a >= limit && b >= limit && a === b) return 2;
  if (a >= limit && b < limit) return 1;
  if (b >= limit && a < limit) return 0;
  return a > b ? 1 : 0;
}
/** Original scoring and the independently defined analytical winner. */
export function settle(s, context) {
  if (!isTerminal(s)) return null;
  const empty = s.hands.findIndex(h => h === 0), residual = teamRemainders(s.hands);
  const fish = empty < 0;
  let winnerTeam = empty >= 0 ? empty % 2 : null;
  let reason = fish ? 'fish' : 'emptyHand';
  if (fish && context.fishVariant === 'withEggs') {
    if (residual[0] === residual[1]) reason = 'eggs';
    else winnerTeam = residual[0] < residual[1] ? 0 : 1;
  }
  const score = [...context.score], fence = [...context.fence], roundScore = [0, 0];
  let eggs = context.eggs;
  if (reason === 'eggs') eggs += residual[0] + residual[1];
  else {
    for (let t = 0; t < 2; t++) {
      if (t === winnerTeam) { fence[t] = 0; continue; }
      roundScore[t] = residual[t] + eggs;
      if (score[t] > 0 || residual[t] >= 13) {
        score[t] += fence[t] + roundScore[t]; fence[t] = 0;
      } else fence[t] += roundScore[t];
    }
    eggs = 0;
  }
  const finishedPlayer = fish ? s.fisher : empty;
  if (finishedPlayer < 0) throw new Error('Невозможно определить рыбака');
  const finalWinner = gameWinner(score, context.scoreLimit);
  const analyticsWinner = fish ? (finalWinner ?? finishedPlayer % 2) : winnerTeam;
  return { reason, finishedPlayer, winnerTeam, residual, roundScore, totalScore: score,
    fence, eggs, gameWinner: finalWinner, analyticsWinner };
}
