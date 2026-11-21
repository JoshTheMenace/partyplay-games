/**
 * What the server sends, turned back into what the client draws. Entities arrive as number tuples for the things near
 * one screen (a playing seat's private `near`, the watching display's public `tv`); the bag and the roster arrive only
 * now and then, so the latest of each is kept here. Decoded scenes are cached per wire object, so the game loop and
 * the HUD share one decode per snapshot.
 */
import { decodeRoster, decodeScene, type Bag, type PrivateView, type PubPlayer, type Scene, type View, type Who, type WireScene } from '../../shared/protocol';
import { createStore } from '../store';

const scenes = new WeakMap<WireScene, Scene>();
function sceneOf(wire: WireScene, who: readonly Who[]): Scene {
  let scene = scenes.get(wire);
  if (!scene) scenes.set(wire, scene = decodeScene(wire, who));
  return scene;
}
let latest: Scene | null = null;
/** The scene around a playing seat in the snapshots that carry one (it is also kept as `latestScene`). */
export function nearScene(view: View, pv: PrivateView): Scene | null {
  return pv.near ? latest = sceneOf(pv.near, view.who) : null;
}
/** The newest scene around this seat: big rooms send one in every second snapshot. */
export const latestScene = (view: View, pv: PrivateView): Scene | null => nearScene(view, pv) ?? latest;
/** The watching display's scene, in the snapshots that carry one. */
export const tvScene = (view: View): Scene | null => view.tv ? sceneOf(view.tv, view.who) : null;
/** This seat's own player in its newest scene. */
export const selfIn = (view: View, pv: PrivateView, playerId: string | null): PubPlayer | undefined => latestScene(view, pv)?.players.find(player => player.id === playerId);

/** A player as the roster knows them: identity plus where they are and how they are doing (whole blocks, a few times a second). */
export type RosterPlayer = { id: string; name: string; color: string; seat: number; x: number; y: number; z: number; health: number; held: number; flags: number; armor: number };
export type FeedState = {
  /** The newest bag received (null until the first one arrives). */
  bag: Bag | null;
  /** Everyone in the round, from the newest roster. */
  roster: readonly RosterPlayer[];
};
export const feed = createStore<FeedState>({ bag: null, roster: [] });

let lastRoster: number[][] | undefined;
/** Keep the newest roster of a public view (call for every view; most carry none). */
export function readRoster(view: View) {
  if (!view.roster || view.roster === lastRoster) return;
  lastRoster = view.roster;
  feed.set({ roster: view.roster.map(tuple => {
    const entry = decodeRoster(tuple), [id, name, color] = view.who[entry.seat] ?? ['', 'Explorer', '#ffffff'];
    return { ...entry, id: id || `seat-${entry.seat}`, name, color };
  }) });
}
/** Keep the newest bag of a private view; returns true when this view brought one. */
export function readBag(pv: PrivateView): boolean {
  if (!pv.bag || pv.bag === feed.get().bag) return false;
  feed.set({ bag: pv.bag });
  return true;
}
/** A new round or a fresh connection: forget what the last one sent. */
export function resetFeed() {
  lastRoster = undefined;
  latest = null;
  feed.set({ bag: null, roster: [] });
}
