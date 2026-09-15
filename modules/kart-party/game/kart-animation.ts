import {MathUtils,Quaternion,Vector3,type Object3D} from 'three';
import {angleDelta} from './tracks';
import type {Kart} from './kart';
import type {Racer} from './types';
const poses=new WeakMap<Kart,{heading:number;steering:number}>();
const UP=new Vector3(0,1,0),Z_AXIS=new Vector3(0,0,1);
export const KART_TIRE_RADIUS=.47;
export const wheelSpinRadians=(distance:number)=>distance/KART_TIRE_RADIUS;
function aimSegment(segment:import('three').Object3D,start:Vector3,end:Vector3,baseLength:number){
 const direction=end.clone().sub(start),length=direction.length();segment.position.copy(start).add(end).multiplyScalar(.5);segment.quaternion.copy(new Quaternion().setFromUnitVectors(UP,direction.normalize()));segment.scale.set(1,length/baseLength,1);
}
export function poseDriverArms(kart:Kart,wheelAngle:number){
 if(!kart.driverArms||!kart.steer)return;
 for(let index=0;index<2;index++){
  const side=index?1:-1,arm=kart.driverArms[index],shoulder=new Vector3(side*.41,1.78,.01);
  const grip=new Vector3(side*.23,0,0).applyAxisAngle(Z_AXIS,wheelAngle).add(kart.steer.position);
  const elbow=shoulder.clone().lerp(grip,.5);elbow.x+=side*.22;elbow.z+=.025;
  aimSegment(arm.upper,shoulder,elbow,.42);aimSegment(arm.forearm,elbow,grip,.40);arm.hand.position.copy(grip);arm.hand.rotation.z=wheelAngle;
 }
}
export const KART_IMPACT_SECONDS=.55;
export type KartImpact={until:number;strength:number};
/** Compose the body pose from its neutral rest every frame so collision shake can never accumulate. Returns whether the impact is still active. */
export function poseKartBody(body:Object3D,racer:Racer,time:number,impact?:KartImpact){
 const remaining=impact?impact.until-time:0,force=impact&&remaining>0?Math.min(1,remaining/KART_IMPACT_SECONDS)*MathUtils.clamp(impact.strength,0,1):0;
 body.position.set(0,Math.sin(time*38+racer.driver)*.22*force,0);
 body.rotation.set(Math.sin(time*31)*.18*force,-racer.driftSide*.15+(racer.stun>0?Math.sin(time*18)*.65:0),-racer.driftSide*.1+Math.sin(time*15+racer.driver)*racer.speed*.0005+Math.cos(time*27+racer.driver)*.12*force);
 return force>0;
}
export function animateKart(kart:Kart,racer:Racer,dt:number,time:number){
 const pose=poses.get(kart)??{heading:racer.heading,steering:0};poses.set(kart,pose);
 const turn=dt>0?MathUtils.clamp(angleDelta(racer.heading,pose.heading)/dt*.35,-.4,.4):0;
 pose.heading=racer.heading;pose.steering+=(turn-pose.steering)*(1-Math.exp(-dt*12));
 for(const wheel of kart.frontWheels??[])wheel.rotation.y=pose.steering;
 const wheelAngle=-pose.steering*2;if(kart.steer)kart.steer.rotation.z=wheelAngle;poseDriverArms(kart,wheelAngle);
 if(kart.head){kart.head.rotation.y=pose.steering*.7;kart.head.rotation.x=(racer.airborne?.12:0)+Math.sin(time*3+racer.driver)*.025;}
 const finished=racer.finishTime!=null;
 kart.arms?.forEach((arm,i)=>{arm.rotation.x=finished?-.7+Math.sin(time*7+i)*.15:racer.airborne?-.18:pose.steering*(i?-.4:.4);arm.rotation.z=(i?1:-1)*(finished?1.5+Math.sin(time*6+i)*.2:racer.airborne?.35:0);});
 kart.flame.scale.z=1+Math.sin(time*38)*.13;
}
