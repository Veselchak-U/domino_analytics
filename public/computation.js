/** One worker per tab. Each request creates a new memo; cancellation discards the worker. */
export class Computation {
  constructor({workerFactory=()=>new Worker(new URL('./compute-worker.js?v=client-1',import.meta.url),{type:'module'}),cacheEntries=250000}={}){
    this.workerFactory=workerFactory;this.cacheEntries=cacheEntries;this.sequence=0;this.active=null;this.idleWorker=null;
  }
  run(type,payload,onProgress=()=>{}) {
    if(this.active)return Promise.reject(new Error('Сначала остановите текущий расчёт'));
    return new Promise((resolve,reject)=>{
      const runId=++this.sequence;
      let worker;
      const finish=(error,result)=>{if(this.active?.runId!==runId)return;if(error)worker?.terminate();else this.idleWorker=worker;this.active=null;error?reject(error):resolve(result);};
      try{
        worker=this.idleWorker??this.workerFactory();this.idleWorker=null;this.active={runId,worker,cancel:()=>finish(Object.assign(new Error('Расчёт отменён'),{code:'CANCELLED'}))};
        worker.onmessage=({data})=>{if(this.active?.runId!==runId||data.runId!==runId)return;if(data.type==='progress')onProgress(data.stats);if(data.type==='result')finish(null,data.result);if(data.type==='error')finish(new Error(data.error));};
        worker.onerror=event=>{event.preventDefault?.();if(this.idleWorker===worker){worker.terminate();this.idleWorker=null;return;}finish(new Error('Вычислитель остановлен или недоступен. Повторите расчёт; при нехватке памяти уменьшите кеш.'));};
        worker.onmessageerror=()=>finish(new Error('Не удалось прочитать результат вычислителя. Повторите расчёт.'));
        worker.postMessage({runId,type,payload,cacheEntries:this.cacheEntries});
      }catch{if(!this.active)this.active={runId};finish(new Error('Не удалось запустить Web Worker. Нужен браузер с поддержкой Worker и BigInt.'));}
    });
  }
  cancel(){this.active?.cancel();}
  dispose(){this.cancel();this.idleWorker?.terminate();this.idleWorker=null;}
}
