import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, MeshBasicMaterial } from 'three';
import { ChunkRenderer } from '../src/chunk-renderer';
import type { ChunkJob, ChunkResult } from '../src/chunk-worker';
import { index } from '../src/model';
test('streaming keeps one job in flight, rejects stale results, unloads meshes and terminates its worker',()=>{
 class FakeWorker {
  static instance:FakeWorker;onmessage:((event:{data:ChunkResult})=>void)|null=null;onerror:unknown;job:ChunkJob|null=null;terminated=false;sent=0;
  constructor(){FakeWorker.instance=this;}
  postMessage(job:ChunkJob){assert.equal(this.job,null,'only one queued job');this.job=job;this.sent++;}
  finish(){const job=this.job!;assert.ok(job);this.job=null;const empty=()=>({position:new Float32Array(),normal:new Float32Array()});this.onmessage?.({data:{...job,solid:empty(),water:empty()}});}
  terminate(){this.terminated=true;}
 }
 const original=globalThis.Worker;globalThis.Worker=FakeWorker as unknown as typeof Worker;
 const root=new Group(),mat=new MeshBasicMaterial(),stream=new ChunkRenderer(root,42,mat,mat,3,e=>{throw e;}),edits=new Map<number,number>();
 try{stream.update(0,0,edits);const worker=FakeWorker.instance;assert.equal(worker.job?.key,'0,0');assert.equal(stream.ready(0,0),false);stream.update(0,0,edits);assert.equal(worker.sent,1);
  edits.set(index(0,40,0),10);stream.update(0,0,edits,['0,0']);worker.finish();assert.equal(stream.meshes.size,0,'old revision must not appear');assert.equal(worker.job?.revision,1);assert.deepEqual((worker.job as ChunkJob|null)?.edits,[...edits]);
  while(worker.job)worker.finish();assert.equal(stream.meshes.size,49);assert.ok(stream.ready(0,0));let disposed=0;root.traverse(o=>{if(o instanceof Mesh)o.geometry.addEventListener('dispose',()=>disposed++);});
  stream.update(1000,-1000,edits);assert.equal(stream.meshes.size,0);assert.equal(disposed,98);assert.equal(stream.ready(1000,-1000),false);assert.deepEqual((worker.job as ChunkJob|null)?.edits,[]);
  stream.update(-1000,1000,edits);worker.finish();assert.equal(stream.meshes.size,0,'unloaded region must not reappear');while(worker.job)worker.finish();assert.equal(stream.meshes.size,49);
  stream.update(0,0,edits);while(worker.job)worker.finish();assert.ok(stream.ready(0,0));assert.equal(stream.meshes.size,49);
  stream.dispose();assert.ok(worker.terminated);assert.equal(root.children.length,0);
 }finally{stream.dispose();mat.dispose();globalThis.Worker=original;}
});
