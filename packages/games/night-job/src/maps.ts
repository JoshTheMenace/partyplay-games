import { MISSIONS, type HeistMap, type MapObject, type MissionId, type Point, type Prop, type Room } from './model.js';

const p = (x: number, y: number): Point => ({ x: x + .5, y: y + .5 });
const room = (name: string, x: number, y: number, w: number, h: number, tone: string, floor: Room['floor']): Room => ({ name, x, y, w, h, tone, floor });
const prop = (kind: Prop['kind'], x: number, y: number, w = 1, h = 1): Prop => ({ kind, ...p(x, y), w, h });
const object = (id: string, kind: MapObject['kind'], label: string, x: number, y: number, extra: Partial<MapObject> = {}): MapObject => ({ id, kind, label, ...p(x, y), ...extra });
// Authored wall strokes: x, y, width, height, material. Openings are cut afterward.
type Stroke = [number, number, number, number, string?];
function floor(strokes: Stroke[], openings: [number, number][]): string[] {
  const rows: string[][] = Array.from({ length: 18 }, (_, y) => Array.from({ length: 32 }, (_, x) => !x || !y || x === 31 || y === 17 ? '#' : '.'));
  for (const [x, y, w, h, tile = '#'] of strokes) for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) rows[y + dy][x + dx] = tile;
  for (const [x, y] of openings) rows[y][x] = '.';
  return rows.map(row => row.join(''));
}
const trail = (...routes: [number, number][][]): Point[] => {
  const cells = new Set<string>();
  for (const route of routes) for (let i = 1; i < route.length; i++) {
    const [ax, ay] = route[i - 1], [bx, by] = route[i], length = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let n = 0; n <= length; n++) cells.add(`${ax + Math.sign(bx - ax) * n},${ay + Math.sign(by - ay) * n}`);
  }
  return [...cells].map(cell => { const [x, y] = cell.split(',').map(Number); return p(x, y); });
};
const vents = (a: [number, number], b: [number, number]): MapObject[] => [object('vent-a', 'vent', 'Service duct', ...a, { target: p(...b) }), object('vent-b', 'vent', 'Service duct', ...b, { target: p(...a) })];

const velvet: HeistMap = {
  id: 'velvet', ...MISSIONS.velvet, width: 32, height: 18,
  briefing: 'The casino keeps two sets of books. Take the real ledger from the counting room. The service passage is longer, quieter, and connected to the courtyard.',
  objective: 'Steal the crooked ledger',
  tiles: floor([[9, 1, 1, 14], [21, 1, 1, 16], [1, 7, 8, 1], [10, 10, 11, 1], [22, 9, 9, 1], [1, 14, 20, 1], [9, 12, 1, 1, '%'], [21, 7, 1, 1, '%'], [23, 9, 2, 1, '=']], [[9, 4], [9, 11], [21, 5], [21, 12], [21, 15], [5, 7], [13, 10], [19, 10], [26, 9], [5, 14], [15, 14]]),
  rooms: [
    room('RECEPTION', 1, 1, 8, 6, '#80405d', 'carpet'), room('STAFF LOUNGE', 1, 8, 8, 6, '#395361', 'tile'),
    room('VELVET CLUB', 10, 1, 11, 9, '#733855', 'carpet'), room('CASHIER', 10, 11, 11, 3, '#426975', 'wood'),
    room('COUNTING ROOM', 22, 1, 9, 8, '#77633c', 'tile'), room('COURTYARD', 22, 10, 9, 7, '#365c47', 'garden'),
    room('SERVICE PASSAGE', 1, 15, 20, 2, '#344950', 'concrete'),
  ],
  props: [
    prop('desk', 2, 2, 3), prop('plant', 1, 1), prop('plant', 7, 1), prop('sofa', 2, 5, 2), prop('rug', 5, 3, 2, 2),
    prop('table', 12, 3, 2, 2), prop('chair', 11, 3), prop('chair', 14, 4), prop('table', 17, 3, 2, 2), prop('chair', 16, 4), prop('chair', 19, 3),
    prop('table', 12, 7, 2), prop('table', 17, 7, 2), prop('bar', 11, 1, 7), prop('plant', 20, 1), prop('plant', 20, 8),
    prop('sofa', 1, 9, 3), prop('table', 5, 10, 2), prop('chair', 6, 11), prop('shelf', 1, 12, 2), prop('plant', 8, 13),
    prop('desk', 11, 12, 3), prop('shelf', 16, 11, 3), prop('crate', 19, 13), prop('crate', 8, 16), prop('crate', 11, 15),
    prop('desk', 23, 2, 3), prop('desk', 27, 6, 2), prop('shelf', 29, 2, 1, 3), prop('rug', 26, 3, 2, 2),
    prop('plant', 23, 11), prop('plant', 29, 11), prop('plant', 29, 15), prop('table', 26, 13, 2), prop('statue', 24, 14),
  ],
  objects: [
    object('reception-door', 'door', 'Reception lock', 9, 4), object('counting-door', 'door', 'Counting room lock', 21, 5), object('garden-door', 'door', 'Courtyard lock', 26, 9),
    object('ledger', 'objective', 'Crooked ledger', 28, 3), object('getaway', 'exit', 'Getaway van', 2, 15),
    object('cash-safe', 'safe', 'Cashier safe', 18, 12), object('counting-safe', 'safe', 'Reserve safe', 29, 7),
    object('security', 'terminal', 'Casino circuit', 7, 11, { circuit: 'casino' }), object('camera', 'camera', 'Counting camera', 25, 2, { circuit: 'casino', facing: Math.PI / 2 }),
    object('laser', 'laser', 'Ledger beam', 27, 3, { circuit: 'casino', facing: Math.PI / 2 }),
    object('medicine', 'medkit', 'First aid', 3, 10), object('garden-hide', 'hide', 'Laurel bushes', 29, 13), object('lounge-hide', 'hide', 'Coat alcove', 7, 9),
    ...vents([2, 12], [19, 2]),
  ],
  loot: trail([[4, 15], [5, 15], [5, 8]], [[5, 6], [5, 4], [8, 4]], [[10, 4], [10, 5], [20, 5]], [[22, 5], [26, 5], [26, 3], [28, 3]], [[10, 11], [13, 11], [13, 12], [18, 12]], [[15, 15], [20, 15]], [[22, 15], [26, 15], [26, 10]], [[28, 7], [30, 7]]),
  spawns: [p(2, 15), p(3, 15), p(2, 16), p(3, 16)],
};

const glasshouse: HeistMap = {
  id: 'glasshouse', ...MISSIONS.glasshouse, width: 32, height: 18,
  briefing: 'Tonight’s auction centerpiece was stolen first. Lift the prism jewel from the east gallery. Glass exposes movement; the potting rooms and hedges break pursuit.',
  objective: 'Take the prism jewel',
  tiles: floor([[10, 5, 12, 1, '='], [10, 12, 12, 1, '='], [10, 6, 1, 6, '='], [21, 6, 1, 6, '='], [1, 6, 7, 1], [8, 1, 1, 6], [1, 11, 7, 1], [8, 11, 1, 6], [23, 5, 8, 1], [23, 1, 1, 4], [23, 11, 8, 1], [23, 12, 1, 5], [8, 3, 1, 1, '%'], [23, 14, 1, 1, '%']], [[4, 6], [8, 4], [4, 11], [8, 14], [15, 5], [15, 12], [10, 8], [21, 9], [23, 3], [27, 5], [27, 11], [23, 15]]),
  rooms: [
    room('DELIVERY', 1, 12, 7, 5, '#3c5667', 'concrete'), room('POTTING SHED', 1, 7, 7, 4, '#775d3e', 'wood'), room('CURATOR', 1, 1, 7, 5, '#756249', 'wood'),
    room('WEST WALK', 8, 7, 2, 10, '#3e6352', 'garden'), room('PALM COURT', 11, 6, 10, 6, '#365c49', 'garden'),
    room('SCULPTURE WALK', 9, 1, 14, 4, '#426d6e', 'tile'), room('PRISM GALLERY', 24, 1, 7, 4, '#6c526f', 'tile'),
    room('EAST WALK', 22, 6, 9, 5, '#365867', 'tile'), room('AUCTION SALON', 24, 12, 7, 5, '#704b5d', 'carpet'), room('SOUTH ARCADE', 9, 13, 14, 4, '#426d6e', 'tile'),
  ],
  props: [
    prop('crate', 1, 13, 2), prop('crate', 6, 15), prop('shelf', 1, 16, 2), prop('desk', 1, 8, 3), prop('shelf', 6, 8, 1, 2),
    prop('plant', 2, 9), prop('plant', 5, 9), prop('desk', 2, 2, 3), prop('chair', 3, 3), prop('shelf', 6, 1, 1, 3), prop('rug', 2, 4, 3),
    prop('statue', 11, 2), prop('statue', 16, 2), prop('statue', 21, 2), prop('plant', 9, 1), prop('plant', 22, 1),
    prop('plant', 12, 6, 2, 2), prop('plant', 18, 6, 2, 2), prop('plant', 12, 10, 2), prop('plant', 18, 10, 2), prop('water', 15, 8, 2, 2),
    prop('sofa', 24, 7, 2), prop('sofa', 28, 7, 2), prop('table', 26, 9), prop('plant', 30, 10),
    prop('statue', 25, 2), prop('statue', 29, 2), prop('rug', 27, 2, 2, 2),
    prop('table', 25, 13, 2), prop('chair', 24, 13), prop('chair', 27, 13), prop('table', 28, 15, 2), prop('bar', 25, 16, 2), prop('plant', 30, 12),
    prop('statue', 12, 15), prop('statue', 17, 15), prop('plant', 20, 15), prop('plant', 9, 16),
  ],
  objects: [
    object('curator-door', 'door', 'Curator lock', 8, 4), object('gallery-door', 'door', 'Gallery lock', 27, 5), object('gallery-west', 'door', 'Gallery side lock', 23, 3), object('salon-door', 'door', 'Auction lock', 27, 11),
    object('prism', 'objective', 'Prism jewel', 28, 3), object('getaway', 'exit', 'Delivery gate', 2, 15),
    object('curator-safe', 'safe', 'Provenance safe', 6, 4), object('auction-safe', 'safe', 'Bidders’ deposits', 29, 14),
    object('west-terminal', 'terminal', 'Gallery circuit', 6, 9, { circuit: 'gallery' }), object('east-terminal', 'terminal', 'Auction circuit', 25, 15, { circuit: 'auction' }),
    object('gallery-camera', 'camera', 'Gallery camera', 29, 1, { circuit: 'gallery', facing: Math.PI / 2 }), object('court-camera', 'camera', 'Court camera', 20, 6, { circuit: 'gallery', facing: Math.PI }),
    object('gallery-laser', 'laser', 'Jewel beam', 27, 3, { circuit: 'gallery', facing: Math.PI / 2 }), object('auction-laser', 'laser', 'Auction beam', 28, 14, { circuit: 'auction', facing: Math.PI / 2 }),
    object('medicine', 'medkit', 'Potting first aid', 2, 10), object('palm-hide', 'hide', 'Palm thicket', 12, 10), object('south-hide', 'hide', 'Tall ferns', 21, 15),
    ...vents([6, 13], [25, 8]),
  ],
  loot: trail([[4, 15], [4, 12]], [[4, 10], [4, 7]], [[5, 8], [9, 8]], [[11, 8], [11, 9], [20, 9]], [[22, 9], [27, 9], [27, 6]], [[27, 4], [28, 4], [28, 3]], [[9, 4], [12, 4], [12, 3], [22, 3]], [[4, 5], [6, 5], [6, 4]], [[9, 14], [15, 14], [15, 13]], [[24, 15], [27, 15], [27, 14], [29, 14]]),
  spawns: [p(2, 15), p(3, 15), p(2, 14), p(3, 14)],
};

const ferry: HeistMap = {
  id: 'ferry', ...MISSIONS.ferry, width: 32, height: 18,
  briefing: 'A customs manifest will put the harbor boss away. Slip through freight, reach the records vault, then cross the quay to the waiting launch. The open pier gives patrols a long view.',
  objective: 'Steal the sealed manifest',
  tiles: floor([[1, 14, 30, 3, '~'], [1, 1, 1, 12, '~'], [2, 1, 1, 12], [3, 13, 28, 1], [10, 1, 1, 12], [20, 1, 1, 12], [3, 6, 7, 1], [11, 7, 9, 1], [21, 6, 10, 1], [14, 8, 1, 5], [25, 7, 1, 6], [10, 10, 1, 1, '%'], [20, 3, 1, 1, '%'], [21, 6, 3, 1, '=']], [[6, 6], [10, 4], [10, 11], [16, 7], [20, 5], [20, 10], [27, 6], [14, 10], [25, 10], [5, 13], [12, 13], [22, 13], [28, 13], [5, 14], [5, 15], [6, 15], [7, 15], [8, 15], [9, 15], [10, 15], [11, 15], [12, 15], [12, 14], [13, 15], [14, 15], [15, 15], [16, 15], [17, 15], [18, 15], [19, 15], [20, 15], [21, 15], [22, 15], [22, 14], [23, 15], [24, 15], [25, 15], [26, 15], [27, 15], [28, 15], [28, 14], [28, 16], [29, 16], [29, 15]]),
  rooms: [
    room('FREIGHT INTAKE', 3, 7, 7, 6, '#68634c', 'concrete'), room('BONDED STORE', 3, 1, 7, 5, '#765841', 'wood'),
    room('CUSTOMS HALL', 11, 1, 9, 6, '#486773', 'tile'), room('LOCKERS', 11, 8, 3, 5, '#4b5b63', 'concrete'), room('RADIO ROOM', 15, 8, 5, 5, '#3e6261', 'wood'),
    room('RECORDS VAULT', 21, 1, 10, 5, '#776849', 'tile'), room('INSPECTION', 21, 7, 4, 6, '#4c6d78', 'concrete'), room('PASSENGER LOUNGE', 26, 7, 5, 6, '#705557', 'wood'),
    room('NIGHT QUAY', 4, 14, 26, 3, '#364d5b', 'wood'),
  ],
  props: [
    prop('crate', 3, 8, 2, 2), prop('crate', 7, 8, 2), prop('crate', 8, 11), prop('crate', 3, 11), prop('shelf', 3, 1, 1, 3), prop('crate', 6, 2, 2, 2), prop('crate', 8, 4),
    prop('desk', 12, 2, 3), prop('desk', 16, 2, 3), prop('chair', 13, 3), prop('chair', 17, 3), prop('bar', 12, 5, 5), prop('plant', 19, 1),
    prop('shelf', 11, 8, 1, 2), prop('shelf', 13, 11), prop('desk', 16, 8, 2), prop('chair', 17, 9), prop('shelf', 19, 11),
    prop('shelf', 22, 1, 1, 3), prop('shelf', 24, 1, 1, 3), prop('desk', 27, 2, 2), prop('crate', 29, 4),
    prop('table', 22, 8, 2), prop('crate', 21, 11), prop('crate', 24, 12), prop('sofa', 27, 8, 3), prop('table', 28, 10), prop('plant', 30, 12),
    prop('crate', 8, 15), prop('crate', 16, 15), prop('bar', 28, 16, 2),
  ],
  objects: [
    object('store-door', 'door', 'Bonded store lock', 6, 6), object('customs-door', 'door', 'Customs lock', 10, 4), object('records-door', 'door', 'Records lock', 20, 5), object('lounge-door', 'door', 'Vault side lock', 27, 6),
    object('manifest', 'objective', 'Sealed manifest', 28, 3), object('getaway', 'exit', 'Waiting launch', 29, 15),
    object('freight-safe', 'safe', 'Seized valuables', 8, 2), object('records-safe', 'safe', 'Harbormaster safe', 29, 1),
    object('radio-terminal', 'terminal', 'Harbor circuit', 18, 9, { circuit: 'harbor' }), object('lounge-terminal', 'terminal', 'Records circuit', 29, 11, { circuit: 'records' }),
    object('quay-camera', 'camera', 'Quay camera', 22, 14, { circuit: 'harbor', facing: Math.PI }), object('hall-camera', 'camera', 'Customs camera', 18, 1, { circuit: 'harbor', facing: Math.PI / 2 }),
    object('records-camera', 'camera', 'Records camera', 26, 2, { circuit: 'records', facing: 0 }), object('records-laser', 'laser', 'Manifest beam', 27, 3, { circuit: 'records', facing: Math.PI / 2 }),
    object('medicine', 'medkit', 'Dock first aid', 12, 11), object('freight-hide', 'hide', 'Cargo tarpaulin', 7, 12), object('lounge-hide', 'hide', 'Potted palms', 30, 10),
    ...vents([4, 3], [23, 11]),
  ],
  loot: trail([[5, 11], [5, 7]], [[6, 5], [6, 4], [9, 4]], [[11, 4], [16, 4], [16, 5], [19, 5]], [[21, 5], [27, 5], [27, 4], [28, 4], [28, 3]], [[11, 11], [12, 11], [12, 10], [13, 10]], [[15, 10], [18, 10]], [[21, 10], [24, 10]], [[26, 10], [28, 10], [28, 14]], [[6, 15], [11, 15]], [[18, 15], [27, 15]], [[7, 2], [8, 2]]),
  spawns: [p(4, 11), p(5, 11), p(4, 12), p(5, 12)],
};

export const MAPS: Record<MissionId, HeistMap> = { velvet, glasshouse, ferry };
export const getMap = (id: MissionId): HeistMap => MAPS[id];
