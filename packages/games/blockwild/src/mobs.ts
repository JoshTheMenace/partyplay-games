import { emitSound } from './sound-events';
import { ARROW, BONE, CAMPFIRE, FLESH, GUNPOWDER, H, STRING, TORCH, W, coords, index, isNight, solid, type Creature, type MobKind } from './model';
import { block, hash, ray } from './terrain';
import type { Actor, State } from './server';
const kinds:MobKind[]=['zombie','skeleton','spider','creeper'];
export const mobLoot=(c:Creature):Record<number,number>=>c.kind==='skeleton'?{[BONE]:1,[ARROW]:2}:c.kind==='spider'?{[STRING]:2}:c.kind==='creeper'?{[GUNPOWDER]:1}:{[FLESH]:2};
const eye=(c:Creature)=>c.kind==='spider'?.5:1.45;
function clear(s:State,x:number,y:number,z:number,tx:number,ty:number,tz:number){const dx=tx-x,dy=ty-y,dz=tz-z,d=Math.hypot(dx,dy,dz);const wall=ray(s.grid,x,y,z,Math.atan2(-dx,-dz),Math.atan2(dy,Math.hypot(dx,dz)),d);return !wall||wall.distance>=d-.1;}
export function mobFits(s:State,c:Creature,x:number,y:number,z:number){const r=c.kind==='spider'?.65:.29,h=c.kind==='spider'?.85:1.8;for(let a=Math.floor(x-r);a<=Math.floor(x+r);a++)for(let b=Math.floor(y+.01);b<=Math.floor(y+h);b++)for(let d=Math.floor(z-r);d<=Math.floor(z+r);d++)if(solid(block(s.grid,a,b,d)))return false;return true;}
const exposed=(s:State,c:Creature)=>{for(let y=Math.floor(c.y+1.9);y<H;y++)if(solid(block(s.grid,c.x,y,c.z)))return false;return block(s.grid,c.x,c.y+.5,c.z)!==6;};
export function tickMobs(s:State,dt:number,hurt:(s:State,p:Actor,n:number)=>void,setBlock:(s:State,i:number,b:number)=>boolean){
  const night=isNight(s.time,4),players=s.players.filter(p=>p.connected),lights=[...s.edits].filter(([,b])=>[12,TORCH,CAMPFIRE].includes(b)).map(([i])=>coords(i));
  s.blasts=s.blasts.filter(b=>s.time-b.at<.7);
  s.spawnClock+=dt;
  if(night&&s.spawnClock>6&&s.creatures.length<20&&s.mode==='survival'&&players.length){
    s.spawnClock=0;const id=s.nextCreature++,anchor=players[id%players.length]!,angle=hash(id,3,s.seed)*Math.PI*2,x=anchor.x+Math.cos(angle)*24,z=anchor.z+Math.sin(angle)*24;let y=H-2;
    while(y>1&&!solid(block(s.grid,x,y-1,z)))y--;
    const c:Creature={id,kind:kinds[(id-1)%4]!,x,y,z,health:kinds[(id-1)%4]==='spider'?8:10,hitAt:0,yaw:0,attackAt:0,fuse:0};
    if(x>2&&z>2&&x<W-2&&z<W-2&&mobFits(s,c,x,y,z)&&block(s.grid,x,y,z)!==6&&players.every(p=>Math.hypot(p.x-x,p.z-z)>=16)&&lights.every(l=>Math.hypot(l.x-x,l.y-y,l.z-z)>7))s.creatures.push(c);
  }
  for(const c of s.creatures){
    if(!c.kind)c.kind='zombie';
    if(!night&&['zombie','skeleton'].includes(c.kind)&&exposed(s,c))c.health-=dt;
    const target=players.reduce<Actor|undefined>((best,p)=>!best||Math.hypot(p.x-c.x,p.z-c.z)<Math.hypot(best.x-c.x,best.z-c.z)?p:best,undefined);
    if(!target||s.mode==='creative')continue;
    const d=Math.hypot(target.x-c.x,target.z-c.z),los=clear(s,c.x,c.y+eye(c),c.z,target.x,target.y+1,target.z);
    if(d>55){c.health=0;continue;}c.yaw=Math.atan2(-(target.x-c.x),-(target.z-c.z));
    const angry=c.kind!=='spider'||night||c.hitAt>0,canSee=los&&d<32;
    if(c.kind==='creeper'){
      c.fuse=Math.max(0,Math.min(1.5,(c.fuse??0)+(d<3&&canSee&&Math.abs(target.y-c.y)<2?dt:-dt*2)));
      if(c.fuse>=1.5){
        emitSound(s,'explode',c);s.blasts.push({id:c.id,x:c.x,y:c.y+.8,z:c.z,at:s.time});
        for(const p of players){const distance=Math.hypot(p.x-c.x,p.y-c.y,p.z-c.z);if(distance<4&&clear(s,c.x,c.y+.8,c.z,p.x,p.y+1,p.z))hurt(s,p,Math.max(1,Math.ceil((4-distance)*2)));}
        // Keep station inventories and planted crops intact instead of deleting stored supplies.
        for(let dx=-2;dx<=2;dx++)for(let dy=-1;dy<=2;dy++)for(let dz=-2;dz<=2;dz++){const x=Math.floor(c.x)+dx,y=Math.floor(c.y)+dy,z=Math.floor(c.z)+dz,i=index(x,y,z),b=block(s.grid,x,y,z);if(x<0||z<0||x>=W||z>=W||y<1||y>=H||Math.hypot(dx,dy,dz)>2.4||![1,2,4,5,7,10,11,19,20,21,22,43,45,46].includes(b)||s.chests[i]||s.furnaces[i]||s.farms.some(f=>f.i===i))continue;setBlock(s,i,0);}
        c.health=0;continue;
      }
    }
    if(c.kind==='skeleton'&&canSee&&d<16&&s.time>=(c.attackAt??0)){
      c.attackAt=s.time+2;const dx=target.x-c.x,dz=target.z-c.z,dy=target.y+1-(c.y+1.4),length=Math.max(.1,Math.hypot(dx,dy,dz)),speed=14;
      if(s.projectiles.length<40){emitSound(s,'bow',c);s.projectiles.push({id:s.nextCreature++,x:c.x,y:c.y+1.4,z:c.z,vx:dx/length*speed,vy:dy/length*speed+length*.09,vz:dz/length*speed,expires:s.time+4});}
    }
    const speed=!angry||d<1.2||!canSee&&d>16||(c.fuse??0)>.1?0:c.kind==='skeleton'&&canSee&&d<10?(d<5?-1.5:0):c.kind==='spider'?2.5:1.5;
    let climbing=false;
    for(const axis of ['x','z'] as const){const delta=(target[axis]-c[axis])/Math.max(1,d)*speed*dt,x=c.x+(axis==='x'?delta:0),z=c.z+(axis==='z'?delta:0);if(mobFits(s,c,x,c.y,z))c[axis]+=delta;else if(c.kind==='spider'&&mobFits(s,c,c.x,c.y+dt*2,c.z)){c.y+=dt*2;climbing=true;}else if(mobFits(s,c,x,c.y+1,z)){c[axis]+=delta;c.y+=1;}}
    let fall=climbing?0:Math.min(dt*8,.5);while(fall>0){const step=Math.min(.05,fall);if(!mobFits(s,c,c.x,c.y-step,c.z))break;c.y-=step;fall-=step;}
    if(angry&&c.kind!=='creeper'&&c.kind!=='skeleton'&&d<1.5&&Math.abs(target.y-c.y)<1.5&&los&&s.time>=(c.attackAt??0)){hurt(s,target,c.kind==='zombie'?1.5:1);c.attackAt=s.time+1;}
  }
  s.creatures=s.creatures.filter(c=>c.health>0);
  for(const arrow of s.projectiles){arrow.vy-=3*dt;const steps=Math.max(1,Math.ceil(Math.hypot(arrow.vx,arrow.vy,arrow.vz)*dt/.15));for(let n=0;n<steps;n++){arrow.x+=arrow.vx*dt/steps;arrow.y+=arrow.vy*dt/steps;arrow.z+=arrow.vz*dt/steps;if(solid(block(s.grid,arrow.x,arrow.y,arrow.z))){emitSound(s,'arrow',arrow);arrow.expires=0;break;}const hit=players.find(p=>Math.abs(p.x-arrow.x)<.4&&Math.abs(p.z-arrow.z)<.4&&arrow.y>p.y&&arrow.y<p.y+1.75);if(hit){hurt(s,hit,1.5);arrow.expires=0;break;}}}
  s.projectiles=s.projectiles.filter(a=>a.expires>s.time);
}
