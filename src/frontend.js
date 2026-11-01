import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/** Independent static UI server. Its proxy has one configured destination. */
export function createFrontend({ backendUrl = 'http://127.0.0.1:3211', apiBaseUrl = '/api/v1',
  publicDir = fileURLToPath(new URL('../public/', import.meta.url)), allowedHosts = [] } = {}) {
  const backend = new URL(backendUrl);
  if (backend.protocol !== 'http:' || backend.username || backend.password || backend.pathname !== '/') {
    throw new Error('BACKEND_URL должен быть HTTP-адресом бэкенда без пути и пароля');
  }
  let apiOrigin = '';
  if (apiBaseUrl.startsWith('/')) {
    if (!/^\/api(?:\/v1)?$/.test(apiBaseUrl)) throw new Error('Неверный API_BASE_URL');
  } else {
    const api = new URL(apiBaseUrl);
    if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password) throw new Error('Неверный API_BASE_URL');
    apiOrigin = api.origin;
  }
  const json = (res, status, error) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error }));
  };
  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', `default-src 'self'; connect-src 'self' ${apiOrigin}; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'`);
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...allowedHosts];
    if (!hosts.includes(req.headers.host)) return json(res, 403, 'Недопустимый адрес сервера');
    if (req.headers.origin && !hosts.map(host => `http://${host}`).includes(req.headers.origin)) return json(res, 403, 'Допустимы только локальные запросы приложения');
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return json(res, 400, 'Неверный адрес запроса');
    const route = new URL(req.url, `http://${hosts[0]}`).pathname;
    if (route === '/api' || route.startsWith('/api/')) {
      const headers = { ...req.headers, host: `127.0.0.1:${backend.port || 80}` };
      for (const header of ['connection', 'keep-alive', 'proxy-authorization', 'proxy-authenticate', 'upgrade']) delete headers[header];
      const upstream = http.request({ hostname: backend.hostname, port: backend.port || 80,
        path: req.url, method: req.method, headers, agent: false }, response => {
        const responseHeaders = { ...response.headers };
        for (const header of ['connection', 'keep-alive', 'transfer-encoding']) delete responseHeaders[header];
        res.writeHead(response.statusCode, responseHeaders);
        response.pipe(res);
      });
      upstream.on('error', () => {
        if (!res.headersSent) json(res, 503, 'Бэкенд недоступен. Повторите запрос после его запуска.');
        else res.end();
      });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
      req.pipe(upstream);
      return;
    }
    if (req.method !== 'GET') return json(res, 404, 'Не найдено');
    if (route === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(`globalThis.DOMINO_CONFIG=${JSON.stringify({ apiBaseUrl }).replaceAll('<', '\\u003c')};`);
    }
    if (route === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"status":"ok"}');
    }
    const shared = /^\/shared\/(impact|domino|tactics|game|game-entry|solver|facts|analysis|lessons|lesson-data|input|json|contract|game-schema|time|equal|lesson-manifest)\.js$/.test(route);
    const asset = route === '/' || route === '/index.html' ? 'index.html'
      : /^\/[a-z-]+\.(js|css)$/.test(route) ? route.slice(1) : null;
    if (!shared && !asset) return json(res, 404, 'Не найдено');
    try {
      const file = shared ? path.join(publicDir, '..', 'shared', path.basename(route)) : path.join(publicDir, asset);
      const content = await readFile(file);
      const extension = path.extname(file);
      res.writeHead(200, { 'Content-Type': `${({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extension]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      res.end(content);
    } catch (error) { json(res, error.code === 'ENOENT' ? 404 : 500, 'Не удалось открыть файл интерфейса'); }
  });
  return { server, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3210), host = process.env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('Неверный HOST');
  const frontend = createFrontend({ backendUrl: process.env.BACKEND_URL, apiBaseUrl: process.env.API_BASE_URL, allowedHosts: (process.env.DOMINO_ALLOWED_HOSTS ?? '').split(',').filter(Boolean) });
  frontend.server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  frontend.server.listen(port, host, () => console.log(`Page available at: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => frontend.close().then(() => process.exit(0)));
}
