import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp, listenHost } from '../src/server.js';

test('контейнерный bind задаётся явно и не ослабляет Host/Origin', async () => {
  assert.equal(listenHost({}), '127.0.0.1');
  assert.equal(listenHost({ HOST: '0.0.0.0' }), '0.0.0.0');
  assert.throws(() => listenHost({ HOST: 'other.example' }), /HOST/);
  const app = createApp({ examplesDir: 'not-configured' });
  await new Promise(resolve => app.server.listen(0, listenHost({ HOST: '0.0.0.0' }), resolve));
  try {
    assert.equal(app.server.address().address, '0.0.0.0');
    const url = `http://127.0.0.1:${app.server.address().port}/api/examples`;
    assert.equal((await fetch(url)).status, 200);
    const status = await new Promise((resolve, reject) => {
      http.get(url, { headers: { Host: 'other.example' } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(status, 403);
    assert.equal((await fetch(url, { headers: { Origin: 'http://other.example' } })).status, 403);
  } finally { await app.close(); }
});
