import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, STAGE_IDS, getStage, resolveStage, spawnPoint, stageFrame, type StageId } from '../src/stages';
import { neutralInput, type Input } from '../src/model';
import { rules, type State } from '../src/server';
const ctx = { roomId:'stage-test',roundId:'stage-round',nowMs:1000,seed:27,players:Array.from({length:4},(_,i)=>({id:`p${i}`,name:`Player000000000${i}`,color:'#93d2fa'})) };
function fight(stage: StageId, hazards=false) { const s=rules.create(ctx,{seconds:60,stocks:5,stage,hazards}); s.phase='fight'; return s; }
function tick(s: State, frames=1, input: Partial<Input>={}) { for(let i=0;i<frames;i++) rules.tick(s,new Map([['p0',{...neutralInput(),...input}]]),1/60,1000+(s.frame+1)*1000/60); }

test('29 distinct versus source entries plus Cloudbreak have different layouts and finite bounds',()=>{
  assert.equal(STAGE_IDS.length,30);
  const references=STAGE_IDS.map(id=>getStage(id).grKind).filter(id=>id!==null);
  assert.equal(new Set(references).size,29);
  assert.deepEqual([...references].sort((a,b)=>a-b),[...Array.from({length:21},(_,i)=>i+2),24,25,27,28,29,30,36,37]);
  assert.equal(new Set(STAGE_IDS.map(id=>JSON.stringify(getStage(id).platforms))).size,30);
  for(const id of STAGE_IDS) for(let f=0;f<2400;f+=37) {
    const stage=getStage(id), current=stageFrame(id,f);
    assert.ok(current.platforms.length && current.platforms.length<=24);
    for(const p of current.platforms) assert.ok(p.left<p.right && p.left>-stage.blastX && p.right<stage.blastX && p.y>stage.blastBottom && p.y<stage.blastTop-4,id);
    for(let seat=0;seat<4;seat++) { const p=spawnPoint(id,seat,4,f); assert.ok(current.platforms.some(s=>s.solid && p.x>s.left && p.x<s.right && p.y===s.y),id); }
  }
});

test('settings validate maps and hazards, preserve old defaults, and resolve seeded random once',()=>{
  for(const stage of [...STAGE_IDS,'random']) assert.equal(rules.validateSettings({stage}).stage,stage);
  for(const value of [{stage:'__proto__'},{stage:1},{stage:null},{hazards:1},{hazards:'false'}]) assert.throws(()=>rules.validateSettings(value));
  assert.deepEqual(rules.validateSettings({}),{seconds:900,stocks:3});
  assert.equal(resolveStage('random',27),resolveStage('random',27));
  assert.equal(new Set(Array.from({length:30},(_,seed)=>resolveStage('random',seed))).size,30);
  const s=rules.create(ctx,{seconds:60,stocks:3,stage:'random',hazards:false});
  assert.equal(s.stageId,resolveStage('random',ctx.seed)); tick(s,120); assert.equal(s.stageTick,0);
  const view=rules.publicView(s,{nowMs:3000,phase:'playing'}); assert.equal(view.stageId,s.stageId); assert.equal(view.hazards,false);
});

test('moving ledges carry idle and frozen riders, then detach on jump or deliberate drop',()=>{
  const s=fight('fountain'),p=s.players[0], surface=stageFrame(s.stageId,0).platforms[1]; p.x=(surface.left+surface.right)/2;p.y=surface.y;p.grounded=true;
  tick(s,180); assert.ok(p.grounded); assert.equal(p.y,stageFrame(s.stageId,s.stageTick).platforms[1].y);
  p.hitstop=20;tick(s,10); assert.equal(p.y,stageFrame(s.stageId,s.stageTick).platforms[1].y);
  p.hitstop=0;tick(s,1,{y:1});assert.equal(p.grounded,false);
  tick(s,120);assert.equal(p.y,0);assert.equal(p.grounded,true);
  const mobile=fight('poke-floats'),q=mobile.players[0];q.x=0;q.y=stageFrame('poke-floats',0).platforms[0].y;tick(mobile,120);assert.equal(q.y,stageFrame(mobile.stageId,mobile.stageTick).platforms[0].y);
  tick(mobile,1,{y:1});assert.equal(q.grounded,true,'solid moving floors cannot be dropped through');
  tick(mobile,4,{jump:true,presses:{jump:1,attack:0,special:0,smash:0}});assert.equal(q.grounded,false);
});

test('rising ledges catch descending fighters and walking past a moving edge begins a fall',()=>{
  const s=fight('fountain'); s.stageTick=400; const p=s.players[0],surface=stageFrame(s.stageId,400).platforms[1];
  Object.assign(p,{x:(surface.left+surface.right)/2,y:surface.y+.15,vy:-2,grounded:false});
  tick(s,5);assert.equal(p.grounded,true);assert.equal(p.y,stageFrame(s.stageId,s.stageTick).platforms[1].y);
  tick(s,35,{x:-1});assert.ok(!p.grounded||p.y===0);
});

test('hazards telegraph, respect the toggle and invulnerability, and cannot deal damage every frame',()=>{
  const s=fight('brinstar',true),p=s.players[0];s.stageTick=470;
  assert.equal(stageFrame('brinstar',500).hazard?.warning,true); assert.equal(stageFrame('brinstar',500).hazard?.active,false);
  tick(s,30);assert.equal(p.damage,0);
  s.stageTick=700;p.x=0;p.y=0;tick(s);assert.equal(p.damage,14);assert.equal(p.mode,'hurt');
  Object.assign(p,{y:0,grounded:true,hitstop:0,stun:0});tick(s);assert.equal(p.damage,14);
  const off=fight('brinstar');off.stageTick=700;tick(off);assert.equal(off.players[0].damage,0);assert.equal(stageFrame('brinstar',710,false).hazard,null);
  const protectedState=fight('brinstar',true);protectedState.stageTick=700;protectedState.players[0].invuln=100;tick(protectedState);assert.equal(protectedState.players[0].damage,0);
  const wind=fight('dream-land',true);wind.stageTick=700;wind.players[0].x=0;wind.players[0].y=0;tick(wind);assert.ok(wind.players[0].vx>0);assert.equal(wind.players[0].damage,0);
});

test('projectile bounces use the chosen map and stage-specific blast zones govern stocks',()=>{
  const s=fight('temple'),p=s.players[0];
  s.projectiles.push({id:1,owner:p.id,x:0,y:4.14,vx:0,vy:-5,gravity:1,bounce:true,color:'#fff',life:100,damage:1,flinch:false});
  tick(s);assert.ok(s.projectiles[0].vy>0); assert.equal(s.projectiles[0].y,4.1);
  p.x=15;p.y=1;p.vx=p.vy=0;tick(s);assert.equal(p.stocks,5,'wide stage extends past Cloudbreak blast zone');
  p.x=getStage('temple').blastX+1;tick(s);assert.equal(p.stocks,4);assert.equal(p.mode,'respawn');
  const point=spawnPoint('temple',0,4,s.stageTick);assert.equal(p.x,point.x);assert.equal(p.y,point.y+6.5);
});

for(const id of STAGE_IDS) test(`${STAGES[id].name}: four safe seats, finite sustained play, timeout and clean replay`,()=>{
  const safe=fight(id);tick(safe,120);
  assert.ok(safe.players.every(p=>p.stocks===5 && p.grounded),`${id}: idle seats must stay safe`);
  const s=fight(id,true);s.endsAt=61000;
  for(let frame=0;frame<=3601&&s.phase!=='complete';frame++) {
    const inputs=new Map(s.players.map(p=>[p.id,{...neutralInput(),x:Math.sign(-p.x),y:frame%160<80?-.8:.8,attack:true,jump:frame%70<15,presses:{jump:Math.floor(frame/70),attack:0,special:Math.floor(frame/250),smash:0}}]));
    rules.tick(s,inputs,1/60,1000+frame*1000/60);
    for(const p of s.players) assert.ok([p.x,p.y,p.vx,p.vy,p.damage,p.shield].every(Number.isFinite)&&p.stocks>=0&&p.stocks<=5,id);
  }
  assert.equal(s.phase,'complete'); assert.ok(rules.outcome(s).rows.length===4);
  assert.doesNotThrow(()=>JSON.parse(JSON.stringify(rules.publicView(s,{nowMs:62000,phase:'results'}))));
  const replay=fight(id); assert.equal(replay.stageTick,0); assert.ok(replay.players.every(p=>!p.chosen&&!p.damage&&p.stocks===5));
});

test('expanded arenas have distinct large routes, safe moving bounds and a vertical summit',()=>{
  for(const id of STAGE_IDS){const s=getStage(id),span=Math.max(...s.platforms.map(p=>p.right))-Math.min(...s.platforms.map(p=>p.left));assert.ok(span>=34,`${id}: expanded width`);if(id!=='final-destination')assert.ok(s.platforms.length>=12,`${id}: multiple routes`);}
  assert.equal(getStage('final-destination').platforms.length,1,'the open dueling map keeps its identity');
  assert.ok(getStage('temple').platforms.some(p=>p.motion?.y===6));assert.ok(getStage('icicle-mountain').platforms.some(p=>p.y===15));
});
