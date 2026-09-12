import type { ResourceScope } from '../../../party-runtime/src/index';
import { BackgroundMusic } from './music';

/** Background music belongs to the host, independently of its player seat. */
export class HostMusic{
 private ctx?:AudioContext;
 private playlist?:BackgroundMusic;
 private muted=false;
 private active=false;
 private closed=false;
 private time=-1;
 private receivedAt=0;
 constructor(private scope:ResourceScope){
  try{this.muted=localStorage.getItem('party.sound.muted')==='true';}catch{}
  const unlock=(e:Event)=>{if(e.isTrusted)this.unlock();};
  scope.listen(window,'pointerdown',unlock,{capture:true});scope.listen(window,'keydown',unlock,{capture:true});
  scope.listen(window,'party-sound',e=>{this.muted=!!(e as CustomEvent<{muted:boolean}>).detail?.muted;this.sync();if(!this.muted)this.unlock();});
  scope.listen(document,'visibilitychange',()=>{this.sync();if(document.hidden)void this.ctx?.suspend().catch(()=>{});else this.unlock();});
  scope.listen(window,'pagehide',()=>{this.active=false;this.sync();});
  scope.defer(()=>{this.closed=true;this.playlist?.dispose();void this.ctx?.close().catch(()=>{});});
  // Start already follows a host gesture. Browsers that require another tap keep it suspended.
  if(navigator.userActivation?.hasBeenActive)this.unlock();
 }
 private unlock(){
  if(this.closed||this.muted||document.hidden)return;
  try{
   if(!this.ctx){
    const Audio=window.AudioContext??(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
    if(!Audio)return;
    this.ctx=new Audio();this.playlist=new BackgroundMusic(this.ctx,this.ctx.destination);
    this.scope.listen(this.ctx,'statechange',()=>this.sync());
   }
   this.sync(true);
   if(this.ctx.state!=='running')void this.ctx.resume().then(()=>{if(!this.closed)this.sync(true);}).catch(()=>{});
  }catch{/* Music failure must not interrupt the room or phone effects. */}
 }
 private sync(retry=false){this.playlist?.setPlaying(this.active&&!this.muted&&!document.hidden&&this.ctx?.state==='running',retry);}
 update(time:number|undefined,connected:boolean){
  const now=performance.now();if(time!==undefined&&time!==this.time){this.time=time;this.receivedAt=now;}
  this.active=time!==undefined&&connected&&now-this.receivedAt<1500;this.sync();
 }
}
