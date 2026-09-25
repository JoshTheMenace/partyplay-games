/* Shared ASCII level parser. Browser-safe: public layout only (see DESIGN.md "Tile legend"). */
import type { HeistMap, LegendEntry, LevelSource, MapObject, Point, Prop, PropKind } from './model';

const STRUCTURE = '#%=~ .,dw';
const NON_SOLID_PROPS: readonly PropKind[] = ['rug', 'painting'];
const FACING = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 } as const;
const centre = (x: number, y: number): Point => ({ x: x + .5, y: y + .5 });
const blocksDoorSide = (c: string | undefined) => !!c && '#%=~ wd'.includes(c);

/** Parses and validates a level. Throws with the cell position on authoring mistakes. */
export function parseLevel(src: LevelSource): HeistMap {
  const width = Math.max(...src.grid.map(row => row.length)), height = src.grid.length;
  const grid = src.grid.map(row => row.padEnd(width, ' '));
  const tiles: string[] = [], objects: MapObject[] = [], coins: Point[] = [], spawns: Point[] = [], vents = new Map<string, MapObject>();
  const at = (x: number, y: number) => grid[y]?.[x];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const c = grid[y][x], p = centre(x, y), where = `${src.id} (${x},${y})`;
      if (STRUCTURE.includes(c)) {
        row += c;
        if (c === 'd') objects.push({ id: `door-${x}-${y}`, kind: 'door', label: 'Door', ...p, horizontal: blocksDoorSide(at(x - 1, y)) && blocksDoorSide(at(x + 1, y)) });
        if (c === 'w') objects.push({ id: `window-${x}-${y}`, kind: 'window', label: 'Window', ...p, horizontal: blocksDoorSide(at(x - 1, y)) || blocksDoorSide(at(x + 1, y)) });
        continue;
      }
      if (c === 'L') { row += 'd'; objects.push({ id: `door-${x}-${y}`, kind: 'door', label: 'Locked door', locked: true, ...p, horizontal: blocksDoorSide(at(x - 1, y)) && blocksDoorSide(at(x + 1, y)) }); continue; }
      const fixed: Record<string, LegendEntry | 'coin' | 'spawn' | undefined> = { $: 'coin', P: 'spawn', E: { kind: 'exit', label: 'Getaway' }, O: { kind: 'objective', label: src.objective }, S: { kind: 'safe', label: 'Safe' }, '+': { kind: 'medkit', label: 'First aid' }, H: { kind: 'hide', label: 'Hiding spot' } };
      const entry = (src.legend[c] as LegendEntry | undefined) ?? fixed[c];
      if (!entry) throw Error(`Unknown map character "${c}" at ${where}.`);
      if (entry === 'coin') { coins.push(p); row += '.'; continue; }
      if (entry === 'spawn') { spawns.push(p); row += '.'; continue; }
      const mounted = entry.kind === 'camera' || entry.kind === 'laser';
      row += mounted ? '#' : '.';
      let facing = typeof entry.facing === 'string' ? FACING[entry.facing] : entry.facing;
      if (mounted && facing === undefined) {
        const open = (Object.entries({ E: [1, 0], S: [0, 1], W: [-1, 0], N: [0, -1] }) as [keyof typeof FACING, number[]][]).find(([, [dx, dy]]) => '.,$PH+'.includes(at(x + dx, y + dy) ?? '#'));
        if (!open) throw Error(`Mounted ${entry.kind} at ${where} has no open side.`);
        facing = FACING[open[0]];
      }
      const id = entry.kind === 'objective' ? 'objective' : entry.kind === 'exit' ? 'exit' : `${entry.kind}-${x}-${y}`;
      const object: MapObject = { id, kind: entry.kind, label: entry.label ?? entry.kind[0].toUpperCase() + entry.kind.slice(1), ...p, ...(entry.circuit ? { circuit: entry.circuit } : {}), ...(facing !== undefined ? { facing } : {}) };
      if (entry.kind === 'vent') { vents.set(c, object); if (entry.pair) object.pair = entry.pair; }
      objects.push(object);
    }
    tiles.push(row);
  }
  // Objects keep the ground they stand on: outdoor when their source neighbours touch ',' and no indoor '.'.
  const near = (x: number, y: number, c: string) => [at(x, y - 1), at(x, y + 1), at(x - 1, y), at(x + 1, y)].includes(c);
  for (let y = 0; y < height; y++) tiles[y] = tiles[y].replace(/\./g, (c, x: number) => grid[y][x] !== '.' && near(x, y, ',') && !near(x, y, '.') ? ',' : c);
  // Orientation uses converted tiles so neighbouring doors and wall-mounted devices count as wall.
  for (const o of objects) if (o.kind === 'door' || o.kind === 'window') {
    const x = Math.floor(o.x), y = Math.floor(o.y), side = (dx: number) => blocksDoorSide(tiles[y][x + dx]);
    o.horizontal = o.kind === 'door' ? side(-1) && side(1) : side(-1) || side(1);
  }
  for (const vent of vents.values()) {
    const other = vent.pair ? vents.get(vent.pair) : undefined;
    if (!other) throw Error(`${src.id}: vent ${vent.id} needs a pair letter that is also a vent.`);
    vent.pair = other.id;
  }
  const props: Prop[] = src.props.map(([kind, x, y, w = 1, h = 1, rot = 0]) => ({ kind, x, y, w, h, rot, solid: !NON_SOLID_PROPS.includes(kind) }));
  for (const p of props) for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) {
    const c = grid[p.y + dy]?.[p.x + dx];
    if (p.solid && c !== '.' && c !== ',') throw Error(`${src.id}: solid ${p.kind} at (${p.x + dx},${p.y + dy}) overlaps "${c}".`);
  }
  const count = (kind: MapObject['kind']) => objects.filter(o => o.kind === kind).length;
  if (count('objective') !== 1 || count('exit') !== 1) throw Error(`${src.id}: needs exactly one O and one E.`);
  if (spawns.length < 4) throw Error(`${src.id}: needs at least four P spawns.`);
  const { grid: _g, props: _p, legend: _l, ...meta } = src;
  return { ...meta, width, height, tiles, props, objects, coins, spawns };
}
