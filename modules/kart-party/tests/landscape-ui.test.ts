import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRace} from '../game/simulation';
import type {GameClient} from '../game/client-types';
import {EventBanner,RaceHud} from '../game/ui/RaceHud';
import {requestLandscape} from '../game/ui/orientation';
void test('lap completion remains visible over newer item or boost events and finish wins',()=>{
 const race=createRace({track:'coast',laps:3,players:[]}),racer=race.racers[0];race.time=12;
 race.events=[{id:1,type:'lap',racer:racer.id,time:10,lap:2},{id:2,type:'hit',racer:racer.id,time:10.2},{id:3,type:'boost',racer:racer.id,time:11.9},{id:4,type:'item',racer:racer.id,time:11.95}];
 const html=renderToStaticMarkup(createElement(EventBanner,{race,racer}));assert.match(html,/Lap 2 complete/);assert.match(html,/Final lap next/);assert.doesNotMatch(html,/Boost!/);
 race.events.push({id:5,type:'finish',racer:racer.id,time:11.99});assert.match(renderToStaticMarkup(createElement(EventBanner,{race,racer})),/Finish!/);
 race.events=[{id:6,type:'boost',racer:racer.id,time:12}];assert.equal(renderToStaticMarkup(createElement(EventBanner,{race,racer})), '');
});
for(const mode of ['unsupported','fullscreen','locked'] as const)void test(`landscape request safely returns ${mode} with the available browser APIs`,async()=>{
 const doc=Object.getOwnPropertyDescriptor(globalThis,'document'),screen=Object.getOwnPropertyDescriptor(globalThis,'screen'),calls:string[]=[];
 Object.defineProperty(globalThis,'document',{configurable:true,value:{fullscreenEnabled:mode!=='unsupported',fullscreenElement:null,documentElement:{requestFullscreen:async()=>{calls.push('fullscreen');}}}});
 Object.defineProperty(globalThis,'screen',{configurable:true,value:{orientation:{lock:async()=>{calls.push('lock');if(mode==='fullscreen')throw Error('Not supported');}}}});
 try{assert.equal(await requestLandscape(),mode);assert.deepEqual(calls,mode==='unsupported'?[]:['fullscreen','lock']);}
 finally{if(doc)Object.defineProperty(globalThis,'document',doc);else Reflect.deleteProperty(globalThis,'document');if(screen)Object.defineProperty(globalThis,'screen',screen);else Reflect.deleteProperty(globalThis,'screen');}
});

void test('shared HUD includes all ten human viewports and keeps solo to its own racer',()=>{
 const players=Array.from({length:10},(_,i)=>({id:`p${i}`,name:`UniquePlayer${i}`,driver:i}));
 const race=createRace({track:'coast',players});race.phase='racing';race.time=5;
 const game={race,mode:'display',playerId:'host',room:null} as GameClient;
 const html=renderToStaticMarkup(createElement(RaceHud,{game}));
 for(const p of players)assert.ok(html.includes(`title="${p.name}"`),p.name);
 assert.match(html,/grid-cols-4 grid-rows-3/);
 const solo=renderToStaticMarkup(createElement(RaceHud,{game:{...game,mode:'solo',playerId:'p9'}}));
 assert.ok(solo.includes('title="UniquePlayer9"'));assert.ok(!solo.includes('title="UniquePlayer0"'));
});
