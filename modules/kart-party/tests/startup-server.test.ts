import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartyServer} from '../server/party-server';
import WebSocket from 'ws';
import type {RoomView} from '../game/types';
type Message={type:string;room:RoomView;playerId:string;token:string;sent?:number;serverTime:number};
function client(port:number){
 const socket=new WebSocket(`ws://127.0.0.1:${port}/party`),messages:Message[]=[],listeners=new Set<()=>void>();socket.on('message',raw=>{messages.push(JSON.parse((raw as Buffer).toString()) as Message);for(const notify of listeners)notify();});
 return {socket,opened:new Promise(resolve=>socket.once('open',resolve)),send:(m:unknown)=>socket.send(JSON.stringify(m)),wait:(predicate:(m:Message)=>boolean)=>new Promise<Message>((resolve,reject)=>{const check=()=>{const index=messages.findIndex(predicate);if(index<0)return;clearTimeout(timer);listeners.delete(check);resolve(messages.splice(index,1)[0]);};const timer=setTimeout(()=>{listeners.delete(check);reject(Error('message timeout'))},2000);listeners.add(check);check();})};
}
async function setup(withDisplay=false){
 const server=createPartyServer({port:0,host:'127.0.0.1'}),port=await server.listen(),host=client(port);await host.opened;host.send({type:'create',play:false});const h=await host.wait(m=>m.type==='welcome');
 const phone=client(port);await phone.opened;phone.send({type:'join',code:h.room.code});const p=await phone.wait(m=>m.type==='welcome');phone.send({type:'ready',ready:true});await host.wait(m=>m.type==='room'&&m.room.players.some((r)=>r.ready));const display=withDisplay?client(port):null;if(display){await display.opened;display.send({type:'join',code:h.room.code,display:true});await display.wait(m=>m.type==='welcome');}host.send({type:'start'});const start=await host.wait(m=>m.type==='room'&&!!m.room.race?.startId);
 return {server,port,host,phone,display,h,p,start,room:server.rooms.get(h.room.code)!};
}
void test('start waits for both phone and host rendering then publishes one future deadline',async()=>{
 const h=await setup();try{
  const race=h.room.view.race!;assert.equal(race.startAt,null);assert.equal(h.room.preparing!.size,2);assert.ok(race.racers.find(r=>r.id===h.p.playerId)!.connected);
  h.phone.send({type:'race-ready',startId:'obsolete'});h.phone.send({type:'sync',sent:10});await h.phone.wait(m=>m.type==='sync');assert.equal(h.room.preparing!.size,2);
  h.phone.send({type:'race-ready',startId:race.startId});h.phone.send({type:'sync',sent:11});await h.phone.wait(m=>m.type==='sync'&&m.sent===11);assert.equal(h.room.preparing!.size,1);assert.equal(race.startAt,null);
  h.host.send({type:'race-ready',startId:race.startId});const ready=await h.host.wait(m=>m.type==='room'&&m.room.race?.startAt!=null);assert.ok(ready.room.race!.startAt!-Date.now()>3000);const deadline=race.startAt;
  h.phone.send({type:'race-ready',startId:race.startId});const next=await h.phone.wait(m=>m.type==='room'&&m.room.race?.startAt!=null);assert.equal(next.room.race!.startAt,deadline);
 }finally{await h.server.close();}
});
void test('preparation timeout is bounded and a sync reply carries its echoed request and server clock',async()=>{
 const h=await setup();try{
  const before=Date.now();h.phone.send({type:'sync',sent:12345});const sync=await h.phone.wait(m=>m.type==='sync');assert.equal(sync.sent,12345);assert.ok(sync.serverTime>=before&&sync.serverTime<=Date.now());
  h.room.prepareUntil=Date.now()-1;await h.host.wait(m=>m.type==='room'&&m.room.race?.startAt!=null);assert.equal(h.room.preparing,undefined);
 }finally{await h.server.close();}
});
void test('rejoining during preparation transfers the readiness requirement to the new socket',async()=>{
 const h=await setup();try{
  const replacement=client(h.port);await replacement.opened;replacement.send({type:'rejoin',code:h.h.room.code,token:h.p.token});await replacement.wait(m=>m.type==='welcome');
  h.host.send({type:'race-ready',startId:h.room.view.race!.startId});h.host.send({type:'sync',sent:99});await h.host.wait(m=>m.type==='sync'&&m.sent===99);
  // The replacement is open but has not yet acknowledged constructing its view.
  assert.equal(h.room.preparing?.size,1,'new socket must replace the old socket in the preparation barrier');
  assert.equal(h.room.view.race!.startAt,null);
 }finally{await h.server.close();}
});

void test('a separate display must finish rendering before the countdown is scheduled',async()=>{
 const h=await setup(true);try{
  const id=h.room.view.race!.startId;h.phone.send({type:'race-ready',startId:id});h.host.send({type:'race-ready',startId:id});h.host.send({type:'sync',sent:88});await h.host.wait(m=>m.type==='sync'&&m.sent===88);
  assert.equal(h.room.preparing?.size,1);assert.equal(h.room.view.race!.startAt,null);h.display!.send({type:'race-ready',startId:id});await h.host.wait(m=>m.type==='room'&&m.room.race?.startAt!=null);
 }finally{await h.server.close();}
});
