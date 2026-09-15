/* What lives down here, by name and in a fixed order.
 *
 * Browser-safe on purpose. The behaviour tables are server-only — a client that
 * could read how much a Warden weighs could also read the relic pool — but the
 * client does need to know which sprite to draw, and once the wire sends
 * INDICES rather than strings it needs the order too.
 *
 * The order is load-bearing: it is the encoding. Appending is safe; inserting
 * or reordering silently repaints every monster on every screen as something
 * else. monsters.ts asserts at load that its own tables match this list exactly,
 * so drift fails immediately rather than in the renderer.
 */

export const KIND_IDS = [
  'pooka', 'fygar', 'mite', 'sapper', 'warden', 'geode', 'grub', 'shark', 'mole',
] as const;

export type KindId = (typeof KIND_IDS)[number];

/** Variants per kind, in order. Index 0 on the wire means "no variant". */
export const VARIANT_IDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  pooka: ['azure', 'basalt', 'wraith'],
  fygar: ['ember', 'smoulder', 'slag'],
  mite: ['hardshell', 'ashling'],
  sapper: ['creeper', 'primed', 'deepcharge'],
  warden: ['ironclad', 'quarryman', 'sentinel'],
  geode: ['thunderegg', 'druse'],
  grub: ['borer', 'nacre'],
  shark: ['sandskimmer', 'hammerhead', 'emberfin'],
  mole: ['pitcher', 'deepdelver', 'deadfall'],
});

/* A variant's body colour.
 *
 * Here rather than on the wire because it never changes: sending it would be
 * twelve bytes per monster per snapshot to say something both sides already
 * know. Read ONLY by the procedural silhouettes — a kind with sheet art gets
 * its own tinted frames and must not be recoloured on top of them.
 *
 * monsters.ts asserts at load that every variant it defines appears here with
 * the same colour, so a new variant cannot ship as an untinted clone. */
export const VARIANT_TINTS: Readonly<Record<string, string>> = Object.freeze({
  azure: '#5aa9ff', basalt: '#8a7f72', wraith: '#b98cff',
  ember: '#ff5a3c', smoulder: '#ffb347', slag: '#6f5a4a',
  hardshell: '#7fe0c0', ashling: '#c8b7ff',
  creeper: '#ff7b9c', primed: '#ffd24a', deepcharge: '#ff4d2e',
  ironclad: '#9fb4c9', quarryman: '#c08a4a', sentinel: '#8f7bff',
  thunderegg: '#ffd76a', druse: '#7fd4ff',
  borer: '#ff9f4a', nacre: '#e8dcff',
  sandskimmer: '#7fd8e0', hammerhead: '#8d9bb0', emberfin: '#e07a4a',
  pitcher: '#d9a066', deepdelver: '#a1745a', deadfall: '#8a6a4a',
});

/** The modes a monster can be in, in wire order. */
export const MODE_IDS = [
  'patrol', 'chase', 'ghostwind', 'ghost', 'remat', 'pumped', 'dying',
] as const;

/** Rock states, in wire order. */
export const ROCK_STATE_IDS = ['idle', 'wobble', 'falling', 'breaking'] as const;

const kindIx = new Map(KIND_IDS.map((id, i) => [id as string, i]));
export const kindIndex = (id: string) => kindIx.get(id) ?? 0;
export const kindName = (i: number) => KIND_IDS[i] ?? KIND_IDS[0];

export function variantIndex(kind: string, variant: string | null) {
  if (!variant) return 0;
  const i = (VARIANT_IDS[kind] ?? []).indexOf(variant);
  return i < 0 ? 0 : i + 1;
}
export function variantName(kind: string, i: number): string | null {
  return i > 0 ? (VARIANT_IDS[kind] ?? [])[i - 1] ?? null : null;
}
