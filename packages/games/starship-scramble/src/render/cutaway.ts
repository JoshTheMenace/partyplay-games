import { ROOM_LAYOUTS } from '../definitions/presentation/layouts';
import type { SystemId } from '../contracts';
import { MIN_TARGET, type Rect, type RoomRect } from './geometry';
/** Minimal room shape the cutaway needs. RoomView and hangar HullDefinition rooms both satisfy it. */
export type CutawayRoom = { id: string; x: number; y: number; w: number; h: number; adjacent: string[] };
export type Margins = { l: number; r: number; t: number; b: number };
export type Point = [number, number];
/** Per-hull exterior authored in tile units around the room footprint (W x H). Nose faces +x. Polygons stay testable for containment. */
export type Exterior = { margins: Margins; body(W: number, H: number): Point[]; parts(W: number, H: number): Part[] };
/** poly: steel fin/pod behind the hull · plate: armour plate over the hull · band: dark armour band clipped to the hull · window/mark: small fittings · ring: barrel muzzle rings · hazard: yellow-black warning stripe. */
export type Part = { kind: 'poly' | 'plate' | 'band' | 'engine' | 'canopy' | 'stripe' | 'hazard' | 'dish' | 'barrel' | 'ring' | 'window' | 'mark'; points?: Point[]; at?: Point; r?: number; w?: number; h?: number };
/** The pressure hull wraps the authored deck, with a little steel outside every bulkhead. */
function envelope(id: string, W: number, H: number, bow: number, flare = .5, tail = 1): Point[] {
  const rooms = ROOM_LAYOUTS[id], sx = W / Math.max(...rooms.map(r => r[0] + r[2])), sy = H / Math.max(...rooms.map(r => r[1] + r[3]));
  const points: Point[] = rooms.flatMap(([x,y,w,h]) => [[x*sx-.28,y*sy-.28],[(x+w)*sx+.28,y*sy-.28],[(x+w)*sx+.28,(y+h)*sy+.28],[x*sx-.28,(y+h)*sy+.28]] as Point[]);
  points.push([-tail,H*.3],[-tail,H*.7],[W+bow,H*.5],[W*.22,-flare],[W*.22,H+flare]);
  points.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const cross = (a:Point,b:Point,c:Point) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half = (list:Point[]) => { const out:Point[]=[]; for(const point of list) { while(out.length>1 && cross(out.at(-2)!,out.at(-1)!,point)<=0)out.pop();out.push(point); }out.pop();return out; };
  return [...half(points),...half([...points].reverse())];
}
const engines = (H:number,count:number,spread=.65,w=1.1): Part[] => Array.from({length:count},(_,i)=>({kind:'engine',at:[-.5,H/2+(i-(count-1)/2)*H*spread/Math.max(1,count-1)],w,h:count===1?2.2:1.3}));
/** Fins stay inside a 0.7-tile band above and below the deck so short landscape frames keep 44px rooms. */
const fin = (W:number,H:number,bottom=false,sweep=.5,root=.12,tip=.65,reach=.7): Part => ({kind:'poly',points:[[W*root,bottom?H-.1:.1],[W*tip,bottom?H-.1:.1],[W*sweep,bottom?H+reach:-reach],[W*(root-.04),bottom?H+reach*.9:-reach*.9]]});
const stripe = (W:number,H:number,from=.12,to=.7):Part => ({kind:'stripe',points:[[W*from,H+.12],[W*to,H+.12]]});
const mirror = (H:number,part:Part):Part => ({...part,points:part.points?.map(([x,y])=>[x,H-y] as Point),at:part.at?[part.at[0],H-part.at[1]]:undefined});
export const EXTERIORS: Record<string, Exterior> = {
  // Wayfarer, explorer: long tapered bow with a raised bridge, twin nacelles, racing stripe and forward sensor windows.
  wayfarer:{margins:{l:1.8,r:2.4,t:.95,b:.95},body:(W,H)=>envelope('wayfarer',W,H,2.2,.55),parts:(W,H)=>[fin(W,H,false,.5),fin(W,H,true,.5),...engines(H,2),{kind:'plate',points:[[W+.15,H*.4],[W+1.25,H*.46],[W+1.25,H*.54],[W+.15,H*.6]]},{kind:'canopy',at:[W+.5,H/2],r:.5},{kind:'window',at:[W*.92,H*.3],r:.16},{kind:'window',at:[W*.92,H*.7],r:.16},stripe(W,H,.1,.78),{kind:'stripe',points:[[W*.15,-.12],[W*.6,-.12]]}]},
  // Bulwark, armoured escort: boxy hull, layered prow plates, triple engines, dark armour bands and no canopy.
  bulwark:{margins:{l:1.9,r:1.9,t:.9,b:.9},body:(W,H)=>envelope('bulwark',W,H,1.05,.7,1.1),parts:(W,H)=>[...engines(H,3,.7),{kind:'plate',points:[[W+.05,H*.18],[W+.85,H*.3],[W+.85,H*.7],[W+.05,H*.82]]},{kind:'plate',points:[[W+.75,H*.36],[W+1.5,H*.43],[W+1.5,H*.57],[W+.75,H*.64]]},{kind:'band',points:[[W*.2,-.3],[W*.2,H+.3]],w:.34},{kind:'band',points:[[W*.55,-.3],[W*.55,H+.3]],w:.34},{kind:'band',points:[[W*.86,-.3],[W*.86,H+.3]],w:.3},{kind:'window',at:[W+.35,H*.5],r:.14}]},
  // Longbow, artillery: narrow spine, recoil housing and a long braced barrel with muzzle rings; twin slim engines and small tail fins.
  longbow:{margins:{l:1.9,r:3.2,t:.7,b:.7},body:(W,H)=>envelope('longbow',W,H,2.3,.3),parts:(W,H)=>[fin(W,H,false,.3,.05,.4,.5),fin(W,H,true,.3,.05,.4,.5),...engines(H,2,.45,.9),{kind:'plate',points:[[W*.78,H*.36],[W+.55,H*.42],[W+.55,H*.58],[W*.78,H*.64]]},{kind:'barrel',points:[[W+.5,H/2],[W+2.8,H/2]],w:.42},{kind:'ring',at:[W+1.35,H/2],r:.34},{kind:'ring',at:[W+1.85,H/2],r:.34},{kind:'ring',at:[W+2.35,H/2],r:.34},stripe(W,H,.1,.72)]},
  // Moth, boarding vessel: four swept fin blades, a single heavy engine and a forward boarding ram with clamp arms.
  moth:{margins:{l:1.8,r:1.9,t:.95,b:.95},body:(W,H)=>envelope('moth',W,H,1.35,.6),parts:(W,H)=>[fin(W,H,false,.88,.15,.6),fin(W,H,true,.88,.15,.6),{kind:'poly',points:[[W*.62,.1],[W*.9,.1],[W*.84,-.6],[W*.56,-.5]]},mirror(H,{kind:'poly',points:[[W*.62,.1],[W*.9,.1],[W*.84,-.6],[W*.56,-.5]]}),...engines(H,1),{kind:'plate',points:[[W+.15,H*.46],[W+1.7,H*.5],[W+.15,H*.54]]},{kind:'plate',points:[[W+.1,H*.3],[W+1.05,H*.37],[W+1.05,H*.44],[W+.1,H*.42]]},mirror(H,{kind:'plate',points:[[W+.1,H*.3],[W+1.05,H*.37],[W+1.05,H*.44],[W+.1,H*.42]]}),{kind:'canopy',at:[W+.4,H/2],r:.45},{kind:'stripe',points:[[W*.62,H+.25],[W*.87,H+.62]]}]},
  // Hearth, medical carrier: soft rounded body, medical pods with crosses, a wide bridge canopy and a row of ward windows.
  hearth:{margins:{l:1.8,r:1.8,t:.95,b:.95},body:(W,H)=>envelope('hearth',W,H,1.5,.85),parts:(W,H)=>[...engines(H,2,.6),{kind:'poly',points:[[W*.06,-.1],[W*.5,-.1],[W*.52,-.4],[W*.45,-.66],[W*.11,-.66],[W*.04,-.4]]},mirror(H,{kind:'poly',points:[[W*.06,-.1],[W*.5,-.1],[W*.52,-.4],[W*.45,-.66],[W*.11,-.66],[W*.04,-.4]]}),{kind:'mark',at:[W*.28,-.38],r:.2},{kind:'mark',at:[W*.28,H+.38],r:.2},{kind:'canopy',at:[W+.45,H/2],r:.55},{kind:'window',at:[W*.6,H*.5],r:.13},{kind:'window',at:[W*.72,H*.5],r:.13},{kind:'window',at:[W*.84,H*.5],r:.13}]},
  // Kite, scout: needle bow, swept-back rear fins, a single engine and twin speed stripes.
  kite:{margins:{l:1.9,r:2.6,t:.9,b:.9},body:(W,H)=>envelope('kite',W,H,2.4,.45),parts:(W,H)=>[{kind:'poly',points:[[W*.02,.1],[W*.38,.1],[W*.14,-.68],[-.55,-.55]]},mirror(H,{kind:'poly',points:[[W*.02,.1],[W*.38,.1],[W*.14,-.68],[-.55,-.55]]}),...engines(H,1,.65,1.2),{kind:'canopy',at:[W+.7,H/2],r:.5},{kind:'window',at:[W+1.65,H/2],r:.14},{kind:'stripe',points:[[W*.05,-.35],[W*.3,-.5]]},{kind:'stripe',points:[[W*.05,H+.35],[W*.3,H+.5]]},stripe(W,H,.35,.85)]},
  // Magpie, salvage: boxy hold, grabber jaws with teeth, a crane arm and cargo hatch on top, hazard striping below.
  magpie:{margins:{l:1.8,r:2.2,t:.95,b:.75},body:(W,H)=>envelope('magpie',W,H,.7,.3,1.1),parts:(W,H)=>[...engines(H,2),{kind:'plate',points:[[W+.15,H*.16],[W+1.9,H*.08],[W+1.9,H*.26],[W+.4,H*.42]]},{kind:'poly',points:[[W+1.2,H*.26],[W+1.35,H*.36],[W+1.5,H*.26]]},{kind:'poly',points:[[W+.75,H*.34],[W+.9,H*.44],[W+1.05,H*.33]]},{kind:'plate',points:[[W+.15,H*.84],[W+1.9,H*.92],[W+1.9,H*.74],[W+.4,H*.58]]},{kind:'poly',points:[[W+1.2,H*.74],[W+1.35,H*.64],[W+1.5,H*.74]]},{kind:'poly',points:[[W+.75,H*.66],[W+.9,H*.56],[W+1.05,H*.67]]},{kind:'poly',points:[[W*.3,-.15],[W*.3,-.7],[W*.78,-.7],[W*.78,-.42],[W*.38,-.42],[W*.38,-.15]]},{kind:'poly',points:[[W*.74,-.42],[W*.82,-.42],[W*.82,-.2],[W*.74,-.2]]},{kind:'plate',points:[[W*.46,-.12],[W*.7,-.12],[W*.7,-.5],[W*.46,-.5]]},{kind:'hazard',points:[[W*.1,H+.14],[W*.72,H+.14]]}]},
  // Cuttlefish, electronic warfare: main and secondary sensor dishes, three trailing antennae, sensor blisters along the belly.
  cuttlefish:{margins:{l:2.3,r:1.9,t:1,b:.75},body:(W,H)=>envelope('cuttlefish',W,H,1.5,.4,1.05),parts:(W,H)=>[...engines(H,2,.4),{kind:'dish',at:[W*.44,-.38],r:.3},{kind:'dish',at:[W*.72,-.3],r:.2},{kind:'barrel',points:[[-.7,H*.28],[-2.0,H*.16]],w:.16},{kind:'barrel',points:[[-.8,H*.5],[-2.05,H*.5]],w:.14},{kind:'barrel',points:[[-.7,H*.72],[-2.0,H*.84]],w:.16},{kind:'window',at:[W*.3,H+.38],r:.16},{kind:'window',at:[W*.5,H+.44],r:.16},{kind:'window',at:[W*.7,H+.38],r:.16},{kind:'canopy',at:[W+.45,H/2],r:.5}]},
};
/** Enemy hulls reuse the authored exteriors; unknown ids get a plain raider envelope. */
export const exteriorFor = (hullId: string): Exterior => EXTERIORS[hullId] ?? { margins: { l: 1.6, r: 2, t: 1, b: 1 }, body: (W, H) => [[-1.2, .5], [0, -.5], [W, -.5], [W + 2, H / 2], [W, H + .5], [0, H + .5], [-1.2, H - .5]], parts: (_W, H) => engines(H, 2) };
export type CutawayFit = { hullId: string; tile: number; ox: number; oy: number; grid: { w: number; h: number }; rooms: RoomRect[]; meets44: boolean; hull: Rect; extent: Rect; body: Point[]; parts: Part[]; margins: Margins };
/** Bounding box of every painted element including decoration strokes, so containment checks cover the whole picture. */
export function partsExtent(body: Point[], parts: Part[], stroke = 3): Rect {
  const xs = body.map(p => p[0]), ys = body.map(p => p[1]);
  for (const part of parts) {
    for (const [x, y] of part.points ?? []) { xs.push(x - (part.w ?? 0) / 2 - stroke, x + (part.w ?? 0) / 2 + stroke); ys.push(y - (part.w ?? 0) / 2 - stroke, y + (part.w ?? 0) / 2 + stroke); }
    if (part.at) { const rx = part.kind === 'dish' ? (part.r ?? 0) * 1.4 : part.kind === 'canopy' ? (part.r ?? 0) * .9 : part.r ? part.r : (part.w ?? 0) / 2 + 2, ry = part.kind === 'dish' ? (part.r ?? 0) * 1.4 : part.kind === 'canopy' ? (part.r ?? 0) * 1.2 : part.r ? part.r : (part.h ?? 0) / 2; xs.push(part.at[0] - rx - stroke, part.at[0] + rx + stroke); ys.push(part.at[1] - ry - stroke, part.at[1] + ry + stroke); }
  }
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
/** One geometry for art and hit targets: the room grid plus the exterior margins must fit the stage together. */
export function fitCutaway(rooms: CutawayRoom[], stage: { w: number; h: number }, hullId: string, pad = 6): CutawayFit {
  const exterior = exteriorFor(hullId), m = { ...exterior.margins, t: Math.max(1.15, exterior.margins.t), b: Math.max(1.15, exterior.margins.b) };
  const grid = { w: Math.max(1, ...rooms.map(r => r.x + r.w)), h: Math.max(1, ...rooms.map(r => r.y + r.h)) };
  const tile = Math.max(1, Math.floor(Math.min((stage.w - pad * 2) / (grid.w + m.l + m.r), (stage.h - pad * 2) / (grid.h + m.t + m.b))));
  const ox = Math.round((stage.w - (grid.w + m.l + m.r) * tile) / 2 + m.l * tile), oy = Math.round((stage.h - (grid.h + m.t + m.b) * tile) / 2 + m.t * tile);
  const px = ([x, y]: Point): Point => [ox + x * tile, oy + y * tile];
  const placed = rooms.map(r => ({ id: r.id, x: ox + r.x * tile, y: oy + r.y * tile, w: r.w * tile, h: r.h * tile }));
  const body = exterior.body(grid.w, grid.h).map(px);
  const parts = exterior.parts(grid.w, grid.h).map(part => ({ ...part, points: part.points?.map(px), at: part.at ? px(part.at) : undefined, r: part.r ? part.r * tile : undefined, w: part.w ? part.w * tile : undefined, h: part.h ? part.h * tile : undefined }));
  const xs = body.map(p => p[0]), ys = body.map(p => p[1]);
  return { hullId, tile, ox, oy, grid, rooms: placed, meets44: placed.every(r => r.w >= MIN_TARGET && r.h >= MIN_TARGET), hull: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, extent: partsExtent(body, parts, Math.max(3, tile * .16)), body, parts, margins: m };
}
export type Door = { a: string; b: string; x1: number; y1: number; x2: number; y2: number };
/** A door is the centred third of the edge two adjacent rooms share. Adjacency without a shared edge yields no door and is a content defect the tests catch. */
export function doorsFor(rooms: RoomRect[], adjacency: Record<string, string[]>): Door[] {
  const doors: Door[] = [], seen = new Set<string>();
  for (const a of rooms) for (const id of adjacency[a.id] ?? []) {
    const b = rooms.find(r => r.id === id); if (!b) continue; const key = [a.id, b.id].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
    const vertical = Math.abs(a.x + a.w - b.x) < .5 ? a.x + a.w : Math.abs(b.x + b.w - a.x) < .5 ? a.x : null;
    const horizontal = Math.abs(a.y + a.h - b.y) < .5 ? a.y + a.h : Math.abs(b.y + b.h - a.y) < .5 ? a.y : null;
    if (vertical !== null) { const lo = Math.max(a.y, b.y), hi = Math.min(a.y + a.h, b.y + b.h); if (hi - lo > 0) { const third = (hi - lo) / 3; doors.push({ a: a.id, b: b.id, x1: vertical, y1: lo + third, x2: vertical, y2: hi - third }); } }
    else if (horizontal !== null) { const lo = Math.max(a.x, b.x), hi = Math.min(a.x + a.w, b.x + b.w); if (hi - lo > 0) { const third = (hi - lo) / 3; doors.push({ a: a.id, b: b.id, x1: lo + third, y1: horizontal, x2: hi - third, y2: horizontal }); } }
  }
  return doors;
}
export function pointInPolygon([x, y]: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) { const [xi, yi] = polygon[i], [xj, yj] = polygon[j]; if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; }
  return inside;
}
export const rectInside = (rect: Rect, polygon: Point[]) => ([[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]] as Point[]).every(p => pointInPolygon(p, polygon));
export const polygonPath = (points: Point[]) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ' Z';
/** Interior furniture per system, in room-relative units (0..1). Strokes only, so the paint and floor stay legible beneath. */
export type Furniture = { kind: 'rect' | 'circle' | 'line' | 'arc'; x: number; y: number; w?: number; h?: number; r?: number; x2?: number; y2?: number };
export const FURNITURE: Partial<Record<SystemId, Furniture[]>> = {
  piloting: [{ kind: 'arc', x: .5, y: .3, r: .28 }, { kind: 'rect', x: .42, y: .5, w: .16, h: .22 }],
  engines: [{ kind: 'circle', x: .3, y: .5, r: .17 }, { kind: 'circle', x: .7, y: .5, r: .17 }, { kind: 'circle', x: .3, y: .5, r: .07 }, { kind: 'circle', x: .7, y: .5, r: .07 }],
  shields: [{ kind: 'circle', x: .5, y: .55, r: .22 }, { kind: 'arc', x: .5, y: .55, r: .34 }],
  weaponry: [{ kind: 'rect', x: .18, y: .3, w: .64, h: .1 }, { kind: 'rect', x: .18, y: .5, w: .64, h: .1 }, { kind: 'rect', x: .18, y: .7, w: .64, h: .1 }],
  'life-support': [{ kind: 'line', x: .2, y: .35, x2: .8, y2: .35 }, { kind: 'line', x: .2, y: .5, x2: .8, y2: .5 }, { kind: 'line', x: .2, y: .65, x2: .8, y2: .65 }, { kind: 'rect', x: .15, y: .25, w: .7, h: .5 }],
  doors: [{ kind: 'rect', x: .3, y: .25, w: .4, h: .5 }, { kind: 'line', x: .5, y: .25, x2: .5, y2: .75 }],
  medical: [{ kind: 'rect', x: .2, y: .35, w: .6, h: .3 }, { kind: 'line', x: .5, y: .2, x2: .5, y2: .8 }, { kind: 'line', x: .35, y: .5, x2: .65, y2: .5 }],
  teleporter: [{ kind: 'circle', x: .5, y: .5, r: .3 }, { kind: 'circle', x: .5, y: .5, r: .16 }],
  'drone-bay': [{ kind: 'rect', x: .2, y: .25, w: .6, h: .5 }, { kind: 'line', x: .2, y: .5, x2: .8, y2: .5 }],
  hacking: [{ kind: 'line', x: .5, y: .2, x2: .5, y2: .6 }, { kind: 'arc', x: .5, y: .6, r: .22 }, { kind: 'rect', x: .35, y: .6, w: .3, h: .18 }],
  cloak: [{ kind: 'arc', x: .5, y: .5, r: .3 }, { kind: 'arc', x: .5, y: .5, r: .18 }],
  'point-defense': [{ kind: 'circle', x: .5, y: .55, r: .12 }, { kind: 'line', x: .5, y: .55, x2: .8, y2: .3 }, { kind: 'line', x: .5, y: .55, x2: .2, y2: .3 }],
  'shield-projector': [{ kind: 'arc', x: .5, y: .6, r: .3 }, { kind: 'rect', x: .42, y: .6, w: .16, h: .2 }],
  'repair-relay': [{ kind: 'rect', x: .25, y: .3, w: .5, h: .4 }, { kind: 'line', x: .25, y: .3, x2: .75, y2: .7 }],
  tractor: [{ kind: 'circle', x: .5, y: .5, r: .26 }, { kind: 'line', x: .5, y: .5, x2: .85, y2: .5 }],
  scanner: [{ kind: 'arc', x: .5, y: .55, r: .3 }, { kind: 'arc', x: .5, y: .55, r: .18 }, { kind: 'circle', x: .5, y: .55, r: .05 }],
  decoy: [{ kind: 'circle', x: .35, y: .5, r: .14 }, { kind: 'circle', x: .65, y: .5, r: .14 }],
  'boarding-defense': [{ kind: 'rect', x: .2, y: .3, w: .6, h: .4 }, { kind: 'line', x: .2, y: .5, x2: .8, y2: .5 }, { kind: 'line', x: .5, y: .3, x2: .5, y2: .7 }],
  'medical-support': [{ kind: 'rect', x: .2, y: .35, w: .6, h: .3 }, { kind: 'circle', x: .5, y: .5, r: .1 }],
};
/** Compact icon path for chips, cards and the TV: the authored exterior (body plus wings and engines) normalised into a 100x60 box, facing right. */
export function iconPath(hullId: string, grid: { w: number; h: number }) {
  const exterior = exteriorFor(hullId), body = exterior.body(grid.w, grid.h), parts = exterior.parts(grid.w, grid.h);
  const polys: Point[][] = [body, ...parts.filter(p => (p.kind === 'poly' || p.kind === 'plate') && p.points).map(p => p.points!), ...parts.filter(p => p.kind === 'engine' && p.at && p.w && p.h).map(p => { const [x, y] = p.at!, w = p.w!, h = p.h!; return [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]] as Point[]; })];
  const all = polys.flat(), minX = Math.min(...all.map(p => p[0])), maxX = Math.max(...all.map(p => p[0])), minY = Math.min(...all.map(p => p[1])), maxY = Math.max(...all.map(p => p[1]));
  const scale = Math.min(96 / (maxX - minX), 56 / (maxY - minY)), ox = 50 - ((minX + maxX) / 2) * scale, oy = 30 - ((minY + maxY) / 2) * scale;
  return polys.map(poly => polygonPath(poly.map(([x, y]) => [x * scale + ox, y * scale + oy] as Point))).join(' ');
}
/** Crew name labels sit in a reserved band at the bottom of the room, one slot per crew from left to right, so they never pile onto each other or the room caption.
 * Names abbreviate only when a slot is too narrow; the full name stays in the figure title and the roster. Below 18px per slot only the selected crew keeps a label. */
export type CrewLabel = { id: string; text: string; x: number; y: number; size: number; full: boolean };
export function fitLabel(name: string, maxWidth: number, size: number) {
  const chars = Math.floor(maxWidth / (size * .56)); if (name.length <= chars) return name;
  const first = name.split(/\s+/)[0]; if (first.length >= 2 && first.length <= chars) return first;
  return chars >= 3 ? `${name.slice(0, chars - 1)}…` : name.slice(0, Math.max(1, chars));
}
export function labelPlan(rect: Rect, members: { id: string; name: string; x: number }[], tile: number, selectedId: string | null = null): CrewLabel[] {
  const n = members.length; if (!n) return [];
  const pad = 3, inner = rect.w - pad * 2, slot = inner / n, size = n === 1 ? Math.min(10, Math.max(8, tile * .4)) : n === 2 ? 8.5 : 8, y = rect.y + rect.h - 4;
  const sorted = [...members].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  if (slot < 18) { const chosen = sorted.find(m => m.id === selectedId); if (!chosen) return []; const width = Math.min(inner, 64), text = fitLabel(chosen.name, width, size); return [{ id: chosen.id, text, x: Math.max(rect.x + pad + width / 2, Math.min(rect.x + rect.w - pad - width / 2, chosen.x)), y, size, full: text === chosen.name }]; }
  return sorted.map((m, i) => { const text = fitLabel(m.name, slot - 2, size); return { id: m.id, text, x: rect.x + pad + slot * (i + .5), y, size, full: text === m.name }; });
}
