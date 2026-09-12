import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

function byteRange(header:string,size:number):{start:number;end:number}|null {
  const match=/^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if(!match||(!match[1]&&!match[2])||size===0)return null;
  const first=match[1]?Number(match[1]):null,last=match[2]?Number(match[2]):null;
  if((first!==null&&!Number.isSafeInteger(first))||(last!==null&&!Number.isSafeInteger(last)))return null;
  if(first===null)return last&&last>0?{start:Math.max(0,size-last),end:size-1}:null;
  if(first>=size||(last!==null&&last<first))return null;
  return {start:first,end:Math.min(last??size-1,size-1)};
}
export async function serveStaticFile(req:IncomingMessage,res:ServerResponse,file:string,contentType:string):Promise<void> {
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD','Content-Length':0});res.end();return;}
  const {size}=await stat(file);
  res.setHeader('Content-Type',contentType);res.setHeader('Accept-Ranges','bytes');
  // Range only applies to GET. HEAD describes the complete representation without reading it.
  const header=req.method==='GET'?req.headers.range:undefined,range=header?byteRange(header,size):undefined;
  if(range===null){res.writeHead(416,{'Content-Range':`bytes */${size}`,'Content-Length':0});res.end();return;}
  const start=range?.start??0,end=range?.end??size-1;
  res.statusCode=range?206:200;res.setHeader('Content-Length',range?end-start+1:size);
  if(range)res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
  if(req.method==='HEAD'||size===0){res.end();return;}
  const stream=createReadStream(file,{start,end});
  const close=()=>stream.destroy();res.once('close',close);
  stream.once('error',()=>{
    if(res.headersSent)res.destroy();
    else {res.removeHeader('Content-Range');res.setHeader('Content-Length',0);res.statusCode=500;res.end();}
  });
  stream.once('close',()=>res.removeListener('close',close));stream.pipe(res);
}
