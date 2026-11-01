import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { Storage } from './storage.js';
import { strictJson } from '../shared/json.js';
import { LIMITS, fault, validateSource, identityOf, sourceDigest, projectSource, validateEnvelope, RESULT_VERSION } from '../shared/contract.js';
import { lessonManifest } from '../shared/lesson-manifest.js';

export function listenHost(env=process.env) {
  const host=env.HOST??'127.0.0.1';
  if(!['127.0.0.1','0.0.0.0'].includes(host))throw new Error('HOST должен быть 127.0.0.1 или 0.0.0.0');
  return host;
}
function body(req,limit) {
  return new Promise((resolve,reject)=>{
    let size=0,chunks=[];
    const cleanup=()=>{req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',aborted);};
    const error=e=>{cleanup();reject(e);};
    const aborted=()=>error(fault('Загрузка прервана'));
    const data=chunk=>{size+=chunk.length;if(size>limit){chunks=[];cleanup();req.resume();reject(fault('Тело запроса слишком большое',413,'BODY_TOO_LARGE'));}else chunks.push(chunk);};
    const end=()=>{cleanup();try{resolve(strictJson(Buffer.concat(chunks).toString('utf8')));}catch(e){reject(e);}};
    req.on('data',data);req.on('end',end);req.on('error',error);req.on('aborted',aborted);
  });
}
function pageSize(url) {
  const n=url.searchParams.get('limit')??'20';if(!/^\d+$/.test(n)||Number(n)<1||Number(n)>100)throw fault('Неверный размер страницы');return Number(n);
}
function catalogCursor(url) {
  const v=url.searchParams.get('cursor');if(v===null)return null;
  try{if(!/^[A-Za-z0-9_-]{1,512}$/.test(v))throw new Error();const d=JSON.parse(Buffer.from(v,'base64url').toString());if(!Array.isArray(d)||d.length!==2||!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(d[0])||new Date(d[0]).toISOString()!==d[0]||!/^[a-f0-9]{64}$/.test(d[1]))throw new Error();return d;}catch{throw fault('Неверный курсор каталога');}
}

/** The HTTP process owns storage only; no game engine or evaluator is imported. */
export function createApp({examplesDir=process.env.DOMINO_EXAMPLES_DIR??'C:/Projects/Home/domino_video_parser/out',databasePath=':memory:',resultVersion,allowedOrigins=[],allowedHosts=[]}={}) {
  const storage=new Storage(databasePath,resultVersion);let uploads=0,closed=false;
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  async function examples(){try{return (await readdir(examplesDir)).filter(f=>f.endsWith('.json')&&!f.includes('needs-review')).sort();}catch{return [];}}
  const server=http.createServer(async(req,res)=>{
    let admitted=false;
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    try{
      const port=server.address().port,hosts=[`127.0.0.1:${port}`,`localhost:${port}`,...allowedHosts];
      if(!hosts.includes(req.headers.host))throw fault('Недопустимый адрес сервера',403);
      if(req.headers.origin&&!hosts.map(h=>'http://'+h).concat(allowedOrigins).includes(req.headers.origin))throw fault('Допустимы только запросы разрешённого приложения',403);
      if(req.headers.origin){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, DELETE');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.writeHead(204);return res.end();}
      if(!req.url.startsWith('/')||req.url.startsWith('//'))throw fault('Неверный адрес запроса');
      const url=new URL(req.url,'http://'+hosts[0]),route=url.pathname.replace(/^\/api\/v1(?=\/|$)/,'/api');
      if(['/api/analyze','/api/branch','/api/lesson','/api/example'].includes(route)||/^\/api\/jobs(?:\/|$)/.test(route))throw fault('Вычисления выполняются в браузере. Обновите страницу приложения.',410,'CLIENT_COMPUTATION_REQUIRED');
      if(req.method==='GET'&&route==='/api/health'){storage.db.prepare('SELECT 1').get();return json(res,200,{status:'ok',storage:'sqlite',apiVersion:1,version:RESULT_VERSION,computation:'client'});}
      if(req.method==='GET'&&route==='/api/games')return json(res,200,storage.library(pageSize(url),catalogCursor(url)));
      const gameRoute=route.match(/^\/api\/games\/([^/]+)(?:\/(source|analyses))?$/);
      if(req.method==='GET'&&gameRoute){
        const game=storage.libraryGame(gameRoute[1]);
        if(!game)throw fault('Партия не найдена',404,'NOT_FOUND');
        if(gameRoute[2]==='source'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':"attachment; filename=game.json; filename*=UTF-8''"+encodeURIComponent(game.fileName).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())});return res.end(game.text);}
        if(gameRoute[2]==='analyses'){const cursor=url.searchParams.get('cursor')??'0';if(!/^\d{1,4}$/.test(cursor)||Number(cursor)>1024)throw fault('Неверный курсор анализа');return json(res,200,storage.manifest(game.id,pageSize(url),Number(cursor)));}
        return json(res,200,storage.libraryCard(game));
      }
      if(req.method==='GET'&&route==='/api/examples')return json(res,200,{files:await examples()});
      const example=route.match(/^\/api\/examples\/([^/]+)\/source$/);
      if(req.method==='GET'&&example){
        let name;try{name=decodeURIComponent(example[1]);}catch{throw fault('Неверное имя примера');}
        const file=name==='demo'?new URL('../contracts/demo-game.json',import.meta.url):(await examples()).includes(name)?path.join(examplesDir,name):null;
        if(!file)throw fault('Пример не найден',404,'NOT_FOUND');
        const text=await readFile(file,'utf8');res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(text);
      }
      if(req.method==='GET'&&route==='/api/lessons')return json(res,200,{lessons:lessonManifest.lessons});
      const resultRoute=route.match(/^\/api\/results\/([a-f0-9]{64})$/);
      if(req.method==='GET'&&resultRoute){const saved=storage.clientResult(resultRoute[1]);if(!saved)throw fault('Результат не найден',404,'NOT_FOUND');return json(res,200,saved);}
      if((req.method==='POST'&&route==='/api/import')||(req.method==='PUT'&&resultRoute)){
        if(uploads>=2){res.setHeader('Retry-After','1');throw fault('Оба слота загрузки заняты. Повторите сохранение.',429,'UPLOAD_BUSY');}
        if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type']??'')||req.headers['content-encoding'])throw fault('Ожидается несжатый application/json',415,'UNSUPPORTED_MEDIA_TYPE');
        uploads++;admitted=true;
        const data=await body(req,route==='/api/import'?LIMITS.import:LIMITS.result);
        if(route==='/api/import'){
          if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['text','name'].includes(k)))throw fault('Неверные поля импорта');
          const name=data.name??'Загруженная партия.json';if(typeof name!=='string'||!name.trim()||name.length>255||/[\x00-\x1f\x7f]/.test(name))throw fault('Неверное имя файла');
          const parsed=validateSource(data.text),id=await identityOf(parsed),hash=await sourceDigest(parsed);
          const saved=storage.importSource(id,data.text,projectSource(parsed),name,hash);
          return json(res,saved.created?201:200,storage.libraryCard(saved.game));
        }
        await validateEnvelope(resultRoute[1],data,lessonManifest);const d=data.descriptor;
        if(d.kind!=='lesson'){
          const game=storage.libraryGame(d.gameId);if(!game)throw fault('Партия не найдена',404,'NOT_FOUND');
          if(game.id!==d.gameId||d.round>game.summary.rounds.length||(d.kind==='branch'&&d.position>game.summary.rounds[d.round-1].moves))throw fault('Позиция за пределами исходного журнала');
        }
        const envelope={formatVersion:1,descriptor:d,result:data.result,payloadHash:data.payloadHash,provenance:{producer:'browser',verification:'structural-only'}};
        const saved=storage.publish(resultRoute[1],envelope);return json(res,saved.created?201:200,{...saved.envelope,cached:!saved.created});
      }
      throw fault('Не найдено',404,'NOT_FOUND');
    }catch(e){
      const storageFailure=String(e.code??'').startsWith('ERR_SQLITE')||(!e.statusCode&&/sqlite|database|disk/i.test(e.message));
      const status=storageFailure?503:e.statusCode??400;if(status===413||status===429)res.setHeader('Connection','close');
      if(!res.headersSent)json(res,status,{code:storageFailure?'STORAGE_UNAVAILABLE':e.code??'INVALID_DATA',error:storageFailure?'Хранилище недоступно. Повторите сохранение.':e.message});else res.end();
    }finally{if(admitted)uploads--;}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {server,async close(){if(closed)return;closed=true;if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));storage.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const port=Number(process.env.PORT??3211),app=createApp({databasePath:process.env.DATABASE_PATH??'.analysis/domino.sqlite',allowedOrigins:(process.env.DOMINO_ALLOWED_ORIGINS??'').split(',').filter(Boolean),allowedHosts:(process.env.DOMINO_ALLOWED_HOSTS??'').split(',').filter(Boolean)});
  app.server.on('error',e=>{console.error(e.message);process.exitCode=1;});app.server.listen(port,listenHost(),()=>console.log(`Backend available at: http://127.0.0.1:${port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
