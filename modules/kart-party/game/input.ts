import type { Input } from './types';

/** Convert the side requested on screen into the simulation's world-yaw sign. */
export function screenSteer(value:number){const clamped=Math.max(-1,Math.min(1,value));return clamped===0?0:-clamped;}

export function humanInput(touch:Input,keys:ReadonlySet<string>,autoAccelerate:boolean,active:boolean,pendingUse=false):Input {
  const steer=Math.max(-1,Math.min(1,touch.steer+(keys.has('arrowright')||keys.has('d')?1:0)-(keys.has('arrowleft')||keys.has('a')?1:0)));
  // The chase camera faces +Z: screen-right is -X, opposite positive world yaw.
  return {steer:screenSteer(steer),throttle:active&&(autoAccelerate||touch.throttle||keys.has('arrowup')||keys.has('w')),brake:touch.brake||keys.has('arrowdown')||keys.has('s'),drift:touch.drift||keys.has('shift')||keys.has(' '),use:touch.use||pendingUse||keys.has('e')||keys.has('enter')||keys.has('x')||keys.has('control')};
}
