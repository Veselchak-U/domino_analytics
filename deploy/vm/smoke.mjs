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
const text=await(await fetch(base+'/api/v1/examples/demo/source')).text();
const imported=await fetch(base+'/api/v1/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,name:'Учебная партия.json'})});
assert.ok([200,201].includes(imported.status));
const game=await imported.json();assert.equal(game.rounds.length,3);
assert.equal((await fetch(base+'/api/v1/health').then(r=>r.json())).computation,'client');
console.log('VM smoke: интерфейс, хранилище, исходник demo и защита Host/Origin — OK');
