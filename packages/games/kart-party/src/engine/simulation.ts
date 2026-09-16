import { statsFor } from './race-stats';
import { applyCourseLane, courseBotLane, courseObstacles, resolveCourseObstacles } from './course-features';
import { TRACKS, angleDelta, clamp, mod, nearest, roadHeight, sample, sectorAt, magneticAt, surfaceFrame } from './tracks';
import { resolveKartContact } from './kart-contact';
import { recordContact } from './contact-feedback';
import { drivingSpeed } from './driving';
import { kartStats } from './garage';
import { applyRouteZones, racerRoute, resolveCourseGates, routeBotTarget, routeLocation } from './course-interactions';
import { routeSample } from './course-routes';
import { advanceTrackMotion } from './track-physics';
import { raceTimeRemaining } from './race-timing';
import { isSpeedClass, speedMultiplier } from './speed';
import { activateItem, selectItem, tickStatuses, updateHazards } from './items';
import { DRIVERS, MAX_PLAYERS, DEFAULT_GRID_SIZE, NEUTRAL, type Input, type Race, type RaceOptions, type Racer } from './types';

export const STEP = 1 / 60;
function event(race: Race,type: Race['events'][number]['type'],racer: Racer,lap?:number,item?:Racer['item']) {
  race.events.push({id:++race.serial,type,racer:racer.id,time:race.time,...(lap===undefined?{}:{lap}),...(item?{item}:{})});
  if(race.events.length>24) race.events.shift();
}
export function createRace(options: RaceOptions): Race {
  const track=TRACKS[options.track],players=options.players.slice(0,MAX_PLAYERS);
  const cpuDrivers=DRIVERS.map((_,i)=>i).filter(i=>!players.some(p=>p.driver===i));
  const racers: Racer[] = Array.from({length:Math.max(DEFAULT_GRID_SIZE,players.length)},(_,i)=>{
    const player=players[i],driver=player?.driver??cpuDrivers[i-players.length], s=mod((-8-Math.floor(i/2)*7)/track.length),p=sample(track,s,(i%2?1:-1)*3.2);
    return {id:player?.id??`cpu-${i}`,name:player?.name??DRIVERS[driver%DRIVERS.length].name,driver,bot:!player,x:p.x,z:p.z,y:p.y,verticalSpeed:0,airborne:false,rampCooldown:0,heading:p.heading,speed:0,lateral:0,s,checkpoints:0,lap:1,rank:i+1,coins:0,drift:0,driftSide:0,boost:0,shield:0,stun:0,frost:0,oil:0,magnet:0,star:0,item:null,itemCooldown:0,finishTime:null,lastUse:false,offroad:false,connected:true,distance:0,wallTime:0,coinsTaken:[],stats:{startRank:i+1,maxSpeed:0,itemsUsed:0,hitsDealt:0,hitsTaken:0,shieldsBlocked:0,coinsCollected:0,driftBoosts:0,collisions:0,airtime:0}};
  });
  return {track:options.track,speedClass:isSpeedClass(options.speedClass)?options.speedClass:100,phase:'countdown',time:0,countdown:3.5,laps:clamp(options.laps??3,1,5),racers,hazards:[],events:[],seed:options.seed??82731,serial:0,firstFinish:null,firstHumanFinish:null,difficulty:options.difficulty??'normal'};
}
export function sanitizeInput(value: unknown): Input {
  if(!value||typeof value!=='object') return {...NEUTRAL};
  const v=value as Record<string,unknown>;
  return {steer:typeof v.steer==='number'&&Number.isFinite(v.steer)?clamp(v.steer,-1,1):0,throttle:v.throttle===true,brake:v.brake===true,drift:v.drift===true,use:v.use===true};
}
export function botInput(race: Race,racer: Racer): Input {
  const track=TRACKS[race.track],pace=speedMultiplier(race.speedClass),lookahead=12+racer.speed/pace*.62,lane=courseBotLane(track,racer,race.time,Math.sin(racer.driver*2.1)*3.3);
  if(racer.loopDistance!==undefined)return {steer:clamp(((lane-(racer.loopOffset??0))*.3),-1,1),throttle:true,brake:false,drift:false,use:!!racer.item&&racer.itemCooldown<=0};
  const branch=routeBotTarget(track,racer,race.time,lookahead),target=branch?.point??sample(track,racer.s+lookahead/track.length,lane);
  const delta=angleDelta(Math.atan2(target.x-racer.x,target.z-racer.z),racer.heading);
  const curve=Math.abs(angleDelta(sample(track,racer.s+35/track.length).heading,sample(track,racer.s).heading));
  return {steer:clamp(delta*2.7,-1,1),throttle:true,brake:curve>.8&&racer.speed>22*pace,drift:false,use:!!racer.item&&racer.itemCooldown<=0};
}
export function respawn(race: Race,racer: Racer) {
  delete racer.routeId;
  const track=TRACKS[race.track];
  // Recover within the current earned sector; an invalid sector falls back to its gate.
  const gate=mod((racer.checkpoints-1)/track.gates),progress=mod(racer.s-gate);
  const s=racer.checkpoints===0?mod(-8/track.length):mod(gate+(progress<1/track.gates?Math.max(3/track.length,progress-8/track.length):3/track.length));
  const p=sample(track,s,(racer.driver%2?1:-1)*2);
  racer.loopDistance=magneticAt(track,s)?(s-track.magnetic!.from)*track.length:undefined;racer.loopOffset=racer.loopDistance===undefined?undefined:(racer.driver%2?1:-1)*2;
  Object.assign(racer,{x:p.x,z:p.z,y:roadHeight(track,s,(racer.driver%2?1:-1)*2),verticalSpeed:0,airborne:false,rampCooldown:1,s,heading:p.heading,speed:0,lateral:0,drift:0,driftSide:0,stun:0,boost:0,frost:0,oil:0,wallTime:0,offroad:false});
}
export function advanceCheckpoints(race: Race,racer: Racer,previousS: number,currentS: number,offset: number,dt: number) {
  const track=TRACKS[race.track],delta=angleDelta(currentS*Math.PI*2,previousS*Math.PI*2)/(Math.PI*2);
  if(delta<=0||delta>.025||Math.abs(offset)>track.width/2+(track.shoulder??5)+.1||racer.finishTime!==null) return;
  const expected=mod(racer.checkpoints/track.gates),toGate=mod(expected-previousS);
  if(toGate>delta+1e-8) return;
  const completedLap=racer.lap;
  racer.checkpoints++;
  racer.lap=Math.min(race.laps,Math.max(1,Math.floor((racer.checkpoints-1)/track.gates)+1));
  if(racer.lap>completedLap)event(race,'lap',racer,completedLap);
  if(racer.checkpoints>=race.laps*track.gates+1) {
    racer.finishTime=race.time-dt+dt*clamp(toGate/delta,0,1);
    race.firstFinish??=racer.finishTime;if(!racer.bot&&racer.connected)race.firstHumanFinish??=racer.finishTime;event(race,'finish',racer);
  }
}
function placeMagnetic(racer:Racer,track:typeof TRACKS.coast){
  const s=track.magnetic!.from+(racer.loopDistance??0)/track.length,f=surfaceFrame(track,s,racer.loopOffset??0);
  Object.assign(racer,{...f.position,s,heading:Math.atan2(f.forward.x,f.forward.z),airborne:false,verticalSpeed:0,offroad:false,wallTime:0,rampCooldown:1});
}
function move(race: Race,racer: Racer,input: Input,dt: number) {
  const track=TRACKS[race.track],surface=sectorAt(track,racer.s),pace=speedMultiplier(race.speedClass),kart=kartStats(racer.kart),branch=racerRoute(track,racer);
  tickStatuses(racer,dt);
  const stats=statsFor(racer);stats.maxSpeed=Math.max(stats.maxSpeed,racer.speed);if(racer.airborne)stats.airtime+=dt;
  if(input.use&&!racer.lastUse&&racer.stun<=0&&racer.finishTime===null) activateItem(race,racer);
  racer.lastUse=input.use;
  const previousS=racer.s, wasDrifting=racer.driftSide!==0;
  if(input.drift&&Math.abs(input.steer)>.15&&racer.speed>10&&racer.stun<=0&&!racer.offroad&&!racer.airborne) {
    racer.driftSide||=Math.sign(input.steer);racer.drift=Math.min(3.6,racer.drift+dt);
  } else if(!input.drift||racer.speed<8||racer.offroad||racer.stun>0||racer.airborne) {
    if(wasDrifting&&racer.drift>.6&&!racer.offroad&&racer.stun<=0) {racer.boost=Math.max(racer.boost,racer.drift>2.5?2.6:racer.drift>1.5?1.7:.85);statsFor(racer).driftBoosts++;event(race,'boost',racer);}
    racer.drift=0;racer.driftSide=0;
  }
  const skill=racer.bot?({easy:.83,normal:.94,hard:1}[race.difficulty] + (racer.driver%3)*.012):1;
  const maximum=(30+racer.coins*.25)*pace*skill*surface.speed*kart.speed*(branch?.speed??1)*(racer.boost>0?1.55:1)*(racer.star>0?1.4:1)*(racer.offroad&&racer.star<=0?.49:1)*(racer.stun>0?.32:1)*(racer.frost>0?.6:1);
  const height=(s:number)=>branch?routeSample(track,branch,s).y:sample(track,s).y;
  const slope=racer.loopDistance!==undefined?0:(height(racer.s+3/track.length)-height(racer.s-3/track.length))/6;
  const acceleration=(input.throttle?17*kart.acceleration:-7)*pace-(racer.airborne?0:slope*9.8);
  // Item penalties remain immediate; ordinary surface and boost transitions ease out.
  if(racer.stun>0||racer.frost>0)racer.speed=Math.min(racer.speed,maximum);
  const resistance=(racer.offroad&&racer.star<=0?30:12)*pace;
  racer.speed=drivingSpeed(racer.speed,maximum,acceleration-(input.brake?34*pace:0),resistance,dt);
  let location={s:racer.s,offset:0,distance:0};
  if(racer.loopDistance!==undefined&&track.magnetic){
    racer.loopDistance+=racer.speed*dt;
    racer.loopOffset=clamp((racer.loopOffset??0)+input.steer*racer.speed*.55*dt,-track.width/2+1.25,track.width/2-1.25);
    placeMagnetic(racer,track);racer.distance+=racer.speed*dt;
    location={s:racer.s,offset:racer.loopOffset??0,distance:Math.abs(racer.loopOffset??0)};
    if(racer.loopDistance!>=track.magnetic.length){racer.loopDistance=undefined;racer.loopOffset=undefined;}
  }else{
  // Scale yaw with speed to preserve corner radius across engine classes.
  const steering=(1.5*pace/(1+racer.speed/pace*.024))*(racer.driftSide?1.2:1)*surface.grip*kart.handling*(branch?.grip??1)*(racer.airborne?.92*Math.max(1,pace):1);
  racer.heading+=input.steer*steering*dt*clamp(racer.speed/7,0,1)*(racer.stun>0?.3:1)*(racer.oil>0?.55:1);
  const lateralTarget=racer.oil>0?-input.steer*racer.speed*.45:racer.driftSide?-racer.driftSide*racer.speed*.16:0;
  racer.lateral+=(lateralTarget-racer.lateral)*Math.min(1,dt*(racer.oil>0?.8:5));
  racer.x+=(Math.sin(racer.heading)*racer.speed+Math.cos(racer.heading)*racer.lateral)*dt;
  racer.z+=(Math.cos(racer.heading)*racer.speed-Math.sin(racer.heading)*racer.lateral)*dt;
  racer.distance+=racer.speed*dt;
  const magnetic=track.magnetic;
  if(magnetic&&mod(magnetic.from-previousS)*track.length<10&&!racer.airborne){
    const entry=surfaceFrame(track,magnetic.from),dx=racer.x-entry.position.x,dy=racer.y-entry.position.y,dz=racer.z-entry.position.z,along=dx*entry.forward.x+dy*entry.forward.y+dz*entry.forward.z;
    const lane=dx*entry.right.x+dy*entry.right.y+dz*entry.right.z;
    if(along>=0&&Math.abs(lane)<=track.width/2+(track.shoulder??0)&&Math.abs(angleDelta(racer.heading,Math.atan2(entry.forward.x,entry.forward.z)))<1){racer.loopDistance=along;racer.loopOffset=clamp(lane,-track.width/2+1.25,track.width/2-1.25);placeMagnetic(racer,track);}
  }
  const fork=routeLocation(track,racer),roadWidth=fork?.route.width??track.width;
  location=racer.loopDistance!==undefined?{s:racer.s,offset:racer.loopOffset??0,distance:Math.abs(racer.loopOffset??0)}:fork??nearest(track,racer.x,racer.z);racer.s=location.s;racer.offroad=location.distance>roadWidth/2;
  const shoulder=fork?1.5:track.shoulder??5;
  racer.wallTime=location.distance>roadWidth/2+shoulder-.5?racer.wallTime+dt:0;
  if(location.distance>roadWidth/2+16||racer.wallTime>2) {respawn(race,racer);return;}
  // Soft barriers keep a missed bend recoverable without letting it become a shortcut.
  if(location.distance>roadWidth/2+shoulder) {
    location.offset=Math.sign(location.offset)*(roadWidth/2+shoulder);
    const p=fork?routeSample(track,fork.route,location.s,location.offset):sample(track,location.s,location.offset);
    racer.x=p.x;racer.z=p.z;racer.speed*=.96;
  }
  const wasAirborne=racer.airborne;if(racer.loopDistance===undefined)advanceTrackMotion(race,racer,previousS,location.offset,dt);
  if(wasAirborne&&!racer.airborne)event(race,'boost',racer);

  }
  if(!racer.routeId)applyCourseLane(track,racer,location.offset,dt);
  applyRouteZones(race,racer,track,location.offset,dt);
  resolveCourseGates(race,racer,track,previousS);
  advanceCheckpoints(race,racer,previousS,racer.s,location.offset,dt);
  const crossed=(s: number)=>{const delta=mod(racer.s-previousS);return delta<.025&&mod(s-previousS)<=delta;};
  if(!racer.routeId&&!racer.offroad&&racer.finishTime===null&&!racer.airborne) {
    for(const s of track.boxes) if(crossed(s)&&!racer.item&&racer.itemCooldown<=0) {
      racer.item=selectItem(race,racer.rank);racer.itemCooldown=1.5;event(race,'item',racer,undefined,racer.item);
    }
    for(let i=0;i<track.coins.length;i++){const coin=track.coins[i],key=(racer.lap-1)*track.coins.length+i;if(!racer.coinsTaken.includes(key)&&((crossed(coin.s)&&Math.abs(location.offset-coin.offset)<2)||(racer.magnet>0&&(!magneticAt(track,coin.s)&&racer.loopDistance===undefined||Math.abs(angleDelta(coin.s*Math.PI*2,racer.s*Math.PI*2))/(Math.PI*2)*track.length<18)&&Math.hypot(sample(track,coin.s,coin.offset).x-racer.x,sample(track,coin.s,coin.offset).y-racer.y,sample(track,coin.s,coin.offset).z-racer.z)<18))){racer.coinsTaken.push(key);statsFor(racer).coinsCollected++;racer.coins=Math.min(10,racer.coins+1);event(race,'coin',racer);}}
    for(const s of track.boosts) if(crossed(s)&&Math.abs(location.offset)<5) {racer.boost=Math.max(racer.boost,1);event(race,'boost',racer);}
  }
}
export function rankRacers(race: Race) {
  const gates=TRACKS[race.track].gates;
  const progress=(r: Racer)=>r.checkpoints===0?-mod(-r.s)*gates:r.checkpoints+clamp(angleDelta(r.s*Math.PI*2,mod((r.checkpoints-1)/gates)*Math.PI*2)/(Math.PI*2)*gates,-.999,.999);
  [...race.racers].sort((a,b)=>{
    if(a.finishTime!==null||b.finishTime!==null) return (a.finishTime??Infinity)-(b.finishTime??Infinity)||a.id.localeCompare(b.id);
    return progress(b)-progress(a)||a.id.localeCompare(b.id);
  }).forEach((r,i)=>r.rank=i+1);
}
export function stepRace(race: Race,inputs: Record<string,Input>,dt=STEP) {
  if(race.phase==='results') return;
  if(!Number.isFinite(dt)||dt<=0||dt>.05) throw new Error('Simulation step must be between 0 and 50ms');
  if(race.phase==='countdown') {race.countdown=Math.max(0,race.countdown-dt);if(race.countdown<=0) race.phase='racing';return;}
  race.time+=dt;
  for(const racer of race.racers) move(race,racer,racer.bot||!racer.connected||racer.finishTime!==null?botInput(race,racer):sanitizeInput(inputs[racer.id]),dt);
  const obstacles=courseObstacles(TRACKS[race.track],race.time);
  for(const racer of race.racers)if(!racer.routeId)recordContact(race,racer,resolveCourseObstacles(TRACKS[race.track],racer,obstacles));
  for(let i=0;i<race.racers.length;i++) for(let j=i+1;j<race.racers.length;j++) {
    resolveKartContact(race,race.racers[i],race.racers[j]);
  }
  updateHazards(race,dt);rankRacers(race);
  const humans=race.racers.filter(r=>!r.bot);
  if((humans.length>0&&humans.every(r=>r.finishTime!==null))||race.racers.every(r=>r.finishTime!==null)||raceTimeRemaining(race)===0) race.phase='results';
}
