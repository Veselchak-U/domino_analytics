import { lessonCatalog } from './lessons.js';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseGame } from './input.js';
import { gameSummary } from './analysis.js';
import { Storage, RESULT_VERSION } from './storage.js';

const MAX_BODY = 5 * 1024 * 1024;
const sha = text => createHash('sha256').update(text).digest('hex');

/** Container networking is opt-in; request Host/Origin validation stays unchanged. */
export function listenHost(env = process.env) {
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('HOST должен быть 127.0.0.1 или 0.0.0.0');
  return host;
}

function remember(map, key, value, limit = 8) {
  map.delete(key); map.set(key, value);
  while (map.size > limit) {
    const oldest = [...map].find(([, entry]) => entry.status !== 'running');
    if (!oldest) break;
    map.delete(oldest[0]);
  }
}

async function body(req) {
  let size = 0, chunks = [], tooLarge = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 11 * 1024 * 1024) { tooLarge = true; chunks = []; }
    if (!tooLarge) chunks.push(chunk);
  }
  if (tooLarge) throw Object.assign(new Error('Тело запроса слишком большое'), { statusCode: 413 });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Неверное тело HTTP-запроса'); }
}

/** One local server owns games, result cache, and at most one active worker. */
export function createApp({ examplesDir = process.env.DOMINO_EXAMPLES_DIR ?? 'C:/Projects/Home/domino_video_parser/out',
  databasePath = ':memory:', resultVersion = RESULT_VERSION, allowedOrigins = [] } = {}) {
  const storage = new Storage(databasePath, resultVersion);
  const games = new Map(), jobs = new Map(), completed = new Map();
  let active = null, closed = false;
  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  function view(job) {
    return { id: job.id, status: job.status, stats: job.stats, error: job.error, interrupted: !!job.interrupted, stale: !!job.stale,
      cached: job.cached ?? false, ...(job.status === 'done' ? { result: job.result } : {}) };
  }
  function importGame(text, name = 'Загруженная партия.json') {
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BODY) throw new Error('Ожидается JSON-файл размером до 5 МБ');
    if (typeof name !== 'string' || !name.trim() || name.length > 255 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Неверное имя файла');
    const id = sha(text), existing = games.get(id) ?? storage.getGame(id);
    if (existing) { remember(games, id, existing); return storage.card(existing); }
    const game = parseGame(text), summary = gameSummary(game);
    const saved = storage.putGame(id, text, summary, name);
    remember(games, id, saved);
    return storage.card(saved);
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
        if (!allowedOrigins.includes(req.headers.origin)) return json(res, 403, { error: 'Допустимы только локальные запросы приложения' });
      if (req.headers.origin) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.writeHead(204); return res.end();
      }
      const url = new URL(req.url, `http://${expectedHost}`), route = url.pathname.replace(/^\/api\/v1(?=\/|$)/, '/api');
      if (req.method === 'GET' && route === '/api/health') {
        storage.db.prepare('SELECT 1').get();
        return json(res, 200, { status: 'ok', storage: 'sqlite', version: resultVersion });
      }
      if (req.method === 'GET' && route === '/api/games') {
        const value = url.searchParams.get('limit') ?? '20';
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new Error('Неверный размер страницы');
        let cursor = null;
        if (url.searchParams.has('cursor')) {
          try {
            const encoded = url.searchParams.get('cursor');
            if (!/^[A-Za-z0-9_-]{1,512}$/.test(encoded)) throw new Error();
            cursor = JSON.parse(Buffer.from(encoded, 'base64url').toString());
            if (!Array.isArray(cursor) || cursor.length !== 2 || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(cursor[0]) || !/^[a-f0-9]{64}$/.test(cursor[1])
              || new Date(cursor[0]).toISOString() !== cursor[0]) throw new Error();
          } catch { throw new Error('Неверный курсор каталога'); }
        }
        return json(res, 200, storage.listGames(Number(value), cursor));
      }
      const savedMatch = route.match(/^\/api\/games\/([^/]+)(?:\/(source|analyses))?$/);
      if (req.method === 'GET' && savedMatch) {
        const saved = storage.getGame(savedMatch[1]);
        if (!saved) return json(res, 404, { error: 'Партия не найдена' });
        if (savedMatch[2] === 'source') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="game.json"; filename*=UTF-8''${encodeURIComponent(saved.fileName).replace(/['()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase())}` });
          return res.end(saved.text);
        }
        return json(res, 200, savedMatch[2] === 'analyses' ? { analyses: storage.analyses(saved.id) } : storage.card(saved));
      }
      if (req.method === 'GET' && route === '/api/examples') return json(res, 200, { files: await examples() });
      if (req.method === 'POST' && route === '/api/import') {
        const data = await body(req);
        return json(res, 200, importGame(data.text, data.name));
      }
      if (req.method === 'POST' && route === '/api/example') {
        const data = await body(req);
        let text;
        if (data.name === 'demo') text = await readFile(new URL('../contracts/kozel-game.example.json', import.meta.url), 'utf8');
        else {
          if (!(await examples()).includes(data.name)) throw new Error('Такого готового примера нет');
          text = await readFile(path.join(examplesDir, data.name), 'utf8');
        }
        return json(res, 200, importGame(text, data.name === 'demo' ? 'Учебная партия · 3 раунда' : data.name));
      }
      if (req.method === 'GET' && route === '/api/lessons') return json(res, 200, { lessons: lessonCatalog() });
      if (req.method === 'POST' && ['/api/analyze', '/api/branch', '/api/lesson'].includes(route)) {
        const data = await body(req);
        let key, workerData, metadata;
        if (route === '/api/lesson') {
          if (Object.keys(data).some(k => !['id', 'mirror'].includes(k)) || !lessonCatalog().some(l => l.id === data.id)
            || (data.mirror !== undefined && typeof data.mirror !== 'boolean')) throw new Error('Неверные параметры упражнения');
          key = 'lesson:' + data.id + ':' + !!data.mirror;
          workerData = { lessonId: data.id, mirror: !!data.mirror };
          metadata = { kind: 'lesson' };
        } else {
          const { gameId, round } = data, game = games.get(gameId) ?? storage.getGame(gameId);
          if (!game) throw new Error('Партия не найдена: загрузите журнал');
          remember(games, gameId, game);
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
          metadata = { gameId, round, kind: branch ? 'branch' : 'round' };
        }
        key = `${resultVersion}:${key}`;
        const cached = completed.get(key) ?? storage.result(key);
        if (cached) {
          remember(completed, key, cached);
          const job = { id: randomUUID(), key, status: 'done', result: cached, stats: cached.stats, cached: true };
          storage.saveJob(job);
          remember(jobs, job.id, job);
          return json(res, 200, view(job));
        }
        if (active) {
          if (active.key === key) return json(res, 202, view(active));
          return json(res, 409, { error: 'Сначала отмените текущий расчёт' });
        }
        const job = { id: randomUUID(), key, status: 'running', stats: { nodes: 0, hits: 0, cached: 0, evicted: 0, cacheBytesEstimate: 0, elapsedMs: 0 } };
        storage.saveJob(job);
        let worker;
        try { worker = new Worker(new URL('./worker.js', import.meta.url), { workerData }); }
        catch {
          job.status = 'error'; job.error = 'Не удалось запустить вычислительный поток. Повторите расчёт.';
          storage.saveJob(job);
          return json(res, 500, { error: job.error });
        }
        job.worker = worker; active = job;
        remember(jobs, job.id, job);
        const finish = () => { if (active === job) active = null; delete job.worker; };
        let lastSaved = 0;
        const fail = error => {
          job.status = 'error'; job.error = error;
          try { storage.saveJob(job); } catch { /* No successful result is published when storage fails. */ }
          void worker.terminate(); finish();
        };
        worker.on('message', message => {
          if (job.status !== 'running') return;
          try {
            if (message.type === 'progress') {
              job.stats = message.stats;
              if (Date.now() - lastSaved >= 1000) { storage.saveJob(job); lastSaved = Date.now(); }
            }
            if (message.type === 'result') {
              storage.complete(job, message.result, metadata);
              job.status = 'done'; job.result = message.result; job.stats = message.result.stats;
              remember(completed, key, message.result); finish();
            }
            if (message.type === 'error') fail(message.message);
          } catch { fail('Не удалось сохранить результат в БД. Проверьте свободное место и повторите расчёт.'); }
        });
        worker.on('error', e => {
          if (job.status === 'running') fail(`Расчёт остановлен: ${e.message}`);
        });
        worker.on('exit', code => {
          if (job.status === 'running') fail(`Поток расчёта завершился без результата (код ${code})`);
        });
        return json(res, 202, view(job));
      }
      const match = route.match(/^\/api\/jobs\/([a-f0-9-]+)$/);
      if (match) {
        const job = jobs.get(match[1]) ?? storage.job(match[1]);
        if (!job) return json(res, 404, { error: 'Расчёт не найден' });
        if (req.method === 'GET') return json(res, 200, view(job));
        if (req.method === 'DELETE') {
          if (job.status === 'running') {
            storage.saveJob({ ...job, status: 'cancelled' });
            job.status = 'cancelled';
            const worker = job.worker;
            await worker.terminate();
            delete job.worker; if (active === job) active = null;
          }
          return json(res, 200, view(job));
        }
      }
      json(res, 404, { error: 'Не найдено' });
    } catch (e) {
      const status = e.statusCode ?? (String(e.code ?? '').startsWith('ERR_SQLITE') ? 500 : 400);
      if (!res.headersSent) json(res, status, { error: status === 500 ? 'Ошибка БД. Проверьте доступность хранилища.' : e.message }); else res.end();
    }
  });
  async function close() {
    if (closed) return;
    closed = true;
    let saveError;
    if (active?.worker) {
      active.status = 'error'; active.interrupted = true; active.error = 'Расчёт прерван остановкой бэкенда. Запустите повторно.';
      try { storage.saveJob(active); } catch (error) { saveError = error; }
      await active.worker.terminate(); active = null;
    }
    if (server.listening) await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    storage.close();
    if (saveError) throw saveError;
  }
  return { server, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3211);
  const app = createApp({ databasePath: process.env.DATABASE_PATH ?? '.analysis/domino.sqlite',
    allowedOrigins: (process.env.DOMINO_ALLOWED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean) });
  app.server.on('error', e => { console.error(`Failed to start server: ${e.message}`); process.exitCode = 1; });
  app.server.listen(port, listenHost(), () => console.log(`Page available at: http://127.0.0.1:${app.server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
}
