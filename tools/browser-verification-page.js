import { Computation } from '/computation.js';
import { AnalysisClient } from '/analysis-client.js';
import { RESULT_VERSION, resultKey, resultEnvelope, validateEnvelope } from '/shared/contract.js';
import { lessonManifest } from '/shared/lesson-manifest.js';

const output=document.getElementById('results');
const log=message=>{output.textContent+=message+'\n';};
const check=(condition,message)=>{if(!condition)throw new Error(message);log('OK '+message);};
let offline=false,workerStarts=0;
const computation=new Computation();const originalFactory=computation.workerFactory;
computation.workerFactory=()=>{workerStarts++;return originalFactory();};
const api=async(url,data,method=data?'POST':'GET')=>{
  if(offline)throw new Error('Тест: сеть недоступна');
  const response=await fetch(url.replace(/^\/api/,'/api/v1'),{method,...(data?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});
  const body=await response.json();if(!response.ok)throw Object.assign(new Error(body.error),{status:response.status,code:body.code});return body;
};
try{
  const text=await (await fetch('/api/v1/examples/browser-real.json/source')).text();
  const client=new AnalysisClient(api,{computation});
  const game=await client.open(text,'Browser test.json');
  check(game.rounds.length===1,'Полная проверка реального журнала в браузере');
  offline=true;
  let ticks=0,progress=0;const timer=setInterval(()=>ticks++,20);
  const result=await client.calculate('round',{round:1},()=>progress++);
  clearInterval(timer);
  check(result.result.base.leaves==='7328406'&&JSON.stringify(result.result.base.wins)==='["4255456","3072949","1"]'&&result.result.base.depth===40&&result.result.steps.length===16,'Точные эталонные исходы без серверного solver и GPU');
  check(ticks>2&&progress>0,'Основной поток отвечает во время вычисления');
  await client.retry();check(client.unsaved,'Локальный результат доступен при отказе API');
  offline=false;await client.retry();check(!client.unsaved,'Повторное сохранение без пересчёта');
  const before=workerStarts;
  const cached=await client.calculate('round',{round:1});check(cached.cached&&workerStarts===before,'Повтор в памяти не запускает worker');
  const second=new AnalysisClient(api);await second.open(text,'Second client.json');
  const shared=await second.calculate('round',{round:1});check(shared.cached&&shared.result.base.leaves==='7328406','Другой клиент получает общий готовый кеш');
  const a=new Computation({cacheEntries:50000}),b=new Computation({cacheEntries:50000});
  const cancelled=a.run('round',{text,round:1},()=>a.cancel()).catch(e=>e.code);
  const independent=b.run('branch',{text,round:1,position:8,moves:[],example:'win'});
  check(await cancelled==='CANCELLED','Жёсткая отмена локального вычислителя');
  const branch=await independent;check(branch.steps.at(-1).terminal,'Другой вычислитель продолжает независимую ветку');
  const retry=await a.run('lesson',{id:'figure9',mirror:false});check(retry.steps[0].alternatives.length===2,'Повтор после отмены и урок без импорта');
  const bad=JSON.parse(text);bad.rounds[0].moves[0].player='wrong';
  let rejected=false;try{await a.run('validate',{text:JSON.stringify(bad)});}catch(e){rejected=/очеред/.test(e.message);}check(rejected,'Полная игровая проверка отвергает структурно допустимый неверный журнал');
  const broken=new Computation({workerFactory:()=>{throw new Error('unavailable');}});
  try{await broken.run('round',{text,round:1});throw new Error('Expected failure');}catch(e){check(/Web Worker/.test(e.message),'Ошибка загрузки worker без серверного fallback');}
  const d={version:RESULT_VERSION,kind:'round',gameId:game.id,round:1};const key=await resultKey(d),saved=await api('/api/results/'+key);await validateEnvelope(key,saved,lessonManifest);
  check(saved.provenance.verification==='structural-only','Граница доверия клиентскому кешу');
  const corrupt=structuredClone(saved);corrupt.payloadHash='0'.repeat(64);try{await validateEnvelope(key,corrupt,lessonManifest);throw new Error('Expected rejection');}catch(e){check(/Хеш/.test(e.message),'Повреждённый кеш отвергается');}
  await fetch('/metrics/start');
  const latencies=[];
  const reads=setInterval(async()=>{const started=performance.now();await api('/api/health');await api('/api/games');await api('/api/results/'+key);latencies.push(performance.now()-started);},100);
  const left=new Computation(),right=new Computation();
  const both=await Promise.all([left.run('round',{text,round:1}),right.run('round',{text,round:1})]);
  clearInterval(reads);
  const simultaneous=await Promise.all(both.map(async result=>api('/api/results/'+key,await resultEnvelope(d,result),'PUT')));
  check(simultaneous.every(e=>e.cached),'Две одновременные публикации без дубликата');
  check(both.every(r=>r.base.leaves==='7328406'),'Два одновременных полных клиентских расчёта');
  check(latencies.length>0,'Чтение третьим клиентом во время двух расчётов');
  const profile=await(await fetch('/metrics/end')).json();
  log('SERVER PROFILE '+JSON.stringify({...profile,readGroups:latencies.length,maxReadGroupMs:Math.max(...latencies)}));
  await fetch('/metrics/start');
  const idleLatencies=[];
  const idle=setInterval(async()=>{const started=performance.now();await api('/api/health');await api('/api/games');await api('/api/results/'+key);idleLatencies.push(performance.now()-started);},100);
  await new Promise(resolve=>setTimeout(resolve,3000));clearInterval(idle);
  const idleProfile=await(await fetch('/metrics/end')).json();
  log('SERVER IDLE PROFILE '+JSON.stringify({...idleProfile,readGroups:idleLatencies.length,maxReadGroupMs:Math.max(...idleLatencies)}));
  for(const c of [computation,second.computation,a,b,broken,left,right])c.dispose();
  log('BROWSER VERIFICATION PASSED');
}catch(e){log('FAILED '+e.stack);}
