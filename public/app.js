import { aggregateImpacts } from './impact.js';
const $ = id => document.getElementById(id);
const colors = ['#006f62', '#97560f', '#62519a'];
const playerColors = ['#006f62', '#97560f', '#225b9c', '#76419a'];
const classes = ['a', 'b', 'draw'];
const nf = new Intl.NumberFormat('ru-RU');
let game = null, analysis = null, stepIndex = 0, activeJob = null, busy = false;
let roundAnalyses = new Map(), stopQueue = false;
let chartWidth = 960;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function showMessage(text, error = false) {
  $('message').hidden = !text;
  $('message').className = error ? 'message error' : 'message';
  $('message').textContent = text;
}
function setBusy(value) {
  busy = value;
  for (const id of ['file', 'examples', 'demo', 'round', 'analyze']) $(id).disabled = value;
  for (const button of $('round-list').children) button.disabled = value;
  $('analyze-game').disabled = value;
}
async function api(url, data, method = data === undefined ? 'GET' : 'POST') {
  const response = await fetch(url, { method, ...(data === undefined ? {} : {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Ошибка ${response.status}`);
  return result;
}
function percent(value, numerator, denominator) {
  if ((numerator !== undefined && BigInt(numerator) > 0n && value < 0.005) || (value > 0 && value < 0.005)) return '<0,01 %';
  if (denominator !== undefined && numerator !== denominator && value >= 99.995) return '>99,99 %';
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}
function signed(value) {
  const displayed = Math.abs(value) < 0.005 ? 0 : value;
  return `${displayed > 0 ? '+' : ''}${displayed.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function actionText(move) {
  if (!move) return 'До первого хода';
  const action = { start: 'заход', left: 'слева', right: 'справа', pass: 'пропуск' }[move.action];
  return `${move.stone?.replace('-', '–') ?? ''} ${action}`.trim();
}
const pipLayout = [[], [[50, 50]], [[24, 24], [76, 76]], [[24, 24], [50, 50], [76, 76]],
  [[24, 24], [76, 24], [24, 76], [76, 76]],
  [[24, 24], [76, 24], [50, 50], [24, 76], [76, 76]],
  [[24, 24], [76, 24], [24, 50], [76, 50], [24, 76], [76, 76]]];
function domino(stone) {
  const node = element('span', 'domino');
  node.setAttribute('role', 'img'); node.setAttribute('aria-label', stone.replace('-', '–'));
  node.title = stone;
  for (const n of stone.split('-').map(Number)) {
    const half = element('span', 'half');
    for (const [x, y] of pipLayout[n]) {
      const pip = element('i', 'pip'); pip.style.left = `${x}%`; pip.style.top = `${y}%`; half.append(pip);
    }
    node.append(half);
  }
  return node;
}
function pair(target, values, suffix = '') {
  const node = $(target); node.replaceChildren();
  for (let t = 0; t < 2; t++) {
    if (t) node.append(document.createTextNode(' / '));
    node.append(element('span', classes[t], `${values[t]}${suffix}`));
  }
}

async function importSource(request, name) {
  if (busy) return;
  setBusy(true); showMessage('Проверяем журнал и воспроизводим ходы…');
  try {
    game = await request();
    roundAnalyses = new Map(); stopQueue = false;
    analysis = null;
    $('dashboard').hidden = true; $('game-meta').hidden = false;
    $('source-name').textContent = name;
    $('rules-label').textContent = `${game.fishVariant === 'withEggs' ? 'С яйцами' : 'Без яиц'} · до ${game.scoreLimit} · раундов: ${game.rounds.length}`;
    $('round').replaceChildren(); $('round-list').replaceChildren();
    for (const round of game.rounds) {
      const option = element('option', '', `Раунд ${round.number} · ${round.moves} действий`);
      option.value = round.number; $('round').append(option);
      const button = element('button', 'round-chip', `Раунд ${round.number}  ·  ${round.score.join(' : ')}`);
      button.addEventListener('click', () => { $('round').value = round.number; startAnalysis(); });
      $('round-list').append(button);
    }
    showMessage(''); setBusy(false);
    await startAnalysis();
    if (analysis) await analyzeGame();
  } catch (e) { showMessage(e.message, true); setBusy(false); }
}

async function startAnalysis() {
  if (!game || busy) return;
  stopQueue = false;
  setBusy(true); showMessage(''); $('welcome').hidden = true; $('progress').hidden = false;
  $('dashboard').hidden = true; $('cancel').disabled = false;
  $('progress-text').textContent = 'Подготовка расчёта…';
  const round = Number($('round').value);
  [...$('round-list').children].forEach((node, i) => node.classList.toggle('active', i === round - 1));
  try {
    const job = await requestRound(round);
    if (job.status === 'error') throw new Error(job.error);
    if (job.status === 'cancelled') {
      showMessage('Расчёт отменён. Выберите раунд для повторного запуска.');
      $('welcome').hidden = false;
    } else {
      analysis = job.result; stepIndex = 0;
      roundAnalyses.set(round, analysis);
      renderAnalysis(job.cached); $('dashboard').hidden = false;
    }
  } catch (e) { showMessage(e.message, true); $('welcome').hidden = false; }
  finally { activeJob = null; $('progress').hidden = true; setBusy(false); }
}

async function requestRound(round) {
  if (roundAnalyses.has(round)) return { status: 'done', cached: true, result: roundAnalyses.get(round) };
  let job = await api('/api/analyze', { gameId: game.id, round });
  activeJob = job.id;
  if (stopQueue && job.status === 'running') job = await api(`/api/jobs/${job.id}`, undefined, 'DELETE');
  while (job.status === 'running') {
    const stats = job.stats;
    $('progress-text').textContent = `Раунд ${round} из ${game.rounds.length} · ${nf.format(stats.nodes)} позиций · ${nf.format(stats.hits)} из кеша · ${(stats.elapsedMs / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} с`;
    await new Promise(resolve => setTimeout(resolve, 500));
    job = await api(`/api/jobs/${job.id}`);
  }
  activeJob = null;
  return job;
}

async function analyzeGame() {
  if (!game || busy || roundAnalyses.size === game.rounds.length) return;
  showMessage('');
  setBusy(true); stopQueue = false; $('progress').hidden = false; $('cancel').disabled = false;
  try {
    for (const round of game.rounds) {
      if (stopQueue) break;
      if (roundAnalyses.has(round.number)) continue;
      const job = await requestRound(round.number);
      if (job.status === 'error') throw new Error(job.error);
      if (job.status === 'cancelled') { stopQueue = true; break; }
      roundAnalyses.set(round.number, job.result);
      renderPlayerImpacts();
    }
    if (stopQueue) showMessage('Расчёт партии остановлен. Готовые итоги сохранены; можно досчитать оставшиеся раунды.');
  } catch (e) { showMessage(e.message, true); }
  finally { activeJob = null; $('progress').hidden = true; setBusy(false); renderPlayerImpacts(); }
}

function renderPlayerImpacts() {
  const summary = aggregateImpacts([...roundAnalyses.values()], game.players, game.rounds.length);
  $('impact-status').textContent = summary.complete ? `Вся партия рассчитана · ${summary.completedRounds} раундов` : `Рассчитано ${summary.completedRounds} из ${game.rounds.length} раундов · итог партии ещё не готов`;
  $('analyze-game').hidden = summary.complete;
  const head = element('tr');
  head.append(element('th', '', 'Игрок'), element('th', '', 'Команда'));
  for (const round of summary.byRound) head.append(element('th', round.number === analysis.number ? 'selected-round' : '', `Раунд ${round.number}`));
  head.append(element('th', '', 'Вся партия')); $('player-impact-head').replaceChildren(head);
  $('player-impact-body').replaceChildren();
  game.players.forEach((player, p) => {
    const row = element('tr'), label = element('td');
    const name = element('span', 'player-label');
    const badge = element('span', 'player-badge', `P${p + 1}`); badge.style.color = playerColors[p];
    name.append(badge, document.createTextNode(player.name)); label.append(name);
    row.append(label, element('td', classes[p % 2], game.teams[p % 2]));
    for (const round of summary.byRound) {
      const value = round.values?.[p];
      row.append(element('td', `${value < 0 ? 'negative' : 'positive'} ${round.number === analysis.number ? 'selected-round' : ''}`, value == null ? '—' : `${signed(value)} %`));
    }
    const total = summary.totals[p];
    row.append(element('td', total < 0 ? 'negative' : 'positive', total === null ? '—' : `${signed(total)} %`));
    $('player-impact-body').append(row);
  });
}

function renderAnalysis(cached) {
  chartWidth = Math.max(960, (analysis.steps.length - 1) * 64 + 100);
  $('charts-canvas').style.minWidth = `${chartWidth}px`;
  $('chart').setAttribute('viewBox', `0 0 ${chartWidth} 240`);
  $('impact-chart').setAttribute('viewBox', `0 0 ${chartWidth} 365`);
  $('player-legend').replaceChildren();
  analysis.players.forEach((p, i) => {
    const item = element('span', 'legend-item');
    const badge = element('span', 'player-badge', `P${i + 1}`); badge.style.color = playerColors[i];
    item.append(badge, document.createTextNode(p.name)); $('player-legend').append(item);
  });
  $('leaves').textContent = nf.format(BigInt(analysis.base.leaves));
  $('depth').textContent = analysis.base.depth;
  $('min-depth').textContent = analysis.base.minDepth;
  $('round-title').textContent = `РАУНД ${analysis.number} · СЧЁТ ДО НАЧАЛА`;
  $('initial-score').textContent = analysis.context.score.join(' : ');
  $('calculation-info').textContent = cached ? 'Готовый результат из памяти' : `${nf.format(analysis.stats.nodes)} позиций · ${(analysis.stats.elapsedMs / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} с`;
  $('legend').replaceChildren();
  for (let t = 0; t < 3; t++) {
    const item = element('span', 'legend-item'); item.append(element('i', `dot bg-${classes[t]}`), document.createTextNode(analysis.teams[t] ?? 'Ничья партии')); $('legend').append(item);
  }
  for (let t = 0; t < 2; t++) {
    const item = element('span', 'legend-item ideal-legend');
    const sample = element('i', `line-swatch ${classes[t]}`);
    item.append(sample, document.createTextNode(`Лучший шанс · ${analysis.teams[t]}`)); $('legend').append(item);
  }
  for (let t = 0; t < 2; t++) {
    const item = element('span', 'legend-item ideal-legend');
    const sample = element('i', `line-swatch worst-line-swatch ${classes[t]}`);
    item.append(sample, document.createTextNode(`Худший шанс · ${analysis.teams[t]}`)); $('legend').append(item);
  }
  $('slider').max = analysis.steps.length - 1;
  $('history-team-a').textContent = analysis.teams[0]; $('history-team-b').textContent = analysis.teams[1];
  $('history').replaceChildren();
  for (const step of analysis.steps) {
    const row = element('tr'); row.tabIndex = 0;
    row.setAttribute('aria-label', `Перейти к шагу ${step.index}`);
    row.addEventListener('click', () => selectStep(step.index));
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStep(step.index); } });
    row.append(element('td', '', step.index));
    const move = element('td', '', step.move?.player ?? 'Раздача');
    move.append(element('span', 'history-action', actionText(step.move))); row.append(move);
    for (let t = 0; t < 2; t++) row.append(element('td', classes[t], percent(step.probabilities[t], step.wins[t], step.leaves)));
    row.append(element('td', step.delta[0] >= 0 ? 'positive' : 'negative', `${signed(step.delta[0])} %`));
    row.append(element('td', 'draw', percent(step.probabilities[2], step.wins[2], step.leaves)));
    $('history').append(row);
  }
  renderPlayerImpacts(); renderStep();
}

function selectStep(index) {
  if (!analysis) return;
  stepIndex = Math.max(0, Math.min(analysis.steps.length - 1, index)); renderStep();
}
function renderStep() {
  const step = analysis.steps[stepIndex];
  $('slider').value = stepIndex;
  $('first').disabled = $('prev').disabled = stepIndex === 0;
  $('last').disabled = $('next').disabled = stepIndex === analysis.steps.length - 1;
  $('step-count').textContent = `ПОЗИЦИЯ ${stepIndex} / ${analysis.steps.length - 1}`;
  $('move-title').textContent = step.move ? `${step.move.player} · ${actionText(step.move)}` : 'До первого хода · базовые шансы';
  $('probabilities').replaceChildren();
  for (let t = 0; t < 3; t++) {
    const card = element('div', 'probability');
    card.append(element('span', '', analysis.teams[t] ?? 'Ничья партии'), element('strong', classes[t], percent(step.probabilities[t], step.wins[t], step.leaves)),
      element('small', '', `${nf.format(BigInt(step.wins[t]))} / ${nf.format(BigInt(step.leaves))} исходов из позиции ${stepIndex}`));
    $('probabilities').append(card);
  }
  pair('delta', step.delta.map(v => signed(v)), ' п.п.'); pair('counts', step.counts); pair('points', step.points);
  $('choices').textContent = step.alternatives.length;
  $('fish').textContent = percent(step.fishProbability);
  $('eggs').textContent = analysis.context.fishVariant === 'withEggs' ? `В том числе с яйцами: ${percent(step.eggsProbability)}` : 'Рыба без яиц';
  $('turn-label').textContent = step.terminal ? 'Раунд завершён' : `Ходит: ${analysis.players[step.turn].name}`;
  $('chain').replaceChildren(...(step.chain.length ? step.chain.map(domino) : [element('span', 'chain-empty', 'Цепочка ещё не начата')]));
  $('ends').textContent = step.ends.length ? `Открытые концы: ${step.ends.join(' и ')}${step.fisher >= 0 ? ` · Последний недубль: ${analysis.players[step.fisher].name}` : ''}` : `Заходит: ${analysis.players[step.turn].name}`;
  $('hands').replaceChildren();
  step.hands.forEach((stones, p) => {
    const card = element('div', `hand ${p % 2 ? 'team-b' : ''} ${!step.terminal && p === step.turn ? 'active' : ''}`);
    card.append(element('div', 'hand-name', analysis.players[p].name), element('div', 'hand-meta', `${analysis.teams[p % 2]} · место ${p + 1} · камней: ${stones.length}`));
    const hand = element('div', 'hand-stones');
    hand.append(...(stones.length ? stones.map(domino) : [element('span', 'muted', 'Пустая рука')])); card.append(hand); $('hands').append(card);
  });
  $('outcome').hidden = !step.terminal;
  if (step.terminal) {
    const o = analysis.outcome, reason = { emptyHand: 'Выход', fish: analysis.context.fishVariant === 'withEggs' ? 'Рыба' : 'Рыба без яиц', eggs: 'Рыба с яйцами' }[o.reason];
    const winner = o.analyticsWinner === 2 ? 'Ничья партии' : `Аналитический победитель: ${analysis.teams[o.analyticsWinner]}`;
    $('outcome').replaceChildren(element('strong', '', `${reason}. ${winner}.`), element('div', '', `Счёт после раунда: ${o.totalScore.join(' : ')}. ${o.gameWinner === null ? 'Партия продолжается.' : 'Партия завершена.'}`),
      element('div', 'muted', `Победитель раунда по исходным правилам: ${o.winnerTeam === null ? 'не назначается' : analysis.teams[o.winnerTeam]}. Завершил: ${analysis.players[o.finishedPlayer].name}.`));
  }
  $('alternatives').replaceChildren();
  for (const alternative of step.alternatives) {
    const card = element('div', 'alternative'), head = element('div', 'alternative-head');
    if (alternative.stone) head.append(domino(alternative.stone));
    head.append(element('span', '', actionText(alternative)));
    if (alternative.actual) head.append(element('span', 'actual', 'В игре'));
    const chances = element('div', 'alt-chances');
    for (let t = 0; t < 2; t++) chances.append(element('span', classes[t], percent(alternative.probabilities[t], alternative.wins[t], alternative.leaves)));
    const bar = element('div', 'chance-bar');
    for (let t = 0; t < 3; t++) { const segment = element('span', `bg-${classes[t]}`); segment.style.width = `${alternative.probabilities[t]}%`; bar.append(segment); }
    card.append(head, chances, bar, element('div', 'alt-leaves', `${nf.format(BigInt(alternative.leaves))} исходов · ничья ${percent(alternative.probabilities[2], alternative.wins[2], alternative.leaves)}`));
    $('alternatives').append(card);
  }
  if (!step.alternatives.length) $('alternatives').append(element('p', 'muted', 'Дальнейших ходов нет. Раунд завершён.'));
  [...$('history').children].forEach((row, i) => row.classList.toggle('active', i === stepIndex));
  renderChart(); renderImpactChart();
}

function svgNode(tag, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderChart() {
  const chart = $('chart'); chart.replaceChildren();
  const x = chartX;
  const y = p => 210 - p * 1.9;
  for (const p of [0, 25, 50, 75, 100]) {
    chart.append(svgNode('line', { x1: 80, x2: chartWidth - 20, y1: y(p), y2: y(p), stroke: '#d5ded8', 'stroke-dasharray': '3 5' }), svgNode('text', { x: 65, y: y(p) + 5, 'text-anchor': 'end', fill: '#52626a', 'font-size': 14 }, percent(p)));
  }
  for (let t = 0; t < 3; t++) {
    if (t === 2 && analysis.steps.every(s => s.wins[2] === '0')) continue;
    const d = analysis.steps.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(s.probabilities[t])}`).join(' ');
    chart.append(svgNode('path', { d, fill: 'none', stroke: colors[t], 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }
  for (let t = 0; t < 2; t++) {
    const d = analysis.steps.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(s.best.probabilities[t])}`).join(' ');
    const line = svgNode('path', { d, fill: 'none', stroke: colors[t], 'stroke-width': 2.5,
      'stroke-dasharray': '8 6', 'stroke-linejoin': 'round', 'data-best-team': t });
    line.append(svgNode('title', {}, `Лучший доступный шанс · ${analysis.teams[t]}`)); chart.append(line);
  }
  for (let t = 0; t < 2; t++) {
    const d = analysis.steps.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(s.worst.probabilities[t])}`).join(' ');
    const line = svgNode('path', { d, fill: 'none', stroke: colors[t], 'stroke-width': 2.5,
      'stroke-dasharray': '1 7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-worst-team': t });
    line.append(svgNode('title', {}, `Худший доступный шанс · ${analysis.teams[t]}`)); chart.append(line);
  }
  const selected = analysis.steps[stepIndex];
  $('best-chances').textContent = `${stepIndex ? 'Лучшие шансы перед этим действием' : 'Базовые шансы'}: ` + analysis.teams.map((name, t) => {
    const choice = selected.best.moves[t];
    return `${name} ${percent(selected.best.probabilities[t], choice?.wins[t] ?? selected.wins[t], choice?.leaves ?? selected.leaves)}`;
  }).join(' · ');
  $('worst-chances').textContent = `${stepIndex ? 'Худшие шансы перед этим действием' : 'Базовые шансы'}: ` + analysis.teams.map((name, t) => {
    const choice = selected.worst.moves[t];
    return `${name} ${percent(selected.worst.probabilities[t], choice?.wins[t] ?? selected.wins[t], choice?.leaves ?? selected.leaves)}`;
  }).join(' · ');
  chart.append(svgNode('line', { x1: x(stepIndex), x2: x(stepIndex), y1: 14, y2: 218, stroke: '#839a8b', 'stroke-dasharray': '4 4' }));
  for (let t = 0; t < 2; t++) chart.append(svgNode('circle', { cx: x(stepIndex), cy: y(analysis.steps[stepIndex].probabilities[t]), r: 5, fill: colors[t], stroke: 'white', 'stroke-width': 2 }));
  for (let i = 0; i < analysis.steps.length; i++) {
    if (i % Math.max(1, Math.round(analysis.steps.length / 15)) === 0 || i === analysis.steps.length - 1)
      chart.append(svgNode('text', { x: x(i), y: 236, 'text-anchor': 'middle', fill: '#52626a', 'font-size': 14 }, i));
  }
}
function chartX(i) { return 80 + i / (analysis.steps.length - 1) * (chartWidth - 100); }
function renderImpactChart() {
  const chart = $('impact-chart'); chart.replaceChildren();
  const defs = svgNode('defs', {});
  playerColors.forEach((color, p) => {
    const pattern = svgNode('pattern', { id: `best-hatch-${p}`, width: 7, height: 7, patternUnits: 'userSpaceOnUse' });
    pattern.append(svgNode('rect', { width: 7, height: 7, fill: '#fff' }),
      svgNode('path', { d: 'M-2,2 L2,-2 M0,7 L7,0 M5,9 L9,5', stroke: color, 'stroke-width': 1.5 }));
    defs.append(pattern);
    const dots = svgNode('pattern', { id: `worst-dots-${p}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse' });
    dots.append(svgNode('rect', { width: 6, height: 6, fill: '#fff' }),
      svgNode('circle', { cx: 3, cy: 3, r: 1.3, fill: color }));
    defs.append(dots);
  });
  chart.append(defs);
  const max = Math.max(10, ...analysis.steps.map(s => Math.max(Math.abs(s.impact?.value ?? 0), Math.abs(s.best.impact?.value ?? 0), Math.abs(s.worst.impact?.value ?? 0))));
  const y = v => 118 - v / max * 82;
  for (const value of [-max, 0, max]) {
    chart.append(svgNode('line', { x1: 80, x2: chartWidth - 20, y1: y(value), y2: y(value), stroke: value === 0 ? '#71847a' : '#d5ded8', 'stroke-dasharray': value === 0 ? 'none' : '3 5' }),
      svgNode('text', { x: 65, y: y(value) + 5, 'text-anchor': 'end', fill: '#52626a', 'font-size': 13 }, `${signed(value)}%`));
  }
  chart.append(svgNode('text', { x: 65, y: 235, 'text-anchor': 'end', fill: '#52626a', 'font-size': 12 }, 'Лучший'));
  chart.append(svgNode('text', { x: 65, y: 256, 'text-anchor': 'end', fill: '#52626a', 'font-size': 12 }, 'Факт'));
  chart.append(svgNode('text', { x: 65, y: 277, 'text-anchor': 'end', fill: '#52626a', 'font-size': 12 }, 'Худший'));
  chart.append(svgNode('line', { x1: chartX(stepIndex), x2: chartX(stepIndex), y1: 20, y2: 350, stroke: '#52626a', 'stroke-dasharray': '4 4' }));
  analysis.steps.forEach((step, i) => {
    const impact = step.impact, value = impact?.value ?? 0;
    const best = step.best.impact, worst = step.worst.impact;
    const color = impact ? playerColors[impact.player] : '#52626a';
    const description = impact ? `Ход ${i}. P${impact.player + 1}: ${analysis.players[impact.player].name}. Лучший ${signed(best.value)} %: ${actionText(best.move)}. Факт ${signed(value)} %. Худший вероятный ход ${signed(worst.value)} %: ${actionText(worst.move)}` : 'Шаг 0. До первого хода. Влияние 0,00 %. Альтернативных действий нет';
    const group = svgNode('g', { role: 'button', tabindex: 0, 'aria-label': description, 'data-step': i });
    group.append(svgNode('title', {}, description));
    if (i === stepIndex) group.append(svgNode('rect', { x: chartX(i) - 28, y: 217, width: 56, height: 133, rx: 5, fill: '#e5eee8' }));
    if (best) group.append(svgNode('rect', { x: chartX(i) - 27, y: Math.min(y(best.value), y(0)), width: 14, height: Math.max(2, Math.abs(y(best.value) - y(0))), fill: `url(#best-hatch-${impact.player})`, stroke: color, 'stroke-width': 1, rx: 1, 'data-kind': 'best' }));
    group.append(svgNode('rect', { x: chartX(i) - 7, y: Math.min(y(value), y(0)), width: 14, height: Math.max(2, Math.abs(y(value) - y(0))), fill: color, rx: 1, 'data-kind': 'actual' }));
    if (worst) group.append(svgNode('rect', { x: chartX(i) + 13, y: Math.min(y(worst.value), y(0)), width: 14, height: Math.max(2, Math.abs(y(worst.value) - y(0))), fill: `url(#worst-dots-${impact.player})`, stroke: color, 'stroke-width': 1, rx: 1, 'data-kind': 'worst' }));
    group.append(svgNode('text', { x: chartX(i), y: 235, 'text-anchor': 'middle', fill: color, 'font-size': 13 }, best ? signed(best.value) : '—'),
      svgNode('text', { x: chartX(i), y: 256, 'text-anchor': 'middle', fill: color, 'font-size': 13, 'font-weight': 600 }, signed(value)),
      svgNode('text', { x: chartX(i), y: 277, 'text-anchor': 'middle', fill: color, 'font-size': 13 }, worst ? signed(worst.value) : '—'),
      svgNode('text', { x: chartX(i), y: 307, 'text-anchor': 'middle', fill: color, 'font-size': 14, 'font-weight': 700 }, impact ? `P${impact.player + 1}` : '—'),
      svgNode('text', { x: chartX(i), y: 336, 'text-anchor': 'middle', fill: '#52626a', 'font-size': 14 }, i));
    group.addEventListener('click', e => { e.stopPropagation(); selectStep(i); });
    group.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStep(i); } });
    chart.append(group);
  });
  const current = analysis.steps[stepIndex].impact;
  const best = analysis.steps[stepIndex].best.impact;
  const worst = analysis.steps[stepIndex].worst.impact;
  $('impact-selection').textContent = current ? `Ход ${stepIndex} · P${current.player + 1} ${analysis.players[current.player].name} · лучший ${signed(best.value)} % (${actionText(best.move)}) · факт ${signed(current.value)} % · худший ${signed(worst.value)} % (${actionText(worst.move)})` : 'До первого хода · влияние 0,00 %';
}
for (const id of ['chart', 'impact-chart']) $(id).addEventListener('click', event => {
  if (!analysis) return;
  const bounds = $(id).getBoundingClientRect();
  selectStep(Math.round(((event.clientX - bounds.left) / bounds.width * chartWidth - 80) / (chartWidth - 100) * (analysis.steps.length - 1)));
});
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showMessage('Максимальный размер файла — 5 МБ', true); $('file').value = ''; return; }
  await importSource(async () => api('/api/import', { text: await file.text() }), file.name);
  $('file').value = '';
});
$('examples').addEventListener('change', async () => {
  const name = $('examples').value;
  if (name) await importSource(() => api('/api/example', { name }), name);
  $('examples').value = '';
});
$('demo').addEventListener('click', () => importSource(() => api('/api/example', { name: 'demo' }), 'Учебная партия · 3 раунда'));
$('round').addEventListener('change', startAnalysis);
$('analyze').addEventListener('click', startAnalysis);
$('analyze-game').addEventListener('click', analyzeGame);
$('cancel').addEventListener('click', async () => {
  stopQueue = true;
  if (!activeJob) return;
  $('cancel').disabled = true;
  try { await api(`/api/jobs/${activeJob}`, undefined, 'DELETE'); }
  catch (e) { showMessage(e.message, true); $('cancel').disabled = false; }
});
$('slider').addEventListener('input', () => selectStep(Number($('slider').value)));
$('first').addEventListener('click', () => selectStep(0));
$('last').addEventListener('click', () => selectStep(analysis.steps.length - 1));
$('prev').addEventListener('click', () => selectStep(stepIndex - 1));
$('next').addEventListener('click', () => selectStep(stepIndex + 1));
document.addEventListener('keydown', event => {
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); selectStep(stepIndex + (event.key === 'ArrowRight' ? 1 : -1)); }
});
try {
  const { files } = await api('/api/examples');
  for (const file of files) { const option = element('option', '', file); option.value = file; $('examples').append(option); }
} catch (e) { showMessage(e.message, true); }
