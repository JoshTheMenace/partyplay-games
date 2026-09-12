import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/engine/audio';
import { createRace } from '../src/engine/simulation';

class Parameter {value=0;setTargetAtTime(value:number){this.value=value;}setValueAtTime(value:number){this.value=value;}exponentialRampToValueAtTime(value:number){this.value=value;}}
class Node {frequency=new Parameter();gain=new Parameter();type='';onended:(()=>void)|null=null;connect(){}disconnect(){}start(){}stop(){}}
class Context {
  static instances:Context[]=[];currentTime=0;destination={};oscillators:Node[]=[];gains:Node[]=[];closed=false;
  constructor(){Context.instances.push(this);}
  createOscillator(){const node=new Node();this.oscillators.push(node);return node;}
  createGain(){const node=new Node();this.gains.push(node);return node;}
  resume(){return Promise.resolve();}close(){this.closed=true;return Promise.resolve();}
}
class Media {
  static instances:Media[]=[];src='';paused=true;currentTime=0;playbackRate=1;preservesPitch=true;volume=1;loop=false;preload='';plays=0;error:{code:number}|null=null;onerror:(()=>void)|null=null;onended:(()=>void)|null=null;
  constructor(){Media.instances.push(this);}getAttribute(){return this.src;}removeAttribute(){this.src='';}load(){}pause(){this.paused=true;}play(){this.plays++;this.paused=false;return Promise.resolve();}
}
async function withAudio(run:(audio:GameAudio)=>Promise<void>){
  const audioDescriptor=Object.getOwnPropertyDescriptor(globalThis,'Audio'),contextDescriptor=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');
  Object.defineProperty(globalThis,'Audio',{value:Media,configurable:true});Object.defineProperty(globalThis,'AudioContext',{value:Context,configurable:true});Context.instances=[];Media.instances=[];const audio=new GameAudio();
  try{await run(audio);}finally{audio.dispose();for(const [key,descriptor]of [['Audio',audioDescriptor],['AudioContext',contextDescriptor]] as const){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
}
void test('GameAudio keeps event SFX without a procedural melody and silences paused/muted playback',()=>withAudio(async audio=>{
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0}]});race.phase='racing';audio.start('coast',100);audio.update(race,'a',false);
  await Promise.resolve();const context=Context.instances[0],media=Media.instances[0],initial=context.oscillators.length;
  for(let i=0;i<100;i++){race.time=i/30;audio.update(race,'a',false);}assert.equal(context.oscillators.length,initial,'render updates must not synthesize a background melody');
  race.events.push({id:1,type:'coin',racer:'a',time:race.time});audio.update(race,'a',false);audio.update(race,'a',false);assert.equal(context.oscillators.length,initial+1);
  audio.muted=true;race.events.push({id:2,type:'hit',racer:'a',time:race.time});audio.update(race,'a',false);assert.equal(context.oscillators.length,initial+1);assert.equal(media.paused,true);assert.equal(context.gains[0].gain.value,0);
  audio.muted=false;audio.update(race,'a',true);assert.equal(media.paused,true);audio.update(race,'a',false);assert.equal(media.paused,false);
}));
void test('controller mode produces no soundtrack or event tones and dispose closes resources',()=>withAudio(async audio=>{
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0}]});race.phase='racing';race.events.push({id:1,type:'coin',racer:'a',time:0});
  audio.start('coast',100,'controller');audio.update(race,'a',false,'controller');assert.equal(Media.instances.length,0);assert.equal(Context.instances.length,0);
  audio.dispose();audio.start('coast');assert.equal(Context.instances.length,0);await Promise.resolve();
}));
void test('finish fanfare timers cannot create sound after disposal',()=>withAudio(async audio=>{
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0}]});race.phase='results';race.events.push({id:1,type:'finish',racer:'a',time:0});
  audio.start('coast');audio.update(race,'a',false);const context=Context.instances[0],count=context.oscillators.length;audio.dispose();
  await new Promise(resolve=>setTimeout(resolve,310));assert.equal(context.oscillators.length,count);assert.equal(Media.instances[0].src,'');
}));
void test('switching from playback to a controller releases audio, and a later display gesture can recreate it',()=>withAudio(async audio=>{
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0}]});race.phase='racing';audio.start('coast',100,'solo');audio.update(race,'a',false,'solo');await Promise.resolve();
  const context=Context.instances[0],media=Media.instances[0];audio.update(race,'a',false,'controller');assert.equal(context.closed,true);assert.equal(media.paused,true);assert.equal(media.src,'');
  audio.start('coast',100,'controller');assert.equal(Context.instances.length,1);audio.start('coast',100,'display');audio.update(race,'host',false,'display');await Promise.resolve();assert.equal(Context.instances.length,2);assert.equal(media.paused,false);
}));
void test('a fresh race retries a fully failed playlist without requiring a new gesture',()=>withAudio(async audio=>{
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0}]});audio.start('coast',100);audio.update(race,'a',false);await Promise.resolve();const media=Media.instances[0];
  for(let i=0;i<2;i++){media.error={code:2};media.onerror?.();await Promise.resolve();}
  assert.equal(media.plays,2);race.phase='racing';race.time=20;audio.update(race,'a',false);assert.equal(media.plays,2);
  race.phase='countdown';race.time=0;audio.update(race,'a',false);await Promise.resolve();assert.equal(media.plays,3);assert.equal(media.paused,false);
}));
void test('a nonplaying host display hears the first human racer without stacking every racer event',()=>withAudio(async audio=>{
  const race=createRace({track:'coast',players:[{id:'a',name:'A',driver:0},{id:'b',name:'B',driver:1}]});race.phase='racing';audio.start('coast',100,'party');audio.update(race,'host-not-racing',false,'party');
  const context=Context.instances[0],initial=context.oscillators.length;
  race.events.push({id:1,type:'coin',racer:'a',time:0},{id:2,type:'coin',racer:'b',time:0});audio.update(race,'host-not-racing',false,'party');assert.equal(context.oscillators.length,initial+1);
  audio.update(race,'host-not-racing',false,'party');assert.equal(context.oscillators.length,initial+1);await Promise.resolve();
}));
