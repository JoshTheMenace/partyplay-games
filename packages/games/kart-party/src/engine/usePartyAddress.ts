import { useEffect, useState } from 'react';
import { partyOrigins } from './network';

const EMPTY_ADDRESS={origins:[] as string[],error:''};
export function usePartyAddress(active:boolean) {
  const [state,setState]=useState(EMPTY_ADDRESS);
  useEffect(()=>{
    if(!active)return;
    let stopped=false,pending=false;
    const controller=new AbortController();
    const refresh=async()=>{
      if(pending||stopped)return;pending=true;
      try {
        const response=await fetch('/kart-party/api/party',{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw Error();
        const data=await response.json() as {available?:unknown;urls?:unknown}|null;
        if(!data||data.available!==true)throw Error();
        const origins=partyOrigins(location.origin,Array.isArray(data.urls)?data.urls.filter((url:unknown):url is string=>typeof url==='string'):[]);
        if(!stopped)setState(previous=>origins.join('|')===previous.origins.join('|')&&!previous.error?previous:{origins,error:origins.length?'':'Connect the server to Wi-Fi or Ethernet to create a phone QR code.'});
      }catch{if(!stopped)setState({origins:[],error:'Cannot reach the party server. Start it on your laptop and open its address.'});}
      finally{pending=false;}
    };
    void refresh();const timer=setInterval(()=>void refresh(),5000);
    window.addEventListener('focus',refresh);
    return()=>{stopped=true;controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[active]);
  return active?state:EMPTY_ADDRESS;
}
