// Run inside the container: no user journals and no external requests.
import assert from 'node:assert/strict';
import http from 'node:http';
const base = `http://127.0.0.1:${process.env.DOMINO_SMOKE_PORT ?? 3210}`;
assert.equal((await fetch(base)).status, 200);
assert.equal((await fetch(base + '/app.js')).status, 200);
assert.equal((await fetch(base + '/api/examples')).status, 200);
assert.equal((await fetch(base, { headers: { Origin: 'https://other.example' } })).status, 403);
assert.equal(await new Promise((resolve, reject) => {
  http.get(base, { headers: { Host: 'other.example' } }, response => {
    response.resume(); resolve(response.statusCode);
  }).on('error', reject);
}), 403);
const imported = await fetch(base + '/api/example', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'demo' }),
});
assert.equal(imported.status, 200);
const game = await imported.json();
assert.equal(game.rounds.length, 3);
console.log('VM smoke: интерфейс, API, демо-импорт и защита Host/Origin — OK');
