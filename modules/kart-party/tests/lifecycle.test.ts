import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { GameClient } from '../game/client-types';
import { humanInput } from '../game/input';
import * as simulation from '../game/simulation';
import { NEUTRAL, type RoomView } from '../game/types';

// Run the real socket callbacks with deterministic hook state and browser events.
// No DOM renderer or network is needed to inspect reconnect policy and outgoing packets.
const source=ts.transpileModule(readFileSync(new URL('../game/useGame.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const requireGame=createRequire(new URL('../game/useGame.ts',import.meta.url));
function harness(role:'player'|'display',recover=true,renderCanvas=false) {
  const saved={code:'ABCDEF',token:role==='display'?'':'token',role},storage=new Map(recover?[['kart-party-seat',JSON.stringify(saved)]]:[]);
  const timers=new Map<number,{at:number;delay:number;callback:()=>void}>(),sockets:Socket[]=[],slots:unknown[]=[],effects:(()=>void)[]=[],events=new Map<string,()=>void>(),cleanups=new Map<number,()=>void>();
  let cursor=0,timerId=0,now=0,frame:((time:number)=>void)|undefined;
  class Socket {
    static OPEN=1;readyState=0;bufferedAmount=0;stallClose=false;sent:Record<string,unknown>[]=[];
    onopen?:()=>void;onmessage?:(event:{data:string})=>void;onclose?:(event:{code:number})=>void;
    constructor(){sockets.push(this);}
    send(value:string){this.sent.push(JSON.parse(value) as Record<string,unknown>);}
    open(){this.readyState=1;this.onopen?.();}
    message(value:unknown){this.onmessage?.({data:JSON.stringify(value)});}
    close(code=1000){if(this.stallClose){this.readyState=2;return;}this.readyState=3;this.onclose?.({code});}
  }
  const hooks={
    useState(initial:unknown){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],(value:unknown)=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
    useRef(initial:unknown){const index=cursor++;return slots[index]??(slots[index]={current:index===0&&renderCanvas?{}:initial});},
    useCallback(callback:unknown){cursor++;return callback;},
    useEffect(effect:()=>void|(()=>void),deps:unknown[]){const index=cursor++,previous=slots[index] as unknown[]|undefined;if(!previous||deps.some((value,i)=>value!==previous[i]))effects.push(()=>{cleanups.get(index)?.();const cleanup=effect();if(cleanup)cleanups.set(index,cleanup);else cleanups.delete(index);});slots[index]=deps;},
  };
  let rendererCreates=0;
  const modules:Record<string,unknown>={react:hooks,'./renderer':{createRenderer:()=>{rendererCreates++;return {render(){return true;},dispose(){}}}},'./simulation':simulation,'./input':{humanInput},'./types':{NEUTRAL},'./usePartyAddress':{usePartyAddress:()=>({origins:[]})},'./audio':{GameAudio:class {start(){}update(){}dispose(){}}}};
  const exported:{useGame?:()=>GameClient}={};
  runInNewContext(source,{
    exports:exported,require:(name:string)=>name in modules?modules[name]:requireGame(name),
    WebSocket:Socket,URLSearchParams,history:{replaceState(){}},location:{search:'',protocol:'http:',host:'localhost:4317',pathname:'/'},matchMedia:()=>({matches:false}),
    sessionStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},
    localStorage:{getItem:()=>null,setItem(){}},window:{addEventListener:(name:string,callback:()=>void)=>events.set(name,callback),removeEventListener:(name:string)=>events.delete(name)},document:{hidden:false,addEventListener(){},removeEventListener(){}},
    performance:{now:()=>now},requestAnimationFrame:(callback:(time:number)=>void)=>{frame=callback;return 1;},cancelAnimationFrame(){},
    setTimeout:(callback:()=>void,delay:number)=>{timers.set(++timerId,{at:now+delay,delay,callback});return timerId;},clearTimeout:(id:number)=>timers.delete(id),
  });
  const render=()=>{cursor=0;const game=exported.useGame!();while(effects.length)effects.shift()!();return game;};render();
  const room:RoomView={code:'ABCDEF',host:'host',players:[],track:'coast',laps:3,speedClass:100,difficulty:'normal',race:simulation.createRace({track:'coast',players:[{id:'seat',name:'Racer',driver:0}]})};
  const welcome=(socket:Socket)=>{socket.open();socket.message({type:'welcome',playerId:role==='display'?'':'seat',token:saved.token,role,room});render();};
  const advance=(ms:number)=>{
    const end=now+ms;
    for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].callback();}
    now=end;
  };
  const timerCounts=()=>({pump:[...timers.values()].filter(t=>Math.abs(t.delay-1000/30)<.01).length,watchdog:[...timers.values()].filter(t=>t.delay===10000).length,retry:[...timers.values()].filter(t=>t.delay===1500).length});
  return {rendererCreates:()=>rendererCreates,timerCounts,sockets,timers,storage,render,welcome,room,advance,unmount:()=>{for(const cleanup of cleanups.values())cleanup();cleanups.clear();},frame:(time:number)=>frame!(time),blur:()=>events.get('blur')!(),retry:()=>advance(1500)};
}
void test('a superseded seat stops reconnecting instead of fighting its replacement tab',()=>{
  const h=harness('player');h.welcome(h.sockets[0]);h.sockets[0].close(4001);
  assert.equal(h.timers.size,0,'the server deliberately transferred this seat; retrying evicts the new tab');
  assert.equal(h.storage.has('kart-party-seat'),false);
});
void test('a recovered display clears an expired room rather than retrying it forever',()=>{
  const h=harness('display');h.welcome(h.sockets[0]);h.sockets[0].close(1006);h.retry();
  const socket=h.sockets[1];socket.open();socket.message({type:'error',message:'Room not found. Check the code and try again.'});
  const game=h.render();
  assert.equal(h.storage.has('kart-party-seat'),false,'an expired display room cannot recover through another join');
  assert.equal(game.race,null);assert.equal(game.room,null);assert.equal(h.timers.size,0);
});
void test('a display receives race state without sending player input every frame',()=>{
  const h=harness('display');h.welcome(h.sockets[0]);h.frame(50);
  assert.equal(h.sockets[0].sent.filter(message=>message.type==='input').length,0);
});
void test('losing focus during a solo countdown pauses before racing begins',()=>{
  const h=harness('player');h.render().solo();assert.equal(h.render().race?.phase,'countdown');
  h.blur();assert.equal(h.render().paused,true);
});

void test('an OPEN silent socket recovers the saved seat without waiting for TCP close',()=>{
  const h=harness('player'),old=h.sockets[0];h.welcome(old);old.stallClose=true;
  h.advance(9999);assert.equal(h.render().connected,true);
  h.advance(1);assert.equal(old.readyState,2);assert.equal(h.render().connected,false);assert.equal(h.timers.size,1);
  h.advance(1500);assert.equal(h.sockets.length,2);
  const current=h.sockets[1];current.open();
  assert.deepEqual(current.sent[0],{type:'rejoin',code:'ABCDEF',token:'token'});
  old.onclose?.({code:1006});assert.equal(h.timers.size,1,'a delayed close cannot add a competing retry');
  h.advance(5000);old.message({type:'welcome',playerId:'obsolete',token:'old-token',role:'player',room:h.room});
  h.advance(5000);assert.equal(h.render().connected,false,'an obsolete welcome cannot extend the new handshake deadline');
  assert.equal(JSON.parse(h.storage.get('kart-party-seat')!).token,'token');
  h.advance(1500);assert.equal(h.sockets.length,3,'each failed attempt has one bounded retry');
});
for(const open of [false,true])void test(`a saved connection times out before welcome with socket ${open?'OPEN':'CONNECTING'}`,()=>{
  const h=harness('player');if(open)h.sockets[0].open();
  h.advance(10000);assert.equal(h.render().connected,false);assert.equal(h.render().busy,false);
  h.advance(1500);assert.equal(h.sockets.length,2);h.sockets[1].open();
  assert.deepEqual(h.sockets[1].sent[0],{type:'rejoin',code:'ABCDEF',token:'token'});
});
void test('a fresh stalled join shows an error without blindly creating another seat',()=>{
  const h=harness('player',false);h.render().join();h.sockets[0].open();h.advance(10000);
  assert.equal(h.render().connected,false);assert.equal(h.render().busy,false);assert.match(h.render().error,/stopped responding/);
  assert.equal(h.timers.size,0);h.advance(60000);assert.equal(h.sockets.length,1);
});
void test('ordinary room traffic keeps a healthy connection alive',()=>{
  const h=harness('player');h.welcome(h.sockets[0]);
  for(let i=0;i<6;i++){h.advance(9000);h.sockets[0].message({type:'room',room:h.room});}
  assert.equal(h.sockets.length,1);assert.equal(h.render().connected,true);assert.deepEqual(h.timerCounts(),{pump:1,watchdog:1,retry:0});assert.equal(h.timers.size,2);
  h.advance(10000);assert.equal(h.render().connected,false,'the deadline follows the last message');
});
for(const action of ['leave','unmount'] as const)for(const retrying of [false,true])void test(`${action} clears the ${retrying?'retry':'watchdog'} and ignores late socket events`,()=>{
  const h=harness('player'),socket=h.sockets[0];h.welcome(socket);if(retrying)socket.close(1006);
  if(action==='leave')h.render().leave();else h.unmount();
  assert.equal(h.timers.size,0);
  socket.message({type:'room',room:h.room});socket.onclose?.({code:1006});h.advance(60000);
  assert.equal(h.sockets.length,1);assert.equal(h.timers.size,0);
});
void test('a new connection replaces both a watchdog and a scheduled retry',()=>{
  const h=harness('player');h.welcome(h.sockets[0]);h.advance(9000);h.render().watch();
  assert.equal(h.timers.size,1);h.advance(1000);assert.equal(h.sockets.length,2);h.welcome(h.sockets[1]);
  h.sockets[1].close(1006);h.render().watch();h.advance(1500);
  assert.equal(h.sockets.length,3,'the old retry cannot open a fourth socket');assert.equal(h.timers.size,1);
});

void test('controller sends immediately after welcome and continues with no animation frames',()=>{
 const h=harness('player');h.welcome(h.sockets[0]);const socket=h.sockets[0];
 assert.ok(socket.sent.some(m=>m.type==='input'));const before=socket.sent.filter(m=>m.type==='input').length;
 h.advance(1000);const count=socket.sent.filter(m=>m.type==='input').length-before;
 assert.ok(count>=25&&count<=31,`input timer produced ${count} packets`);assert.deepEqual(h.timerCounts(),{pump:1,watchdog:1,retry:0});
});
void test('steering changes and duplicate item releases stay bounded while item taps remain latched',()=>{
 const h=harness('player');h.welcome(h.sockets[0]);const socket=h.sockets[0];
 for(let i=0;i<120;i++){h.advance(1000/120);h.render().input({steer:i%2?1:-1});}
 assert.ok(socket.sent.filter(m=>m.type==='input').length<=62);
 socket.sent=[];h.render().input({use:true});h.render().input({use:false});h.render().input({use:false});h.advance(34);
 assert.ok(socket.sent.some(m=>m.type==='input'&&(m.input as {use:boolean}).use));
 h.advance(34);assert.equal((socket.sent.at(-1)!.input as {use:boolean}).use,false);
});
void test('backpressure coalesces steering and preserves a short item tap until send resumes',()=>{
 const h=harness('player');h.welcome(h.sockets[0]);const socket=h.sockets[0];socket.sent=[];socket.bufferedAmount=100;
 h.render().input({steer:1,use:true});h.render().input({steer:-1,use:false});h.advance(500);assert.equal(socket.sent.length,0);
 socket.bufferedAmount=0;h.advance(34);const packet=socket.sent.find(m=>m.type==='input')!;assert.equal((packet.input as {steer:number}).steer,1);assert.equal((packet.input as {use:boolean}).use,true);
});
void test('controller readiness is sent once for each distinct start ID',()=>{
 const h=harness('player');h.room.race!.startId='race-a';h.room.race!.startAt=null;h.welcome(h.sockets[0]);
 for(let i=0;i<4;i++)h.sockets[0].message({type:'room',room:h.room});
 assert.equal(h.sockets[0].sent.filter(m=>m.type==='race-ready').length,1);
 h.room.race!.startId='race-b';h.sockets[0].message({type:'room',room:h.room});assert.equal(h.sockets[0].sent.filter(m=>m.type==='race-ready').length,2);
});
void test('clock sync uses an initial short burst then backs off while input continues',()=>{
 const h=harness('player');h.welcome(h.sockets[0]);h.advance(2000);const socket=h.sockets[0];assert.equal(socket.sent.filter(m=>m.type==='sync').length,8);
 h.advance(3000);assert.equal(socket.sent.filter(m=>m.type==='sync').length,8);h.advance(1100);assert.equal(socket.sent.filter(m=>m.type==='sync').length,9);
});
void test('a delayed room snapshot cannot move the corrected countdown back across a numeral boundary',()=>{
 const h=harness('player');h.welcome(h.sockets[0]);h.room.race!.startId='clock-race';h.room.race!.startAt=2100;h.room.race!.countdown=2.1;
 h.sockets[0].message({type:'room',room:h.room,serverTime:0});h.advance(200);const before=h.render().race!.countdown;assert.ok(before<2);
 h.sockets[0].message({type:'room',room:h.room,serverTime:0});assert.ok(h.render().race!.countdown<=before,'the receive callback restored a stale countdown before the next timer tick');
});

void test('failed saved-seat recovery still allows solo renderer creation',async()=>{
 const h=harness('player',true,true);h.sockets[0].open();h.sockets[0].message({type:'error',message:'Room not found.'});h.render();await Promise.resolve();await Promise.resolve();
 h.render().solo();h.render();await Promise.resolve();await Promise.resolve();
 assert.equal(h.render().mode,'solo');assert.ok(h.render().race);assert.equal(h.rendererCreates(),1);h.unmount();
});

void test('portrait input lock keeps the heartbeat neutral and discards held controls until rotation',()=>{
 const h=harness('player'),socket=h.sockets[0];h.welcome(socket);h.render().setControlsEnabled(false);socket.sent=[];
 h.render().input({steer:1,throttle:true,use:true});h.advance(1600);
 const packets=socket.sent.filter(m=>m.type==='input');assert.ok(packets.length>40);for(const packet of packets)assert.deepEqual(packet.input,NEUTRAL);
 h.render().setControlsEnabled(true);const latest=socket.sent.filter(m=>m.type==='input').at(-1)!.input as typeof NEUTRAL;assert.equal(latest.steer,0);assert.equal(latest.use,false);assert.equal(latest.throttle,true);h.unmount();
});
