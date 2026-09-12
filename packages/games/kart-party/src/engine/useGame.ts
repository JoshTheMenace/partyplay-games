/* eslint-disable react/react-compiler -- This imperative fixed-step runtime is not optimized by React Compiler. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRace, STEP, stepRace } from './simulation';
import { GameAudio } from './audio';
import { createNetworkClock } from './network-clock';
import { createMotionBuffer } from './motion-buffer';
import { humanInput } from './input';
import { readPreferences } from './preferences';
import { usePartyAddress } from './usePartyAddress';
import { NEUTRAL, type Input, type Race, type RoomView, type SpeedClass, type TrackId } from './types';
import type { GameClient, GameView } from './client-types';
import type { createRenderer } from './renderer';

type Saved={code:string;token:string;role:string};
const reconnectCommand=(saved:Saved)=>saved.role==='display'?{type:'join',code:saved.code,display:true}:{type:'rejoin',code:saved.code,token:saved.token};
export function useGame():GameClient {
  'use no memo'; // The fixed-step engine and sockets intentionally live outside React's render cycle.
  const canvasRef=useRef<HTMLDivElement>(null);
  const [view,setView]=useState<GameView>('menu'),[mode,setMode]=useState<GameClient['mode']>('solo');
  const [race,setRace]=useState<Race|null>(null),[room,setRoom]=useState<RoomView|null>(null),[playerId,setPlayerId]=useState('local');
  const [name,setNameState]=useState('Racer'),[driver,setDriverState]=useState(0),[track,setTrackState]=useState<TrackId>('coast');
  const [laps,setLapsState]=useState(3),[difficulty,setDifficultyState]=useState<Race['difficulty']>('normal');
  const [speedClass,setSpeedClassState]=useState<SpeedClass>(100),[hostPlays,setHostPlays]=useState(false);
  const [joinCode,setJoinCode]=useState(''),[joinUrl,setJoinUrl]=useState(''),[joinUrls,setJoinUrls]=useState<string[]>([]);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[paused,setPaused]=useState(false);
  const [muted,setMuted]=useState(false),[quality,setQuality]=useState<'high'|'performance'>('high'),[autoAccelerate,setAutoAccelerate]=useState(true);
  const [audioUnlocked,setAudioUnlocked]=useState(false),[renderEnabled,setRenderEnabled]=useState(false);const qualityChosen=useRef(false);
  const address=usePartyAddress(view==='lobby'&&room?.host===playerId);
  useEffect(()=>{
    if(view!=='lobby'||room?.host!==playerId)return;
    const urls=address.origins.map(origin=>`${origin}/kart-party/?join=${room.code}`);
    setJoinUrls(urls);setJoinUrl(previous=>urls.includes(previous)?previous:urls[0]??'');
  },[address.origins,room?.code,room?.host,playerId,view]);
  const motionRef=useRef(createMotionBuffer<Race>()),clockRef=useRef(createNetworkClock());
  const pumpTimer=useRef<ReturnType<typeof setTimeout>|null>(null),acceptedRef=useRef(false),controlsEnabled=useRef(true);
  const lastInput=useRef(-Infinity),lastSync=useRef(-Infinity),syncCount=useRef(0),readyId=useRef<string|null>(null);
  const runtime=useRef({race:null as Race|null,mode:'solo' as GameClient['mode'],track:'coast' as TrackId,playerId:'local',paused:false,quality:'high' as 'high'|'performance',autoAccelerate:true});
  Object.assign(runtime.current,{mode,track,playerId,paused,quality,autoAccelerate});
  const socketRef=useRef<WebSocket|null>(null),savedRef=useRef<Saved|null>(null),retryTimer=useRef<ReturnType<typeof setTimeout>|null>(null),watchdogTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const inputs=useRef<Input>({...NEUTRAL}),keys=useRef(new Set<string>()),audioRef=useRef<GameAudio|null>(null),rendererRef=useRef<ReturnType<typeof createRenderer>>(null);
  const seq=useRef(0),mounted=useRef(true),pendingUse=useRef(false);
  const send=(message:unknown)=>{if(socketRef.current?.readyState===WebSocket.OPEN)socketRef.current.send(JSON.stringify(message));};
  const sendInput=useCallback((force=false)=>{
    const socket=socketRef.current,state=runtime.current,now=performance.now();
    if(!acceptedRef.current||socket?.readyState!==WebSocket.OPEN||!['party','controller'].includes(state.mode)||socket.bufferedAmount>0||!force&&now-lastInput.current<1000/60)return;
    const active=state.race?.phase==='racing'||state.race?.phase==='countdown';
    const value=document.hidden||!controlsEnabled.current?NEUTRAL:humanInput(inputs.current,keys.current,state.autoAccelerate,active,pendingUse.current);
    socket.send(JSON.stringify({type:'input',seq:++seq.current,input:value}));lastInput.current=now;pendingUse.current=false;
  },[]);
  const input=useCallback((value:Partial<Input>)=>{
    if(!controlsEnabled.current)return;
    if(!Object.entries(value).some(([key,v])=>inputs.current[key as keyof Input]!==v))return;
    if(value.use===true)pendingUse.current=true;
    Object.assign(inputs.current,value);sendInput();
  },[sendInput]);
  const storeSaved=(saved:Saved|null)=>{savedRef.current=saved;try{if(saved)sessionStorage.setItem('kart-party-seat',JSON.stringify(saved));else sessionStorage.removeItem('kart-party-seat');}catch{}};
  const resetInput=()=>{inputs.current={...NEUTRAL};pendingUse.current=false;keys.current.clear();send({type:'input',seq:++seq.current,input:NEUTRAL});};
  const closeSocket=()=>{
    motionRef.current.reset();clockRef.current.reset();acceptedRef.current=false;readyId.current=null;
    if(pumpTimer.current)clearTimeout(pumpTimer.current);pumpTimer.current=null;
    if(retryTimer.current)clearTimeout(retryTimer.current);retryTimer.current=null;
    if(watchdogTimer.current)clearTimeout(watchdogTimer.current);watchdogTimer.current=null;
    const socket=socketRef.current;socketRef.current=null;socket?.close();
  };
  const disconnect=()=>{closeSocket();setConnected(false);storeSaved(null);};
  const countdownView=(current:Race|null)=>{
    if(current?.phase!=='countdown'||current.startAt==null)return current;
    const countdown=Math.max(0,(current.startAt-clockRef.current.now(performance.now()))/1000);
    return {...current,countdown,phase:countdown===0?'racing' as const:'countdown' as const};
  };
  const acceptRoom=(next:RoomView)=>{
    const previous=runtime.current.race;
    const mine=next.players.find(p=>p.id===runtime.current.playerId);if(mine)setDriverState(mine.driver);
    setRoom(next);setTrackState(next.track);setLapsState(next.laps);setSpeedClassState(next.speedClass);setDifficultyState(next.difficulty);runtime.current.race=next.race;
    if(next.race)motionRef.current.push(next.race,performance.now()/1000);else motionRef.current.reset();
    setRace(countdownView(next.race));setView(next.race?next.race.phase==='results'?'results':'race':'lobby');
    if(next.race?.startId!==previous?.startId||next.race?.phase!==previous?.phase)sendInput(true);
    if(next.race?.startId&&runtime.current.mode==='controller'&&readyId.current!==next.race.startId){readyId.current=next.race.startId;send({type:'race-ready',startId:next.race.startId});}
  };
  const endSession=(message:string,code:string)=>{
    disconnect();resetInput();runtime.current.race=null;setRace(null);setRoom(null);setMode('solo');setView('join');setJoinCode(code);setError(message);setNotice('');setBusy(false);
  };
  function connect(command:Record<string,unknown>){
    closeSocket();setBusy(true);setError('');
    const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/kart-party/party`);socketRef.current=socket;
    let accepted=false;
    const lostConnection=()=>{
      if(socketRef.current!==socket||!mounted.current)return;
      // Detach before closing: an unresponsive TCP connection may never fire onclose.
      closeSocket();setConnected(false);setBusy(false);
      if(savedRef.current){
        setNotice('Reconnecting… your kart is on autopilot.');
        retryTimer.current=setTimeout(()=>{retryTimer.current=null;const saved=savedRef.current;if(mounted.current&&saved)connect(reconnectCommand(saved));},1500);
      }else setError('The party server stopped responding. Check the connection and try again.');
    };
    const armWatchdog=()=>{
      if(watchdogTimer.current)clearTimeout(watchdogTimer.current);
      // Room snapshots arrive throughout the lobby and race; allow ten seconds for LAN stalls.
      watchdogTimer.current=setTimeout(lostConnection,10000);
    };
    armWatchdog();
    socket.onopen=()=>{if(socketRef.current!==socket)return;setConnected(true);setBusy(false);setNotice('');socket.send(JSON.stringify(command));};
    socket.onmessage=event=>{
      if(socketRef.current!==socket)return;
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(accepted||message.type==='welcome')armWatchdog();
      if(typeof message.serverTime==='number')clockRef.current.receive(message.serverTime,performance.now(),message.type==='sync'?message.sent:undefined);
      if(message.type==='welcome'){
        accepted=true;acceptedRef.current=true;seq.current=0;motionRef.current.reset();
        setPlayerId(message.playerId);runtime.current.playerId=message.playerId;
        const nextMode=message.role==='host'?(message.room.hostPlays===false?'display':matchMedia('(pointer: coarse)').matches?'controller':'party'):message.role==='display'?'display':'controller';
        setMode(nextMode);setRenderEnabled(nextMode!=='controller');runtime.current.mode=nextMode;setPaused(false);storeSaved({code:message.room.code,token:message.token,role:message.role});acceptRoom(message.room);sendInput(true);
        lastSync.current=-Infinity;syncCount.current=0;
        const pump=()=>{
          if(socketRef.current!==socket||!acceptedRef.current)return;
          const now=performance.now();sendInput();
          if(now-lastSync.current>=(syncCount.current<8?125:5000)&&!(socket.bufferedAmount>0)){send({type:'sync',sent:now});lastSync.current=now;syncCount.current++;}
          const current=runtime.current.race;
          if(current?.phase==='countdown'&&current.startAt!=null){
            setRace(countdownView(current));
          }
          pumpTimer.current=setTimeout(pump,1000/30);
        };
        pump();
        setJoinUrl('');setJoinUrls([]);
        if(message.role==='host'){
          if(command.type==='create')send({type:'settings',track,laps,speedClass,difficulty});
        }
      }
      if(message.type==='room')acceptRoom(message.room);
      if(message.type==='error'){setError(message.message);setBusy(false);if(!accepted&&(command.type==='rejoin'||command.type==='join'))endSession(message.message,typeof command.code==='string'?command.code:'');}
      if(message.type==='closed'){disconnect();runtime.current.race=null;setRace(null);setRoom(null);setView('menu');setMode('solo');setNotice(message.message??'The host closed the party.');}
    };
    socket.onerror=()=>{if(socketRef.current===socket&&!savedRef.current)setError('The party server is unavailable. Start the local party server and open its address on every device.');};
    socket.onclose=event=>{
      if(socketRef.current!==socket||!mounted.current)return;
      if(event.code===4001){endSession('Your racer is connected in another tab. Close this tab or join as a different racer.',savedRef.current?.code??'');return;}
      lostConnection();
    };
  }
  // This one-time subscription owns an imperative game loop, outside React Compiler.
  // eslint-disable-next-line react/react-compiler
  useEffect(()=>{
    mounted.current=true;audioRef.current=new GameAudio();setHostPlays(matchMedia('(pointer: coarse)').matches);
    try{const preferences=readPreferences(localStorage.getItem('kart-party-settings'),matchMedia('(pointer: coarse)').matches?'performance':'high');setNameState(preferences.name);setDriverState(preferences.driver);setMuted(preferences.muted);setQuality(preferences.quality);qualityChosen.current=preferences.qualityChosen;}catch{}
    const params=new URLSearchParams(location.search),code=params.get('join'),display=params.get('display');
    let saved:Saved|null=null;try{saved=JSON.parse(sessionStorage.getItem('kart-party-seat')??'null');}catch{}
    setRenderEnabled(!saved&&!code);
    if(display){setJoinCode(display.toUpperCase());connect({type:'join',code:display.toUpperCase(),display:true});}
    else if(saved&&(!code||saved.code===code.toUpperCase())){savedRef.current=saved;connect(reconnectCommand(saved));}
    else if(code){setJoinCode(code.toUpperCase());setMode('controller');setView('join');}
    const down=(e:KeyboardEvent)=>{
      if(!controlsEnabled.current)return;
      if((e.target as HTMLElement)?.closest('input,textarea,select,button'))return;
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Shift','e','E','Escape','r','R'].includes(e.key))e.preventDefault();
      keys.current.add(e.key.toLowerCase());
      if(e.key==='Escape'&&!e.repeat&&runtime.current.mode==='solo'&&runtime.current.race?.phase==='racing')setPaused(v=>!v);
    };
    const up=(e:KeyboardEvent)=>keys.current.delete(e.key.toLowerCase());
    const blur=()=>{resetInput();if(runtime.current.mode==='solo'&&(runtime.current.race?.phase==='racing'||runtime.current.race?.phase==='countdown'))setPaused(true);};
    const visibility=()=>{if(document.hidden)blur();};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);
    let animation=0,last=performance.now(),accumulator=0,uiElapsed=0;
    function frame(now:number){
      if(!mounted.current)return;
      const dt=Math.min((now-last)/1000,.1);last=now;const state=runtime.current,k=keys.current;
      const active=state.race?.phase==='racing'||state.race?.phase==='countdown';
      const input=controlsEnabled.current?humanInput(inputs.current,k,state.autoAccelerate,active,pendingUse.current):{...NEUTRAL};
      if(state.mode==='solo'&&state.race&&!state.paused){accumulator+=dt;while(accumulator>=STEP){stepRace(state.race,{[state.playerId]:input});pendingUse.current=false;input.use=inputs.current.use||k.has('e')||k.has('enter')||k.has('x')||k.has('control');accumulator-=STEP;}}
      else accumulator=0;
      uiElapsed+=dt;
      if(state.mode==='solo'&&uiElapsed>=.05&&state.race){setRace({...state.race,racers:state.race.racers.map(r=>({...r}))});if(state.race.phase==='results')setView('results');uiElapsed=0;}
      const racers=state.race?.racers??[],playerIds=state.mode==='party'||state.mode==='display'?racers.filter(r=>!r.bot).map(r=>r.id):[state.playerId];
      const presented=state.mode==='solo'?null:motionRef.current.sample(now/1000);
      const rendered=rendererRef.current?.render({race:presented?.race??state.race,track:state.track,playerIds,quality:state.quality,paused:state.paused,interpolated:!!presented,snappedIds:presented?.snappedIds},dt,now/1000);
      if(rendered&&state.race?.startId&&readyId.current!==state.race.startId){readyId.current=state.race.startId;send({type:'race-ready',startId:state.race.startId});}
      audioRef.current?.update(state.mode==='solo'?state.race:countdownView(state.race),state.playerId,state.paused,state.mode);
      animation=requestAnimationFrame(frame);
    }
    animation=requestAnimationFrame(frame);
    return()=>{mounted.current=false;cancelAnimationFrame(animation);closeSocket();audioRef.current?.dispose();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);};
  // Re-subscribing on React state changes would reset held controls and network sessions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{
    if(mode==='controller'||!renderEnabled||!canvasRef.current)return;
    let cancelled=false;
    // Three.js and canvas textures must never execute during Worker SSR.
    void import('./renderer').then(({createRenderer})=>{if(!cancelled&&canvasRef.current)rendererRef.current=createRenderer(canvasRef.current,setError);}).catch(()=>setError('The 3D renderer failed to load. Please reload.'));
    return()=>{cancelled=true;rendererRef.current?.dispose();rendererRef.current=null;};
  },[mode,renderEnabled]);
  useEffect(()=>{if(audioRef.current)audioRef.current.muted=muted;try{localStorage.setItem('kart-party-settings',JSON.stringify({name,driver,muted,quality,qualityChosen:qualityChosen.current}));}catch{}},[name,driver,muted,quality]);
  const unlockAudio=(selectedTrack=runtime.current.race?.track??track,selectedClass=runtime.current.race?.speedClass??speedClass,selectedMode=runtime.current.mode)=>{audioRef.current?.start(selectedTrack,selectedClass,selectedMode);setAudioUnlocked(true);};
  const solo=()=>{
    disconnect();resetInput();setRenderEnabled(true);unlockAudio(track,speedClass,'solo');const next=createRace({track,laps,speedClass,difficulty,players:[{id:'local',name:name.trim()||'Racer',driver}]});runtime.current.race=next;runtime.current.playerId='local';runtime.current.mode='solo';setPlayerId('local');setMode('solo');setRace(next);setRoom(null);setPaused(false);setView('race');setError('');setNotice('');
  };
  const settings=(change:Record<string,unknown>)=>{if(savedRef.current?.role==='host')send({type:'settings',...change});};
  return {
    view,mode,race,room,playerId,name,driver,track,laps,speedClass,difficulty,joinCode,joinUrl,joinUrls,error,notice,connected,busy,paused,muted,quality,autoAccelerate,canvasRef,audioUnlocked,hostPlays,setHostPlays,
    enableAudio(){if(audioRef.current)audioRef.current.muted=false;setMuted(false);unlockAudio();},
    setName(value){setNameState(value);send({type:'profile',name:value,driver});},setDriver(value){setDriverState(value);send({type:'profile',name,driver:value});},
    setTrack(value){setTrackState(value);settings({track:value});},setLaps(value){setLapsState(value);settings({laps:value});},setDifficulty(value){setDifficultyState(value);settings({difficulty:value});},
    setSpeedClass(value){setSpeedClassState(value);settings({speedClass:value});},
    setJoinCode,setJoinUrl,setMuted(value){if(audioRef.current)audioRef.current.muted=value;setMuted(value);if(!value)unlockAudio();},setQuality(value){qualityChosen.current=true;setQuality(value);},setAutoAccelerate,
    solo,host(){unlockAudio(track,speedClass,hostPlays?(matchMedia('(pointer: coarse)').matches?'controller':'party'):'display');connect({type:'create',name,driver,play:hostPlays});},join(){setRenderEnabled(false);unlockAudio(track,speedClass,'controller');connect({type:'join',code:joinCode.trim().toUpperCase(),name,driver});},showJoin(){setRenderEnabled(false);setView('join');setError('');},
    watch(){unlockAudio(track,speedClass,'display');connect({type:'join',code:joinCode.trim().toUpperCase(),display:true});},removePlayer(id){send({type:'kick',id});},
    start(){unlockAudio();send({type:'start'});},ready(){send({type:'ready',ready:!room?.players.find(p=>p.id===playerId)?.ready});},
    leave(){setRenderEnabled(true);send({type:'leave'});disconnect();resetInput();runtime.current.race=null;setRace(null);setRoom(null);setMode('solo');setView('menu');setPaused(false);setNotice('');setError('');history.replaceState(null,'',location.pathname);},
    rematch(){if(mode==='solo')solo();else{unlockAudio();send({type:'rematch'});}},
    lobby(){if(mode==='solo'){runtime.current.race=null;setRace(null);setView('menu');setPaused(false);}else send({type:'lobby'});},
    togglePause(){if(mode==='solo'){if(paused)unlockAudio();setPaused(v=>!v);resetInput();}},
    setControlsEnabled(value){controlsEnabled.current=value;if(!value)resetInput();else sendInput(true);},
    input,dismissError(){setError('');},
  };
}
