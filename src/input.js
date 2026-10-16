import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import { applyMove, countBits, maskOf, settle, stoneId, SUITS, STONES } from './game.js';

const schema = JSON.parse(readFileSync(new URL('../contracts/kozel-game.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);

/** JSON.parse checks grammar; this separate lexical pass rejects duplicate decoded keys. */
export function strictJson(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`Неверный JSON: ${e.message}`); }
  let i = 0;
  const space = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') i += 2;
      else if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
  }
  function visit(depth) {
    if (depth > 64) throw new Error('JSON слишком глубоко вложен (максимум 64)');
    space();
    if (text[i] === '{') {
      i++; space();
      const keys = new Set();
      while (text[i] !== '}') {
        const key = string();
        if (keys.has(key)) throw new Error(`Повтор ключа JSON «${key}» возле позиции ${i}`);
        keys.add(key); space(); i++; visit(depth + 1); space();
        if (text[i] === ',') { i++; space(); } else break;
      }
      i++;
    } else if (text[i] === '[') {
      i++; space();
      while (text[i] !== ']') {
        visit(depth + 1); space();
        if (text[i] === ',') { i++; space(); } else break;
      }
      i++;
    } else if (text[i] === '"') string();
    else {
      const start = i;
      while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
      const token = text.slice(start, i);
      if (!['null', 'true', 'false'].includes(token) && !Number.isSafeInteger(Number(token)))
        throw new Error(`Число вне точного целочисленного диапазона: ${token}`);
    }
  }
  visit(0);
  return data;
}

function keysMatch(value, names) {
  return isDeepStrictEqual(Object.keys(value).sort(), [...names].sort());
}
function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Повтор: ${label}`);
}

export function recordedResult(outcome, players, teams) {
  const named = values => Object.fromEntries(teams.map((name, t) => [name, values[t]]));
  const result = { reason: outcome.reason, finished_player: players[outcome.finishedPlayer].name,
    winner_team: outcome.winnerTeam === null ? null : teams[outcome.winnerTeam],
    round_score: named(outcome.roundScore), total_score: named(outcome.totalScore) };
  if (outcome.fence.some(Boolean)) result.fence = Object.fromEntries(teams.flatMap((name, t) => outcome.fence[t] ? [[name, outcome.fence[t]]] : []));
  if (outcome.eggs) result.eggs = outcome.eggs;
  return result;
}

/** Validate the entire completed game before making any analysis available. */
export function parseGame(text) {
  const data = strictJson(text);
  if (!validate(data)) {
    const errors = validate.errors.slice(0, 4).map(e => `${e.instancePath || '/'}: ${e.message}`).join('; ');
    throw new Error(`Ошибка схемы JSON: ${errors}`);
  }
  unique(data.teams.map(t => t.name), 'имена команд');
  unique(data.teams.map(t => t.id), 'ID команд');
  const players = data.teams.flatMap(t => t.players.map(p => ({ ...p, teamName: t.name }))).sort((a, b) => a.seat - b.seat);
  unique(players.map(p => p.name), 'имена игроков'); unique(players.map(p => p.seat), 'места игроков');
  if (players[0].teamName !== players[2].teamName || players[1].teamName !== players[3].teamName)
    throw new Error('Партнёры должны сидеть напротив: места 1/3 и 2/4');
  const teams = [players[0].teamName, players[1].teamName];
  const names = players.map(p => p.name), rounds = [];
  let context = { fishVariant: data.fishVariant, scoreLimit: data.scoreLimit, score: [0, 0], fence: [0, 0], eggs: 0 };
  let previous = null;
  for (const [index, round] of data.rounds.entries()) {
    const prefix = `Кон ${index + 1}`;
    try {
      if (previous && previous.gameWinner !== null) throw new Error('Партия уже завершена предыдущим коном');
      if (round.number !== index + 1) throw new Error('Нарушена последовательность номеров конов');
      if (!keysMatch(round.deal, names)) throw new Error('Имена раздачи не совпадают с игроками');
      const hands = names.map(n => maskOf(round.deal[n]));
      if (hands.reduce((m, h) => m | h, 0) !== 2 ** 28 - 1) throw new Error('Раздача должна содержать все 28 разных камней');
      const doubles = STONES.reduce((mask, [a, b], i) => mask | (a === b ? 1 << i : 0), 0);
      for (const [p, hand] of hands.entries()) {
        if (countBits(hand & doubles) >= 5 || SUITS.some(s => countBits(hand & s) >= 6))
          throw new Error(`Раздача ${names[p]} требует пересдачи`);
      }
      const forcedStart = context.score.every(s => s === 0) ? stoneId('1-1') : null;
      const turn = forcedStart !== null ? hands.findIndex(h => h & (1 << forcedStart)) : previous.finishedPlayer;
      let state = { hands, left: null, right: null, turn, fisher: -1, forcedStart };
      let chain = [];
      const history = [{ state, chain, move: null }];
      for (const [m, move] of round.moves.entries()) {
        try {
          if (move.player !== names[state.turn]) throw new Error(`Нарушена очередь: ожидается ${names[state.turn]}`);
          state = applyMove(state, move);
          if (move.action === 'start') chain = [move.stone];
          if (move.action === 'left') chain = [move.stone, ...chain];
          if (move.action === 'right') chain = [...chain, move.stone];
          history.push({ state, chain, move });
        } catch (e) { throw new Error(`ход ${m + 1}: ${e.message}`); }
      }
      const outcome = settle(state, context);
      if (!outcome) throw new Error('Журнал кона закончился до выхода или полной блокировки');
      const expected = recordedResult(outcome, players, teams);
      if (!isDeepStrictEqual(expected, round.result)) throw new Error(`Результат не совпадает с воспроизведением. Ожидается ${JSON.stringify(expected)}`);
      rounds.push({ number: round.number, context, history, outcome, recorded: round.result });
      previous = outcome;
      context = { ...context, score: outcome.totalScore, fence: outcome.fence, eggs: outcome.eggs };
    } catch (e) { throw new Error(`${prefix}, ${e.message}`); }
  }
  if (previous.gameWinner === null) throw new Error('Партия не завершена последним коном');
  const expected = previous.gameWinner === 2 ? { draw: true } : { winner: teams[previous.gameWinner] };
  if (!isDeepStrictEqual(expected, data.result)) throw new Error(`Итог партии не совпадает: ожидается ${JSON.stringify(expected)}`);
  return { teams, players, rounds, result: data.result, fishVariant: data.fishVariant, scoreLimit: data.scoreLimit };
}
