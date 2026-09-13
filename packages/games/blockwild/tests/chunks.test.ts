import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChunkWorld, generateChunk, landscape, read, write } from '../src/chunk-world';
import { chunkGeometry, waterGeometry } from '../src/meshes';
import { block, fits } from '../src/terrain';
import { rules, serializeWorld, restoreWorld } from '../src/server';
import { tickCrops } from '../src/farming';
import { tickAnimals } from '../src/animals';
import { tickMobs } from '../src/mobs';
import { WORLD_RADIUS, H, index, coords, validVoxel, neutral, editLimit, FARMLAND, CHEST, BED, FURNACE, INGOT, ITEMS, stackLimit } from '../src/model';
const ctx={roomId:'chunks',roundId:'c',seed:1,nowMs:0,players:Array.from({length:10},(_,i)=>({id:`p${i}`,name:`Explorer ${i}`,color:'#abcdef'}))};
const make=()=>rules.create(ctx,rules.validateSettings({mode:'creative',seed:38471}));
const edit=(s:ReturnType<typeof make>,x:number,y:number,z:number,b:number)=>{const i=index(x,y,z);write(s.grid,i,b);s.edits.set(i,b);s.revision++;return i;};
test('new worlds are sparse, bounded 4096-block worlds with ten safe spawns',()=>{
 const s=make();assert.equal(s.terrainVersion,7);assert.ok(s.grid instanceof ChunkWorld);assert.equal(s.grid.edits,s.edits);assert.ok(s.grid.chunks.size<20);assert.ok(s.players.every(p=>fits(s.grid,p.x,p.y,p.z)));assert.equal(serializeWorld(s).width,4096);
 for(const n of [-WORLD_RADIUS,WORLD_RADIUS-1])assert.notEqual(block(s.grid,n,20,n),undefined);
 assert.equal(block(s.grid,-WORLD_RADIUS-1,30,0),14);assert.equal(block(s.grid,WORLD_RADIUS,30,0),14);
});
test('voxel keys roundtrip signed coordinates and preserve the old island encoding',()=>{
 for(const x of [-2048,-1000,-17,-16,-1,0,15,16,127,128,1000,2047])for(const z of [-2048,-1,0,127,128,2047])for(const y of [1,5,30,47]){const i=index(x,y,z);assert.deepEqual(coords(i),{x,y,z});assert.ok(validVoxel(i,7));assert.equal(validVoxel(i,6),x>=0&&x<128&&z>=0&&z<128);}
 assert.equal(index(7,12,9),7+9*128+12*128*128);
 for(const i of [-1,NaN,Infinity,1.2,index(2048,10,0),index(0,48,0),index(-1,0,0)])assert.equal(validVoxel(i,7),false);
});
test('chunk generation and border-crossing trees are independent of visit order',()=>{
 const a=new ChunkWorld(38471),b=new ChunkWorld(38471),points=[[-17,-1],[128,16],[1000,-900],[-2048,2047],[0,0]];
 for(const [x,z]of points)for(let y=0;y<H;y++)a.get(x!,y,z!);
 for(const [x,z]of [...points].reverse())for(let y=H-1;y>=0;y--)assert.equal(b.get(x!,y,z!),a.get(x!,y,z!));
 const border=new ChunkWorld(42);let cross=0;
 for(let cx=-3;cx<3;cx++)for(let z=-32;z<32;z++)for(let y=15;y<40;y++)if(border.get(cx*16-1,y,z)===5&&border.get(cx*16,y,z)===5)cross++;
 assert.ok(cross>0);assert.deepEqual(generateChunk(42,-1,1),generateChunk(42,-1,1));assert.notDeepEqual(generateChunk(42,-1,1),generateChunk(43,-1,1));
});
test('thousands of blocks of travel evict terrain while preserving edits and regeneration',()=>{
 const world=new ChunkWorld(42,new Map(),12),i=index(-1,40,-1),base=world.get(-1,12,-1);world.set(i,10);
 for(let x=-2000;x<=2000;x+=16)world.get(x,10,-900);
 assert.equal(world.chunks.size,12);assert.equal(read(world,i),10);assert.equal(world.get(-1,12,-1),base);world.edits.delete(i);assert.equal(read(world,i),new ChunkWorld(42).get(-1,40,-1));
});
test('distant terrain offers different landscapes and diamonds require ten blocks of surrounding cover',()=>{
 const tops=new Set<number>();let diamonds=0;
 for(const seed of [1,42,38471])for(const [cx,cz]of [[0,0],[-80,60],[90,-100],[3,4]]){const grid=new ChunkWorld(seed);
  for(let x=cx!*16;x<(cx!+1)*16;x++)for(let z=cz!*16;z<(cz!+1)*16;z++){tops.add(landscape(seed,x,z).top);for(let y=1;y<H;y++)if(grid.get(x,y,z)===9){diamonds++;assert.ok(y<=5);for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++)assert.ok(landscape(seed,x+dx,z+dz).height-y>=10);}}
 }
 assert.ok(diamonds>20);assert.ok(tops.size>=2);
});
test('ten independent explorers cross old and negative chunk boundaries and save distant builds',()=>{
 const s=make();s.animals=[];
 for(const [n,p]of s.players.entries())Object.assign(p,{x:[127.5,-.5,15.5,-16.5,999.5,-1000.5,1800,-1800,500,-500][n],y:42,z:n*150-700,flying:true});
 const before=s.players.map(p=>p.x),inputs=new Map(s.players.map(p=>[p.id,{...neutral(),fly:true,x:1}]));
 for(let n=0;n<90;n++)rules.tick(s,inputs,1/30,0);
 for(const [n,p]of s.players.entries()){assert.ok(p.x>before[n]!+10);assert.ok(fits(s.grid,p.x,p.y,p.z));}
 const i=edit(s,-1001,40,1500,10),copy=make();restoreWorld(copy,JSON.parse(JSON.stringify(serializeWorld(s))));assert.equal(read(copy.grid,i),10);assert.deepEqual(copy.players.map(p=>[p.x,p.z]),s.players.map(p=>[p.x,p.z]));assert.deepEqual(serializeWorld(copy),serializeWorld(s));assert.ok((s.grid as ChunkWorld).chunks.size<=128);
});
test('mining and placing use the same authoritative distant block for both players',()=>{
 const s=make();s.animals=[];const p=s.players[0]!,q=s.players[1]!;Object.assign(p,{x:1000.5,y:40,z:-1000.5,yaw:0,pitch:0,flying:true});Object.assign(q,{x:1002.5,y:40,z:-1000.5,flying:true});const i=edit(s,1000,41,-1003,3);
 for(let n=0;n<5;n++)rules.tick(s,new Map([[p.id,{...neutral(),fly:true,mine:true,looking:true}]]),1/30,0);
 assert.equal(read(s.grid,i),0);assert.equal(rules.publicView(s,{phase:'playing',nowMs:0}).edits.some(([n])=>n===i),false);
 edit(s,1000,41,-1004,3);p.cooldown=0;rules.tick(s,new Map([[p.id,{...neutral(),fly:true,place:true,slot:10,looking:true}]]),1/30,0);assert.equal(read(s.grid,i),10);
 const copy=make();restoreWorld(copy,serializeWorld(s));assert.equal(read(copy.grid,i),10);
});
test('distant chests, crops, beds and negative player homes survive validation',()=>{
 const s=make(),p=s.players[0]!;Object.assign(p,{x:-1000.5,y:40,z:1000.5,flying:true});const chest=edit(s,-1003,40,1000,CHEST),farm=edit(s,-1003,39,1003,FARMLAND),bed=edit(s,-1004,40,1000,BED);s.chests[chest]={10:64};s.farms=[{i:farm,readyAt:300}];p.home={x:-1004.5,y:40,z:1001.5,bed};const copy=make();restoreWorld(copy,serializeWorld(s));assert.deepEqual(copy.chests,s.chests);assert.deepEqual(copy.farms,s.farms);assert.deepEqual(copy.players[0]!.home,p.home);
});
test('distant crops and animals sleep without generating terrain; far hostiles despawn before tracing sight',()=>{
 const s=make();s.animals=[{...s.animals[0]!,x:1000,y:40,z:1000}];const a={...s.animals[0]!};s.farms=[{i:index(-1000,30,-1000),readyAt:300}];s.time=10;const world=s.grid as ChunkWorld;world.clearCache();tickAnimals(s,1);tickCrops(s,1);assert.equal(world.chunks.size,0);assert.deepEqual(s.animals[0],a);assert.equal(s.farms[0]!.readyAt,301);
 s.mode='survival';s.time=800;s.creatures=[{id:1,kind:'creeper',x:1500,y:30,z:1500,health:10,hitAt:0}];tickMobs(s,1,()=>{},()=>true);assert.equal(s.creatures.length,0);assert.equal(world.chunks.size,0);
});
test('solid and water geometry stay inside their signed chunk and hide shared solid borders',()=>{
 const grid=new ChunkWorld(42);for(const [cx,cz]of [[-1,-1],[62,-63]]){const g=chunkGeometry(grid,cx!,cz!),water=waterGeometry(grid,cx!,cz!);for(const mesh of [g,water]){const p=mesh.getAttribute('position');for(let n=0;n<p.count;n++){assert.ok(p.getX(n)>=cx!*16&&p.getX(n)<=(cx!+1)*16);assert.ok(p.getZ(n)>=cz!*16&&p.getZ(n)<=(cz!+1)*16);}mesh.dispose();}}
});
test('maximum distant edit journal exports below the platform envelope and rejects excess atomically',()=>{
 const s=make();for(let n=0;n<editLimit(7);n++)edit(s,1000+n%64,40,1000+Math.floor(n/64),10);
 for(let n=0;n<32;n++){const i=edit(s,1000+n,40,1000,CHEST);s.chests[i]=Object.fromEntries(Array.from({length:16},(_,id)=>[id,stackLimit(7,id)]));const j=edit(s,1000+n,40,1001,FURNACE);s.furnaces[j]={item:INGOT,count:1,readyAt:1e9};}
 for(let n=0;n<128;n++){const i=edit(s,1000+n%64,40,1002+Math.floor(n/64),FARMLAND);s.farms.push({i,readyAt:1e9});}
 for(const p of s.players)p.inventory=Object.fromEntries(ITEMS.map((_,i)=>[i,stackLimit(7,i)]));
 const save=serializeWorld(s),bytes=Buffer.byteLength(JSON.stringify(save));assert.ok(bytes<256*1024,`${bytes} bytes`);const copy=make();restoreWorld(copy,save);assert.equal(copy.edits.size,8192);
 const bad=structuredClone(save);bad.edits.push([index(-1000,40,-1000),10]);assert.throws(()=>restoreWorld(copy,bad));assert.deepEqual(serializeWorld(copy),save);
});
