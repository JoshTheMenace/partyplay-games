/** Lose excess boost/surface speed progressively; brakes still act immediately. */
export function drivingSpeed(speed:number,maximum:number,acceleration:number,resistance:number,dt:number){
  if(speed<=maximum)return Math.max(0,Math.min(maximum,speed+acceleration*dt));
  return Math.max(0,Math.max(maximum,speed-resistance*dt)+Math.min(0,acceleration)*dt);
}
