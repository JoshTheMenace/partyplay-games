import { W, H, PLAYER_RADIUS, COAL, IRON_ORE, type TerrainVersion, index, solid } from './model';
import { legacyTerrain } from './legacy';
export function hash(x: number, z: number, seed: number) { let n = Math.imul(x + seed, 374761393) ^ Math.imul(z + 31, 668265263); n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; }
export function terrain(seed:number,_version:TerrainVersion=2) {
  if(_version>=3){const grid=naturalTerrain(seed);if(_version===4)for(let i=0;i<grid.length;i++)if(grid[i]===7&&grid[i+W*W]===6&&hash(i,4,seed)<.35)grid[i]=47;return grid;}
  const grid=new Uint8Array(W*W*H),old=legacyTerrain(seed);
  for(let x=0;x<W;x++)for(let z=0;z<W;z++){
    const edge=Math.min(x,z,W-1-x,W-1-z),channel=Math.min(Math.abs(x-32),Math.abs(x-95),Math.abs(z-32),Math.abs(z-95));
    let h=Math.max(3,Math.floor(10+Math.sin(x*.11+seed*.01)*4+Math.cos(z*.13)*3+Math.sin((x-z)*.055)*4));
    if(edge<9)h=Math.min(h,3+Math.floor(edge*.6));if(channel<4)h=Math.min(h,4+Math.floor(channel*.5));
    const desert=x>95,snow=z<25&&!desert,pine=x<30;
    for(let y=0;y<=Math.max(h,6);y++)grid[index(x,y,z)]=y===0?14:y>h?6:y===h?(h<7?7:desert?18:snow?19:1):y>h-3?(desert?7:2):hash(x+y*31,z,seed)>.95?(y<6?9:8):(snow?17:desert?16:3);
    if(h>7&&!desert&&hash(x,z,seed)>(pine?.953:.984)&&x>3&&z>3&&x<W-4&&z<W-4){for(let y=h+1;y<=h+5;y++)grid[index(x,y,z)]=4;for(let dy=3;dy<=7;dy++){const r=pine?Math.max(0,3-Math.floor((dy-3)/2)):2;for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++)if(Math.abs(dx)+Math.abs(dz)<=r+1)grid[index(x+dx,h+dy,z+dz)]=pine?20:5;}}
  }
  // The original island is embedded unchanged, preserving every version-one build.
  for(let x=0;x<64;x++)for(let z=0;z<64;z++)for(let y=0;y<32;y++)grid[index(x+32,y,z+32)]=old[x+z*64+y*4096]!;
  for(let x=32;x<96;x++)for(let z=32;z<96;z++)for(let y=32;y<H;y++)grid[index(x,y,z)]=0;
  // Four independent exploration landmarks, with walkable bridges across the channels.
  for(const [cx,cz]of [[15,64],[112,64],[64,15],[64,112]]){let ground=H-1;while(ground>1&&!solid(grid[index(cx,ground,cz)]!))ground--;for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++){for(let y=ground+1;y<=ground+7;y++)grid[index(cx+dx,y,cz+dz)]=0;grid[index(cx+dx,ground,cz+dz)]=16;}for(const dx of [-3,3])for(const dz of [-3,3])for(let dy=1;dy<=5;dy++)grid[index(cx+dx,ground+dy,cz+dz)]=dy===5?23:16;for(let dx=-3;dx<=3;dx++)for(const dz of [-3,3])grid[index(cx+dx,ground+6,cz+dz)]=17;grid[index(cx,ground+1,cz)]=9;grid[index(cx,ground+2,cz)]=9;}
  for(const z of [32,95])for(let a=-5;a<=5;a++)for(let x=63;x<=65;x++){if(_version===1&&z+a>=32&&z+a<96)continue;grid[index(x,7,z+a)]=10;for(let y=8;y<=10;y++)grid[index(x,y,z+a)]=0;}
  for(const x of [32,95])for(let a=-5;a<=5;a++)for(let z=63;z<=65;z++){if(_version===1&&x+a>=32&&x+a<96)continue;grid[index(x+a,7,z)]=10;for(let y=8;y<=10;y++)grid[index(x+a,y,z)]=0;}
  return grid;
}
// Continuous terrain: resources occur throughout the world, with no authored route.
function naturalTerrain(seed:number){
  const grid=new Uint8Array(W*W*H),heights=new Uint8Array(W*W);
  for(let x=0;x<W;x++)for(let z=0;z<W;z++){
    const edge=Math.min(x,z,W-1-x,W-1-z),river=Math.abs(x-(29+Math.sin(z*.055+seed)*8));
    let h=Math.floor(16+Math.sin(x*.048+seed*.003)*5+Math.cos(z*.065+seed*.002)*4+Math.sin((x+z)*.1)*2);
    h=Math.min(h,Math.floor(3+edge*.9));if(river<2.5)h=Math.min(h,5);h=Math.max(3,h);heights[x+z*W]=h;
    const desert=x>90&&z>40,snow=z<26&&h>18;
    for(let y=0;y<=Math.max(h,6);y++){
      const ore=hash(Math.floor(x/2)+y*29,Math.floor(z/2),seed),cave=y>2&&y<h-3&&Math.abs(Math.sin(x*.16+seed)+Math.cos(z*.14)+Math.sin(y*.43))<.17;
      grid[index(x,y,z)]=y===0?14:y>h?6:cave?0:y===h?(h<7||desert?7:snow?19:1):y>h-3?(desert?7:2):ore>.977&&y<10?9:ore>.94?IRON_ORE:ore>.89?8:ore>.83?COAL:3;
    }
  }
  for(let x=3;x<W-3;x++)for(let z=3;z<W-3;z++){
    const h=heights[x+z*W]!;if(grid[index(x,h,z)]!==1||hash(x,z,seed)<.972||Math.hypot(x-64,z-66)<3)continue;
    for(let y=1;y<=4;y++)grid[index(x,h+y,z)]=4;
    for(let dy=3;dy<=6;dy++)for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)if((dx||dz||dy>4)&&Math.abs(dx)+Math.abs(dz)<(dy===6?2:4)&&!grid[index(x+dx,h+dy,z+dz)])grid[index(x+dx,h+dy,z+dz)]=5;
  }
  return grid;
}
export function block(grid: Uint8Array,x: number,y: number,z: number) { x=Math.floor(x);y=Math.floor(y);z=Math.floor(z); return x<0||z<0||x>=W||z>=W||y<0?14:y>=H?0:grid[index(x,y,z)]!; }
export function fits(grid: Uint8Array,x: number,y: number,z: number) { for(let a=Math.floor(x-PLAYER_RADIUS);a<=Math.floor(x+PLAYER_RADIUS);a++) for(let b=Math.floor(y+.01);b<=Math.floor(y+1.74);b++) for(let c=Math.floor(z-PLAYER_RADIUS);c<=Math.floor(z+PLAYER_RADIUS);c++) if(solid(block(grid,a,b,c))) return false; return true; }
export function ray(grid: Uint8Array,x: number,y: number,z: number,yaw: number,pitch: number,reach=5) { const dx=-Math.sin(yaw)*Math.cos(pitch),dy=Math.sin(pitch),dz=-Math.cos(yaw)*Math.cos(pitch); let previous={x:Math.floor(x),y:Math.floor(y),z:Math.floor(z)}; for(let d=0;d<=reach;d+=.025) { const p={x:Math.floor(x+dx*d),y:Math.floor(y+dy*d),z:Math.floor(z+dz*d)}; if(![0,6].includes(block(grid,p.x,p.y,p.z))) return { ...p, i:index(p.x,p.y,p.z), previous, distance:d }; previous=p; } return null; }
