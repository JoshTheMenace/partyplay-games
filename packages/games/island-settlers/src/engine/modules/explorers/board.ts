/**
 * Mission faces for the hidden band (ENGINE §8.5, official full E&P proportions): per selected
 * mission 6 / 8 / 10 specials (gold lairs, fish shoals numbered 1–6, spice farms with a benefit),
 * and the visible Council of Catan on the outer edge of the band for the Fish and Spices missions.
 * Lair and spice features ride on the hidden face, so nothing about them is public before discovery.
 */
import { RESOURCES, type Resource, type SpiceBenefit, type TileId } from '../../../model';
import type { BoardDraft, GenContext } from '../../board/types';
import { centroid } from '../../board/islands';
import { shuffled } from '../../board/util';
import { distance } from '../../../geometry';

const PER_MISSION = [6, 8, 10];
const BENEFITS: SpiceBenefit[] = ['speed', 'pirate', 'gold'];

export function decorate(draft: BoardDraft, ctx: GenContext) {
  const { hidden } = draft, missions = ctx.settings.missions, n = PER_MISSION[ctx.tier];
  const ids = shuffled(Object.keys(hidden).sort(), ctx.random);
  const kind = (t: TileId) => hidden[t].terrain;
  const resource = (t: TileId) => RESOURCES.includes(kind(t) as Resource);
  const golds = ids.filter(t => kind(t) === 'gold'), wanted = missions.includes('lairs') ? n : 0;
  // Gold fields exist only as pirate lairs: top them up from resource hexes, or turn extras into resources.
  golds.slice(wanted).forEach((t, i) => { hidden[t].terrain = RESOURCES[i % RESOURCES.length]; });
  const extra = ids.filter(resource).slice(0, Math.max(0, wanted - golds.length));
  for (const t of extra) hidden[t].terrain = 'gold';
  for (const t of ids.filter(t => kind(t) === 'gold')) {
    hidden[t].feature = { kind: 'lair', id: `lair-${t}`, tile: t };
  }
  if (missions.includes('spices')) ids.filter(resource).slice(0, n).forEach((t, i) => {
    hidden[t] = { terrain: 'spice', number: 0, feature: { kind: 'spice', id: `spice-${t}`, tile: t,
      benefit: BENEFITS[i % BENEFITS.length] } };
  });
  if (missions.includes('fish') || missions.includes('spices')) placeCouncil(draft);
  if (missions.includes('fish')) ids.filter(t => hidden[t]?.terrain === 'sea').slice(0, n).forEach((t, i) => {
    hidden[t] = { terrain: 'shoal', number: (i % 6) + 1 };
  });
}

/** A hidden sea hex touching the open frame, as far from the home island as possible, made visible. */
function placeCouncil(draft: BoardDraft) {
  const { hidden, index } = draft, home = centroid(draft.tiles.filter(t => t.island === 0));
  const frame = (t: TileId) => index.tileNeighbors.get(t)!.some(o => !hidden[o.id] && o.island < 0);
  const far = (t: TileId) => distance(index.tile.get(t)!, home);
  const pick = (sea: boolean) => Object.keys(hidden)
    .filter(t => frame(t) && (!sea || hidden[t].terrain === 'sea')).sort((a, b) => far(b) - far(a))[0];
  const tile = pick(true) ?? pick(false);
  if (!tile) return;
  delete hidden[tile];
  Object.assign(index.tile.get(tile)!, { terrain: 'council', number: 0 });
  draft.features.push({ kind: 'council', id: 'council', tile });
}
