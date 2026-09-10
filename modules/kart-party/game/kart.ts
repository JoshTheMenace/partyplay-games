import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRacerEffects } from './item-visuals';
import { DRIVERS } from './types';

export type Kart={
  group:T.Group;wheels:T.Mesh[];body:T.Group;shield:T.Mesh;
  /** Layered exhaust glow behind both pipes. Origin is the exhaust plane, so scale.z stretches the plume backwards. */
  flame:T.Group;shadow:T.Mesh;effects:T.Group;driver:number;
  /** Articulation pivots, all at rotation 0 when built. Positions are in body space (head, arms, steer) or kart space (frontWheels). */
  head?:T.Group;arms?:[T.Group,T.Group];steer?:T.Group;frontWheels?:T.Group[];
};
function roundedBox(w:number,h:number,d:number,r=.08){
  const shape=new T.Shape();shape.moveTo(-w/2+r,-h/2);shape.lineTo(w/2-r,-h/2);shape.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);shape.lineTo(w/2,h/2-r);shape.quadraticCurveTo(w/2,h/2,w/2-r,h/2);shape.lineTo(-w/2+r,h/2);shape.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);shape.lineTo(-w/2,-h/2+r);shape.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);
  const geometry=new T.ExtrudeGeometry(shape,{depth:d-2*r,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:r*.5,bevelThickness:r,curveSegments:3});geometry.translate(0,0,-d/2+r);return geometry;
}
/** Merge the direct Mesh children of `parent` by material so each articulated group costs one draw call per material. */
function bake(parent:T.Object3D) {
  const batches=new Map<T.Material,T.BufferGeometry[]>();
  for(const child of parent.children.filter((child):child is T.Mesh=>child instanceof T.Mesh)){child.updateMatrix();const geometry=(child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone()).applyMatrix4(child.matrix),mat=child.material as T.Material;const list=batches.get(mat)??[];list.push(geometry);batches.set(mat,list);parent.remove(child);child.geometry.dispose();}
  for(const [mat,geometries] of batches){const merged=mergeGeometries(geometries,false)!;for(const geometry of geometries)geometry.dispose();const mesh=new T.Mesh(merged,mat);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);}
}
/** Move a group's origin to (x,y,z) without moving its children, so rotations pivot there. */
function pivotAt(g:T.Group,x:number,y:number,z:number) {
  g.position.set(x,y,z);for(const child of g.children)child.position.sub(g.position);return g;
}
export function createKart(driver:number):Kart {
  const d=DRIVERS[driver%DRIVERS.length],group=new T.Group(),body=new T.Group();group.rotation.order='YXZ';group.add(body);
  const paint=new T.MeshStandardMaterial({color:d.color,roughness:.28,metalness:.3}),dark=new T.MeshStandardMaterial({color:'#202937',roughness:.65}),fur=new T.MeshStandardMaterial({color:d.accent,roughness:.88}),white=new T.MeshStandardMaterial({color:'#fff5dd',roughness:.6}),metal=new T.MeshStandardMaterial({color:'#9db8c5',metalness:.8,roughness:.24}),gold=new T.MeshStandardMaterial({color:'#ffc14a',roughness:.5});
  // Articulated groups. Parts are authored in body space and re-based onto their pivots at the end.
  const head=new T.Group(),armL=new T.Group(),armR=new T.Group(),steer=new T.Group();
  let target:T.Object3D=body;
  const part=(geometry:T.BufferGeometry,mat:T.Material,x:number,y:number,z:number,parent:T.Object3D=target)=>{const mesh=new T.Mesh(geometry,mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
  const oval=(mat:T.Material,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{const mesh=part(new T.SphereGeometry(1,16,10),mat,x,y,z);mesh.scale.set(sx,sy,sz);return mesh;};
  part(roundedBox(1.75,.42,2.65),paint,0,.76,0);part(roundedBox(1.9,.15,2.8,.04),dark,0,.5,0);
  oval(paint,0,.88,.81,.84,.37,.95);part(roundedBox(.24,.035,1.25,.01),white,0,1.14,.62);
  for(const side of [-1,1]){
    part(roundedBox(.32,.38,1.65),paint,side*.92,.75,-.1);
    part(roundedBox(.17,.06,1.4,.02),white,side*.94,.96,-.08);
    part(new T.CylinderGeometry(.065,.065,.7,8),metal,side*.72,1.2,-1.1);
    const exhaust=part(new T.CylinderGeometry(.16,.16,.42,12),metal,side*.61,.68,-1.42);exhaust.rotation.x=Math.PI/2;
    const hole=part(new T.CircleGeometry(.11,12),dark,side*.61,.68,-1.64);hole.rotation.y=Math.PI;
    part(roundedBox(.3,.12,.07,.025),new T.MeshBasicMaterial({color:'#ff5d51'}),side*.6,.97,-1.36);
  }
  part(roundedBox(2.05,.13,.48,.04),paint,0,1.59,-1.17);part(roundedBox(.25,.015,.48,.005),white,0,1.67,-1.17);
  for(const side of [-1,1])part(roundedBox(.1,.35,.55,.04),dark,side*1.03,1.64,-1.17);
  const seat=part(roundedBox(.85,.9,.42),dark,0,1.2,-.51);seat.rotation.x=-.15;
  oval(paint,0,1.57,-.23,.49,.57,.43);
  for(const side of [-1,1]){const shoulder=part(roundedBox(.13,.56,.08,.03),white,side*.27,1.76,-.55);shoulder.rotation.z=side*.12;}
  const isBird=d.animal==='penguin'||d.animal==='duck',isFrog=d.animal==='frog';
  // Body-level wings for the birds stay static; the articulated arms below are the hands on the wheel.
  if(d.animal==='penguin')for(const side of [-1,1])oval(dark,side*.52,1.59,-.14,.18,.46,.28).rotation.z=side*.3;
  if(d.animal==='duck')for(const side of [-1,1])oval(fur,side*.5,1.59,-.14,.18,.38,.3);
  // Head: skull, ears, eyes, muzzle, and helmet pivot together at the neck.
  target=head;
  const skull=oval(fur,0,2.25,-.16,.59,.57,.53);
  if(d.animal==='penguin'){skull.material=dark;oval(white,0,2.16,.3,.43,.43,.2);}
  if(isFrog){skull.scale.set(.63,.48,.55);for(const side of [-1,1])oval(paint,side*.38,2.62,.1,.24,.25,.23);}
  if(!isBird&&!isFrog)for(const side of [-1,1]){
    if(d.animal==='bear'){oval(fur,side*.47,2.68,-.17,.23,.24,.16);oval(paint,side*.47,2.68,-.015,.13,.13,.025);}
    else if(d.animal==='rabbit'){oval(fur,side*.29,2.96,-.17,.15,.55,.15).rotation.z=side*-.16;oval(paint,side*.29,2.99,-.015,.065,.35,.025).rotation.z=side*-.16;}
    else {const ear=part(new T.ConeGeometry(.26,.53,4),fur,side*.41,2.77,-.2);ear.rotation.z=side*-.25;const inner=part(new T.ConeGeometry(.13,.29,4),paint,side*.43,2.79,-.015);inner.rotation.z=side*-.25;}
  }
  for(const side of [-1,1]){
    const eyeY=isFrog?2.64:2.3,eyeX=isFrog?.38:.23,eyeZ=isFrog?.31:d.animal==='penguin'?.48:.335;
    if(d.animal==='raccoon')oval(dark,side*.24,eyeY,eyeZ,.23,.17,.07);
    oval(white,side*eyeX,eyeY,eyeZ+.025,.11,.135,.06);oval(dark,side*eyeX,eyeY,eyeZ+.07,.066,.09,.035);oval(white,side*eyeX-.02,eyeY+.035,eyeZ+.102,.025,.03,.012);
  }
  if(isBird){oval(gold,0,2.1,.43,d.animal==='duck'?.37:.2,.105,.3);}
  else if(isFrog){oval(dark,0,2.08,.34,.28,.025,.055);}
  else {oval(white,0,2.08,.36,.25,.15,.18);oval(dark,0,2.16,.51,.075,.055,.055);}
  const helmet=part(new T.SphereGeometry(.61,20,10,0,Math.PI*2,0,Math.PI*.38),paint,0,2.25,-.16);helmet.rotation.z=.05;
  const stripe=part(roundedBox(.17,.055,.76,.015),white,0,2.86,-.16);stripe.rotation.x=.03;
  // Arms: upper arm plus hand, pivoting at the shoulder so they can follow the wheel.
  for(const [side,arm] of [[-1,armL],[1,armR]] as const){
    target=arm;
    const upper=oval(paint,side*.46,1.7,.2,.17,.3,.22);upper.rotation.x=-.65;oval(white,side*.43,1.65,.51,.17,.16,.17);
  }
  target=body;
  // Tails and ear silhouettes identify drivers from the chase camera.
  if(d.animal==='fox'){const tail=oval(fur,.55,1.56,-.82,.26,.48,.36);tail.rotation.z=-.55;oval(white,.77,1.86,-.91,.18,.22,.23);}
  if(d.animal==='cat'){const tail=part(new T.TorusGeometry(.38,.095,7,16,Math.PI*1.35),fur,.49,1.4,-.84);tail.rotation.z=-.6;}
  if(d.animal==='raccoon')for(let i=0;i<5;i++)oval(i%2?dark:fur,.42+i*.055,1.1+i*.11,-.65-i*.08,.19,.16,.17);
  if(d.animal==='rabbit'||d.animal==='bear')oval(fur,0,1.16,-.77,.22,.21,.19);
  // Steering wheel: rim, three spokes, and hub in a tilted group; the column stays on the body.
  const column=part(new T.CylinderGeometry(.04,.04,.48,8),metal,0,1.33,.42);column.rotation.x=.6;
  steer.position.set(0,1.57,.54);steer.rotation.x=-.65;
  part(new T.TorusGeometry(.29,.045,6,20),dark,0,0,0,steer);
  for(let i=0;i<3;i++){const spoke=part(roundedBox(.045,.27,.035,.01),metal,Math.sin(i*Math.PI*2/3)*.135,Math.cos(i*Math.PI*2/3)*.135,0,steer);spoke.rotation.z=-i*Math.PI*2/3;}
  const hub=part(new T.CylinderGeometry(.075,.075,.06,10),paint,0,0,0,steer);hub.rotation.x=Math.PI/2;
  pivotAt(head,0,1.95,-.16);pivotAt(armL,-.46,1.8,-.02);pivotAt(armR,.46,1.8,-.02);
  body.add(head,armL,armR,steer);
  // Wheels: rear pairs sit directly on the kart; front pairs sit in yaw pivots so the renderer can point them into the turn.
  const wheels:T.Mesh[]=[],frontWheels:T.Group[]=[];
  for(const x of [-1,1])for(const z of [-.88,.87]){
    const front=z>0,parent=front?new T.Group():group;
    if(front){parent.position.set(x,.46,z);group.add(parent);frontWheels.push(parent as T.Group);}
    const at=front?0:x,ay=front?0:.46,az=front?0:z;
    const tire=part(new T.CylinderGeometry(.43,.43,.36,20),dark,at,ay,az,parent);tire.rotation.z=Math.PI/2;wheels.push(tire);
    const hubcap=part(new T.CylinderGeometry(.24,.24,.385,12),metal,at,ay,az,parent);hubcap.rotation.z=Math.PI/2;
    const cap=part(new T.CylinderGeometry(.105,.105,.405,10),paint,at,ay,az,parent);cap.rotation.z=Math.PI/2;
  }
  const shadow=new T.Mesh(new T.CircleGeometry(1.5,24),new T.MeshBasicMaterial({color:'#102039',transparent:true,opacity:.24,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.scale.set(.85,1.15,1);shadow.position.y=.035;group.add(shadow);
  const shield=new T.Mesh(new T.SphereGeometry(2.15,24,16),new T.MeshBasicMaterial({color:'#71e9ff',wireframe:true,transparent:true,opacity:.3}));shield.position.y=1.2;shield.visible=false;group.add(shield);
  // Boost plume: additive ellipsoid layers per pipe, all behind the exhaust plane (z<=-1.64) so nothing pokes through the chassis.
  const flame=new T.Group();flame.position.set(0,.68,-1.64);flame.visible=false;group.add(flame);
  const layers:[string,number,number,number,number][]=[['#ffffff',.9,.09,.24,-.2],['#a4f4ff',.75,.15,.46,-.4],['#4fc4ff',.38,.21,.8,-.72],['#8cebff',.42,.06,1.05,-1.5]];
  for(const [color,opacity,radius,length,zCenter] of layers){
    const halves:T.BufferGeometry[]=[];
    for(const side of [-1,1]){const g=new T.SphereGeometry(1,12,8);g.scale(radius,radius*.85,length);g.translate(side*.61,0,zCenter);halves.push(g);}
    const merged=mergeGeometries(halves,false)!;for(const g of halves)g.dispose();
    const mesh=new T.Mesh(merged,new T.MeshBasicMaterial({color,transparent:true,opacity,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false}));mesh.renderOrder=2;flame.add(mesh);
  }
  // Bake static details by material. Articulated groups are baked separately so each stays one draw call per material.
  bake(body);bake(head);bake(armL);bake(armR);bake(steer);
  const effects=createRacerEffects();group.add(effects);
  return {group,wheels,body,shield,flame,shadow,effects,driver,head,arms:[armL,armR],steer,frontWheels};
}
