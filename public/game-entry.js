import { createEntry, appendEntryMove, undoEntryMove, entryPosition, entryContext, setRemainders, confirmEntryRound, nextEntryRound, exportEntry, importEntry, entryFileName, moveSuggestions } from '../shared/game-entry.js';
import { STONES, stoneId } from '../shared/game.js';

const $=id=>document.getElementById(id);
const node=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
const actionLabel=m=>m.action==='pass'?'Пас':`${m.stone.replace('-','–')} · ${{start:'заход',left:'слева',right:'справа'}[m.action]}`;

/** One in-memory editor. Only confirmed whole rounds leave it as JSON. */
export class GameEntry {
  constructor({root,tile,onAnalyze}){
    this.root=root;this.tile=tile;this.onAnalyze=onAnalyze;this.entry=null;this.view='active';this.actor=0;this.owner=0;this.dirty=false;
    root.innerHTML=`
      <div class="section-top"><h2 id="entry-title" tabindex="-1">Запись партии</h2><button id="entry-close" type="button" class="button secondary">Вернуться к анализу</button></div>
      <p class="muted">Вводите ходы по порядку. Начальные руки восстановятся из сыгранных камней и остатков в конце раунда.</p>
      <div class="entry-tools"><label class="button secondary" for="entry-load">Загрузить незавершённую партию</label><input id="entry-load" type="file" accept=".json,application/json" class="file-input"><button id="entry-new" class="button secondary" type="button" hidden>Новая партия</button></div>
      <p id="entry-error" class="message error" role="alert" hidden></p>
      <dialog id="entry-discard" aria-labelledby="entry-discard-text"><p id="entry-discard-text"></p><div class="entry-tools"><button id="entry-discard-cancel" class="button secondary" type="button">Отмена</button><button id="entry-discard-accept" class="button primary" type="button">Заменить данные</button></div></dialog>
      <form id="entry-setup">
        <fieldset><legend>Общие данные партии</legend><div class="entry-fields">
          <label>Начало партии<input id="entry-date" type="datetime-local" step="1" required></label>
          <label>Часовой пояс<input id="entry-zone" type="text" value="+03:00" placeholder="+03:00 или Z" required></label>
          <label>Вариант рыбы<select id="entry-variant"><option value="withEggs">Рыба с яйцами</option><option value="withoutEggs">Рыба без яиц</option></select></label>
          <label>Лимит<select id="entry-limit"><option value="101">101</option><option value="50">50</option></select></label>
          <label>Команда мест 1 и 3<input id="entry-team-a" value="Команда 1" required maxlength="120"></label>
          <label>Команда мест 2 и 4<input id="entry-team-b" value="Команда 2" required maxlength="120"></label>
          <label>Участник · место 1<input id="entry-player-0" required maxlength="120" autocomplete="off"></label>
          <label>Участник · место 2<input id="entry-player-1" required maxlength="120" autocomplete="off"></label>
          <label>Участник · место 3<input id="entry-player-2" required maxlength="120" autocomplete="off"></label>
          <label>Участник · место 4<input id="entry-player-3" required maxlength="120" autocomplete="off"></label>
        </div></fieldset>
        <p class="muted">Места идут по часовой стрелке. Партнёры сидят напротив. Дата, участники и правила фиксируются на всю партию.</p>
        <button type="submit" class="button primary">Начать первый раунд</button>
      </form>
      <div id="entry-session" hidden>
        <header class="entry-heading"><h3 id="entry-game-heading"></h3><p id="entry-game-players"></p><p id="entry-game-rules" class="muted"></p><strong id="entry-total"></strong></header>
        <nav id="entry-rounds" class="entry-tools" aria-label="Раунды записи"></nav>
        <h3 id="entry-round-title"></h3><p id="entry-round-state" role="status"></p>
        <div id="entry-board" class="entry-board"><div id="entry-chain" class="chain" aria-label="Цепочка введённых ходов"></div></div>
        <section id="entry-move-panel">
          <div class="entry-tools"><label for="entry-actor">Ходит</label><select id="entry-actor"></select><button id="entry-undo" type="button" class="button secondary">Отменить последний ход</button></div>
          <p class="muted">Подсказки совместимы с известными ходами и пасами. Полная проверка рук и допустимости пасов выполняется после ввода остатков.</p>
          <div id="entry-play-pool"><h3>Невыставленные камни</h3><p class="muted">Перетащите камень на игровое поле. Если подходит только один край, сторона выберется автоматически. Если подходят оба — отпустите ближе к нужному краю.</p><div id="entry-play-tiles" class="entry-tile-pool" aria-label="Невыставленные камни"><button id="entry-pass" type="button" class="button secondary">Пас</button></div></div>
          <details id="entry-button-moves"><summary>Выбрать ход кнопкой</summary><div id="entry-suggestions" class="entry-suggestions" aria-label="Подсказки ходов"></div></details>
        </section>
        <section id="entry-remainders" hidden>
          <h3>Остатки на руках</h3><p>Перетащите оставшиеся камни к игрокам. Можно переносить между игроками или возвращать в набор. Для ввода кнопками выберите участника и нажимайте на камни.</p>
          <div id="entry-owners" class="entry-owners"></div><h4>Неназначенные камни</h4><div id="entry-remaining-tiles" class="entry-tile-pool entry-drop-pool" aria-label="Неназначенные камни · возврат в набор"></div>
          <p id="entry-remaining-count" role="status"></p>
          <button id="entry-assign-rest" type="button" class="button secondary">Назначить оставшиеся выбранному участнику</button>
          <button id="entry-confirm" type="button" class="button primary">Подтвердить раунд и рассчитать счёт</button>
        </section>
        <section id="entry-score" hidden><h3>Результат раунда</h3><p id="entry-outcome"></p><div id="entry-score-table" class="history-scroll"></div><p id="entry-eggs"></p></section>
        <details class="entry-history"><summary>Введённые ходы</summary><ol id="entry-history"></ol></details>
        <div class="entry-tools"><button id="entry-next" type="button" class="button primary" hidden>Следующий раунд</button><button id="entry-export" type="button" class="button secondary">Скачать JSON</button><button id="entry-analyze" type="button" class="button primary">Скачать и рассчитать с сохранением</button></div>
        <p id="entry-export-note" class="muted"></p><p id="entry-final" class="entry-final" role="status"></p>
      </div>`;
    const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset());$('entry-date').value=now.toISOString().slice(0,19);
    $('entry-setup').addEventListener('input',()=>{this.dirty=true;});
    $('entry-setup').addEventListener('submit',event=>{event.preventDefault();this.change(()=>createEntry(this.readHeader()));});
    $('entry-close').addEventListener('click',()=>this.close());
    $('entry-new').addEventListener('click',async()=>{if(!await this.confirmReplacement('Начать новую партию? Нескачанные данные текущей формы будут потеряны.'))return;this.entry=null;this.dirty=false;this.view='active';this.render();});
    $('entry-discard-cancel').addEventListener('click',()=>this.resolveReplacement(false));
    $('entry-discard-accept').addEventListener('click',()=>this.resolveReplacement(true));
    $('entry-discard').addEventListener('cancel',event=>{event.preventDefault();this.resolveReplacement(false);});
    $('entry-actor').addEventListener('change',()=>{this.actor=Number($('entry-actor').value);this.renderChoices();});
    $('entry-undo').addEventListener('click',()=>this.change(()=>undoEntryMove(this.entry)));
    $('entry-pass').addEventListener('click',()=>this.change(()=>appendEntryMove(this.entry,{player:entryPosition(this.entry).players[this.actor].name,action:'pass'})));
    root.addEventListener('dragstart',event=>this.startDrag(event));
    const allowDrop=event=>{
      const target=event.target.closest('[data-entry-drop]');
      if(!this.drag||!target||!root.contains(target))return;
      event.preventDefault();event.dataTransfer.dropEffect='move';
      if(target.dataset.entryDrop==='board'){
        const side=this.dropAction(target,event.clientX,this.drag.stone),allowed=this.dragAllows(side);
        target.dataset.entrySide=side;target.dataset.entryPreview=`${{start:'Заход',left:'← Слева',right:'Справа →'}[side]}${allowed?'':' · камень не подходит'}`;
        target.classList.toggle('entry-drop-allowed',allowed);
      }
    };
    root.addEventListener('dragenter',allowDrop);root.addEventListener('dragover',allowDrop);
    root.addEventListener('dragleave',event=>{
      const target=event.target.closest('[data-entry-drop]');
      if(target?.dataset.entryDrop==='board'&&!target.contains(event.relatedTarget))this.clearBoardPreview();
    });
    root.addEventListener('drop',event=>{
      const target=event.target.closest('[data-entry-drop]'),drag=this.drag;
      this.clearDrag();
      if(!drag||!target||!root.contains(target)||drag.entry!==this.entry)return;
      event.preventDefault();this.dropStone(drag.stone,this.dropAction(target,event.clientX,drag.stone));
    });
    root.addEventListener('dragend',()=>this.clearDrag());
    $('entry-confirm').addEventListener('click',()=>this.change(()=>confirmEntryRound(this.entry),false));
    $('entry-next').addEventListener('click',()=>this.change(()=>nextEntryRound(this.entry)));
    $('entry-export').addEventListener('click',()=>this.download(false));
    $('entry-analyze').addEventListener('click',()=>this.download(true));
    $('entry-assign-rest').addEventListener('click',()=>{
      const p=entryPosition(this.entry),remaining=this.entry.active.remaining.map(h=>[...h]);
      for(const pair of STONES){const stone=pair.join('-');if(!(p.played&(1<<stoneId(stone)))&&!remaining.some(h=>h.includes(stone)))remaining[this.owner].push(stone);}
      this.change(()=>setRemainders(this.entry,remaining));
    });
    $('entry-load').addEventListener('change',async()=>{
      const file=$('entry-load').files[0];if(!file)return;
      try{if(file.size>5*1024*1024)throw new Error('Максимальный размер JSON — 5 МиБ');const restored=importEntry(await file.text());if(!await this.confirmReplacement('Заменить данные формы загруженной партией? Нескачанный ввод будет потерян.'))return;this.entry=restored;this.view='active';this.dirty=false;this.render();}
      catch(e){this.error(e.message);}finally{$('entry-load').value='';}
    });
  }
  async confirmReplacement(message){
    if(!this.dirty)return true;
    $('entry-discard-text').textContent=message;
    const decision=new Promise(resolve=>{this.replacementDecision=resolve;});
    $('entry-discard').showModal();return decision;
  }
  resolveReplacement(accepted){
    $('entry-discard').close();const resolve=this.replacementDecision;this.replacementDecision=null;resolve?.(accepted);
  }
  readHeader(){
    const date=$('entry-date').value;
    const players=Array.from({length:4},(_,i)=>({name:$('entry-player-'+i).value.trim(),seat:i+1}));
    return {playedAt:date+(/T\d\d:\d\d$/.test(date)?':00':'')+$('entry-zone').value.trim(),format:'kozel-game-v1',fishVariant:$('entry-variant').value,scoreLimit:Number($('entry-limit').value),teams:[{id:'A',name:$('entry-team-a').value.trim(),players:[players[0],players[2]]},{id:'B',name:$('entry-team-b').value.trim(),players:[players[1],players[3]]}]};
  }
  open(){document.body.classList.add('entry-active');this.root.hidden=false;this.render();$('entry-title').focus();}
  close(){this.clearDrag();document.body.classList.remove('entry-active');this.root.hidden=true;}
  error(message){$('entry-error').hidden=!message;$('entry-error').textContent=message;}
  change(operation,active=true){try{this.entry=operation();this.dirty=true;this.view=active&&this.entry.active?'active':this.entry.document.rounds.length;this.render();}catch(e){this.error(e.message);}}
  render(){
    this.clearDrag();
    this.error('');$('entry-setup').hidden=!!this.entry;$('entry-session').hidden=!this.entry;$('entry-new').hidden=!this.entry;
    if(!this.entry)return;
    const d=this.entry.document,players=d.teams.flatMap(t=>t.players.map(p=>({...p,team:t.name}))).sort((a,b)=>a.seat-b.seat),teams=[players[0].team,players[1].team];
    $('entry-game-heading').textContent='Партия · '+d.playedAt.replace('T',' ');
    $('entry-game-players').textContent=players.map(p=>`${p.seat}. ${p.name}`).join(' · ');
    $('entry-game-rules').textContent=`${teams.join(' / ')} · ${d.fishVariant==='withEggs'?'рыба с яйцами':'рыба без яиц'} · до ${d.scoreLimit}`;
    const last=d.rounds.at(-1);$('entry-total').textContent='Счёт партии: '+teams.map(t=>`${t} ${last?.result.total_score[t]??0}`).join(' : ');
    $('entry-rounds').replaceChildren();
    for(const r of d.rounds){const b=node('button','button secondary',`Раунд ${r.number}`);b.type='button';b.setAttribute('aria-pressed',String(this.view===r.number));b.onclick=()=>{this.view=r.number;this.render();};$('entry-rounds').append(b);}
    if(this.entry.active){const b=node('button','button secondary',`Запись раунда ${d.rounds.length+1}`);b.type='button';b.setAttribute('aria-pressed',String(this.view==='active'));b.onclick=()=>{this.view='active';this.render();};$('entry-rounds').append(b);}
    const active=this.view==='active'&&!!this.entry.active;
    const round=active?null:d.rounds[Number(this.view)-1]??last;
    const p=active?entryPosition(this.entry):null;
    const moves=active?this.entry.active.moves:round?.moves??[];
    let chain=p?.chain??[];
    if(!active)for(const m of moves){if(m.action==='start')chain=[m.stone];if(m.action==='left')chain.unshift(m.stone);if(m.action==='right')chain.push(m.stone);}
    $('entry-round-title').textContent=`Раунд ${active?d.rounds.length+1:round?.number??1}${active?' · запись':' · завершён'}`;
    $('entry-round-state').textContent=!active?'Раунд подтверждён. Общие данные партии сохранены.':p.terminal?p.reason==='emptyHand'?`${players[p.finishedPlayer].name} выложил все семь камней. Победитель раунда — ${players[p.finishedPlayer].team}. Заполните остатки остальных рук.`:'Рыба: ни один оставшийся камень не подходит к концам. Заполните остатки для определения начислений и итога.':p.chain.length?`Следующий ход: ${players[p.turn].name}.`:'Выберите участника и заход. Подсказки учитывают вариант и счёт партии.';
    $('entry-chain').replaceChildren(...chain.map(s=>this.tile(s,'chain')));if(!chain.length)$('entry-chain').append(node('span','muted','Цепочка ещё не начата'));
    const board=$('entry-board');delete board.dataset.entryDrop;
    if(active&&!p.terminal){board.dataset.entryDrop='board';if(!chain.length)$('entry-chain').replaceChildren(node('span','','Перетащите сюда камень для захода'));}
    $('entry-play-tiles').replaceChildren($('entry-pass'));$('entry-owners').replaceChildren();$('entry-remaining-tiles').replaceChildren();delete $('entry-remaining-tiles').dataset.entryDrop;
    $('entry-move-panel').hidden=!active;$('entry-remainders').hidden=!active||!p.terminal;
    if(active){
      if(p.turn!==null)this.actor=p.turn;
      $('entry-actor').replaceChildren(...players.map((a,i)=>{const option=node('option','',a.name);option.value=String(i);option.disabled=p.turn!==null&&p.turn!==i;return option;}));
      $('entry-actor').value=String(this.actor);$('entry-actor').disabled=p.terminal;
      $('entry-undo').disabled=!moves.length;this.renderChoices(p);
      if(p.terminal)this.renderRemainders(p);
    }
    $('entry-history').replaceChildren(...moves.map(m=>node('li','',`${m.player}: ${actionLabel(m)}`)));
    $('entry-score').hidden=!round;
    if(round){
      const r=round.result;$('entry-outcome').textContent=`${{emptyHand:'Выход',fish:'Рыба',eggs:'Рыба с яйцами'}[r.reason]} · завершил ${r.finished_player}. ${r.winner_team?'Победитель раунда: '+r.winner_team+'.':'Победитель раунда не назначается.'}`;
      const table=node('table'),head=node('tr');for(const label of ['Команда','За раунд','Записанный счёт','Забор'])head.append(node('th','',label));table.append(head);
      for(const team of teams){const row=node('tr');for(const value of [team,r.round_score[team],r.total_score[team],r.fence?.[team]??0])row.append(node('td','',String(value)));table.append(row);}
      $('entry-score-table').replaceChildren(table);$('entry-eggs').textContent=`Банк яиц: ${r.eggs??0}. Счёт в таблице — после этого раунда.`;
    }
    $('entry-next').hidden=!!this.entry.active||d.status==='complete';
    const canExport=d.rounds.length>0&&!this.entry.active?.moves.length;
    $('entry-export').disabled=!canExport;$('entry-analyze').disabled=!canExport||d.status!=='complete';
    $('entry-export-note').textContent=!canExport?'Для выгрузки завершите и подтвердите текущий раунд. Частичный раунд в JSON не сохраняется.':d.status==='incomplete'?'Можно скачать незавершённую партию и позже продолжить со следующего раунда. На сервер и расчёт доступна только полностью завершённая партия.':'Партия готова: можно скачать JSON или скачать и передать в клиентский расчёт и сохранение на сервере.';
    $('entry-final').textContent=d.status==='complete'?d.result.draw?'Партия завершена — окончательная ничья.':'Партия завершена. Победитель: '+d.result.winner+'.':'';
  }
  renderChoices(position){
    if(!this.entry?.active)return;
    const p=position??entryPosition(this.entry),player=p.players[this.actor].name;
    const choices=p.terminal?[]:moveSuggestions(this.entry,player);
    const playable=new Set(choices.filter(m=>m.stone).map(m=>stoneId(m.stone)));
    $('entry-play-pool').hidden=p.terminal;$('entry-button-moves').hidden=p.terminal;
    $('entry-pass').hidden=!choices.some(m=>m.action==='pass');
    $('entry-play-tiles').replaceChildren($('entry-pass'),...STONES.map(pair=>pair.join('-')).filter(s=>!(p.played&(1<<stoneId(s)))).map(s=>{
      const allowed=playable.has(stoneId(s)),button=this.draggableStone(s,allowed?'Перетащить на поле':'Сейчас нельзя выложить этот камень');
      button.disabled=!allowed;button.draggable=allowed;return button;
    }));
    if(p.terminal)$('entry-play-tiles').replaceChildren($('entry-pass'));
    $('entry-suggestions').replaceChildren(...choices.map(m=>{const b=node('button','button secondary entry-choice');b.type='button';b.setAttribute('aria-label',`${player}: ${actionLabel(m)}`);if(m.stone)b.append(this.tile(m.stone,'chain'));b.append(node('span','',actionLabel(m)));b.onclick=()=>this.change(()=>appendEntryMove(this.entry,m));return b;}));
  }
  renderRemainders(p){
    const remaining=this.entry.active.remaining;
    if(!p.capacities[this.owner])this.owner=p.capacities.findIndex(c=>c>0);
    $('entry-owners').replaceChildren(...p.players.map((a,i)=>{
      const card=this.dropZone(String(i),'');card.className='entry-owner entry-drop';
      const button=node('button','button secondary',`${a.name} · ${remaining[i].length} / ${p.capacities[i]}`);button.type='button';button.disabled=!p.capacities[i];button.setAttribute('aria-pressed',String(i===this.owner));button.onclick=()=>{this.clearDrag();this.owner=i;this.renderRemainders(p);};
      const hand=node('div','hand-stones');hand.append(...remaining[i].map(s=>this.draggableStone(s,'Вернуть в набор',()=>this.assignStone(s,-1))));if(!remaining[i].length)hand.append(node('span','muted',p.capacities[i]?'Перетащите камни сюда':'Все камни выложены'));card.append(button,hand);return card;
    }));
    const available=STONES.map(pair=>pair.join('-')).filter(s=>!(p.played&(1<<stoneId(s))));
    $('entry-remaining-tiles').dataset.entryDrop='pool';
    $('entry-remaining-tiles').replaceChildren(...available.filter(s=>!remaining.some(h=>h.includes(s))).map(s=>this.draggableStone(s,`Назначить: ${p.players[this.owner].name}`,()=>this.assignStone(s,this.owner))));
    if(!$('entry-remaining-tiles').children.length)$('entry-remaining-tiles').append(node('span','muted','Все камни распределены. Перетащите сюда камень, чтобы вернуть в набор.'));
    const assigned=remaining.reduce((n,h)=>n+h.length,0);$('entry-remaining-count').textContent=`Распределено ${assigned} из ${available.length}. Выбран участник: ${p.players[this.owner].name}.`;
    $('entry-confirm').disabled=remaining.some((h,i)=>h.length!==p.capacities[i]);
    $('entry-assign-rest').disabled=p.capacities[this.owner]-remaining[this.owner].length!==available.length-assigned||assigned===available.length;
  }
  dropZone(target,label){const zone=node('div','entry-drop',label);zone.dataset.entryDrop=target;return zone;}
  draggableStone(stone,label,click){
    const b=node('button','button secondary entry-drag-stone');b.type='button';b.draggable=true;b.dataset.entryStone=stone;
    b.setAttribute('aria-label',`${stone.replace('-','–')} · ${label}`);b.title=label;b.append(this.tile(stone,'hand'));
    if(click)b.onclick=click;return b;
  }
  /** Drag state is local to this editor and never read from an external DataTransfer. */
  startDrag(event){
    this.clearDrag();const tile=event.target.closest('[data-entry-stone]');
    if(!tile||tile.disabled||!this.root.contains(tile)||this.view!=='active'||!this.entry?.active){event.preventDefault();return;}
    this.drag={stone:tile.dataset.entryStone,entry:this.entry};
    event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',this.drag.stone);
    this.error('');tile.classList.add('entry-dragging');
    for(const zone of this.root.querySelectorAll('[data-entry-drop]')){
      const target=zone.dataset.entryDrop;
      zone.classList.toggle('entry-drop-allowed',target==='board'?['start','left','right'].some(side=>this.dragAllows(side)):this.dragAllows(target));
    }
  }
  clearDrag(){
    this.drag=null;
    this.clearBoardPreview();
    for(const n of this.root.querySelectorAll('.entry-drop-allowed'))n.classList.remove('entry-drop-allowed');
    for(const n of this.root.querySelectorAll('.entry-dragging'))n.classList.remove('entry-dragging');
  }
  clearBoardPreview(){
    const board=$('entry-board');delete board.dataset.entrySide;delete board.dataset.entryPreview;board.classList.remove('entry-drop-allowed');
  }
  /** Prefer the only legal side; resolve two legal sides against current viewport bounds. */
  dropAction(target,clientX,stone){
    if(target.dataset.entryDrop!=='board')return target.dataset.entryDrop;
    const p=entryPosition(this.entry);
    if(!p.chain.length)return 'start';
    const moves=moveSuggestions(this.entry,p.players[this.actor].name).filter(m=>m.stone&&stoneId(m.stone)===stoneId(stone));
    if(moves.length===1)return moves[0].action;
    const {left,right}=target.getBoundingClientRect();return clientX<(left+right)/2?'left':'right';
  }
  moveForDrop(stone,side){
    const p=entryPosition(this.entry);
    return moveSuggestions(this.entry,p.players[this.actor].name).find(m=>m.action===side&&m.stone&&stoneId(m.stone)===stoneId(stone));
  }
  remainderWith(stone,owner){
    const remaining=this.entry.active.remaining.map(h=>h.filter(s=>stoneId(s)!==stoneId(stone)));
    if(owner>=0)remaining[owner].push(stone);return remaining;
  }
  assignStone(stone,owner){this.change(()=>setRemainders(this.entry,this.remainderWith(stone,owner)));}
  dragAllows(target){
    try{
      if(!this.drag||this.drag.entry!==this.entry)return false;
      if(entryPosition(this.entry).terminal){
        if(target!=='pool'&&!/^[0-3]$/.test(target))return false;
        setRemainders(this.entry,this.remainderWith(this.drag.stone,target==='pool'?-1:Number(target)));return true;
      }
      return !!this.moveForDrop(this.drag.stone,target);
    }catch{return false;}
  }
  dropStone(stone,target){
    if(this.view!=='active'||!this.entry?.active)return;
    this.change(()=>{
      const p=entryPosition(this.entry);
      if(p.terminal){
        if(target!=='pool'&&!/^[0-3]$/.test(target))throw new Error('Перенесите остаток к игроку или в набор');
        return setRemainders(this.entry,this.remainderWith(stone,target==='pool'?-1:Number(target)));
      }
      const move=this.moveForDrop(stone,target);
      if(!move)throw new Error('Этот камень нельзя выложить в выбранную зону. Проверьте край и очередь хода.');
      return appendEntryMove(this.entry,move);
    });
  }
  async download(analyze){
    try{
      if(analyze&&this.entry.document.status!=='complete')throw new Error('Расчёт доступен только завершённой партии');
      const text=exportEntry(this.entry),name=entryFileName(this.entry),url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.dirty=false;
      if(analyze){this.close();await this.onAnalyze(text,name);}
    }catch(e){this.error(e.message);}
  }
}
