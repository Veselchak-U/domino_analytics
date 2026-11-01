import { STONES, SUITS, stoneId, maskOf, stonesOf, countBits, applyMove, settle, forcedOpening } from './game.js';
import { normalizeInstant } from './time.js';
import { parseGame, recordedResult } from './input.js';

const FULL=2**28-1;
const DOUBLES=STONES.reduce((m,[a,b],i)=>m|(a===b?1<<i:0),0);
const emptyRound=()=>({moves:[],remaining:[[],[],[],[]]});
const namedPlayers=d=>d.teams.flatMap(t=>t.players.map(p=>({...p,teamName:t.name}))).sort((a,b)=>a.seat-b.seat);
/**
 * @typedef {{document:object,active:{moves:object[],remaining:string[][]}|null}} Entry
 * document contains only confirmed rounds. active is temporary and is never serialized.
 * All transitions return a new entry; failed validation leaves the previous entry intact.
 */
function headerOf(data){
  const d=structuredClone(data);
  normalizeInstant(d.playedAt);
  if(d.format!=='kozel-game-v1'||!['withEggs','withoutEggs'].includes(d.fishVariant)||![50,101].includes(d.scoreLimit))throw new Error('Выберите формат, вариант рыбы и лимит 50 или 101');
  if(!Array.isArray(d.teams)||d.teams.length!==2||d.teams.some(t=>!Array.isArray(t.players)||t.players.length!==2||!/^[a-zA-Z0-9_-]+$/.test(t.id)))throw new Error('Нужны две команды по два участника');
  const players=namedPlayers(d),names=[...d.teams.map(t=>t.name),...players.map(p=>p.name)];
  if(names.some(n=>typeof n!=='string'||!n.trim()))throw new Error('Введите имена всех участников и команд');
  if(new Set(players.map(p=>p.name)).size!==4||new Set(d.teams.map(t=>t.name)).size!==2||new Set(d.teams.map(t=>t.id)).size!==2)throw new Error('Имена участников, имена и ID команд не должны повторяться');
  if(players.some((p,i)=>p.seat!==i+1)||players[0].teamName!==players[2].teamName||players[1].teamName!==players[3].teamName)throw new Error('Места 1–4 уникальны; партнёры сидят напротив: 1/3 и 2/4');
  return {playedAt:d.playedAt,format:d.format,fishVariant:d.fishVariant,scoreLimit:d.scoreLimit,teams:d.teams};
}
/** @returns {Entry} */
export function createEntry(header){return {document:{...headerOf(header),status:'incomplete',rounds:[]},active:emptyRound()};}
export function entryContext(entry){
  const d=entry.document;
  if(!d.rounds.length)return {fishVariant:d.fishVariant,scoreLimit:d.scoreLimit,score:[0,0],fence:[0,0],eggs:0,previous:null};
  const checked=parseGame(JSON.stringify(d),{allowIncomplete:true}),last=checked.rounds.at(-1).outcome;
  return {fishVariant:d.fishVariant,scoreLimit:d.scoreLimit,score:last.totalScore,fence:last.fence,eggs:last.eggs,previous:last};
}
/** Exact capacitated Hall condition for remaining tiles and four possible owners. */
function possibleRemainders(position,remaining){
  if(!Array.isArray(remaining)||remaining.length!==4||remaining.some(h=>!Array.isArray(h)))throw new Error('Укажите остатки четырёх участников');
  const masks=remaining.map(maskOf),selected=masks.reduce((m,h)=>m|h,0);
  if(masks.some((h,p)=>countBits(h)>position.capacities[p]||(h&position.played)||(h&position.forbidden[p])))throw new Error('Остаток превышает размер руки, содержит сыгранный камень или противоречит пасу');
  if(countBits(selected)!==remaining.reduce((n,h)=>n+h.length,0))throw new Error('Один камень указан в остатках нескольких игроков');
  const owners=[];
  for(let i=0;i<28;i++){
    const bit=1<<i;if(position.played&bit)continue;
    const forced=masks.findIndex(h=>h&bit);
    let allowed=0;
    for(let p=0;p<4;p++)if(position.capacities[p]>0&&!(position.forbidden[p]&bit)&&(forced<0||forced===p))allowed|=1<<p;
    if(!allowed)throw new Error('Запись пасов не допускает распределения оставшихся камней');
    owners.push(allowed);
  }
  for(let subset=1;subset<16;subset++){
    const capacity=position.capacities.reduce((n,c,p)=>n+((subset&(1<<p))?c:0),0);
    if(owners.filter(mask=>(mask&~subset)===0).length>capacity)throw new Error('Запись пасов и размеры рук несовместимы');
  }
  return masks;
}
/** Observable prefix, remaining capacities and pass constraints; full deal validation happens at confirmation. @param {Entry} entry */
export function entryPosition(entry){
  if(!entry.active)throw new Error('Нет открытого раунда');
  const context=entryContext(entry),players=namedPlayers(entry.document);
  const forcedStart=forcedOpening(context,entry.document.rounds.length+1)!==null;
  const position={played:0,byPlayer:[0,0,0,0],forbidden:[0,0,0,0],capacities:[7,7,7,7],chain:[],turn:forcedStart?null:context.previous.finishedPlayer,left:null,right:null,fisher:-1,terminal:false,reason:null,context,players};
  for(const [index,move] of entry.active.moves.entries()){
    try{
      if(position.terminal)throw new Error('Ход после завершения раунда');
      const actor=players.findIndex(p=>p.name===move.player);
      if(actor<0)throw new Error('Неизвестный участник');
      if(position.turn!==null&&actor!==position.turn)throw new Error('Нарушена очередь: ожидается '+players[position.turn].name);
      if(!['start','left','right','pass'].includes(move.action))throw new Error('Неизвестное действие');
      if(move.action==='pass'){
        if(move.stone!==undefined||!position.chain.length)throw new Error('Пас при заходе или с камнем недопустим');
        position.forbidden[actor]|=(FULL^position.played)&(SUITS[position.left]|SUITS[position.right]);
      }else{
        const id=stoneId(move.stone),bit=1<<id,[a,b]=move.stone.split('-').map(Number);
        if(position.played&bit)throw new Error('Этот камень уже сыгран');
        if(position.forbidden[actor]&bit)throw new Error('Камень противоречит ранее записанному пасу участника');
        if(!position.chain.length){if(move.action!=='start')throw new Error('Первое действие — заход');if(forcedStart&&id!==stoneId('1-1'))throw new Error('Обязателен заход с 1-1');position.left=a;position.right=b;position.chain=[move.stone];}
        else if(move.action==='left'&&b===position.left){position.left=a;position.chain.unshift(move.stone);}
        else if(move.action==='right'&&a===position.right){position.right=b;position.chain.push(move.stone);}
        else throw new Error('Неверный край или ориентация камня');
        position.played|=bit;position.byPlayer[actor]|=bit;position.capacities[actor]--;
        if(position.capacities[actor]<0)throw new Error('Игрок выложил больше семи камней');
        if(countBits(position.byPlayer[actor]&DOUBLES)>=5||SUITS.some(s=>countBits(position.byPlayer[actor]&s)>=6))throw new Error('Известная начальная рука требует пересдачи');
        if(a!==b)position.fisher=actor;
      }
      position.turn=(actor+1)%4;
      if(position.capacities.includes(0)){position.terminal=true;position.reason='emptyHand';position.finishedPlayer=actor;}
      else if(position.chain.length&&!((FULL^position.played)&(SUITS[position.left]|SUITS[position.right]))){position.terminal=true;position.reason='fish';position.finishedPlayer=position.fisher;}
      possibleRemainders(position,[[],[],[],[]]);
    }catch(e){throw new Error(`Ход ${index+1}: ${e.message}`);}
  }
  possibleRemainders(position,entry.active.remaining);
  return position;
}
export function appendEntryMove(entry,move){
  if(!entry.active)throw new Error('Сначала начните следующий раунд');
  if(entry.active.moves.length>=128)throw new Error('Максимум 128 действий в раунде');
  const next={...entry,active:{moves:[...entry.active.moves,{...move}],remaining:[[],[],[],[]]}};
  entryPosition(next);return next;
}
export function undoEntryMove(entry){
  if(!entry.active?.moves.length)return entry;
  return {...entry,active:{moves:entry.active.moves.slice(0,-1),remaining:[[],[],[],[]]}};
}
export function moveSuggestions(entry,player){
  const p=entryPosition(entry),actor=p.players.findIndex(a=>a.name===player);
  if(p.terminal||actor<0||(p.turn!==null&&p.turn!==actor))return [];
  const choices=[];
  for(const [a,b]of STONES){
    if(p.played&(1<<stoneId(`${a}-${b}`)))continue;
    if(!p.chain.length)choices.push({player,action:'start',stone:`${a}-${b}`});
    else for(const action of ['left','right']){
      const end=action==='left'?p.left:p.right;if(a!==end&&b!==end)continue;
      const other=a===end?b:a;choices.push({player,action,stone:action==='left'?`${other}-${end}`:`${end}-${other}`});
    }
  }
  if(p.chain.length)choices.push({player,action:'pass'});
  return choices.filter(move=>{try{appendEntryMove(entry,move);return true;}catch{return false;}});
}
export function setRemainders(entry,remaining){
  const p=entryPosition(entry);if(!p.terminal)throw new Error('Остатки вводятся после завершения раунда');
  possibleRemainders(p,remaining);
  return {...entry,active:{...entry.active,remaining:remaining.map(h=>stonesOf(maskOf(h)))}};
}
/** Reconstruct all 28 tiles, replay the round and append its verified result. @param {Entry} entry */
export function confirmEntryRound(entry){
  const p=entryPosition(entry);if(!p.terminal)throw new Error('Раунд ещё не завершён');
  if(entry.active.remaining.some((h,i)=>h.length!==p.capacities[i]))throw new Error('Распределите все остатки: каждому игроку должно достаться нужное число камней');
  const hands=entry.active.remaining.map((h,i)=>maskOf(h)|p.byPlayer[i]);
  if(hands.reduce((m,h)=>m|h,0)!==FULL||hands.some(h=>countBits(h)!==7))throw new Error('Нужны все 28 разных камней, по семь в начальной руке');
  if(hands.some(h=>countBits(h&DOUBLES)>=5||SUITS.some(s=>countBits(h&s)>=6)))throw new Error('Восстановленная начальная раздача требует пересдачи');
  let state={hands,left:null,right:null,turn:p.players.findIndex(a=>a.name===entry.active.moves[0].player),fisher:-1,forcedStart:forcedOpening(p.context,entry.document.rounds.length+1)};
  for(const [i,move]of entry.active.moves.entries()){
    if(move.player!==p.players[state.turn].name)throw new Error(`Ход ${i+1}: нарушена очередь`);
    try{state=applyMove(state,move);}catch(e){throw new Error(`Ход ${i+1}: ${e.message}`);}
  }
  const outcome=settle(state,p.context);if(!outcome)throw new Error('Раунд ещё не завершён');
  const teams=[p.players[0].teamName,p.players[1].teamName];
  const round={number:entry.document.rounds.length+1,deal:Object.fromEntries(p.players.map((a,i)=>[a.name,stonesOf(hands[i])])),moves:entry.active.moves.map(m=>({...m})),result:recordedResult(outcome,p.players,teams)};
  const document={...entry.document,rounds:[...entry.document.rounds,round],status:outcome.gameWinner===null?'incomplete':'complete'};
  if(outcome.gameWinner!==null)document.result=outcome.gameWinner===2?{draw:true}:{winner:teams[outcome.gameWinner]};
  parseGame(JSON.stringify(document),{allowIncomplete:true});
  return {document,active:null};
}
export function nextEntryRound(entry){
  if(entry.document.status==='complete')throw new Error('Партия завершена');
  if(entry.active?.moves.length)throw new Error('Сначала завершите текущий раунд');
  if(entry.document.rounds.length>=1024)throw new Error('Максимум 1024 раунда');
  return {...entry,active:emptyRound()};
}
export function exportEntry(entry){
  if(entry.active?.moves.length)throw new Error('Завершите и подтвердите текущий раунд перед выгрузкой');
  if(!entry.document.rounds.length)throw new Error('Для выгрузки нужен хотя бы один завершённый раунд');
  const text=JSON.stringify(entry.document,null,2);parseGame(text,{allowIncomplete:true});return text;
}
export function importEntry(text){
  const checked=parseGame(text,{allowIncomplete:true}),document=JSON.parse(text);
  if(document.status!=='incomplete')throw new Error('Эта кнопка загружает только незавершённую партию (status: incomplete)');
  if(!checked.rounds.length)throw new Error('Нужен завершённый раунд');
  return {document,active:emptyRound()};
}
export function entryFileName(entry){return 'domino-'+entry.document.playedAt.slice(0,19).replaceAll(':','-')+'_'+entry.document.status+'.json';}
