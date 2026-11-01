import { normalizeInstant } from './time.js';
/** Storage protocol shared by browsers and Node. No game transitions or solver. */
import { strictJson } from './json.js';
import validate from './game-schema.js';

export const RESULT_VERSION = Object.freeze({ rules: 2, engine: 1, metrics: 1, schema: 1 });
export const VERSION_ID = 'rules-2.engine-1.metrics-1.schema-1';
export const LIMITS = Object.freeze({ source: 5*1024*1024, import: 11*1024*1024, result: 16*1024*1024 });
export function fault(message, statusCode = 400, code = 'INVALID_DATA') { return Object.assign(new Error(message), { statusCode, code }); }
export function codepointCompare(a,b) { const x=[...a],y=[...b]; for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)-y[i].codePointAt(0);if(d)return d;}return x.length-y.length; }
export function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort(codepointCompare).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  if (value === undefined || (typeof value==='number'&&!Number.isFinite(value))) throw fault('Неверное значение JSON');
  return JSON.stringify(value);
}
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typeof value==='string'?value:canonical(value)));
  return Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('');
}
export { normalizeInstant, validDateTime } from './time.js';
export function validateSource(text, { allowIncomplete = false } = {}) {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>LIMITS.source) throw fault('Ожидается JSON-файл размером до 5 МиБ',413,'SOURCE_TOO_LARGE');
  const data=strictJson(text);
  if(!validate(data))throw fault('Ошибка схемы JSON: '+validate.errors.slice(0,4).map(e=>`${e.instancePath||'/'}: ${e.message}`).join('; '));
  if(data.status==='incomplete'&&!allowIncomplete)throw fault('Партия не завершена (status: incomplete). Продолжите ввод в форме и загрузите завершённую партию.',400,'INCOMPLETE_GAME');
  normalizeInstant(data.playedAt);
  const players=data.teams.flatMap(t=>t.players);
  if(new Set(players.map(p=>p.name)).size!==4||new Set(players.map(p=>p.seat)).size!==4||new Set(data.teams.map(t=>t.id)).size!==2||new Set(data.teams.map(t=>t.name)).size!==2)throw fault('Повтор имён, ID команд или места игроков');
  if(data.rounds.length>1024||data.rounds.some(r=>r.moves.length>128))throw fault('Превышен лимит раундов или действий');
  return data;
}
export function identityDescriptor(data) { return { playedAt:normalizeInstant(data.playedAt),players:data.teams.flatMap(t=>t.players.map(p=>p.name)).sort(codepointCompare) }; }
export const identityOf = data => digest(identityDescriptor(data));
export function canonicalSource(data) {
  const d=structuredClone(data);if(d.status==='complete')delete d.status;d.playedAt=normalizeInstant(d.playedAt);
  d.teams.sort((a,b)=>codepointCompare(a.id,b.id));d.teams.forEach(t=>t.players.sort((a,b)=>a.seat-b.seat));
  d.rounds.forEach(r=>Object.values(r.deal).forEach(h=>h.sort(codepointCompare)));
  return d;
}
export const sourceDigest = data => digest(canonicalSource(data));
export const resultKey = descriptor => digest(descriptor);
export async function resultEnvelope(descriptor,result) { const wire=JSON.parse(JSON.stringify(result));const {stats,...mathematical}=wire;return {formatVersion:1,descriptor,result:wire,payloadHash:await digest(mathematical)}; }
export function projectSource(data) {
  const players=data.teams.flatMap(t=>t.players.map(p=>({...p,teamName:t.name}))).sort((a,b)=>a.seat-b.seat);
  const teams=[players[0].teamName,players[1].teamName];
  return { playedAt:data.playedAt,players,teams,fishVariant:data.fishVariant,scoreLimit:data.scoreLimit,result:data.result,
    rounds:data.rounds.map(r=>({number:r.number,moves:r.moves.length,score:teams.map(t=>r.result.total_score[t]??0)})) };
}
function exactKeys(object, required, optional=[]) {
  if(!object||Array.isArray(object)||typeof object!=='object'||required.some(k=>!Object.hasOwn(object,k))||Object.keys(object).some(k=>![...required,...optional].includes(k)))throw fault('Неверные поля объекта результата');
}
export function validateDescriptor(d, lessonManifest) {
  exactKeys(d,['version','kind'],d?.kind==='lesson'?['lessonId','lessonDataHash','mirror']:d?.kind==='branch'?['gameId','round','position','moves','example']:['gameId','round']);
  if(canonical(d.version)!==canonical(RESULT_VERSION))throw fault('Неподдерживаемая версия результата',422,'UNSUPPORTED_VERSION');
  if(!['round','branch','lesson'].includes(d.kind))throw fault('Неверный вид результата');
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  if(d.kind==='lesson') {
    if(typeof d.mirror!=='boolean'||!lessonManifest?.ids.includes(d.lessonId)||d.lessonDataHash!==lessonManifest.hash)throw fault('Неверное упражнение или версия набора');
  } else {
    if(!/^[a-f0-9]{64}$/.test(d.gameId)||!integer(d.round,1,1024))throw fault('Неверная партия или раунд');
    if(d.kind==='branch'){
      if(!integer(d.position,0,128)||!Array.isArray(d.moves)||d.moves.length>128||![null,'win','loss','draw'].includes(d.example))throw fault('Неверный путь ветки');
      for(const m of d.moves){exactKeys(m,['action'],['stone']);if(!['start','left','right','pass'].includes(m.action)||(m.action==='pass'?m.stone!==undefined:!/^[0-6]-[0-6]$/.test(m.stone)))throw fault('Неверное действие ветки');}
    }
  }
}
function distribution(r) {
  const number=v=>typeof v==='string'&&/^(0|[1-9]\d{0,1023})$/.test(v);
  if(!r||![r.leaves,r.fish,r.eggs,...(r.wins??[])].every(number)||r.wins?.length!==3||BigInt(r.leaves)<=0n)throw fault('Неверные точные счётчики');
  exactKeys(r.outcomes,['emptyHand','fish','eggs']);
  const rows=['emptyHand','fish','eggs'].map(k=>r.outcomes[k]);
  if(rows.some(a=>!Array.isArray(a)||a.length!==3||a.some(v=>!number(v))))throw fault('Неверный состав исходов');
  const sum=a=>a.reduce((n,v)=>n+BigInt(v),0n);
  if(sum(rows.flat())!==BigInt(r.leaves)||sum(rows.slice(1).flat())!==BigInt(r.fish)||sum(rows[2])!==BigInt(r.eggs)||r.wins.some((v,i)=>sum(rows.map(a=>a[i]))!==BigInt(v)))throw fault('Несогласованные суммы исходов');
  if(!Number.isSafeInteger(r.minDepth)||!Number.isSafeInteger(r.depth)||r.minDepth<0||r.depth<r.minDepth||r.depth>128)throw fault('Неверные границы глубины');
}
/** Bounded structural validation; deliberately does not prove legal play or full search. */
export async function validateEnvelope(key,envelope,lessonManifest) {
  exactKeys(envelope,['formatVersion','descriptor','result','payloadHash'],['provenance','cached']);
  if(envelope.formatVersion!==1)throw fault('Неподдерживаемый формат результата',422,'UNSUPPORTED_VERSION');
  validateDescriptor(envelope.descriptor,lessonManifest);
  if(key!==await resultKey(envelope.descriptor))throw fault('Ключ не совпадает с запросом');
  const r=envelope.result;
  exactKeys(r,['number','teams','players','base','steps','stats'],['playerImpacts','context','outcome','recorded','branch','lesson']);
  if(!Array.isArray(r.steps)||!r.steps.length||r.steps.length>129||!Array.isArray(r.players)||r.players.length!==4||!Array.isArray(r.teams)||r.teams.length!==2)throw fault('Неверная структура анализа');
  exactKeys(r.stats,[],['nodes','hits','cached','evicted','cacheBytesEstimate','elapsedMs']);
  if(Object.values(r.stats).some(v=>!Number.isSafeInteger(v)||v<0))throw fault('Неверная статистика вычислений');
  if(r.teams.some(t=>typeof t!=='string')||r.players.some(p=>typeof p.name!=='string'||!Number.isInteger(p.seat)||p.seat<1||p.seat>4))throw fault('Неверные игроки или команды');
  if(envelope.descriptor.kind!=='lesson'&&r.number!==envelope.descriptor.round)throw fault('Номер раунда не совпадает с запросом');
  distribution(r.base);
  for(const step of r.steps){
    exactKeys(step,['index','alternatives','terminal','hands','chain','turn','ends','leaves','wins','minDepth','depth','fish','eggs','outcomes'],['move','suits','fisher','delta','counts','points','probabilities','fishProbability','eggsProbability','impact','best','worst']);
    if(!Number.isInteger(step.index)||step.index<0||step.index>128||!Array.isArray(step.hands)||step.hands.length!==4||step.hands.some(h=>!Array.isArray(h)||h.length>7||h.some(s=>typeof s!=='string'||!/^[0-6]-[0-6]$/.test(s)))||!Array.isArray(step.chain)||step.chain.length>28||!Array.isArray(step.ends)||step.ends.length>2||!Number.isInteger(step.turn)||step.turn<0||step.turn>3||typeof step.terminal!=='boolean')throw fault('Неверная структура позиции');
    if(!Array.isArray(step.alternatives)||step.alternatives.length>56)throw fault('Неверные альтернативы');
    distribution(step);step.alternatives.forEach(distribution);
    if(step.terminal&&(step.minDepth!==0||step.depth!==0||step.alternatives.length))throw fault('Неверный терминал');
  }
  function bounds(v,depth=0){if(depth>64)throw fault('Слишком глубокий результат');if(typeof v==='number'&&!Number.isFinite(v))throw fault('Неверное число');if(Array.isArray(v)){if(v.length>1024)throw fault('Слишком большой массив');v.forEach(x=>bounds(x,depth+1));}else if(v&&typeof v==='object'){if(Object.keys(v).length>256)throw fault('Слишком большой объект');Object.values(v).forEach(x=>bounds(x,depth+1));}}
  bounds(r);
  if(!/^[a-f0-9]{64}$/.test(envelope.payloadHash)||envelope.payloadHash!==(await resultEnvelope(envelope.descriptor,r)).payloadHash)throw fault('Хеш результата не совпадает');
  return envelope;
}
