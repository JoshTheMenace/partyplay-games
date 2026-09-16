// Presentation only: never pass these poses back to stepRace, ranking, or input handling.
import {PresentationDelay} from '../../../../party-runtime/src/presentation';
export type MotionRacer = {
  loopDistance?:number;loopOffset?:number;
  id:string;x:number;y:number;z:number;heading:number;s:number;speed:number;
  verticalSpeed:number;airborne:boolean;
};
export type MotionRace = {
  startId?:string;startAt?:number|null;
  track:string;phase:'countdown'|'racing'|'results';time:number;countdown:number;racers:MotionRacer[];
};
export type MotionFrame<R extends MotionRace> = {race:R;snappedIds:string[];extrapolatedSeconds:number;delaySeconds:number};
export type MotionBufferOptions = {delaySeconds?:number;maxExtrapolationSeconds?:number;adaptiveDelay?:{minSeconds:number;maxSeconds:number}};
/* Party rooms present 100ms behind to start and adapt between 75 and 150ms to observed arrival gaps.
 * 50ms with no extrapolation froze on ordinary Wi-Fi jitter; extrapolation stays off so hits and
 * finishes are never shown before they are authoritative. */
export const PARTY_PRESENTATION:MotionBufferOptions={delaySeconds:.1,adaptiveDelay:{minSeconds:.075,maxSeconds:.15},maxExtrapolationSeconds:0};
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const wrap=(n:number,period:number)=>((n%period)+period)%period;
const delta=(to:number,from:number,period:number)=>wrap(to-from+period/2,period)-period/2;
const stamp=(race:MotionRace)=>race.phase==='countdown'?-race.countdown:race.time;
const jumped=(a:MotionRacer,b:MotionRacer,dt:number)=>{const distance=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);return distance>Math.max(12,Math.max(a.speed,b.speed)*dt*2.5+3)||a.speed>3&&b.speed<.5&&distance>3;};

export function createMotionBuffer<R extends MotionRace>(options:MotionBufferOptions={}){
  const fixedDelay=clamp(options.delaySeconds??.05,0,.15),maxExtrapolation=clamp(options.maxExtrapolationSeconds??.1,0,.15);
  const adaptive=options.adaptiveDelay?new PresentationDelay({initialMs:fixedDelay*1000,minMs:options.adaptiveDelay.minSeconds*1000,maxMs:options.adaptiveDelay.maxSeconds*1000}):null;
  let frames:{race:R;at:number;arrival:number}[]=[],clockSamples:number[]=[],offset=0,targetOffset=0,lastSample:number|null=null,lastAt:number|null=null,resetPending=false;
  const teleports=new Map<string,number>();
  function reset(){frames=[];clockSamples=[];lastSample=null;lastAt=null;teleports.clear();adaptive?.resume();resetPending=true;}
  function push(race:R,arrivalSeconds:number){
    const at=stamp(race);if(!Number.isFinite(at)||!Number.isFinite(arrivalSeconds))return;
    let previous=frames.at(-1);
    if(previous&&(previous.race.track!==race.track||race.startAt!=null&&previous.race.startAt!==race.startAt||race.phase==='countdown'&&previous.race.phase!=='countdown'||previous.race.phase==='countdown'&&race.phase==='countdown'&&at<previous.at-.1||arrivalSeconds-previous.arrival>.5)){
      reset();previous=undefined;
    }
    // WebSocket is ordered, but duplicate room broadcasts can carry the same simulation tick.
    if(previous&&at<previous.at-1e-6)return;
    if(previous&&Math.abs(at-previous.at)<1e-6){previous.race=race;previous.arrival=arrivalSeconds;return;}
    if(!previous){offset=targetOffset=arrivalSeconds-at;resetPending=true;}
    // A low-delay clock estimate avoids following every arrival jitter spike. Apply corrections
    // continuously in sample(), capped at 2% clock speed, rather than stepping on each packet.
    clockSamples.push(arrivalSeconds-at);if(clockSamples.length>80)clockSamples.shift();targetOffset=Math.min(...clockSamples);
    if(previous){
      const old=new Map(previous.race.racers.map(racer=>[racer.id,racer]));
      for(const racer of race.racers){const before=old.get(racer.id);if(!before||jumped(before,racer,at-previous.at))teleports.set(racer.id,at);}
    }
    adaptive?.arrival(arrivalSeconds*1000);
    frames.push({race,at,arrival:arrivalSeconds});if(frames.length>12)frames.shift();
  }
  function sample(nowSeconds:number):MotionFrame<R>|null{
    const latest=frames.at(-1);if(!latest)return null;
    const dt=lastSample===null?0:clamp(nowSeconds-lastSample,0,.1);lastSample=nowSeconds;
    offset+=clamp(targetOffset-offset,-dt*.02,dt*.02);
    adaptive?.advance(dt*1000);
    // Clock slew and delay slew each run presentation within a few percent of real time; never behind the last frame shown.
    const delay=adaptive?adaptive.ms/1000:fixedDelay,wanted=nowSeconds-offset-delay;
    let at=Math.min(wanted,latest.at+maxExtrapolation);if(lastAt!==null)at=Math.max(at,Math.min(lastAt,latest.at+maxExtrapolation));lastAt=at;
    let a=frames[0],b=a;
    for(let i=1;i<frames.length;i++){b=frames[i];if(b.at>=at)break;a=b;}
    const extrapolatedSeconds=latest.race.phase==='racing'?clamp(at-latest.at,0,maxExtrapolation):0;
    const snappedIds=resetPending?latest.race.racers.map(r=>r.id):[];resetPending=false;
    const aRacers=new Map(a.race.racers.map(r=>[r.id,r])),bRacers=new Map(b.race.racers.map(r=>[r.id,r]));
    const previous=frames.at(-2),oldRacers=new Map(previous?.race.racers.map(r=>[r.id,r]));
    const racers=latest.race.racers.map(current=>{
      const discontinuity=teleports.get(current.id);
      if(discontinuity!==undefined&&at<discontinuity){if(!snappedIds.includes(current.id))snappedIds.push(current.id);return {...current};}
      if(discontinuity!==undefined)teleports.delete(current.id);
      if(extrapolatedSeconds>0){
        const before=oldRacers.get(current.id),span=previous?latest.at-previous.at:0;
        if(!before||span<=0||span>.25||current.speed<.1&&!current.airborne||jumped(before,current,span))return {...current};
        const factor=extrapolatedSeconds/span;
        return {...current,x:current.x+(current.x-before.x)*factor,y:current.y+(current.y-before.y)*factor,z:current.z+(current.z-before.z)*factor,
          heading:current.heading+delta(current.heading,before.heading,Math.PI*2)*factor,s:wrap(current.s+delta(current.s,before.s,1)*factor,1)};
      }
      const start=aRacers.get(current.id)??current,end=bRacers.get(current.id)??current;
      const fraction=b.at>a.at?clamp((at-a.at)/(b.at-a.at),0,1):0;
      if(jumped(start,end,b.at-a.at)){if(!snappedIds.includes(current.id))snappedIds.push(current.id);return {...end};}
      const pose={...current};
      for(const key of ['x','y','z','speed','verticalSpeed'] as const)pose[key]=start[key]+(end[key]-start[key])*fraction;
      pose.heading=start.heading+delta(end.heading,start.heading,Math.PI*2)*fraction;pose.s=wrap(start.s+delta(end.s,start.s,1)*fraction,1);
      if(start.loopDistance!==undefined&&end.loopDistance!==undefined){pose.loopDistance=start.loopDistance+(end.loopDistance-start.loopDistance)*fraction;pose.loopOffset=(start.loopOffset??0)+((end.loopOffset??0)-(start.loopOffset??0))*fraction;}
      pose.airborne=fraction<.5?start.airborne:end.airborne;return pose;
    });
    // Keep discrete race/UI metadata current; only the renderer receives a smoothed time/pose.
    const displayedTime=latest.race.phase==='racing'?Math.max(0,at):latest.race.time;
    return {race:{...latest.race,time:displayedTime,racers} as R,snappedIds,extrapolatedSeconds,delaySeconds:delay};
  }
  return {push,sample,reset};
}
