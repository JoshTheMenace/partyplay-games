import test from 'node:test';
import assert from 'node:assert/strict';
import { InstancedMesh, Matrix4, Mesh, Raycaster, ShaderMaterial, Vector3 } from 'three';
import { createRainbowWorld } from '../game/rainbow-world';
import { botInput, createRace, stepRace, STEP } from '../game/simulation';
import { advanceTrackMotion } from '../game/track-physics';
import { nearest, roadHeight, sample, surfaceFrame, TRACKS } from '../game/tracks';
import { NEUTRAL } from '../game/types';

const track=TRACKS.rainbow;
for(const ramp of track.ramps)for(const offset of [-ramp.width/2+1,ramp.width/2-1])void test(`Rainbow ramp ${ramp.s} takes off continuously at banked lane ${offset}`,()=>{
  const race=createRace({track:'rainbow',players:[]}),r=race.racers[0],lip=ramp.s+ramp.length/track.length,previous=lip-.1/track.length;
  Object.assign(r,{s:lip+.1/track.length,y:roadHeight(track,previous,offset),speed:32});
  advanceTrackMotion(race,r,previous,offset,STEP);
  assert.equal(r.airborne,true);
  assert.ok(Math.abs(r.y-r.verticalSpeed*STEP-(sample(track,lip,offset).y+ramp.height))<.06,'takeoff must use the banked lane height, not the centerline');
});
void test('Rainbow rendered ramp surfaces match collision heights across both banks',()=>{
  const world=createRainbowWorld();world.group.updateMatrixWorld(true);
  try{
    const ramps=world.group.children.filter((o):o is Mesh=>o instanceof Mesh&&o.material instanceof ShaderMaterial&&!!o.material.uniforms.time&&!o.material.transparent&&o.name!=='prismatic-road');
    assert.equal(ramps.length,track.ramps.length);
    const ray=new Raycaster();ray.far=12;
    for(const ramp of track.ramps)for(const progress of [.1,.3,.5,.7,.9])for(const offset of [-ramp.width/2+1,0,ramp.width/2-1]){
      const s=ramp.s+ramp.length*progress/track.length,p=sample(track,s,offset),height=roadHeight(track,s,offset)+.1;
      ray.set(new Vector3(p.x,height+5,p.z),new Vector3(0,-1,0));
      const hit=ray.intersectObjects(ramps)[0];assert.ok(hit,'ramp must cover the driving lane');
      assert.ok(Math.abs(hit.point.y-height)<.04,`ramp ${ramp.s}, lane ${offset} differs from collision surface`);
    }
  }finally{world.dispose();}
});
void test('Rainbow banked guardrail contact leaves the kart on its corrected road position',()=>{
  const race=createRace({track:'rainbow',speedClass:150,players:[{id:'h',name:'Human',driver:0}]}),r=race.racers[0],s=.22,edge=track.width/2+track.shoulder!,p=sample(track,s,edge-.01);
  race.phase='racing';race.racers=[r];Object.assign(r,{x:p.x,z:p.z,y:p.y,s,heading:p.heading+Math.PI/2,speed:70,star:2,boost:2,checkpoints:9});
  stepRace(race,{h:{...NEUTRAL,throttle:true}});
  const location=nearest(track,r.x,r.z);
  assert.ok(location.distance<=edge+.04,'guardrail must stop outward motion');
  assert.ok(Math.abs(r.y-roadHeight(track,location.s,location.offset))<.04,'height must use the position after guardrail correction');
});
void test('Rainbow grants one landing boost for a completed jump',()=>{
  const race=createRace({track:'rainbow',players:[{id:'h',name:'Human',driver:0}]}),r=race.racers[0],ramp=track.ramps[1],p=sample(track,ramp.s-3/track.length);
  race.phase='racing';race.racers=[r];Object.assign(r,{x:p.x,z:p.z,y:p.y,s:p.s,heading:p.heading,speed:30,checkpoints:Math.floor(p.s*track.gates)+1});
  let launched=false,landed=false;
  for(let i=0;i<600;i++){stepRace(race,{h:{...botInput(race,r),use:false}});if(r.airborne)launched=true;else if(launched){landed=true;break;}}
  assert.ok(launched&&landed);assert.ok(r.boost>0);
  for(let i=0;i<5;i++)stepRace(race,{h:{...botInput(race,r),use:false}});
  assert.equal(race.events.filter(event=>event.type==='boost'&&event.racer===r.id).length,1);
});
void test('Rainbow instanced coins retain bank height and independent split-screen collection visibility',()=>{
  const world=createRainbowWorld(),race=createRace({track:'rainbow',players:[]}),a=race.racers[0],b=race.racers[1];
  try{
    let coins:InstancedMesh|undefined;world.group.getObjectByName('field_coin-instances')?.traverse(object=>{if(!coins&&object instanceof InstancedMesh)coins=object;});
    assert.ok(coins);const coinInstances=coins,matrix=new Matrix4(),position=new Vector3(),scale=new Vector3();
    a.coinsTaken=[0];world.prepareView!(a);coinInstances.getMatrixAt(0,matrix);scale.setFromMatrixScale(matrix);assert.equal(scale.length(),0);
    world.prepareView!(b);coinInstances.getMatrixAt(0,matrix);scale.setFromMatrixScale(matrix);assert.ok(Math.abs(scale.length()-Math.sqrt(3))<1e-6);
    track.coins.forEach((coin,i)=>{coinInstances.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);const f=surfaceFrame(track,coin.s,coin.offset,1.5).position;assert.ok(position.distanceTo(new Vector3(f.x,f.y,f.z))<.001);});
  }finally{world.dispose();}
});
