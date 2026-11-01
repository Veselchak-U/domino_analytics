import {createApp} from '../src/server.js';
import {createFrontend} from '../src/frontend.js';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import os from 'node:os';

// Isolated verification store, never the user's application database.
const dir=resolve('.analysis/browser-verification');mkdirSync(dir,{recursive:true});
const text=JSON.stringify({playedAt:'2026-09-12T19:30:00+03:00',...JSON.parse(readFileSync(new URL('../test/fixtures/real-game.json',import.meta.url),'utf8'))});
writeFileSync(resolve(dir,'browser-real.json'),text);
const backend=createApp({examplesDir:dir,allowedOrigins:['http://127.0.0.1:3220']});
const frontend=createFrontend({backendUrl:'http://127.0.0.1:3221'});
const original=frontend.server.listeners('request')[0];frontend.server.removeAllListeners('request');
let baseline=null,measurement=0;
frontend.server.on('request',(req,res)=>{
  if(req.url==='/metrics/start'){baseline={cpu:process.cpuUsage(),time:performance.now(),rss:process.memoryUsage().rss};res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');}
  else if(req.url==='/metrics/end'){
    const report={elapsedMs:performance.now()-baseline.time,cpuMicros:process.cpuUsage(baseline.cpu),rssBefore:baseline.rss,rssAfter:process.memoryUsage().rss,node:process.version,cpu:os.cpus()[0].model,cores:os.availableParallelism()};
    writeFileSync(resolve(dir,'load-report-'+(++measurement)+'.json'),JSON.stringify(report,null,2));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(report));
  }
  else if(req.url==='/verify'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Browser verification</title><pre id="results"></pre><script type="module" src="/verification.js"></script></html>');}
  else if(req.url==='/verification.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(readFileSync(new URL('./browser-verification-page.js',import.meta.url)));}
  else original(req,res);
});
await new Promise(r=>backend.server.listen(3221,'127.0.0.1',r));await new Promise(r=>frontend.server.listen(3220,'127.0.0.1',r));
console.log('Browser verification: http://127.0.0.1:3220/verify');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await frontend.close();await backend.close();process.exit(0);});
