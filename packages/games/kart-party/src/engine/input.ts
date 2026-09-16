import type { Input } from './types';

// The chase camera faces +Z: screen-right is -X, opposite positive world yaw.
export const worldSteer=(screenSteer:number)=>screenSteer===0?0:-screenSteer;
export function humanInput(touch:Input,keys:ReadonlySet<string>,autoAccelerate:boolean,active:boolean,pendingUse=false):Input {
  const steer=Math.max(-1,Math.min(1,touch.steer+(keys.has('arrowright')||keys.has('d')?1:0)-(keys.has('arrowleft')||keys.has('a')?1:0)));
  return {steer:worldSteer(steer),throttle:active&&(autoAccelerate||touch.throttle||keys.has('arrowup')||keys.has('w')),brake:touch.brake||keys.has('arrowdown')||keys.has('s'),drift:touch.drift||keys.has('shift')||keys.has(' '),use:touch.use||pendingUse||keys.has('e')||keys.has('enter')||keys.has('x')||keys.has('control')};
}
