import type { State } from './state';
/** Bonus points and disabled building points; never includes a hidden opponent hand. */
export function expansionScore(s: State, id: string): number {
  const m = s.modules; if (!m) return 0;
  const p = m.players[id], v = m.public;
  let points = p.defenderPoints + p.progressPoints + v.metropolises.filter(x => x.playerId === id).length * 2 + (v.merchant?.playerId === id ? 1 : 0) + (v.harborOwner === id ? 2 : 0);
  if (v.rivers) points += (v.rivers.wealthiest === id ? 1 : 0) - (v.rivers.poorest.includes(id) && !v.attack && !v.deliveries ? 2 : 0);
  if (v.attack) points += Math.floor(p.prisoners / (s.settings.citiesKnights ? 3 : 2));
  if (v.caravans) points += s.buildings.filter(b => b.playerId === id && v.caravans!.segments.filter(c => c.from === b.vertex || c.to === b.vertex).length >= 2).length;
  if (v.deliveries) { const wagon = v.deliveries.wagons.find(w => w.playerId === id); if (wagon) points += wagon.delivered + (wagon.level === 4 ? 1 : 0); }
  if (v.explorers) for (const mission of s.settings.missions ?? []) points += (mission === 'spices' ? [0, 1, 1, 2, 2, 3, 3] : [0, 1, 1, 2, 2, 2, 3, 3])[p.missions[mission]] + (v.explorers.missionOwners[mission] === id ? 1 : 0);
  if (v.attack) for (const b of s.buildings.filter(b => b.playerId === id)) {
    const land = s.board.vertices.find(x => x.id === b.vertex)!.tiles.map(t => s.board.tiles.find(x => x.id === t)!).filter(t => !['sea', 'shoal'].includes(t.terrain));
    if (land.length && land.every(t => (v.attack!.barbarians.find(x => x.tile === t.id)?.count ?? 0) >= 3)) {
      if (!v.metropolises.some(x => x.vertex === b.vertex)) points -= b.kind === 'settlement' ? 1 : 2;
      if (v.caravans && v.caravans.segments.filter(c => c.from === b.vertex || c.to === b.vertex).length >= 2) points--;
    }
  }
  return points;
}
