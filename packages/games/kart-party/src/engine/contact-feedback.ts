import { statsFor } from './race-stats';
import type { Race, Racer } from './types';

/** Ignore resting contact and debounce pile-ups independently for each kart. */
export function recordContact(race:Race,racer:Racer,closing:number,kind:'course'|'kart'='course'){
  if(closing<4||racer.finishTime!==null||race.time-(racer.impact?.time??-Infinity)<.25)return;
  if(kind==='kart')statsFor(racer).collisions++;
  racer.impact={time:race.time,strength:Math.min(1,closing/25)};
  race.events.push({id:++race.serial,type:'bump',racer:racer.id,...racer.impact});
  if(race.events.length>24)race.events.shift();
}
export function contactRecoil(racer:Racer,time:number){
  const age=time-(racer.impact?.time??-Infinity);
  return age>=0&&age<.35?Math.sin(age/.35*Math.PI*2)*Math.exp(-age*8)*(racer.impact?.strength??0):0;
}
