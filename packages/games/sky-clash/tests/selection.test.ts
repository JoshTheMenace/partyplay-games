import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/server';
import { ROSTER, neutralInput, type Input } from '../src/model';
import { stageFrame } from '../src/stages';
import { assertSerializable } from '../../../party-contract/src/serializable';
const ctx = { roomId: 'r', roundId: 'r', seed: 17, nowMs: 1000, players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, color: '#fff' })) };
const create = () => rules.create(ctx, { seconds: 60, stocks: 3 });
function voting() { const s = create(); for (const p of s.players) rules.applyAction(s, p.id, { turnId: 'r', kind: 'mario' }, 1000); rules.tick(s, new Map(), 1/60, 4000); assert.equal(s.phase, 'vote'); return s; }
test('map voting follows fighters, resolves the plurality early, respawns everyone and starts a fresh match clock', () => {
  const s = voting(); assert.equal(s.phaseEndsAt, 24000);
  for (const [i, stage] of ['fountain', 'fountain', 'battlefield', 'cloudbreak'].entries()) rules.applyAction(s, `p${i}`, rules.parseAction({ turnId: 'r', stage }), 4500);
  rules.tick(s, new Map(), 1/60, 4517); assert.equal(s.phase, 'countdown'); assert.equal(s.stageId, 'fountain'); assert.equal(s.endsAt, 67517); assert.equal(s.stageTick, 0);
  for (const p of s.players) { assert.equal(p.kind, 'mario'); assert.equal(p.damage, 0); assert.equal(p.jumps, 2); assert.ok(stageFrame('fountain',0).platforms.some(f => f.solid && p.y === f.y && p.x >= f.left && p.x <= f.right)); }
  const view = rules.publicView(s, { nowMs: 4517, phase: 'playing' }); assertSerializable(view); view.mapVotes.pop(); assert.equal(s.mapVotes.length, 4);
  rules.tick(s, new Map(), 1/60, 7517); assert.equal(s.phase, 'fight');
});
test('one locked vote per active player; malformed, stale, late and wrong-phase votes are rejected', () => {
  const s = voting();
  for (const raw of [{turnId:'r',stage:'random'},{turnId:'r',stage:'__proto__'},{turnId:'r',stage:'cloudbreak',kind:'fox'},{turnId:3,stage:'cloudbreak'}]) assert.throws(() => rules.parseAction(raw));
  assert.throws(() => rules.applyAction(create(), 'p0', { turnId:'r',stage:'cloudbreak' }, 1500));
  assert.throws(() => rules.applyAction(s, 'p0', { turnId:'old',stage:'cloudbreak' }, 4500));
  assert.throws(() => rules.applyAction(s, 'outsider', { turnId:'r',stage:'cloudbreak' }, 4500));
  rules.applyAction(s, 'p0', { turnId:'r',stage:'cloudbreak' }, 4500);
  assert.throws(() => rules.applyAction(s, 'p0', { turnId:'r',stage:'fountain' }, 4500));
  assert.throws(() => rules.applyAction(s, 'p1', { turnId:'r',kind:'fox' }, 4500));
  assert.throws(() => rules.applyAction(s, 'p1', { turnId:'r',stage:'cloudbreak' }, 24000));
});
test('partial voting waits twenty seconds; ties draw only from leaders and no votes retain the fallback', () => {
  const choices = new Set<string>();
  for (let seed = 0; seed < 12; seed++) {
    const s = voting(); s.seed = seed;
    rules.applyAction(s, 'p0', { turnId:'r',stage:'fountain' }, 4500); rules.applyAction(s, 'p1', { turnId:'r',stage:'battlefield' }, 4500);
    rules.tick(s, new Map(), 1/60, 23999); assert.equal(s.phase, 'vote'); rules.tick(s, new Map(), 1/60, 24000); assert.ok(['fountain','battlefield'].includes(s.stageId)); choices.add(s.stageId);
  }
  assert.equal(choices.size, 2);
  const none = voting(); rules.tick(none, new Map(), 1/60, 24000); assert.equal(none.stageId, 'cloudbreak'); assert.equal(none.phase, 'countdown');
  assert.deepEqual(create().mapVotes, []);
});
test('disconnects do not hold up completed votes; reconnect restores the accepted vote', () => {
  const s = voting(); rules.onPresenceChange(s, 'p3', false, 4100);
  for (let i=0;i<3;i++) rules.applyAction(s, `p${i}`, {turnId:'r',stage:'fountain'}, 4200);
  rules.onPresenceChange(s, 'p0', false, 4300); rules.onPresenceChange(s, 'p0', true, 4400);
  assert.equal(rules.publicView(s,{nowMs:4400,phase:'playing'}).mapVotes[0].stageId,'fountain');
  rules.tick(s,new Map(),1/60,4500); assert.equal(s.phase,'countdown'); assert.equal(s.stageId,'fountain');
});
test('every fighter can full-jump onto Cloudbreak side platforms, then reach the top without an air jump', () => {
  for (const kind of ROSTER) for (const upper of [false,true]) {
    const s=create(); s.phase='fight'; const p=s.players[0];p.kind=kind;p.x=upper?-2.65:-4;p.y=upper?1.5:0;
    let landed=false;
    for(let frame=0;frame<180;frame++) {
      const input:Input={...neutralInput(),x:upper && p.x<-.7?1:0,jump:true,presses:{jump:1,attack:0,special:0,smash:0}};
      rules.tick(s,new Map([['p0',input]]),1/60,1000+frame*1000/60);
      if(frame>10 && p.grounded && p.y===(upper?3:1.5)){landed=true;break;}
    }
    assert.ok(landed,`${kind}: ${upper?'upper':'side'} platform`);
  }
});

test('lobby choices skip repeated selection, resolve the map and preserve all chosen fighters', () => {
  const players = ctx.players.map((p,i) => ({...p,lobbyChoice:{kind:ROSTER[i],stage:i<3?'temple':'cloudbreak'}}));
  const s=rules.create({...ctx,players},rules.validateSettings({}));
  assert.equal(s.phase,'countdown');assert.equal(s.stageId,'temple');assert.equal(s.mapVotes.length,4);assert.equal(s.endsAt,ctx.nowMs+3000+900000);
  assert.deepEqual(s.players.map(p=>p.kind),ROSTER.slice(0,4));assert.ok(s.players.every(p=>p.chosen));
  for(const raw of [undefined,{kind:'bad',stage:'temple'},{kind:'mario',stage:null},{kind:'mario',stage:'random'},{kind:'mario',stage:'temple',extra:true}]) assert.throws(()=>rules.parseLobbyChoice!(raw,true));
  assert.deepEqual(rules.parseLobbyChoice!({kind:'mario',stage:null},false),{kind:'mario',stage:null});
});
test('unlimited rounds have no timer expiration, still finish on stocks, and expose finite JSON', () => {
  assert.equal(rules.validateSettings({}).seconds,900);assert.equal(rules.validateSettings({seconds:0}).seconds,0);
  const s=rules.create({...ctx,players:ctx.players.map(p=>({...p,lobbyChoice:{kind:'mario',stage:'cloudbreak'}}))},{seconds:0,stocks:3});
  rules.tick(s,new Map(),1/60,4000);assert.equal(s.phase,'fight');assert.equal(s.endsAt,0);
  rules.tick(s,new Map(),1/60,1000+24*3600000);assert.equal(s.phase,'fight');assertSerializable(rules.publicView(s,{nowMs:100000000,phase:'playing'}));
  s.players.slice(1).forEach(p=>{p.stocks=0;p.mode='out';});rules.tick(s,new Map(),1/60,100000001);assert.equal(s.phase,'complete');assert.deepEqual(rules.outcome(s).winners,['p0']);
});
