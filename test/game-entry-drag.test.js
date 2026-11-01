import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from './helpers/fixtures.js';
import { GameEntry } from '../public/game-entry.js';
import { createEntry, appendEntryMove, entryPosition, undoEntryMove, setRemainders, confirmEntryRound, nextEntryRound } from '../shared/game-entry.js';
import { stoneId } from '../shared/game.js';

const {rounds,...header}=JSON.parse(readFileSync(new URL('../contracts/kozel-game.example.json',import.meta.url),'utf8'));
const names=header.teams.flatMap(t=>t.players).sort((a,b)=>a.seat-b.seat).map(p=>p.name);

// Small DOM surface: run the actual renderer and delegated browser event handlers.
function form(){
  const ids=new Map();
  class Element {
    constructor(){this.children=[];this.dataset={};this.attributes={};this.listeners={};this.className='';this.value='';}
    set innerHTML(html){for(const [,id] of html.matchAll(/id="([^"]+)"/g))ids.set(id,new Element());}
    set textContent(value){this.text=value;}
    get textContent(){return (this.text??'')+this.children.map(c=>c.textContent).join('');}
    append(...children){for(const c of children){c.parent=this;this.children.push(c);}}
    replaceChildren(...children){this.children=[];this.append(...children);}
    setAttribute(k,v){this.attributes[k]=v;}
    addEventListener(k,v){this.listeners[k]=v;}
    getBoundingClientRect(){return this.rect??{left:200,right:1000,width:800};}
    get classList(){return {add:c=>{this.className+=' '+c;},remove:c=>{this.className=this.className.split(' ').filter(x=>x!==c).join(' ');},toggle:(c,on)=>on?this.classList.add(c):this.classList.remove(c)};}
    matches(s){return s==='[data-entry-stone]'?'entryStone' in this.dataset:s==='[data-entry-drop]'?'entryDrop' in this.dataset:s.startsWith('.')&&this.className.split(' ').includes(s.slice(1));}
    closest(s){return this.matches(s)?this:this.parent?.closest(s);}
    contains(n){return n===this||this.children.some(c=>c.contains(n));}
    querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);}
  }
  const root=new Element();
  globalThis.document={getElementById:id=>ids.get(id),createElement:()=>new Element()};
  const editor=new GameEntry({root,tile:()=>new Element()});
  ids.get('entry-board').append(ids.get('entry-chain'));
  editor.entry=createEntry(header);editor.render();
  // Static template nodes belong to root for delegated events and queries.
  root.append(...[...ids.values()].filter(n=>!n.parent));
  const all=s=>root.querySelectorAll(s),stone=s=>all('[data-entry-stone]').find(n=>n.dataset.entryStone===s),zone=s=>all('[data-entry-drop]').find(n=>n.dataset.entryDrop===s);
  const event=(type,target,options={})=>{let prevented=false;root.listeners[type]?.({target,clientX:600,...options,preventDefault(){prevented=true;},dataTransfer:{setData(){},effectAllowed:'',dropEffect:''}});return prevented;};
  const drop=(s,to)=>{assert.ok(stone(s),`нет камня ${s}`);event('dragstart',stone(s));const board=['start','left','right'].includes(to),target=zone(board?'board':to),options={clientX:to==='left'?300:900};assert.ok(target,`нет зоны ${to}`);event('dragover',target,options);event('drop',target,options);};
  return {editor,ids,stone,zone,event,drop,all};
}

test('перенос записывает заход и выбранный край, автоматически поворачивая камень',()=>{
  for(const [side,oriented] of [['left','5-1'],['right','1-5']]){
    const f=form();assert.equal(f.all('[data-entry-stone]').length,28);
    f.drop('1-1','start');assert.equal(f.editor.entry.active.moves.length,1);assert.equal(f.stone('1-1'),undefined);
    f.drop('1-5',side);assert.deepEqual(f.editor.entry.active.moves.at(-1),{player:names[1],action:side,stone:oriented});
    f.editor.change(()=>undoEntryMove(f.editor.entry));assert.ok(f.stone('1-5'));assert.equal(f.all('[data-entry-stone]').length,27);
  }
});

test('ошибка, отмена и посторонний drop сохраняют форму; подсветка очищается',()=>{
  const f=form(),before=f.editor.entry;
  assert.equal(f.event('dragstart',f.stone('2-2')),true);assert.equal(f.editor.entry,before);assert.equal(f.editor.drag,null);
  f.event('dragstart',f.stone('1-1'));assert.match(f.zone('board').className,/entry-drop-allowed/);
  f.event('dragend',f.stone('1-1'));assert.doesNotMatch(f.zone('board').className,/entry-drop-allowed/);
  f.event('drop',f.zone('board'));assert.equal(f.editor.entry,before);
  f.event('dragstart',f.stone('1-1'));f.event('drop',f.ids.get('entry-title'));assert.equal(f.editor.entry,before);
  f.drop('1-1','start');const opened=f.editor.entry;f.drop('2-2','left');assert.equal(f.editor.entry,opened);
});

test('остатки переносятся без дублей, возвращаются в набор и подтверждают исходный раунд',()=>{
  const f=form();for(const m of rounds[0].moves)f.editor.entry=appendEntryMove(f.editor.entry,m);f.editor.render();
  const initial=f.editor.entry,p=entryPosition(initial),hands=names.map(name=>rounds[0].deal[name].filter(s=>!rounds[0].moves.some(m=>m.stone&&stoneId(m.stone)===stoneId(s))));
  const allCount=()=>f.all('[data-entry-stone]').length;
  const count=allCount();assert.equal(count,28-p.chain.length);
  for(const tile of f.all('[data-entry-stone]')){assert.equal(tile.draggable,true);assert.ok(!tile.disabled);}
  const s=hands.find(h=>h.length)[0],owner=hands.findIndex(h=>h.includes(s));
  f.drop(s,String(owner));assert.ok(f.editor.entry.active.remaining[owner].includes(s));assert.equal(allCount(),count);
  const receiver=owner===0?1:0;f.drop(s,String(receiver));assert.ok(f.editor.entry.active.remaining[receiver].includes(s));assert.equal(f.editor.entry.active.remaining[owner].length,0);assert.equal(allCount(),count);
  f.drop(s,'pool');assert.deepEqual(f.editor.entry.active.remaining,[[],[],[],[]]);
  const played=initial.active.moves.length;
  for(let i=0;i<4;i++)for(const tile of hands[i])f.drop(tile,String(i));
  assert.equal(f.editor.entry.active.moves.length,played);assert.equal(f.ids.get('entry-confirm').disabled,false);
  // A full hand cannot receive another player's tile, and failure keeps its owner.
  const first=hands.findIndex(h=>h.length),other=hands.findIndex((h,i)=>h.length&&i!==first),snapshot=f.editor.entry;
  f.drop(hands[other][0],String(first));assert.equal(f.editor.entry,snapshot);
  f.ids.get('entry-confirm').listeners.click();assert.deepEqual(f.editor.entry.document.rounds[0],rounds[0]);
  assert.equal(f.all('[data-entry-stone]').length,0);assert.equal(f.all('[data-entry-drop]').length,0);
});

test('перенос остатка вопреки пасу сохраняет данные; отмена возобновляет ввод ходов',()=>{
  const f=form();
  for(const m of rounds[0].moves)f.editor.entry=appendEntryMove(f.editor.entry,m);
  const hands=names.map(name=>rounds[0].deal[name].filter(s=>!rounds[0].moves.some(m=>m.stone&&stoneId(m.stone)===stoneId(s))));
  f.editor.entry=nextEntryRound(confirmEntryRound(setRemainders(f.editor.entry,hands)));
  for(const m of rounds[1].moves)f.editor.entry=appendEntryMove(f.editor.entry,m);
  f.editor.render();const snapshot=f.editor.entry;
  f.drop('0-0','0');assert.equal(f.editor.entry,snapshot);assert.match(f.ids.get('entry-error').textContent,/пас/);
  f.ids.get('entry-undo').listeners.click();assert.equal(entryPosition(f.editor.entry).terminal,false);
  assert.equal(f.zone('pool'),undefined);assert.ok(f.zone('board'));assert.equal(f.zone('left'),undefined);assert.equal(f.zone('right'),undefined);
  const before=f.editor.entry;f.event('dragstart',f.stone('0-0'));f.editor.render();f.event('drop',f.zone('board'));assert.equal(f.editor.entry,before);
});

test('общее поле выбирает сторону по актуальной геометрии, включая середину и вложенные камни',()=>{
  for(const [x,side,stone] of [[499,'left','5-1'],[500,'right','1-5'],[501,'right','1-5']]){
    const f=form();f.drop('1-1','start');const board=f.zone('board');assert.ok(board);assert.equal(f.all('[data-entry-drop]').length,1);
    board.rect={left:400,right:600,width:200};const nested=f.ids.get('entry-chain').children[0];
    f.event('dragstart',f.stone('1-5'));
    f.event('dragover',nested,{clientX:401});assert.equal(board.dataset.entrySide,'left');
    f.event('dragover',nested,{clientX:599});assert.equal(board.dataset.entrySide,'right');
    f.event('dragleave',nested,{relatedTarget:board});assert.equal(board.dataset.entrySide,'right');
    f.event('dragleave',board,{relatedTarget:f.ids.get('entry-title')});assert.equal(board.dataset.entrySide,undefined);
    f.event('drop',nested,{clientX:x});assert.deepEqual(f.editor.entry.active.moves.at(-1),{player:names[1],action:side,stone});assert.equal(board.dataset.entrySide,undefined);
  }
});

test('единственный допустимый край выбирается автоматически независимо от половины поля',()=>{
  for(const [stone,side,oriented] of [['1-5','right','1-5'],['0-6','left','6-0']]){
    for(const x of [300,600,900]){
      const f=form();f.drop('1-1','start');f.drop('0-1','left');const count=f.editor.entry.active.moves.length,board=f.zone('board');
      f.event('dragstart',f.stone(stone));f.event('dragover',board,{clientX:x});
      assert.equal(board.dataset.entrySide,side);assert.match(board.className,/entry-drop-allowed/);assert.doesNotMatch(board.dataset.entryPreview,/не подходит/);
      f.event('drop',board,{clientX:x});assert.equal(f.editor.entry.active.moves.length,count+1);
      assert.deepEqual(f.editor.entry.active.moves.at(-1),{player:names[2],action:side,stone:oriented});assert.equal(f.ids.get('entry-error').hidden,true);
      f.ids.get('entry-undo').listeners.click();assert.equal(f.editor.entry.active.moves.length,count);assert.equal(f.stone(stone).disabled,false);
    }
  }
});

test('неподходящие камни неактивны; доступность меняется после хода, паса и отмены',()=>{
  const f=form();
  const enabled=s=>{assert.equal(f.stone(s).disabled,false,s);assert.equal(f.stone(s).draggable,true,s);};
  const disabled=s=>{assert.equal(f.stone(s).disabled,true,s);assert.equal(f.stone(s).draggable,false,s);assert.equal(f.event('dragstart',f.stone(s)),true);assert.equal(f.editor.drag,null);};
  enabled('1-1');disabled('2-6');assert.equal(f.all('[data-entry-stone]').length,28);
  f.ids.get('entry-actor').value='1';f.ids.get('entry-actor').listeners.change();enabled('1-1');disabled('0-0');
  f.drop('1-1','start');f.drop('0-1','left');enabled('0-6');enabled('1-6');disabled('2-6');disabled('2-5');
  assert.equal(f.ids.get('entry-play-tiles').children[0],f.ids.get('entry-pass'));
  f.ids.get('entry-pass').listeners.click();assert.equal(f.editor.entry.active.moves.at(-1).action,'pass');enabled('1-6');disabled('2-6');
  f.ids.get('entry-undo').listeners.click();
  f.drop('1-5','right');enabled('2-5');disabled('1-6');
  f.ids.get('entry-undo').listeners.click();disabled('2-5');enabled('1-6');
});
