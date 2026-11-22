import assert from 'node:assert/strict';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { rules, type State } from '../src/server';
import { botAction } from '../src/bot';
import { GUILTY, INNOCENT, MODIFIERS } from '../src/deck.server';
import { KINDS, SIDES, defaults, isCrowd, lapsFor, opposite, roundCount, type Action, type Card, type Phase, type Settings, type Side } from '../src/types';

export const ctx = (n = 4, seed = 1) => ({ roomId: 'room', roundId: 'round', nowMs: 1000, seed, players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, color: '#ff5748' })) });
export const game = (n = 4, settings: Partial<Settings> = {}, seed = 1) => rules.create(ctx(n, seed), { ...defaults, ...settings });
export const view = (s: State) => rules.publicView(s, { nowMs: s.now, phase: 'playing' });
export const me = (s: State, id: string) => rules.playerView(s, id, { nowMs: s.now, phase: 'playing' });
export const tick = (s: State, at = s.deadline) => rules.tick(s, new Map(), 0, at);
export const to = (s: State, phase: Phase, round = s.round) => { for (let i = 0; i < 2000 && !(s.phase === phase && s.round === round); i++) tick(s); assert.equal(`${s.round}.${s.phase}`, `${round}.${phase}`); };
type Loose = { [K in Action['kind']]: Omit<Extract<Action, { kind: K }>, 'turnId'> & { turnId?: string } }[Action['kind']];
export const act = (s: State, id: string, a: Loose, at = s.now + 1) => rules.applyAction(s, id, { turnId: view(s).turnId, ...a } as Action, at);
export const rejects = (s: State, fn: () => void, message: RegExp = /./) => { const before = structuredClone(s); assert.throws(fn, message); assert.deepEqual(s, before); };
export const stock = (s: State, side: Side, kind: Card['kind']) => s.hands[side][kind].filter(c => !c.blank);
export const cues = (s: State, kind: string) => s.cues.filter(c => c.kind === kind).map(c => c.id);
export const BANKS = { innocent: INNOCENT, guilty: GUILTY, modifier: MODIFIERS };
export const rng = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
/** Seats in the Gallery this case (empty up to ten players). */
export const galleryOf = (s: State) => s.crowd ? s.players.filter(p => p.id !== s.conductor && !SIDES.some(side => s.teams[side].includes(p.id))).map(p => p.id) : [];

/** Projection checks: serializable, no undefined fields, nothing unrevealed in public, no foreign hands or ballots in private views. */
export function check(s: State) {
  const pub = view(s), json = JSON.stringify(pub);
  assertSerializable(pub); assert.deepEqual(JSON.parse(json), pub); assertSerializable(rules.outcome(s));
  const shown = SIDES.flatMap(side => s.tracks[side].slots.flatMap(x => x ? [x.card, ...x.mods.map(m => m.card)] : []));
  const ids = new Set(shown.map(c => c.id)), texts = new Set(shown.map(c => c.text));
  const ballot = [...s.jury.options, ...(s.jury.card ? [s.jury.card] : [])].filter(c => !ids.has(c.id));
  const secret = [...SIDES.flatMap(side => KINDS.flatMap(k => s.hands[side][k])), ...s.queue.map(q => q.placed.card), ...ballot].filter(c => !ids.has(c.id));
  const drafts = SIDES.flatMap(side => s.slots[side].flatMap(x => [x.locked?.text, ...x.proposals.map(p => p.text)]));
  for (const c of secret) assert.ok(!json.includes(`"${c.id}"`), `public view leaks ${c.id}`);
  for (const t of [...secret.map(c => c.text), ...drafts]) if (t && !texts.has(t)) assert.ok(!json.includes(JSON.stringify(t)), `public view leaks "${t}"`);
  for (const kind of KINDS) assert.equal(s.deck[kind].length + s.discard[kind].length + s.dealt.filter(c => c.kind === kind).length, BANKS[kind].filter(c => !s.settings.family || !c.spicy).length);
  const seated = galleryOf(s), hands = SIDES.flatMap(side => KINDS.flatMap(k => s.hands[side][k]));
  assert.equal(pub.gallery.length, s.crowd ? s.players.length : 0); assert.equal([...pub.gallery].filter(c => c !== '-').length, seated.length);
  for (const p of s.players) {
    const mine = me(s, p.id), pj = JSON.stringify(mine);
    assertSerializable(mine); assert.deepEqual(JSON.parse(pj), mine);
    if (mine.role !== 'gallery') for (const c of ballot) assert.ok(!pj.includes(`"${c.id}"`), `${p.id} sees the Gallery's ${c.id}`);
    if (mine.role === 'conductor') { assert.equal(p.id, s.conductor); assert.deepEqual(mine, { role: 'conductor', side: null, turnId: pub.turnId, hands: { innocent: [], guilty: [], modifier: [] }, slots: [] }); continue; }
    if (mine.role === 'gallery') {
      assert.ok(seated.includes(p.id)); assert.deepEqual([mine.hands, mine.slots, mine.side], [{ innocent: [], guilty: [], modifier: [] }, [], s.stand[p.id] ?? null]);
      for (const c of hands) assert.ok(!pj.includes(`"${c.id}"`), `Gallery seat ${p.id} sees ${c.id}`);
      continue;
    }
    assert.ok(s.teams[mine.side!].includes(p.id)); assert.equal(mine.jury, undefined);
    for (const c of KINDS.flatMap(k => s.hands[opposite(mine.side!)][k])) assert.ok(!pj.includes(`"${c.id}"`), `${p.id} sees ${c.id}`);
  }
}

/** Drives a game with bots (or none) on a 250 ms fake clock until complete, checking projections at every step. each runs after every step. */
export function play(n: number, settings: Partial<Settings> = {}, seed = 1, bots = true, each?: (s: State) => void) {
  const s = game(n, settings, seed), random = rng(seed), rejected: string[] = [];
  let accepted = 0, key = '';
  for (let i = 0; i < 200000 && s.phase !== 'complete'; i++) {
    if (bots) { let v = view(s); for (const p of s.players) {
      const a = botAction(v, me(s, p.id), p.id, random, s.now);
      if (a) try { rules.applyAction(s, p.id, a, s.now); accepted++; v = view(s); } catch (e) { rejected.push((e as Error).message); }
    } }
    if (`${s.round}.${s.phase}.${s.step}` !== key) {
      key = `${s.round}.${s.phase}.${s.step}`; check(s);
      assert.equal(new Set(s.dealt.map(c => c.id)).size, s.dealt.length, 'a card repeated within a round');
    }
    each?.(s);
    tick(s, Math.min(s.deadline, s.now + 250));
  }
  check(s);
  return { s, accepted, rejected };
}
export function finished(s: State, n: number, laps: Settings['laps'] = 'auto') {
  const out = rules.outcome(s), fewest = Math.min(...s.players.map(p => p.deaths));
  assert.equal(s.phase, 'complete'); assert.equal(s.history.length, roundCount(n, laps)); assert.equal(out.complete, true);
  assert.deepEqual(out.winners, s.players.filter(p => p.deaths === fewest).map(p => p.id));
  s.players.forEach((p, seat) => {
    if (!isCrowd(n)) assert.equal(p.conducted, lapsFor(n, laps));
    assert.equal(p.conducted, s.history.filter(h => h.conductor === p.id).length); assert.equal(p.deaths + p.spared + p.conducted, s.history.length);
    assert.equal(p.deaths, s.history.filter(h => h.victims.includes(seat)).length);
  });
  for (const h of s.history) assert.equal(h.struck, h.pulled ? opposite(h.defaultSide) : h.defaultSide);
  assert.deepEqual(s.cues.map(c => c.seq), s.cues.map((_, i) => s.seq - s.cues.length + 1 + i));
  assert.equal(s.cues.at(-1)!.id, out.winners.length > 1 ? 'tie' : 'end');
}
