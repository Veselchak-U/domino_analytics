import { lessonCatalog } from './lessons.js';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseGame } from './input.js';
import { gameSummary } from './analysis.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY = 5 * 1024 * 1024;
const sha = text => createHash('sha256').update(text).digest('hex');
function remember(map, key, value, limit = 8) {
  map.delete(key); map.set(key, value);
  while (map.size > limit) {
    const oldest = [...map].find(([, entry]) => entry.status !== 'running');
    if (!oldest) break;
    map.delete(oldest[0]);
  }
}

async function body(req) {
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Файл слишком большой: максимум 5 МБ');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Неверное тело HTTP-запроса'); }
}

/** One local server owns games, result cache, and at most one active worker. */
export function createApp({ examplesDir = process.env.DOMINO_EXAMPLES_DIR ?? 'C:/Projects/Home/domino_video_parser/out' } = {}) {
  const games = new Map(), jobs = new Map(), completed = new Map();
  let active = null;
  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  function view(job) {
    return { id: job.id, status: job.status, stats: job.stats, error: job.error,
      cached: job.cached ?? false, ...(job.status === 'done' ? { result: job.result } : {}) };
  }
  function importGame(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BODY) throw new Error('Ожидается JSON-файл размером до 5 МБ');
    const id = sha(text), existing = games.get(id);
    if (existing) { remember(games, id, existing); return { id, ...existing.summary }; }
    const game = parseGame(text), summary = gameSummary(game);
    remember(games, id, { text, summary });
    return { id, ...summary };
  }
  async function examples() {
    try { return (await readdir(examplesDir)).filter(f => f.endsWith('.json') && !f.includes('needs-review')).sort(); }
    catch { return []; }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    try {
      // Keep a loopback application private from cross-origin pages and DNS rebinding.
      const expectedHost = `127.0.0.1:${server.address()?.port}`;
      if (req.headers.host !== expectedHost && req.headers.host !== `localhost:${server.address()?.port}`)
        return json(res, 403, { error: 'Недопустимый адрес сервера' });
      if (req.headers.origin && ![`http://${expectedHost}`, `http://localhost:${server.address()?.port}`].includes(req.headers.origin))
        return json(res, 403, { error: 'Допустимы только локальные запросы приложения' });
      const url = new URL(req.url, `http://${expectedHost}`), route = url.pathname;
      if (req.method === 'GET' && route === '/api/examples') return json(res, 200, { files: await examples() });
      if (req.method === 'POST' && route === '/api/import') {
        const data = await body(req);
        return json(res, 200, importGame(data.text));
      }
      if (req.method === 'POST' && route === '/api/example') {
        const data = await body(req);
        let text;
        if (data.name === 'demo') text = await readFile(new URL('../contracts/kozel-game.example.json', import.meta.url), 'utf8');
        else {
          if (!(await examples()).includes(data.name)) throw new Error('Такого готового примера нет');
          text = await readFile(path.join(examplesDir, data.name), 'utf8');
        }
        return json(res, 200, importGame(text));
      }
      if (req.method === 'GET' && route === '/api/lessons') return json(res, 200, { lessons: lessonCatalog() });
      if (req.method === 'POST' && ['/api/analyze', '/api/branch', '/api/lesson'].includes(route)) {
        const data = await body(req);
        let key, workerData;
        if (route === '/api/lesson') {
          if (Object.keys(data).some(k => !['id', 'mirror'].includes(k)) || !lessonCatalog().some(l => l.id === data.id)
            || (data.mirror !== undefined && typeof data.mirror !== 'boolean')) throw new Error('Неверные параметры упражнения');
          key = 'lesson:' + data.id + ':' + !!data.mirror;
          workerData = { lessonId: data.id, mirror: !!data.mirror };
        } else {
          const { gameId, round } = data, game = games.get(gameId);
          if (!game) throw new Error('Загрузите журнал заново: его нет в памяти');
          if (!Number.isInteger(round) || round < 1 || round > game.summary.rounds.length) throw new Error('Неверный номер раунда');
          let branch;
          if (route === '/api/branch') {
            const { position, moves, example } = data;
            if (!Number.isInteger(position) || position < 0 || position > game.summary.rounds[round - 1].moves) throw new Error('Неверная позиция ветки');
            if (!Array.isArray(moves) || moves.length > 128 || moves.some(m => !m || typeof m !== 'object'
              || Object.keys(m).some(k => !['action', 'stone'].includes(k)) || !['start', 'left', 'right', 'pass'].includes(m.action)
              || (m.action === 'pass' ? m.stone !== undefined : !/^[0-6]-[0-6]$/.test(m.stone)))) throw new Error('Неверный путь ветки');
            if (example !== undefined && !['win', 'loss', 'draw'].includes(example)) throw new Error('Неверный режим примера');
            branch = { position, moves: moves.map(({ action, stone }) => ({ action, ...(stone ? { stone } : {}) })), ...(example ? { example } : {}) };
          }
          key = `${gameId}:${round}${branch ? ':branch:' + JSON.stringify(branch) : ''}`;
          workerData = { text: game.text, round, branch };
        }
        const cached = completed.get(key);
        if (cached) {
          remember(completed, key, cached);
          const job = { id: randomUUID(), status: 'done', result: cached, stats: cached.stats, cached: true };
          remember(jobs, job.id, job);
          return json(res, 200, view(job));
        }
        if (active) {
          if (active.key === key) return json(res, 202, view(active));
          return json(res, 409, { error: 'Сначала отмените текущий расчёт' });
        }
        const job = { id: randomUUID(), key, status: 'running', stats: { nodes: 0, hits: 0, cached: 0, evicted: 0, cacheBytesEstimate: 0, elapsedMs: 0 } };
        const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData });
        job.worker = worker; active = job;
        remember(jobs, job.id, job);
        const finish = () => { if (active === job) active = null; delete job.worker; };
        worker.on('message', message => {
          if (job.status !== 'running') return;
          if (message.type === 'progress') job.stats = message.stats;
          if (message.type === 'result') {
            job.status = 'done'; job.result = message.result; job.stats = message.result.stats;
            remember(completed, key, message.result); finish();
          }
          if (message.type === 'error') { job.status = 'error'; job.error = message.message; finish(); }
        });
        worker.on('error', e => {
          if (job.status === 'running') { job.status = 'error'; job.error = `Расчёт остановлен: ${e.message}`; finish(); }
        });
        worker.on('exit', code => {
          if (job.status === 'running') { job.status = 'error'; job.error = `Поток расчёта завершился без результата (код ${code})`; finish(); }
        });
        return json(res, 202, view(job));
      }
      const match = route.match(/^\/api\/jobs\/([a-f0-9-]+)$/);
      if (match) {
        const job = jobs.get(match[1]);
        if (!job) return json(res, 404, { error: 'Расчёт не найден' });
        if (req.method === 'GET') return json(res, 200, view(job));
        if (req.method === 'DELETE') {
          if (job.status === 'running') {
            job.status = 'cancelled';
            const worker = job.worker;
            await worker.terminate();
            delete job.worker; if (active === job) active = null;
          }
          return json(res, 200, view(job));
        }
      }
      const assets = { '/tactics.js': ['tactics.js', 'text/javascript'], '/training.js': ['training.js', 'text/javascript'], '/domino.js': ['domino.js', 'text/javascript'], '/quality.js': ['quality.js', 'text/javascript'], '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/theme.js': ['theme.js', 'text/javascript'], '/impact.js': ['impact.js', 'text/javascript'], '/format.js': ['format.js', 'text/javascript'], '/navigation.js': ['navigation.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method === 'GET' && assets[route]) {
        const [file, type] = assets[route];
        const content = await readFile(path.join(PUBLIC, file));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
        return res.end(content);
      }
      json(res, 404, { error: 'Не найдено' });
    } catch (e) { if (!res.headersSent) json(res, 400, { error: e.message }); else res.end(); }
  });
  async function close() {
    if (active?.worker) { active.status = 'cancelled'; await active.worker.terminate(); active = null; }
    await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
  return { server, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3210);
  const app = createApp();
  app.server.on('error', e => { console.error(`Failed to start server: ${e.message}`); process.exitCode = 1; });
  app.server.listen(port, '127.0.0.1', () => console.log(`Page available at: http://127.0.0.1:${app.server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
}
