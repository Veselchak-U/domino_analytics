import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server.js';
import { createFrontend } from '../src/frontend.js';

test('отдельные frontend и backend: статика, API, Origin и недоступный backend', async () => {
  const origins = [];
  const backend = createApp({ allowedOrigins: origins });
  await new Promise(resolve => backend.server.listen(0, '127.0.0.1', resolve));
  const frontend = createFrontend({ backendUrl: `http://127.0.0.1:${backend.server.address().port}` });
  await new Promise(resolve => frontend.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${frontend.server.address().port}`;
  origins.push(base);
  try {
    for (const file of ['/', '/app.js', '/impact.js', '/shared/impact.js', '/config.js', '/style.css',
      '/theme.js', '/quality.js', '/domino.js', '/training.js', '/format.js', '/navigation.js', '/tactics.js']) {
      assert.equal((await fetch(base + file)).status, 200, file);
    }
    assert.equal((await fetch(base + '/api/v1/health')).status, 200);
    assert.equal((await fetch(base + '/api/v1/example', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{"name":"demo"}' })).status, 200);
    const preflight = await fetch(`http://127.0.0.1:${backend.server.address().port}/api/v1/games`, { method: 'OPTIONS', headers: { Origin: base } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), base);
    assert.equal((await fetch(base + '/api/v1/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => {
      http.get(base, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(hostStatus, 403);
    assert.equal((await fetch(base + '/src/server.js')).status, 404);
    await backend.close();
    assert.equal((await fetch(base + '/api/v1/health')).status, 503);
    assert.equal((await fetch(base)).status, 200);
  } finally {
    await frontend.close();
    if (backend.server.listening) await backend.close();
  }
});
