/* Staged moments for the sandbox: each scene places thieves and posted NPCs and pokes plain state fields, so a
 * screenshot from the same URL shows the same moment before and after a rendering change. Dev fixture only. */
import type { EffectKind, HeistMap, MissionId, Noise, NpcKind, NpcState, Role, Shot, Tool } from '../src/model';
import type { Crew, Npc, State } from '../src/sim/state';

const E = 0, S = Math.PI / 2, W = Math.PI, N = -Math.PI / 2;
type Post = [kind: NpcKind, x: number, y: number, facing: number, state?: NpcState, suspicion?: number];
export type Scene = { mission?: MissionId; crew: [x: number, y: number, role: Role, tool?: Tool, facing?: number][]; posts?: Post[]; setup?(s: State, map: HeistMap, kit: Kit): void };
type Kit = { crew: Crew[]; npcs: Npc[]; effect(x: number, y: number, kind: EffectKind, label: string, ageMs?: number, player?: string): void; noise(x: number, y: number, radius: number, kind: Noise['kind'], ageMs?: number): void; shot(from: [number, number], to: [number, number], kind: Shot['kind'], hit?: boolean, ageMs?: number): void; door(id: string, state: 'o' | 'c' | 'l' | 'b'): void; take(cells: [number, number][]): void };

/** Bound helpers for one heist state. */
export function kitFor(s: State, map: HeistMap): Kit {
  const doors = map.objects.filter(o => o.kind === 'door' || o.kind === 'window');
  return {
    crew: s.crew, npcs: s.npcs,
    effect(x, y, kind, label, ageMs = 250, player) { s.effects.push({ x, y, id: s.nextEffect++, kind, label, at: s.now - ageMs, crew: true, ...(player ? { player } : {}) }); },
    noise(x, y, radius, kind, ageMs = 250) { s.noises.push({ x, y, radius, kind, at: s.now - ageMs, crew: true }); },
    shot(from, to, kind, hit = false, ageMs = 90) { s.shots.push({ from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, at: s.now - ageMs, hit, kind, crew: true }); },
    door(id, state) { const i = doors.findIndex(o => o.id === id); if (i >= 0) { s.doors = s.doors.slice(0, i) + state + s.doors.slice(i + 1); s.seenDoors = s.doors; } },
    take(cells) { let coins = s.coins; map.coins.forEach((c, i) => { if (cells.some(([x, y]) => Math.floor(c.x) === x && Math.floor(c.y) === y)) coins = coins.slice(0, i) + '0' + coins.slice(i + 1); }); s.coins = coins; },
  };
}
const set = <T extends object>(target: T, values: Partial<T>) => Object.assign(target, values);
const chase = (n: Npc, p: Crew, aiming = true) => set(n, { state: 'chase', suspicion: 1, target: p.id, facing: Math.atan2(p.y - n.y, p.x - n.x), ...(aiming ? { aim: { x: p.x, y: p.y }, aimAt: 1 } : {}) });

export const SCENES: Record<string, Scene> = {
  /** Four thieves in four rooms: the whole building in frame, several lit pockets. */
  overview: { crew: [[5.5, 18.5, 'cracker', 'smoke', E], [21.5, 11.5, 'scout', 'tranq', N], [22.5, 19.5, 'magpie', 'decoy', W], [38.5, 16.5, 'ghost', 'emp', S]] },
  /** Casino floor: a calm patrol, a suspicious guard and two civilians around two sneaking thieves. */
  casino: {
    crew: [[17.5, 12.5, 'cracker', 'smoke', E], [22.5, 9.5, 'scout', 'tranq', E]],
    posts: [['guard', 28.5, 12.5, W, 'suspicious', .55], ['guard', 13.5, 8.5, E], ['civilian', 21.5, 8.5, S], ['civilian', 15.5, 12.5, E], ['guard', 4.5, 10.5, E]],
    setup(_s, _map, k) { set(k.crew[0], { moving: true }); set(k.npcs[1], { moving: true }); k.take([[16, 12], [17, 12]]); k.effect(17.2, 12.5, 'coin', '+1', 200); },
  },
  /** Lobby: a guard takes aim at a running thief, a second guard comes to look, a teammate hides in the cloakroom. */
  chase: {
    crew: [[19.5, 18.5, 'ghost', 'smoke', W], [11.5, 17.5, 'face', 'medkit', E]],
    posts: [['guard', 26.5, 20.5, W], ['guard', 14.5, 21.5, E, 'investigate', .4], ['civilian', 28.5, 17.5, W, 'panic', 1]],
    setup(s, _map, k) {
      set(k.crew[0], { moving: true, running: true, health: 66 }); set(k.crew[1], { hidden: true, hideSpot: 'hide-11-17' });
      chase(k.npcs[0], k.crew[0]); k.noise(20.4, 18.5, 3, 'step', 150); k.noise(21.6, 18.6, 3, 'step', 520); k.effect(19.5, 18.5, 'spotted', 'Spotted!', 400, 'p0');
      k.shot([26.5, 20.5], [21.5, 18.9], 'guard', true, 120); k.effect(19.5, 18.5, 'hurt', `${k.crew[0].name} hit`, 120, 'p0'); s.message = '';
    },
  },
  /** A fallen thief, a teammate halfway through the revive, a sleeping guard and a searching one. */
  down: {
    crew: [[18.5, 20.5, 'scout', 'tranq', E], [19.35, 20.5, 'face', 'medkit', W], [14.5, 20.5, 'breacher', 'shotgun', E]],
    posts: [['guard', 22.5, 21.5, W, 'stunned'], ['guard', 27.5, 17.5, S, 'search', .5]],
    setup(s, _map, k) {
      set(k.crew[0], { down: true, health: 0 }); set(k.crew[1], { work: { target: 'revive-p0', label: `Reviving ${k.crew[0].name}`, progress: .62 } }); s.progress['revive-p0'] = .62;
      set(k.npcs[0], { stunUntil: s.now + 15000 }); set(k.npcs[1], { moving: true }); set(k.crew[2], { moving: true }); s.message = `${k.crew[0].name} is down. Push into them to revive.`; s.messageAt = s.now;
    },
  },
  /** Every tool at once: smoke, a tranquilliser dart, a decoy ring, an EMP pulse and a shotgun blast. */
  tools: {
    crew: [[20.5, 10.5, 'impostor', 'smoke', E], [16.5, 12.5, 'wire', 'emp', E], [25.5, 12.5, 'breacher', 'shotgun', E], [21.5, 13.5, 'cracker', 'decoy', N]],
    posts: [['guard', 29.5, 9.5, W, 'stunned'], ['guard', 29.5, 12.5, W, 'stunned'], ['guard', 13.5, 9.5, E, 'investigate', .3], ['civilian', 24.5, 8.5, S]],
    setup(s, _map, k) {
      s.smoke.push({ x: 20.5, y: 10.5, radius: 2.5, born: s.now - 2500, until: s.now + 5500 });
      k.shot([25.5, 12.5], [29.5, 12.5], 'shotgun', true, 110); k.noise(25.5, 12.5, 14, 'loud', 260); k.effect(29.5, 12.5, 'takedown', 'Knocked down', 110);
      k.effect(16.5, 12.5, 'emp', 'EMP', 320, 'p1'); k.noise(13.2, 12.6, 8, 'decoy', 350); k.effect(13.2, 12.6, 'decoy', 'Decoy', 600);
      for (const n of [k.npcs[0], k.npcs[1]]) n.stunUntil = s.now + 12000; set(k.crew[0], { disguised: false });
    },
  },
  /** Cashier: one safe mid-crack, one open with its gold showing, the Magpie's bird fetching coins. */
  safe: {
    crew: [[12.5, 2.4, 'cracker', 'smoke', N], [16.5, 3.5, 'magpie', 'decoy', W]],
    posts: [['guard', 26.5, 3.5, W]],
    setup(s, _map, k) {
      set(k.crew[0], { work: { target: 'safe-12-1', label: 'Cracking the safe', progress: .7 }, coins: 14, charges: 3 }); s.progress['safe-12-1'] = .7;
      s.spent.push('safe-19-1'); k.effect(19.5, 1.5, 'safe', '+8', 350); k.take([[13, 2], [14, 2], [15, 2]]); k.effect(15.5, 2.5, 'coin', '+1', 120); set(k.crew[1], { coins: 9, moving: true });
    },
  },
  /** Manager's office: the ledger half lifted, the beam and the office camera live. */
  vault: {
    crew: [[39.4, 2.5, 'cracker', 'smoke', E], [36.5, 7.5, 'wire', 'emp', N]],
    posts: [['guard', 34.5, 4.5, E, 'suspicious', .3]],
    setup(s, _map, k) { set(k.crew[0], { work: { target: 'objective', label: 'Taking the ledger', progress: .5 } }); s.progress.objective = .5; s.meters['camera-43-5'] = .5; },
  },
  /** The getaway: alarm ringing, the carrier nearly home, one teammate waiting in the ring and a chaser behind. */
  escape: {
    crew: [[6.5, 24.6, 'ghost', 'smoke', W], [3.5, 25.5, 'face', 'medkit', E], [10.5, 25.4, 'magpie', 'decoy', W]],
    posts: [['guard', 15.5, 24.5, W], ['dog', 13.5, 25.5, W]],
    setup(s, _map, k) {
      s.phase = 'escape'; s.objective = { x: 6.5, y: 24.6, carrier: 'p0', taken: true }; s.alarm = { x: 20.5, y: 22.5, until: s.now + 9000 }; s.alarmAt = s.now - 3000;
      for (const p of k.crew) set(p, { moving: true, running: true }); set(k.crew[1], { moving: false, running: false, health: 40 });
      chase(k.npcs[0], k.crew[2]); chase(k.npcs[1], k.crew[2], false); set(k.npcs[1], { moving: true }); k.door('door-5-23', 'o');
      k.noise(11.3, 25.4, 3, 'step', 200); k.noise(7.3, 24.6, 3, 'step', 420); k.effect(20.5, 22.5, 'alarm', 'Lobby camera', 900); s.message = `${k.crew[0].name} has the ledger! Everyone to the getaway.`; s.messageAt = s.now;
    },
  },
  /** The crew in the getaway ring with the goods. With `&then=clear&after=2500` the sandbox finishes the heist while you watch: the crew piles into the van and it pulls away. */
  away: {
    crew: [[3.6, 24.6, 'ghost', 'smoke', W], [3.2, 25.6, 'face', 'medkit', E], [4.4, 25.3, 'magpie', 'decoy', W], [2.8, 26.2, 'cracker', 'tranq', N]],
    setup(s) { s.phase = 'escape'; s.elapsed = 247; s.collected = 118; s.objective = { x: 3.6, y: 24.6, carrier: 'p0', taken: true }; s.message = ''; },
  },
  /** The whole crew down in the lobby with the guards standing over them; add `&then=failed` for the bust itself. */
  busted: {
    crew: [[18.5, 20.5, 'scout', 'tranq', E], [20.4, 19.6, 'face', 'medkit', W], [19.5, 21.6, 'breacher', 'shotgun', E]],
    posts: [['guard', 22.5, 20.5, W], ['guard', 17.5, 18.5, S], ['dog', 20.5, 22.5, N]],
    setup(s, _map, k) { for (const p of k.crew) set(p, { down: true, health: 0 }); for (const n of k.npcs) chase(n, k.crew[0], false); s.elapsed = 138; s.message = ''; },
  },
  /** Glasshouse: the palm court seen through glass from both sides. */
  court: { mission: 'glasshouse', crew: [[19.5, 10.5, 'scout', 'tranq', S], [31.5, 13.5, 'impostor', 'smoke', W]], posts: [['guard', 12.5, 13.5, E], ['guard', 24.5, 16.5, N, 'suspicious', .4], ['civilian', 33.5, 15.5, N], ['dog', 40.5, 12.5, W]] },
  /** Last Ferry: the quay, the water and the pier. */
  quay: { mission: 'ferry', crew: [[33.5, 25.5, 'breacher', 'shotgun', E], [38.5, 26.5, 'magpie', 'decoy', S]], posts: [['guard', 26.5, 24.5, E], ['civilian', 36.5, 25.5, W], ['guard', 40.5, 23.5, S, 'suspicious', .6]] },
};

/** Applies a scene to a freshly created heist whose NPCs came from `postsLevel(scene)`. */
export function stage(scene: Scene, s: State, map: HeistMap) {
  scene.crew.forEach(([x, y, , , facing = E], i) => { if (s.crew[i]) set(s.crew[i], { x, y, facing }); });
  (scene.posts ?? []).forEach(([, x, y, facing, state = 'patrol', suspicion = 0], i) => { if (s.npcs[i]) set(s.npcs[i], { x, y, facing, look: facing, state, suspicion, pauseUntil: s.now + 9e6 }); });
  scene.setup?.(s, map, kitFor(s, map));
}
/** A server level holding the scene's posted NPCs (each stands at one stop for a very long pause). */
export const postsLevel = (scene: Scene) => scene.posts ? { npcs: scene.posts.map(([kind, x, y, facing]) => ({ kind, route: [[Math.floor(x), Math.floor(y), 9999, facing] as [number, number, number, number]] })) } : undefined;
