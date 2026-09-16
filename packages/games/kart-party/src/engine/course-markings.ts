import { angleDelta, magneticAt, mod, sample, type Track } from './tracks';

/** Read the actual route, leaving room between groups and around the magnetic loop. */
export function courseBends(track:Track){
  const bends:{s:number;direction:number}[]=[];
  for(let distance=24;distance<track.length-40;distance+=8){
    const s=distance/track.length;
    if([-20,0,20].some(d=>magneticAt(track,mod(s+d/track.length))))continue;
    const turn=angleDelta(sample(track,s+20/track.length).heading,sample(track,s-20/track.length).heading);
    if(Math.abs(turn)<.5)continue;
    bends.push({s,direction:Math.sign(turn)});distance+=64;
  }
  return bends;
}
