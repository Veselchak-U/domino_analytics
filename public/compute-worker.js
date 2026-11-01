import { parseGame } from '../shared/input.js';
import { gameSummary, analyzeRound, analyzeBranch } from '../shared/analysis.js';
import { analyzeLesson } from '../shared/lessons.js';
import { identityOf } from '../shared/contract.js';

/** A worker owns one exact computation and its memo; termination is cancellation. */
self.onmessage = async ({data}) => {
  const {runId,type,payload,cacheEntries}=data;
  const send=(kind,value)=>self.postMessage({runId,type:kind,...value});
  try {
    if(!Number.isInteger(cacheEntries)||cacheEntries<2||cacheEntries>2000000)throw new Error('Кеш должен содержать от 2 до 2 000 000 позиций');
    const progress=stats=>send('progress',{stats});
    progress({nodes:0,hits:0,cached:0,evicted:0,cacheBytesEstimate:0,elapsedMs:0});
    let result;
    if(type==='lesson') result=analyzeLesson(payload.id,payload.mirror,progress,{cacheEntries});
    else {
      const game=parseGame(payload.text);
      if(type==='validate')result={...gameSummary(game),playedAt:game.playedAt,id:await identityOf(JSON.parse(payload.text))};
      else if(type==='round')result=analyzeRound(game,payload.round-1,progress,{cacheEntries});
      else if(type==='branch')result=analyzeBranch(game,payload.round-1,payload.position,payload.moves,progress,payload.example??undefined,{cacheEntries});
      else throw new Error('Неизвестная команда вычислителя');
    }
    send('result',{result});
  }catch(e){send('error',{error:e.message});}
};
