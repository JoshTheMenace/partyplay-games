/**
 * Shared materials by slot name (EXPERIENCE §1.8). `seat` and `seat_dark` are white so instanced
 * batches tint them per piece; everything else is one material for the whole round.
 */
import {
  BackSide, Color, MeshBasicMaterial, MeshStandardMaterial, type Material,
  type MeshStandardMaterialParameters,
} from 'three';
import type { ResourceScope } from '../../../../../party-runtime/src/index';
import { SEATS } from '../shared/seats';
import { CREAM, INK, SUN } from './constants';

const FIXED: Record<string, string> = {
  ink: INK, cream: CREAM, stone: '#c9c2b3', wood: '#8a5a36', metal: '#8d93a6', sail: CREAM,
  seat: '#ffffff', seat_dark: '#ffffff', cargo: '#ffffff',
};
/** Slots whose colour comes from the seat. */
export const SEAT_ROLES = new Set(['seat', 'seat_dark']);

export function materials(scope: ResourceScope) {
  const cache = new Map<string, Material>();
  const standard = (p: MeshStandardMaterialParameters) =>
    scope.own(new MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true, ...p }));
  const once = <T extends Material>(key: string, make: () => T): T => {
    const hit = cache.get(key) as T | undefined;
    if (hit) return hit;
    const made = make();
    cache.set(key, made);
    return made;
  };

  /** Material for a GLB (or procedural) slot; unknown slots keep their authored colour. */
  function role(name: string, source?: Material): Material {
    return once(`role:${name}`, () => {
      if (name === 'outline' || name === 'outline_cream') {
        return scope.own(new MeshBasicMaterial({ color: name === 'outline' ? INK : CREAM, side: BackSide }));
      }
      if (name === 'shadow') {
        return scope.own(new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
      }
      if (name === 'glow') return standard({ color: SUN, emissive: SUN, emissiveIntensity: 0.9 });
      if (FIXED[name] || name.startsWith('#')) return standard({ color: FIXED[name] ?? name });
      const color = (source as MeshStandardMaterial | undefined)?.color ?? new Color('#999999');
      return standard({ color: color.clone() });
    });
  }

  /** Real seat colours for single pieces (ghosts). */
  const seat = (index: number, dark: boolean, opacity = 1) => once(`seat:${index}:${dark}:${opacity}`, () => {
    const style = SEATS[index % SEATS.length];
    return standard({ color: dark ? style.dark : style.body, transparent: opacity < 1, opacity });
  });

  /** A translucent copy of any slot, for ghosts. */
  const faded = (name: string, opacity: number) => once(`faded:${name}:${opacity}`, () => {
    const base = role(name).clone();
    Object.assign(base, { transparent: true, opacity, depthWrite: false });
    return scope.own(base);
  });

  return { role, seat, faded, standard, once };
}
export type Materials = ReturnType<typeof materials>;
