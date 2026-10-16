const $ = id => document.getElementById(id);
const colors = ['#087f72', '#d09338', '#7d79a7'];
const classes = ['a', 'b', 'draw'];
const nf = new Intl.NumberFormat('ru-RU');
let game = null, analysis = null, stepIndex = 0, activeJob = null, busy = false;

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
  if (numerator !== undefined && BigInt(numerator) > 0n && value === 0) return '<0,0001 %';
  if (denominator !== undefined && numerator !== denominator && value === 100) return '>99,9999 %';
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 4 })} %`;
}
function signed(value) {
  return `${value > 0 ? '+' : ''}${value.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}`;
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
    analysis = null;
    $('dashboard').hidden = true; $('game-meta').hidden = false;
    $('source-name').textContent = name;
    $('rules-label').textContent = `${game.fishVariant === 'withEggs' ? 'С яйцами' : 'Без яиц'} · до ${game.scoreLimit} · конов: ${game.rounds.length}`;
    $('round').replaceChildren(); $('round-list').replaceChildren();
    for (const round of game.rounds) {
      const option = element('option', '', `Кон ${round.number} · ${round.moves} действий`);
      option.value = round.number; $('round').append(option);
      const button = element('button', 'round-chip', `Кон ${round.number}  ·  ${round.score.join(' : ')}`);
      button.addEventListener('click', () => { $('round').value = round.number; startAnalysis(); });
      $('round-list').append(button);
    }
    showMessage(''); setBusy(false);
    await startAnalysis();
  } catch (e) { showMessage(e.message, true); setBusy(false); }
}

async function startAnalysis() {
  if (!game || busy) return;
  setBusy(true); showMessage(''); $('welcome').hidden = true; $('progress').hidden = false;
  $('dashboard').hidden = true; $('cancel').disabled = false;
  $('progress-text').textContent = 'Подготовка расчёта…';
  const round = Number($('round').value);
  [...$('round-list').children].forEach((node, i) => node.classList.toggle('active', i === round - 1));
  try {
    let job = await api('/api/analyze', { gameId: game.id, round });
    activeJob = job.id;
    while (job.status === 'running') {
      const stats = job.stats;
      $('progress-text').textContent = `${nf.format(stats.nodes)} позиций · ${nf.format(stats.hits)} обращений к кешу · ${(stats.elapsedMs / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} с`;
      await new Promise(resolve => setTimeout(resolve, 500));
      job = await api(`/api/jobs/${job.id}`);
    }
    if (job.status === 'error') throw new Error(job.error);
    if (job.status === 'cancelled') {
      showMessage('Расчёт отменён. Выберите кон для повторного запуска.');
      $('welcome').hidden = false;
    } else {
      analysis = job.result; stepIndex = 0;
      renderAnalysis(job.cached); $('dashboard').hidden = false;
    }
  } catch (e) { showMessage(e.message, true); $('welcome').hidden = false; }
  finally { activeJob = null; $('progress').hidden = true; setBusy(false); }
}

function renderAnalysis(cached) {
  $('leaves').textContent = nf.format(BigInt(analysis.base.leaves));
  $('depth').textContent = analysis.base.depth;
  $('round-title').textContent = `КОН ${analysis.number} · СЧЁТ ДО НАЧАЛА`;
  $('initial-score').textContent = analysis.context.score.join(' : ');
  $('calculation-info').textContent = cached ? 'Готовый результат из памяти' : `${nf.format(analysis.stats.nodes)} позиций · ${(analysis.stats.elapsedMs / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} с`;
  $('legend').replaceChildren();
  for (let t = 0; t < 3; t++) {
    const item = element('span', 'legend-item'); item.append(element('i', `dot bg-${classes[t]}`), document.createTextNode(analysis.teams[t] ?? 'Ничья партии')); $('legend').append(item);
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
    row.append(element('td', step.delta[0] >= 0 ? 'a' : 'b', `${signed(step.delta[0])} п.п.`));
    row.append(element('td', 'draw', percent(step.probabilities[2], step.wins[2], step.leaves)));
    $('history').append(row);
  }
  renderStep();
}

function selectStep(index) {
  if (!analysis || busy) return;
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
      element('small', '', `${nf.format(BigInt(step.wins[t]))} / ${nf.format(BigInt(step.leaves))} исходов`));
    $('probabilities').append(card);
  }
  pair('delta', step.delta.map(v => signed(v)), ' п.п.'); pair('counts', step.counts); pair('points', step.points);
  $('choices').textContent = step.alternatives.length;
  $('fish').textContent = percent(step.fishProbability);
  $('eggs').textContent = analysis.context.fishVariant === 'withEggs' ? `В том числе с яйцами: ${percent(step.eggsProbability)}` : 'Рыба без яиц';
  $('turn-label').textContent = step.terminal ? 'Кон завершён' : `Ходит: ${analysis.players[step.turn].name}`;
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
    $('outcome').replaceChildren(element('strong', '', `${reason}. ${winner}.`), element('div', '', `Счёт после кона: ${o.totalScore.join(' : ')}. ${o.gameWinner === null ? 'Партия продолжается.' : 'Партия завершена.'}`),
      element('div', 'muted', `Победитель кона по исходным правилам: ${o.winnerTeam === null ? 'не назначается' : analysis.teams[o.winnerTeam]}. Завершил: ${analysis.players[o.finishedPlayer].name}.`));
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
  if (!step.alternatives.length) $('alternatives').append(element('p', 'muted', 'Дальнейших ходов нет. Кон завершён.'));
  [...$('history').children].forEach((row, i) => row.classList.toggle('active', i === stepIndex));
  renderChart();
}

function svgNode(tag, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderChart() {
  const chart = $('chart'); chart.replaceChildren();
  const x = i => 45 + i / (analysis.steps.length - 1) * 895;
  const y = p => 210 - p * 1.9;
  for (const p of [0, 25, 50, 75, 100]) {
    chart.append(svgNode('line', { x1: 45, x2: 940, y1: y(p), y2: y(p), stroke: '#e7ece6', 'stroke-dasharray': '3 5' }), svgNode('text', { x: 30, y: y(p) + 4, 'text-anchor': 'end', fill: '#89968c', 'font-size': 10 }, `${p}%`));
  }
  for (let t = 0; t < 3; t++) {
    if (t === 2 && analysis.steps.every(s => s.wins[2] === '0')) continue;
    const d = analysis.steps.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(s.probabilities[t])}`).join(' ');
    chart.append(svgNode('path', { d, fill: 'none', stroke: colors[t], 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }
  chart.append(svgNode('line', { x1: x(stepIndex), x2: x(stepIndex), y1: 14, y2: 218, stroke: '#839a8b', 'stroke-dasharray': '4 4' }));
  for (let t = 0; t < 2; t++) chart.append(svgNode('circle', { cx: x(stepIndex), cy: y(analysis.steps[stepIndex].probabilities[t]), r: 5, fill: colors[t], stroke: 'white', 'stroke-width': 2 }));
  for (let i = 0; i < analysis.steps.length; i++) {
    if (i % Math.max(1, Math.round(analysis.steps.length / 15)) === 0 || i === analysis.steps.length - 1)
      chart.append(svgNode('text', { x: x(i), y: 236, 'text-anchor': 'middle', fill: '#89968c', 'font-size': 10 }, i));
  }
}
$('chart').addEventListener('click', event => {
  if (!analysis) return;
  const bounds = $('chart').getBoundingClientRect();
  selectStep(Math.round(((event.clientX - bounds.left) / bounds.width * 960 - 45) / 895 * (analysis.steps.length - 1)));
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
$('demo').addEventListener('click', () => importSource(() => api('/api/example', { name: 'demo' }), 'Учебная партия · 3 кона'));
$('round').addEventListener('change', startAnalysis);
$('analyze').addEventListener('click', startAnalysis);
$('cancel').addEventListener('click', async () => {
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
