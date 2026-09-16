import type { Race } from './types';
import { selectPlaylist, StreamedMusic, type AudioMode, type MusicSpeedClass, type MusicTrack } from './music';

export class GameAudio {
  private context:AudioContext|null=null;
  private master:GainNode|null=null;
  private engine:OscillatorNode|null=null;
  private engineGain:GainNode|null=null;
  private music=new StreamedMusic();
  private lastEvent=0;
  private lastCountdown=4;
  private raceTime:number|null=null;
  private racePhase:Race['phase']|null=null;
  private silenced=false;
  private disposed=false;
  private timers=new Set<ReturnType<typeof setTimeout>>();
  muted=false;
  start(track?:MusicTrack,speedClass:MusicSpeedClass=100,mode:AudioMode='solo'){
    if(this.disposed)return;
    this.silenced=this.muted||mode==='controller';
    if(mode==='controller'){this.music.update([],false);this.closeContext();return;}
    if(track)this.music.update(selectPlaylist(track,speedClass),!this.silenced);
    this.music.unlock();
    if(!this.context&&typeof AudioContext!=='undefined'){
      this.context=new AudioContext();this.master=this.context.createGain();this.master.gain.value=.25;this.master.connect(this.context.destination);
      this.engine=this.context.createOscillator();this.engine.type='triangle';this.engineGain=this.context.createGain();this.engineGain.gain.value=0;this.engine.connect(this.engineGain);this.engineGain.connect(this.master);this.engine.start();
    }
    void this.context?.resume().catch(()=>{});
  }
  private tone(frequency:number,duration:number,volume=.12,type:OscillatorType='sine'){
    if(!this.context||!this.master||this.muted||this.silenced||this.disposed)return;
    const oscillator=this.context.createOscillator(),gain=this.context.createGain(),now=this.context.currentTime;
    oscillator.type=type;oscillator.frequency.value=frequency;gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.001,now+duration);oscillator.connect(gain);gain.connect(this.master);oscillator.start();oscillator.stop(now+duration);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  }
  private delayedTone(frequency:number,duration:number,delay:number){
    const timer=setTimeout(()=>{this.timers.delete(timer);this.tone(frequency,duration,.2);},delay);this.timers.add(timer);
  }
  update(race:Race|null,playerId:string,paused:boolean,mode:AudioMode='solo'){
    if(this.disposed)return;
    this.silenced=this.muted||paused||mode==='controller';
    if(race&&(this.raceTime===null||race.time<this.raceTime||(race.phase==='countdown'&&this.racePhase!=='countdown')))this.music.retryFailed();
    this.raceTime=race?.time??null;this.racePhase=race?.phase??null;
    if(mode==='controller'){
      this.music.update([],false);this.closeContext();this.lastEvent=race?.events.at(-1)?.id??0;
      this.lastCountdown=race?.phase==='countdown'?Math.ceil(race.countdown):0;return;
    }
    const speedClass=(race as (Race&{speedClass?:MusicSpeedClass})|null)?.speedClass??100;
    this.music.update(race?selectPlaylist(race.track,speedClass):[],!!race&&race.phase!=='results'&&!this.silenced);
    if(!this.context||!this.master||!this.engine||!this.engineGain)return;
    const now=this.context.currentTime,racer=race?.racers.find(r=>r.id===playerId)??race?.racers.find(r=>!r.bot)??race?.racers[0];
    this.master.gain.setTargetAtTime(this.silenced?0:.25,now,.1);
    this.engine.frequency.setTargetAtTime(45+(racer?.speed??0)*3,now,.12);this.engineGain.gain.setTargetAtTime(race?.phase==='racing'?.06:0,now,.15);
    if(!race){this.lastEvent=0;this.lastCountdown=4;return;}
    if(race.phase==='countdown'){
      const count=Math.ceil(race.countdown);if(count!==this.lastCountdown){this.lastCountdown=count;this.tone(440,.14,.22);}this.lastEvent=0;
    } else if(race.phase==='racing'&&this.lastCountdown!==0){this.tone(880,.45,.22);this.lastCountdown=0;}
    for(const event of race.events)if(event.id>this.lastEvent){this.lastEvent=event.id;if(event.racer!==racer?.id)continue;
      if(event.type==='coin')this.tone(1320,.12,.09);
      if(event.type==='item')this.tone(660,.23,.13);
      if(event.type==='use'){if(event.item==='boost')this.tone(330,.4,.12,'sawtooth');else this.tone(440,.23,.1);}
      if(event.type==='boost')this.tone(330,.4,.12,'sawtooth');
      if(event.type==='hit'){if(event.effect==='shield')this.tone(1320,.12,.1,'sine');else this.tone(85,.35,.18,'square');}
      if(event.type==='bump'&&race.time-event.time<.4)this.tone(110,.1,.04+.1*(event.strength??0),'triangle');
      if(event.type==='finish'){this.tone(523,.5,.2);this.delayedTone(659,.5,140);this.delayedTone(784,.8,280);}
    }
  }
  private closeContext(){
    for(const timer of this.timers)clearTimeout(timer);this.timers.clear();
    if(this.master)this.master.gain.value=0;
    this.engine?.stop();this.engine?.disconnect();this.engineGain?.disconnect();this.master?.disconnect();void this.context?.close().catch(()=>{});
    this.context=null;this.master=null;this.engine=null;this.engineGain=null;
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.music.dispose();this.closeContext();}
}
