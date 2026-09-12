import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { routePoints, routeSample } from './course-routes';
import type { CourseDesign, RouteSpec } from './courses/spec';
import { mod, sample, type Track } from './tracks';

/** Every cached sign state stays attached, so normal scene traversal owns its resources. */
export function createRouteVisuals(track:Track,design:CourseDesign):{group:T.Group;update(time:number):void}{
  const group=new T.Group(),updates:((time:number)=>void)[]=[],materials=new Map<string,T.MeshStandardMaterial>();
  group.name='course-routes';
  const paint=(color:string)=>{let material=materials.get(color);if(!material){material=new T.MeshStandardMaterial({color,roughness:.78,side:T.DoubleSide});materials.set(color,material);}return material;};
  const routes=new Map(design.routes.map(route=>[route.id,route]));
  const at=(s:number,offset=0,route?:RouteSpec)=>route?routeSample(track,route,s,offset):sample(track,s,offset);
  const batches=new Map<T.Material,T.BufferGeometry[]>();
  function batch(mesh:T.Mesh){
    mesh.updateMatrix();const geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
    geometry.deleteAttribute('uv');geometry.applyMatrix4(mesh.matrix);mesh.geometry.dispose();
    const material=mesh.material as T.Material,list=batches.get(material)??[];list.push(geometry);batches.set(material,list);
  }
  function flush(target:T.Group){
    for(const [material,geometries] of batches){const mesh=new T.Mesh(mergeGeometries(geometries)!,material);mesh.receiveShadow=true;target.add(mesh);for(const geometry of geometries)geometry.dispose();}batches.clear();
  }
  function box(s:number,offset:number,width:number,height:number,length:number,color:string,lift:number,route?:RouteSpec){
    const p=at(s,offset,route),mesh=new T.Mesh(new T.BoxGeometry(width,height,length),paint(color));
    mesh.position.set(p.x,p.y+lift,p.z);mesh.rotation.y=p.heading;batch(mesh);
  }
  function strip(from:number,to:number,offset:number,width:number,color:string,lift:number,route?:RouteSpec){
    const count=Math.ceil((to-from)*track.length/2),positions:number[]=[],indices:number[]=[];
    for(let i=0;i<=count;i++)for(const side of [-1,1]){const p=at(from+(to-from)*i/count,offset+side*width/2,route);positions.push(p.x,p.y+lift,p.z);}
    for(let i=0;i<count;i++){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();batch(new T.Mesh(geometry,paint(color)));
  }
  function arrow(s:number,offset:number,color:string,route?:RouteSpec,side=0,lift=.2){
    const p=at(s,offset,route),shape=new T.Shape();shape.moveTo(-1.3,-1);shape.lineTo(0,1.2);shape.lineTo(1.3,-1);shape.lineTo(.65,-1);shape.lineTo(0,.1);shape.lineTo(-.65,-1);shape.closePath();
    const a=at(s-.5/track.length,offset,route),b=at(s+.5/track.length,offset,route),mesh=new T.Mesh(new T.ShapeGeometry(shape),paint(color));
    mesh.geometry.rotateX(-Math.PI/2);mesh.geometry.rotateY(Math.PI+side);mesh.rotation.set(-Math.atan2(b.y-a.y,Math.hypot(b.x-a.x,b.z-a.z)),p.heading,0,'YXZ');mesh.position.set(p.x,p.y+lift,p.z);batch(mesh);
  }
  function sign(text:string,p:ReturnType<typeof sample>,height:number,color:string,width=14){
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=128;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#0b1030';ctx.fillRect(0,0,768,128);ctx.fillStyle=color;ctx.fillRect(0,0,768,9);ctx.fillRect(0,119,768,9);
    ctx.fillStyle='#fff6e5';ctx.font='900 58px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,384,66,736);
    const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
    const mesh=new T.Mesh(new T.PlaneGeometry(width,width/6),new T.MeshBasicMaterial({map:texture,side:T.FrontSide}));
    mesh.name=text;mesh.position.set(p.x,p.y+height,p.z);mesh.rotation.y=p.heading+Math.PI;return mesh;
  }
  function stateSign(p:ReturnType<typeof sample>,height:number,yes:string,no:string,active:(time:number)=>boolean){
    const key=cueKey(p),row=cueRows.get(key)??0;cueRows.set(key,row+1);height+=cueLift(p)-row*2.6;
    const on=sign(yes,p,height,'#ffb05b'),off=sign(no,p,height,'#78d955');group.add(on,off);let previous:boolean|undefined;
    updates.push(time=>{const state=active(time);if(state!==previous){on.visible=state;off.visible=!state;previous=state;}});
  }
  const cue=(route:RouteSpec|undefined,s:number)=>at(route?route.from-18/track.length:s-24/track.length);
  const cueKey=(p:ReturnType<typeof sample>)=>`${p.x},${p.z}`,cueCounts=new Map<string,number>(),cueRows=new Map<string,number>();
  for(const feature of [...design.zones.filter(zone=>zone.period!==undefined),...design.gates]){
    const key=cueKey(cue(routes.get(feature.routeId??''),'from' in feature?feature.from:feature.s));cueCounts.set(key,(cueCounts.get(key)??0)+1);
  }
  const cueLift=(p:ReturnType<typeof sample>)=>Math.max(0,(cueCounts.get(cueKey(p))??0)-1)*2.6;
  for(const route of design.routes){
    const span=route.to-route.from,side=Math.sign(route.points.find(point=>point.offset)?.offset??1),p=cue(route,route.from);
    strip(route.from,route.to,0,route.width,route.color,.055,route);
    const safeFrom=route.from+span*.16,safeTo=route.to-span*.16;
    for(const edge of [-1,1]){
      strip(safeFrom,safeTo,edge*(route.width/2-.16),.32,'#fff6e5',.09,route);
      strip(safeFrom,safeTo,edge*(route.width/2+.12),.35,'#465564',.34,route);
    }
    for(const point of routePoints(track,route).filter((_,i)=>i%9===0)){
      if(point.s<safeFrom||point.s>safeTo)continue;
      arrow(point.s,0,'#fff6e5',route);
      for(const edge of [-1,1]){
        box(point.s,edge*(route.width/2+.2),.35,1.3,.35,'#465564',.65,route);
        box(point.s,edge*(route.width/2-.6),.9,5,.9,'#67747b',-2.6,route);
      }
    }
    group.add(sign(`${side>0?'←':'→'} ${route.name.toUpperCase()}`,p,8+cueLift(p),route.color));
    for(const edge of [-1,1])box(p.s,edge*(track.width/2+1),.45,9+cueLift(p),.45,'#465564',(9+cueLift(p))/2);
    for(const d of [12,25])arrow(route.from-d/track.length,side*track.width*.26,route.color,undefined,side*Math.PI/4);
  }
  flush(group);
  for(const zone of design.zones){
    const route=routes.get(zone.routeId??''),effect=new T.Group();effect.name=zone.id;group.add(effect);
    const active=(time:number)=>zone.period===undefined||mod(time+(zone.phase??0),zone.period)<(zone.activeFor??zone.period);
    const color={water:'#47dce9',conveyor:'#78d955',wind:'#fff6e5',rough:'#d39053'}[zone.kind];
    if(zone.kind!=='wind')strip(zone.from,zone.to,zone.offset,zone.width,color,.14,route);
    for(let s=zone.from+3/track.length;s<zone.to;s+=7/track.length){
      if(zone.kind==='conveyor')arrow(s,zone.offset,'#0b1030',route);
      else if(zone.kind==='wind'){
        arrow(s,zone.offset,color,route,Math.sign(zone.strength)*Math.PI/2,.25);
        const edge=zone.offset-Math.sign(zone.strength)*(zone.width/2+1.2);
        box(s,edge,.12,3.5,.12,'#465564',1.75,route);
        box(s,edge+Math.sign(zone.strength)*1.2,2.4,.35,.15,'#ffd24a',3.2,route);
      }else box(s,zone.offset,zone.width,.025,zone.kind==='water'?.17:.6,zone.kind==='water'?'#d8fff6':'#725037',.18,route);
    }
    flush(effect);updates.push(time=>{effect.visible=active(time);});
    if(zone.period!==undefined){
      const text=zone.kind==='water'?['TIDE WET · SLOW','TIDE DRY · GO']:zone.kind==='wind'?['GUST · STEER INTO WIND','WIND CALM']:['SURFACE ACTIVE','SURFACE CLEAR'];
      stateSign(cue(route,zone.from),5.5,text[0],text[1],active);
    }
  }
  for(const gate of design.gates){
    const route=routes.get(gate.routeId??''),p=at(gate.s,gate.offset,route),open=(time:number)=>mod(time+gate.phase,gate.period)<gate.openFor;
    const panel=new T.Mesh(new T.BoxGeometry(gate.width,gate.height,1.2),paint(gate.color));panel.name=gate.id;panel.rotation.y=p.heading;panel.position.set(p.x,p.y+gate.height/2,p.z);group.add(panel);
    for(const edge of [-1,1])box(gate.s,gate.offset+edge*(gate.width/2+.4),.6,gate.height+6,.8,'#465564',(gate.height+6)/2,route);
    box(gate.s,gate.offset,gate.width+1.4,.45,.8,'#465564',gate.height+6,route);
    flush(group);
    stateSign(cue(route,gate.s),5.5,'GATE CLOSED · BRAKE','GATE OPEN · GO',time=>!open(time));
    updates.push(time=>{panel.position.y=p.y+gate.height/2+(open(time)?5.5:0);});
  }
  const update=(time:number)=>{for(const fn of updates)fn(time);};update(0);return {group,update};
}
