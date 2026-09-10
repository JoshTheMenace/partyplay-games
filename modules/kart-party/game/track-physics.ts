import { angleDelta, mod, rampAt, roadHeight, sample, sectorAt, TRACKS } from './tracks';
import type { Race, Racer } from './types';

export function advanceTrackMotion(race:Race,racer:Racer,previousS:number,offset:number,dt:number){
  const track=TRACKS[race.track],ground=roadHeight(track,racer.s,offset),previousRamp=rampAt(track,previousS,offset);
  racer.rampCooldown=Math.max(0,racer.rampCooldown-dt);
  if(!racer.airborne&&previousRamp&&racer.rampCooldown===0&&racer.speed>12){
    const travel=angleDelta(racer.s*Math.PI*2,previousS*Math.PI*2)/(Math.PI*2),lip=mod(previousRamp.s+previousRamp.length/track.length);
    if(travel>0&&mod(lip-previousS)<=travel+1e-8){
      racer.y=Math.max(racer.y,sample(track,lip,offset).y+previousRamp.height);racer.verticalSpeed=previousRamp.launch+racer.speed*previousRamp.height/previousRamp.length;
      racer.airborne=true;racer.rampCooldown=1;racer.drift=0;racer.driftSide=0;
    }
  }
  if(!racer.airborne&&racer.y>ground+.25&&rampAt(track,previousS)){racer.airborne=true;racer.verticalSpeed=0;}
  if(racer.airborne){
    racer.verticalSpeed-=sectorAt(track,racer.s).gravity*dt;racer.y+=racer.verticalSpeed*dt;
    if(racer.y<=ground&&racer.verticalSpeed<0){racer.y=ground;racer.verticalSpeed=0;racer.airborne=false;racer.boost=Math.max(racer.boost,.65);}
  }else{racer.y=ground;racer.verticalSpeed=0;}
}
