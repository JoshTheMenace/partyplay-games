import {MathUtils} from 'three';
import {angleDelta} from './tracks';
import type {Kart} from './kart';
import type {Racer} from './types';
const poses=new WeakMap<Kart,{heading:number;steering:number}>();
export function animateKart(kart:Kart,racer:Racer,dt:number,time:number){
 const pose=poses.get(kart)??{heading:racer.heading,steering:0};poses.set(kart,pose);
 const turn=dt>0?MathUtils.clamp(angleDelta(racer.heading,pose.heading)/dt*.35,-.4,.4):0;
 pose.heading=racer.heading;pose.steering+=(turn-pose.steering)*(1-Math.exp(-dt*12));
 for(const wheel of kart.frontWheels??[])wheel.rotation.y=pose.steering;
 if(kart.steer)kart.steer.rotation.z=-pose.steering*2;
 if(kart.head){kart.head.rotation.y=pose.steering*.7;kart.head.rotation.x=(racer.airborne?.12:0)+Math.sin(time*3+racer.driver)*.025;}
 const finished=racer.finishTime!=null;
 kart.arms?.forEach((arm,i)=>{arm.rotation.x=finished?-.7+Math.sin(time*7+i)*.15:racer.airborne?-.18:pose.steering*(i?-.4:.4);arm.rotation.z=(i?1:-1)*(finished?1.5+Math.sin(time*6+i)*.2:racer.airborne?.35:0);});
 kart.flame.scale.z=1+Math.sin(time*38)*.13;
}
