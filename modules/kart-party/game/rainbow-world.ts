import * as T from 'three';
import { disposeObject } from './dispose';
import { createCoinViews, createPickupInstances } from './powerup-models';
import { bankAt, mod, sample, surfaceFrame, magneticAt, TRACKS, type Track } from './tracks';
import type { Racer } from './types';
import type { World } from './world';
import { createTurnGuides } from './turn-guides';

const basis=(f:ReturnType<typeof surfaceFrame>)=>new T.Matrix4().makeBasis(new T.Vector3(f.right.x,f.right.y,f.right.z),new T.Vector3(f.up.x,f.up.y,f.up.z),new T.Vector3(f.forward.x,f.forward.y,f.forward.z));
const spectrum=(h:number,l=.57)=>new T.Color().setHSL(mod(h),.88,l);
const glow=(color:T.ColorRepresentation,opacity=1)=>new T.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:opacity===1,side:T.DoubleSide});
const paint=(color:T.ColorRepresentation)=>new T.MeshStandardMaterial({color,metalness:.45,roughness:.35});
type Piece={position:T.Vector3;scale:T.Vector3;rotation:T.Euler;color:T.Color};
function batch(group:T.Group,geometry:T.BufferGeometry,pieces:Piece[],lit=false){
  const mesh=new T.InstancedMesh(geometry,lit?glow('white'):paint('white'),pieces.length),dummy=new T.Object3D();
  pieces.forEach((p,i)=>{dummy.position.copy(p.position);dummy.scale.copy(p.scale);dummy.rotation.copy(p.rotation);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,p.color);});
  mesh.castShadow=!lit;mesh.receiveShadow=!lit;mesh.computeBoundingSphere();group.add(mesh);return mesh;
}
function ribbon(track:Track,left:number,right:number,height:number,from=0,to=1){
  const positions:number[]=[],uv:number[]=[],indices:number[]=[],steps=Math.max(2,Math.ceil((to-from)*track.length/1.5));
  // Narrow cross-road cells follow the twisting loop surface; a single wide
  // diagonal triangle can cut through the kart on the inverted bend.
  const columns=from===0&&to===1?Math.max(1,Math.ceil(Math.abs(right-left)/3)):1;
  for(let i=0;i<=steps;i++)for(let j=0;j<=columns;j++){const offset=left+(right-left)*j/columns,s=from+(to-from)*i/steps,p=surfaceFrame(track,s,offset,height).position;positions.push(p.x,p.y,p.z);uv.push(s*track.length/6,(offset+track.width/2)/track.width);}
  for(let i=0;i<steps;i++)for(let j=0;j<columns;j++){const k=i*(columns+1)+j,n=k+columns+1;indices.push(k,n,k+1,k+1,n,n+1);}
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
const vertex=`varying vec2 vUv; varying vec3 vPosition; varying vec3 vNormal;
void main(){vUv=uv;vPosition=position;vNormal=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const rainbowFragment=`uniform float time; varying vec2 vUv; varying vec3 vPosition; varying vec3 vNormal;
vec3 hue(float h){return clamp(abs(fract(h+vec3(0.,.6667,.3333))*6.-3.)-1.,0.,1.);}
void main(){
  vec3 color=mix(vec3(.12),hue(vUv.y*.82+vUv.x*.004),.88);
  vec2 tile=abs(fract(vec2(vUv.x,vUv.y*7.))-.5);
  float seams=smoothstep(.465,.495,max(tile.x,tile.y));
  float pulse=pow(max(0.,sin(vUv.x*.23-time*.7)),16.)*.09;
  color=color*(.68-seams*.32)+vec3(.15,.18,.24)*seams+color*pulse;
  gl_FragColor=vec4(color,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** A separate world keeps the space course free of the other tracks' ground, houses, and clouds. */
export function rainbowScenery(track:Track){
  const group=new T.Group(),animated:T.Object3D[]=[],uniforms={time:{value:0}};
  const road=new T.Mesh(ribbon(track,-track.width/2,track.width/2,.045),new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:rainbowFragment,side:T.DoubleSide}));road.name='prismatic-road';group.add(road);
  group.add(new T.Mesh(ribbon(track,-track.width/2-1.6,track.width/2+1.6,-.4),paint('#171b3a')));
  const posts:Piece[]=[],lights:Piece[]=[],rocks:Piece[]=[],crystals:Piece[]=[];
  const piece=(list:Piece[],s:number,offset:number,y:number,scale:number[],color:T.Color,rotation?:T.Euler)=>{const frame=surfaceFrame(track,s,offset,y),p=frame.position;list.push({position:new T.Vector3(p.x,p.y,p.z),scale:new T.Vector3(...scale as [number,number,number]),rotation:magneticAt(track,s)?new T.Euler().setFromRotationMatrix(basis(frame)):rotation??new T.Euler(0,sample(track,s).heading,bankAt(track,s),'YXZ'),color});};
  for(const side of [-1,1]){
    group.add(new T.Mesh(ribbon(track,side*track.width/2,side*(track.width/2+1.5),.04),paint('#293351')));
    const edge=side*(track.width/2+1.5);
    for(const [width,height,alpha] of [[.13,.25,1],[.12,1.3,1],[.5,1.3,.13]]){
      const line=new T.Mesh(ribbon(track,edge-width,edge+width,height),glow(side===1?'#ffd2f2':'#95fff4',alpha));line.name='safety-rail';group.add(line);
    }
    for(let i=0;i<track.length/15;i++)piece(posts,i*15/track.length,edge,.65,[.22,1.3,.24],new T.Color('#657194'));
    for(let i=0;i<track.length/7;i++)piece(lights,i*7/track.length,side*(track.width/2+.72),.11,[.55,.06,2.6],spectrum(i*.014+side*.1,.65));
  }
  // Stars across the deck, reflective chevrons, and launch pads make the fast route readable.
  const star=new T.Shape();for(let i=0;i<10;i++){const a=i*Math.PI/5,r=i%2?.38:.9;if(i)star.lineTo(Math.sin(a)*r,Math.cos(a)*r);else star.moveTo(0,r);}star.closePath();
  const stars:Piece[]=[];
  for(let i=0;i<track.length/28;i++)if(!magneticAt(track,(i*28+16)/track.length))piece(stars,(i*28+16)/track.length,0,.075,[1,1,1],spectrum(.09+i*.006,.8),new T.Euler(-Math.PI/2,0,-sample(track,(i*28+16)/track.length).heading));
  batch(group,new T.ShapeGeometry(star),stars,true);
  const finish:Piece[]=[];
  for(let row=0;row<4;row++)for(let col=0;col<16;col++)piece(finish,row*1.35/track.length,(col-7.5)*1.35,.09,[1.35,.03,1.35],new T.Color((row+col)%2?'#fff7e8':'#171b36'));
  batch(group,new T.BoxGeometry(1,1,1),finish,true);
  for(const s of track.boosts)for(let i=0;i<3;i++)for(const side of [-1,1])piece(lights,s+(i-1)*2/track.length,side*1.6,.16,[3.8,.09,.6],new T.Color('#bffffa'),new T.Euler().setFromRotationMatrix(basis(surfaceFrame(track,s+(i-1)*2/track.length)).multiply(new T.Matrix4().makeRotationY(side*.58))));
  for(const ramp of track.ramps){
    const geometry=ribbon(track,-ramp.width/2,ramp.width/2,.1,ramp.s,ramp.s+ramp.length/track.length),position=geometry.attributes.position;
    for(let i=0;i<position.count;i++){const progress=Math.floor(i/2)/(position.count/2-1);position.setY(i,position.getY(i)+ramp.height*progress**1.2);}
    geometry.computeVertexNormals();group.add(new T.Mesh(geometry,new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:rainbowFragment,side:T.DoubleSide})));
    for(let i=1;i<=6;i++){const s=ramp.s+i/7*ramp.length/track.length,p=sample(track,s);piece(lights,s,0,ramp.height*(i/7)**1.2+.15,[ramp.width-.3,.07,.3],new T.Color('#faffce'),new T.Euler(-Math.atan(ramp.height/ramp.length),p.heading,bankAt(track,s),'YXZ'));}
  }
  function arch(s:number,color:string,height=19){
    if(magneticAt(track,s))return;
    const p=sample(track,s),curve=new T.CatmullRomCurve3(Array.from({length:25},(_,i)=>{const a=i/24*Math.PI;return new T.Vector3(Math.cos(a)*(track.width/2+4),2+Math.sin(a)*height,0);}));
    const g=new T.Group();g.position.set(p.x,p.y,p.z);g.rotation.y=p.heading;g.add(new T.Mesh(new T.TubeGeometry(curve,48,.16,6,false),glow(color)),new T.Mesh(new T.TubeGeometry(curve,48,.65,6,false),glow(color,.09)));group.add(g);
  }
  for(const s of [0,.012,.26,.48,.73])arch(s,'#ffe2fb',s===0?15:21);
  if(track.magnetic){
    for(let i=0;i<24;i++){const s=track.magnetic.from+i*track.magnetic.length/24/track.length;for(const side of [-1,1])piece(lights,s,side*10.5,.10,[.35,.10,2.8],spectrum(i/24,.78));}
  }
  // Prism Ascent: suspended crystal gardens and open spectral gates.
  for(let i=0;i<44;i++){const s=.015+i*.0052;piece(crystals,s,(i%2?1:-1)*(24+i%4*4),-2+i%3*2,[2+i%3,10+i%5*2,2+i%3],spectrum(i*.044,.63),new T.Euler(.12*Math.sin(i),i,.2*Math.cos(i)));}
  for(const s of [.055,.09,.18,.22])arch(s,'#b8e7ff',24);
  for(const s of [.29,.34,.445]){
    const p=sample(track,s),orbit=new T.Group();orbit.position.set(p.x,p.y+18,p.z);orbit.rotation.set(0,p.heading,.12,'YXZ');
    orbit.add(new T.Mesh(new T.TorusGeometry(27,.28,8,96),glow('#ffd9a7')),new T.Mesh(new T.TorusGeometry(27,.85,8,96),glow('#ff9fb9',.13)));group.add(orbit);
  }
  // Aurora Cathedral: tall light ribs and translucent curtains outside the racing envelope.
  for(let i=0;i<12;i++)arch(.49+i*.018,i%2?'#93ffee':'#f8a9ec',25+Math.sin(i/11*Math.PI)*12);
  for(const side of [-1,1]){
    const geo=ribbon(track,side*24,side*24+.01,8,(track.magnetic?.to??.49)+.01,.77),pos=geo.attributes.position;
    for(let i=0;i<pos.count;i++)pos.setY(i,pos.getY(i)+(i%2?34+Math.sin(i*.12)*8:0));
    geo.computeVertexNormals();
    const curtain=new T.Mesh(geo,new T.ShaderMaterial({uniforms,vertexShader:vertex,transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,fragmentShader:`uniform float time; varying vec2 vUv; varying vec3 vPosition; varying vec3 vNormal; void main(){float waves=.5+.5*sin(vPosition.x*.05+vPosition.z*.04+time*.22);vec3 c=mix(vec3(.05,.85,.65),vec3(.45,.12,.8),waves);gl_FragColor=vec4(c,.12+.12*waves); #include <colorspace_fragment> }`.replace(' #include','\n#include')}));group.add(curtain);
  }
  // Meteor Sprint: rocks stay outside the guardrails, with streaks pointing along the racing line.
  for(let i=0;i<60;i++){
    const s=.735+i*.0042,side=i%2?1:-1;piece(rocks,s,side*(32+i%7*6),-8+(i%6)*6,[3+i%4,3+i%3,4+i%5],new T.Color().setHSL(.64+i*.001,.25,.2+(i%3)*.055),new T.Euler(i,i*.7,i*.3));
    if(i%3===0)piece(crystals,s,side*(36+i%7*6),3+i%5*5,[.5,.5,7],spectrum(.02+i*.012,.67));
  }
  batch(group,new T.BoxGeometry(1,1,1),posts);batch(group,new T.BoxGeometry(1,1,1),lights,true);
  batch(group,new T.IcosahedronGeometry(1,1),rocks);batch(group,new T.OctahedronGeometry(1),crystals);
  const nebula=new T.Mesh(new T.SphereGeometry(4100,32,16),new T.ShaderMaterial({vertexShader:vertex,side:T.BackSide,depthWrite:false,fragmentShader:`varying vec2 vUv;varying vec3 vPosition;varying vec3 vNormal;
void main(){vec3 p=normalize(vPosition);float band=exp(-pow((p.y-.18+sin(p.x*3.)*.13)/.23,2.));float dust=.5+.5*sin(p.x*18.+sin(p.z*14.)*2.+sin(p.y*17.));dust*=.6+.4*sin(p.z*32.+sin(p.x*27.));vec3 cloud=mix(vec3(.03,.065,.13),vec3(.10,.025,.16),.5+.5*sin(p.x*4.+p.z*6.));gl_FragColor=vec4(vec3(.0015,.0018,.007)+cloud*band*(.2+dust*.8),1.);
#include <colorspace_fragment>
}`}));nebula.position.y=250;nebula.renderOrder=-1000;group.add(nebula);
  let seed=991;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  const positions:number[]=[],colors:number[]=[];
  for(let i=0;i<4200;i++){const a=random()*Math.PI*2,z=random()*2-1,r=2100+random()*300,k=Math.sqrt(1-z*z);positions.push(Math.cos(a)*k*r,250+z*r,Math.sin(a)*k*r);const c=spectrum(random(),.75+random()*.24);colors.push(c.r,c.g,c.b);}
  const starfield=new T.BufferGeometry();starfield.setAttribute('position',new T.Float32BufferAttribute(positions,3));starfield.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  group.add(new T.Points(starfield,new T.PointsMaterial({vertexColors:true,size:2.3,sizeAttenuation:false,transparent:true,opacity:.8,depthWrite:false})));
  function planet(position:T.Vector3,radius:number,colors:[string,string],rings=false){
    const p=new T.Group();p.position.copy(position);
    const surface=new T.Mesh(new T.SphereGeometry(radius,64,32),new T.ShaderMaterial({uniforms:{a:{value:new T.Color(colors[0])},b:{value:new T.Color(colors[1])}},vertexShader:vertex,fragmentShader:`uniform vec3 a;uniform vec3 b;varying vec2 vUv;varying vec3 vPosition;varying vec3 vNormal;
void main(){float bands=.5+.5*sin(vUv.y*65.+sin(vUv.x*20.)*1.2+sin(vUv.y*28.)*2.);float light=.26+.74*max(0.,dot(normalize(vNormal),normalize(vec3(-.5,.7,.8))));gl_FragColor=vec4(mix(a,b,bands)*light,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`}));p.add(surface);
    const halo=new T.Mesh(new T.SphereGeometry(radius*1.035,48,24),new T.ShaderMaterial({uniforms:{color:{value:new T.Color(colors[1])}},transparent:true,depthWrite:false,blending:T.AdditiveBlending,vertexShader:`varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,fragmentShader:`uniform vec3 color;varying vec3 n;varying vec3 v;void main(){float rim=pow(1.-max(0.,dot(normalize(n),normalize(v))),3.);gl_FragColor=vec4(color,rim*.7);}`}));p.add(halo);
    if(rings){const ring=new T.Group();ring.rotation.set(1.14,.16,.28);for(const [inner,outer,alpha,color]of [[1.3,1.5,.7,'#ce9eee'],[1.52,1.68,.55,'#88d9f3'],[1.7,1.91,.65,'#f1b9cc'],[1.96,2.03,.5,'#fcdfad']] as const)ring.add(new T.Mesh(new T.RingGeometry(radius*inner,radius*outer,128),glow(color,alpha)));p.add(ring);}group.add(p);
  }
  planet(new T.Vector3(-1100,-440,200),650,['#3b357c','#bd84cc'],true);
  planet(new T.Vector3(650,590,1120),255,['#604977','#e1b4c0'],true);
  planet(new T.Vector3(850,700,-1100),120,['#a36d62','#ffdf9f']);
  // A distant spiral makes the sky recognizable from the starting straight without obscuring the road.
  const galaxyPositions:number[]=[],galaxyColors:number[]=[];
  for(let i=0;i<1800;i++){const r=40+random()*550,a=r*.016+(i%3)*Math.PI*2/3+(random()-.5)*.7;galaxyPositions.push(900+Math.cos(a)*r,880+Math.sin(a)*r*.33,-1550+(random()-.5)*50);const c=spectrum(.65+random()*.25,.58+random()*.3);galaxyColors.push(c.r,c.g,c.b);}
  const galaxy=new T.BufferGeometry();galaxy.setAttribute('position',new T.Float32BufferAttribute(galaxyPositions,3));galaxy.setAttribute('color',new T.Float32BufferAttribute(galaxyColors,3));group.add(new T.Points(galaxy,new T.PointsMaterial({vertexColors:true,size:5,sizeAttenuation:true,transparent:true,opacity:.6,depthWrite:false,blending:T.AdditiveBlending})));
  return {group,animated,update:(time:number)=>{uniforms.time.value=time;}};
}

export function createRainbowWorld():World{
  const track=TRACKS.rainbow,{group,animated,update}=rainbowScenery(track),dummy=new T.Object3D();let time=0;
  group.add(createTurnGuides(track));
  const coins=createPickupInstances('field_coin',track.coins.length);group.add(coins.group);
  // Per-camera instance visibility avoids 108 separate coin draw calls in phone and split-screen races.
  const coinViews=createCoinViews(coins,track.coins.map(coin=>{const frame=surfaceFrame(track,coin.s,coin.offset,1.5),p=frame.position;return {position:new T.Vector3(p.x,p.y,p.z),quaternion:new T.Quaternion().setFromRotationMatrix(basis(frame))};}));
  const prepareView=(racer?:Racer)=>coinViews(time,i=>!!racer?.coinsTaken?.includes((racer.lap-1)*track.coins.length+i));
  prepareView();coins.commit(true);
  const boxes=track.boxes.flatMap(s=>[-5,0,5].map(offset=>({s,offset}))),pickups=createPickupInstances('item_box',boxes.length);group.add(pickups.group);
  const tick=(now:number)=>{time=now;update(now);boxes.forEach((box,i)=>{const frame=surfaceFrame(track,box.s,box.offset,2.2+Math.sin(now*2+i)*.22),p=frame.position;dummy.position.set(p.x,p.y,p.z);dummy.quaternion.setFromRotationMatrix(basis(frame));dummy.rotateY(now*.65);dummy.rotateZ(Math.PI/4);dummy.scale.setScalar(1);dummy.updateMatrix();pickups.setMatrixAt(i,dummy.matrix);});pickups.commit();prepareView();};tick(0);pickups.commit(true);
  return {group,track,animated,boxes:[],coins:[],prepareView,update:tick,dispose(){disposeObject(group);}};
}
