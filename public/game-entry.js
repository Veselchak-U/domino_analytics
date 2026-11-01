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
        <div id="entry-chain" class="chain" aria-label="Цепочка введённых ходов"></div>
        <section id="entry-move-panel">
          <div class="entry-tools"><label for="entry-actor">Ходит</label><select id="entry-actor"></select><button id="entry-undo" type="button" class="button secondary">Отменить последний ход</button></div>
          <p class="muted">Подсказки совместимы с известными ходами и пасами. Полная проверка рук и допустимости пасов выполняется после ввода остатков.</p>
          <div id="entry-suggestions" class="entry-suggestions" aria-label="Подсказки ходов"></div>
        </section>
        <section id="entry-remainders" hidden>
          <h3>Остатки на руках</h3><p>Выберите участника и назначьте ему оставшиеся камни. Нужны все камни, не выложенные на стол.</p>
          <div id="entry-owners" class="entry-owners"></div><div id="entry-remaining-tiles" class="entry-suggestions"></div>
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
  close(){document.body.classList.remove('entry-active');this.root.hidden=true;}
  error(message){$('entry-error').hidden=!message;$('entry-error').textContent=message;}
  change(operation,active=true){try{this.entry=operation();this.dirty=true;this.view=active&&this.entry.active?'active':this.entry.document.rounds.length;this.render();}catch(e){this.error(e.message);}}
  render(){
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
    $('entry-suggestions').replaceChildren(...choices.map(m=>{const b=node('button','button secondary entry-choice');b.type='button';b.setAttribute('aria-label',`${player}: ${actionLabel(m)}`);if(m.stone)b.append(this.tile(m.stone,'chain'));b.append(node('span','',actionLabel(m)));b.onclick=()=>this.change(()=>appendEntryMove(this.entry,m));return b;}));
  }
  renderRemainders(p){
    const remaining=this.entry.active.remaining;
    if(!p.capacities[this.owner])this.owner=p.capacities.findIndex(c=>c>0);
    $('entry-owners').replaceChildren(...p.players.map((a,i)=>{
      const card=node('div','entry-owner'),button=node('button','button secondary',`${a.name} · ${remaining[i].length} / ${p.capacities[i]}`);button.type='button';button.disabled=!p.capacities[i];button.setAttribute('aria-pressed',String(i===this.owner));button.onclick=()=>{this.owner=i;this.renderRemainders(p);};
      const hand=node('div','hand-stones');hand.append(...remaining[i].map(s=>this.tile(s,'hand')));card.append(button,hand);return card;
    }));
    const available=STONES.map(pair=>pair.join('-')).filter(s=>!(p.played&(1<<stoneId(s))));
    $('entry-remaining-tiles').replaceChildren(...available.map(s=>{
      const owner=remaining.findIndex(h=>h.includes(s)),b=node('button','button secondary entry-choice');b.type='button';b.dataset.owner=String(owner);b.setAttribute('aria-label',`${s.replace('-','–')}${owner>=0?' — '+p.players[owner].name:' — назначить '+p.players[this.owner].name}`);b.setAttribute('aria-pressed',String(owner>=0));b.append(this.tile(s,'chain'));b.append(node('span','',owner>=0?p.players[owner].name:'Назначить'));
      b.onclick=()=>{const next=remaining.map(h=>h.filter(t=>t!==s));if(owner!==this.owner)next[this.owner].push(s);this.change(()=>setRemainders(this.entry,next));};return b;
    }));
    const assigned=remaining.reduce((n,h)=>n+h.length,0);$('entry-remaining-count').textContent=`Распределено ${assigned} из ${available.length}. Выбран участник: ${p.players[this.owner].name}.`;
    $('entry-confirm').disabled=remaining.some((h,i)=>h.length!==p.capacities[i]);
    $('entry-assign-rest').disabled=p.capacities[this.owner]-remaining[this.owner].length!==available.length-assigned||assigned===available.length;
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
