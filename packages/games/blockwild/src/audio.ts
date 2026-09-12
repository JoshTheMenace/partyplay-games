import type { ResourceScope } from '../../../party-runtime/src/index';
import type { Player, View } from './model';
import { spatial, WorldSoundTracker, type Cue, type Loop } from './soundscape';
import type { UiSound } from './ui-sound';

const variants=['step-grass','step-stone','step-snow','step-wood','step-cloth','impact-stone','impact-wood','impact-soft','impact-glass','impact-metal','impact-hit','zombie','skeleton','spider'];
const names=[...variants.flatMap(n=>[0,1,2].map(i=>`${n}-${i}`)),'select','open','close','chest-open','chest-close','craft','pickup','sleep','swish','fuse','fire','water','splash','explode','bow'];
type Voice={source:AudioBufferSourceNode;gain:GainNode;pan:StereoPannerNode;cue:Cue};
// One mix per playing device. A watching display never constructs this class.
export class BlockwildAudio{
 private ctx?:AudioContext;
 private master?:GainNode;
 private filter?:BiquadFilterNode;
 private buffers=new Map<string,AudioBuffer>();
 private voices=new Set<Voice>();
 private loops=new Map<string,Voice>();
 private tracker=new WorldSoundTracker();
 private listener?:Player;
 private muted=false;
 private available=false;
 private baseline=true;
 private closed=false;
 private sequence=0;
 private lastView=-1;
 private receivedAt=0;
 constructor(private scope:ResourceScope){
  try{this.muted=localStorage.getItem('party.sound.muted')==='true';}catch{}
  const unlock=(e:Event)=>{if(e.isTrusted)void this.unlock();};
  scope.listen(window,'pointerdown',unlock,{capture:true});scope.listen(window,'keydown',unlock,{capture:true});
  scope.listen(window,'party-sound',e=>{this.muted=!!(e as CustomEvent<{muted:boolean}>).detail?.muted;this.quiet();if(!this.muted)void this.unlock();});
  scope.listen(document,'visibilitychange',()=>{this.quiet();if(document.hidden)void this.ctx?.suspend().catch(()=>{});});
  scope.listen(window,'pagehide',()=>this.quiet());
  scope.listen(window,'blockwild-ui-sound',e=>{
   const name=(e as CustomEvent<UiSound>).detail;
   if(['select','open','close','chest-open','chest-close'].includes(name))this.play({name,gain:name==='select'?.12:.32});
  });
  scope.defer(()=>{this.closed=true;this.quiet();this.buffers.clear();void this.ctx?.close().catch(()=>{});});
 }
 private async unlock(){
  if(this.closed||this.muted||document.hidden)return;
  try{
   if(!this.ctx){
    const Audio=window.AudioContext??(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
    if(!Audio)return;
    const ctx=this.ctx=new Audio();this.master=ctx.createGain();this.master.gain.value=.7;
    this.filter=ctx.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=18000;
    const compressor=ctx.createDynamicsCompressor();compressor.threshold.value=-12;compressor.ratio.value=5;
    this.filter.connect(this.master);this.master.connect(compressor);compressor.connect(ctx.destination);
    this.scope.listen(ctx,'statechange',()=>{if(ctx.state!=='running')this.quiet();else this.baseline=true;});
    // A failed sample is silent. Asset loading must not block graphics readiness or queue old sounds.
    void Promise.all(names.map(async name=>{try{const response=await fetch(`/games/blockwild/sounds/${name}.wav`,{signal:this.scope.signal});if(!response.ok)return;const buffer=await ctx.decodeAudioData(await response.arrayBuffer());if(!this.closed)this.buffers.set(name,buffer);}catch{}}));
   }
   if(this.ctx.state!=='running')await this.ctx.resume();
  }catch{/* Audio is optional on devices that cannot open or resume a context. */}
 }
 private quiet(){
  for(const voice of this.voices)this.stop(voice);
  this.loops.clear();this.baseline=true;
 }
 private stop(voice:Voice){
  voice.source.onended=null;
  try{voice.source.stop();}catch{}
  voice.source.disconnect();voice.gain.disconnect();voice.pan.disconnect();this.voices.delete(voice);
 }
 private mix(voice:Voice){
  const {cue,gain,pan}=voice,at=cue.at&&this.listener?spatial(this.listener,cue.at,cue.range):{gain:1,pan:0};
  const now=this.ctx!.currentTime;
  gain.gain.setTargetAtTime((cue.gain??.4)*at.gain,now,.025);pan.pan.setTargetAtTime(at.pan,now,.025);
 }
 private play(cue:Cue,loop=false):Voice|undefined{
  if(this.closed||this.muted||document.hidden||!this.available||this.ctx?.state!=='running'||this.voices.size>=24)return;
  if(cue.at&&this.listener&&spatial(this.listener,cue.at,cue.range).gain<.002)return;
  const name=variants.includes(cue.name)?`${cue.name}-${this.sequence++%3}`:cue.name,buffer=this.buffers.get(name);
  if(!buffer)return;
  const ctx=this.ctx,source=ctx.createBufferSource(),gain=ctx.createGain(),pan=ctx.createStereoPanner();
  source.buffer=buffer;source.loop=loop;source.playbackRate.value=(cue.rate??1)*(loop?1:.94+Math.random()*.12);gain.gain.value=0;
  source.connect(gain);gain.connect(pan);pan.connect(this.filter!);
  const voice={source,gain,pan,cue};this.voices.add(voice);this.mix(voice);
  source.onended=()=>this.stop(voice);source.start();return voice;
 }
 update(v:View|null|undefined,grid:Uint8Array,playerId:string|null,connected:boolean,yaw:number){
  const p=v?.players.find(p=>p.id===playerId),now=performance.now();
  if(v&&v.time!==this.lastView){this.receivedAt=now;this.lastView=v.time;}
  this.available=!!p&&p.connected&&connected&&now-this.receivedAt<1500;
  if(!v||!p||!this.available||document.hidden){this.quiet();return;}
  this.listener={...p,yaw};
  const active=!this.muted&&this.ctx?.state==='running';
  if(!active){this.baseline=true;return;}
  const frame=this.tracker.update(v,grid,p,this.baseline);this.baseline=false;
  this.filter!.frequency.setTargetAtTime(frame.underwater?850:18000,this.ctx!.currentTime,.15);
  this.syncLoops(frame.loops);
  for(const cue of frame.cues)this.play(cue);
  for(const voice of this.voices)this.mix(voice);
 }
 private syncLoops(wanted:Loop[]){
  for(const [id,voice]of this.loops)if(!wanted.some(loop=>loop.id===id)){this.stop(voice);this.loops.delete(id);}
  for(const cue of wanted){const voice=this.loops.get(cue.id);if(voice){voice.cue=cue;voice.source.playbackRate.setTargetAtTime(cue.rate??1,this.ctx!.currentTime,.08);}else{const next=this.play(cue,true);if(next)this.loops.set(cue.id,next);}}
 }
}
