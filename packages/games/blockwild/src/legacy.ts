const W=64,H=32,index=(x:number,y:number,z:number)=>x+z*W+y*W*W;
export function hash(x: number, z: number, seed: number) { let n = Math.imul(x + seed, 374761393) ^ Math.imul(z + 31, 668265263); n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; }
export function height(x: number, z: number, seed: number) { const edge = Math.min(x,z,W-1-x,W-1-z); return Math.max(3, Math.min(18, Math.floor(8 + Math.sin(x*.15+seed*.01)*2 + Math.cos(z*.17)*2 + Math.sin((x+z)*.09)*2 + Math.min(0,edge-8)*.7))); }
export function legacyTerrain(seed: number) {
  const grid = new Uint8Array(W*W*H);
  for (let x=0;x<W;x++) for(let z=0;z<W;z++) {
    const h = height(x,z,seed);
    for(let y=0;y<=Math.max(h,6);y++) grid[index(x,y,z)] = y===0?14:y>h?6:y===h?(h<=6?7:1):y>h-3?2:hash(x+y*31,z,seed)>.945?(y<5?9:8):3;
    if(h>7 && x>3 && z>3 && x<W-4 && z<W-4 && hash(x,z,seed)>.976 && Math.hypot(x-32,z-32)>6) {
      for(let y=h+1;y<=h+4;y++) grid[index(x,y,z)]=4;
      for(let dx=-2;dx<=2;dx++) for(let dz=-2;dz<=2;dz++) for(let dy=3;dy<=5;dy++) if(Math.abs(dx)+Math.abs(dz)+(dy===5?1:0)<4 && !(dx===0&&dz===0&&dy<5)) grid[index(x+dx,h+dy,z+dz)]=5;
    }
  }
  // A level camp and a hand-reachable grove make every seed playable.
  for(let x=28;x<=36;x++) for(let z=28;z<=36;z++) for(let y=1;y<H;y++) grid[index(x,y,z)] = y<8?3:y===8?1:0;
  for(const [x,z] of [[29,27],[35,27],[38,32],[26,33]]) { for(let y=9;y<13;y++) grid[index(x,y,z)]=4; for(let dx=-2;dx<=2;dx++) for(let dz=-2;dz<=2;dz++) for(let y=12;y<15;y++) if(Math.abs(dx)+Math.abs(dz)<4) grid[index(x+dx,y,z+dz)]=5; }
  // Walk-in mine stair descends north from camp; ore is exposed along the walls.
  for(let step=0;step<16;step++) { const z=27-step, floor=Math.max(2,8-Math.floor(step/2)); for(let x=31;x<=33;x++) { grid[index(x,floor,z)]=3; for(let y=floor+1;y<Math.max(16,floor+5);y++) grid[index(x,y,z)]=0; } for(const x of [30,34]) for(let y=floor+1;y<=floor+2;y++) grid[index(x,y,z)]=step>10?9:step>3?8:3; }
  for(let x=27;x<=37;x++) for(let z=7;z<=12;z++) for(let y=3;y<=6;y++) grid[index(x,y,z)]=0;
  for(const [x,z] of [[28,8],[36,8],[28,11],[36,11]]) { grid[index(x,3,z)]=9; grid[index(x,4,z)]=9; }
  return grid;
}