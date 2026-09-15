import { statsFor } from './race-stats';
import type { Race,Racer } from './types';

export type PartyAward={id:string;title:string;blurb:string;racer:Racer;value:string};
type AwardRule={id:string;title:string;blurb:string;score:(racer:Racer)=>number;format:(value:number)=>string;always?:boolean};
const RULES:AwardRule[]=[
  {id:'speed',title:'Road Rocket',blurb:'Highest speed reached',score:racer=>statsFor(racer).maxSpeed,format:value=>`${Math.round(value*3.6)} km/h`,always:true},
  {id:'drift',title:'Drift Royalty',blurb:'Most drift boosts',score:racer=>statsFor(racer).driftBoosts,format:value=>`${value} boosts`},
  {id:'hits',title:'Item Menace',blurb:'Most rivals tagged',score:racer=>statsFor(racer).hitsDealt,format:value=>`${value} hits`},
  {id:'coins',title:'Treasure Magnet',blurb:'Most coins collected',score:racer=>statsFor(racer).coinsCollected,format:value=>`${value} coins`},
  {id:'bumps',title:'Bumper Buddy',blurb:'Most kart contact',score:racer=>statsFor(racer).collisions,format:value=>`${value} bumps`},
  {id:'air',title:'Frequent Flyer',blurb:'Longest time airborne',score:racer=>statsFor(racer).airtime,format:value=>`${value.toFixed(1)}s aloft`},
  {id:'shield',title:'Bubble Wrap',blurb:'Most attacks blocked',score:racer=>statsFor(racer).shieldsBlocked,format:value=>`${value} blocked`},
  {id:'comeback',title:'Comeback Kid',blurb:'Most places gained',score:racer=>statsFor(racer).startRank-racer.rank,format:value=>`+${value} places`},
];

export function partyAwards(race:Race):PartyAward[]{
  const humans=race.racers.filter(racer=>!racer.bot),racers=humans.length>1?humans:race.racers;
  return RULES.flatMap(rule=>{
    const order=[...racers].sort((a,b)=>rule.score(b)-rule.score(a)||a.rank-b.rank||a.id.localeCompare(b.id)),winner=order[0],score=winner?rule.score(winner):0;
    return winner&&(rule.always||score>0)?[{id:rule.id,title:rule.title,blurb:rule.blurb,racer:winner,value:rule.format(score)}]:[];
  }).slice(0,6);
}
