import type { GameRules } from '../../../party-contract/src/index';
import { colors, defaults, packs, type Action, type Card, type Color, type Face, type PrivateView, type PublicView, type Settings } from './types';

type Player = { id: string; name: string; connected: boolean; hand: Card[]; mutatedId: string | null };
export type State = { roundId: string; rng: number; settings: Settings; players: Player[]; deck: Card[]; discard: Card[]; nextId: number; transfers: number; current: number; direction: number; side: number; color: Color; turn: number; revision: number; deadline: number; lastNow: number; drawn: string | null; complete: boolean; finishReason: string; log: string[] };
function fail(message: string): never { throw new Error(message); }
const object = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : fail('Expected an object.');
const numeric = (value: string) => /^\d$/.test(value);
const face = (s: State, c: Card) => c.faces[s.side];
const turnId = (s: State) => `${s.roundId}:${s.revision}`;
const next = (s: State, index: number, steps = 1) => (index + s.direction * steps % s.players.length + s.players.length) % s.players.length;
function random(s: { rng: number }, max: number) { s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0; return Math.floor(s.rng / 4294967296 * max); }
function shuffle<T>(s: State, values: T[]) { for (let i = values.length - 1; i > 0; i--) { const j = random(s, i + 1); [values[i], values[j]] = [values[j], values[i]]; } return values; }
function note(s: State, message: string) { s.log = [message, ...s.log].slice(0, 4); }
function makeCard(s: State, front: Face): Card {
  const back = { color: front.color === 'wild' ? 'wild' as const : colors[(colors.indexOf(front.color) + 2) % 4], value: numeric(front.value) ? String((Number(front.value) + 3) % 10) : front.value };
  return { id: `c${s.nextId++}`, faces: [{ ...front }, back], revealed: false, decoy: null, progress: null };
}
function randomFace(s: State): Face { return { color: colors[random(s, 4)], value: String(random(s, 10)) }; }
function draw(s: State, p: Player, count: number) {
  for (let i = 0; i < count && p.hand.length < 30; i++) {
    if (!s.deck.length && s.discard.length > 1) {
      s.deck = shuffle(s, s.discard.splice(0, s.discard.length - 1));
      for (const c of s.deck) { c.revealed = false; c.decoy = null; }
    }
    p.hand.push(s.deck.pop() ?? makeCard(s, randomFace(s)));
  }
}
function unlocked(c: Card) { return c.progress === null || c.progress.length >= 3; }
function matches(s: State, c: Card) { const f = face(s, c); return unlocked(c) && !c.decoy && (f.color === 'wild' || f.color === s.color || f.value === face(s, s.discard.at(-1)!).value); }
function canJump(s: State, c: Card) { const f = face(s, c), top = face(s, s.discard.at(-1)!); return s.settings.jump && !c.decoy && numeric(f.value) && f.color === top.color && f.value === top.value; }
function begin(s: State) {
  s.players.forEach(p => { p.mutatedId = null; });
  if (!s.settings.mutation) return;
  const cards = s.players[s.current].hand.filter(c => numeric(face(s, c).value));
  if (cards.length) { const c = cards[random(s, cards.length)], old = face(s, c); c.faces[s.side] = { color: colors[(colors.indexOf(old.color as Color) + 1 + random(s, 3)) % 4], value: String((Number(old.value) + 1 + random(s, 9)) % 10) }; s.players[s.current].mutatedId = c.id; note(s, `${s.players[s.current].name}'s hand mutated.`); }
}
function finish(s: State, reason: string) { s.complete = true; s.finishReason = reason; s.revision++; }
function advance(s: State, now: number, steps = 1) {
  s.turn++;
  if (s.players.some(p => p.hand.length === 0)) return finish(s, 'An empty hand wins.');
  if (s.turn >= s.settings.maxTurns) return finish(s, 'Turn limit reached. Fewest cards wins; ties share the win.');
  if (s.settings.drift && s.turn % 2 === 0) {
    for (const p of s.players) for (const c of p.hand) { const f = face(s, c); if (numeric(f.value) && f.color !== 'wild') f.color = colors[(colors.indexOf(f.color) + 1) % 4]; }
    note(s, 'Color drift! Number cards shifted one color.');
  }
  s.current = next(s, s.current, steps); s.drawn = null; s.revision++; s.deadline = now + s.settings.turnSeconds * 1000; begin(s);
}
function checkTime(s: State, now: number) { if (!Number.isFinite(now)) fail('Invalid server time.'); return Math.max(now, s.lastNow); }
export const rules: GameRules<State, null, Action, Settings, PublicView, PrivateView> = {
  validateSettings(raw) {
    const value = object(raw), result = { ...defaults, ...value };
    if (Object.keys(value).some(k => !Object.hasOwn(defaults, k))) fail('Unknown Ichi setting.');
    for (const key of Object.keys(packs)) if (typeof result[key as keyof Settings] !== 'boolean') fail('Expansion toggles must be on or off.');
    for (const [key, options] of [['handSize', [5, 7, 9]], ['turnSeconds', [15, 30, 45]], ['maxTurns', [80, 160, 240]]] as const) if (!options.some(n => n === result[key])) fail(`Invalid ${key}.`);
    return result as Settings;
  },
  parseInput(raw) { if (raw !== null) fail('Ichi uses card actions.'); return null; }, neutralInput: () => null,
  parseAction(raw) {
    const a = object(raw);
    if (typeof a.turnId !== 'string' || !a.turnId.length || a.turnId.length > 200) fail('Missing turn.');
    const allowed = a.kind === 'play' ? ['turnId', 'kind', 'cardId', 'color', 'target'] : a.kind === 'inspect' ? ['turnId', 'kind', 'cardId'] : ['turnId', 'kind'];
    if (Object.keys(a).some(k => !allowed.includes(k))) fail('Unknown action field.');
    if (a.kind === 'draw' || a.kind === 'pass') return { kind: a.kind, turnId: a.turnId };
    if ((a.kind !== 'play' && a.kind !== 'inspect') || typeof a.cardId !== 'string' || !a.cardId.length || a.cardId.length > 40) fail('Choose a card.');
    if (a.color !== undefined && !colors.includes(a.color as Color)) fail('Choose a valid color.');
    if (a.target !== undefined && (typeof a.target !== 'string' || a.target.length > 100)) fail('Choose a rival.');
    return { kind: a.kind, turnId: a.turnId, cardId: a.cardId, ...(a.color === undefined ? {} : { color: a.color as Color }), ...(a.target === undefined ? {} : { target: a.target as string }) } as Action;
  },
  create(ctx, rawSettings) {
    if (ctx.players.length < 2 || ctx.players.length > 10 || new Set(ctx.players.map(p => p.id)).size !== ctx.players.length) fail('Ichi needs 2–10 players.');
    if (!Number.isFinite(ctx.nowMs) || !Number.isInteger(ctx.seed)) fail('Invalid initial time or seed.');
    const settings = rules.validateSettings(rawSettings);
    const s: State = { roundId: ctx.roundId, rng: ctx.seed >>> 0, settings, players: ctx.players.map(p => ({ id: p.id, name: p.name, connected: true, hand: [], mutatedId: null })), deck: [], discard: [], nextId: 0, transfers: 0, current: 0, direction: 1, side: 0, color: 'coral', turn: 0, revision: 0, deadline: ctx.nowMs + settings.turnSeconds * 1000, lastNow: ctx.nowMs, drawn: null, complete: false, finishReason: '', log: ['Match the color or symbol. Empty your hand to win.'] };
    for (const color of colors) for (let copy = 0; copy < 2; copy++) for (const value of ['0','1','2','3','4','5','6','7','8','9','skip','reverse','+2', ...(settings.reveal ? ['eye'] : []), ...(settings.trade ? ['trade'] : []), ...(settings.flip ? ['flip'] : []), ...(settings.decoy ? ['mask'] : [])]) s.deck.push(makeCard(s, { color, value }));
    for (let i = 0; i < 8; i++) s.deck.push(makeCard(s, { color: 'wild', value: 'wild' }));
    shuffle(s, s.deck);
    for (const p of s.players) {
      draw(s, p, settings.handSize - Number(settings.missions));
      if (settings.missions) { const c = makeCard(s, { color: 'wild', value: 'mission' }); c.progress = []; p.hand.push(c); }
    }
    const first = s.deck.findIndex(c => numeric(c.faces[0].value)); s.discard.push(s.deck.splice(first, 1)[0]); s.color = face(s, s.discard[0]).color as Color; begin(s); return s;
  },
  applyAction(s, id, raw, now) {
    const a = rules.parseAction(raw), p = s.players.find(p => p.id === id); now = checkTime(s, now);
    if (!p || !p.connected || s.complete || a.turnId !== turnId(s) || now >= s.deadline) fail('This turn has closed.');
    if (a.kind === 'inspect') {
      const c = p.hand.find(c => c.id === a.cardId); if (!c?.decoy) fail('That card is already known.');
      c.decoy = null; s.lastNow = now; return;
    }
    if (a.kind === 'draw' || a.kind === 'pass') {
      if (s.players[s.current] !== p) fail('Wait for your turn.');
      if (a.kind === 'pass') { if (!s.drawn) fail('Draw before passing.'); note(s, `${p.name} passed.`); advance(s, now); }
      else {
        if (s.drawn) fail('You already drew this turn.');
        if (p.hand.length >= 30) { note(s, `${p.name} passed at the 30-card hand limit.`); advance(s, now); }
        else { draw(s, p, 1); s.drawn = p.hand.at(-1)!.id; s.revision++; note(s, `${p.name} drew a card.`); }
      }
      s.lastNow = now; return;
    }
    const c = p.hand.find(c => c.id === a.cardId); if (!c) fail('That card is no longer in your hand.');
    const jumping = s.players[s.current] !== p;
    if (jumping ? !canJump(s, c) : !matches(s, c) || !!s.drawn && c.id !== s.drawn) fail(jumping ? 'Jump in with an identical number card.' : 'Match the color or symbol. After drawing, only the new card can be played.');
    const f = { ...face(s, c) };
    if (f.color === 'wild' && !a.color) fail('Choose the next color.');
    const target = s.players.find(other => other.id === a.target && other !== p);
    if (f.value === 'eye' && !target) fail('Choose a rival to reveal.');
    // All validation precedes mutation, including target/color choices.
    s.current = s.players.indexOf(p); p.hand.splice(p.hand.indexOf(c), 1); c.revealed = false; if (c.progress) c.progress = []; s.discard.push(c); s.color = f.color === 'wild' ? a.color! : f.color;
    for (const held of p.hand) if (held.progress && held.progress.length < 3 && f.color !== 'wild' && !held.progress.includes(f.color)) held.progress.push(f.color);
    note(s, `${p.name} ${jumping ? 'jumped in with' : 'played'} ${f.color} ${f.value}.`);
    let steps = 1;
    if (f.value === 'reverse') { s.direction *= -1; if (s.players.length === 2) steps = 2; }
    if (f.value === 'skip') steps = 2;
    if (f.value === '+2') { draw(s, s.players[next(s, s.current)], 2); steps = 2; }
    if (f.value === 'eye' && target) { const hidden = target.hand.filter(c => !c.revealed); if (hidden.length) { const exposed = hidden[random(s, hidden.length)]; exposed.revealed = true; exposed.decoy = null; note(s, `${p.name} exposed a card in ${target.name}'s hand.`); } }
    if (f.value === 'mask') {
      const victim = s.players[next(s, s.current)];
      if (victim.hand.length < 30) { const decoy = makeCard(s, randomFace(s)); const real = face(s, decoy); decoy.decoy = { color: colors[(colors.indexOf(real.color as Color) + 1) % 4], value: String((Number(real.value) + 1) % 10) }; victim.hand.push(decoy); }
      steps = 2;
    }
    if (f.value === 'flip') { s.side = 1 - s.side; s.color = face(s, c).color as Color; note(s, `Flip! Side ${s.side ? 'B' : 'A'} is active.`); }
    if (f.value === 'trade') { s.transfers++; const hands = s.players.map(other => other.hand); s.players.forEach((other, i) => { other.hand = hands[next(s, i, -1)]; }); note(s, 'Every hand moved one seat. An empty hand travels too!'); }
    if (p.hand.length === 1 || f.value === 'trade' && s.players.some(other => other.hand.length === 1)) note(s, `Ichi! ${f.value === 'trade' ? s.players.filter(other => other.hand.length === 1).map(other => other.name).join(', ') : p.name} has one card.`);
    s.lastNow = now; advance(s, now, steps);
  },
  tick(s, _inputs, _dt, now) {
    if (!Number.isFinite(now)) return; now = Math.max(now, s.lastNow); s.lastNow = now;
    if (!s.complete && now >= s.deadline) { const p = s.players[s.current]; if (!s.drawn) draw(s, p, 1); note(s, `${p.name} timed out: draw and pass.`); advance(s, now); }
  },
  onPresenceChange(s, id, connected, now) { if (!Number.isFinite(now)) return; now = Math.max(now, s.lastNow); const p = s.players.find(p => p.id === id); if (p) p.connected = connected; s.lastNow = now; },
  publicView(s) {
    return { turnId: turnId(s), turn: s.turn, deadline: s.deadline, current: s.players[s.current].id, direction: s.direction, side: s.side, color: s.color, top: { ...face(s, s.discard.at(-1)!) }, topId: s.discard.at(-1)!.id, transfers: s.transfers, settings: { ...s.settings }, drawn: !!s.drawn, complete: s.complete, finishReason: s.finishReason, log: [...s.log], players: s.players.map(p => ({ id: p.id, name: p.name, connected: p.connected, count: p.hand.length, revealed: p.hand.filter(c => c.revealed).map(c => ({ ...face(s, c) })) })) };
  },
  playerView(s, id) {
    const p = s.players.find(p => p.id === id); if (!p) fail('Unknown seat.');
    return { drawnId: s.players[s.current] === p ? s.drawn : null, mutatedId: p.mutatedId, hand: p.hand.map(c => ({ ...(c.decoy ?? face(s, c)), id: c.id, back: { ...(c.decoy ?? c.faces[1 - s.side]) }, revealed: c.revealed, disguised: !!c.decoy, progress: c.progress ? [...c.progress] : null, playable: !s.complete && s.players[s.current] === p && matches(s, c) && (!s.drawn || s.drawn === c.id), jumpable: !s.complete && s.players[s.current] !== p && canJump(s, c) })) };
  },
  outcome(s) {
    const rows = s.players.map(p => ({ playerId: p.id, score: p.hand.length, rank: 1 + s.players.filter(other => other.hand.length < p.hand.length).length, label: `${p.hand.length} cards left` })).sort((a, b) => a.rank - b.rank);
    return { complete: s.complete, winners: s.complete ? rows.filter(r => r.rank === 1).map(r => r.playerId) : [], rows };
  }, dispose() {},
};
export default rules;
