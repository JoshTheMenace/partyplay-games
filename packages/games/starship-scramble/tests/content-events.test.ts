import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS } from '../src/content/events/index';
import { ENEMY_IDS, SECTOR_IDS, SPECIAL_EVENT_IDS, type EventDef, type EventEffect, type Requirement } from '../src/content/types';
import { AUGMENTS, ROLES, SPECIES, SYSTEMS, WEAPONS } from '../src/defs/catalog';

const byId = new Map(EVENTS.map(e => [e.id, e]));
const choices = EVENTS.flatMap(e => e.choices.map(c => ({ e, c })));
const effects = choices.flatMap(({ e, c }) => c.outcomes.flatMap(o => o.effects.map(x => ({ e, x }))));
const has = (list: readonly { id: string }[], id: string) => list.some(item => item.id === id);
const WHO = ['fleet', 'random', 'weakest'], HAZARDS = ['none', 'asteroids', 'solar', 'ion-storm', 'nebula'], KINDS = ['unknown', 'hostile', 'distress', 'nebula'];
const WEAPON_KINDS = new Set(WEAPONS.map(w => w.kind));
/** Explicit enemies in a sector-locked event must belong to that sector's faction (the Armada roams everywhere). */
const FACTION: Record<string, string[]> = { rustbelt: ['raider', 'rogue'], veil: ['vesk'], meridian: ['warden'] };
const eligible = (sector: string, kinds: string[]) => EVENTS.filter(e => !e.requiresFlag && (e.sectors === 'any' || e.sectors.includes(sector)) && e.kinds.some(k => kinds.includes(k)));

function checkEffect(x: EventEffect): string | null {
  switch (x.kind) {
    case 'scrap': return Number.isInteger(x.amount) && x.amount !== 0 && Math.abs(x.amount) <= 50 ? null : 'scrap amount';
    case 'hull': return Number.isInteger(x.amount) && x.amount !== 0 && Math.abs(x.amount) <= 10 && WHO.includes(x.who) ? null : 'hull';
    case 'crewDamage': return x.amount > 0 && WHO.includes(x.who) ? null : 'crewDamage';
    case 'ammo': return Number.isInteger(x.amount) && x.amount !== 0 && WHO.includes(x.who) ? null : 'ammo';
    case 'systemDamage': return has(SYSTEMS, x.system) && x.amount > 0 && WHO.includes(x.who) ? null : 'systemDamage';
    case 'upgrade': return has(SYSTEMS, x.system) && WHO.includes(x.who) ? null : 'upgrade';
    case 'crew': return (!x.species || has(SPECIES, x.species)) && (!x.role || has(ROLES, x.role)) ? null : 'crew';
    case 'item': {
      if (!x.id) return x.tier === undefined || [1, 2, 3].includes(x.tier) ? null : 'item tier';
      if (x.item === 'augment') return has(AUGMENTS, x.id) ? null : `augment ${x.id}`;
      const def = WEAPONS.find(w => w.id === x.id);
      return def && (x.tier === undefined || x.tier === def.tier) ? null : `weapon ${x.id}`;
    }
    case 'combat': return (x.enemies === 'sector' || (x.enemies.length > 0 && x.enemies.every(id => (ENEMY_IDS as readonly string[]).includes(id))))
      && (!x.hazard || HAZARDS.includes(x.hazard)) && (x.bonus === undefined || x.bonus > 0) ? null : 'combat';
    case 'armada': case 'reserves': return Number.isInteger(x.amount) && x.amount !== 0 ? null : x.kind;
    case 'flag': return /^[a-z-]+$/.test(x.flag) ? null : 'flag';
    case 'event': return byId.get(x.eventId)?.kinds.length === 0 ? null : `follow-up ${x.eventId}`;
    case 'crewLoss': case 'store': case 'reveal': return null;
  }
}
function checkRequirement(r: Requirement): boolean {
  switch (r.kind) {
    case 'system': { const def = SYSTEMS.find(s => s.id === r.system); return !!def && r.tier >= 1 && r.tier <= def.maxTier; }
    case 'weapon': return WEAPON_KINDS.has(r.weaponKind);
    case 'species': return has(SPECIES, r.species);
    case 'role': return has(ROLES, r.role);
    case 'augment': return has(AUGMENTS, r.augment);
    case 'scrap': return Number.isInteger(r.amount) && r.amount > 0 && r.amount <= 50;
  }
}

test('event ids are unique and choice ids unique per event', () => {
  assert.equal(byId.size, EVENTS.length);
  for (const e of EVENTS) assert.equal(new Set(e.choices.map(c => c.id)).size, e.choices.length, e.id);
});

test('events fit the TV: titles, bodies, labels and outcomes stay short', () => {
  for (const e of EVENTS) {
    assert.ok(e.title.length <= 32, `${e.id} title ${e.title.length}`);
    assert.ok(e.text.length <= 280, `${e.id} text ${e.text.length}`);
    for (const c of e.choices) {
      assert.ok(c.label.length <= 48, `${e.id}/${c.id} label ${c.label.length}`);
      for (const o of c.outcomes) assert.ok(o.text.length <= 220, `${e.id}/${c.id} outcome ${o.text.length}`);
    }
  }
});

test('copy never assumes a single ship and avoids typographic tells', () => {
  for (const e of EVENTS) for (const s of [e.title, e.text, ...e.choices.flatMap(c => [c.label, ...c.outcomes.map(o => o.text)])])
    assert.doesNotMatch(s, /\byour ship\b|\b(one|two|three|four) captains\b|[—–“”‘’]/i, `${e.id}: ${s}`);
});

test('every event is structurally valid with a free choice and positive weights', () => {
  for (const e of EVENTS) {
    assert.ok(e.weight > 0 && e.choices.length > 0, e.id);
    assert.ok(e.sectors === 'any' || (e.sectors.length > 0 && e.sectors.every(s => (SECTOR_IDS as readonly string[]).includes(s))), `${e.id} sectors`);
    assert.ok(e.kinds.every(k => KINDS.includes(k)), `${e.id} kinds`);
    assert.ok(e.choices.some(c => !c.requires), `${e.id} has no free choice`);
    for (const c of e.choices) {
      assert.ok(c.outcomes.length > 0 && c.outcomes.every(o => o.weight > 0), `${e.id}/${c.id} outcomes`);
      if (c.requires) assert.ok(checkRequirement(c.requires), `${e.id}/${c.id} requirement`);
    }
  }
});

test('every effect is valid and references real content', () => {
  for (const { e, x } of effects) assert.equal(checkEffect(x), null, `${e.id}: ${JSON.stringify(x)}`);
});

test('explicit enemies match the faction of a sector-locked event', () => {
  for (const { e, x } of effects) if (x.kind === 'combat' && x.enemies !== 'sector' && e.sectors !== 'any')
    for (const id of x.enemies) assert.ok(id.startsWith('armada') || (e.sectors as string[]).every(s => FACTION[s].some(p => id.startsWith(p))), `${e.id}: ${id}`);
});

test('flags are set before they are required, and follow-ups are reachable', () => {
  const setters = new Map<string, string[]>();
  for (const { e, x } of effects) if (x.kind === 'flag') setters.set(x.flag, [...setters.get(x.flag) ?? [], e.id]);
  for (const e of EVENTS) if (e.requiresFlag) assert.ok(setters.get(e.requiresFlag)?.some(id => id !== e.id), `${e.id} needs ${e.requiresFlag}`);
  const targets = new Set(effects.flatMap(({ x }) => x.kind === 'event' ? [x.eventId] : []));
  for (const e of EVENTS) if (e.kinds.length === 0) assert.ok(targets.has(e.id) || (SPECIAL_EVENT_IDS as readonly string[]).includes(e.id), `${e.id} is unreachable`);
});

test('quest chains: three flag chains, each unique and paying off', () => {
  const gated = EVENTS.filter(e => e.requiresFlag);
  assert.ok(new Set(gated.map(e => e.requiresFlag)).size >= 3);
  for (const e of gated) assert.ok(e.unique, `${e.id} should be unique`);
  const payoffs = gated.flatMap(e => e.choices.flatMap(c => c.outcomes.flatMap(o => o.effects)));
  assert.ok(payoffs.some(x => x.kind === 'reserves' && x.amount > 0), 'reserve hull payoff');
  assert.ok(payoffs.some(x => x.kind === 'armada' && x.amount < 0), 'Armada delay payoff');
  assert.ok(payoffs.some(x => x.kind === 'item' && x.id), 'unique item payoff');
});

test('specials exist with no node kinds; the flagship hail leads to the boss', () => {
  for (const id of SPECIAL_EVENT_IDS) assert.deepEqual(byId.get(id)?.kinds, [], id);
  const hail = byId.get('flagship-hail')!;
  assert.ok(hail.choices.every(c => c.outcomes.every(o => o.effects.some(x => x.kind === 'combat' && x.enemies !== 'sector' && x.enemies.includes('flagship') && x.objective === 'destroy'))));
  const ambush = byId.get('armada-ambush')!;
  assert.ok(ambush.choices.some(c => !c.requires && c.outcomes.every(o => o.effects.some(x => x.kind === 'combat'))));
  assert.ok(ambush.choices.some(c => c.requires?.kind === 'system' && c.requires.system === 'cloak'));
});

test('library coverage: sizes per sector, every effect and requirement kind used', () => {
  const hostile = EVENTS.filter(e => e.kinds.includes('hostile')), calm = EVENTS.filter(e => e.kinds.some(k => k !== 'hostile'));
  assert.ok(hostile.length >= 24 && calm.length >= 35, `${hostile.length} hostile, ${calm.length} other`);
  for (const s of SECTOR_IDS) {
    assert.ok(eligible(s, ['hostile']).length >= 6, `${s} hostile`);
    assert.ok(eligible(s, ['unknown', 'distress', 'nebula']).length >= 10, `${s} non-hostile`);
  }
  assert.ok(eligible('veil', ['nebula']).length >= 4, 'veil nebula events');
  assert.ok(hostile.some(e => e.choices.some(c => c.outcomes.some(o => o.effects.some(x => x.kind === 'combat' && x.objective === 'survive')))), 'survive fights');
  for (const h of ['asteroids', 'solar', 'ion-storm', 'nebula']) assert.ok(effects.some(({ x }) => x.kind === 'combat' && x.hazard === h), h);
  const used = new Set(effects.map(({ x }) => x.kind));
  for (const k of ['scrap', 'hull', 'item', 'crew', 'crewDamage', 'crewLoss', 'ammo', 'systemDamage', 'upgrade', 'combat', 'store', 'armada', 'reveal', 'reserves', 'flag', 'event']) assert.ok(used.has(k as EventEffect['kind']), k);
  const reqs = new Set(choices.flatMap(({ c }) => c.requires ? [c.requires.kind] : []));
  for (const k of ['system', 'weapon', 'species', 'role', 'augment', 'scrap']) assert.ok(reqs.has(k as Requirement['kind']), k);
  const blue = calm.filter(e => e.choices.some(c => c.requires)).length / calm.length;
  assert.ok(blue >= .3, `blue share ${blue}`);
});

test('hostile intros mostly lead to combat', () => {
  const hostile: EventDef[] = EVENTS.filter(e => e.kinds.includes('hostile'));
  const fights = hostile.filter(e => e.choices.some(c => c.outcomes.some(o => o.effects.some(x => x.kind === 'combat'))));
  assert.ok(fights.length / hostile.length >= .9);
});
