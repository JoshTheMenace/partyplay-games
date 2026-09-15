import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGroundAtmosphere, createOceanMaterial, createTerrainMaterial } from './ground-atmosphere';
import { disposeObject } from './dispose';
import { createCoinViews, createPickupInstances } from './powerup-models';
import { TRACKS, groundHeight as terrainHeight, nearest, sample, surfaceFrame, type Track, sectorAt } from './tracks';
import { courseScenery } from './course-scenery';
import { createRainbowWorld } from './rainbow-world';
import type { Racer, TrackId } from './types';
import { createTurnGuides } from './turn-guides';

const material=(color: T.ColorRepresentation,roughness=.8)=>new T.MeshStandardMaterial({color,roughness});
const pickupBasis=(frame:ReturnType<typeof surfaceFrame>)=>new T.Matrix4().makeBasis(new T.Vector3(frame.right.x,frame.right.y,frame.right.z),new T.Vector3(frame.up.x,frame.up.y,frame.up.z),new T.Vector3(frame.forward.x,frame.forward.y,frame.forward.z));
function palmFrond() {
  const p:number[]=[],indices:number[]=[];
  for(let i=0;i<=8;i++){const t=i/8;for(const side of [-1,1])p.push(side*Math.sin(t*Math.PI)*.32,Math.sin(t*Math.PI)*.2-t*t*.35,t*2);if(i<8){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
const frond=palmFrond(),windowPane=new T.PlaneGeometry(1,1);
const box=new T.BoxGeometry(1,1,1),sphere=new T.IcosahedronGeometry(1,1),cone=new T.ConeGeometry(1,1,7),cylinder=new T.CylinderGeometry(1,1,1,8);
type Instance={position:number[];scale:number[];color:T.ColorRepresentation;rotation?:number[]};
function instances(group:T.Group,geometry:T.BufferGeometry,list:Instance[],emissive=false,castShadow=false) {
  if(!list.length)return;
  const mat=emissive?new T.MeshBasicMaterial({color:'white'}):new T.MeshStandardMaterial({color:'white',roughness:.85,side:geometry===frond?T.DoubleSide:T.FrontSide});
  const mesh=new T.InstancedMesh(geometry.clone(),mat,list.length),dummy=new T.Object3D();
  list.forEach((v,i)=>{dummy.position.fromArray(v.position);dummy.scale.fromArray(v.scale);dummy.rotation.set(...(v.rotation??[0,0,0]) as [number,number,number]);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,new T.Color(v.color));});
  mesh.receiveShadow=true;mesh.castShadow=castShadow;mesh.computeBoundingSphere();group.add(mesh);return mesh;
}
function ribbon(track:Track,from:number,to:number,height:number,color:string) {
  const positions:number[]=[],indices:number[]=[];
  for(let i=0;i<=768;i++) {for(const offset of [from,to]){const p=sample(track,i/768,offset);positions.push(p.x,p.y+height,p.z);}}
  for(let i=0;i<768;i++){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new T.Mesh(geometry,material(color));mesh.receiveShadow=true;return mesh;
}
function label(text:string,color='#ffffff',background='#14233d') {
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=192;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle=background;ctx.fillRect(0,0,1024,192);ctx.fillStyle=color;ctx.font='900 italic 84px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,100,970);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
  return new T.Mesh(new T.PlaneGeometry(20,3.75),new T.MeshBasicMaterial({map:texture,side:T.DoubleSide}));
}
/** Integrated gantry sign: a slim plaque with a framed edge and accent bars, at a quarter of the old canvas cost. */
function plaque(text:string,color:string,start=false) {
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=128;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#0f1730';ctx.fillRect(0,0,768,128);
  ctx.fillStyle=color;ctx.fillRect(0,0,768,10);ctx.fillRect(0,118,768,10);
  if(start)for(let i=0;i<4;i++)for(let j=0;j<2;j++){ctx.fillStyle=(i+j)%2?'#f6f1e6':'#0f1730';ctx.fillRect(14+i*22,20+j*44,22,44);ctx.fillRect(666+i*22,20+j*44,22,44);}
  ctx.strokeStyle='rgba(255,246,229,0.35)';ctx.lineWidth=4;ctx.strokeRect(6,6,756,116);
  ctx.fillStyle='#fff6e5';ctx.font='900 italic 60px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,384,66,start?560:690);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
  return new T.Mesh(new T.PlaneGeometry(9,1.5),new T.MeshBasicMaterial({map:texture,side:T.DoubleSide}));
}
export type World={group:T.Group;track:Track;animated:T.Object3D[];boxes:T.Object3D[];coins:T.Object3D[];update?:(time:number)=>void;prepareView?:(racer?:Racer)=>void;dispose():void};
export function createWorld(id:TrackId):World {
  if(id==='rainbow')return createRainbowWorld();
  const track=TRACKS[id],group=new T.Group(),animated:T.Object3D[]=[],itemBoxes:T.Object3D[]=[],coins:T.Object3D[]=[];
  group.add(createTurnGuides(track));
  const atmosphere=createGroundAtmosphere(track);group.add(atmosphere.group);let oceanMaterial:T.MeshStandardMaterial|undefined;
  const night=id==='midnight';let seed=1237;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const terrain=new T.PlaneGeometry(1500,1500,120,120);terrain.rotateX(-Math.PI/2);
  const pos=terrain.attributes.position,colors:number[]=[];
  for(let i=0;i<pos.count;i++) {
    const x=pos.getX(i),z=pos.getZ(i),y=terrainHeight(track,x,z);
    pos.setY(i,y);
    const location=nearest(track,x,z),sector=sectorAt(track,location.s);
    const c=new T.Color(sector.color).multiplyScalar(.88+random()*.2);
    if(id==='coast'&&y<0)c.set('#e5d29b');colors.push(c.r,c.g,c.b);
  }
  terrain.setAttribute('color',new T.Float32BufferAttribute(colors,3));terrain.computeVertexNormals();
  const land=new T.Mesh(terrain,createTerrainMaterial(track));land.receiveShadow=true;group.add(land);
  if(id==='coast'){
    oceanMaterial=createOceanMaterial();const ocean=new T.Mesh(new T.PlaneGeometry(7000,7000),oceanMaterial);ocean.rotation.x=-Math.PI/2;ocean.position.y=-7;group.add(ocean);
  }
  group.add(ribbon(track,-track.width/2,track.width/2,.04,night?'#333b54':'#52636b'));
  group.add(ribbon(track,-track.width/2-1.1,-track.width/2,.065,'#f1e9d8'),ribbon(track,track.width/2,track.width/2+1.1,.065,'#f1e9d8'));
  const lights:Instance[]=[],markings:Instance[]=[],curbs:Instance[]=[],posts:Instance[]=[],rails:Instance[]=[],trunks:Instance[]=[],leaves:Instance[]=[],rocks:Instance[]=[],buildings:Instance[]=[],roofs:Instance[]=[],windows:Instance[]=[],decor:Instance[]=[];
  const count=Math.floor(track.length/5);
  for(let i=0;i<count;i++) {
    for(const side of [-1,1]) {
      const p=sample(track,i/count,side*(track.width/2+.55));
      curbs.push({position:[p.x,p.y+.13,p.z],scale:[1.1,.2,track.length/count*.5],color:i%2?'#ffffff':night?'#b777ef':'#f46758',rotation:[0,p.heading,0]});
      if(i%4===0){const r=sample(track,i/count,side*(track.width/2+3));posts.push({position:[r.x,r.y+1.4,r.z],scale:[.23,2.8,.23],color:night?'#49637d':'#879b9e'});}
    }
    if(night&&i%16===0)for(const side of [-1,1]){const p=sample(track,i/count,side*(track.width/2+4));posts.push({position:[p.x,p.y+5,p.z],scale:[.3,10,.3],color:'#50698f'});lights.push({position:[p.x,p.y+9.8,p.z],scale:[1.2,.25,1.2],color:side===1?'#ffcf8a':'#92e9ff'});}
    if(i%3===0){const p=sample(track,i/count);markings.push({position:[p.x,p.y+.07,p.z],scale:[.16,.02,3],color:night?'#a0b4d0':'#dbdfd2',rotation:[0,p.heading,0]});}
  }
  for(const side of [-1,1])group.add(ribbon(track,side*(track.width/2+3)-.12,side*(track.width/2+3)+.12,2.3,night?'#bf88ff':'#d8e5d6'));
  for(let a=0;a<12;a++)for(let b=0;b<4;b++){const p=sample(track,b*1.3/track.length,(a-5.5)*1.45);markings.push({position:[p.x,p.y+.1,p.z],scale:[1.45,.03,1.3],color:(a+b)%2?'#ffffff':'#14253a',rotation:[0,p.heading,0]});}
  // Gantry: slim posts, a shallow truss beam, and a plaque-sized sign. Structure merges to one mesh, accents to one more.
  const steel=material(night?'#3b4266':'#66727f',.55);
  function gantry(s:number,text:string,color:string) {
    const p=sample(track,s),g=new T.Group();g.position.set(p.x,p.y,p.z);g.rotation.y=p.heading;
    const structure:T.BufferGeometry[]=[],accents:T.BufferGeometry[]=[];
    const add=(list:T.BufferGeometry[],geometry:T.BufferGeometry,x:number,y:number,z:number,rz=0)=>{geometry.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x,y,z),new T.Quaternion().setFromEuler(new T.Euler(0,0,rz)),new T.Vector3(1,1,1)));list.push(geometry);};
    for(const side of [-1,1]) {
      add(structure,new T.BoxGeometry(.5,7.4,.5),side*11,3.7,0);add(structure,new T.BoxGeometry(1.3,.35,1.3),side*11,.18,0);
      add(structure,new T.BoxGeometry(.14,2.2,.14),side*10.2,5.9,0,side*.5);
      add(accents,new T.BoxGeometry(.7,.28,.7),side*11,7.55,0);
    }
    for(const z of [-.45,.45]){add(structure,new T.BoxGeometry(22.8,.2,.2),0,6.45,z);add(structure,new T.BoxGeometry(22.8,.2,.2),0,7.35,z);}
    for(let i=0;i<=11;i++){add(structure,new T.BoxGeometry(.11,1.15,.11),-10.45+i*1.9,6.9,-.45,i%2?.85:-.85);add(structure,new T.BoxGeometry(.11,1.15,.11),-10.45+i*1.9,6.9,.45,i%2?-.85:.85);}
    for(let i=0;i<7;i++)add(structure,new T.BoxGeometry(.1,.1,1.1),-9.5+i*3.2,7.35,0);
    for(let i=0;i<4;i++)add(accents,new T.BoxGeometry(.5,.12,.3),-3.6+i*2.4,6.05,.55);
    const frame=new T.Mesh(mergeGeometries(structure,false)!,steel);frame.castShadow=true;frame.receiveShadow=true;g.add(frame);for(const geometry of structure)geometry.dispose();
    const trim=new T.Mesh(mergeGeometries(accents,false)!,new T.MeshBasicMaterial({color}));g.add(trim);for(const geometry of accents)geometry.dispose();
    const sign=plaque(text,color,s===0);sign.position.set(0,6.9,-.62);sign.rotation.y=Math.PI;g.add(sign);group.add(g);
  }
  gantry(0,'KART PARTY',night?'#7248b4':'#ff6750');
  for(const sector of track.sectors.slice(1))gantry(sector.from+.003,sector.name.toUpperCase(),night?'#6541a1':id==='canyon'?'#976548':'#258d8c');
  for(const s of track.boosts) {
    for(let i=0;i<5;i++){const p=sample(track,s+(i-2)*1.8/track.length);decor.push({position:[p.x,p.y+.12,p.z],scale:[8,.1,.8],color:night?'#c699ff':'#63e9e4',rotation:[0,p.heading,0]});}
  }
  const boxLocations=track.boxes.flatMap(s=>[-5,0,5].map(offset=>({s,offset}))),coinModels=createPickupInstances('field_coin',track.coins.length),boxModels=createPickupInstances('item_box',boxLocations.length),pickupDummy=new T.Object3D();let pickupTime=0;
  group.add(coinModels.group,boxModels.group);
  const coinViews=createCoinViews(coinModels,track.coins.map(coin=>{const frame=surfaceFrame(track,coin.s,coin.offset,1.5);return {position:new T.Vector3(frame.position.x,frame.position.y,frame.position.z),quaternion:new T.Quaternion().setFromRotationMatrix(pickupBasis(frame))};}));
  const prepareView=(racer?:Racer)=>coinViews(pickupTime,index=>!!racer?.coinsTaken?.includes((racer.lap-1)*track.coins.length+index));
  const updatePickups=(time:number)=>{pickupTime=time;boxLocations.forEach((box,index)=>{const frame=surfaceFrame(track,box.s,box.offset,2.2+Math.sin(time*2+index)*.22);pickupDummy.position.set(frame.position.x,frame.position.y,frame.position.z);pickupDummy.quaternion.setFromRotationMatrix(pickupBasis(frame));pickupDummy.rotateY(time*.65);pickupDummy.rotateZ(Math.PI/4);pickupDummy.scale.setScalar(1);pickupDummy.updateMatrix();boxModels.setMatrixAt(index,pickupDummy.matrix);});boxModels.commit();prepareView();};
  updatePickups(0);coinModels.commit(true);boxModels.commit(true);
  for(let i=0;i<650;i++) {
    const s=random(),side=random()>.5?1:-1,offset=side*(22+random()*115),p=sample(track,s,offset);
    const n=nearest(track,p.x,p.z);if(n.distance<(id==='canyon'?40:id==='midnight'?33:23))continue;
    const base=terrainHeight(track,p.x,p.z)-.3,height=5+random()*13;
    if(id==='coast'&&base<-4)continue;
    const sector=sectorAt(track,s);
    if(id==='coast') {
      if(i%3===0&&sector.theme!=='jungle'&&sector.theme!=='cliffs') {
        buildings.push({position:[p.x,base+3,p.z],scale:[9,6,8],color:['#fce5a4','#f6ad9d','#a5dce1'][Math.floor(i/3)%3]});
        roofs.push({position:[p.x,base+7,p.z],scale:[7,4,7],color:'#db7959',rotation:[0,Math.PI/4,0]});
        for(const side of [-1,1]){
          for(const x of [-2.4,2.4])windows.push({position:[p.x+x,base+3.6,p.z+side*4.05],scale:[1.5,1.8,.12],color:'#367581'});
          windows.push({position:[p.x+side*4.55,base+3.6,p.z],scale:[.12,1.8,1.8],color:'#367581'});
          windows.push({position:[p.x,base+1.6,p.z+side*4.06],scale:[1.4,3.2,.12],color:'#997251'});
          buildings.push({position:[p.x,base+5.8,p.z+side*4.1],scale:[9.6,.35,.45],color:'#fff0cb'});
        }
      } else {
        trunks.push({position:[p.x,base+height/2,p.z],scale:[.55,height,.55],color:'#b49364',rotation:[0,0,.08]});
        for(let f=0;f<7;f++){const angle=f/7*Math.PI*2+i;leaves.push({position:[p.x+.5,base+height,p.z],scale:[2.2,4,3.5+random()],color:f%2?'#348956':'#65b867',rotation:[-.1,angle,0]});}
      }
    } else if(id==='canyon') {
      if(i%4===0) {
        trunks.push({position:[p.x,base+height/2,p.z],scale:[1.3,height,1.3],color:'#598e6e'});
        trunks.push({position:[p.x+2,base+height*.65,p.z],scale:[4,.9,.9],color:'#598e6e'});
        trunks.push({position:[p.x+3.5,base+height*.78,p.z],scale:[.9,height*.28,.9],color:'#598e6e'});
      } else {
        const h=height*(offset>60?3:1.4);rocks.push({position:[p.x,base+h*.35,p.z],scale:[6+random()*8,h,6+random()*8],color:['#cb865c','#b86e4b','#e3ab79'][i%3],rotation:[0,random()*6,0]});
      }
    } else {
      if(sector.theme==='garden'||sector.theme==='reactor'&&i%3!==0)continue;
      const h=height*(1+random()*4),w=7+random()*10;
      buildings.push({position:[p.x,base+h/2,p.z],scale:[w,h,w],color:['#34476e','#293b60','#46507c','#284056'][i%4]});
      const lightColor=['#f9c775','#63dce5','#b998ff'][i%3];
      for(let y=3;y<h-2;y+=4)for(const side of [-1,1])for(const segment of [-1,0,1]){
        if(random()<.18)continue;
        windows.push({position:[p.x+segment*w*.27,base+y,p.z+side*(w/2+.05)],scale:[w*.17,1.2,1],color:lightColor,rotation:[0,side===1?0:Math.PI,0]});
        windows.push({position:[p.x+side*(w/2+.05),base+y,p.z+segment*w*.27],scale:[w*.17,1.2,1],color:lightColor,rotation:[0,side*Math.PI/2,0]});
      }
      for(const side of [-1,1]){lights.push({position:[p.x,base+h,p.z+side*w/2],scale:[w,.18,.18],color:lightColor});lights.push({position:[p.x+side*w/2,base+h,p.z],scale:[.18,.18,w],color:lightColor});}
      roofs.push({position:[p.x,base+h+1,p.z],scale:[w*.5,2,w*.5],color:'#4a5477'});
    }
    if(i%5===0)decor.push({position:[p.x+4,base+.4,p.z+3],scale:[2,.8,2],color:id==='canyon'?'#ccab70':'#76b965'});
  }
  const features=courseScenery(track);group.add(features.group);animated.push(...features.animated);
  // Course landmarks are deliberately larger than roadside detail, making each sector recognizable.
  for(let sector=0;sector<8;sector++) {
    if(id==='coast'&&sector<4)continue; // Authored harbor and lighthouse kit owns this reference stretch.
    const p=sample(track,(sector+.3)/8,(sector%2?1:-1)*65),g=new T.Group();g.position.set(p.x,terrainHeight(track,p.x,p.z)-.3,p.z);
    if(id==='coast') {
      if(sector%2===0) {
        const tower=new T.Mesh(new T.CylinderGeometry(3,5,28,12),material('#fff1d5'));tower.position.y=14;g.add(tower);
        for(const y of [8,18]) {const stripe=new T.Mesh(new T.CylinderGeometry(4.5-y*.035,4.6-y*.035,3,12),material('#ed7260'));stripe.position.y=y;g.add(stripe);}
        const cap=new T.Mesh(new T.ConeGeometry(5,6,12),material('#d6584e'));cap.position.y=31;g.add(cap);
        const lamp=new T.Mesh(new T.SphereGeometry(2.5,12,8),new T.MeshBasicMaterial({color:'#fff4a4'}));lamp.position.y=27;g.add(lamp);
      } else {
        const windmill=new T.Mesh(new T.CylinderGeometry(2,4,19,8),material('#fbe6b6'));windmill.position.y=9.5;g.add(windmill);
        const blades=new T.Group();blades.position.set(0,18,3);
        for(let i=0;i<4;i++){const blade=new T.Mesh(new T.BoxGeometry(1.7,13,.35),material('#f9f4d8'));blade.rotation.z=i*Math.PI/2;blade.position.set(Math.sin(-i*Math.PI/2)*5,Math.cos(i*Math.PI/2)*5,0);blades.add(blade);}g.add(blades);animated.push(blades);
      }
    } else if(id==='canyon') {
      for(const side of [-1,1]){const pillar=new T.Mesh(new T.CylinderGeometry(5,8,35,6),material('#ca8258'));pillar.position.set(side*15,17.5,0);g.add(pillar);}
      const arch=new T.Mesh(new T.TorusGeometry(15,5,6,16,Math.PI),material('#dfa070'));arch.position.y=33;g.add(arch);
    } else {
      const base=new T.Mesh(new T.CylinderGeometry(13,16,14,16),material('#415a82'));base.position.y=7;g.add(base);
      const dome=new T.Mesh(new T.SphereGeometry(13,20,12,0,Math.PI*2,0,Math.PI/2),new T.MeshStandardMaterial({color:'#738dad',metalness:.55,roughness:.3}));dome.position.y=14;g.add(dome);
      const ring=new T.Mesh(new T.TorusGeometry(17,.5,6,48),new T.MeshBasicMaterial({color:sector%2?'#bb81ff':'#5fedee'}));ring.rotation.x=Math.PI/2;ring.position.y=17;g.add(ring);
    }
    group.add(g);
    const sign=label(['KEEP IT SIDEWAYS','CHASE THE BOOST','FULL THROTTLE','TAKE THE INSIDE'][sector%4], '#ffffff',night?'#7152a6':'#257f8b');
    const signP=sample(track,(sector+.6)/8,track.width/2+8);sign.position.set(signP.x,signP.y+5,signP.z);sign.rotation.y=signP.heading+.4+Math.PI;sign.scale.setScalar(.45);group.add(sign);
  }
  if(id==='coast')for(let i=0;i<22;i++) {
    const p=sample(track,random(),180+random()*60);if(nearest(track,p.x,p.z).distance<145)continue;
    const boat=new T.Group();boat.position.set(p.x,-6.4,p.z);boat.rotation.y=random()*6;
    const hull=new T.Mesh(new T.SphereGeometry(1,8,4),material(i%2?'#ffe8af':'#ef7868'));hull.scale.set(3,1,8);boat.add(hull);
    const mast=new T.Mesh(new T.CylinderGeometry(.13,.13,15,5),material('#eee6cf'));mast.position.y=7;boat.add(mast);
    const sail=new T.Mesh(new T.ConeGeometry(6,12,3),material('#fff9de'));sail.scale.z=.06;sail.position.set(2,8,0);boat.add(sail);group.add(boat);
  }
  instances(group,box,markings);instances(group,box,curbs);instances(group,box,posts);instances(group,box,rails);
  instances(group,cylinder,trunks,false,true);instances(group,frond,leaves,false,true);instances(group,sphere,rocks,false,true);instances(group,box,buildings,false,true);instances(group,cone,roofs,false,true);instances(group,night?windowPane:box,windows,night);instances(group,box,lights,true);instances(group,box,decor,true);
  return {group,track,animated,boxes:itemBoxes,coins,prepareView,update(time){atmosphere.update(time);oceanMaterial?.userData.update(time);updatePickups(time);},dispose(){disposeObject(group);}};
}
