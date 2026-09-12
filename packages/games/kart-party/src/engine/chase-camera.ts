import { angleDelta } from './tracks';
import type { Racer } from './types';

export function createChaseCamera(){
  let id='',heading=0,fov=60;
  return {reset(){id='';},sample(racer:Racer,dt:number,racing:boolean,reducedMotion:boolean,snap=false){
    const cut=snap||id!==racer.id,target=(racing?60:48)+(racer.boost>0&&!reducedMotion?6:0);
    id=racer.id;
    heading=cut?racer.heading:heading+angleDelta(racer.heading,heading)*(1-Math.exp(-dt*10));
    fov=cut||reducedMotion?target:fov+(target-fov)*(1-Math.exp(-dt*5));
    return {heading,fov,cut};
  }};
}
