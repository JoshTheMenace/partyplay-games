import type { Race } from './types';
import { selectPlaylist, StreamedMusic, type AudioMode, type MusicSpeedClass, type MusicTrack } from './music';
import { createKartSfx, type KartSfx } from './kart-sfx.js';

export class GameAudio {
  private context:AudioContext|null=null;
  private master:GainNode|null=null;
  private engine:OscillatorNode|null=null;
  private engineGain:GainNode|null=null;
  private sfx:KartSfx|null=null;
  private music=new StreamedMusic();
  private lastEvent=0;
  private lastCountdown=4;
  private raceTime:number|null=null;
  private racePhase:Race['phase']|null=null;
  private silenced=false;
  private disposed=false;
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
      this.sfx=createKartSfx(this.context);
    }
    void this.context?.resume().catch(()=>{});
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
    this.sfx?.setMuted(this.silenced);
    this.engine.frequency.setTargetAtTime(45+(racer?.speed??0)*3,now,.12);this.engineGain.gain.setTargetAtTime(race?.phase==='racing'?.06:0,now,.15);
    if(!race){this.lastEvent=0;this.lastCountdown=4;return;}
    if(race.phase==='countdown'){
      const count=Math.ceil(race.countdown);if(count!==this.lastCountdown){this.lastCountdown=count;this.sfx?.play('countdown',{id:`count-${count}`});}this.lastEvent=0;
    } else if(race.phase==='racing'&&this.lastCountdown!==0){this.sfx?.play('go',{id:'go'});this.lastCountdown=0;}
    for(const event of race.events)if(event.id>this.lastEvent){this.lastEvent=event.id;if(event.racer!==racer?.id)continue;
      if(event.type==='coin')this.sfx?.play('coin',event);
      if(event.type==='item'){for(let i=0;i<7;i++)this.sfx?.play('roulette_tick',{id:`${event.id}-${i}`,delay:i*.105});this.sfx?.play('item_reveal',{id:event.id,delay:.82});}
      if(event.type==='use'&&event.item)this.sfx?.play(({boost:'boost_launch',shell:'shell_launch',banana:'banana_drop',shield:'shield_on',pulse:'pulse_blast',triple:'triple_launch',oil:'oil_drop',frost:'frost_launch',magnet:'magnet_on',star:'star_on',rocket:'rocket_launch',decoy:'decoy_drop'} as const)[event.item],event);
      if(event.type==='boost')this.sfx?.play('boost_launch',event);
      if(event.type==='hit')this.sfx?.play(event.effect==='shield'?'shield_block':event.effect==='frost'?'hit_frost':event.effect==='oil'?'hit_oil':event.effect==='decoy'?'hit_decoy':'hit_stun',event);
      if(event.type==='contact')this.sfx?.play('kart_bump',{id:event.id,value:event.intensity??.5});
      if(event.type==='finish')this.sfx?.play('finish',event);
    }
  }
  private closeContext(){
    this.sfx?.panic();this.sfx=null;
    if(this.master)this.master.gain.value=0;
    this.engine?.stop();this.engine?.disconnect();this.engineGain?.disconnect();this.master?.disconnect();void this.context?.close().catch(()=>{});
    this.context=null;this.master=null;this.engine=null;this.engineGain=null;
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.music.dispose();this.closeContext();}
}
