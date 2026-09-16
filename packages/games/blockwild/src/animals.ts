import { activeArea } from './chunk-world';
import { graze } from './toolkit';
import { inWorld, BEEF, CARROT, CHICKEN, FEATHER, GRAIN, H, LEATHER, MUTTON, PORK, POTATO, SEEDS, W, WOOL, solid, type Animal, type AnimalKind } from './model';
import { block, hash, ray } from './terrain';
import { emitSound } from './sound-events';
import type { Actor, State } from './server';
export const ANIMAL_LIMIT=48, BABY_SECONDS=300, BREED_COOLDOWN=300;
export const animalFoods=(kind:AnimalKind)=>kind==='chicken'?[SEEDS]:kind==='pig'?[CARROT,POTATO]:[GRAIN];
export const animalHeight=(a:Animal,time:number)=>(a.kind==='chicken'?1.1:a.kind==='cow'?1.46:1.28)*(a.adultAt>time?.55:1);
export function animalFits(s:Pick<State,'grid'|'time'>,a:Animal,x:number,y:number,z:number){const r=(a.kind==='chicken'?.23:.4)*(a.adultAt>s.time?.55:1);for(let dx=Math.floor(x-r);dx<=Math.floor(x+r);dx++)for(let dz=Math.floor(z-r);dz<=Math.floor(z+r);dz++)for(let dy=Math.floor(y+.01);dy<=Math.floor(y+animalHeight(a,s.time));dy++)if(solid(block(s.grid,dx,dy,dz)))return false;return true;}
export function initialAnimals(s:Pick<State,'grid'|'seed'|'time'|'terrainVersion'>):Animal[]{
  if(s.terrainVersion<5)return[];const animals:Animal[]=[];
  for(const [kind,cx,cz] of [['cow',60,68],['sheep',58,32],['pig',30,83],['chicken',78,75]] as const){
    let count=0;for(let r=0;r<24&&count<4;r++)for(let dx=-r;dx<=r&&count<4;dx+=2)for(let dz=-r;dz<=r&&count<4;dz+=2){
      const x=cx+dx+.5,z=cz+dz+.5;if(x<2||z<2||x>W-2||z>W-2||animals.some(a=>Math.hypot(a.x-x,a.z-z)<2))continue;
      let y=H-2;while(y>1&&!solid(block(s.grid,x,y-1,z)))y--;
      const a:Animal={id:animals.length+1,kind,x,y,z,yaw:hash(count,r,s.seed)*6.28,health:kind==='chicken'?2:5,hitAt:0,adultAt:0,loveUntil:0,breedAt:0};
      if(block(s.grid,x,y-1,z)===1&&animalFits(s,a,x,y,z)&&block(s.grid,x,y,z)!==6){animals.push(a);count++;}
    }
  }return animals;
}
export function aimedAnimal(s:State,p:Actor){
  const wall=ray(s.grid,p.x,p.y+1.55,p.z,p.yaw,p.pitch),dx=-Math.sin(p.yaw)*Math.cos(p.pitch),dy=Math.sin(p.pitch),dz=-Math.cos(p.yaw)*Math.cos(p.pitch);
  let nearest:Animal|undefined,reach=Math.min(4,wall?.distance??4);
  for(const a of s.animals){
    const cos=Math.cos(a.yaw),sin=Math.sin(a.yaw),scale=a.adultAt>s.time?.55:1,r=(a.kind==='chicken'?.27:.4)*scale;
    const ox=p.x-a.x,oz=p.z-a.z,origin=[cos*ox-sin*oz,p.y+1.55-a.y,sin*ox+cos*oz],direction=[cos*dx-sin*dz,dy,sin*dx+cos*dz];
    const bounds=[[-r,r],[0,animalHeight(a,s.time)],[(a.kind==='chicken'?-.5:-.92)*scale,.7*scale]];let near=0,far=reach;
    for(let axis=0;axis<3;axis++){const o=origin[axis]!,d=direction[axis]!,[min,max]=bounds[axis]!;if(Math.abs(d)<1e-8){if(o<min!||o>max!)far=-1;}else{const t1=(min!-o)/d,t2=(max!-o)/d;near=Math.max(near,Math.min(t1,t2));far=Math.min(far,Math.max(t1,t2));}}
    if(near<=far&&far>=0&&near<reach){nearest=a;reach=near;}
  }return nearest;
}
export function feedAnimal(s:State,p:Actor,a:Animal){
  if(!animalFoods(a.kind).includes(p.selected))throw new Error(a.kind==='pig'?'Pigs eat carrots or potatoes.':a.kind==='chicken'?'Chickens eat wheat seeds.':'Cows and sheep eat wheat.');
  if(s.mode!=='creative'&&!(p.inventory[p.selected]>0))throw new Error('Hold food from your inventory to feed this animal.');
  if(a.adultAt>s.time)throw new Error('This baby is still growing.');
  if(a.breedAt>s.time)throw new Error(`This ${a.kind} can breed again in ${Math.ceil(a.breedAt-s.time)} seconds.`);
  if(a.loveUntil>s.time)throw new Error('Already fed. Feed a second adult of the same species.');
  if(s.animals.length>=ANIMAL_LIMIT)throw new Error('This world has room for 48 animals.');
  if(s.mode!=='creative')p.inventory[p.selected]--;a.loveUntil=s.time+30;emitSound(s,'eat',a);p.message=`Fed ${a.kind}. Feed another nearby adult to breed them.`;
}
export const animalLoot=(a:Animal,time:number):Record<number,number>=>a.adultAt>time?{}:a.kind==='cow'?{[BEEF]:2,[LEATHER]:1}:a.kind==='sheep'?(a.sheared?{[MUTTON]:2}:{[MUTTON]:2,[WOOL]:1}):a.kind==='pig'?{[PORK]:2}:{[CHICKEN]:1,[FEATHER]:1};
function visible(s:State,a:Animal,b:{x:number;y:number;z:number}){const dx=b.x-a.x,dz=b.z-a.z,dy=b.y+.4-(a.y+.4),d=Math.hypot(dx,dy,dz);const wall=ray(s.grid,a.x,a.y+.4,a.z,Math.atan2(-dx,-dz),Math.atan2(dy,Math.hypot(dx,dz)),d,true);return !wall||wall.distance>d-.2;}
export function tickAnimals(s:State,dt:number,set?:(s:State,i:number,b:number)=>boolean){
  for(let n=0,count=s.animals.length;n<count;n++){const a=s.animals[n]!;if(!activeArea(s,a))continue;if(set)graze(s,a,set);
    const mate=a.adultAt<=s.time&&a.loveUntil>s.time?s.animals.find(b=>b!==a&&b.kind===a.kind&&b.adultAt<=s.time&&b.loveUntil>s.time&&Math.hypot(b.x-a.x,b.z-a.z)<8&&visible(s,a,b)):undefined;
    if(mate&&Math.hypot(mate.x-a.x,mate.y-a.y,mate.z-a.z)<1.6&&s.animals.length<ANIMAL_LIMIT){
      const baby={...a,sheared:false,grazeAt:0,id:Math.max(0,...s.animals.map(b=>b.id))+1,health:a.kind==='chicken'?2:5,adultAt:s.time+BABY_SECONDS,loveUntil:0,breedAt:0,hitAt:0};
      const birth=[[.85,0],[-.85,0],[0,.85],[0,-.85]].find(([dx,dz])=>animalFits(s,baby,a.x+dx!,a.y,a.z+dz!)&&solid(block(s.grid,a.x+dx!,a.y-1,a.z+dz!))&&!s.animals.some(b=>Math.abs(b.y-a.y)<1&&Math.hypot(b.x-a.x-dx!,b.z-a.z-dz!)<.65));
      if(birth){baby.x+=birth[0]!;baby.z+=birth[1]!;a.loveUntil=mate.loveUntil=0;a.breedAt=mate.breedAt=s.time+BREED_COOLDOWN;s.animals.push(baby);emitSound(s,'pickup',baby);}continue;
    }
    const lure=s.players.filter(p=>p.connected&&p.inventory[p.selected]>0&&animalFoods(a.kind).includes(p.selected)&&Math.hypot(p.x-a.x,p.z-a.z)<8&&visible(s,a,p)).sort((p,q)=>Math.hypot(p.x-a.x,p.z-a.z)-Math.hypot(q.x-a.x,q.z-a.z))[0];
    const parent=a.adultAt>s.time?s.animals.find(b=>b.kind===a.kind&&b.adultAt<=s.time&&Math.hypot(b.x-a.x,b.z-a.z)<10):undefined,target=mate??lure??parent;
    const angle=hash(a.id,Math.floor(s.time/5),s.seed)*Math.PI*2,dist=target?Math.hypot(target.x-a.x,target.z-a.z):10;
    a.yaw=target?Math.atan2(a.x-target.x,a.z-target.z):angle;
    const speed=dist<(mate?1:1.8)?0:target?1.4:hash(a.id,Math.floor(s.time/3),s.seed)>.45?.65:0;
    for(const axis of ['x','z'] as const){const delta=(axis==='x'?-Math.sin(a.yaw):-Math.cos(a.yaw))*speed*dt,x=a.x+(axis==='x'?delta:0),z=a.z+(axis==='z'?delta:0);
      if(block(s.grid,x,a.y-.1,z)===6||s.animals.some(b=>b!==a&&Math.abs(a.y-b.y)<1&&Math.hypot(b.x-x,b.z-z)<(a.adultAt>s.time||b.adultAt>s.time?.4:.7)))continue;
      if(animalFits(s,a,x,a.y,z)&&solid(block(s.grid,x,a.y-1,z)))a[axis]+=delta;
      else if(!animalFits(s,a,x,a.y,z)&&animalFits(s,a,x,a.y+1,z)){a[axis]+=delta;a.y++;}
    }
    let fall=Math.min(dt*8,.5);while(fall>0){const step=Math.min(.05,fall);if(!animalFits(s,a,a.x,a.y-step,a.z))break;a.y-=step;fall-=step;}
  }
}
export function readAnimals(raw:unknown,s:Pick<State,'grid'|'seed'|'time'|'terrainVersion'>):Animal[]{
  if(raw===undefined)return initialAnimals(s);
  if(!Array.isArray(raw)||raw.length>ANIMAL_LIMIT)throw new Error('Invalid animals.');const ids=new Set<number>();
  return raw.map((a:Animal)=>{if(!a||(a.sheared!==undefined&&typeof a.sheared!=='boolean')||(a.grazeAt!==undefined&&(!Number.isFinite(a.grazeAt)||a.grazeAt<0||a.grazeAt>1e9+300))||!['cow','sheep','pig','chicken'].includes(a.kind)||!Number.isSafeInteger(a.id)||a.id<1||a.id>1e9||ids.has(a.id)||!['x','y','z','yaw','health','hitAt','adultAt','loveUntil','breedAt'].every(k=>Number.isFinite(a[k as keyof Animal]))||!inWorld(s.terrainVersion,a.x,a.z,.4)||a.y<1||a.y>H||Math.abs(a.yaw)>Math.PI*2||a.health<=0||a.health>5||[a.hitAt,a.adultAt,a.loveUntil,a.breedAt].some(t=>t<0||t>1e9+BABY_SECONDS))throw new Error('Invalid animal.');ids.add(a.id);return{...(a.sheared!==undefined?{sheared:a.sheared}:{}),...(a.grazeAt!==undefined?{grazeAt:a.grazeAt}:{}),id:a.id,kind:a.kind,x:a.x,y:a.y,z:a.z,yaw:a.yaw,health:a.health,hitAt:a.hitAt,adultAt:a.adultAt,loveUntil:a.loveUntil,breedAt:a.breedAt};});
}
