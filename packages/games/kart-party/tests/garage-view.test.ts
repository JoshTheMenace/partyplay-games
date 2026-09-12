import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DRIVERS, type Race } from '../src/engine/types';
import { createRace } from '../src/engine/simulation';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/garage-view.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},metafile:true});
const compiled={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const GarageView=(compiled.exports as {GarageView:ComponentType<{race:Race;playerId:string|null;connected:boolean;sendAction():Promise<{accepted:boolean}>}>}).GarageView;
const race=()=>({...createRace({track:'coast',players:Array.from({length:10},(_,i)=>({id:`p${i}`,name:`Player${String(i).padStart(10,'0')}`,driver:i}))}),garage:{remaining:45,deadline:45000,readyIds:[] as string[]}});
const render=(value:Race,playerId:string|null='p0',connected=true)=>renderToStaticMarkup(createElement(GarageView,{race:value,playerId,connected,sendAction:async()=>({accepted:true})}));
test('players get all cosmetic drivers, three kart choices and authoritative balanced defaults',()=>{
  const html=render(race());assert.equal((html.match(/aria-pressed=/g)??[]).length,15);assert.equal((html.match(/aria-pressed="true"/g)??[]).length,3);
  assert.ok(html.includes('data-category="kart"'));assert.ok(html.includes('aria-label="Garage choices"'));
  for(const driver of DRIVERS)assert.ok(html.includes(`>${driver.name}</span>`));
  for(const id of ['standard','sprint','trail'])assert.ok(html.includes(`kart-${id}.png`));
  assert.ok(html.includes('Appearance only'));assert.ok(html.includes('Ready to race'));
  assert.equal((html.match(/<meter /g)??[]).length,3);assert.equal((html.match(/<span>0%<\/span>/g)??[]).length,3);
  assert.ok(!Object.keys(bundle.metafile!.inputs).some(path=>path.endsWith('/src/server.ts')));
});
test('reconnect and ready views reflect server selections without locking the choice fieldsets',()=>{
  const value=race();value.racers[0].driver=3;value.racers[0].kart='sprint';value.garage!.readyIds=['p0'];
  const html=render(value);assert.ok(html.includes('Nova + Arrow'));assert.ok(html.includes('+5%'));assert.ok(html.includes('-8%'));assert.ok(html.includes('-5%'));
  assert.ok(html.includes('Ready. Changing a choice lets you edit again.'));assert.doesNotMatch(html,/<fieldset[^>]*disabled/);
  assert.match(html,/<button disabled=""[^>]*>\s*<span>Ready to race/);
  const offline=render(value,'p0',false);assert.equal((offline.match(/<fieldset[^>]*disabled=""/g)??[]).length,2);assert.ok(offline.includes('Reconnecting'));
});
test('watching displays show the complete ten-person grid and no selection controls',()=>{
  const value=race();value.garage!.remaining=12.1;value.garage!.readyIds=['p0','p9'];value.racers[9].kart='trail';
  const html=render(value,null);assert.equal((html.match(/<li>/g)??[]).length,10);assert.ok(!html.includes('<button'));
  for(const racer of value.racers)assert.ok(html.includes(racer.name));
  assert.ok(html.includes('Jade · Rover'));assert.ok(html.includes('2/10 racers ready'));assert.match(html,/aria-label="Seconds to race">13<small>/);
});
