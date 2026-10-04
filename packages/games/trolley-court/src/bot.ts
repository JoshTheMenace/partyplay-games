/** Test and QA bot (never imported by client code). now defaults to the wall clock; harnesses pass their fake server time. */
import { SIDES, TIMING, WRITE_IN_MAX, isPick, type Action, type PlayerId, type PrivateView, type PublicView } from './types';

const WRITE_IN = 'A suspiciously calm robot'.slice(0, WRITE_IN_MAX);
export function botAction(view: PublicView, mine: PrivateView, playerId: PlayerId, random: () => number, now = Date.now()): Action | null {
  const { turnId } = view, any = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  if (now >= view.deadline || mine.turnId !== turnId) return null;
  if (mine.role === 'team' && isPick(view.phase)) {
    const slot = mine.slots.find(x => !x.locked); if (!slot) return null;
    const used = new Set(mine.slots.flatMap(x => x.locked ? [x.locked.cardId] : [])), own = slot.proposals.find(p => p.by === playerId);
    if (own && !used.has(own.cardId)) return { kind: 'lock', turnId, slot: slot.index, cardId: own.cardId, ...(own.text === undefined ? {} : { text: own.text }), ...(own.target ? { target: own.target } : {}) };
    const card = any(mine.hands[slot.kind].filter(c => !used.has(c.id))); if (!card) return null;
    return { kind: 'propose', turnId, slot: slot.index, cardId: card.id, ...(card.blank ? { text: WRITE_IN } : {}), ...(slot.kind === 'modifier' ? { target: { side: any(SIDES), slot: any([0, 1, 2] as const) } } : {}) };
  }
  if (view.conductor !== playerId) return null;
  if (view.phase === 'plead') return random() < 0.05 ? { kind: 'lean', turnId, pulled: !view.lever.pulled } : now >= view.startedAt + TIMING.floorMinMs ? { kind: 'next', turnId, step: view.step } : null;
  return view.phase === 'lever' ? { kind: 'decide', turnId, pull: random() < 0.5 } : null;
}
