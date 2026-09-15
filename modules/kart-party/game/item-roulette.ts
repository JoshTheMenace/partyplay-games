import { ITEM_IDS } from './items';
import type { Item, Race, Racer } from './types';

export const ROULETTE_SECONDS=.9;

export function itemRoulette(race:Race,racer:Racer):{active:boolean;item:Item|null;progress:number}{
  const event=[...race.events].reverse().find(candidate=>candidate.type==='item'&&candidate.racer===racer.id&&candidate.item);
  if(!event||racer.item!==event.item)return {active:false,item:racer.item,progress:1};
  const age=Math.max(0,race.time-event.time),progress=Math.min(1,age/ROULETTE_SECONDS);
  if(progress>=1)return {active:false,item:racer.item,progress};
  const index=Math.floor((age*14+age*age*18+event.id)%ITEM_IDS.length);
  return {active:true,item:ITEM_IDS[index],progress};
}
