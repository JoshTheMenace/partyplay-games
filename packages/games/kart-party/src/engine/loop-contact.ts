import { hit } from './items';
import { surfaceFrame,TRACKS } from './tracks';
import type { Race,Racer } from './types';

// Return true when ordinary world-XZ pushing must be skipped.
export function resolveLoopContact(race:Race,a:Racer,b:Racer){
  if(a.loopDistance===undefined&&b.loopDistance===undefined)return false;
  if(a.loopDistance===undefined||b.loopDistance===undefined||a.finishTime!==null||b.finishTime!==null)return true;
  const along=Math.abs(a.loopDistance-b.loopDistance),across=Math.abs((a.loopOffset??0)-(b.loopOffset??0));
  if(Math.hypot(along,across)>=2.5||Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)>=2.7)return true;
  const direction=Math.sign(b.loopDistance-a.loopDistance),closing=(a.speed-b.speed)*direction;
  if(closing>0){const impulse=closing*.6;a.speed=Math.max(0,a.speed-impulse*direction);b.speed=Math.max(0,b.speed+impulse*direction);}
  if(a.star>0)hit(race,b);if(b.star>0)hit(race,a);
  const track=TRACKS[race.track],limit=track.width/2-1.25;
  const [low,high]=(a.loopOffset??0)<(b.loopOffset??0)||((a.loopOffset??0)===(b.loopOffset??0)&&a.id<b.id)?[a,b]:[b,a];
  const separation=Math.sqrt(2.5*2.5-along*along),needed=separation-across;
  let lowMove=Math.min(needed/2,(low.loopOffset??0)+limit);
  const highMove=Math.min(needed-lowMove,limit-(high.loopOffset??0));
  lowMove+=Math.min(needed-lowMove-highMove,(low.loopOffset??0)+limit-lowMove);
  low.loopOffset=(low.loopOffset??0)-lowMove;high.loopOffset=(high.loopOffset??0)+highMove;
  for(const racer of [a,b]){const frame=surfaceFrame(track,racer.s,racer.loopOffset);Object.assign(racer,frame.position);}
  return true;
}
