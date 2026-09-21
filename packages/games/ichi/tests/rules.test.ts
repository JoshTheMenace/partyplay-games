import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules, type State } from '../src/server';
import { colors, defaults, packs, type Action, type Card, type Color, type Settings } from '../src/types';
const ctx = (count = 2, seed = 1234) => ({ roomId: 'room', roundId: 'round', nowMs: 0, seed, players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player000000000${i}`, color: '#ff5748' })) });
const classic = { ...defaults, ...Object.fromEntries(Object.keys(packs).map(k => [k, false])) } as Settings;
const view = (s: State) => rules.publicView(s, { nowMs: s.lastNow, phase: 'playing' });
const own = (s: State, id = s.players[s.current].id) => rules.playerView(s, id, { nowMs: s.lastNow, phase: 'playing' });
const act = (s: State, action: Omit<Action, 'turnId'>, id = s.players[s.current].id) => rules.applyAction(s, id, { ...action, turnId: view(s).turnId } as Action, s.lastNow + 1);
let serial = 0;
const card = (value: string, color: Color | 'wild' = 'coral'): Card => ({ id: `fixture${serial++}`, faces: [{ color, value }, { color: color === 'wild' ? 'wild' : 'sky', value }], revealed: false, decoy: null, progress: null });
function table(settings: Partial<Settings> = {}, count = 3) { const s = rules.create(ctx(count), { ...classic, ...settings }); s.discard = [card('4')]; s.color = 'coral'; for (const p of s.players) p.hand = [card('8'), card('9')]; return s; }
const play = (s: State, c: Card, extra: { color?: Color; target?: string } = {}, id = s.players[s.current].id) => act(s, { kind: 'play', cardId: c.id, ...extra } as Omit<Action, 'turnId'>, id);

test('settings and actions reject malformed payloads', () => {
  assert.deepEqual(rules.validateSettings({}), defaults);
  for (const raw of [null, [], { bogus: true }, { handSize: 11 }, { jump: 'yes' }, { turnSeconds: NaN }]) assert.throws(() => rules.validateSettings(raw));
  for (const raw of [null, { kind: 'play', turnId: 'a' }, { kind: 'pass', turnId: 'a', cheat: 1 }, { kind: 'play', turnId: 'a', cardId: 'c', color: 'blue' }]) assert.throws(() => rules.parseAction(raw));
});
test('draw is a strategic choice; only the drawn card can play; stale and duplicate actions fail', () => {
  const s = table(); const old = view(s).turnId, held = s.players[0].hand[0];
  act(s, { kind: 'draw' }); assert.equal(s.players[0].hand.length, 3);
  assert.throws(() => rules.applyAction(s, 'p0', { kind: 'draw', turnId: old }, 2));
  assert.throws(() => act(s, { kind: 'draw' })); assert.throws(() => play(s, held));
  act(s, { kind: 'pass' }); assert.equal(s.current, 1); assert.equal(s.turn, 1);
  assert.throws(() => act(s, { kind: 'pass' }));
});
test('invalid wild color and reveal target leave state untouched', () => {
  for (const value of ['wild','eye']) {
    const s = table({ reveal: true }); s.players[0].hand[0] = card(value, value === 'wild' ? 'wild' : 'coral');
    const before = structuredClone(s); assert.throws(() => play(s, s.players[0].hand[0])); assert.deepEqual(s, before);
  }
});
test('two-player reverse repeats the player; draw two draws and skips without stacking', () => {
  const s = table({}, 2); s.players[0].hand[0] = card('reverse'); play(s, s.players[0].hand[0]); assert.equal(s.current, 0); assert.equal(s.direction, -1);
  const t = table(); t.players[0].hand[0] = card('+2'); play(t, t.players[0].hand[0]); assert.equal(t.current, 2); assert.equal(t.players[1].hand.length, 4);
});
test('mission locks until three distinct colors, then acts as a wild', () => {
  const s = table({ missions: true }); const mission = card('mission', 'wild'); mission.progress = []; s.players[0].hand.push(mission);
  assert.throws(() => play(s, mission, { color: 'sun' }));
  for (const color of ['coral','sky','lime'] as const) { s.current = 0; s.color = color; const c = card('2', color); s.players[0].hand.push(c); play(s, c); }
  assert.deepEqual(mission.progress, ['coral','sky','lime']); s.current = 0; play(s, mission, { color: 'sun' }); assert.equal(s.color, 'sun');
});
test('reveal follows a physical card through hand trade and flip', () => {
  const s = table({ reveal: true, trade: true, flip: true }); s.players[0].hand[0] = card('eye'); play(s, s.players[0].hand[0], { target: 'p1' });
  const revealed = s.players[1].hand.find(c => c.revealed)!; assert.ok(revealed); assert.equal(view(s).players[1].revealed.length, 1);
  s.players[1].hand.push(card('trade')); play(s, s.players[1].hand.at(-1)!); assert.ok(s.players[2].hand.includes(revealed));
  s.players[2].hand.push(card('flip')); play(s, s.players[2].hand.at(-1)!); assert.equal(s.side, 1); assert.deepEqual(view(s).players[2].revealed[0], revealed.faces[1]);
});
test('trade resolves before winning, including an empty hand', () => {
  const s = table({ trade: true }); s.players[0].hand = [card('trade')]; play(s, s.players[0].hand[0]); assert.equal(s.complete, true); assert.deepEqual(rules.outcome(s).winners, ['p1']);
});
test('decoy conceals both faces and requires inspection; inspection does not advance', () => {
  const s = table({ decoy: true }); s.players[0].hand[0] = card('mask'); play(s, s.players[0].hand[0]);
  const c = s.players[1].hand.at(-1)!; const shown = own(s,'p1').hand.at(-1)!; assert.ok(shown.disguised); assert.deepEqual(shown.back,c.decoy); assert.notDeepEqual(c.decoy,c.faces[s.side]);
  const turn = s.turn; act(s, { kind: 'inspect', cardId: c.id } as Omit<Action,'turnId'>, 'p1'); assert.equal(s.turn,turn); assert.equal(own(s,'p1').hand.at(-1)!.disguised,false);
  assert.throws(() => act(s, { kind: 'inspect', cardId: c.id } as Omit<Action,'turnId'>, 'p0'));
});
test('identical number jump-in changes turn ownership and races reject stale turn', () => {
  const s = table({ jump: true }); s.players[2].hand[0] = card('4'); const old = view(s).turnId; play(s,s.players[2].hand[0],{},'p2'); assert.equal(s.current,0);
  assert.throws(() => rules.applyAction(s,'p1',{ kind:'play',cardId:s.players[1].hand[0].id,turnId:old },s.lastNow+1));
  s.players[1].hand[0] = card('4','sky'); assert.throws(() => play(s,s.players[1].hand[0],{},'p1'));
});
test('drift changes only active number faces every two completed turns', () => {
  const s = table({ drift:true }); const held = s.players[2].hand[0], back = { ...held.faces[1] }; play(s,s.players[0].hand[0]); assert.equal(held.faces[0].color,'coral'); play(s,s.players[1].hand[0]); assert.equal(held.faces[0].color,'sky'); assert.deepEqual(held.faces[1],back); assert.equal(s.color,'coral');
});
test('deck exhaustion, hand cap, disconnected timeout and ties terminate', () => {
  const s = table(); s.deck = []; s.discard.unshift(card('1')); act(s,{kind:'draw'}); assert.equal(s.players[0].hand.length,3); assert.equal(s.discard.length,1);
  s.players[0].hand = Array.from({length:30},()=>card('1')); act(s,{kind:'pass'}); s.current = 0; act(s,{kind:'draw'}); assert.equal(s.players[0].hand.length,30); assert.equal(s.current,1);
  const t = table(); rules.onPresenceChange(t,'p0',false,1); rules.tick(t,new Map(),0,t.deadline); assert.equal(t.current,1);
  t.turn = t.settings.maxTurns-1; t.players.forEach(p=>{p.hand=[card('8'),card('9')];}); t.drawn='already-drawn'; rules.tick(t,new Map(),0,t.deadline); assert.equal(t.complete,true); assert.equal(rules.outcome(t).winners.length,3);
});
test('all 256 expansion combinations complete deterministically at 2 and 10 players', () => {
  for (let bits=0;bits<256;bits++) for (const count of [2,10]) {
    const settings = { ...classic, maxTurns:80, ...Object.fromEntries(Object.keys(packs).map((k,i)=>[k,!!(bits & 1<<i)])) };
    const s = rules.create(ctx(count,bits+1),settings); assert.deepEqual(s,rules.create(ctx(count,bits+1),settings));
    for (let action=0;!s.complete && action<400;action++) {
      const id=s.players[s.current].id, cards=own(s).hand;
      const c=cards.find(c=>c.playable);
      if(c) act(s,{kind:'play',cardId:c.id,...(c.color==='wild'?{color:colors[action%4]}:{}),...(c.value==='eye'?{target:s.players.find(p=>p.id!==id)!.id}:{})} as Omit<Action,'turnId'>);
      else if(cards.some(c=>c.disguised)) act(s,{kind:'inspect',cardId:cards.find(c=>c.disguised)!.id} as Omit<Action,'turnId'>);
      else act(s,{kind:s.drawn?'pass':'draw'});
      assert.ok(s.players.every(p=>p.hand.length<=30));
      const physical=[...s.deck,...s.discard,...s.players.flatMap(p=>p.hand)]; assert.equal(new Set(physical.map(c=>c.id)).size,physical.length);
      const pub=view(s); assert.ok(pub.players.every(p=>!('hand' in p))); assert.ok(!('deck' in pub));
    }
    assert.ok(s.complete,`toggle bits ${bits}, ${count} players`); assert.ok(rules.outcome(s).winners.length);
  }
});
test('reveal unmasks a decoy for its owner and chooses an unexposed card', () => {
  const s = table({ reveal:true,decoy:true }); const c=card('3'); c.decoy={color:'sun',value:'9'}; s.players[1].hand=[c]; s.players[0].hand[0]=card('eye');
  play(s,s.players[0].hand[0],{target:'p1'}); assert.equal(c.decoy,null); assert.equal(own(s,'p1').hand[0].value,'3'); assert.equal(view(s).players[1].revealed[0].value,'3');
  s.current=0; s.players[0].hand.push(card('eye')); s.players[1].hand.push(card('6')); play(s,s.players[0].hand.at(-1)!,{target:'p1'}); assert.equal(view(s).players[1].revealed.length,2);
});
test('mission relocks after use, public pile identity stays stable on draw/pass', () => {
  const s=table({missions:true}); const c=card('mission','wild'); c.progress=['coral','sky','lime']; s.players[0].hand.push(c); play(s,c,{color:'sky'}); assert.deepEqual(c.progress,[]);
  const top=view(s).topId; act(s,{kind:'draw'}); act(s,{kind:'pass'}); assert.equal(view(s).topId,top);
});
test('backward wall-clock adjustments do not fail tick or presence, time stays monotonic', () => {
  const s=table(); rules.tick(s,new Map(),0,100); rules.tick(s,new Map(),0,50); rules.onPresenceChange(s,'p1',false,10); assert.equal(s.lastNow,100);
  rules.applyAction(s,'p0',{kind:'draw',turnId:view(s).turnId},1); assert.equal(s.lastNow,100);
});
test('each private view contains only its owner’s cards; the public view exposes only played or revealed cards', () => {
  for (const count of [2,10]) {
    const s=rules.create(ctx(count),defaults), publicView=view(s);
    assert.ok(publicView.players.every(p=>p.revealed.length===0));
    assert.equal(/"(?:hand|deck|faces|progress|drawnId|mutatedId)":/.test(JSON.stringify(publicView)),false);
    for (const p of s.players) {
      const privateView=own(s,p.id);
      assert.deepEqual(privateView.hand.map(c=>c.id),p.hand.map(c=>c.id));
      assert.deepEqual(Object.keys(privateView).sort(),['drawnId','hand','mutatedId']);
      assert.equal(privateView.hand.some(c=>s.players.some(other=>other!==p&&other.hand.some(held=>held.id===c.id))),false);
    }
    const exposed=s.players[0].hand[0]; exposed.revealed=true;
    assert.deepEqual(view(s).players[0].revealed,[exposed.faces[s.side]]);
    assert.ok(view(s).players.slice(1).every(p=>p.revealed.length===0));
    const before=structuredClone(s);assert.throws(()=>play(s,s.players[1].hand[0],{},s.players[0].id));assert.deepEqual(s,before);
  }
});
