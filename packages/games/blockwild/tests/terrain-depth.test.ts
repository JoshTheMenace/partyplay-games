import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { terrain } from '../src/terrain';
import { rules } from './legacy';
import { restoreWorld, serializeWorld } from '../src/server';
import { W, H, index, type TerrainVersion } from '../src/model';
const ctx={roomId:'depth',roundId:'depth',seed:1,nowMs:0,players:[{id:'p',name:'Miner',color:'#abcdef'}]};
const make=(version:Exclude<TerrainVersion,7>=6)=>rules.create(ctx,rules.validateSettings({seed:38471,...(version?{terrainVersion:version}:{})}));
function surfaces(grid:Uint8Array){const result=new Uint8Array(W*W);for(let x=0;x<W;x++)for(let z=0;z<W;z++)for(let y=H-1;y>0;y--)if(![0,4,5,6,20,64,65,66].includes(grid[index(x,y,z)]!)){result[x+z*W]=y;break;}return result;}
test('new worlds put diamonds in deep layers with cover beyond nearby slopes and beaches',()=>{
  assert.equal(make().terrainVersion,6);
  for(const seed of [0,1,7,42,38471,654321,999999]){const grid=terrain(seed,6),roof=surfaces(grid);let diamonds=0;
    for(let x=0;x<W;x++)for(let z=0;z<W;z++)for(let y=1;y<H;y++)if(grid[index(x,y,z)]===9){diamonds++;assert.ok(y<=5,`${seed}: diamond above deep layer at ${x},${y},${z}`);for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++)assert.ok(x+dx>=0&&x+dx<W&&z+dz>=0&&z+dz<W&&roof[x+dx+(z+dz)*W]!-y>=10,`${seed}: shallow diamond at ${x},${y},${z}`);}
    assert.ok(diamonds>20,`${seed}: deep diamonds must remain obtainable`);
  }
});
test('versions one through five regenerate exactly their original saved terrain',()=>{
  const hashes=['656698be0afd0290284ac72f72f5fe4b6399ac9059b138077148931622aaa283','3f4a58cb591b96dcc76eae26ccda65e620f29a2812913aca0d2b5dc51f43065a','809887c2479e9cb33cd3df9cbab1cadce6ba2523cebefb90b7a0305f2157ab83','ed4e9718dc670610e48beb7135008ba7651e89de837cb83ff24f4dd022ee3826','745a9b9afd1bf7bcbe6e9aa7b6d4a1e19c54a349db91fc1ef3ff6c28eba0bdb4'];
  for(let n=0;n<hashes.length;n++)assert.equal(createHash('sha256').update(terrain(38471,(n+1) as Exclude<TerrainVersion,7>)).digest('hex'),hashes[n]);
});
test('save loading retains legacy diamonds and placed blocks; new saves roundtrip deep terrain',()=>{
  for(const version of [5,6] as Exclude<TerrainVersion,7>[]){const old=make(version),i=index(64,30,64);old.grid[i]=9;old.edits.set(i,9);const save=serializeWorld(old),loaded=make();restoreWorld(loaded,save);assert.equal(loaded.terrainVersion,version);assert.deepEqual(loaded.grid,old.grid);assert.deepEqual(serializeWorld(loaded),save);}
  assert.throws(()=>rules.validateSettings({terrainVersion:8}),/version/);
});
