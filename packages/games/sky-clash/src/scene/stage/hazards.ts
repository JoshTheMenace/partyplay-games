/**
 * Hazard telegraphs and active visuals, driven only by HazardFrame (the same frame that damages fighters).
 * lane: a sweeping object (Bullet Bill, cars, racers, eggs, lasers); while warning, a striped band crosses the screen at its height.
 * drop: a falling object (bombs, tools); while warning, a column marks where it lands.
 * area: a region (acid, jaws, turtle, Kraid); while warning, the region pulses; while active, it glows.
 */
import { Group, type Object3D } from 'three';
import type { HazardFrame, StageDef, Zone } from '../../stages';
import type { Kit, StageUpdate } from './kit';

export type HazardStyle = { style: 'lane' | 'drop' | 'area'; color?: string; object?(kit: Kit): Object3D; /** Keep the object's area fill while active (default only for area). */ fill?: boolean };
const MAX = 4;

export function hazardLayer(k: Kit, stage: StageDef, o: HazardStyle) {
  const color = o.color ?? stage.palette.accent, lanes = Array.from({ length: MAX }, () => { const c = k.column(color, true); c.mesh.name = 'hazard-telegraph'; return c; });
  const objects = o.object ? Array.from({ length: MAX }, () => { const g = new Group(); g.add(o.object!(k)); g.visible = false; return k.add(g); }) : [];
  const last: (number | null)[] = Array(MAX).fill(null), dir: number[] = Array(MAX).fill(1);
  const view = stage.camera;
  const band = (z: Zone): Zone => o.style === 'lane' ? { left: view.left, right: view.right, bottom: z.bottom, top: z.top }
    : o.style === 'drop' ? { left: z.left, right: z.right, bottom: view.bottom, top: z.top } : z;
  return (u: StageUpdate, h: HazardFrame | null) => {
    const pulse = u.reduced ? .65 : .45 + .45 * Math.abs(Math.sin(u.seconds * 7));
    for (let i = 0; i < MAX; i++) {
      const z = h?.zones[i], lane = lanes[i], obj = objects[i];
      if (!h || !z) { lane.mesh.visible = false; if (obj) obj.visible = false; last[i] = null; continue; }
      const cx = (z.left + z.right) / 2, cy = (z.bottom + z.top) / 2;
      if (h.warning) lane.place(band(z), -.5, pulse * .9, view);
      else lane.place(z, -.45, o.style === 'area' || o.fill ? .55 + .2 * Math.sin(u.seconds * 9) : 0, view);
      if (!obj) continue;
      obj.visible = h.active;
      if (last[i] !== null && Math.abs(cx - last[i]!) > 1e-3) dir[i] = Math.sign(cx - last[i]!);
      last[i] = h.active ? cx : null;
      obj.position.set(cx, o.style === 'area' ? z.top : cy, .2); obj.scale.x = dir[i];
    }
  };
}
