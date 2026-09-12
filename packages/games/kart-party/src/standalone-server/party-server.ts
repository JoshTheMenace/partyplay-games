import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomBytes, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { serveStaticFile } from './static-response';
import { resolve, extname, sep } from 'node:path';
import QRCode from 'qrcode';
import { discoverPartyAddresses, type NetworkInterfacesProvider } from './network-address';
import { WebSocketServer, WebSocket } from 'ws';
import { createRace, sanitizeInput, STEP, stepRace } from '../engine/simulation';
import { TRACKS } from '../engine/tracks';
import { isSpeedClass } from '../engine/speed';
import { DRIVERS, MAX_PLAYERS, NEUTRAL, type Input, type Player, type RoomView } from '../engine/types';

type Seat = { driving:boolean; player: Player; token: string; socket: WebSocket | null; input: Input; inputAt: number; seq: number; pendingUse: boolean };
type Room = { view: RoomView; seats: Map<string,Seat>; displays: Set<WebSocket>; touched: number; accumulator: number; preparing?: Set<WebSocket>; prepareUntil?: number };
type Peer = { room: Room; seat: Seat | null; role: 'host' | 'player' | 'display' };
const mime: Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf','.json':'application/json','.mp3':'audio/mpeg'};
// Strip control codes, not printable Unicode or emoji sequences.
// eslint-disable-next-line no-control-regex
const cleanName=(v: unknown)=>typeof v==='string'?v.replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,20)||'Racer':'Racer';
const driver=(v: unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<DRIVERS.length?v:0;
export function createPartyServer({port=4317,host='0.0.0.0',staticDir=resolve('.party-dist'),networkInterfacesProvider,publicOrigin,mount}:{port?:number;host?:string;staticDir?:string;networkInterfacesProvider?:NetworkInterfacesProvider;publicOrigin?:string;mount?:{server:Server;basePath:string}}={}) {
  const rooms=new Map<string,Room>(),peers=new Map<WebSocket,Peer>(),limits=new Map<string,{count:number;at:number}>();
  let actualPort=port;const basePath=mount?.basePath??'';
  const urls=()=>discoverPartyAddresses(actualPort,networkInterfacesProvider).urls;
  const handleRequest=async(req:IncomingMessage,res:ServerResponse)=>{
    const requestUrl=new URL(req.url??'/', 'http://localhost'),pathname=requestUrl.pathname.slice(basePath.length)||'/';
    const boundPort=(server.address() as {port:number}|null)?.port;if(boundPort)actualPort=boundPort;
    res.setHeader('X-Content-Type-Options','nosniff');
    if(pathname==='/api/party'||pathname==='/api/party/qr.svg') {
      res.setHeader('Cache-Control','no-store');
      const addresses=publicOrigin?{urls:[publicOrigin],preferredUrl:publicOrigin}:discoverPartyAddresses(actualPort,networkInterfacesProvider,req.headers.host,req.socket.localAddress);
      if(pathname==='/api/party') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({available:true,...addresses,version:1}));return;}
      const code=requestUrl.searchParams.get('join')?.toUpperCase();
      if(code!==undefined&&!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end('Invalid room code. Use the six-character room code.');return;}
      if(!addresses.preferredUrl) {res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('No LAN address is available. Connect this server to Wi-Fi or Ethernet and try again.');return;}
      try {
        const url=`${addresses.preferredUrl}${basePath}/${code?`?join=${code}`:''}`;
        const svg=await QRCode.toString(url,{type:'svg'});res.setHeader('Content-Type','image/svg+xml');res.end(svg);
      } catch {res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});res.end('Unable to generate the QR code. Try again.');}
      return;
    }
    if(pathname==='/health') {res.end('ok');return;}
    let decoded:string;try{decoded=decodeURIComponent(pathname);}catch{res.writeHead(400);res.end('Invalid path');return;}
    try {
      const file=resolve(staticDir,`.${decoded}`);
      if(!file.startsWith(staticDir+sep)&&file!==staticDir) {res.writeHead(403);res.end();return;}
      const target=(await stat(file).catch(()=>null))?.isFile()?file:resolve(staticDir,mount?'index.html':'party.html');
      await serveStaticFile(req,res,target,mime[extname(target)]??'application/octet-stream');
    } catch {res.writeHead(503);res.end('Build the game first: npm run build:party');}
  };
  const server=mount?.server??createServer((req,res)=>{void handleRequest(req,res);});
  const wss=new WebSocketServer({noServer:true,maxPayload:4096});
  const upgrade=(req:IncomingMessage,socket:Duplex,head:Buffer)=>{
    if(req.url?.split('?')[0]!==`${basePath}/party`)return;
    try{if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw Error();}
    catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  };
  server.on('upgrade',upgrade);
  const send=(socket: WebSocket,message: unknown)=>{if(socket.readyState===WebSocket.OPEN&&socket.bufferedAmount<256_000) socket.send(JSON.stringify(message));};
  const error=(socket: WebSocket,message: string)=>send(socket,{type:'error',message});
  const broadcast=(room: Room)=>{
    room.view.players=[...room.seats.values()].filter(s=>s.driving).map(s=>({...s.player}));
    const message={type:'room',room:room.view,serverTime:Date.now()};
    for(const seat of room.seats.values()) if(seat.socket&&seat.socket.bufferedAmount===0) send(seat.socket,message);
    for(const socket of room.displays) if(socket.bufferedAmount===0) send(socket,message);
  };
  const makeSeat=(room: Room,socket: WebSocket,message: Record<string,unknown>,driving=true)=>{
    const seat: Seat={driving,player:{id:randomUUID(),name:cleanName(message.name),driver:driver(message.driver),connected:true,ready:false},token:randomBytes(24).toString('base64url'),socket,input:{...NEUTRAL},inputAt:Date.now(),seq:-1,pendingUse:false};
    if(driving){const taken=new Set([...room.seats.values()].filter(s=>s.driving).map(s=>s.player.driver));if(taken.has(seat.player.driver))seat.player.driver=DRIVERS.findIndex((_,i)=>!taken.has(i));}
    room.seats.set(seat.player.id,seat);return seat;
  };
  const welcome=(socket:WebSocket,peer:Peer)=>{
    peer.room.view.players=[...peer.room.seats.values()].filter(s=>s.driving).map(s=>({...s.player}));
    send(socket,{type:'welcome',playerId:peer.seat?.player.id??'',token:peer.seat?.token??'',role:peer.role,room:peer.room.view,serverTime:Date.now()});broadcast(peer.room);
  };
  wss.on('connection',(socket,req)=>{
    let messageWindow=Date.now(),messages=0;
    const ip=req.socket.remoteAddress??'unknown';
    const timeout=setTimeout(()=>{if(!peers.has(socket)) socket.close(1008,'Join a room first');},10000);
    socket.on('message',raw=>{
      if(Date.now()-messageWindow>1000) {messageWindow=Date.now();messages=0;}
      if(++messages>100) {socket.close(1008,'Too many messages');return;}
      let m: Record<string,unknown>;
      try {m=JSON.parse((raw as Buffer).toString());if(!m||typeof m!=='object'||Array.isArray(m)) throw Error();} catch {error(socket,'Invalid message');return;}
      let peer=peers.get(socket);
      if(!peer) {
        const limit=limits.get(ip)??{count:0,at:Date.now()};
        if(Date.now()-limit.at>60000) {limit.count=0;limit.at=Date.now();}
        limits.set(ip,limit);if(++limit.count>40) {error(socket,'Too many join attempts. Try again in a minute.');return;}
        if(m.type==='create') {
          if(rooms.size>=64) {error(socket,'The server is full. Try again later.');return;}
          let code='';do {code=Array.from(randomBytes(6),v=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[v%32]).join('');} while(rooms.has(code));
          const room:Room={view:{code,host:'',hostPlays:m.play!==false,players:[],track:'coast',laps:3,speedClass:100,difficulty:'normal',race:null},seats:new Map(),displays:new Set(),touched:Date.now(),accumulator:0};
          const seat=makeSeat(room,socket,m,room.view.hostPlays!==false);seat.player.ready=true;room.view.host=seat.player.id;rooms.set(code,room);peer={room,seat,role:'host'};
        } else if(m.type==='join'||m.type==='rejoin') {
          const room=rooms.get(typeof m.code==='string'?m.code.toUpperCase():'');
          if(!room) {error(socket,'Room not found. Check the code and try again.');return;}
          if(m.type==='rejoin') {
            const seat=[...room.seats.values()].find(s=>s.token===m.token);
            if(!seat) {error(socket,'Your saved seat has expired. Join again.');return;}
            const old=seat.socket;seat.socket=socket;seat.player.connected=true;seat.inputAt=Date.now();seat.input={...NEUTRAL};seat.pendingUse=false;seat.seq=-1;
            if(room.view.race?.startAt===null){if(old)room.preparing?.delete(old);room.preparing?.add(socket);}
            if(old&&old!==socket) old.close(4001,'Seat reconnected');
            peer={room,seat,role:seat.player.id===room.view.host?'host':'player'};
          } else if(m.display===true) {room.displays.add(socket);peer={room,seat:null,role:'display'};}
          else {
            if(room.view.race) {error(socket,'This race has started. Join after the host returns to the lobby.');return;}
            if([...room.seats.values()].filter(s=>s.driving).length>=MAX_PLAYERS) {error(socket,`This room already has ${MAX_PLAYERS} racers.`);return;}
            peer={room,seat:makeSeat(room,socket,m),role:'player'};
          }
        } else {error(socket,'Create or join a room first.');return;}
        peers.set(socket,peer);clearTimeout(timeout);welcome(socket,peer);return;
      }
      const {room,seat,role}=peer;room.touched=Date.now();
      if(m.type==='sync'){if(typeof m.sent==='number'&&Number.isFinite(m.sent))send(socket,{type:'sync',sent:m.sent,serverTime:Date.now()});return;}
      if(m.type==='race-ready'){if(m.startId===room.view.race?.startId)room.preparing?.delete(socket);return;}
      if(m.type==='input') {
        if(!seat?.driving)return;
        if(typeof m.seq!=='number'||!Number.isSafeInteger(m.seq)||m.seq<=seat.seq) return;
        seat.seq=m.seq;const input=sanitizeInput(m.input);seat.pendingUse ||= input.use&&!seat.input.use;seat.input=input;seat.inputAt=Date.now();return;
      }
      if(m.type==='profile'&&seat&&!room.view.race) {
        const selected=driver(m.driver);if(seat.driving&&[...room.seats.values()].some(s=>s!==seat&&s.driving&&s.player.driver===selected)){error(socket,'That racer is already taken. Choose another.');broadcast(room);return;}
        seat.player.name=cleanName(m.name);seat.player.driver=selected;
      }
      if(m.type==='ready'&&seat&&!room.view.race) seat.player.ready=m.ready===true;
      if(['settings','start','lobby','rematch','kick'].includes(String(m.type))&&role!=='host') {error(socket,'Only the host can do that.');return;}
      if(m.type==='kick'&&!room.view.race&&m.id!==room.view.host){const removed=room.seats.get(String(m.id));if(removed){room.seats.delete(removed.player.id);if(removed.socket){send(removed.socket,{type:'closed',message:'The host removed your seat.'});removed.socket.close(1000,'Seat removed');}}}
      if(m.type==='settings'&&!room.view.race) {
        if(typeof m.track==='string'&&Object.hasOwn(TRACKS,m.track)) room.view.track=m.track as RoomView['track'];
        if(typeof m.laps==='number'&&Number.isInteger(m.laps)&&m.laps>=1&&m.laps<=5) room.view.laps=m.laps;
        if(isSpeedClass(m.speedClass)) room.view.speedClass=m.speedClass;
        if(m.difficulty==='easy'||m.difficulty==='normal'||m.difficulty==='hard') room.view.difficulty=m.difficulty;
      }
      if(m.type==='start'||m.type==='rematch') {
        if(room.view.race&&room.view.race.phase!=='results') {error(socket,'A race is already running.');return;}
        const seats=[...room.seats.values()].filter(s=>s.driving);
        if(!seats.some(s=>s.player.connected)){error(socket,'Wait for at least one racer to connect before starting.');return;}
        if(m.type==='start'&&seats.some(s=>!s.player.connected||!s.player.ready)) {error(socket,'Wait for every racer to connect and get ready.');return;}
        room.view.race=createRace({track:room.view.track,laps:room.view.laps,speedClass:room.view.speedClass,difficulty:room.view.difficulty,players:seats.map(s=>s.player)});room.accumulator=0;
        room.view.race.startId=randomUUID();room.view.race.startAt=null;
        // Each view first builds/renders its course, then acknowledges. Only then
        // schedule a common start, so shader compilation cannot eat the countdown.
        room.preparing=new Set([...room.seats.values()].filter(s=>s.player.connected&&s.socket).map(s=>s.socket!));
        for(const display of room.displays)if(display.readyState===WebSocket.OPEN)room.preparing.add(display);
        room.prepareUntil=Date.now()+10000;
        for(const seat of seats){seat.inputAt=Date.now();seat.input={...NEUTRAL};seat.pendingUse=false;}
      }
      if(m.type==='lobby') {room.view.race=null;room.preparing=undefined;for(const s of room.seats.values()){if(!s.player.connected&&s.player.id!==room.view.host)room.seats.delete(s.player.id);else s.player.ready=s.player.id===room.view.host;}}
      if(m.type==='leave') {
        if(role==='host') {for(const p of peers.values()) if(p.room===room) {if(p.seat?.socket) send(p.seat.socket,{type:'closed'});}for(const s of room.displays) send(s,{type:'closed'});rooms.delete(room.view.code);}
        else if(seat&&!room.view.race) room.seats.delete(seat.player.id);
        socket.close(1000,'Left room');
      }
      broadcast(room);
    });
    socket.on('close',()=>{
      clearTimeout(timeout);const peer=peers.get(socket);peers.delete(socket);if(!peer)return;
      peer.room.displays.delete(socket);peer.room.preparing?.delete(socket);
      if(peer.seat?.socket===socket) {peer.seat.socket=null;peer.seat.player.connected=false;peer.seat.input={...NEUTRAL};}
      broadcast(peer.room);
    });
    socket.on('error',()=>socket.close());
  });
  let last=performance.now(),broadcastElapsed=0;
  const timer=setInterval(()=>{
    const now=performance.now(),elapsed=Math.min((now-last)/1000,.1);last=now;broadcastElapsed+=elapsed;
    for(const room of rooms.values()) {
      if(Date.now()-room.touched>30*60*1000) {rooms.delete(room.view.code);for(const s of room.seats.values()) s.socket?.close(1000,'Room expired');for(const s of room.displays)s.close();continue;}
      const race=room.view.race;
      if(race&&race.phase!=='results') {
        if(race.phase==='countdown'){
          if(race.startAt===null&&(!room.preparing?.size||Date.now()>=(room.prepareUntil??0))){race.startAt=Date.now()+3500;room.preparing=undefined;}
          race.countdown=race.startAt==null?3.5:Math.max(0,(race.startAt-Date.now())/1000);
          if(race.countdown===0)race.phase='racing';
          // Warm-up is neutral, never AI takeover; real missing input after GO
          // still uses the normal bounded freshness policy below.
          for(const seat of room.seats.values()){const r=race.racers.find(r=>r.id===seat.player.id);if(r)r.connected=seat.player.connected;}
          room.accumulator=0;
          if(broadcastElapsed>=.05)broadcast(room);
          continue;
        }
        const inputs:Record<string,Input>={};
        for(const seat of room.seats.values()) {
          const fresh=seat.player.connected&&Date.now()-seat.inputAt<1500;
          const racer=race.racers.find(r=>r.id===seat.player.id);if(racer)racer.connected=fresh;
          inputs[seat.player.id]=fresh?{...seat.input,use:seat.input.use||seat.pendingUse}:NEUTRAL;
        }
        room.accumulator+=elapsed;
        while(room.accumulator>=STEP) {stepRace(race,inputs);room.accumulator-=STEP;for(const seat of room.seats.values()){seat.pendingUse=false;inputs[seat.player.id]={...inputs[seat.player.id],use:seat.input.use};}}
      }
      if(broadcastElapsed>=.05) broadcast(room);
    }
    if(broadcastElapsed>=.05) broadcastElapsed=0;
    for(const [ip,limit] of limits)if(Date.now()-limit.at>120000)limits.delete(ip);
  },8);
  return {
    server,rooms,handleRequest,
    listen:()=>new Promise<number>((resolvePort,reject)=>{
      const failed=(error:Error)=>{server.removeListener('listening',listening);reject(error);};
      const listening=()=>{wss.removeListener('error',failed);actualPort=(server.address() as {port:number}).port;resolvePort(actualPort);};
      wss.once('error',failed);server.once('listening',listening);
      try{server.listen(port,host);}catch(error){wss.removeListener('error',failed);server.removeListener('listening',listening);reject(error);}
    }),
    urls,
    close:()=>new Promise<void>(done=>{clearInterval(timer);server.off('upgrade',upgrade);for(const s of wss.clients)s.terminate();wss.close(()=>{if(mount)done();else server.close(()=>done());});}),
  };
}
