import * as T from 'three';
import { groundHeight, sample, type Track } from './tracks';
import { rainbowScenery } from './rainbow-world';

type Shape='box'|'rock'|'pillar'|'roof'|'light';
type Instance={p:number[];s:number[];c:string;r:number[]};
export function courseScenery(track:Track){
  if(track.id==='rainbow')return rainbowScenery(track);
  const group=new T.Group(),animated:T.Object3D[]=[],batch=new Map<Shape,Instance[]>();
  const add=(kind:Shape,p:number[],s:number[],c:string,r=[0,0,0])=>{const list=batch.get(kind)??[];list.push({p,s,c,r});batch.set(kind,list);};
  const at=(s:number,offset:number)=>{const p=sample(track,s,offset);return {...p,y:groundHeight(track,p.x,p.z)};};
  const mesh=(geometry:T.BufferGeometry,color:string,emissive=false)=>new T.Mesh(geometry,emissive?new T.MeshBasicMaterial({color}):new T.MeshStandardMaterial({color,roughness:.7}));
  function strip(from:number,to:number,width:number,color:string,height=.09){
    const positions:number[]=[],indices:number[]=[],steps=Math.ceil((to-from)*track.length/3);
    for(let i=0;i<=steps;i++)for(const offset of [-width/2,width/2]){const p=sample(track,from+(to-from)*i/steps,offset);positions.push(p.x,p.y+height,p.z);}
    for(let i=0;i<steps;i++){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();const road=mesh(geometry,color);road.receiveShadow=true;group.add(road);
  }
  for(const sector of track.sectors){
    if(sector.theme==='boardwalk'){strip(sector.from,sector.to,track.width,'#a77649');for(let s=sector.from;s<sector.to;s+=2.4/track.length){const p=sample(track,s);add('box',[p.x,p.y+.105,p.z],[track.width,.025,.07],'#614d40',[0,p.heading,0]);}}
    if(sector.theme==='ruins'||sector.theme==='mine')strip(sector.from,sector.to,track.width,sector.theme==='ruins'?'#bd946a':'#645653');
    if(sector.theme==='reactor')strip(sector.from,sector.to,track.width,'#3e3861');
    if(sector.bridge){
      strip(sector.from,sector.to,track.width+1,'#516075',-.7);
      for(let s=sector.from;s<sector.to;s+=22/track.length)for(const side of [-1,1]){
        const p=sample(track,s,side*(track.width/2+.7)),ground=groundHeight(track,p.x,p.z),h=p.y-ground;
        if(h>2)add('pillar',[p.x,ground+h/2,p.z],[1.6,h,1.6],track.id==='coast'?'#775643':'#62758b');
        add('box',[p.x,p.y+1.5,p.z],[.45,3,.45],track.id==='canyon'?'#925942':'#718aa1');
        if(track.id==='midnight')add('light',[p.x,p.y+3,p.z],[.8,.2,3],'#66efff',[0,p.heading,0]);
      }
    }
  }
  for(const ramp of track.ramps){
    const positions:number[]=[],indices:number[]=[];
    for(let i=0;i<=24;i++)for(const side of [-1,1]){const p=sample(track,ramp.s+i/24*ramp.length/track.length,side*ramp.width/2);positions.push(p.x,p.y+.12+ramp.height*(i/24)**1.2,p.z);}
    for(let i=0;i<24;i++){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();const rampMesh=mesh(geometry,track.id==='midnight'?'#754ac0':'#ea9e36');rampMesh.material.side=T.DoubleSide;rampMesh.castShadow=true;rampMesh.receiveShadow=true;group.add(rampMesh);
    for(let i=1;i<=5;i++){
      const t=i/6,p=sample(track,ramp.s+t*ramp.length/track.length),rise=ramp.height*t**1.2;
      add('light',[p.x,p.y+rise+.15,p.z],[ramp.width-.4,.04,.3],track.id==='midnight'?'#b6ffff':'#fff0ae',[-Math.atan(ramp.height/ramp.length),p.heading,0]);
      for(const side of [-1,1]){const q=sample(track,p.s,side*(ramp.width/2+.2));add('box',[q.x,q.y+rise/2,q.z],[.4,rise+.2,ramp.length/5.5],'#394250',[0,q.heading,0]);}
    }
  }
  for(const tunnel of track.tunnels){
    const count=Math.ceil((tunnel.to-tunnel.from)*track.length/9),radius=track.width/2+3,positions:number[]=[],indices:number[]=[];
    for(let i=0;i<=count;i++){
      const p=sample(track,tunnel.from+(tunnel.to-tunnel.from)*i/count);
      for(let j=0;j<=12;j++){const a=j/12*Math.PI,offset=Math.cos(a)*radius,q=sample(track,p.s,offset);positions.push(q.x,q.y+3+Math.sin(a)*radius,q.z);}
      if(i<count)for(let j=0;j<12;j++){const k=i*13+j;indices.push(k,k+1,k+13,k+1,k+14,k+13);}
      for(const side of [-1,1]){const q=sample(track,p.s,side*radius);add('box',[q.x,q.y+1.5,q.z],[.6,3,.7],tunnel.color,[0,p.heading,0]);const lamp=sample(track,p.s,side*(radius-.8));add('light',[lamp.x,lamp.y+4.5,lamp.z],[.35,.5,1.6],track.id==='canyon'?'#ffd38b':'#65f6f4',[0,p.heading,0]);}
    }
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();const roof=mesh(geometry,tunnel.color);roof.material.side=T.DoubleSide;roof.receiveShadow=true;group.add(roof);
  }
  if(track.id==='coast'){
    for(const s of [.055,.16]){
      const p=at(s,40);add('pillar',[p.x,p.y+13,p.z],[1.2,26,1.2],'#e7bd45');add('box',[p.x+9,p.y+25,p.z],[23,1.2,1.2],'#e7bd45');add('box',[p.x+19,p.y+18,p.z],[.16,14,.16],'#526476');add('box',[p.x+19,p.y+9,p.z],[5,4,5],'#387d8c');
      for(let k=0;k<4;k++)add('box',[p.x-10+k*5,p.y+2,p.z+8],[4.5,4,9],['#e89963','#5caaaf','#e1ba63','#77926b'][k]);
    }
    const falls=at(.56,-36),waterfall=new T.Group();waterfall.position.set(falls.x,falls.y,falls.z);waterfall.rotation.y=falls.heading+Math.PI/2;
    const cliff=mesh(new T.IcosahedronGeometry(1,1),'#527766');cliff.position.y=13;cliff.scale.set(20,24,12);waterfall.add(cliff);
    const water=mesh(new T.BoxGeometry(7,23,.3),'#6ddbdc',true);water.position.set(0,12,11);waterfall.add(water);
    for(let i=0;i<5;i++){const foam=mesh(new T.BoxGeometry(.12,22,.08),'#c8fff1',true);foam.position.set(-3+i*1.4,12,11.2);waterfall.add(foam);}
    const pool=mesh(new T.CircleGeometry(12,32),'#35a8b5');pool.rotation.x=-Math.PI/2;pool.position.set(0,.2,15);waterfall.add(pool);group.add(waterfall);
    for(let i=0;i<70;i++){const s=.48+i/70*.24,p=at(s,(i%2?1:-1)*(24+i%5*5));add('rock',[p.x,p.y+2,p.z],[4,3,4],i%2?'#237150':'#529d50');add('light',[p.x+1,p.y+3,p.z],[.5,.6,.5],i%3?'#f6be8f':'#db89c2');}
    const p=at(.88,62),wheel=new T.Group();wheel.position.set(p.x,p.y+24,p.z);wheel.rotation.y=p.heading;const ring=mesh(new T.TorusGeometry(22,.55,8,72),'#fce5b1');wheel.add(ring);
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2,spoke=mesh(new T.BoxGeometry(.35,44,.35),'#f6e4cc');spoke.rotation.z=a;wheel.add(spoke);const gondola=mesh(new T.BoxGeometry(4,3,3),['#ed7467','#5bb9c6','#e7ba5d'][i%3]);gondola.position.set(Math.sin(a)*22,Math.cos(a)*22,0);wheel.add(gondola);}
    wheel.userData.spin=.07;animated.push(wheel);group.add(wheel);for(const side of [-1,1])add('box',[p.x+side*7,p.y+11,p.z],[1.2,27,1.2],'#d6be8c',[0,0,side*.32]);
    for(let i=0;i<18;i++){const q=at(.75+i*.012,28+i%3*6);add('pillar',[q.x,q.y+2,q.z],[.18,4,.18],'#f2d69d');add('roof',[q.x,q.y+4,q.z],[3,1.4,3],i%2?'#ef8b81':'#70cad4');}
  }else if(track.id==='canyon'){
    for(let i=0;i<16;i++){
      const p=at(i/16+.01,(i%2?1:-1)*(65+i%3*18)),h=25+i%5*10;
      for(let band=0;band<4;band++)add('pillar',[p.x,p.y+(band+.5)*h/4,p.z],[18-band*2,h/4,15-band],['#95513c','#d88b5b','#aa6143','#e6b17e'][band]);
    }
    for(let i=0;i<7;i++){
      const p=at(.72+i*.028,(i%2?1:-1)*35);add('box',[p.x,p.y+3,p.z],[17,6,12],'#b9a078');add('box',[p.x,p.y+7,p.z],[13,2,9],'#d1b789');
      for(const side of [-1,1])add('pillar',[p.x+side*5,p.y+12,p.z],[1.5,8,1.5],'#ddc395');add('box',[p.x,p.y+16,p.z],[13,1.5,3],'#c4a87c');
    }
    for(const s of [.49,.65]){const p=sample(track,s);for(const side of [-1,1]){const q=sample(track,s,side*13);add('box',[q.x,q.y+13,q.z],[2,26,2],'#a4513c',[0,q.heading,0]);}add('box',[p.x,p.y+25,p.z],[28,1.5,1.5],'#c07b52',[0,p.heading,0]);}
    for(let i=0;i<20;i++){const p=at(.27+i*.009,(i%2?1:-1)*19);add('roof',[p.x,p.y+2,p.z],[1.8,5,1.8],i%2?'#d98744':'#70cbbb',[.2,i,0]);}
  }else{
    for(let i=0;i<50;i++){
      const p=at(.45+i*.0038,(i%2?1:-1)*(22+i%4*9));add('pillar',[p.x,p.y+3,p.z],[.7,6,.7],'#746674');add('rock',[p.x,p.y+7,p.z],[4,4,4],i%3?'#d886c9':'#a997e6');add('light',[p.x,p.y+.3,p.z+3],[.7,.5,.7],'#78e6dd');
    }
    for(const s of [.68,.84,.96]){
      const p=at(s,-35);add('pillar',[p.x,p.y+12,p.z],[8,24,8],'#364e70');
      for(const y of [5,14,22]){const ring=mesh(new T.TorusGeometry(11,.6,8,40),'#70eaf0',true);ring.rotation.x=Math.PI/2;ring.position.set(p.x,p.y+y,p.z);group.add(ring);}
      const core=mesh(new T.IcosahedronGeometry(6,1),'#b795ff',true);core.position.set(p.x,p.y+31,p.z);core.userData.spin=.3;group.add(core);animated.push(core);
    }
    for(let i=0;i<16;i++){const p=sample(track,.66+i*.02);const gate=mesh(new T.TorusGeometry(13,.18,6,48,Math.PI),'#8296fa',true);gate.position.set(p.x,p.y+2,p.z);gate.rotation.y=p.heading;group.add(gate);}
  }
  const geometry:Record<Shape,T.BufferGeometry>={box:new T.BoxGeometry(1,1,1),rock:new T.IcosahedronGeometry(1,1),pillar:new T.CylinderGeometry(1,1,1,8),roof:new T.ConeGeometry(1,1,8),light:new T.BoxGeometry(1,1,1)};
  for(const [kind,list] of batch){const mat=kind==='light'?new T.MeshBasicMaterial({color:'white'}):new T.MeshStandardMaterial({color:'white',roughness:.8});const inst=new T.InstancedMesh(geometry[kind],mat,list.length),dummy=new T.Object3D();list.forEach((v,i)=>{dummy.position.fromArray(v.p);dummy.scale.fromArray(v.s);dummy.rotation.set(v.r[0],v.r[1],v.r[2]);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);inst.setColorAt(i,new T.Color(v.c));});inst.castShadow=kind!=='light';inst.receiveShadow=true;inst.computeBoundingSphere();group.add(inst);}
  return {group,animated};
}
