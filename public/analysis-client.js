import { Computation } from './computation.js';
import { resultKey, resultEnvelope, validateEnvelope, RESULT_VERSION } from '../shared/contract.js';
import { lessonManifest } from '../shared/lesson-manifest.js';

/** Compact result cache and in-memory outbox. Each pending result retains its source. */
export class AnalysisClient {
  constructor(api,{computation=new Computation(),onChange=()=>{}}={}){
    this.api=api;this.computation=computation;this.onChange=onChange;this.results=new Map();this.pending=new Map();this.states=new Map();this.source=null;this.epoch=0;
  }
  state(key,state,error){this.states.set(key,{state,error});this.onChange();}
  async open(text,name) {
    const summary=await this.computation.run('validate',{text});
    const source={text,name,summary,saved:false};
    try {const saved=await this.api('/api/import',{text,name});if(saved.id!==summary.id)throw new Error('Идентичность партии не совпала');source.saved=true;source.summary={...summary,...saved};}
    catch(e){if(e.status===409||e.status===400||e.status===413||e.status===422)throw e;source.error=e.message;}
    this.source=source;this.onChange();
    return {...source.summary,fileName:source.summary.fileName??name,completedRounds:source.summary.completedRounds??[]};
  }
  async calculate(kind,request,onProgress) {
    const epoch=this.epoch;
    const source=kind==='lesson'?null:this.source;
    if(kind!=='lesson'&&!source)throw new Error('Сначала загрузите журнал');
    const descriptor=kind==='lesson'?{version:RESULT_VERSION,kind,lessonId:request.id,lessonDataHash:lessonManifest.hash,mirror:!!request.mirror}
      :kind==='round'?{version:RESULT_VERSION,kind,gameId:source.summary.id,round:request.round}
      :{version:RESULT_VERSION,kind,gameId:source.summary.id,round:request.round,position:request.position,moves:request.moves,example:request.example??null};
    const key=await resultKey(descriptor);
    if(this.results.has(key))return {status:'done',cached:true,result:this.results.get(key).result};
    try{
      const saved=await this.api('/api/results/'+key);await validateEnvelope(key,saved,lessonManifest);
      if(epoch!==this.epoch)return {status:'cancelled'};
      this.remember(key,saved);this.state(key,'saved');return {status:'done',cached:true,result:saved.result};
    }catch(e){if(e.code==='CANCELLED')return {status:'cancelled'};/* A cache miss/offline/corrupt envelope falls back to exact client computation. */}
    if(epoch!==this.epoch)return {status:'cancelled'};
    let result;
    try {result=await this.computation.run(kind,{...request,...(source?{text:source.text}:{})},onProgress);}
    catch(e){if(e.code==='CANCELLED')return {status:'cancelled'};throw e;}
    const envelope=await resultEnvelope(descriptor,result);
    if(epoch!==this.epoch)return {status:'cancelled'};
    this.remember(key,envelope);this.pending.set(key,{envelope,source});this.state(key,'computed');
    // Publication is independent from display/navigation and never runs the evaluator.
    void this.publish(key);
    return {status:'done',cached:false,result};
  }
  remember(key,envelope){this.results.delete(key);this.results.set(key,envelope);while(this.results.size>8)this.results.delete(this.results.keys().next().value);}
  async publish(key){
    const entry=this.pending.get(key);if(!entry||this.states.get(key)?.state==='uploading')return;
    this.state(key,'uploading');
    try {
      if(entry.source&&!entry.source.saved){const s=entry.source;await this.api('/api/import',{text:s.text,name:s.name});s.saved=true;}
      const saved=await this.api('/api/results/'+key,entry.envelope,'PUT');await validateEnvelope(key,saved,lessonManifest);
      this.remember(key,saved);this.pending.delete(key);this.state(key,'saved');
    }catch(e){this.state(key,e.status===409?'conflict':'unsaved',e.message);}
  }
  async retry(){
    if(this.source&&!this.source.saved){try{await this.api('/api/import',{text:this.source.text,name:this.source.name});this.source.saved=true;this.source.error=null;}catch(e){this.source.error=e.message;}}
    for(const key of this.pending.keys())if(this.states.get(key)?.state!=='conflict')await this.publish(key);
    this.onChange();
  }
  cancel(){this.epoch++;this.computation.cancel();}
  get unsaved(){return this.pending.size>0||!!(this.source&&!this.source.saved);}
}
