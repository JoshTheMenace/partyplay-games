import {speedMultiplier} from './speed';
import {TRACKS} from './tracks';
import type {Race,SpeedClass,TrackId} from './types';

export const estimatedRaceSeconds=(track:TrackId,laps:number,speedClass:SpeedClass)=>Math.ceil(TRACKS[track].length*laps/(31*speedMultiplier(speedClass))+3.5);
export function raceTimeRemaining(race:Race):number {
  const limit=Math.max(600,estimatedRaceSeconds(race.track,race.laps,race.speedClass)*2+120);
  const leader=race.racers.some(r=>!r.bot)?race.firstHumanFinish:race.firstFinish;
  const deadline=leader==null?limit:Math.min(limit,leader+Math.max(120/speedMultiplier(race.speedClass),leader*.35));
  return Math.max(0,deadline-race.time);
}
