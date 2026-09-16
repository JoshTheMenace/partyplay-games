import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { audioMode, BATTLE_TRACKS, EFFECTS, soundFrame } from '../src/audio';
import { rules } from '../src/server';
import type { View } from '../src/model';
function view(): View {
 const state=rules.create({roomId:'r',roundId:'round',nowMs:1000,seed:7,players:[{id:'p',name:'Player',color:'#fff'},{id:'q',name:'Other',color:'#abc'}]},{seconds:60,stocks:3});
 return rules.publicView(state,{nowMs:1000,phase:'playing'});
}
const next=(v: View,changes: Partial<View>={}): View=>({...structuredClone(v),frame:v.frame+2,...changes});

test('selection and preparation use the lobby song, fight uses the playlist, results/picker stop music',()=>{
 const v=view();assert.equal(audioMode('lobby',null),'lobby');assert.equal(audioMode('preparing',null),'lobby');assert.equal(audioMode('playing',v),'lobby');v.phase='countdown';assert.equal(audioMode('playing',v),'lobby');v.phase='fight';assert.equal(audioMode('playing',v),'battle');assert.equal(audioMode('results',v),'results');assert.equal(audioMode('picker',null),'silent');
});
test('five complete user tracks and every effect are bundled, with one lobby track and four battle tracks',()=>{
 const root=new URL('../../../../public/games/sky-clash/audio/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8')) as { music: { role: string; file: string; sha256: string; durationSeconds: number; streams: unknown[] }[] };
 assert.equal(manifest.music.length,5);assert.equal(manifest.music.filter(t=>t.role==='lobby').length,1);assert.deepEqual(manifest.music.filter(t=>t.role==='battle').map(t=>t.file),[...BATTLE_TRACKS]);
 for(const track of manifest.music){const bytes=readFileSync(new URL(track.file,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),track.sha256);assert.ok(track.durationSeconds>190);assert.equal(track.streams.length,1);}
 for(const [file] of Object.values(EFFECTS)){const bytes=readFileSync(new URL(file,root));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.ok(statSync(new URL(file,root)).size<60000);}
});
test('authoritative impacts emit once; duplicates, old frames, new rounds and reconnect gaps are silent',()=>{
 const a=view();a.phase='fight';a.frame=100;const b=next(a,{impacts:[{id:4,kind:'hit',x:5,y:0,color:'#fff',at:1}]});
 assert.deepEqual(soundFrame(a,b),[{sound:'hit',pan:1/3}]);assert.deepEqual(soundFrame(b,b),[]);assert.deepEqual(soundFrame(b,next(b)),[]);assert.deepEqual(soundFrame(null,b),[]);
 for(const changes of [{frame:99},{frame:300},{turnId:'new'}])assert.deepEqual(soundFrame(a,next(b,changes)),[]);
});
test('confirmed fighter locks, fight start and results each make a phase cue',()=>{
 const a=view(),b=next(a);b.players[0].chosen=true;assert.equal(soundFrame(a,b)[0].sound,'select');
 const countdown=next(b,{phase:'countdown'}),fight=next(countdown,{phase:'fight'});assert.equal(soundFrame(countdown,fight)[0].sound,'start');assert.equal(soundFrame(fight,{...fight,phase:'complete'})[0].sound,'end');
});
test('jump, landing, attacks, projectiles, shield impacts, KOs and hazards follow real state changes',()=>{
 const a=view();a.phase='fight';a.frame=100;const b=next(a);b.players[0].grounded=false;b.players[0].jumps--;b.players[0].vy=3;b.players[0].move='jab';b.players[0].moveFrame=1;
 b.projectiles=[{id:6,owner:'p',x:0,y:1,vx:12,color:'#fff'}];b.impacts=[{id:7,kind:'block',x:0,y:0,color:'#fff',at:1},{id:8,kind:'break',x:0,y:0,color:'#fff',at:1},{id:9,kind:'ko',x:20,y:0,color:'#fff',at:1}];
 assert.deepEqual(new Set(soundFrame(a,b).map(c=>c.sound)),new Set(['jump','attack','laser','block','break','ko']));assert.ok(soundFrame(a,b).every(c=>Math.abs(c.pan)<=.7));
 const land=next(b);land.players[0].grounded=true;assert.ok(soundFrame(b,land).some(c=>c.sound==='land'));
 a.stageId='brinstar';a.stageTick=479;const warning=next(a,{stageTick:480});assert.ok(soundFrame(a,warning).some(c=>c.sound==='warning'));warning.hazards=false;assert.ok(!soundFrame(a,warning).some(c=>c.sound==='warning'));
});
