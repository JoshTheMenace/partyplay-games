import test from 'node:test';
import assert from 'node:assert/strict';
import { collectBoxes, handleItemInput, itemWeights, ITEM_IDS, ITEMS, MAX_PEELS, rollItem, rollWeights, ROULETTE_SECONDS, stepItems, strike } from '../src/sim/items';
import { createRace, NEUTRAL_INPUT } from '../src/sim/race';
import { collideKarts } from '../src/sim/physics';
import { pointAt, queryTrack, type Track } from '../src/sim/track';
import { getTrack } from '../src/tracks/index';
import type { Entity, Input, ItemId, Race, Racer } from '../src/sim/types';

const DT = 1 / 60;
function setup(n = 3) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: '#fff' }));
  const race = createRace({ track: 'palm-bay', laps: 3, speedClass: 100, difficulty: 'normal', gridSize: n, items: 'normal', views: 'tv' }, players, 42, 'tv');
  race.phase = 'racing'; race.time = 10;
  const track = getTrack('palm-bay');
  return { race, track, r: race.racers, d0: straight(track) };
}
/** Start of the longest near-straight stretch, so shots in tests fly true. */
function straight(track: Track) {
  const S = track.samples, n = S.length; let best = 0, bestRun = 0;
  for (let i = 0; i < n; i++) { let run = 0; while (run < n && Math.abs(S[(i + run) % n].curvature) < .004) run++; if (run > bestRun) { bestRun = run; best = i; } }
  return S[best].d + 4;
}
function place(track: Track, k: Racer, d: number, lateral = 0, speed = 0, rank?: number) {
  const p = pointAt(track, d, lateral), q = queryTrack(track, p.x, p.z, -1, p.y);
  Object.assign(k, { x: p.x, y: p.y, z: p.z, heading: p.heading, vx: Math.sin(p.heading) * speed, vy: 0, vz: Math.cos(p.heading) * speed, hint: q.index, d: q.d, lateral: q.lateral, invulnT: 0 });
  if (rank) k.rank = rank;
}
const give = (k: Racer, item: ItemId) => { k.item = item; k.itemCount = ITEMS[item].uses; k.rollT = 0; };
const tap = (race: Race, k: Racer, track: Track, held = false): Input => { const i = { ...NEUTRAL_INPUT, fire: (k.prevFire + 1) & 255, item: held, hop: k.prevHop }; handleItemInput(race, k, i, track); return i; };
const release = (race: Race, k: Racer, track: Track) => handleItemInput(race, k, { ...NEUTRAL_INPUT, fire: k.prevFire, item: false }, track);
const run = (race: Race, track: Track, seconds: number, until?: () => boolean) => { for (let t = 0; t < seconds; t += DT) { stepItems(race, track, DT); if (until?.()) return true; } return false; };
const events = (race: Race, type: string) => race.events.filter(e => e.type === type);

void test('every item has metadata and the roulette skews by position', () => {
  assert.equal(ITEM_IDS.length, 11);
  for (const id of ITEM_IDS) { assert.ok(ITEMS[id].name && ITEMS[id].blurb); assert.ok(ITEMS[id].uses >= 1); }
  const front = itemWeights(0, 'normal'), back = itemWeights(1, 'normal'), mid = itemWeights(.5, 'normal');
  const power = (w: Record<ItemId, number>) => (['super', 'thunder', 'comet', 'triple-nitro'] as ItemId[]).reduce((s, id) => s + w[id], 0);
  for (const id of ['super', 'thunder', 'comet', 'nitro', 'triple-nitro'] as ItemId[]) assert.equal(front[id], 0, `${id} never goes to the leader`);
  assert.ok(front.peel > back.peel && front.shield > back.shield);
  assert.ok(back.super > mid.super && mid.super > front.super);
  assert.equal(mid.thunder, 0, 'thunder is far-back only');
  assert.ok(power(itemWeights(0, 'frantic')) > power(front), 'frantic shifts the leader toward the back-of-pack table');
});

void test('item rolls are deterministic and rank-weighted; global cooldowns and one-at-a-time rules apply', () => {
  const a = setup(8), b = setup(8), counts = { lead: 0, last: 0 };
  a.r.forEach((k, i) => k.rank = i + 1); b.r.forEach((k, i) => k.rank = i + 1);
  for (let i = 0; i < 400; i++) {
    const x = rollItem(a.race, a.r[i % 2 ? 7 : 0]); assert.equal(x, rollItem(b.race, b.r[i % 2 ? 7 : 0]));
    if (['super', 'thunder', 'comet', 'triple-nitro'].includes(x)) counts[i % 2 ? 'last' : 'lead']++;
  }
  assert.equal(counts.lead, 0); assert.ok(counts.last > 80, `back of the pack rolls power items (${counts.last}/200)`);
  const last = a.r[7];
  assert.ok(rollWeights(a.race, last).thunder > 0 && rollWeights(a.race, last).comet > 0);
  a.race.cooldowns.thunder = 5; assert.equal(rollWeights(a.race, last).thunder, 0);
  a.r[3].item = 'comet'; assert.equal(rollWeights(a.race, last).comet, 0);
  a.r[2].inkT = 2; assert.equal(rollWeights(a.race, last).ink, 0);
  const small = setup(3); small.r[2].rank = 3; assert.equal(rollWeights(small.race, small.r[2]).comet, 0, 'comet needs 4+ racers');
});

void test('boxes break on contact, roll an item with a roulette, and reappear after 2.5 s', () => {
  const { race, track, r } = setup(2), box = track.boxes[0];
  assert.ok(box, 'track has item boxes');
  place(track, r[0], box.d, box.lateral);
  collectBoxes(race, track, DT);
  assert.equal(race.boxes[0], 2.5); assert.ok(r[0].item); assert.equal(r[0].rollT, ROULETTE_SECONDS);
  assert.equal(events(race, 'pickup')[0].value, 0);
  const rolled = r[0].item;
  tap(race, r[0], track); assert.equal(r[0].item, rolled, 'unusable while the roulette spins');
  r[0].x += 50;
  for (let t = 0; t < 2.4; t += DT) collectBoxes(race, track, DT);
  assert.ok(race.boxes[0] > 0, 'still broken');
  place(track, r[1], box.d, box.lateral); collectBoxes(race, track, DT); assert.equal(r[1].item, null, 'a broken box gives nothing');
  r[1].x += 50;
  for (let t = 0; t < .2; t += DT) collectBoxes(race, track, DT);
  assert.equal(race.boxes[0], 0, 'box is back');
  // Holding an item: the box still breaks but the slot is unchanged.
  r[0].x -= 50; r[0].rollT = 0; collectBoxes(race, track, DT); assert.equal(r[0].item, rolled); assert.equal(race.boxes[0], 2.5);
  race.items = 'off'; race.boxes[0] = 0; r[0].item = null; collectBoxes(race, track, DT); assert.equal(r[0].item, null, 'items off: no pickups');
});

void test('nitro boosts, triple nitro has three uses, bubble and star protect', () => {
  const { race, track, r, d0 } = setup(3); place(track, r[0], d0);
  give(r[0], 'nitro'); tap(race, r[0], track);
  assert.equal(r[0].item, null); assert.equal(r[0].boostT, 1.4); assert.equal(r[0].boostPower, .4); assert.equal(r[0].stats.itemsUsed, 1);
  assert.equal(events(race, 'item')[0].value, ITEM_IDS.indexOf('nitro'));
  give(r[0], 'triple-nitro');
  for (let i = 3; i > 0; i--) { assert.equal(r[0].itemCount, i); tap(race, r[0], track); }
  assert.equal(r[0].item, null);
  give(r[1], 'shield'); tap(race, r[1], track); assert.equal(r[1].shieldT, 12);
  assert.equal(strike(race, r[1], 'spin', r[0].id), 'blocked'); assert.equal(r[1].spinT, 0); assert.equal(r[1].shieldT, 0);
  assert.equal(events(race, 'shield-pop').length, 1);
  assert.equal(strike(race, r[1], 'spin', r[0].id), 'hit'); assert.ok(r[1].spinT > 0);
  assert.equal(r[1].stats.hitsTaken, 1); assert.equal(r[0].stats.hitsDealt, 1);
  give(r[2], 'super'); tap(race, r[2], track); assert.equal(r[2].starT, 7.5);
  assert.equal(strike(race, r[2], 'tumble', r[0].id), 'blocked'); assert.equal(r[2].tumbleT, 0);
  r[2].starT = 0; r[2].respawnT = 1; assert.equal(strike(race, r[2], 'tumble', r[0].id), 'immune');
  r[2].respawnT = 0; r[2].invulnT = .5; assert.equal(strike(race, r[2], 'tumble', r[0].id), 'blocked');
});

void test('peels drop behind, spin the next kart through, and are capped at 12', () => {
  const { race, track, r, d0 } = setup(2); place(track, r[0], d0 + 20, 0, 20);
  give(r[0], 'peel'); tap(race, r[0], track); release(race, r[0], track);
  const peel = race.entities[0];
  assert.equal(peel.kind, 'peel'); assert.ok(peel.d < r[0].d, 'dropped behind');
  run(race, track, .5); assert.ok(Math.abs(peel.y - queryTrack(track, peel.x, peel.z).ground!) < .01, 'settles on the road');
  place(track, r[1], peel.d, queryTrack(track, peel.x, peel.z).lateral, 20);
  stepItems(race, track, DT);
  assert.ok(r[1].spinT > 0); assert.equal(race.entities.length, 0);
  assert.equal(events(race, 'hit').at(-1)!.racer, r[1].id); assert.equal(r[0].stats.hitsDealt, 1);
  for (let i = 0; i < MAX_PEELS + 3; i++) { give(r[0], 'peel'); r[0].prevItem = false; tap(race, r[0], track); r[0].x += 3; }
  assert.equal(race.entities.filter(e => e.kind === 'peel').length, MAX_PEELS);
});

void test('bouncers fly fast, ricochet off walls inside the course, and spin who they hit', () => {
  const { race, track, r, d0 } = setup(2); place(track, r[0], d0); place(track, r[1], d0 + 150, 50);
  give(r[0], 'bouncer'); r[0].heading += .5;   // aim at the wall
  tap(race, r[0], track); release(race, r[0], track);
  const shell = race.entities[0];
  assert.equal(shell.kind, 'bouncer'); assert.ok(Math.hypot(shell.vx, shell.vz) >= 45);
  run(race, track, 1.2);
  assert.ok(shell.bounces >= 1, 'ricocheted'); assert.equal(queryTrack(track, shell.x, shell.z, shell.hint).beyond, 0, 'still inside the course');
  assert.equal(r[0].spinT, 0, 'owner immune right after firing');
  race.entities = []; place(track, r[1], d0 + 30); place(track, r[0], d0);
  give(r[0], 'bouncer'); tap(race, r[0], track); release(race, r[0], track);
  assert.ok(run(race, track, 2, () => r[1].spinT > 0), 'spun the kart ahead'); assert.equal(race.entities.length, 0);
});

void test('a trailed item blocks one shell from behind but not from the front', () => {
  const { race, track, r, d0 } = setup(2); place(track, r[0], d0); place(track, r[1], d0 + 30);
  give(r[1], 'peel'); tap(race, r[1], track, true); assert.equal(r[1].trailing, true);
  give(r[0], 'bouncer'); tap(race, r[0], track); release(race, r[0], track);
  assert.ok(run(race, track, 2, () => race.entities.length === 0));
  assert.equal(r[1].spinT, 0); assert.equal(r[1].item, null); assert.equal(r[1].trailing, false);
  assert.equal(events(race, 'shield-pop').at(-1)!.value, 1);
  // From the front the trailed peel does nothing.
  give(r[1], 'peel'); r[1].prevItem = false; tap(race, r[1], track, true); r[1].heading += Math.PI;
  give(r[0], 'bouncer'); tap(race, r[0], track); release(race, r[0], track);
  assert.ok(run(race, track, 2, () => r[1].spinT > 0)); assert.equal(r[1].trailing, false, 'hit drops the trailed item');
  // Releasing the item button deploys a trailed peel behind the kart.
  r[1].spinT = 0; place(track, r[1], d0 + 30); give(r[1], 'peel'); r[1].prevItem = false; tap(race, r[1], track, true); release(race, r[1], track);
  assert.equal(race.entities.at(-1)!.kind, 'peel');
});

void test('a seeker follows the course to the racer ahead and tumbles them', () => {
  const { race, track, r } = setup(3);
  place(track, r[0], 10, 0, 0, 3); place(track, r[1], 110, 5, 0, 1); place(track, r[2], 60, -4, 0, 2);
  give(r[0], 'seeker'); tap(race, r[0], track); release(race, r[0], track);
  const seeker = race.entities[0]; assert.equal(seeker.target, r[2].id, 'targets the racer ranked directly ahead');
  assert.ok(run(race, track, 6, () => r[2].tumbleT > 0), 'reached its target'); assert.equal(r[1].tumbleT, 0);
});

void test('bombs arc ahead, land, and blast everyone within 7 m after the fuse', () => {
  const { race, track, r, d0 } = setup(3); place(track, r[0], d0, 0, 25);
  give(r[0], 'bomb'); tap(race, r[0], track);
  const bomb = race.entities[0]; assert.equal(bomb.kind, 'bomb'); assert.ok(bomb.vy > 0);
  assert.ok(run(race, track, 1.5, () => bomb.bounces === 1), 'landed');
  const land = queryTrack(track, bomb.x, bomb.z); assert.ok(land.d - r[0].d > 15, `lands well ahead (${(land.d - r[0].d).toFixed(1)} m)`);
  place(track, r[1], land.d + 4, land.lateral + 3); place(track, r[2], land.d + 20, land.lateral);
  run(race, track, 1.3);
  assert.ok(r[1].tumbleT > 0, 'inside the blast'); assert.equal(r[2].tumbleT, 0, 'outside the blast');
  assert.ok(race.entities.some(e => e.kind === 'blast'));
});

void test('thunder shocks everyone ahead and starts a global cooldown; ink splats everyone ahead through bubbles', () => {
  const { race, track, r, d0 } = setup(4);
  r.forEach((k, i) => place(track, k, d0 + 60 - i * 20, 0, 0, i + 1));
  r[1].shieldT = 5; give(r[3], 'thunder'); tap(race, r[3], track);
  assert.ok(r[0].shockT > 0 && r[2].shockT > 0); assert.equal(r[1].shockT, 0); assert.equal(r[1].shieldT, 0);
  assert.equal(r[3].shockT, 0); assert.equal(race.cooldowns.thunder, 20); assert.equal(events(race, 'thunder').length, 1); assert.equal(r[3].stats.hitsDealt, 1, 'one zap = one hit landed');
  assert.equal(rollWeights(race, r[3]).thunder, 0); run(race, track, 20.1); assert.ok(rollWeights(race, r[3]).thunder > 0);
  r[0].shieldT = 5; r[2].spinT = 0; give(r[2], 'ink'); tap(race, r[2], track);
  assert.ok(r[0].inkT > 0 && r[1].inkT > 0 && r[0].shieldT > 0); assert.equal(r[3].inkT, 0);
});

void test('the comet flies to the leader and blasts them (radius 8), with a 25 s cooldown', () => {
  const { race, track, r } = setup(5);
  place(track, r[4], 20, 0, 0, 5); place(track, r[0], 320, 3, 0, 1); place(track, r[1], 323, -4, 0, 2); place(track, r[2], 150, 0, 0, 3); place(track, r[3], 100, 0, 0, 4);
  give(r[4], 'comet'); tap(race, r[4], track);
  assert.equal(race.cooldowns.comet, 25); assert.equal(events(race, 'comet')[0].other, r[0].id);
  assert.ok(run(race, track, 12, () => r[0].tumbleT > 0), 'hit the leader');
  assert.ok(r[1].tumbleT > 0, 'splash damage nearby'); assert.equal(r[2].tumbleT, 0, 'passed over the pack');
  assert.equal(events(race, 'explode').at(-1)!.value, 8);
});

void test('entities are fully defined, finite and JSON-safe', () => {
  const { race, track, r, d0 } = setup(3); place(track, r[0], d0, 0, 20);
  (['peel', 'bouncer', 'seeker', 'bomb'] as ItemId[]).forEach((id, i) => { place(track, r[0], d0 + i * 8, i - 2, 20); give(r[0], id); tap(race, r[0], track); release(race, r[0], track); });
  run(race, track, .9);
  const keys: (keyof Entity)[] = ['id', 'kind', 'owner', 'x', 'y', 'z', 'vx', 'vy', 'vz', 't', 'hint', 'd', 'target', 'bounces', 'fuse'];
  assert.ok(race.entities.length >= 3);
  for (const e of race.entities) for (const k of keys) {
    assert.notEqual(e[k], undefined, `${e.kind}.${k}`);
    if (typeof e[k] === 'number') assert.ok(Number.isFinite(e[k]), `${e.kind}.${k} finite`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(race.entities)), race.entities);
});

void test('a star kart ramming a rival is credited as a hit; the star shrugs off shells', () => {
  const { race, track, r, d0 } = setup(3); place(track, r[0], d0, 0, 25); place(track, r[1], d0 + 2, 0, 10);
  const ram = () => collideKarts(race.racers, race.racers.map(() => ({ topSpeed: 29, accel: 1, handling: 1, weight: 1, traction: 1 })), (v, s) => strike(race, race.racers[v], 'tumble', race.racers[s].id));
  r[0].starT = 5; place(track, r[2], d0 + 60); ram();
  assert.ok(r[1].tumbleT > 0); assert.equal(r[0].stats.hitsDealt, 1); assert.equal(events(race, 'hit').at(-1)!.other, r[0].id);
  // Finished karts are immune; a bubble pops with its event instead of vanishing silently.
  place(track, r[0], d0 + 100, 0, 25); place(track, r[2], d0 + 102, 0, 10); r[2].finishTime = 30; ram();
  assert.equal(r[2].tumbleT, 0, 'finished kart untouched'); r[2].finishTime = null; r[2].shieldT = 5; ram();
  assert.equal(r[2].tumbleT, 0); assert.equal(r[2].shieldT, 0); assert.equal(events(race, 'shield-pop').at(-1)!.racer, r[2].id);
  place(track, r[0], d0 + 30); place(track, r[1], d0); give(r[1], 'bouncer'); r[1].tumbleT = 0; tap(race, r[1], track); release(race, r[1], track);
  assert.ok(run(race, track, 2, () => race.entities.length === 0), 'shell destroyed on the star'); assert.equal(r[0].spinT, 0);
});
