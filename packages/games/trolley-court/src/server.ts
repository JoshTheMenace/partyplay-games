import type { GameRules } from '../../../party-contract/src/index';
import { GUILTY, INNOCENT, MODIFIERS } from './deck.server';
import {
  CUE_LIMIT, KINDS, MAX_MODIFIER_SLOTS, SIDES, TIMING, WRITE_IN_MAX, blankKind, cleanWriteIn, handSize, isPick, modifierSlots, opposite, parseSettings, revealMs, roundCount, seatTeams, turnIdFor,
  type Action, type Card, type CardKind, type Cue, type Input, type LineId, type Phase, type Pick, type Placed, type PlayerId, type PrivateView, type Proposal, type PublicPlayer,
  type PublicView, type RoundRecord, type Settings, type SfxId, type Side, type Target, type Track,
} from './types';

type Hands = Record<CardKind, Card[]>;
type Slot = { kind: CardKind; locked: Pick | null; proposals: Proposal[] };
/** A card waiting for its reveal beat: a track slot (mod false) or a twist attached to one (mod true). */
type Reveal = { target: Target; placed: Placed; mod: boolean };
export type State = {
  settings: Settings; rng: number; now: number; players: PublicPlayer[]; seq: number; cues: Cue[];
  phase: Phase; round: number; rounds: number; startedAt: number; deadline: number; step: number; steps: number;
  conductor: PlayerId; teams: Record<Side, PlayerId[]>; defaultSide: Side; lever: PublicView['lever']; underdogs: PlayerId[];
  /** Draw piles, discard piles, and every stock card dealt this round (discarded when the next round starts). */
  deck: Hands; discard: Hands; dealt: Card[];
  hands: Record<Side, Hands>; slots: Record<Side, Slot[]>; queue: Reveal[];
  tracks: Record<Side, Track>; progress: PublicView['progress']; spotlight: PublicView['spotlight']; floor: Side | null; struck: Side | null;
  history: RoundRecord[]; winners: PlayerId[]; lastLock: number; hurried: boolean; settled: boolean; ticks: number;
};

const STALE = 'Too late — the court has moved on.';
const BANKS: Record<CardKind, readonly Card[]> = { innocent: INNOCENT, guilty: GUILTY, modifier: MODIFIERS };
const FIELDS: Record<Action['kind'], readonly string[]> = {
  propose: ['kind', 'turnId', 'slot', 'cardId', 'text', 'target'], lock: ['kind', 'turnId', 'slot', 'cardId', 'text', 'target'],
  lean: ['kind', 'turnId', 'pulled'], next: ['kind', 'turnId', 'step'], decide: ['kind', 'turnId', 'pull'],
};
function fail(message: string): never { throw new Error(message); }
const record = (raw: unknown) => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : fail('Expected an object.');
const str = (v: unknown, message: string) => typeof v === 'string' && v.length > 0 && v.length <= 32 ? v : fail(message);
const int = (v: unknown, max: number, message: string) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? v as number : fail(message);
const bool = (v: unknown) => typeof v === 'boolean' ? v : fail('Expected on or off.');
function target(raw: unknown): Target {
  const t = record(raw);
  if (Object.keys(t).some(k => k !== 'side' && k !== 'slot') || !SIDES.includes(t.side as Side)) fail('Choose a card on the tracks.');
  return { side: t.side as Side, slot: int(t.slot, 2, 'Choose a card on the tracks.') as Target['slot'] };
}
const writable = (text?: string) => { try { cleanWriteIn(text); return true; } catch { return false; } };
const clock = (s: State, now: number) => Number.isFinite(now) ? Math.max(now, s.now) : s.now;
function random(s: State, max: number) { s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0; return Math.floor(s.rng / 4294967296 * max); }
function shuffle<T>(s: State, values: T[]) { for (let i = values.length - 1; i > 0; i--) { const j = random(s, i + 1); [values[i], values[j]] = [values[j], values[i]]; } return values; }
const empty = (): Hands => ({ innocent: [], guilty: [], modifier: [] });
const turnId = (s: State) => turnIdFor(s.round, s.phase);
const sideOf = (s: State, id: PlayerId) => SIDES.find(side => s.teams[side].includes(id)) ?? null;
const online = (s: State, id: PlayerId) => s.players.some(p => p.id === id && p.connected);
const slotCount = (s: State, side: Side, kind: CardKind) => kind !== 'modifier' ? 1
  : modifierSlots(s.teams[side].length, s.settings.accomplices, s.teams[side].some(id => s.underdogs.includes(id)));
function cue(s: State, c: { kind: 'sfx'; id: SfxId } | { kind: 'line'; id: LineId } | { kind: 'card'; id: string }) { s.cues = [...s.cues, { seq: ++s.seq, at: s.now, ...c }].slice(-CUE_LIMIT); }
const sfx = (s: State, ...ids: SfxId[]) => ids.forEach(id => cue(s, { kind: 'sfx', id }));
const line = (s: State, id: LineId) => cue(s, { kind: 'line', id });

/** Draws one stock card; an empty pile reshuffles its discard (this round's cards are not in it yet). */
function draw(s: State, kind: CardKind) {
  if (!s.deck[kind].length) { s.deck[kind] = shuffle(s, s.discard[kind]); s.discard[kind] = []; }
  const card = s.deck[kind].pop() ?? fail('The deck ran out.');
  s.dealt.push(card); return card;
}
function begin(s: State, phase: Phase, now: number, ms: number, steps = 1) {
  Object.assign(s, { phase, step: 0, steps, startedAt: now, deadline: now + ms, spotlight: null, floor: null });
}

function startRound(s: State, now: number) {
  s.round++;
  for (const c of s.dealt) s.discard[c.kind].push(c);
  s.dealt = [];
  const { conductor, north, south } = seatTeams(s.players.map(p => p.id), s.round), others = s.players.filter(p => p.id !== conductor), most = Math.max(...others.map(p => p.deaths));
  Object.assign(s, {
    conductor, teams: { north, south }, defaultSide: SIDES[random(s, 2)], lever: { pulled: false, decided: false, timedOut: false }, struck: null,
    underdogs: s.settings.catchUp && most > 0 ? others.filter(p => p.deaths === most).map(p => p.id) : [], slots: { north: [], south: [] },
    progress: { north: { locked: 0, total: 0 }, south: { locked: 0, total: 0 } },
    tracks: { north: { side: 'north', team: [...north], slots: [null, null, null] }, south: { side: 'south', team: [...south], slots: [null, null, null] } },
  });
  s.queue = SIDES.map(side => ({ target: { side, slot: 0 }, placed: { card: draw(s, 'innocent'), from: 'deck' }, mod: false }));
  for (const side of SIDES) for (const kind of KINDS) {
    const size = handSize(kind, slotCount(s, side, kind)), blank = s.settings.blanks && blankKind(s.round) === kind;
    const hand = Array.from({ length: size - (blank ? 1 : 0) }, () => draw(s, kind));
    if (blank) hand.splice(random(s, size), 0, { id: `w${s.round}${side[0]}`, kind, text: '', blank: true });
    s.hands[side][kind] = hand;
  }
  begin(s, 'deal', now, TIMING.dealMs + (s.round === 1 ? TIMING.welcomeMs : 0), 3);
  line(s, s.round === 1 ? 'welcome' : s.round === s.rounds ? 'final-round' : 'round');
  line(s, `heading.${s.defaultSide}`); sfx(s, 'deal');
}
/** Next beat of deal or a reveal phase: the queued card lands on the tracks now, never earlier. */
function reveal(s: State, now: number) {
  const r = s.queue[s.step++], track = s.tracks[r.target.side];
  s.startedAt = now; s.deadline = now + revealMs(r.placed.card.text, s.settings.readAloud);
  if (r.mod) { const host = track.slots[r.target.slot]!; host.mods.push(r.placed); s.spotlight = { ...r.target, mod: host.mods.length - 1 }; }
  else { track.slots[r.target.slot] = { ...r.placed, mods: [] }; s.spotlight = { ...r.target }; }
  sfx(s, s.phase === 'modifierReveal' ? 'stamp' : s.phase === 'guiltyReveal' ? 'reveal' : 'flip');
  if (s.settings.readAloud) cue(s, { kind: 'card', id: r.placed.card.id });
}
function startPick(s: State, kind: CardKind, now: number) {
  begin(s, kind, now, (kind === 'modifier' ? s.settings.modifierSeconds : s.settings.pickSeconds) * 1000);
  for (const side of SIDES) { s.slots[side] = Array.from({ length: slotCount(s, side, kind) }, () => ({ kind, locked: null, proposals: [] })); s.progress[side] = { locked: 0, total: s.slots[side].length }; }
  Object.assign(s, { queue: [], lastLock: now, hurried: false, settled: false });
  line(s, `pick.${kind}`); settle(s);
}
/** Once every team with a connected member has locked everything, the pick ends after a short "All locked" beat. */
function settle(s: State) {
  if (s.settled || !isPick(s.phase) || !SIDES.every(side => !s.teams[side].some(id => online(s, id)) || s.slots[side].every(x => x.locked))) return;
  s.settled = true; s.deadline = Math.min(s.deadline, Math.max(s.lastLock + TIMING.settleMs, s.startedAt + TIMING.minPickMs));
  if (SIDES.some(side => s.slots[side].some(x => x.locked))) sfx(s, 'all-locked');
}
/** Turns a team's slots into placed cards, auto-filling open slots: most-proposed card (ties: earliest), else a random stock card. */
function resolve(s: State, side: Side, kind: CardKind) {
  const hand = s.hands[side][kind], used = new Set(s.slots[side].flatMap(x => x.locked ? [x.locked.cardId] : []));
  return s.slots[side].map(slot => {
    if (slot.locked) {
      const { cardId, text, target: t, by } = slot.locked, card = hand.find(c => c.id === cardId)!;
      return { placed: { card: text === undefined ? card : { ...card, text }, from: side, by } as Placed, target: t };
    }
    const ok = slot.proposals.filter(p => !used.has(p.cardId) && hand.some(c => c.id === p.cardId && (!c.blank || writable(p.text))));
    const most = <T>(list: T[], key: (x: T) => string) => list.reduce((a, x) => list.filter(y => key(y) === key(x)).length > list.filter(y => key(y) === key(a)).length ? x : a);
    let card: Card, t: Target | undefined;
    if (ok.length) {
      const best = most(ok, p => p.cardId), same = ok.filter(p => p.cardId === best.cardId), targets = same.flatMap(p => p.target ? [p.target] : []);
      card = hand.find(c => c.id === best.cardId)!;
      if (card.blank) card = { ...card, text: cleanWriteIn(best.text) };
      if (targets.length) t = { ...most(targets, x => `${x.side}${x.slot}`) };
    } else { const pool = hand.filter(c => !c.blank && !used.has(c.id)); card = pool[random(s, pool.length)]; }
    if (kind === 'modifier' && !t) { const r = random(s, 6); t = { side: SIDES[Math.floor(r / 3)], slot: r % 3 as Target['slot'] }; }
    used.add(card.id);
    return { placed: { card, from: side, auto: true } as Placed, target: t };
  });
}
function endPick(s: State, now: number) {
  const kind = s.phase as CardKind, picks = { north: resolve(s, 'north', kind), south: resolve(s, 'south', kind) };
  const auto = SIDES.some(side => picks[side].some(p => p.placed.auto));
  for (const side of SIDES) { s.progress[side].locked = s.progress[side].total; s.hands[side][kind] = []; s.slots[side] = []; }
  s.queue = kind === 'modifier'
    ? Array.from({ length: MAX_MODIFIER_SLOTS }, (_, i) => SIDES.flatMap(side => picks[side][i] ? [{ target: picks[side][i].target!, placed: picks[side][i].placed, mod: true }] : [])).flat()
    : SIDES.map(side => ({ target: { side, slot: kind === 'innocent' ? 1 : 2 }, placed: picks[kind === 'innocent' ? side : opposite(side)][0].placed, mod: false }));
  if (auto) { sfx(s, 'timeup'); line(s, 'timeup'); }
  begin(s, `${kind}Reveal`, now, TIMING.introMs, 1 + s.queue.length);
  line(s, `reveal.${kind}`);
  if (kind === 'guilty') sfx(s, 'drumroll');
}
/** A floor or the lever window: shortened to awayMs while the Conductor is disconnected. */
const span = (s: State, seconds: number) => online(s, s.conductor) ? seconds * 1000 : Math.min(seconds * 1000, TIMING.awayMs);
function startFloor(s: State, index: number, now: number) {
  begin(s, 'plead', now, span(s, s.settings.floorSeconds), 2);
  s.step = index; s.floor = index ? opposite(s.defaultSide) : s.defaultSide;
  line(s, `floor.${s.floor}`); sfx(s, 'gavel');
}
function crash(s: State, now: number, timedOut: boolean) {
  if (timedOut) { s.lever.timedOut = true; line(s, 'dither'); }
  const struck = s.struck = s.lever.pulled ? opposite(s.defaultSide) : s.defaultSide;
  for (const p of s.players) { if (p.id === s.conductor) p.conducted++; else if (s.teams[struck].includes(p.id)) p.deaths++; else p.spared++; }
  s.history.push({ round: s.round, conductor: s.conductor, defaultSide: s.defaultSide, pulled: s.lever.pulled, timedOut, struck, victims: [...s.teams[struck]] });
  begin(s, 'crash', now, s.round === s.rounds ? TIMING.lastCrashMs : TIMING.crashMs);
  if (s.lever.pulled) sfx(s, 'lever');
  sfx(s, 'bell', 'rumble', 'crash', s.lever.pulled ? 'gasp' : 'aww'); line(s, 'struck');
}
function advance(s: State, now: number) {
  switch (s.phase) {
    case 'deal': case 'innocentReveal': case 'guiltyReveal': case 'modifierReveal':
      if (s.step + 1 < s.steps) return reveal(s, now);
      return s.phase === 'modifierReveal' ? startFloor(s, 0, now) : startPick(s, s.phase === 'deal' ? 'innocent' : s.phase === 'innocentReveal' ? 'guilty' : 'modifier', now);
    case 'innocent': case 'guilty': case 'modifier': return endPick(s, now);
    case 'plead':
      if (!s.step) return startFloor(s, 1, now);
      begin(s, 'lever', now, span(s, s.settings.leverSeconds)); s.ticks = 0; return line(s, 'lever');
    case 'lever': return crash(s, now, true);
    case 'crash': {
      if (s.round < s.rounds) return startRound(s, now);
      const fewest = Math.min(...s.players.map(p => p.deaths));
      begin(s, 'complete', now, 0); s.winners = s.players.filter(p => p.deaths === fewest).map(p => p.id);
      return line(s, s.winners.length > 1 ? 'tie' : 'end');
    }
  }
}

function pick(s: State, id: PlayerId, a: Extract<Action, { kind: 'propose' | 'lock' }>, now: number) {
  const kind = isPick(s.phase) ? s.phase : fail('Nothing to pick right now.');
  if (id === s.conductor) fail('The Conductor doesn’t play cards.');
  const side = sideOf(s, id) ?? fail('You are not on a team this round.'), slots = s.slots[side], slot = slots[a.slot] ?? fail('That slot doesn’t exist.');
  if (slot.locked) fail(`${s.players.find(p => p.id === slot.locked!.by)!.name} already locked this.`);
  if (a.cardId === null) { s.now = now; slot.proposals = slot.proposals.filter(p => p.by !== id); return; }
  const card = s.hands[side][kind].find(c => c.id === a.cardId) ?? fail('That card isn’t in your hand.');
  if (a.text !== undefined && !card.blank) fail('Only a blank card takes writing.');
  if (a.target && kind !== 'modifier') fail('Only twists take a target.');
  if (slots.some(x => x.locked?.cardId === card.id)) fail('That card is already played.');
  const t = a.target && { target: { ...a.target } };
  if (a.kind === 'propose') { s.now = now; slot.proposals = [...slot.proposals.filter(p => p.by !== id), { by: id, cardId: card.id, ...(a.text === undefined ? {} : { text: a.text }), ...t }]; return; }
  const text = card.blank ? { text: cleanWriteIn(a.text) } : {};
  if (kind === 'modifier' && !t) fail('Choose which card this twist goes on.');
  s.now = now; s.lastLock = now; slot.locked = { cardId: card.id, ...text, ...t, by: id }; s.progress[side].locked++;
  sfx(s, 'lock'); settle(s);
}

export const rules: GameRules<State, Input, Action, Settings, PublicView, PrivateView> = {
  validateSettings: parseSettings,
  parseInput(raw) { if (raw !== null) fail('Trolley Court uses actions only.'); return null; }, neutralInput: () => null,
  parseAction(raw) {
    const a = record(raw), kind = a.kind as Action['kind'];
    if (typeof kind !== 'string' || !Object.hasOwn(FIELDS, kind)) fail('Unknown action.');
    if (Object.keys(a).some(k => !FIELDS[kind].includes(k))) fail('Unknown action field.');
    const turnId = str(a.turnId, 'Missing turn.');
    if (kind === 'lean') return { kind, turnId, pulled: bool(a.pulled) };
    if (kind === 'decide') return { kind, turnId, pull: bool(a.pull) };
    if (kind === 'next') return { kind, turnId, step: int(a.step, 1, 'Invalid floor.') };
    if (a.text !== undefined && (typeof a.text !== 'string' || [...a.text].length > WRITE_IN_MAX)) fail(`Keep it to ${WRITE_IN_MAX} characters.`);
    const slot = int(a.slot, MAX_MODIFIER_SLOTS - 1, 'Choose a slot.'), extra = { ...(a.text === undefined ? {} : { text: a.text as string }), ...(a.target === undefined ? {} : { target: target(a.target) }) };
    if (kind === 'propose') return { kind, turnId, slot, cardId: a.cardId === null ? null : str(a.cardId, 'Choose a card.'), ...extra };
    return { kind, turnId, slot, cardId: str(a.cardId, 'Choose a card.'), ...extra };
  },
  create(ctx, raw) {
    const settings = parseSettings(raw), n = ctx.players.length;
    if (n < 3 || n > 10 || new Set(ctx.players.map(p => p.id)).size !== n) fail('Trolley Court needs 3–10 players.');
    if (!Number.isFinite(ctx.nowMs)) fail('Invalid start time.');
    const s: State = {
      settings, rng: ctx.seed >>> 0, now: ctx.nowMs, players: ctx.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: true, deaths: 0, spared: 0, conducted: 0 })),
      seq: 0, cues: [], phase: 'deal', round: 0, rounds: roundCount(n, settings.laps), startedAt: ctx.nowMs, deadline: ctx.nowMs, step: 0, steps: 1,
      conductor: '', teams: { north: [], south: [] }, defaultSide: 'north', lever: { pulled: false, decided: false, timedOut: false }, underdogs: [],
      deck: empty(), discard: empty(), dealt: [], hands: { north: empty(), south: empty() }, slots: { north: [], south: [] }, queue: [],
      tracks: { north: { side: 'north', team: [], slots: [null, null, null] }, south: { side: 'south', team: [], slots: [null, null, null] } },
      progress: { north: { locked: 0, total: 0 }, south: { locked: 0, total: 0 } }, spotlight: null, floor: null, struck: null,
      history: [], winners: [], lastLock: ctx.nowMs, hurried: false, settled: false, ticks: 0,
    };
    for (const kind of KINDS) s.deck[kind] = shuffle(s, BANKS[kind].filter(c => !settings.family || !c.spicy).map(c => ({ ...c })));
    startRound(s, ctx.nowMs); return s;
  },
  applyAction(s, id, raw, rawNow) {
    const a = rules.parseAction(raw), now = clock(s, rawNow);
    if (!s.players.some(p => p.id === id)) fail('You are not seated in this court.');
    if (s.phase === 'complete') fail('The court is adjourned.');
    if (a.turnId !== turnId(s) && !(a.kind === 'lean' && s.phase === 'lever' && a.turnId === turnIdFor(s.round, 'plead'))) fail(STALE);
    if (now >= s.deadline) fail('Time’s up.');
    if (a.kind === 'propose' || a.kind === 'lock') return pick(s, id, a, now);
    if (id !== s.conductor) fail('Only the Conductor can work the lever.');
    if (a.kind === 'lean') {
      if (s.phase !== 'plead' && s.phase !== 'lever') fail('The lever is locked right now.');
      s.now = now;
      if (s.lever.pulled !== a.pulled) { s.lever.pulled = a.pulled; sfx(s, 'lever'); }
      return;
    }
    if (a.kind === 'next') {
      if (s.phase !== 'plead') fail('Nobody has the floor.');
      if (a.step !== s.step) fail('That floor is already over.');
      if (now < s.startedAt + TIMING.floorMinMs) fail('Let them speak a little longer.');
      s.now = now; return advance(s, now);
    }
    if (s.phase !== 'lever') fail('Hear both sides before you decide.');
    s.now = now; s.lever.pulled = a.pull; s.lever.decided = true;
    line(s, a.pull ? 'pull' : 'nothing'); crash(s, now, false);
  },
  tick(s, _inputs, _dt, rawNow) {
    if (!Number.isFinite(rawNow)) return;
    const now = s.now = clock(s, rawNow);
    for (let i = 0; i < 64 && s.phase !== 'complete' && now >= s.deadline; i++) advance(s, now);
    if (isPick(s.phase) && !s.hurried && !s.settled && s.deadline - now <= TIMING.hurryMs) { s.hurried = true; sfx(s, 'hurry'); line(s, 'hurry'); }
    if (s.phase === 'lever' && s.ticks < 5 && s.deadline - now <= (5 - s.ticks) * 1000) { s.ticks++; sfx(s, 'tick'); }
  },
  onPresenceChange(s, id, connected, rawNow) {
    const p = s.players.find(p => p.id === id); if (!p) return;
    const now = s.now = clock(s, rawNow);
    p.connected = connected;
    if (!connected && id === s.conductor && (s.phase === 'plead' || s.phase === 'lever')) s.deadline = Math.min(s.deadline, now + TIMING.awayMs);
    settle(s);
  },
  publicView(s) {
    return {
      phase: s.phase, round: s.round, rounds: s.rounds, turnId: turnId(s), startedAt: s.startedAt, deadline: s.deadline, step: s.step, steps: s.steps,
      conductor: s.conductor, defaultSide: s.defaultSide, lever: { ...s.lever }, tracks: structuredClone(s.tracks), progress: structuredClone(s.progress),
      spotlight: s.spotlight && { ...s.spotlight }, floor: s.floor, struck: s.struck, underdogs: [...s.underdogs], players: s.players.map(p => ({ ...p })),
      history: structuredClone(s.history), cues: structuredClone(s.cues), settings: { ...s.settings }, winners: [...s.winners],
    };
  },
  playerView(s, id) {
    if (!s.players.some(p => p.id === id)) fail('Unknown seat.');
    const side = sideOf(s, id);
    return {
      role: side ? 'team' : 'conductor', side, turnId: turnId(s), hands: side ? structuredClone(s.hands[side]) : empty(),
      slots: side && isPick(s.phase) ? s.slots[side].map((x, index) => ({ index, kind: x.kind, locked: x.locked && structuredClone(x.locked), proposals: structuredClone(x.proposals) })) : [],
    };
  },
  outcome(s) {
    const complete = s.phase === 'complete';
    const rows = s.players.map(p => ({ playerId: p.id, score: p.deaths, rank: 1 + s.players.filter(o => o.deaths < p.deaths).length, label: `${p.deaths} death${p.deaths === 1 ? '' : 's'} · spared ${p.spared}` }));
    return { complete, winners: complete ? [...s.winners] : [], rows: rows.sort((a, b) => a.rank - b.rank) };
  },
  dispose() {},
};
export default rules;
