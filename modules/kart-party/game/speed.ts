import type { SpeedClass } from './types';

export const SPEED_CLASSES = [
  {value:50,label:'50cc',description:'Easy cruising. More time to line up each corner.',multiplier:.75},
  {value:100,label:'100cc',description:'The classic pace. Fast, balanced racing.',multiplier:1},
  {value:150,label:'150cc',description:'High speed. Quick reactions and bigger jumps.',multiplier:1.25},
  {value:200,label:'200cc',description:'Expert pace. Brake early and commit to the turn.',multiplier:1.5},
] as const;
export const isSpeedClass=(value:unknown):value is SpeedClass=>value===50||value===100||value===150||value===200;
export const speedMultiplier=(value:SpeedClass)=>SPEED_CLASSES.find(option=>option.value===value)?.multiplier??1;
