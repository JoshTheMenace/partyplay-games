import type { FighterView, GameEvent, View } from '../model';
/** The view without Ice Climbers partners: they share the leader's stock and credit, so cards, places and results rows skip them. */
export const seats = <V extends Pick<View, 'fighters'>>(view: V): V => ({ ...view, fighters: view.fighters.filter(f => !f.partner) });
/** Placement order: the engine's rank decides alone when given; otherwise more stocks, then less damage (for survivors) or more KOs. Equal keys share a place. */
export function placements(view: Pick<View, 'fighters'>, ranks?: ReadonlyMap<string, number>) {
  const key = (f: FighterView) => { const rank = ranks?.get(f.id); return rank ? [rank, 0, 0] : [Infinity, -f.stocks, f.stocks > 0 ? f.damage : -f.kos]; };
  const rows = view.fighters.map(f => ({ f, k: key(f) })).sort((a, b) => { for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i] - b.k[i]; return 0; });
  let place = 0;
  return rows.map((r, i) => { if (!i || r.k.some((v, j) => v !== rows[i - 1].k[j])) place = i + 1; return { f: r.f, place }; });
}
/** "GAME!" when one fighter (or team) is left standing; "TIME!" when the clock decided it. */
export function finishWord(view: Pick<View, 'fighters' | 'teams'>) {
  const alive = view.fighters.filter(f => f.stocks > 0);
  return new Set(alive.map(f => view.teams && f.team !== null ? `t${f.team}` : f.id)).size > 1 ? 'TIME!' : 'GAME!';
}
export type FeedItem = { id: number; frame: number; target: FighterView; source?: FighterView; star: boolean };
/** KO feed entries. Events only cover about a second, so callers accumulate them across snapshots. */
export const koItems = (view: View, events: readonly GameEvent[]): FeedItem[] => events.flatMap(e => {
  if (e.kind !== 'ko') return []; // a top KO also emits 'star-ko' on the same frame: one feed line, starred
  const target = view.fighters.find(f => f.id === e.target), source = view.fighters.find(f => f.id === e.source && f.id !== e.target);
  return target ? [{ id: e.id, frame: e.frame, target, source, star: events.some(x => x.kind === 'star-ko' && x.target === e.target && x.frame === e.frame) }] : [];
});
/** One line worth reading aloud on the results screen. */
export function highlight(fighters: readonly FighterView[], winners: readonly FighterView[]) {
  const top = (score: (f: FighterView) => number) => [...fighters].sort((a, b) => score(b) - score(a))[0];
  const flawless = winners.find(f => f.falls === 0), killer = top(f => f.kos), dealer = top(f => f.dealt ?? -1);
  if (flawless && fighters.length > 1) return `Flawless! ${flawless.name} never lost a stock.`;
  if (killer && killer.kos >= 3 && fighters.filter(f => f.kos === killer.kos).length === 1) return `KO machine: ${killer.name} scored ${killer.kos} KOs.`;
  if (dealer?.dealt) return `Heaviest hitter: ${dealer.name} dealt ${Math.round(dealer.dealt)}% damage.`;
  const tank = top(f => f.stocks > 0 ? f.damage : -1);
  if (tank && tank.stocks > 0 && tank.damage >= 120) return `Iron will: ${tank.name} survived at ${Math.round(tank.damage)}%.`;
  return killer?.kos ? `Most KOs: ${killer.name} with ${killer.kos}.` : 'Everyone survived to tell the tale.';
}
