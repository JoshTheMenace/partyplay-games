import * as T from 'three';

type GroundTrack = { id: string };
// The renderer moves its directional light relative to the followed kart by this vector.
export const GROUND_LIGHT_DIRECTION = new T.Vector3(-65,125,-70).normalize();
export const GROUND_PALETTES = {
  coast: { zenith:'#247bbe', horizon:'#bfeaf0', low:'#78adbb', glow:'#fff2c1', cloud:'#fff9e9', shade:'#799fb9', fog:'#b9e0e3', ambient:'#d6efff', ground:'#70845b' },
  canyon: { zenith:'#687ea7', horizon:'#ffd9ac', low:'#cd9070', glow:'#fff1d1', cloud:'#ffe5c7', shade:'#b99694', fog:'#e5b18e', ambient:'#ffe2c0', ground:'#8b5845' },
  midnight: { zenith:'#071127', horizon:'#384362', low:'#1b2947', glow:'#d6e9ff', cloud:'#8295bd', shade:'#273552', fog:'#26354f', ambient:'#a9c8fa', ground:'#363553' },
};
const style = (track:GroundTrack) => track.id==='canyon'?'canyon':track.id==='midnight'?'midnight':'coast';
const noise = `
float artHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float artNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(artHash(i),artHash(i+vec2(1,0)),f.x),mix(artHash(i+vec2(0,1)),artHash(i+vec2(1,1)),f.x),f.y);}
float artFbm(vec2 p){return artNoise(p)*0.57+artNoise(p*2.03+17.0)*0.28+artNoise(p*4.07+41.0)*0.15;}
`;

// A small density/height texture is generated once per world, without DOM or external assets.
function cloudTexture(){
  const size=128,data=new Uint8Array(size*size*4);
  const lobes=[[-.48,-.09,.27],[-.26,.10,.33],[.03,.18,.34],[.34,.03,.30],[.54,-.10,.19],[-.03,-.13,.38]];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=(x/(size-1)-.5)*2,v=(y/(size-1)-.5)*2;let density=0;
    for(const [cx,cy,r] of lobes)density+=Math.exp(-((u-cx)**2+(v-cy)**2*1.7)/(r*r)*2.5);
    const edge=T.MathUtils.smoothstep(density,.09,.74),i=(y*size+x)*4;
    data[i]=Math.round(edge*255);data[i+1]=Math.round(Math.min(1,density*.58)*255);data[i+2]=0;data[i+3]=255;
  }
  const texture=new T.DataTexture(data,size,size);texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}

export function createGroundAtmosphere(track:GroundTrack){
  const kind=style(track),palette=GROUND_PALETTES[kind],night=kind==='midnight',group=new T.Group();group.name=`${kind}-atmosphere`;
  const sunDirection=GROUND_LIGHT_DIRECTION.clone(),time={value:0};
  const skyMaterial=new T.ShaderMaterial({
    side:T.BackSide,depthWrite:false,depthTest:false,fog:false,
    uniforms:{zenith:{value:new T.Color(palette.zenith)},horizon:{value:new T.Color(palette.horizon)},low:{value:new T.Color(palette.low)},glow:{value:new T.Color(palette.glow)},lightDirection:{value:sunDirection},night:{value:night?1:0}},
    vertexShader:`varying vec3 direction;void main(){direction=position;vec4 p=projectionMatrix*vec4(mat3(viewMatrix)*position,1.0);gl_Position=p.xyww;}`,
    fragmentShader:`
      uniform vec3 zenith,horizon,low,glow,lightDirection;uniform float night;varying vec3 direction;
      ${noise}
      void main(){
        vec3 d=normalize(direction);float elevation=max(0.0,d.y);
        vec3 color=mix(horizon,zenith,pow(elevation,0.58));color=mix(low,color,smoothstep(-0.2,0.08,d.y));
        float alignment=clamp(dot(d,lightDirection),-1.0,1.0),angle=acos(alignment);
        color+=glow*(pow(max(0.0,alignment),12.0)*0.10+exp(-angle*angle/0.016)*0.30)*(1.0-night*0.55);
        float radius=mix(0.026,0.033,night),disc=1.0-smoothstep(radius-0.0015,radius+0.0015,angle);
        float craters=artFbm(d.xz*185.0)*0.4+0.6;
        color=mix(color,glow*mix(1.8,craters*1.28,night),disc);
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky=new T.Mesh(new T.SphereGeometry(1,40,24),skyMaterial);sky.name='gradient-sky-sun-moon';sky.frustumCulled=false;sky.renderOrder=-1000;group.add(sky);
  let seed=kind==='canyon'?8941:kind==='midnight'?2731:1237;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const centers:number[]=[],sizes:number[]=[],phases:number[]=[],opacities:number[]=[],count=kind==='canyon'?20:30;
  for(let i=0;i<count;i++){
    const angle=i/count*Math.PI*2+random()*.24,radius=360+random()*1050,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius,y=310+random()*210,w=(kind==='canyon'?130:95)+random()*130;
    for(let layer=0;layer<3;layer++){
      centers.push(x+(layer-1)*w*.13,y+(layer-1)*12,z+(layer-1)*18);
      sizes.push(w*(1.3-layer*.16),w*(kind==='canyon'?.25:.37));phases.push(random()*6.28);opacities.push([.22,.56,.34][layer]*(night?.65:1));
    }
  }
  const quad=new T.PlaneGeometry(1,1),geometry=new T.InstancedBufferGeometry();geometry.index=quad.index;geometry.attributes=quad.attributes;
  geometry.setAttribute('cloudCenter',new T.InstancedBufferAttribute(new Float32Array(centers),3));geometry.setAttribute('cloudSize',new T.InstancedBufferAttribute(new Float32Array(sizes),2));geometry.setAttribute('cloudPhase',new T.InstancedBufferAttribute(new Float32Array(phases),1));geometry.setAttribute('cloudOpacity',new T.InstancedBufferAttribute(new Float32Array(opacities),1));geometry.instanceCount=count*3;
  if(night){
    const positions:number[]=[],twinkles:number[]=[];
    for(let i=0;i<720;i++){const a=random()*Math.PI*2,y=.035+random()*.965,r=Math.sqrt(1-y*y);positions.push(Math.cos(a)*r,y,Math.sin(a)*r);twinkles.push(random()*6.28);}
    const starsGeometry=new T.BufferGeometry();starsGeometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));starsGeometry.setAttribute('phase',new T.Float32BufferAttribute(twinkles,1));
    const starsMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,depthTest:false,uniforms:{time},
      vertexShader:`attribute float phase;uniform float time;varying float brightness;void main(){brightness=(0.65+0.2*sin(time*0.6+phase))*smoothstep(0.02,0.22,position.y);vec4 p=projectionMatrix*vec4(mat3(viewMatrix)*position,1.0);gl_Position=p.xyww;gl_PointSize=1.3+0.9*fract(phase);}`,
      fragmentShader:`varying float brightness;void main(){float alpha=(1.0-smoothstep(0.06,0.5,length(gl_PointCoord-0.5)))*brightness;gl_FragColor=vec4(vec3(0.7,0.83,1.0),alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>}`,
    });
    const stars=new T.Points(starsGeometry,starsMaterial);stars.name='moonlit-stars';stars.frustumCulled=false;stars.renderOrder=-999;group.add(stars);
  }
  const texture=cloudTexture(),cloudMaterial=new T.ShaderMaterial({
    transparent:true,depthWrite:false,fog:false,
    uniforms:{densityMap:{value:texture},time,cloudColor:{value:new T.Color(palette.cloud)},shadeColor:{value:new T.Color(palette.shade)},hazeColor:{value:new T.Color(palette.horizon)},lightDirection:{value:sunDirection}},
    vertexShader:`attribute vec3 cloudCenter;attribute vec2 cloudSize;attribute float cloudPhase,cloudOpacity;uniform float time;varying vec2 vUv;varying float opacity,distanceToCloud;void main(){vUv=uv;opacity=cloudOpacity;vec3 center=cloudCenter;center.x+=sin(time*0.009+cloudPhase)*22.0;center.z+=cos(time*0.006+cloudPhase)*10.0;vec4 p=modelViewMatrix*vec4(center,1.0);distanceToCloud=length(p.xyz);p.xy+=position.xy*cloudSize;gl_Position=projectionMatrix*p;}`,
    fragmentShader:`uniform sampler2D densityMap;uniform vec3 cloudColor,shadeColor,hazeColor,lightDirection;varying vec2 vUv;varying float opacity,distanceToCloud;void main(){
      vec2 density=texture2D(densityMap,vUv).rg;float alpha=density.r*opacity;if(alpha<0.003)discard;
      vec3 n=normalize(vec3((vUv-0.5)*vec2(1.35,1.8),0.65+density.g));vec3 light=normalize((viewMatrix*vec4(lightDirection,0.0)).xyz);
      float lighting=clamp(0.5+dot(n,light)*0.38+(vUv.y-0.5)*0.38,0.0,1.0);
      vec3 color=mix(shadeColor,cloudColor,lighting);color+=cloudColor*pow(1.0-density.g,3.0)*0.10;
      color=mix(color,hazeColor,smoothstep(700.0,1800.0,distanceToCloud)*0.65);
      gl_FragColor=vec4(color,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  // disposeObject discovers texture properties on materials, including custom shader resources.
  Object.assign(cloudMaterial,{map:texture});
  const clouds=new T.Mesh(geometry,cloudMaterial);clouds.name='layered-cloud-bank';clouds.frustumCulled=false;clouds.renderOrder=1;group.add(clouds);
  return {group,update(seconds:number){time.value=seconds;}};
}

export function createTerrainMaterial(track:GroundTrack){
  const kind=style(track),material=new T.MeshStandardMaterial({vertexColors:true,roughness:.94});material.name=`${kind}-detailed-ground`;
  material.customProgramCacheKey=()=>`ground-art-v1-${kind}`;
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 artWorld;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nartWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 artWorld;${noise}`);
    const common=`
      vec2 p=artWorld.xz;vec3 biome=diffuseColor.rgb;
      float broad=artFbm(p*0.075),detailFade=1.0-smoothstep(0.25,1.1,length(fwidth(p)));
      float grain=(artNoise(p*2.8)-0.5)*detailFade;
      float artHeight=0.0,artRoughness=0.94;
    `;
    const surface=kind==='canyon'?`
      float strata=sin(artWorld.y*1.25+artFbm(p*0.025)*5.0);
      float bedding=smoothstep(0.72,0.93,strata)*(1.0-smoothstep(0.6,2.0,fwidth(artWorld.y*1.25)));
      float fineStrata=sin(artWorld.y*4.8+broad*2.0)*0.025*(1.0-smoothstep(0.4,1.6,fwidth(artWorld.y*4.8)));
      diffuseColor.rgb*=0.88+broad*0.23+grain*0.11+fineStrata;
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.18,1.08,0.9),bedding*0.27);
      artHeight=broad*0.14+grain*0.025;artRoughness=0.92;
    `:kind==='coast'?`
      float sand=max(1.0-smoothstep(-1.8,2.8,artWorld.y),smoothstep(0.0,0.16,biome.r-biome.g));
      float jungle=(1.0-smoothstep(0.25,0.50,biome.g))*(1.0-sand);
      float grass=artNoise(p*vec2(2.4,0.55))*detailFade;
      diffuseColor.rgb*=0.83+broad*0.29+grain*mix(0.075,0.19,1.0-sand);
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.86,1.08,0.89),jungle*(0.18+broad*0.18));
      float dunes=sin(p.x*0.33+p.y*0.13+broad*4.0)*0.035;
      diffuseColor.rgb+=biome*(dunes*sand+grass*0.04*(1.0-sand));
      artHeight=(broad*0.07+grain*0.025)*(1.0-sand*.65);artRoughness=mix(0.96,0.88,sand);
    `:`
      float garden=smoothstep(0.5,0.83,biome.g/max(0.001,biome.b));
      vec2 tile=p/2.8,edge=abs(fract(tile)-0.5),aa=max(fwidth(tile),vec2(0.002));
      vec2 seam=smoothstep(vec2(0.468)-aa,vec2(0.495),edge);float joint=max(seam.x,seam.y);
      vec2 panelEdge=abs(fract(p/18.0)-0.5);float panelAA=max(0.001,length(fwidth(p/18.0)));float panel=smoothstep(0.478-panelAA,0.5,max(panelEdge.x,panelEdge.y));
      float slab=mix(0.5,artHash(floor(tile)),detailFade);diffuseColor.rgb*=mix(0.9+slab*0.13-joint*0.17-panel*0.12,0.84+broad*0.28,garden)+grain*0.07;
      artHeight=mix((1.0-joint)*0.022,broad*0.06,garden);artRoughness=mix(0.78,0.98,garden);
    `;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\n${common}${surface}`)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=artRoughness;')
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec3 q0=dFdx(-vViewPosition),q1=dFdy(-vViewPosition),r1=cross(q1,normal),r2=cross(normal,q0);
        float determinant=dot(q0,r1);normal=normalize(abs(determinant)*normal-sign(determinant)*(dFdx(artHeight)*r1+dFdy(artHeight)*r2));
      `);
  };
  return material;
}

export function createOceanMaterial(){
  const material=new T.MeshStandardMaterial({color:'#168f9e',roughness:.28,metalness:.2}),time={value:0};material.name='coast-moving-water';
  material.userData.update=(seconds:number)=>{time.value=seconds;};
  material.customProgramCacheKey=()=> 'ground-art-ocean-v1';
  material.onBeforeCompile=shader=>{
    shader.uniforms.artTime=time;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 artWorld;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nartWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 artWorld;uniform float artTime;')
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec2 p=artWorld.xz;float a=p.x*0.27+p.y*0.13-artTime*1.3,b=p.x*-0.19+p.y*0.31-artTime*0.87;
        float wave=sin(a)+sin(b)*0.48;diffuseColor.rgb*=0.93+wave*0.06;
        float sheen=pow(max(0.0,sin(a*.47+b*.28)),12.0);diffuseColor.rgb+=vec3(0.015,0.035,0.035)*sheen;
      `)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        float waveFade=1.0-smoothstep(1.0,4.0,length(fwidth(p)));
        vec3 waterNormal=normalize(vec3(-(cos(a)*0.27-cos(b)*0.091)*0.24*waveFade,1.0,-(cos(a)*0.13+cos(b)*0.149)*0.24*waveFade));
        normal=normalize((viewMatrix*vec4(waterNormal,0.0)).xyz);
      `);
  };
  return material;
}
