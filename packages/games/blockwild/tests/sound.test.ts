import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules, craft, serializeWorld, restoreWorld } from '../src/server';
import { homesteadAction } from '../src/survival';
import { emitSound, SoundCursor, SOUND_LIMIT } from '../src/sound-events';
import { eventCue, material, spatial, WorldSoundTracker } from '../src/soundscape';
import { index, neutral, CAMPFIRE, type View } from '../src/model';
import { assertSerializable } from '../../../party-contract/src/serializable';
const ctx={roomId:'r',roundId:'g',seed:99,nowMs:0,players:[{id:'p',name:'Builder',color:'#aabbcc'}]};
function arena(){const s=rules.create(ctx,rules.validateSettings({}));s.animals=[];s.grid.fill(0);for(let x=0;x<128;x++)for(let z=0;z<128;z++)s.grid[index(x,5,z)]=3;Object.assign(s.players[0]!,{x:64.5,y:6,z:66.5,yaw:0,pitch:0});return s;}
const view=(s:ReturnType<typeof arena>):View=>rules.publicView(s,{nowMs:0,phase:'playing'});
test('only accepted crafting, eating and building emit sounds; event data is serializable',()=>{
 const s=arena(),p=s.players[0]!;assert.throws(()=>craft(s,p,'planks'));assert.equal(Boolean(s.sounds),false);
 p.inventory={4:1};craft(s,p,'planks');assert.equal(s.sounds?.at(-1)?.kind,'craft');
 const count=s.sounds!.length;assert.throws(()=>homesteadAction(s,p,{type:'eat'},()=>false));assert.equal(s.sounds!.length,count);
 p.inventory[53]=1;p.food=8;homesteadAction(s,p,{type:'eat'},()=>false);assert.equal(s.sounds!.at(-1)?.kind,'eat');
 s.sounds=[];for(let n=0;n<10;n++)rules.tick(s,new Map([['p',{...neutral(),place:true,slot:2,pitch:-.7,looking:true}]]),1/30,0);assert.equal(s.sounds.length,0);
 p.cooldown=0;p.inventory[2]=1;rules.tick(s,new Map([['p',{...neutral(),place:true,slot:2,pitch:-.7,looking:true}]]),1/30,0);assert.equal(s.sounds.at(-1)?.kind,'place');assert.equal(s.sounds.at(-1)?.block,2);assertSerializable(view(s));
});
test('sound ring is bounded, transient, and cleared on restore',()=>{
 const s=arena();for(let n=0;n<100;n++)emitSound(s,'craft',s.players[0]!);
 assert.equal(s.sounds!.length,SOUND_LIMIT);assert.equal(s.sounds![0]!.id,37);
 const save=serializeWorld(s);assert.ok(!('sounds' in save));restoreWorld(s,save);assert.equal(s.sounds!.length,0);
 emitSound(s,'craft',s.players[0]!);assert.equal(s.sounds![0]!.id,101);
 for(let n=0;n<30;n++)rules.tick(s,new Map(),1/30,0);assert.equal(s.sounds!.length,0);
});
test('cursor suppresses initial, duplicate, stale and reconnect history',()=>{
 const s=arena(),cursor=new SoundCursor();emitSound(s,'craft',s.players[0]!);assert.deepEqual(cursor.take(s.sounds!,0),[]);
 s.time=.1;emitSound(s,'eat',s.players[0]!);assert.equal(cursor.take(s.sounds!,s.time).length,1);assert.deepEqual(cursor.take(s.sounds!,s.time),[]);
 emitSound(s,'craft',s.players[0]!);assert.deepEqual(cursor.take(s.sounds!,2),[]);
 s.time=2;emitSound(s,'craft',s.players[0]!);assert.deepEqual(cursor.take(s.sounds!,2,true),[]);assert.deepEqual(cursor.take(s.sounds!,2),[]);
});
test('per-player distance and yaw determine audibility and stereo direction',()=>{
 const listener={x:0,y:0,z:0,yaw:0},source={x:5,y:0,z:0};
 assert.ok(spatial(listener,source).gain>0);assert.equal(spatial(listener,source).pan,1);
 assert.equal(spatial({...listener,yaw:Math.PI},source).pan,-1);assert.equal(spatial(listener,{...source,x:22}).gain,0);
 assert.equal(material(4),'wood');assert.equal(material(5),'grass');assert.equal(material(11),'glass');assert.equal(material(46),'cloth');
});
test('footsteps require distance, stop for stationary or flying players, and skip teleports',()=>{
 const s=arena(),p=s.players[0]!,tracker=new WorldSoundTracker();const update=()=>{s.time+=.1;return tracker.update(view(s),s.grid,p).cues;};
 assert.deepEqual(update(),[]);assert.deepEqual(update(),[]);
 p.x+=.8;assert.deepEqual(update(),[]);p.x+=.8;assert.ok(update().some(c=>c.name==='step-stone'));
 p.x+=20;assert.deepEqual(update(),[]);p.flying=true;p.x+=2;assert.deepEqual(update(),[]);
 p.flying=false;assert.deepEqual(update(),[]);
});
test('water transitions and landings sound once, not on every snapshot',()=>{
 const s=arena(),p=s.players[0]!,tracker=new WorldSoundTracker();const update=()=>{s.time+=.1;return tracker.update(view(s),s.grid,p);};
 update();p.y=7.2;update();p.y=6;assert.ok(update().cues.some(c=>c.name==='step-stone'));assert.deepEqual(update().cues,[]);
 s.grid[index(64,6,66)]=6;s.grid[index(64,7,66)]=6;const wet=update();assert.ok(wet.cues.some(c=>c.name==='splash'));assert.equal(wet.underwater,true);assert.ok(wet.loops.some(c=>c.name==='water'));assert.deepEqual(update().cues,[]);
});
test('nearby mob events differ between phones, and reset skips old actions',()=>{
 const s=arena(),p=s.players[0]!,near=new WorldSoundTracker(),far=new WorldSoundTracker(),remote={...p,id:'far',x:10};
 near.update(view(s),s.grid,p);far.update(view(s),s.grid,remote);s.time=.1;emitSound(s,'hit',{...p,x:p.x+2},{mob:'zombie'});
 assert.equal(near.update(view(s),s.grid,p).cues[0]?.name,'zombie');assert.deepEqual(far.update(view(s),s.grid,remote).cues,[]);
 s.time=.2;emitSound(s,'craft',p);assert.deepEqual(near.update(view(s),s.grid,p,true).cues,[]);
});
test('creeper fuse cancels promptly and fire follows fuel and distance',()=>{
 const s=arena(),p=s.players[0]!,tracker=new WorldSoundTracker();const update=()=>{s.time+=.1;return tracker.update(view(s),s.grid,p).loops;};
 update();s.creatures=[{id:1,kind:'creeper',x:p.x,y:p.y,z:p.z-2,health:10,hitAt:0,fuse:.3}];assert.ok(update().some(l=>l.name==='fuse'));
 s.creatures[0]!.fuse=0;assert.ok(!update().some(l=>l.name==='fuse'));
 const i=index(63,6,66);s.fuelUntil={[i]:10};assert.ok(update().some(l=>l.name==='fire'));s.fuelUntil={};assert.ok(!update().some(l=>l.name==='fire'));
 s.edits.set(i,CAMPFIRE);s.revision++;assert.ok(update().some(l=>l.name==='fire'));p.x=100;assert.ok(!update().some(l=>l.name==='fire'));
});
test('ten players can share one bounded event stream without hearing distant events',()=>{
 const s=arena(),p=s.players[0]!,listeners=Array.from({length:10},(_,n)=>({...p,id:String(n),x:n<5?64:10})),trackers=listeners.map(()=>new WorldSoundTracker());
 listeners.forEach((p,n)=>trackers[n]!.update(view(s),s.grid,p));s.time=.1;for(let n=0;n<100;n++)emitSound(s,'place',{x:64,y:6,z:66},{block:n%2?4:3});
 listeners.forEach((p,n)=>assert.equal(trackers[n]!.update(view(s),s.grid,p).cues.length,n<5?64:0));
});

test('death stays at the impact location for others but follows the respawned owner',()=>{
 const s=arena(),p=s.players[0]!;s.time=800;p.health=1;p.x=30;p.z=30;s.creatures=[{id:1,kind:'zombie',x:30,y:6,z:29,health:10,hitAt:0,attackAt:0}];
 rules.tick(s,new Map(),1/30,0);const event=s.sounds!.find(e=>e.kind==='death')!;
 assert.equal(event.x,30);assert.equal(event.playerId,p.id);assert.ok(p.x!==30);assert.equal(eventCue(event,p.id).at,undefined);assert.equal(eventCue(event,'other').at,event);
});
test('nearby mobs vocalize occasionally, idle creepers stay quiet, and fuse loops are bounded',()=>{
 const s=arena(),p=s.players[0]!,tracker=new WorldSoundTracker();s.creatures=['zombie','skeleton','spider','creeper'].map((kind,id)=>({id,kind:kind as 'zombie'|'skeleton'|'spider'|'creeper',x:p.x,y:p.y,z:p.z-3,health:10,hitAt:0}));
 const names:string[]=[];for(let n=0;n<70;n++){s.time+=.1;names.push(...tracker.update(view(s),s.grid,p).cues.map(c=>c.name));}
 assert.deepEqual(names.sort(),['skeleton','spider','zombie']);
 s.creatures=Array.from({length:20},(_,id)=>({id,kind:'creeper',x:p.x,y:p.y,z:p.z-2,health:10,hitAt:0,fuse:.5}));s.time+=.1;
 assert.equal(tracker.update(view(s),s.grid,p).loops.length,5);
});

test('nearby farm animals call without playing distant or repeated snapshot sounds',()=>{const s=arena(),p=s.players[0]!;s.animals=[{id:1,kind:'cow',x:p.x+3,y:p.y,z:p.z,yaw:0,health:5,adultAt:0,loveUntil:0,breedAt:0,hitAt:0}];const tracker=new WorldSoundTracker();tracker.update(view(s),s.grid,p);const calls=[];for(let t=1;t<20;t++){s.time=t;calls.push(...tracker.update(view(s),s.grid,p).cues);assert.equal(tracker.update(view(s),s.grid,p).cues.length,0);}assert.ok(calls.length>0&&calls.length<5);assert.ok(calls.every(c=>c.name==='cow'));s.animals[0]!.x=p.x+40;for(let t=20;t<40;t++){s.time=t;assert.equal(tracker.update(view(s),s.grid,p).cues.length,0);}});
