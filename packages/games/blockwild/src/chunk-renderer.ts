import { BufferAttribute, BufferGeometry, Group, Mesh, type Material } from 'three';
import { CHUNK, WORLD_RADIUS, coords } from './model';
import { chunkKey } from './chunk-world';
import type { ChunkJob, ChunkResult, MeshData } from './chunk-worker';
function geometry(data:MeshData){const g=new BufferGeometry();for(const [key,value]of Object.entries(data)){if(key==='index')g.setIndex(new BufferAttribute(value,1));else g.setAttribute(key,new BufferAttribute(value,key==='uv'?2:3));}g.computeBoundingSphere();return g;}
/** One worker, one in-flight job, nearest-first queue, and a bounded set of GPU meshes. */
export class ChunkRenderer {
  readonly meshes=new Map<string,Group>();
  private desired=new Set<string>();private versions=new Map<string,number>();private built=new Map<string,number>();
  private worker:Worker;private busy:ChunkJob|null=null;private next=0;private cx=NaN;private cz=NaN;private edits=new Map<number,number>();private disposed=false;
  constructor(private root:Group,private seed:number,private solid:Material,private water:Material,readonly radius:number,private error:(e:Error)=>void){
    this.worker=new Worker(new URL('./chunk-worker.ts',import.meta.url),{type:'module'});
    this.worker.onmessage=({data}:MessageEvent<ChunkResult>)=>{if(this.disposed)return;this.busy=null;if(this.desired.has(data.key)&&this.versions.get(data.key)===data.revision){this.remove(data.key);const group=new Group();group.add(new Mesh(geometry(data.solid),this.solid),new Mesh(geometry(data.water),this.water));this.root.add(group);this.meshes.set(data.key,group);this.built.set(data.key,data.revision);}this.pump();};
    this.worker.onerror=e=>{if(!this.disposed)this.error(new Error(e.message||'Terrain worker failed. Please reconnect.'));};
  }
  update(x:number,z:number,edits:Map<number,number>,dirty:Iterable<string>=[]){
    this.edits=edits;for(const key of dirty)if(this.desired.has(key)||key===this.busy?.key)this.versions.set(key,(this.versions.get(key)??0)+1);
    const cx=Math.floor(x/CHUNK),cz=Math.floor(z/CHUNK);
    if(cx!==this.cx||cz!==this.cz){this.cx=cx;this.cz=cz;this.desired.clear();const keys:{key:string;distance:number}[]=[];
      for(let dx=-this.radius;dx<=this.radius;dx++)for(let dz=-this.radius;dz<=this.radius;dz++)if(cx+dx>=-WORLD_RADIUS/CHUNK&&cx+dx<WORLD_RADIUS/CHUNK&&cz+dz>=-WORLD_RADIUS/CHUNK&&cz+dz<WORLD_RADIUS/CHUNK)keys.push({key:`${cx+dx},${cz+dz}`,distance:dx*dx+dz*dz});
      for(const {key}of keys.sort((a,b)=>a.distance-b.distance)){this.desired.add(key);if(!this.versions.has(key))this.versions.set(key,0);}
      for(const key of this.meshes.keys())if(!this.desired.has(key))this.remove(key);
      for(const key of this.versions.keys())if(!this.desired.has(key)&&key!==this.busy?.key)this.versions.delete(key);
    }this.pump();
  }
  private pump(){if(this.busy||this.disposed)return;const key=[...this.desired].find(k=>this.built.get(k)!==this.versions.get(k));if(!key)return;const [cx,cz]=key.split(',').map(Number),edits:[number,number][]=[];
    for(const [i,b]of this.edits){const c=coords(i);if(Math.abs(Math.floor(c.x/CHUNK)-cx!)<=1&&Math.abs(Math.floor(c.z/CHUNK)-cz!)<=1)edits.push([i,b]);}
    this.busy={id:++this.next,key,revision:this.versions.get(key)!,seed:this.seed,cx:cx!,cz:cz!,edits};this.worker.postMessage(this.busy);
  }
  ready(x:number,z:number){const cx=Math.floor(x/CHUNK),cz=Math.floor(z/CHUNK);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const key=chunkKey((cx+dx)*CHUNK,(cz+dz)*CHUNK);if(this.desired.has(key)&&!this.meshes.has(key))return false;}return this.meshes.has(`${cx},${cz}`);}
  private remove(key:string){const g=this.meshes.get(key);if(g){g.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});this.root.remove(g);this.meshes.delete(key);}this.built.delete(key);}
  dispose(){this.disposed=true;this.worker.terminate();for(const key of this.meshes.keys())this.remove(key);this.desired.clear();this.versions.clear();}
}
