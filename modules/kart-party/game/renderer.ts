import * as T from 'three';
import { GROUND_PALETTES } from './ground-atmosphere';
import { fadeNearCamera } from './camera-visibility';
import { disposeObject } from './dispose';
import { createHazardVisual, updateHazardVisual, updateRacerEffects } from './item-visuals';
import { createWorld, type World } from './world';
import { DRIVERS, MAX_PLAYERS, type HitEffect, type Race, type Racer, type TrackId } from './types';
import { angleDelta, bankAt, groundHeight, nearest, rampAt, roadHeight, sample, surfaceFrame, magneticAt } from './tracks';

import { viewportRect } from './split-screen';
import { loopCamera } from './vertical-loop';
import { animateKart, KART_IMPACT_SECONDS, poseKartBody, wheelSpinRadians } from './kart-animation';
import { createKart, type Kart } from './kart';
import { createHeldPowerupModel } from './powerup-models';
import { itemRoulette } from './item-roulette';
export type RenderFrame={race:Race|null;track:TrackId;playerIds:string[];localPlayerId?:string;personalView?:boolean;quality:'high'|'performance';paused:boolean;touchControls?:boolean;interpolated?:boolean;snappedIds?:string[];qualityTier?:number};
/* Automatic quality tiers for phones: 0 is the configured quality; each tier lowers backing resolution and
 * decorative particle volume. Artwork, camera framing, hazards and gameplay cues are never tiered. */
export const KART_QUALITY_TIERS=3;
const pixelRatioFor=(quality:string,tier:number)=>(quality==='high'?[1.75,1.25,1]:[1,.85,.7])[tier];
export function createRenderer(container:HTMLElement,onError:(message:string)=>void) {
  let renderer:T.WebGLRenderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});}catch{onError('This browser could not start 3D graphics. Try a browser with WebGL enabled.');return null;}
  renderer.info.autoReset=false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;container.appendChild(renderer.domElement);
  renderer.domElement.style.cssText='width:100%;height:100%;display:block';
  const scene=new T.Scene(),ambient=new T.HemisphereLight('#e4f7ff','#69734b',2.4);scene.add(ambient);
  const sun=new T.DirectionalLight('#fff3d6',3.1);sun.position.set(-80,130,-50);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-55,right:55,top:55,bottom:-55,near:1,far:350});sun.shadow.bias=-.001;sun.shadow.normalBias=.1;scene.add(sun,sun.target);
  const cameras=Array.from({length:MAX_PLAYERS},()=>new T.PerspectiveCamera(60,1,.1,2500));
  // Per-frame scratch objects. Every use copies or consumes the value before the next overwrites it.
  const scratch=new T.Vector3(),cameraTarget=new T.Vector3(),axisX=new T.Vector3(),axisY=new T.Vector3(),axisZ=new T.Vector3(),basisMatrix=new T.Matrix4(),sparkColor=new T.Color();
  const frameBasis=(f:ReturnType<typeof surfaceFrame>)=>basisMatrix.makeBasis(axisX.set(f.right.x,f.right.y,f.right.z),axisY.set(f.up.x,f.up.y,f.up.z),axisZ.set(f.forward.x,f.forward.y,f.forward.z));
  let world:World|null=null,currentTrack:TrackId|null=null,quality='high',qualityTier=0,width=0,height=0,disposed=false,frameCount=0;
  const karts=new Map<string,Kart>(),hazards=new Map<number,T.Group>(),impacts=new Map<string,{until:number;effect:HitEffect|'contact';strength:number}>();
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PARTICLES=360,particlePositions=new Float32Array(PARTICLES*3),particleColors=new Float32Array(PARTICLES*3),particleLives=new Float32Array(PARTICLES),particleVelocities=new Float32Array(PARTICLES*3);
  const particleGeometry=new T.BufferGeometry();particleGeometry.setAttribute('position',new T.BufferAttribute(particlePositions,3));particleGeometry.setAttribute('color',new T.BufferAttribute(particleColors,3));
  const sparks=new T.Points(particleGeometry,new T.PointsMaterial({size:.23,vertexColors:true,transparent:true,opacity:.85,depthWrite:false}));sparks.frustumCulled=false;scene.add(sparks);let particleCursor=0;
  const contextLost=(e:Event)=>{e.preventDefault();onError('Graphics were interrupted. Reload the page to restore the race view; your room seat is saved.');};renderer.domElement.addEventListener('webglcontextlost',contextLost);
  const resize=()=>{width=container.clientWidth;height=container.clientHeight;if(width&&height)renderer.setSize(width,height,false);};
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  function changeTrack(id:TrackId) {
    if(currentTrack===id)return;
    if(world){scene.remove(world.group);world.dispose();}
    world=createWorld(id);currentTrack=id;scene.add(world.group);
    const palette=id==='rainbow'?null:GROUND_PALETTES[id],sky=palette?.fog??world.track.sky;
    ambient.color.set(palette?.ambient??'#e4f7ff');ambient.groundColor.set(palette?.ground??'#69734b');
    scene.background=new T.Color(sky);scene.fog=id==='rainbow'?null:new T.Fog(sky,id==='midnight'?190:280,id==='midnight'?900:1200);
    ambient.intensity=id==='rainbow'?2:id==='midnight'?1.4:1.5;sun.intensity=id==='rainbow'?2.4:id==='midnight'?1.1:2;sun.color.set(id==='midnight'?'#a9c4ff':id==='rainbow'?'#e8ddff':'#fff3d6');
    for(const camera of cameras)camera.position.set(0,30,0);
  }
  function updateKart(kart:Kart,r:Racer,dt:number,race:Race|null,interpolated=false) {
    const p=sample(world!.track,r.s),kartHeight=r.y??p.y,distance=kart.group.position.distanceTo(scratch.set(r.x,kartHeight,r.z));
    const alpha=interpolated||distance>20?1:1-Math.exp(-dt*18);
    kart.group.position.lerp(scratch.set(r.x,kartHeight+.09,r.z),alpha);
    if(magneticAt(world!.track,r.s)){
      kart.group.quaternion.setFromRotationMatrix(frameBasis(surfaceFrame(world!.track,r.s)));
    }else{
    const ramp=rampAt(world!.track,r.s,nearest(world!.track,r.x,r.z).offset);
    const slope=(ramp?1.2*ramp.height/ramp.length:0)+(sample(world!.track,r.s+2/world!.track.length).y-sample(world!.track,r.s-2/world!.track.length).y)/4;
    kart.group.rotation.x+=((-Math.atan(r.airborne?r.verticalSpeed/Math.max(10,r.speed):slope))-kart.group.rotation.x)*alpha;
    kart.group.rotation.y+=angleDelta(r.heading,kart.group.rotation.y)*alpha;
    kart.group.rotation.z+=((r.airborne?0:bankAt(world!.track,r.s))-kart.group.rotation.z)*alpha;
    }
    const held=race&&itemRoulette(race,r).active?null:r.item;
    if(kart.heldItemId!==held){
      while(kart.heldItem.children.length){const child=kart.heldItem.children[0];kart.heldItem.remove(child);disposeObject(child);}
      const model=held?createHeldPowerupModel(held):null;if(model)kart.heldItem.add(model);kart.heldItemId=held;
    }
    kart.heldItem.position.y=4.15+Math.sin(raceTime*2+r.driver)*.1;kart.heldItem.rotation.y=raceTime*.72+r.driver*.35;
    for(const wheel of kart.wheels)wheel.rotation.x=(wheel.rotation.x+wheelSpinRadians(r.speed*dt))%(Math.PI*2);
    updateRacerEffects(kart.effects,r,raceTime);kart.shadow.visible=!r.airborne;
    kart.shield.visible=r.shield>0;kart.shield.rotation.y+=dt;kart.flame.visible=r.boost>0;animateKart(kart,r,dt,raceTime);
    if(!poseKartBody(kart.body,r,raceTime,impacts.get(r.id)))impacts.delete(r.id);
    if((r.drift>.2||r.boost>0)&&frameCount%(2+qualityTier)===0) {
      const color=sparkColor.set(r.boost>0?'#6feaff':r.drift>2.5?'#c691ff':r.drift>1.5?'#ffac40':'#6ee6ff');
      for(const side of [-1,1]){const i=particleCursor++%PARTICLES;particlePositions.set([r.x-Math.sin(r.heading)*1.1+Math.cos(r.heading)*side,r.boost>0?kartHeight+.8:p.y+.3,r.z-Math.cos(r.heading)*1.1-Math.sin(r.heading)*side],i*3);particleColors.set([color.r,color.g,color.b],i*3);particleLives[i]=.5;particleVelocities.set([0,.4,0],i*3);}
    }
  }
  let raceTime=0,lastEvent=0,lastRaceTime=0;
  function render(frame:RenderFrame,dt:number,time:number) {
    if(disposed||!width||!height)return false;
    renderer.info.reset();
    changeTrack(frame.race?.track??frame.track);frameCount++;raceTime=frame.race?.time??time;
    world!.update?.(time);
    const effectiveQuality=frame.playerIds.length>4?'performance':frame.quality,tier=Math.max(0,Math.min(KART_QUALITY_TIERS-1,Math.floor(frame.qualityTier??0)));
    if(effectiveQuality!==quality||tier!==qualityTier){quality=effectiveQuality;qualityTier=tier;renderer.setPixelRatio(Math.min(window.devicePixelRatio,pixelRatioFor(quality,tier)));renderer.shadowMap.enabled=quality==='high'&&tier===0;resize();}
    const race=frame.race;
    const racers=race?.racers??DRIVERS.slice(0,4).map((d,i)=>{const p=sample(world!.track,time*.008+i*.002,(i%2?1:-1)*3);return {id:`demo-${i}`,driver:i,x:p.x,z:p.z,s:p.s,heading:p.heading,speed:23,drift:0,driftSide:0,stun:0,shield:0,boost:i===0?1:0} as Racer;});
    const visibleIds=new Set(racers.map(r=>r.id));
    for(const [id,kart]of karts)if(!visibleIds.has(id)){scene.remove(kart.group);disposeObject(kart.group);karts.delete(id);}
    for(const r of racers){let kart=karts.get(r.id);if(!kart||kart.driver!==r.driver){if(kart){scene.remove(kart.group);disposeObject(kart.group);}kart=createKart(r.driver);karts.set(r.id,kart);scene.add(kart.group);kart.group.position.set(r.x,sample(world!.track,r.s).y,r.z);kart.group.rotation.y=r.heading;}kart.group.visible=true;if(frame.snappedIds?.includes(r.id))impacts.delete(r.id);updateKart(kart,r,dt,race,frame.interpolated);}
    for(const item of world!.boxes){item.rotation.y=time*1.1;const b=item.children[0];b.rotation.z=Math.PI/4;b.rotation.x=Math.sin(time)*.13;b.position.y=Math.sin(time*2+item.position.x)*.25;}
    for(const obj of world!.animated)obj.rotation.z+=dt*(obj.userData.spin??(obj instanceof T.Group?.6:1.2));
    if(!race||race.time<lastRaceTime||race.phase==='countdown'){lastEvent=0;impacts.clear();}
    lastRaceTime=race?.time??0;
    for(const event of race?.events??[])if(event.id>lastEvent){
      lastEvent=event.id;const r=racers.find(r=>r.id===event.racer);if(!r||raceTime-event.time>.4)continue;
      if(event.type==='hit'||event.type==='contact'){const effect=event.type==='contact'?'contact':event.effect??'stun',strength=event.type==='contact'?Math.max(.35,event.intensity??.5):1;impacts.set(r.id,{until:raceTime+KART_IMPACT_SECONDS,effect,strength});if(event.racer===frame.localPlayerId&&navigator.vibrate)navigator.vibrate(event.type==='contact'?[Math.round(18+strength*34)]:effect==='shield'?[30]:[45,25,70]);}
      const count=Math.ceil((event.type==='finish'?48:event.type==='hit'?34:event.type==='contact'?Math.round(12+18*(event.intensity??.5)):10)/(1+qualityTier));
      for(let j=0;j<count;j++){const i=particleCursor++%PARTICLES,a=j*2.39996,hitColor=event.effect==='frost'?'#b8f5ff':event.effect==='oil'?'#c087ff':event.effect==='shield'?'#78efff':event.effect==='decoy'?'#ff83e2':j%3===0?'#ffd24a':'#ff5748',eventColor=sparkColor.set(event.type==='coin'?'#ffd24a':event.type==='contact'?(j%3===0?'#fff6e5':'#ffae45'):event.type==='hit'?hitColor:'#71efff');if(event.type==='finish')eventColor.setHSL(j/count,.9,.65);
        particlePositions.set([r.x,(r.y??sample(world!.track,r.s).y)+1.2,r.z],i*3);particleColors.set([eventColor.r,eventColor.g,eventColor.b],i*3);particleVelocities.set([Math.cos(a)*(event.type==='hit'?5:event.type==='contact'?4:3),1.5+j%5,Math.sin(a)*(event.type==='hit'?5:event.type==='contact'?4:3)],i*3);particleLives[i]=event.type==='finish'?1.4:event.type==='hit'?1:event.type==='contact'?.55:.7;
      }
    }
    for(let i=0;i<PARTICLES;i++){particleLives[i]-=dt;if(particleLives[i]<=0)particlePositions[i*3+1]=-100;else{for(let axis=0;axis<3;axis++)particlePositions[i*3+axis]+=particleVelocities[i*3+axis]*dt;particleVelocities[i*3+1]-=dt*4.5;}}
    particleGeometry.attributes.position.needsUpdate=true;particleGeometry.attributes.color.needsUpdate=true;
    const hazardIds=new Set(race?.hazards.map(h=>h.id));
    for(const [id,mesh]of hazards)if(!hazardIds.has(id)){scene.remove(mesh);disposeObject(mesh);hazards.delete(id);}
    for(const h of race?.hazards??[]){let mesh=hazards.get(h.id);if(!mesh){mesh=createHazardVisual(h);hazards.set(h.id,mesh);scene.add(mesh);}mesh.position.set(h.x,nearestHeight(h.x,h.z),h.z);updateHazardVisual(mesh,h,time);if(h.s!==undefined){const f=surfaceFrame(world!.track,h.s,h.offset??0,.6);mesh.position.set(f.position.x,f.position.y,f.position.z);mesh.quaternion.setFromRotationMatrix(frameBasis(f));}}
    let followed=(frame.personalView&&frame.localPlayerId?[racers.find(r=>r.id===frame.localPlayerId)]:frame.playerIds.map(id=>racers.find(r=>r.id===id))).filter((r):r is Racer=>!!r).slice(0,MAX_PLAYERS);
    if(!followed.length)followed=[racers[0]];
    const count=race?followed.length:1;
    const main=followed[0],mainHeight=main.y??sample(world!.track,main.s).y;sun.position.set(main.x-65,125+mainHeight,main.z-70);sun.target.position.set(main.x,mainHeight,main.z);sun.target.updateMatrixWorld();
    renderer.setScissorTest(false);renderer.clear();renderer.setScissorTest(true);
    for(let i=0;i<count;i++) {
      const rect=viewportRect(count,i),w=width*rect.width,h=height*rect.height,x=width*rect.x,y=height*(1-rect.y-rect.height),r=followed[i],camera=cameras[i];
      const magnetic=magneticAt(world!.track,r.s);
      if(!magnetic)camera.up.set(0,1,0);
      const p=sample(world!.track,r.s),kartHeight=r.y??p.y,angle=r.heading;
      const target=race?cameraTarget.set(r.x-Math.sin(angle)*(9+r.speed*.055),kartHeight+5.3,r.z-Math.cos(angle)*(9+r.speed*.055)):cameraTarget.set(r.x-Math.sin(angle-.6)*23,p.y+12,r.z-Math.cos(angle-.6)*23);
      if(magnetic){
        const pose=loopCamera(surfaceFrame(world!.track,r.s,r.loopOffset??0),r.speed,frame.touchControls??container.dataset.touch==='true');
        target.set(pose.position.x,pose.position.y,pose.position.z);camera.up.set(pose.up.x,pose.up.y,pose.up.z);
        // Stay in the local road frame through inversion; world-Y floor clamps
        // otherwise throw the camera onto the opposite branch of the loop.
        camera.position.copy(target);camera.lookAt(pose.target.x,pose.target.y,pose.target.z);
      }else{
      target.y=Math.max(target.y,cameraFloor(target.x,target.z));
      if(frame.snappedIds?.includes(r.id))camera.position.copy(target);else camera.position.lerp(target,1-Math.exp(-dt*(race?7:2)));
      camera.position.y=Math.max(camera.position.y,cameraFloor(camera.position.x,camera.position.z));
      // Lift the chase view over a crest between the camera and kart, not just under the camera itself.
      if(race)for(const t of [.2,.4,.6,.8]) {
        const floor=cameraFloor(T.MathUtils.lerp(camera.position.x,r.x,t),T.MathUtils.lerp(camera.position.z,r.z,t))-2;
        camera.position.y=Math.max(camera.position.y,(floor-(kartHeight+1.6)*t)/(1-t));
      }
      const lookAhead=(frame.touchControls??container.dataset.touch==='true')?2:8;
      camera.lookAt(r.x+Math.sin(angle)*lookAhead,kartHeight+1.6,r.z+Math.cos(angle)*lookAhead);
      }
      camera.fov=(race?60:48)+(r.boost>0?6:0);camera.far=world!.track.id==='rainbow'?6000:2500;camera.aspect=w/h;camera.updateProjectionMatrix();
      const impact=impacts.get(r.id);if(impact&&impact.until>raceTime&&!reducedMotion){const force=Math.min(1,(impact.until-raceTime)/KART_IMPACT_SECONDS)*Math.min(1,impact.strength);camera.translateX(Math.sin(raceTime*53+r.driver)*.28*force);camera.translateY(Math.cos(raceTime*41+r.driver)*.16*force);}
      renderer.setViewport(x,y,w,h);renderer.setScissor(x,y,w,h);world!.coins.forEach((coin,index)=>{coin.visible=!r.coinsTaken?.includes((r.lap-1)*world!.track.coins.length+index);});world!.prepareView?.(r);for(const [id,kart]of karts)fadeNearCamera(kart,camera,id===r.id);renderer.render(scene,camera);
    }
    // Three players use the fourth quadrant for an overhead course view.
    if(count===3){const camera=cameras[3];camera.position.set(0,world!.track.id==='rainbow'?1750:1050,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);camera.aspect=width/height;camera.fov=55;camera.updateProjectionMatrix();renderer.setViewport(width/2,0,width/2,height/2);renderer.setScissor(width/2,0,width/2,height/2);world!.coins.forEach(coin=>{coin.visible=true;});world!.prepareView?.();for(const kart of karts.values())fadeNearCamera(kart,camera,true);const fog=scene.fog;scene.fog=null;renderer.render(scene,camera);scene.fog=fog;}
    renderer.setScissorTest(false);return true;
  }
  function nearestHeight(x:number,z:number){const p=nearest(world!.track,x,z);return roadHeight(world!.track,p.s,p.offset);}
  function cameraFloor(x:number,z:number){const p=nearest(world!.track,x,z);return Math.max(groundHeight(world!.track,x,z,p)+3,p.distance<world!.track.width/2+3?roadHeight(world!.track,p.s,p.offset)+3:-Infinity);}
  return {render,metrics(){const {render:draw,memory}=renderer.info;return {calls:draw.calls,triangles:draw.triangles,geometries:memory.geometries,textures:memory.textures,pixelRatio:renderer.getPixelRatio()};},dispose(){disposed=true;observer.disconnect();renderer.domElement.removeEventListener('webglcontextlost',contextLost);disposeObject(scene);sun.shadow.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
