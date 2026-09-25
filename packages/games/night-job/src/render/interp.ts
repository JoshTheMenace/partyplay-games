/* Interpolated actor poses between two snapshots, written into reused objects (no per-frame allocation).
 * Actors missing from the newest snapshot are not drawn; jumps over 2.5 tiles (vents, respawns) snap. */
import type { Point, View } from '../model';

export type Pose = { x: number; y: number; facing: number };
const JUMP = 2.5;

export function createPoses() {
  const poses = new Map<string, Pose>();
  let blended = false, now = 0;
  const write = <T extends Point & { id: string; facing: number }>(from: readonly T[], to: readonly T[], k: number) => {
    for (const b of to) {
      let a: T | undefined;
      for (const c of from) if (c.id === b.id) { a = c; break; }
      let p = poses.get(b.id); if (!p) { p = { x: b.x, y: b.y, facing: b.facing }; poses.set(b.id, p); }
      if (!a || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > JUMP) { p.x = b.x; p.y = b.y; p.facing = b.facing; continue; }
      const turn = Math.atan2(Math.sin(b.facing - a.facing), Math.cos(b.facing - a.facing));
      p.x = a.x + (b.x - a.x) * k; p.y = a.y + (b.y - a.y) * k; p.facing = a.facing + turn * k;
    }
  };
  const blend = (a: View, b: View, k: number) => { blended = true; write(a.players, b.players, k); write(a.npcs, b.npcs, k); now = a.now + (b.now - a.now) * k; return b; };
  return {
    poses,
    get now() { return now; },
    /** Wraps SnapshotBuffer.sample: afterwards `poses` and `now` describe the presented moment. */
    sample(sampler: (blend: (a: View, b: View, k: number) => View) => View | undefined, fallback: View): View {
      blended = false;
      const view = sampler(blend) ?? fallback;
      if (!blended) blend(view, view, 1);
      return view;
    },
    clear() { poses.clear(); },
  };
}
