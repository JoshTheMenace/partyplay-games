import type { RaceStats,Racer } from './types';

export function statsFor(racer:Racer):RaceStats{
  return racer.stats??={startRank:racer.rank,maxSpeed:0,itemsUsed:0,hitsDealt:0,hitsTaken:0,shieldsBlocked:0,coinsCollected:0,driftBoosts:0,collisions:0,airtime:0};
}
