import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import type { RoomView, Player } from '../game/types';
import { createPartyServer } from '../server/party-server';

type Message={type:string;room:RoomView;playerId:string;token:string;role:string;message:string};
function client(port:number){
  const socket=new WebSocket(`ws://127.0.0.1:${port}/party`),queue:Message[]=[],waiters:{predicate:(m:Message)=>boolean;resolve:(m:Message)=>void}[]=[];
  socket.on('message',raw=>{const m=JSON.parse((raw as Buffer).toString()) as Message;const i=waiters.findIndex(w=>w.predicate(m));if(i>=0)waiters.splice(i,1)[0].resolve(m);else queue.push(m);});
  return {
    socket,opened:new Promise<void>(resolve=>socket.once('open',()=>resolve())),
    drain:()=>{queue.length=0;},
    send:(m:unknown)=>socket.send(JSON.stringify(m)),
    wait:(predicate:(m:Message)=>boolean)=>new Promise<Message>((resolve,reject)=>{
      const index=queue.findIndex(predicate);if(index>=0){resolve(queue.splice(index,1)[0]);return;}
      const timer=setTimeout(()=>{const i=waiters.findIndex(w=>w.resolve===done);if(i>=0)waiters.splice(i,1);reject(Error(`Timed out waiting for server message: ${String(predicate)}`));},2500);
      const done=(m:Message)=>{clearTimeout(timer);resolve(m);};waiters.push({predicate,resolve:done});
    }),
  };
}
void test('real sockets: QR room flow, host authority, readiness, input bounds, reconnect, rematch',async()=>{
  const server=createPartyServer({port:0,host:'127.0.0.1'}),port=await server.listen();
  try{
    const host=client(port);await host.opened;host.send({type:'create',name:'Host',driver:0});
    const h=await host.wait(m=>m.type==='welcome'),code=h.room.code;
    assert.match(code,/^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(h.room.speedClass,100);
    const guest=client(port);await guest.opened;guest.send({type:'join',code,name:'Guest',driver:1});
    const g=await guest.wait(m=>m.type==='welcome');assert.equal(g.role,'player');
    guest.send({type:'start'});assert.match((await guest.wait(m=>m.type==='error')).message,/host/);
    host.send({type:'start'});assert.match((await host.wait(m=>m.type==='error')).message,/ready/);
    guest.send({type:'settings',speedClass:150});assert.match((await guest.wait(m=>m.type==='error')).message,/host/);
    host.send({type:'settings',track:'midnight',laps:1,speedClass:150});
    await host.wait(m=>m.type==='room'&&m.room.speedClass===150);
    host.drain();host.send({type:'settings',speedClass:'50'});await host.wait(m=>m.type==='room');assert.equal(server.rooms.get(code)!.view.speedClass,150);
    guest.send({type:'ready',ready:true});
    await host.wait(m=>m.type==='room'&&m.room.players.length===2&&m.room.players.every((p:Player)=>p.ready));
    host.send({type:'start'});const started=await host.wait(m=>m.type==='room'&&m.room.race?.phase==='countdown');
    assert.ok(started.room.race);assert.equal(started.room.race.track,'midnight');assert.equal(started.room.race.racers.length,8);
    assert.equal(started.room.race.speedClass,150);
    guest.send({type:'input',seq:1,input:{steer:900,throttle:true}});
    await new Promise(resolve=>setTimeout(resolve,50));
    const room=server.rooms.get(code)!;assert.equal(room.seats.get(g.playerId)!.input.steer,1);
    host.send({type:'settings',speedClass:50});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(room.view.speedClass,150);assert.equal(room.view.race!.speedClass,150);
    guest.send({type:'input',seq:0,input:{steer:-1}});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(room.seats.get(g.playerId)!.input.steer,1);
    guest.socket.close();await new Promise(resolve=>guest.socket.once('close',resolve));
    await host.wait(m=>m.type==='room'&&m.room.players.some((p:Player)=>p.id===g.playerId&&!p.connected));
    assert.equal(room.seats.get(g.playerId)!.player.connected,false);
    const rejoined=client(port);await rejoined.opened;rejoined.send({type:'rejoin',code,token:g.token});
    const back=await rejoined.wait(m=>m.type==='welcome');assert.equal(back.playerId,g.playerId);assert.equal(room.seats.size,2);
    assert.equal(back.room.speedClass,150);assert.equal(back.room.race!.speedClass,150);
    const attacker=client(port);await attacker.opened;attacker.send({type:'rejoin',code,token:'invalid'});assert.match((await attacker.wait(m=>m.type==='error')).message,/expired/);
    room.view.race!.phase='results';const oldRace=room.view.race;host.send({type:'rematch'});
    await new Promise(resolve=>setTimeout(resolve,40));assert.notEqual(room.view.race,oldRace);assert.equal(room.view.race!.phase,'countdown');
    assert.equal(room.view.race!.speedClass,150);
    host.send({type:'lobby'});await new Promise(resolve=>setTimeout(resolve,40));assert.equal(room.view.race,null);
    host.send({type:'settings',speedClass:50});await host.wait(m=>m.type==='room'&&m.room.speedClass===50);assert.equal(room.view.speedClass,50);
    host.send({type:'leave'});await rejoined.wait(m=>m.type==='closed');assert.equal(server.rooms.size,0);
  } finally {await server.close();}
});
void test('rooms cap humans at ten and reject malformed join payloads',async()=>{
  const server=createPartyServer({port:0,host:'127.0.0.1'}),port=await server.listen();
  try{
    const host=client(port);await host.opened;host.send({type:'create'});const {room}=await host.wait(m=>m.type==='welcome');
    for(let i=0;i<9;i++){const c=client(port);await c.opened;c.send({type:'join',code:room.code,name:`P${i}`});await c.wait(m=>m.type==='welcome');}
    const extra=client(port);await extra.opened;extra.send({type:'join',code:room.code});assert.match((await extra.wait(m=>m.type==='error')).message,/10/);
    extra.socket.send('null');assert.match((await extra.wait(m=>m.type==='error')).message,/Invalid/);
  }finally{await server.close();}
});
void test('host can remove stale seats, displays need no seat, and tap edges survive a tick',async()=>{
  const server=createPartyServer({port:0,host:'127.0.0.1'}),port=await server.listen();
  try{
    const host=client(port);await host.opened;host.send({type:'create'});const welcome=await host.wait(m=>m.type==='welcome'),code=welcome.room.code;
    const guest=client(port);await guest.opened;guest.send({type:'join',code});const g=await guest.wait(m=>m.type==='welcome');
    const display=client(port);await display.opened;display.send({type:'join',code,display:true});const d=await display.wait(m=>m.type==='welcome');assert.equal(d.role,'display');assert.equal(d.playerId,'');
    const room=server.rooms.get(code)!;assert.equal(room.seats.size,2);
    guest.socket.close();await host.wait(m=>m.type==='room'&&m.room.players.some((p:Player)=>p.id===g.playerId&&!p.connected));
    host.drain();host.send({type:'kick',id:g.playerId});await host.wait(m=>m.type==='room'&&m.room.players.length===1);assert.equal(room.seats.size,1);
    host.send({type:'start'});await host.wait(m=>m.type==='room'&&!!m.room.race);room.view.race!.phase='racing';const racer=room.view.race!.racers[0];racer.item='boost';
    host.send({type:'input',seq:1,input:{use:true}});host.send({type:'input',seq:2,input:{use:false}});
    await new Promise(resolve=>setTimeout(resolve,60));assert.equal(racer.item,null);assert.ok(racer.boost>0);
  }finally{await server.close();}
});
void test('a non-playing host leaves all ten racer slots for phones and recovers host authority',async()=>{
 const server=createPartyServer({port:0,host:'127.0.0.1'}),port=await server.listen();
 try{
  const host=client(port);await host.opened;host.send({type:'create',name:'TV',play:false});const welcome=await host.wait(m=>m.type==='welcome'),code=welcome.room.code;
  assert.equal(welcome.room.hostPlays,false);assert.equal(welcome.room.players.length,0);
  host.send({type:'start'});assert.match((await host.wait(m=>m.type==='error')).message,/racer/);
  const phones:string[]=[],controllers:ReturnType<typeof client>[]=[],tokens:string[]=[];
  for(let i=0;i<10;i++){const phone=client(port);await phone.opened;phone.send({type:'join',code,name:`Phone${i}`});const joined=await phone.wait(m=>m.type==='welcome');phones.push(joined.playerId);controllers.push(phone);tokens.push(joined.token);phone.send({type:'ready',ready:true});}
  await host.wait(m=>m.type==='room'&&m.room.players.length===10&&m.room.players.every(p=>p.ready));
  host.send({type:'settings',speedClass:200});await host.wait(m=>m.type==='room'&&m.room.speedClass===200);host.send({type:'start'});
  const started=await host.wait(m=>m.type==='room'&&!!m.room.race);assert.deepEqual(started.room.race!.racers.filter(r=>!r.bot).map(r=>r.id),phones);assert.equal(started.room.race!.speedClass,200);
  assert.equal(started.room.race!.racers.length,10);assert.equal(new Set(started.room.race!.racers.map(r=>r.driver)).size,10);
  const active=server.rooms.get(code)!;
  host.send({type:'race-ready',startId:active.view.race!.startId});
  for(const phone of controllers.slice(0,9))phone.send({type:'race-ready',startId:active.view.race!.startId});
  await new Promise(resolve=>setTimeout(resolve,40));assert.equal(active.view.race!.startAt,null,'wait for the tenth controller');
  controllers[9].send({type:'race-ready',startId:active.view.race!.startId});
  await host.wait(m=>m.type==='room'&&m.room.race?.startAt!=null);
  controllers[9].send({type:'input',seq:1,input:{steer:-.75,throttle:true}});
  await new Promise(resolve=>setTimeout(resolve,40));assert.equal(active.seats.get(phones[9])!.input.steer,-.75);assert.equal(active.seats.get(phones[0])!.input.steer,0);
  const replacement=client(port);await replacement.opened;replacement.send({type:'rejoin',code,token:tokens[9]});const restored=await replacement.wait(m=>m.type==='welcome');assert.equal(restored.playerId,phones[9]);assert.equal(restored.room.players.length,10);assert.equal(restored.room.players.find(p=>p.id===phones[9])!.driver,9);
  host.socket.close();await new Promise(resolve=>host.socket.once('close',resolve));
  const back=client(port);await back.opened;back.send({type:'rejoin',code,token:welcome.token});const recovered=await back.wait(m=>m.type==='welcome');assert.equal(recovered.role,'host');assert.equal(recovered.room.hostPlays,false);assert.equal(recovered.room.players.length,10);
  back.send({type:'lobby'});await back.wait(m=>m.type==='room'&&m.room.race===null);
 }finally{await server.close();}
});

void test('a watching host cannot rematch after the last phone disconnects',async()=>{
 const server=createPartyServer({port:0,host:'127.0.0.1'}),port=await server.listen();
 try{
  const host=client(port);await host.opened;host.send({type:'create',play:false});const {room}=await host.wait(m=>m.type==='welcome');
  const phone=client(port);await phone.opened;phone.send({type:'join',code:room.code});await phone.wait(m=>m.type==='welcome');phone.send({type:'ready',ready:true});
  await host.wait(m=>m.type==='room'&&m.room.players.length===1&&m.room.players[0].ready);host.send({type:'start'});await host.wait(m=>m.type==='room'&&!!m.room.race);
  const race=server.rooms.get(room.code)!.view.race!;race.phase='results';phone.socket.close();
  await host.wait(m=>m.type==='room'&&m.room.players.length===1&&m.room.players.every(p=>!p.connected));host.send({type:'rematch'});
  assert.match((await host.wait(m=>m.type==='error')).message,/connect/);assert.equal(server.rooms.get(room.code)!.view.race,race);assert.equal(race.phase,'results');
  host.send({type:'lobby'});await host.wait(m=>m.type==='room'&&!m.room.race&&m.room.players.length===0);
  const fresh=client(port);await fresh.opened;fresh.send({type:'join',code:room.code});await fresh.wait(m=>m.type==='welcome');await fresh.wait(m=>m.type==='room'&&m.room.players.length===1);
 }finally{await server.close();}
});

void test('room joins and profile updates keep human drivers distinct without using the watching host choice',async()=>{
 const server=createPartyServer({port:0,host:'127.0.0.1'}),port=await server.listen();
 try{
  const host=client(port);await host.opened;host.send({type:'create',play:false,driver:0});const {room}=await host.wait(m=>m.type==='welcome');
  const a=client(port),b=client(port);await Promise.all([a.opened,b.opened]);a.send({type:'join',code:room.code,driver:0});const first=await a.wait(m=>m.type==='welcome');assert.equal(first.room.players[0].driver,0);
  b.send({type:'join',code:room.code,driver:0});const second=await b.wait(m=>m.type==='welcome');assert.equal(second.room.players.find(p=>p.id===second.playerId)!.driver,1);
  b.send({type:'profile',name:'B',driver:0});assert.match((await b.wait(m=>m.type==='error')).message,/taken/);assert.equal(server.rooms.get(room.code)!.seats.get(second.playerId)!.player.driver,1);
  b.send({type:'profile',name:'B',driver:5});await b.wait(m=>m.type==='room'&&m.room.players.some(p=>p.id===second.playerId&&p.driver===5));
 }finally{await server.close();}
});
