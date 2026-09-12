import { useRef, useState } from 'react';
import { ArcadeButton, Panel, StatusNotice } from '../../../party-ui/src/index';
import type { ActionResult } from '../../../party-contract/src/index';
import { KARTS, kartStats } from './engine/garage';
import { DRIVERS, type Race } from './engine/types';
import type { Action } from './server';
import './garage.css';

type Props={race:Race;playerId:string|null;isHost?:boolean;connected:boolean;sendAction(action:Action):Promise<ActionResult>};
const preview=(name:string)=>`/games/kart-party/models/previews/${name}.png`;
export function GarageView({race,playerId,connected,sendAction}:Props){
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[category,setCategory]=useState<'kart'|'character'>('kart'),busy=useRef(false);
  const garage=race.garage,racer=race.racers.find(r=>r.id===playerId&&!r.bot),kart=kartStats(racer?.kart),driver=DRIVERS[racer?.driver??0];
  if(!garage)return null;
  const humans=race.racers.filter(r=>!r.bot),ready=!!racer&&garage.readyIds.includes(racer.id),readyCount=humans.filter(r=>garage.readyIds.includes(r.id)).length;
  async function act(action:Action){
    if(busy.current||!connected)return;busy.current=true;setPending(true);setError('');
    try{const result=await sendAction(action);if(!result.accepted)setError(result.reason??'That choice could not be saved. Try again.');}
    catch{setError('That choice could not be saved. Check your connection and try again.');}
    finally{busy.current=false;setPending(false);}
  }
  return <Panel className={`pk-garage${racer?'':' pk-garage-watching'}`} aria-label="Race garage">
    <header className="pk-garage-header"><div><h1 className="kp-display">{racer?'Choose your ride':'The starting grid'}</h1><p>{readyCount}/{humans.length} racers ready · Race starts when everyone is ready</p></div><output className="pk-garage-clock kp-numeral" aria-label="Seconds to race">{Math.max(0,Math.ceil(garage.remaining))}<small>seconds</small></output></header>
    <div className="pk-garage-scroll">
      {!connected&&<StatusNotice>Reconnecting… Your last saved choices will return.</StatusNotice>}
      {error&&<StatusNotice tone="error">{error}</StatusNotice>}
      {racer?<div className="pk-garage-player">
        <section className="pk-garage-preview" aria-label="Selected kart">
          <img src={preview(`kart-${kart.id}`)} alt={`${kart.name} kart`} width="320" height="200"/>
          <div><h2 className="kp-display">{driver.name} + {kart.name}</h2><p>{kart.description}</p>
            <dl className="pk-garage-stats">{([['speed','Top speed'],['acceleration','Acceleration'],['handling','Handling']] as const).map(([key,label])=>{const delta=Math.round((kart[key]-1)*100);return <div key={key}><dt>{label}</dt><dd><meter min={.85} max={1.1} value={kart[key]} aria-label={`${label} relative to Roadster`} aria-valuetext={`${delta>0?'+':''}${delta}% compared with Roadster`}/><span>{delta>0?'+':''}{delta}%</span></dd></div>;})}</dl>
            <p className="pk-garage-note">Compared with Roadster.</p>
          </div>
        </section>
        <div className="pk-garage-choices" data-category={category}>
          <div className="pk-garage-tabs" role="group" aria-label="Garage choices">{(['kart','character'] as const).map(value=><button type="button" key={value} aria-pressed={category===value} onClick={()=>setCategory(value)}>{value==='kart'?'Kart':'Character'}<small>{value==='kart'?'Driving stats':'Appearance only'}</small></button>)}</div>
          <fieldset className="pk-garage-character-options" disabled={pending||!connected}><legend>Character <span>Appearance only</span></legend><div className="pk-garage-drivers">{DRIVERS.map((choice,index)=><button type="button" key={choice.name} aria-pressed={racer.driver===index} onClick={()=>{if(racer.driver!==index)void act({type:'choose',driver:index,kart:kart.id});}}><img src={preview(`driver-${index}`)} alt="" width="72" height="64"/><span>{choice.name}</span></button>)}</div></fieldset>
          <fieldset className="pk-garage-kart-options" disabled={pending||!connected}><legend>Kart <span>Changes how you drive</span></legend><div className="pk-garage-karts">{KARTS.map(choice=><button type="button" key={choice.id} aria-pressed={kart.id===choice.id} onClick={()=>{if(kart.id!==choice.id)void act({type:'choose',driver:racer.driver,kart:choice.id});}}><img src={preview(`kart-${choice.id}`)} alt="" width="130" height="72"/><span>{choice.name}</span></button>)}</div></fieldset>
        </div>
      </div>:<ul className="pk-garage-roster" aria-label="Racers and choices">{race.racers.map(r=>{const character=DRIVERS[r.driver],vehicle=kartStats(r.kart),status=r.bot?'CPU · Ready':!r.connected?'Reconnecting':garage.readyIds.includes(r.id)?'Ready':'Choosing';return <li key={r.id}><img src={preview(`driver-${r.driver}`)} alt="" width="64" height="64"/><div><strong>{r.name}</strong><span>{character.name} · {vehicle.name}</span></div><b data-ready={r.bot||garage.readyIds.includes(r.id)}>{status}</b></li>;})}</ul>}
    </div>
    {racer&&<footer className="pk-garage-footer"><p role="status">{pending?'Saving…':ready?'Ready. Changing a choice lets you edit again.':'Pick a character and kart, then ready up.'}</p><ArcadeButton disabled={pending||!connected||ready} tone={ready?'lime':'sun'} onClick={()=>void act({type:'ready'})}>Ready to race</ArcadeButton></footer>}
  </Panel>;
}
