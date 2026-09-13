import { ChunkWorld } from './chunk-world';
import { chunkGeometry, waterGeometry } from './meshes';
import type { BufferGeometry } from 'three';
export type MeshData={position:Float32Array;normal:Float32Array;color?:Float32Array;uv?:Float32Array;index?:Uint16Array|Uint32Array};
export type ChunkJob={id:number;key:string;revision:number;seed:number;cx:number;cz:number;edits:[number,number][]};
export type ChunkResult=Omit<ChunkJob,'edits'|'seed'>&{solid:MeshData;water:MeshData};
function data(g:BufferGeometry):MeshData{const result:MeshData={position:g.getAttribute('position').array as Float32Array,normal:g.getAttribute('normal').array as Float32Array};for(const key of ['color','uv'] as const)if(g.hasAttribute(key))result[key]=g.getAttribute(key).array as Float32Array;if(g.index)result.index=g.index.array as Uint16Array|Uint32Array;g.dispose();return result;}
self.onmessage=(event:MessageEvent<ChunkJob>)=>{const j=event.data,grid=new ChunkWorld(j.seed,new Map(j.edits),8),solid=data(chunkGeometry(grid,j.cx,j.cz)),water=data(waterGeometry(grid,j.cx,j.cz)),result:ChunkResult={id:j.id,key:j.key,revision:j.revision,cx:j.cx,cz:j.cz,solid,water};const transfers=[...Object.values(solid),...Object.values(water)].map(a=>a.buffer);(self as unknown as Worker).postMessage(result,transfers);};
