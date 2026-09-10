import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Hazard, Racer } from './types';

const paint=(color:string)=>new T.MeshStandardMaterial({color,roughness:.32,metalness:.18});
const glow=(color:string,opacity=.65)=>new T.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,blending:T.AdditiveBlending});
function part(group:T.Group,geometry:T.BufferGeometry,material:T.Material,x=0,y=0,z=0) {
  const mesh=new T.Mesh(geometry,material);mesh.position.set(x,y,z);group.add(mesh);return mesh;
}
function orb(group:T.Group,material:T.Material,x:number,y:number,z:number,sx:number,sy=sx,sz=sx) {
  const mesh=part(group,new T.SphereGeometry(1,12,8),material,x,y,z);mesh.scale.set(sx,sy,sz);return mesh;
}
function ring(group:T.Group,material:T.Material,radius:number,y:number,tube=.045) {
  const mesh=part(group,new T.TorusGeometry(radius,tube,6,40),material,0,y);mesh.rotation.x=Math.PI/2;return mesh;
}
// Merge stationary details by material so decorated hazards stay cheap to draw.
function bake(group:T.Group) {
  const batches=new Map<T.Material,T.BufferGeometry[]>();
  for(const child of group.children.filter((object):object is T.Mesh=>object instanceof T.Mesh)) {
    child.updateMatrix();const geometry=(child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone()).applyMatrix4(child.matrix);
    const material=child.material as T.Material,list=batches.get(material)??[];list.push(geometry);batches.set(material,list);
    group.remove(child);child.geometry.dispose();
  }
  for(const [material,geometries] of batches) {
    const merged=mergeGeometries(geometries,false)!;for(const geometry of geometries) geometry.dispose();
    const mesh=part(group,merged,material);mesh.castShadow=!material.transparent;
  }
}
function starShape() {
  const shape=new T.Shape();for(let i=0;i<10;i++){const angle=i*Math.PI/5,r=i%2?.18:.4,x=Math.sin(angle)*r,y=Math.cos(angle)*r;if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);}shape.closePath();
  return new T.ExtrudeGeometry(shape,{depth:.08,bevelEnabled:false});
}
export function createHazardVisual(h:Hazard):T.Group {
  const group=new T.Group(),model=new T.Group();group.add(model);group.name=`hazard-${h.kind}`;
  model.position.y=h.kind==='shell'||h.kind==='frost'?.7:.2;
  if(h.kind==='shell') {
    const green=paint('#83e951'),dark=paint('#214945'),gold=paint('#edff99'),white=paint('#ffffff');
    orb(model,green,0,0,0,.78,.5,.95);orb(model,dark,0,-.17,0,.82,.18,.95);
    part(model,new T.BoxGeometry(.07,.08,1.3),gold,0,.45,-.07);
    orb(model,dark,0,.05,.76,.42,.3,.35);
    for(const side of [-1,1]) {
      orb(model,white,side*.2,.23,1,.13);orb(model,dark,side*.2,.24,1.1,.06);
      for(let i=0;i<3;i++) {const leg=part(model,new T.CapsuleGeometry(.055,.45,2,5),dark,side*.75,-.16,(i-1)*.52);leg.rotation.z=side*1.1;}
    }
  } else if(h.kind==='banana') {
    const yellow=paint('#ffe055'),cream=paint('#fff4b0'),brown=paint('#895c35');
    const peel=new T.Shape();peel.moveTo(0,1);peel.quadraticCurveTo(.3,.17,1.45,0);peel.quadraticCurveTo(.95,.58,.12,1.25);peel.closePath();
    for(let i=0;i<3;i++) {
      const leaf=part(model,new T.ExtrudeGeometry(peel,{depth:.18,bevelEnabled:true,bevelSize:.045,bevelThickness:.035,bevelSegments:1,steps:1,curveSegments:8}),yellow);leaf.rotation.y=i*Math.PI*2/3;
      const inner=part(model,new T.ConeGeometry(.14,.65,6),cream,Math.sin(i*Math.PI*2/3)*.17,.85,Math.cos(i*Math.PI*2/3)*.17);inner.rotation.z=.2;
    }
    part(model,new T.CylinderGeometry(.1,.13,.22,6),brown,0,1.28);
  } else if(h.kind==='oil') {
    const jelly=new T.MeshStandardMaterial({color:'#6c388f',roughness:.12,metalness:.35,transparent:true,opacity:.72,depthWrite:false});
    orb(model,jelly,0,-.09,0,5,.09,5);
    const sheen=glow('#c798ff',.38);ring(model,sheen,4.7,-.01,.065);ring(model,sheen,2.8,.01,.04);
    for(let i=0;i<3;i++) orb(model,sheen,Math.cos(i*2.1)*2.1,.05,Math.sin(i*2.1)*2.1,.4,.035,.2);
  } else if(h.kind==='frost') {
    const ice=new T.MeshStandardMaterial({color:'#83dcff',roughness:.08,metalness:.15,transparent:true,opacity:.68,depthWrite:false});
    orb(model,ice,0,0,0,.72);const white=glow('#e1ffff',.95);
    for(let i=0;i<6;i++) {
      const angle=i*Math.PI/3,arm=part(model,new T.CylinderGeometry(.055,.055,1.1,5),white,Math.sin(angle)*.4,Math.cos(angle)*.4,.45);arm.rotation.z=-angle;
      part(model,new T.OctahedronGeometry(.15),white,Math.sin(angle)*.87,Math.cos(angle)*.87,.45);
    }
  } else if(h.kind==='rocket') {
    const red=paint('#ff6960'),white=paint('#fff3cd'),dark=paint('#3c405e');
    const body=part(model,new T.CylinderGeometry(.32,.35,1.3,12),white,0,.65);body.rotation.x=Math.PI/2;
    const nose=part(model,new T.ConeGeometry(.34,.7,12),red,0,.65,1);nose.rotation.x=Math.PI/2;
    const nozzle=part(model,new T.CylinderGeometry(.24,.3,.28,10),dark,0,.65,-.72);nozzle.rotation.x=Math.PI/2;
    for(let i=0;i<4;i++) {const angle=i*Math.PI/2,fin=part(model,new T.BoxGeometry(.1,.42,.62),red,Math.sin(angle)*.38,.65+Math.cos(angle)*.38,-.43);fin.rotation.z=-angle;}
    const flame=part(model,new T.ConeGeometry(.25,.95,8),glow('#ffcf67',.95),0,.65,-1.2);flame.rotation.x=-Math.PI/2;
  } else {
    const pink=paint('#f966ce'),cream=paint('#ffefd6'),purple=paint('#793c8f');
    part(model,new T.BoxGeometry(1.55,1.55,1.55),pink,0,.78);
    part(model,new T.BoxGeometry(1.7,.2,1.7),purple,0,1.52);
    part(model,new T.BoxGeometry(.23,1.58,1.58),cream,0,.79);
    part(model,new T.BoxGeometry(1.58,1.58,.23),cream,0,.79);
    for(const side of [-1,1]) {const bow=part(model,new T.TorusGeometry(.28,.065,6,16),cream,side*.27,1.77);bow.scale.set(1,.65,1);bow.rotation.z=side*.4;}
    // A raised question mark on both faces distinguishes the fake pickup at racing speed.
    for(const side of [-1,1]) {
      const mark=part(model,new T.TorusGeometry(.23,.075,6,16,Math.PI*1.55),purple,0,1.06,side*.805);mark.rotation.z=-.25;
      part(model,new T.BoxGeometry(.12,.18,.07),purple,-.04,.75,side*.805);orb(model,purple,-.04,.5,side*.815,.075);
    }
  }
  bake(model);return group;
}
export function updateHazardVisual(group:T.Group,h:Hazard,time:number):void {
  group.rotation.y=h.heading;const model=group.children[0];
  if(h.kind==='frost') {model.rotation.z=time*2.2;model.position.y=.7+Math.sin(time*5+h.id)*.08;}
  else if(h.kind==='shell') model.rotation.z=Math.sin(time*16+h.id)*.06;
  else if(h.kind==='rocket') model.scale.set(1,1,1+Math.sin(time*30)*.035);
  else if(h.kind==='decoy') model.rotation.y=Math.sin(time*2+h.id)*.08;
  else if(h.kind==='oil') model.rotation.y=time*.12;
  group.visible=h.life>1||Math.sin(time*20)>-.25;
}
export function createRacerEffects():T.Group {
  const group=new T.Group();group.name='item-effects';
  for(const name of ['star','magnet','frost','oil']) {const effect=new T.Group();effect.name=name;effect.visible=false;group.add(effect);}
  const [star,magnet,frost,oil]=group.children as T.Group[];
  const gold=glow('#fff29a',.9);ring(star,gold,2.25,1.1,.065);ring(star,glow('#fffbd8',.35),2.05,.25,.09);
  for(let i=0;i<4;i++) {const angle=i*Math.PI/2,mesh=part(star,starShape(),gold,Math.sin(angle)*2.25,1.15,Math.cos(angle)*2.25);mesh.rotation.y=angle;}
  const pink=glow('#ff9acb',.65);for(let i=0;i<2;i++) {const mesh=ring(magnet,pink,2.4-i*.3,.7+i*.8,.06);mesh.rotation.z=(i?1:-1)*.25;}
  const ice=glow('#b2f1ff',.75);ring(frost,ice,1.7,.65,.04);
  for(let i=0;i<6;i++) {const angle=i*Math.PI/3,mesh=part(frost,new T.OctahedronGeometry(.3),ice,Math.sin(angle)*1.75,.8+(i%2)*.7,Math.cos(angle)*1.75);mesh.scale.y=1.7;}
  const purple=new T.MeshBasicMaterial({color:'#b979e9',transparent:true,opacity:.45,depthWrite:false});
  orb(oil,purple,0,.08,0,1.65,.035,2.2);ring(oil,glow('#e0a7ff',.65),1.6,.11,.07);
  for(const effect of [star,magnet,frost,oil]) bake(effect);
  return group;
}
export function updateRacerEffects(group:T.Group,r:Racer,time:number):void {
  const [star,magnet,frost,oil]=group.children;
  for(const effect of group.children) effect.visible=r.finishTime===null&&r[effect.name as 'star'|'magnet'|'frost'|'oil']>0;
  star.rotation.y=time*2;star.position.y=Math.sin(time*4)*.12;
  magnet.rotation.y=-time*1.6;magnet.scale.setScalar(1+Math.sin(time*5)*.08);
  frost.rotation.y=time*.6;oil.rotation.y=Math.sin(time*7)*.15;
}
