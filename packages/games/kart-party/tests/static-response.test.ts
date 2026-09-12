import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPartyServer } from '../src/standalone-server/party-server';

const content=Buffer.from(Array.from({length:196625},(_,index)=>(index*17+3)%256));
async function fixture(run:(origin:string)=>Promise<void>){
  const directory=await mkdtemp(join(tmpdir(),'kart-static-'));await mkdir(join(directory,'music'));await writeFile(join(directory,'music','test.mp3'),content);await writeFile(join(directory,'empty.mp3'),'');await writeFile(join(directory,'party.html'),'<h1>Kart Party</h1>');
  const party=createPartyServer({port:0,host:'127.0.0.1',staticDir:directory}),port=await party.listen();
  try{await run(`http://127.0.0.1:${port}`);}finally{await party.close();await rm(directory,{recursive:true,force:true});}
}
void test('MP3 response streams complete bytes with the correct MIME type and length',()=>fixture(async origin=>{
  const response=await fetch(`${origin}/music/test.mp3`);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/mpeg');assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(response.headers.get('content-length'),String(content.length));assert.deepEqual(Buffer.from(await response.arrayBuffer()),content);
  const page=await fetch(`${origin}/`);assert.equal(page.status,200);assert.equal(await page.text(),'<h1>Kart Party</h1>');
}));
void test('bounded, open-ended and suffix seeks return exactly the selected bytes',()=>fixture(async origin=>{
  for(const [range,start,end]of [['bytes=0-1',0,1],['bytes=65000-66000',65000,66000],['bytes=196600-',196600,content.length-1],['bytes=-17',content.length-17,content.length-1],['bytes=196620-999999',196620,content.length-1],['bytes=-999999',0,content.length-1]] as const){
    const response=await fetch(`${origin}/music/test.mp3`,{headers:{Range:range}});assert.equal(response.status,206,range);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${content.length}`);assert.equal(response.headers.get('content-length'),String(end-start+1));assert.equal(response.headers.get('accept-ranges'),'bytes');assert.deepEqual(Buffer.from(await response.arrayBuffer()),content.subarray(start,end+1));
  }
}));
void test('malformed, multiple and unsatisfiable byte ranges return 416 without a response body',()=>fixture(async origin=>{
  for(const range of ['bytes=196625-','bytes=4-2','bytes=-0','bytes=-','bytes=0-1,4-5','bits=0-1','bytes=NaN-','bytes=9007199254740992-']){
    const response=await fetch(`${origin}/music/test.mp3`,{headers:{Range:range}});assert.equal(response.status,416,range);assert.equal(response.headers.get('content-range'),`bytes */${content.length}`);assert.equal(response.headers.get('content-length'),'0');assert.equal((await response.arrayBuffer()).byteLength,0);
  }
}));
void test('HEAD returns full headers without a body and empty files handle normal and ranged requests',()=>fixture(async origin=>{
  const head=await fetch(`${origin}/music/test.mp3`,{method:'HEAD',headers:{Range:'bytes=0-1'}});assert.equal(head.status,200);assert.equal(head.headers.get('content-type'),'audio/mpeg');assert.equal(head.headers.get('content-length'),String(content.length));assert.equal((await head.arrayBuffer()).byteLength,0);
  const empty=await fetch(`${origin}/empty.mp3`);assert.equal(empty.status,200);assert.equal(empty.headers.get('content-length'),'0');assert.equal((await empty.arrayBuffer()).byteLength,0);
  const range=await fetch(`${origin}/empty.mp3`,{headers:{Range:'bytes=0-'}});assert.equal(range.status,416);assert.equal(range.headers.get('content-range'),'bytes */0');
  const post=await fetch(`${origin}/music/test.mp3`,{method:'POST'});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');
}));
