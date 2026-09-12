import type { MobKind } from './model';

export type SoundKind='splash'|'break'|'place'|'hit'|'hurt'|'death'|'craft'|'eat'|'plant'|'harvest'|'smelt'|'pickup'|'sleep'|'bow'|'arrow'|'explode';
export type SoundEvent={id:number;at:number;kind:SoundKind;x:number;y:number;z:number;block?:number;mob?:MobKind;playerId?:string};
export type SoundState={time:number;sounds?:SoundEvent[];soundSeq?:number};
export const SOUND_LIMIT=64,SOUND_AGE=.75;
export function emitSound(s:SoundState,kind:SoundKind,p:{x:number;y:number;z:number},detail:Pick<SoundEvent,'block'|'mob'|'playerId'>={}){
 s.sounds??=[];s.soundSeq=(s.soundSeq??0)+1;
 s.sounds.push({id:s.soundSeq,at:s.time,kind,x:p.x,y:p.y,z:p.z,...detail});
 if(s.sounds.length>SOUND_LIMIT)s.sounds.splice(0,s.sounds.length-SOUND_LIMIT);
}
// A snapshot repeats recent events. Baselines and stale events must never replay on join or reconnect.
export class SoundCursor{
 private last:number|null=null;
 take(events:readonly SoundEvent[],time:number,reset=false){
  const high=Math.max(this.last??0,...events.map(e=>e.id));
  const fresh=this.last===null||reset?[]:events.filter(e=>e.id>this.last!&&time-e.at>=0&&time-e.at<=SOUND_AGE);
  this.last=high;return fresh;
 }
}
