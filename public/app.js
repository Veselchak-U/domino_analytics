import { keyEpisodes, summarizePlayerQuality } from './quality.js';
import { chainTeams } from './domino.js';
import { aggregateImpacts, alternativeImpact, comparisonChance, decisionQuality, decisionSpread } from './impact.js';
import { formatCacheSize, formatPointDifference } from './format.js';
import { revealChartStep } from './navigation.js';
const $ = id => document.getElementById(id);
const colors = ['var(--a)', 'var(--b)', 'var(--draw)'];
const playerColors = ['var(--a)', 'var(--b)', 'var(--player-c)', 'var(--player-d)'];
const classes = ['a', 'b', 'draw'];
const nf = new Intl.NumberFormat('ru-RU');
const navigationSuffixes = ['', '-history'];
let game = null, analysis = null, stepIndex = 0, activeJob = null, busy = false;
let roundAnalyses = new Map(), stopQueue = false, selectedRound = 1;
let backgroundCalculation = false;
let episodeMinimum = 3;
let chartWidth = 960;
const chartInsets = { left: 120, right: 40 };

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
  for (const id of ['file', 'examples', 'demo']) $(id).disabled = value;
  for (const button of $('round-list').children) button.disabled = value;
  $('analyze-game').disabled = value;
  updateRoundButtons();
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
function renderMoveFacts(facts, actor) {
  const details = element('details', 'candidate-facts');
  details.append(element('summary', '', 'Факты после хода'));
  const before = facts.before[actor], after = facts.after[actor];
  details.append(element('p', '', `Рука автора: камней ${before.count} → ${after.count}; очков остатка ${before.points} → ${after.points}; дублей ${before.doubles} → ${after.doubles}; покрытых мастей ${before.coverage.length} → ${after.coverage.length}.`));
  details.append(element('p', '', `Открытые концы: ${facts.ends.join(' и ')}. Совместимых камней у автора: ${facts.actorCompatible}.`));
  details.append(element('p', '', `Новые значения в цепочке: ${facts.freshSuits.length ? facts.freshSuits.join(', ') : 'нет'}. Новизна относится к истории, а не к опасности хода.`));
  details.append(renderSuitProfile(facts.profile));
  if (facts.terminal) details.append(element('p', '', 'Раунд завершён. Следующего хода нет.'));
  else {
    details.append(element('p', '', `${analysis.players[facts.next.player].name}: ${facts.next.forcedPass ? 'обязательный пас' : `допустимых выкладок — ${facts.next.choices}`}.`));
    const p = facts.partner;
    details.append(element('p', '', `Партнёр ${analysis.players[p.player].name}: сейчас совместимых камней ${p.compatible}; после ответа соперника может выложить в ${p.replies} из ${p.branches} ветвей; раунд завершится до его очереди в ${p.ended} ветвях.`));
  }
  details.append(element('p', 'muted', 'Факты проверены с раскрытыми руками. Это не разложение влияния или потери на бонусы и не прогноз выбора игроков.'));
  return details;
}
function renderSuitProfile(profile) {
  const details = element('details', 'candidate-facts');
  details.append(element('summary', '', 'Масти и контроль концов'));
  details.append(element('p', 'muted', 'Раскрытые руки. В ячейках: камни / половинки. Дубль — один камень и две половинки. Контроль означает текущее владение, а не гарантированный ход.'));
  if (profile.terminal) details.append(element('p', '', 'Раунд завершён; следующего хода нет.'));
  if (!profile.ends.length) details.append(element('p', '', 'Заход ещё не сделан, открытых концов нет.'));
  profile.ends.forEach((end, i) => {
    const owner = end.kind === 'closed' ? 'закрыт, ответов нет' : end.kind === 'player'
      ? `исключительный контроль игрока ${analysis.players[end.players[0]].name}`
      : end.kind === 'team' ? `исключительный контроль команды ${analysis.teams[end.team]}` : 'совместное владение команд';
    details.append(element('p', '', `${i ? 'Правый' : 'Левый'} конец ${end.value}: ${owner}. Камни есть у: ${end.players.map(p => analysis.players[p].name).join(', ') || 'никого'}.`));
  });
  const wrap = element('div', 'history-scroll'), table = element('table'), head = element('tr');
  for (const label of ['Масть', 'Осталось', 'Сыграно', ...analysis.players.map(p => p.name), ...analysis.teams.slice(0, 2)]) head.append(element('th', '', label));
  const thead = element('thead'); thead.append(head); table.append(thead);
  const body = element('tbody');
  for (const suit of profile.suits) {
    const row = element('tr');
    for (const value of [suit.value, `${suit.remainingTiles} / ${suit.remainingHalves}`, `${suit.playedTiles} / ${suit.playedHalves}`,
      ...suit.players.map(p => `${p.tiles} / ${p.halves}`), ...suit.teams.map(p => `${p.tiles} / ${p.halves}`)]) row.append(element('td', '', value));
    body.append(row);
  }
  table.append(body); wrap.append(table); details.append(wrap); return details;
}
function renderTerminalDecision(decision) {
  const { before, outcome: o } = decision;
  const reason = { emptyHand: 'Выход', fish: 'Рыба', eggs: 'Рыба с яйцами' }[o.reason];
  const name = team => team === null ? 'не назначен' : team === 2 ? 'Ничья партии' : analysis.teams[team];
  const details = element('details', 'candidate-facts settlement-review');
  details.append(element('summary', '', `Завершение раунда: ${reason}`));
  details.append(element('p', '', `Завершил: ${analysis.players[o.finishedPlayer].name}. Победитель по правилам: ${name(o.winnerTeam)}. Аналитический победитель: ${name(o.analyticsWinner)}.`));
  for (let t = 0; t < 2; t++) details.append(element('p', '', `${analysis.teams[t]}: остаток ${o.residual[t]}; начислено за раунд ${o.roundScore[t]}; забор ${before.fence[t]} → ${o.fence[t]}; счёт ${before.score[t]} → ${o.totalScore[t]}.`));
  details.append(element('p', '', `Банк яиц: ${before.eggs} → ${o.eggs}. ${o.gameWinner === null ? 'Партия продолжается.' : `Партия завершена: ${name(o.gameWinner)}.`}`));
  if (o.reason !== 'emptyHand') details.append(element('p', 'muted', o.gameWinner === null
    ? 'Партия не завершена: аналитический исход рыбы относится к команде рыбака. Дубль не меняет рыбака.'
    : 'Партия завершена: аналитический исход рыбы определяется итогом партии, включая ничью, независимо от команды рыбака.'));
  return details;
}
function renderOutcomeComposition(result, title) {
  const details = element('details', 'candidate-facts composition');
  details.append(element('summary', '', title));
  const wrap = element('div', 'history-scroll'), table = element('table'), header = element('tr');
  for (const label of ['Завершение', ...analysis.teams.slice(0, 2), 'Ничья партии', 'Всего']) header.append(element('th', '', label));
  const thead = element('thead'); thead.append(header); table.append(thead);
  const body = element('tbody'), denominator = BigInt(result.leaves);
  for (const [reason, label] of [['emptyHand', 'Выход'], ['fish', 'Рыба'], ['eggs', 'Яйца']]) {
    const counts = result.outcomes[reason].map(BigInt), row = element('tr'); row.append(element('th', '', label));
    for (const count of [...counts, counts.reduce((n, v) => n + v, 0n)]) {
      row.append(element('td', '', `${nf.format(count)} (${formatPointDifference({ numerator: count, denominator })})`));
    }
    body.append(row);
  }
  const total = element('tr'); total.append(element('th', '', 'Всего'));
  for (const count of [...result.wins.map(BigInt), denominator]) total.append(element('td', '', nf.format(count)));
  body.append(total); table.append(body); wrap.append(table); details.append(wrap);
  details.append(element('p', 'muted', 'Точные количества и доли от всех исходов этой позиции. Строки не пересекаются: яйца выделены отдельно. Общая частота рыбы включает строки «Рыба» и «Яйца» и не равна доле выигрышных рыб.'));
  return details;
}
const pipLayout = [[], [[50, 50]], [[24, 24], [76, 76]], [[24, 24], [50, 50], [76, 76]],
  [[24, 24], [76, 24], [24, 76], [76, 76]],
  [[24, 24], [76, 24], [50, 50], [24, 76], [76, 76]],
  [[24, 24], [76, 24], [24, 50], [76, 50], [24, 76], [76, 76]]];
const doubleSixLayout = [[24, 24], [50, 24], [76, 24], [24, 76], [50, 76], [76, 76]];
function domino(stone, layout) {
  const values = stone.split('-').map(Number);
  const node = element('span', values[0] === values[1] ? 'domino double-domino' : 'domino');
  node.setAttribute('role', 'img'); node.setAttribute('aria-label', stone.replace('-', '–'));
  node.title = stone;
  for (const n of values) {
    const half = element('span', 'half');
    for (const [x, y] of (stone === '6-6' && layout !== 'hand' ? doubleSixLayout : pipLayout[n])) {
      const pip = element('i', 'pip'); pip.style.left = `${x}%`; pip.style.top = `${y}%`; half.append(pip);
    }
    node.append(half);
  }
  return node;
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
    $('game-source').textContent = `Партия: ${name}`;
    $('game-source').hidden = false;
    const variant = `Козёл, 2x2, до ${game.scoreLimit} ${game.scoreLimit === 101 ? 'очка' : 'очков'}, ${game.fishVariant === 'withEggs' ? 'с яйцами' : 'без яиц'}`;
    $('rules-label').textContent = variant;
    $('game-variant').textContent = `Вариант игры: ${variant}`;
    selectedRound = game.rounds[0].number; $('round-list').replaceChildren();
    for (const round of game.rounds) {
      const button = element('button', 'round-chip', `Раунд ${round.number}  ·  ${round.score.join(' : ')}`);
      button.addEventListener('click', () => selectRound(round.number));
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
  const round = selectedRound;
  markSelectedRound(round);
  try {
    const job = await requestRound(round);
    if (job.status === 'error') throw new Error(job.error);
    if (job.status === 'cancelled') {
      showMessage('Расчёт отменён. Выберите раунд для повторного запуска.');
      $('welcome').hidden = false;
    } else {
      analysis = job.result; stepIndex = 0;
      roundAnalyses.set(round, analysis);
      renderAnalysis(); $('dashboard').hidden = false;
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
    $('progress-text').textContent = `Раунд ${round} из ${game.rounds.length} · ${nf.format(stats.nodes)} позиций · ${nf.format(stats.hits)} из кеша · Кеш ≈ ${formatCacheSize(stats.cacheBytesEstimate ?? 0)} · ${(stats.elapsedMs / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} с`;
    await new Promise(resolve => setTimeout(resolve, 500));
    job = await api(`/api/jobs/${job.id}`);
  }
  activeJob = null;
  return job;
}

async function analyzeGame() {
  if (!game || busy || roundAnalyses.size === game.rounds.length) return;
  showMessage('');
  backgroundCalculation = true; setBusy(true); stopQueue = false; $('progress').hidden = false; $('cancel').disabled = false;
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
  finally { activeJob = null; backgroundCalculation = false; $('progress').hidden = true; setBusy(false); renderPlayerImpacts(); }
}

function markSelectedRound(number) {
  selectedRound = number;
  [...$('round-list').children].forEach((node, i) => node.classList.toggle('active', i === number - 1));
}

function selectRound(number) {
  if (!game || (busy && (!backgroundCalculation || !roundAnalyses.has(number)))) return;
  markSelectedRound(number);
  const ready = roundAnalyses.get(number);
  if (!ready) { startAnalysis(); return; }
  analysis = ready; stepIndex = 0; renderAnalysis();
}

function updateRoundButtons() {
  for (const button of document.querySelectorAll('#player-impact-table button[data-round]')) {
    button.disabled = busy && (!backgroundCalculation || !roundAnalyses.has(Number(button.dataset.round)));
  }
}

function roundButton(number, text, label) {
  const button = element('button', 'round-select-button', text);
  button.type = 'button'; button.dataset.round = number;
  button.setAttribute('aria-label', label ?? `Выбрать раунд ${number}`);
  button.setAttribute('aria-pressed', String(number === analysis.number));
  button.title = `${roundAnalyses.has(number) ? 'Открыть' : 'Рассчитать'} раунд ${number}`;
  button.addEventListener('click', () => selectRound(number));
  return button;
}

function renderPlayerImpacts() {
  const summary = aggregateImpacts([...roundAnalyses.values()], game.players, game.rounds.length);
  $('impact-status').textContent = summary.complete ? `Вся партия рассчитана · ${summary.completedRounds} раундов` : `Рассчитано ${summary.completedRounds} из ${game.rounds.length} раундов · итог партии ещё не готов`;
  $('analyze-game').hidden = summary.complete;
  const head = element('tr');
  head.append(element('th', '', 'Игрок'), element('th', '', 'Команда'));
  for (const round of summary.byRound) {
    const cell = element('th', round.number === analysis.number ? 'selected-round' : '');
    cell.append(roundButton(round.number, `Раунд ${round.number}`)); head.append(cell);
  }
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
      const cell = element('td', `${value < 0 ? 'negative' : 'positive'} ${round.number === analysis.number ? 'selected-round' : ''}`);
      cell.append(roundButton(round.number, value == null ? '—' : `${signed(value)} %`, `Выбрать раунд ${round.number}, ${player.name}`));
      row.append(cell);
    }
    const total = summary.totals[p];
    row.append(element('td', total < 0 ? 'negative' : 'positive', total === null ? '—' : `${signed(total)} %`));
    $('player-impact-body').append(row);
  });
  updateRoundButtons(); renderQualitySummary();
}

function renderQualitySummary() {
  const summary = summarizePlayerQuality([...roundAnalyses.values()], game.players, game.rounds.length);
  const current = summary.byRound.find(r => r.number === analysis.number);
  $('quality-status').textContent = `Раунд ${analysis.number} · Рассчитано ${summary.completedRounds} из ${game.rounds.length} раундов · ${summary.complete ? 'итог партии готов' : 'итог партии ещё не готов'}`;
  $('quality-body').replaceChildren();
  for (const [label, values] of [[`Раунд ${analysis.number}${current?.complete ? '' : ' (неполно)'}`, current?.players], ['Вся партия', summary.players]]) {
    game.players.forEach((player, i) => {
      const row = element('tr'), p = values?.[i];
      row.append(element('td', '', player.name), element('td', '', label));
      row.append(element('td', '', p ? `${p.best} из ${p.decisions}` : '—'));
      for (const key of ['bestShare', 'averageLoss', 'maxLoss']) row.append(element('td', '', p?.[key] ? formatPointDifference(p[key]) : '—'));
      for (const key of ['forced', 'equivalent', 'unavailable']) row.append(element('td', '', p ? p[key] : '—'));
      $('quality-body').append(row);
    });
  }
}

function renderKeyEpisodes() {
  const groups = keyEpisodes(analysis, 5, episodeMinimum);
  $('episodes-round').textContent = `Раунд ${analysis.number}`;
  $('episode-groups').replaceChildren();
  for (const [key, title, metric, label] of [
    ['gains', 'Рост оценки', 'impact', 'Влияние'],
    ['drops', 'Снижение оценки', 'impact', 'Влияние'],
    ['losses', 'Упущенные возможности', 'loss', 'Потеря'],
    ['spreads', 'Разброс альтернатив', 'range', 'Разброс'],
  ]) {
    const group = element('section', 'episode-group');
    group.dataset.category = key;
    group.append(element('h3', '', title));
    const list = element('ol', 'episode-list');
    for (const episode of groups[key]) {
      const item = element('li'), button = element('button', 'episode-button');
      button.type = 'button'; button.dataset.position = episode.position;
      button.setAttribute('aria-label', `Перед ходом ${episode.actionStep}: ${episode.move.player}, ${label.toLowerCase()} ${formatPointDifference(episode[metric], metric === 'impact')}`);
      button.append(element('span', '', `Ход ${episode.actionStep} · ${episode.move.player} · ${actionText(episode.move)}`),
        element('strong', '', `${label} ${formatPointDifference(episode[metric], metric === 'impact')} →`));
      button.addEventListener('click', () => {
        selectStep(episode.position);
        $('choices-title').focus({ preventScroll: true });
        $('choices-title').scrollIntoView({ block: 'start' });
      });
      item.append(button); list.append(item);
    }
    group.append(groups[key].length ? list : element('p', 'muted', 'Эпизодов по этому фильтру нет.'));
    $('episode-groups').append(group);
  }
}

function renderAnalysis() {
  chartWidth = Math.max(960, (analysis.steps.length - 1) * 64 + chartInsets.left + chartInsets.right);
  $('charts-canvas').style.minWidth = `${chartWidth}px`;
  $('chart').setAttribute('viewBox', `0 0 ${chartWidth} 240`);
  $('impact-chart').setAttribute('viewBox', `0 0 ${chartWidth} 365`);
  $('player-legend').replaceChildren();
  analysis.players.forEach((p, i) => {
    const item = element('span', 'legend-item');
    item.style.color = colors[i % 2];
    const badge = element('span', 'player-badge', `P${i + 1}`);
    item.append(badge, document.createTextNode(p.name)); $('player-legend').append(item);
  });
  $('leaves').textContent = nf.format(BigInt(analysis.base.leaves));
  $('depth').textContent = analysis.base.depth;
  $('min-depth').textContent = analysis.base.minDepth;
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
  for (const suffix of navigationSuffixes) $(`slider${suffix}`).max = analysis.steps.length - 1;
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
  renderPlayerImpacts(); renderKeyEpisodes(); renderStep();
}

function selectStep(index) {
  if (!analysis) return;
  stepIndex = Math.max(0, Math.min(analysis.steps.length - 1, index)); renderStep();
  revealChartStep($('charts-canvas').parentElement, $('impact-chart').querySelector(`[data-step="${stepIndex}"]`));
}
function renderStep() {
  const step = analysis.steps[stepIndex];
  for (const suffix of navigationSuffixes) {
    $(`slider${suffix}`).value = stepIndex;
    $(`first${suffix}`).disabled = $(`prev${suffix}`).disabled = stepIndex === 0;
    $(`last${suffix}`).disabled = $(`next${suffix}`).disabled = stepIndex === analysis.steps.length - 1;
    $(`step-count${suffix}`).textContent = `ПОЗИЦИЯ ${stepIndex} / ${analysis.steps.length - 1}`;
    $(`move-title${suffix}`).textContent = step.move ? `${step.move.player} · ${actionText(step.move)}` : 'До первого хода · базовые шансы';
  }
  $('probabilities').replaceChildren();
  for (let t = 0; t < 3; t++) {
    const card = element('div', 'probability');
    card.append(element('span', '', analysis.teams[t] ?? 'Ничья партии'), element('strong', classes[t], percent(step.probabilities[t], step.wins[t], step.leaves)),
      element('small', '', `${nf.format(BigInt(step.wins[t]))} / ${nf.format(BigInt(step.leaves))} исходов из позиции ${stepIndex}`));
    $('probabilities').append(card);
  }
  $('turn-label').textContent = step.terminal ? 'Раунд завершён' : `Ходит: ${analysis.players[step.turn].name}`;
  const tileTeams = chainTeams(step.chain, analysis.steps[0].hands);
  $('chain').replaceChildren(...(step.chain.length ? step.chain.map((stone, i) => {
    const tile = domino(stone), team = tileTeams[i];
    tile.classList.add(`tile-team-${team}`);
    tile.title = `${stone} · ${analysis.teams[team]}`;
    tile.setAttribute('aria-label', `${stone.replace('-', '–')} · ${analysis.teams[team]}`);
    return tile;
  }) : [element('span', 'chain-empty', 'Цепочка ещё не начата')]));
  $('ends').textContent = step.ends.length ? `Открытые концы: ${step.ends.join(' и ')}${step.fisher >= 0 ? ` · Последний недубль: ${analysis.players[step.fisher].name}` : ''}` : `Заходит: ${analysis.players[step.turn].name}`;
  $('hands').replaceChildren();
  step.hands.forEach((stones, p) => {
    const card = element('div', `hand ${p % 2 ? 'team-b' : ''} ${!step.terminal && p === step.turn ? 'active' : ''}`);
    card.append(element('div', 'hand-name', analysis.players[p].name), element('div', 'hand-meta', `${analysis.teams[p % 2]} · место ${p + 1} · камней: ${stones.length}`));
    const hand = element('div', 'hand-stones');
    hand.append(...(stones.length ? stones.map(stone => domino(stone, 'hand')) : [element('span', 'muted', 'Пустая рука')])); card.append(hand); $('hands').append(card);
  });
  $('outcome').hidden = !step.terminal;
  $('suit-profile').replaceChildren(renderSuitProfile(step.suits));
  $('outcome-composition').replaceChildren(renderOutcomeComposition(step, 'Состав исходов позиции'));
  if (step.terminal) {
    const o = analysis.outcome, reason = { emptyHand: 'Выход', fish: analysis.context.fishVariant === 'withEggs' ? 'Рыба' : 'Рыба без яиц', eggs: 'Рыба с яйцами' }[o.reason];
    const winner = o.analyticsWinner === 2 ? 'Ничья партии' : `Аналитический победитель: ${analysis.teams[o.analyticsWinner]}`;
    $('outcome').replaceChildren(element('strong', '', `${reason}. ${winner}.`), element('div', '', `Счёт после раунда: ${o.totalScore.join(' : ')}. ${o.gameWinner === null ? 'Партия продолжается.' : 'Партия завершена.'}`),
      element('div', 'muted', `Победитель раунда по исходным правилам: ${o.winnerTeam === null ? 'не назначается' : analysis.teams[o.winnerTeam]}. Завершил: ${analysis.players[o.finishedPlayer].name}.`));
  }
  const quality = decisionQuality(step);
  $('choice-position').textContent = quality.actual
    ? `Позиция ${stepIndex} · перед ходом ${stepIndex + 1}: ${analysis.steps[stepIndex + 1].move.player}`
    : `Позиция ${stepIndex} · записанного следующего хода нет`;
  const choiceLabels = { forced: 'Вынужденный ход', equivalent: 'Равноценный выбор', choice: 'Разные оценки' };
  $('choice-status').textContent = quality.kind === 'terminal' ? 'Раунд завершён'
    : quality.kind === 'forced' ? choiceLabels.forced : `${choiceLabels[quality.kind]} · Лучших вариантов: ${quality.bestCount} из ${quality.entries.length}`;
  const spread = decisionSpread(step);
  $('choice-spread').textContent = `Разброс: ${spread.range ? formatPointDifference(spread.range) : '—'} · Отрыв лидера: ${spread.gap ? formatPointDifference(spread.gap) : quality.kind === 'forced' ? '— (нет второго варианта)' : '—'}`;
  $('recorded-choice').hidden = !quality.actual || quality.kind === 'forced';
  if (quality.actual) {
    const { alternative, loss } = quality.actual;
    $('recorded-choice').textContent = `В игре: ${actionText(alternative)} · Влияние ${signed(alternativeImpact(step, alternative))} % · Упущенная возможность по анализатору: ${formatPointDifference(loss)}`;
  }
  $('alternatives').replaceChildren();
  for (const { alternative, best, loss } of quality.entries) {
    const card = element('div', `alternative${alternative.actual ? ' actual-alternative' : ''}`), head = element('div', 'alternative-head');
    if (alternative.stone) head.append(domino(alternative.stone));
    head.append(element('span', '', actionText(alternative)));
    const impact = alternativeImpact(step, alternative);
    if (quality.kind !== 'forced') head.append(element('span', `alternative-impact ${impact > 0 ? 'positive' : impact < 0 ? 'negative' : ''}`, `Влияние ${signed(impact)} %`));
    if (best && quality.kind !== 'forced') head.append(element('span', 'best-marker', quality.bestCount > 1 ? 'Один из лучших' : 'Лучший'));
    if (alternative.actual) head.append(element('span', 'actual', 'В игре'));
    const chances = element('div', 'alt-chances');
    for (let t = 0; t < 2; t++) chances.append(element('span', classes[t], percent(alternative.probabilities[t], alternative.wins[t], alternative.leaves)));
    const bar = element('div', 'chance-bar');
    for (let t = 0; t < 3; t++) { const segment = element('span', `bg-${classes[t]}`); segment.style.width = `${alternative.probabilities[t]}%`; bar.append(segment); }
    card.append(head);
    if (quality.kind !== 'forced') card.append(element('div', `opportunity-loss ${loss.numerator > 0n ? 'negative' : ''}`, `Потеря к лучшему: ${formatPointDifference(loss)}`));
    card.append(chances, bar, element('div', 'alt-leaves', `${nf.format(BigInt(alternative.leaves))} исходов · ничья ${percent(alternative.probabilities[2], alternative.wins[2], alternative.leaves)}`));
    if (alternative.facts) card.append(renderMoveFacts(alternative.facts, step.turn));
    if (alternative.settlement) card.append(renderTerminalDecision(alternative.settlement));
    card.append(renderOutcomeComposition(alternative, 'Состав исходов хода'));
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
    chart.append(svgNode('line', { x1: chartInsets.left, x2: chartWidth - chartInsets.right, y1: y(p), y2: y(p), stroke: 'var(--line)', 'stroke-dasharray': '3 5' }), svgNode('text', { x: 65, y: y(p) + 5, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 14 }, percent(p)));
  }
  for (let t = 0; t < 3; t++) {
    if (t === 2 && analysis.steps.every(s => s.wins[2] === '0')) continue;
    const d = analysis.steps.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(s.probabilities[t])}`).join(' ');
    chart.append(svgNode('path', { d, fill: 'none', stroke: colors[t], 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }
  for (let t = 0; t < 2; t++) {
    const d = analysis.steps.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(comparisonChance(s, t, 'best').probability)}`).join(' ');
    const line = svgNode('path', { d, fill: 'none', stroke: colors[t], 'stroke-width': 2.5,
      'stroke-dasharray': '8 6', 'stroke-linejoin': 'round', 'data-best-team': t });
    line.append(svgNode('title', {}, `Лучший доступный шанс · ${analysis.teams[t]}`)); chart.append(line);
  }
  for (let t = 0; t < 2; t++) {
    const d = analysis.steps.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(comparisonChance(s, t, 'worst').probability)}`).join(' ');
    const line = svgNode('path', { d, fill: 'none', stroke: colors[t], 'stroke-width': 2.5,
      'stroke-dasharray': '1 7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-worst-team': t });
    line.append(svgNode('title', {}, `Худший доступный шанс · ${analysis.teams[t]}`)); chart.append(line);
  }
  const selected = analysis.steps[stepIndex];
  $('best-chances').textContent = `${stepIndex ? 'Лучший шанс (на чужом ходе — факт)' : 'Базовые шансы'}: ` + analysis.teams.map((name, t) => {
    const chance = comparisonChance(selected, t, 'best');
    return `${name} ${percent(chance.probability, chance.wins, chance.leaves)}`;
  }).join(' · ');
  $('worst-chances').textContent = `${stepIndex ? 'Худший шанс (на чужом ходе — факт)' : 'Базовые шансы'}: ` + analysis.teams.map((name, t) => {
    const chance = comparisonChance(selected, t, 'worst');
    return `${name} ${percent(chance.probability, chance.wins, chance.leaves)}`;
  }).join(' · ');
  chart.append(svgNode('line', { x1: x(stepIndex), x2: x(stepIndex), y1: 14, y2: 218, stroke: 'var(--axis)', 'stroke-dasharray': '4 4' }));
  for (let t = 0; t < 2; t++) chart.append(svgNode('circle', { cx: x(stepIndex), cy: y(analysis.steps[stepIndex].probabilities[t]), r: 5, fill: colors[t], stroke: 'var(--surface)', 'stroke-width': 2 }));
  for (let i = 0; i < analysis.steps.length; i++) {
    if (i % Math.max(1, Math.round(analysis.steps.length / 15)) === 0 || i === analysis.steps.length - 1)
      chart.append(svgNode('text', { x: x(i), y: 236, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 14 }, i));
  }
}
function chartX(i) { return chartInsets.left + i / (analysis.steps.length - 1) * (chartWidth - chartInsets.left - chartInsets.right); }
function renderImpactChart() {
  const chart = $('impact-chart'); chart.replaceChildren();
  const defs = svgNode('defs', {});
  analysis.players.forEach((_, p) => {
    const color = colors[p % 2];
    const pattern = svgNode('pattern', { id: `best-hatch-${p}`, width: 7, height: 7, patternUnits: 'userSpaceOnUse' });
    pattern.append(svgNode('rect', { width: 7, height: 7, fill: 'var(--surface)' }),
      svgNode('path', { d: 'M-2,2 L2,-2 M0,7 L7,0 M5,9 L9,5', stroke: color, 'stroke-width': 1.5 }));
    defs.append(pattern);
    const dots = svgNode('pattern', { id: `worst-dots-${p}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse' });
    dots.append(svgNode('rect', { width: 6, height: 6, fill: 'var(--surface)' }),
      svgNode('circle', { cx: 3, cy: 3, r: 1.3, fill: color }));
    defs.append(dots);
  });
  chart.append(defs);
  const max = Math.max(10, ...analysis.steps.map(s => Math.max(Math.abs(s.impact?.value ?? 0), Math.abs(s.best.impact?.value ?? 0), Math.abs(s.worst.impact?.value ?? 0))));
  const y = v => 118 - v / max * 82;
  for (const value of [-max, 0, max]) {
    chart.append(svgNode('line', { x1: chartInsets.left, x2: chartWidth - chartInsets.right, y1: y(value), y2: y(value), stroke: value === 0 ? 'var(--axis)' : 'var(--line)', 'stroke-dasharray': value === 0 ? 'none' : '3 5' }),
      svgNode('text', { x: 105, y: y(value) + 5, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 13 }, `${signed(value)} %`));
  }
  chart.append(svgNode('text', { x: 65, y: 235, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 12 }, 'Лучший'));
  chart.append(svgNode('text', { x: 65, y: 256, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 12 }, 'Факт'));
  chart.append(svgNode('text', { x: 65, y: 277, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 12 }, 'Худший'));
  chart.append(svgNode('line', { x1: chartX(stepIndex), x2: chartX(stepIndex), y1: 20, y2: 350, stroke: 'var(--muted)', 'stroke-dasharray': '4 4' }));
  analysis.steps.forEach((step, i) => {
    const impact = step.impact, value = impact?.value ?? 0;
    const best = step.best.impact, worst = step.worst.impact;
    const color = impact ? colors[impact.player % 2] : 'var(--muted)';
    const description = impact ? `Ход ${i}. P${impact.player + 1}: ${analysis.players[impact.player].name}. Лучший ${signed(best.value)} %: ${actionText(best.move)}. Факт ${signed(value)} %. Худший вероятный ход ${signed(worst.value)} %: ${actionText(worst.move)}` : 'Шаг 0. До первого хода. Влияние 0,00 %. Альтернативных действий нет';
    const group = svgNode('g', { role: 'button', tabindex: 0, 'aria-label': description, 'data-step': i });
    group.append(svgNode('title', {}, description));
    if (i === stepIndex) group.append(svgNode('rect', { x: chartX(i) - 28, y: 217, width: 56, height: 133, rx: 5, fill: 'var(--highlight)' }));
    if (best) group.append(svgNode('rect', { x: chartX(i) - 21, y: Math.min(y(best.value), y(0)), width: 14, height: Math.max(2, Math.abs(y(best.value) - y(0))), fill: `url(#best-hatch-${impact.player})`, stroke: color, 'stroke-width': 1, 'data-kind': 'best' }));
    group.append(svgNode('rect', { x: chartX(i) - 7, y: Math.min(y(value), y(0)), width: 14, height: Math.max(2, Math.abs(y(value) - y(0))), fill: color, 'data-kind': 'actual' }));
    if (worst) group.append(svgNode('rect', { x: chartX(i) + 7, y: Math.min(y(worst.value), y(0)), width: 14, height: Math.max(2, Math.abs(y(worst.value) - y(0))), fill: `url(#worst-dots-${impact.player})`, stroke: color, 'stroke-width': 1, 'data-kind': 'worst' }));
    group.append(svgNode('text', { x: chartX(i), y: 235, 'text-anchor': 'middle', fill: color, 'font-size': 13 }, best ? signed(best.value) : '—'),
      svgNode('text', { x: chartX(i), y: 256, 'text-anchor': 'middle', fill: color, 'font-size': 13, 'font-weight': 600 }, signed(value)),
      svgNode('text', { x: chartX(i), y: 277, 'text-anchor': 'middle', fill: color, 'font-size': 13 }, worst ? signed(worst.value) : '—'),
      svgNode('text', { x: chartX(i), y: 307, 'text-anchor': 'middle', fill: color, 'font-size': 14, 'font-weight': 700 }, impact ? `P${impact.player + 1}` : '—'),
      svgNode('text', { x: chartX(i), y: 336, 'text-anchor': 'middle', fill: color, 'font-size': 14 }, i));
    group.addEventListener('click', e => { e.stopPropagation(); selectStep(i); });
    group.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStep(i); } });
    chart.append(group);
  });
  const current = analysis.steps[stepIndex].impact;
  const best = analysis.steps[stepIndex].best.impact;
  const worst = analysis.steps[stepIndex].worst.impact;
  $('impact-selection').style.color = current ? colors[current.player % 2] : 'var(--muted)';
  const quality = stepIndex ? decisionQuality(analysis.steps[stepIndex - 1]) : null;
  const bestLabel = quality?.bestCount > 1 ? 'один из лучших' : 'лучший';
  $('impact-selection').textContent = current ? `Ход ${stepIndex} · P${current.player + 1} ${analysis.players[current.player].name} · ${bestLabel} ${signed(best.value)} % (${actionText(best.move)}) · факт ${signed(current.value)} % · худший ${signed(worst.value)} % (${actionText(worst.move)})` : 'До первого хода · влияние 0,00 %';
  $('decision-loss').textContent = current && quality.actual
    ? `Ход ${stepIndex} · ${analysis.players[current.player].name} · Влияние ${signed(current.value)} % · Упущенная возможность по анализатору: ${formatPointDifference(quality.actual.loss)}`
    : 'До первого хода · предыдущее решение отсутствует';
}
for (const id of ['chart', 'impact-chart']) $(id).addEventListener('click', event => {
  if (!analysis) return;
  const bounds = $(id).getBoundingClientRect();
  selectStep(Math.round(((event.clientX - bounds.left) / bounds.width * chartWidth - chartInsets.left) / (chartWidth - chartInsets.left - chartInsets.right) * (analysis.steps.length - 1)));
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
$('analyze-game').addEventListener('click', analyzeGame);
$('episode-minimum').addEventListener('input', () => {
  const input = $('episode-minimum');
  const valid = input.value !== '' && input.checkValidity();
  input.setAttribute('aria-invalid', String(!valid));
  $('episode-filter-error').hidden = valid;
  if (!valid) return;
  episodeMinimum = input.valueAsNumber;
  if (analysis) renderKeyEpisodes();
});
$('cancel').addEventListener('click', async () => {
  stopQueue = true;
  if (!activeJob) return;
  $('cancel').disabled = true;
  try { await api(`/api/jobs/${activeJob}`, undefined, 'DELETE'); }
  catch (e) { showMessage(e.message, true); $('cancel').disabled = false; }
});
for (const suffix of navigationSuffixes) {
  $(`slider${suffix}`).addEventListener('input', () => selectStep(Number($(`slider${suffix}`).value)));
  $(`first${suffix}`).addEventListener('click', () => selectStep(0));
  $(`last${suffix}`).addEventListener('click', () => selectStep(analysis.steps.length - 1));
  $(`prev${suffix}`).addEventListener('click', () => selectStep(stepIndex - 1));
  $(`next${suffix}`).addEventListener('click', () => selectStep(stepIndex + 1));
}
document.addEventListener('keydown', event => {
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); selectStep(stepIndex + (event.key === 'ArrowRight' ? 1 : -1)); }
});
$('welcome-tiles').replaceChildren(...['1-1', '1-6', '6-3'].map(stone => domino(stone, 'hand')));
try {
  const { files } = await api('/api/examples');
  for (const file of files) { const option = element('option', '', file); option.value = file; $('examples').append(option); }
} catch (e) { showMessage(e.message, true); }
