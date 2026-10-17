import { chainTeams } from '../public/domino.js';
import { lessonData } from './lesson-data.js';
import { maskOf, stonesOf, stoneId, STONES, SUITS, countBits, applyMove } from './game.js';
import { analyzeTeachingPosition } from './analysis.js';
import { motifApplies } from '../public/tactics.js';
import { decisionQuality } from '../public/impact.js';

const figure9 = {
  id: 'figure9', title: 'Свежая масть · рисунок 9', motif: 'source', kind: 'exception', sourceMode: 'given-position',
  hands: [['5-6', '2-2', '0-0', '1-6'], ['0-2', '2-6', '0-6', '6-6'],
    ['0-5', '0-3', '3-6', '3-3', '0-1'], ['4-4', '4-5', '4-6', '5-5']],
  chain: ['5-1', '1-2', '2-3', '3-4', '4-1', '1-1', '1-3', '3-5', '5-2', '2-4', '4-0'],
  turn: 0, fisher: 3,
  context: { fishVariant: 'withEggs', scoreLimit: 101, score: [0, 0], fence: [0, 0], eggs: 0 },
};
const definitions = [...lessonData, figure9];
export const lessonCatalog = () => definitions.map(({ id, title, motif }) => ({ id, title, motif }));
export function lessonDefinition(id) {
  const definition = definitions.find(d => d.id === id);
  if (!definition) throw new Error('Нет такого упражнения');
  return structuredClone(definition);
}
function checkContext(c) {
  if (!c || !['withEggs', 'withoutEggs'].includes(c.fishVariant) || !Number.isSafeInteger(c.scoreLimit) || c.scoreLimit <= 0
    || !['score', 'fence'].every(k => Array.isArray(c[k]) && c[k].length === 2 && c[k].every(n => Number.isSafeInteger(n) && n >= 0))
    || !Number.isSafeInteger(c.eggs) || c.eggs < 0 || c.score.some(n => n >= c.scoreLimit)) throw new Error('Неверный контекст упражнения');
}
function checkTiles(hands, chain) {
  if (!Array.isArray(hands) || hands.length !== 4 || hands.some(h => !Array.isArray(h) || h.length > 7)) throw new Error('Неверные руки упражнения');
  const tiles = [...hands.flat(), ...chain];
  if (tiles.length !== 28 || new Set(tiles.map(stoneId)).size !== 28) throw new Error('Нужны все 28 разных камней');
  for (let i = 1; i < chain.length; i++) if (chain[i - 1][2] !== chain[i][0]) throw new Error('Неверная стыковка цепочки');
}
/** Fixed lessons only; validates composition and full prefix before analysis.
 * A given-position explicitly makes no claim about historical reachability.
 */
export function validateLesson(definition) {
  const d = structuredClone(definition);
  checkContext(d.context);
  if (d.sourceMode === 'given-position') {
    checkTiles(d.hands, d.chain);
    if (!Number.isInteger(d.turn) || d.turn < 0 || d.turn > 3 || !Number.isInteger(d.fisher) || d.fisher < 0 || d.fisher > 3 || !d.chain.length)
      throw new Error('Неверная очередь заданной позиции');
    return { state: { hands: d.hands.map(maskOf), left: Number(d.chain[0][0]), right: Number(d.chain.at(-1)[2]),
      turn: d.turn, fisher: d.fisher, forcedStart: null }, chain: d.chain, context: d.context };
  }
  checkTiles(d.initial, []);
  if (d.initial.some(h => h.length !== 7)) throw new Error('В раздаче должно быть по 7 камней');
  const hands = d.initial.map(maskOf), doubles = maskOf(STONES.filter(([a, b]) => a === b).map(s => s.join('-')));
  if (hands.some(h => countBits(h & doubles) >= 5 || SUITS.some(s => countBits(h & s) >= 6))) throw new Error('Раздача требует пересдачи');
  if (!Number.isInteger(d.starter) || d.starter < 0 || d.starter > 3 || typeof d.forcedStart !== 'boolean') throw new Error('Неверный заходчик');
  if (d.forcedStart !== d.context.score.every(n => n === 0)) throw new Error('Заход не соответствует контексту счёта');
  if (d.forcedStart && !(hands[d.starter] & (1 << stoneId('1-1')))) throw new Error('Заходчик должен иметь 1-1');
  let state = { hands, left: null, right: null, turn: d.starter, fisher: -1, forcedStart: d.forcedStart ? stoneId('1-1') : null }, chain = [];
  if (!Array.isArray(d.path)) throw new Error('Неверная история упражнения');
  for (const [i, action] of d.path.entries()) {
    // applyMove also rejects a wrong hand, illegal pass and continuation after the end.
    try { state = applyMove(state, action); }
    catch (e) { throw new Error(`Ход ${i + 1} упражнения: ${e.message}`); }
    if (action.action === 'start') chain = [action.stone];
    else if (action.action === 'left') chain.unshift(action.stone);
    else if (action.action === 'right') chain.push(action.stone);
  }
  checkTiles(state.hands.map(stonesOf), chain);
  return { state, chain, context: d.context };
}
const explanations = {
  control: 'Сохранение ранее контролируемого командой конца. Владение концом не гарантирует нужную очередь: сравните все ответы соперника и остатки рук.',
  partner: 'Помощь проверяется после каждого ответа ближайшего соперника: партнёр должен получить допустимый ход. Немедленное завершение соперником не считается поддержкой. Доступность хода ещё не гарантирует лучший W/N.',
  change: 'Смена масти — выкладка недубля, меняющего открытый конец. Число точек не задаёт силу: важны очередь и оставшиеся переходы обеих пар.',
  block: 'Момент блокировки — немедленная рыба или яйца. Сравните её аналитический исход с продолжением; победитель рыбы при завершении партии определяется итогом партии.',
};

/** Exact full-tree analysis of a built-in id. Client hands never enter this boundary. */
export function analyzeLesson(id, mirror = false, onProgress) {
  if (typeof mirror !== 'boolean') throw new Error('Неверный флаг зеркала');
  const d = lessonDefinition(id), validated = validateLesson(d);
  let { state, chain } = validated;
  if (mirror && chain.length) {
    state = { ...state, left: state.right, right: state.left };
    chain = [...chain].reverse().map(s => s.split('-').reverse().join('-'));
  }
  const result = analyzeTeachingPosition(state, chain, validated.context, onProgress), step = result.steps[0];
  if (d.motif !== 'source') {
    const q = decisionQuality(step), matches = e => motifApplies(step, e.alternative, d.motif);
    const valid = d.kind === 'confirmation' ? q.entries.some(e => e.best && matches(e)) && q.entries.some(e => !e.best && !matches(e))
      : q.entries.some(e => !e.best && matches(e)) && q.entries.filter(e => e.best).every(e => !matches(e));
    if (!valid) throw new Error('Учебный мотив не подтверждён точным расчётом');
  }
  return { ...result, lesson: { id, title: d.title, motif: d.motif, kind: d.kind, mirror,
    sourceMode: d.sourceMode ?? 'replayed-prefix', owners: d.initial ? chainTeams(chain, d.initial) : null,
    contextNote: d.sourceMode ? 'Заданная позиция рисунка 9. История не восстановлена; достижимость не подтверждена. Допущение: ход Красного, последний недубль Зелёного, рыба с яйцами, до 101, счёт 0:0, забор 0:0, яйца 0.'
      : `Собственная учебная раздача: все 28 камней, проверено ${d.path.length} действий от обязательного 1–1. Рыба с яйцами, до 50; счёт, забор и яйца — 0.`,
    explanation: explanations[d.motif] ?? 'Свежая 6 после 6–5 не гарантирует помощь: следующим ходит Синий, у которого есть 0–6, 2–6 и 6–6. При заданном контексте 0–0 даёт 55/83, а 6–5 — 185/405. Это условный расчёт, не восстановленная партия статьи.' } };
}
