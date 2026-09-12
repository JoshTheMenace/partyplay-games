import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { COAST_DESIGN } from '../src/engine/courses/coast';
import { RAINBOW_DESIGN } from '../src/engine/courses/rainbow';
import type { CourseDesign } from '../src/engine/courses/spec';
import { routeSample } from '../src/engine/course-routes';
import { disposeObject } from '../src/engine/dispose';
import { createRouteVisuals } from '../src/engine/route-visuals';
import { sample, TRACKS } from '../src/engine/tracks';

function scene(design:CourseDesign){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),labels:string[]=[];
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>({fillRect(){},fillText(text:string){labels.push(text);}})})}});
  try{return {...createRouteVisuals(TRACKS[design.id],design),labels};}
  finally{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');}
}
void test('tidal visuals and advance cues follow exact authoritative boundaries without rebuilding textures',()=>{
  const view=scene(COAST_DESIGN),water=view.group.getObjectByName('causeway-surge')!,wet=view.group.getObjectByName('TIDE WET · SLOW')!,dry=view.group.getObjectByName('TIDE DRY · GO')!;
  const count=view.labels.length;
  for(const [time,active] of [[0,true],[5.999,true],[6,false],[19.999,false],[20,true],[28,false]] as const){
    view.update(time);assert.equal(water.visible,active);assert.equal(wet.visible,active);assert.equal(dry.visible,!active);
  }
  assert.equal(view.labels.length,count);
  const sign=view.group.getObjectByName('← TIDAL CAUSEWAY')!;
  assert.ok(sign);const forward=sample(TRACKS.coast,COAST_DESIGN.routes[0].from-18/TRACKS.coast.length).heading;
  assert.ok(new T.Vector3(0,0,1).applyQuaternion(sign.quaternion).dot(new T.Vector3(Math.sin(forward),0,Math.cos(forward)))<-.99);
  const textures=new Set<T.Texture>();view.group.traverse(object=>{if(object instanceof T.Mesh&&object.material.map)textures.add(object.material.map);});
  let disposed=0;for(const texture of textures)texture.addEventListener('dispose',()=>disposed++);
  disposeObject(view.group);assert.equal(disposed,textures.size);
});
void test('the visible gate matches the collision footprint and switches instantly at opening boundaries',()=>{
  const route=COAST_DESIGN.routes[0],gate={id:'test-gate',name:'Test Gate',s:.21,offset:1,width:7,height:3,period:8,openFor:5,phase:1,routeId:route.id,color:'#ffd24a'};
  const view=scene({...COAST_DESIGN,zones:[],gates:[gate]}),panel=view.group.getObjectByName(gate.id) as T.Mesh,p=routeSample(TRACKS.coast,route,gate.s,gate.offset);
  panel.geometry.computeBoundingBox();const size=panel.geometry.boundingBox!.getSize(new T.Vector3());
  assert.deepEqual([size.x,size.y],[gate.width,gate.height]);assert.ok(Math.abs(size.z-1.2)<1e-6);
  assert.equal(panel.position.x,p.x);assert.equal(panel.position.z,p.z);assert.equal(panel.rotation.y,p.heading);
  for(const [time,open] of [[0,true],[3.999,true],[4,false],[6.999,false],[7,true]] as const){
    view.update(time);assert.equal(panel.position.y,p.y+gate.height/2+(open?5.5:0));
    assert.equal(view.group.getObjectByName('GATE CLOSED · BRAKE')!.visible,!open);
    assert.equal(view.group.getObjectByName('GATE OPEN · GO')!.visible,open);
  }
  disposeObject(view.group);
});
void test('wind switches with its zone while permanent conveyors stay visible, and static road is batched',()=>{
  const route=COAST_DESIGN.routes[0],view=scene({...COAST_DESIGN,zones:[
    {id:'wind',name:'Wind',kind:'wind',routeId:route.id,from:.19,to:.22,offset:0,width:9,strength:-3,period:6,activeFor:2},
    {id:'belt',name:'Belt',kind:'conveyor',routeId:route.id,from:.23,to:.25,offset:0,width:9,strength:12},
  ]});
  view.update(2);assert.equal(view.group.getObjectByName('wind')!.visible,false);assert.equal(view.group.getObjectByName('belt')!.visible,true);
  view.update(6);assert.equal(view.group.getObjectByName('wind')!.visible,true);
  let meshes=0;view.group.traverse(object=>{if(object instanceof T.Mesh)meshes++;});assert.ok(meshes<20,`${meshes} meshes must stay within the course budget`);
  disposeObject(view.group);
});
void test('synchronized Rainbow conveyor and wind cues occupy separate rows below the route title',()=>{
  const view=scene(RAINBOW_DESIGN),title=view.group.getObjectByName('← STARWIND ORBIT')!,floor=sample(TRACKS.rainbow,RAINBOW_DESIGN.routes[0].from-18/TRACKS.rainbow.length).y;
  for(const [time,names] of [[0,['SURFACE ACTIVE','GUST · STEER INTO WIND']],[2.5,['SURFACE CLEAR','WIND CALM']]] as const){
    view.update(time);const signs=[...names.map(name=>view.group.getObjectByName(name)!),title];
    assert.ok(signs.every(sign=>sign.visible));
    for(let i=0;i<signs.length;i++)for(let j=i+1;j<signs.length;j++)assert.ok(!new T.Box3().setFromObject(signs[i]).intersectsBox(new T.Box3().setFromObject(signs[j])));
    assert.ok(signs.slice(0,2).every(sign=>sign.position.y<title.position.y));
    assert.ok(signs.every(sign=>new T.Box3().setFromObject(sign).min.y>floor+4));
  }
  disposeObject(view.group);
});
