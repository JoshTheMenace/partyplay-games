import { RESOURCES, type Board, type Tile, type Settings } from './model';

const directions = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function makeBoard(count: number, expansion: Settings['expansion'], random: () => number): Board {
  const radius = count <= 4 ? 2 : 3, tiles: Tile[] = [];
  function tile(q: number, r: number, terrain: Tile['terrain'], island: number) {
    const existing = tiles.find(t => t.q === q && t.r === r);
    if (existing) return existing;
    const next = { id: `${q}:${r}`, q, r, x: Math.sqrt(3) * (q + r / 2), y: r * 1.5, terrain, number: 0, island };
    tiles.push(next); return next;
  }
  const land: [number, number][] = [];
  for (let r = -radius; r <= radius; r++) {
    const width = count >= 5 && count <= 6 ? [3, 4, 5, 6, 5, 4, 3][r + 3] : 2 * radius + 1 - Math.abs(r);
    const start = count >= 5 && count <= 6 ? -Math.floor(width / 2) - Math.floor(r / 2) : Math.max(-radius, -r - radius);
    for (let q = start; q < start + width; q++) land.push([q, r]);
  }
  const terrain: Tile['terrain'][] = land.length === 19
    ? [...Array(4).fill('wood'), ...Array(4).fill('grain'), ...Array(4).fill('wool'), ...Array(3).fill('brick'), ...Array(3).fill('ore'), 'desert']
    : land.length === 30 ? [...Array(6).fill('wood'), ...Array(6).fill('grain'), ...Array(6).fill('wool'), ...Array(5).fill('brick'), ...Array(5).fill('ore'), 'desert', 'desert']
    : land.map((_, i) => i < 2 ? 'desert' : RESOURCES[(i - 2) % 5]);
  shuffled(terrain, random).forEach((type, i) => tile(...land[i], type, 0));
  if (expansion === 'seafarers') directions.forEach(([q, r], i) => {
    tile(q * (radius + 2), r * (radius + 2), i % 3 === 0 ? 'gold' : RESOURCES[i % 5], i + 1);
    tile(q * (radius + 3), r * (radius + 3), RESOURCES[(i + 2) % 5], i + 1);
  });
  if (expansion === 'explorers') {
    const ring = (distance: number) => { const cells: [number, number][] = []; for (let r = -distance; r <= distance; r++) for (let q = -distance; q <= distance; q++) if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === distance) cells.push([q, r]); return cells; };
    const inner = ring(radius + 2), outer = ring(radius + 3), extra = 36 - inner.length;
    [...inner, ...Array.from({ length: extra }, (_, i) => outer[Math.floor(i * outer.length / extra)])].forEach(([q, r], i) => tile(q, r, RESOURCES[i % 5], 1));
  }
  const productive = tiles.filter(t => t.terrain !== 'desert');
  const red = new Set<string>();
  for (const t of shuffled(productive, random)) {
    if (red.size >= Math.round(productive.length * 2 / 9)) break;
    if (!directions.some(([q, r]) => red.has(`${t.q + q}:${t.r + r}`))) red.add(t.id);
  }
  let index = 0, redIndex = 0;
  const numbers = shuffled(productive.length === 28 ? [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12] : [2, 3, 3, 4, 4, 5, 5, 9, 9, 10, 10, 11, 11, 12], random);
  for (const t of productive) t.number = red.has(t.id) ? (redIndex++ % 2 ? 8 : 6) : numbers[index++ % numbers.length];
  // Snapshot land tiles: adding sea tiles must not extend this loop.
  for (const t of tiles.slice()) for (const [q, r] of directions) tile(t.q + q, t.r + r, 'sea', -1);
  // Expedition seas need navigable water away from both the home coast and the frame.
  if (expansion === 'explorers') for (const t of tiles.slice()) for (const [q, r] of directions) tile(t.q + q, t.r + r, 'sea', -1);
  const vertices: Board['vertices'] = [], edges: Board['edges'] = [], vertexMap = new Map<string, string>(), edgeMap = new Map<string, string>();
  for (const t of tiles) {
    const corners = Array.from({ length: 6 }, (_, i) => {
      const angle = (30 + 60 * i) * Math.PI / 180, x = Math.round((t.x + Math.cos(angle)) * 10000) / 10000, y = Math.round((t.y + Math.sin(angle)) * 10000) / 10000;
      const key = `${x}:${y}`;
      let id = vertexMap.get(key);
      if (!id) { id = `v${vertices.length}`; vertexMap.set(key, id); vertices.push({ id, x, y, tiles: [], edges: [] }); }
      vertices[Number(id.slice(1))].tiles.push(t.id); return id;
    });
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % 6], key = [a, b].sort().join(':');
      let id = edgeMap.get(key);
      if (!id) {
        id = `e${edges.length}`; edgeMap.set(key, id); edges.push({ id, a, b, tiles: [], land: false, sea: false });
        vertices[Number(a.slice(1))].edges.push(id); vertices[Number(b.slice(1))].edges.push(id);
      }
      const edge = edges[Number(id.slice(1))]; edge.tiles.push(t.id); edge.land ||= t.terrain !== 'sea'; edge.sea ||= t.terrain === 'sea';
    });
  }
  const coast = edges.filter(e => e.land && e.sea && e.tiles.some(id => tiles.find(t => t.id === id)?.island === 0));
  const ports: Board['ports'] = [], used = new Set<string>();
  for (const edge of shuffled(coast, random)) {
    if (ports.length >= (count <= 4 ? 9 : 11)) break;
    if ([edge.a, edge.b].some(id => used.has(id))) continue;
    ports.push({ vertices: [edge.a, edge.b], resource: ports.length < 5 ? RESOURCES[ports.length] : 'any' }); used.add(edge.a); used.add(edge.b);
  }
  return { tiles, vertices, edges, ports };
}
