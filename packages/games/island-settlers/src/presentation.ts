/** Browser-only presentation helpers shared by the phone, the host HUD and the host scene. No rules live here. */
import { RESOURCES, type Board, type DevKind, type Edge, type Hand, type PublicView, type Resource, type Settings, type Tile, type Vertex } from './model';
import { COMMODITIES, MISSIONS, TRACKS, type Commodity, type Good, type Mission, type ProgressKind, type Track } from './expansion-model';
import { DEFAULT_SETTINGS, SCENARIO_NAMES } from './expansion-settings';

export { DEFAULT_SETTINGS };
export const withDefaults = (settings: Partial<Settings> | null | undefined): Settings => ({ ...DEFAULT_SETTINGS, ...settings });
export const GOODS: readonly Good[] = [...RESOURCES, ...COMMODITIES];

export type TerrainMeta = { label: string; color: string; deep: string; glyph: string };
export const RESOURCE_META: Record<Resource, TerrainMeta & { terrain: string }> = {
  wood: { label: 'Wood', terrain: 'Forest', color: '#2f9a5f', deep: '#1f6b43', glyph: 'M12 3 5.5 13.5h4.2V21h4.6v-7.5h4.2Z' },
  brick: { label: 'Brick', terrain: 'Hills', color: '#d8683f', deep: '#a1472a', glyph: 'M3 6h8v4.5H3ZM13 6h8v4.5h-8ZM7.5 13.5h9V18h-9ZM3 13.5h3V18H3ZM18 13.5h3V18h-3Z' },
  wool: { label: 'Wool', terrain: 'Pasture', color: '#a3dc6f', deep: '#6faa47', glyph: 'M8.5 17.5a3.5 3.5 0 0 1-1.2-6.8A4.5 4.5 0 0 1 15.6 8a3.8 3.8 0 0 1 2.8 6.6 3 3 0 0 1-3.2 2.9ZM8 18h1.6v3H8ZM14.4 18H16v3h-1.6Z' },
  grain: { label: 'Grain', terrain: 'Fields', color: '#f0c24d', deep: '#bf8f2b', glyph: 'M11.2 21V11l-4-3.2v3.4l4 3.1ZM12.8 21V11l4-3.2v3.4l-4 3.1ZM11.2 9.5 7.2 6.3V2.9l4 3.2ZM12.8 9.5l4-3.2V2.9l-4 3.2Z' },
  ore: { label: 'Ore', terrain: 'Mountains', color: '#9aa1b8', deep: '#5f657c', glyph: 'M12 2.5 20.5 10 12 21.5 3.5 10Zm0 3.2L7.4 10 12 17l4.6-7Z' },
};
export const COMMODITY_META: Record<Commodity, TerrainMeta> = {
  paper: { label: 'Paper', color: '#efe3bf', deep: '#a8935f', glyph: 'M6 3h9l4 4v14H6Zm2 2v14h9V8h-3V5Zm2 7h5v1.6h-5Zm0 3h5v1.6h-5Z' },
  cloth: { label: 'Cloth', color: '#cf95dc', deep: '#8a4f9c', glyph: 'M4 5h16v4.5c-2.6 0-2.6 2.5 0 2.5V19H4v-7c2.6 0 2.6-2.5 0-2.5Zm3 3v8h10V8Z' },
  coin: { label: 'Coin', color: '#ffd24a', deep: '#b58a15', glyph: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm-1 2h2v1.2c1.3.3 2 1.1 2 2.3h-1.8c0-.6-.4-.9-1.2-.9s-1.2.3-1.2.8c0 .5.4.7 1.6 1 1.9.4 2.8 1.1 2.8 2.5 0 1.2-.8 2-2.2 2.3V18h-2v-1.3c-1.4-.3-2.2-1.2-2.2-2.5h1.8c0 .7.5 1 1.4 1 .8 0 1.3-.3 1.3-.8 0-.6-.5-.8-1.7-1.1-1.8-.4-2.7-1.1-2.7-2.4 0-1.2.8-2 2.1-2.3Z' },
};
export const GOOD_META: Record<Good, TerrainMeta> = { ...RESOURCE_META, ...COMMODITY_META };
export const TERRAIN_META: Record<Tile['terrain'], TerrainMeta> = {
  ...(Object.fromEntries(RESOURCES.map(resource => [resource, { ...RESOURCE_META[resource], label: RESOURCE_META[resource].terrain }])) as unknown as Record<Resource, TerrainMeta>),
  desert: { label: 'Desert', color: '#e9d5a4', deep: '#c3ac78', glyph: 'M3 17c3-4 6-4 9 0 3-4 6-4 9 0v2H3Z' },
  gold: { label: 'Gold field', color: '#f2a93a', deep: '#c47f1c', glyph: 'm12 2.5 2.6 6 6.4.6-4.8 4.3 1.4 6.3L12 16.4l-5.6 3.3 1.4-6.3L3 9.1l6.4-.6Z' },
  sea: { label: 'Sea', color: '#2b8ccb', deep: '#175d92', glyph: 'M2 14c3-3 5-3 8 0s5 3 8 0l4-4v4c-3 3-5 3-8 0s-5-3-8 0l-4 4Z' },
  fog: { label: 'Unexplored', color: '#9aa3b5', deep: '#6b7385', glyph: 'M12 3a6 6 0 0 1 6 6c0 2.6-1.8 3.6-3.2 4.4-.9.5-1.3.9-1.3 2.1h-3c0-2.6 1.2-3.5 2.6-4.3 1.1-.6 1.9-1.1 1.9-2.2a3 3 0 0 0-6 0H6a6 6 0 0 1 6-6Zm-1.5 14.5h3v3h-3Z' },
  spice: { label: 'Spice island', color: '#e07a5f', deep: '#a9503c', glyph: 'M9 3h6v3h-1v2.2c2.4.9 4 3.1 4 5.8v7H6v-7c0-2.7 1.6-4.9 4-5.8V6H9Zm3 7a3 3 0 0 0-3 3v1h6v-1a3 3 0 0 0-3-3Z' },
  shoal: { label: 'Fishing shoal', color: '#6cc3e8', deep: '#3a8fb8', glyph: 'M3 12c3-3 5-3 8 0s5 3 8 0l2 2c-3 3-6 3-9 0s-6-3-9 0Zm3 5a1.3 1.3 0 1 1 0 .1Zm6 0a1.3 1.3 0 1 1 0 .1Zm6 0a1.3 1.3 0 1 1 0 .1Z' },
  lake: { label: 'Lake', color: '#3b9ad8', deep: '#25689a', glyph: 'M4 12c4-5 8-5 12 0-1.5 1-3 1.6-4.5 1.8L15 17c-4 1.5-8 1-11-1.5 1.5-1.5 2.3-2.5 0-3.5Zm14-.5 3-2v5Z' },
  swamp: { label: 'Swamp', color: '#6b8a63', deep: '#41583d', glyph: 'M6 21v-9h1.6v9ZM11.2 21V6h1.6v15Zm5.2 0V10H18v11ZM3 21h18v-1.6H3Zm2-8.5c1-2 2-2 3 0-1 .6-2 .6-3 0Zm10-5c1-2 2-2 3 0-1 .6-2 .6-3 0Z' },
  oasis: { label: 'Oasis', color: '#7fc9a8', deep: '#4d8f74', glyph: 'M11.2 21V9h1.6v12Zm.8-13c-3-3.5-6-3.5-8-1 2.5 0 5 .5 8 1Zm0 0c3-3.5 6-3.5 8-1-2.5 0-5 .5-8 1Zm0 0c-1-3.5-1-6 1.5-8-.5 3-.5 5.5-1.5 8ZM4 21c2.5-2 5-2 8 0 3-2 5.5-2 8 0v1.6H4Z' },
  castle: { label: 'Castle', color: '#b9a58a', deep: '#7d6b52', glyph: 'M4 21V8h3V5h2v3h2V5h2v3h2V5h2v3h3v13h-6v-5h-4v5Z' },
  quarry: { label: 'Quarry', color: '#a99d95', deep: '#6f645c', glyph: 'M3 20h18v-2H3Zm1-4h7v-5H4Zm9 0h7v-5h-7ZM7 9h10V4H7Z' },
  glassworks: { label: 'Glassworks', color: '#b7d8e8', deep: '#6d9bb4', glyph: 'M10 3h4v2h-1v3.5l5.5 8.5c.8 1.3-.1 3-1.6 3H7.1c-1.5 0-2.4-1.7-1.6-3L11 8.5V5h-1Zm2 8-3.6 6h7.2Z' },
};
export const TRACK_META: Record<Track, { label: string; color: string; deep: string; metropolis: string }> = {
  science: { label: 'Science', color: '#78d955', deep: '#3f8f2a', metropolis: 'Aqueduct' },
  trade: { label: 'Trade', color: '#ffd24a', deep: '#b58a15', metropolis: 'Market' },
  politics: { label: 'Politics', color: '#28c6e7', deep: '#12789a', metropolis: 'Fortress' },
};
export const MISSION_META: Record<Mission, { label: string; blurb: string }> = {
  lairs: { label: 'Pirate lairs', blurb: 'Land crews to capture pirate camps.' },
  fish: { label: 'Fish for Catan', blurb: 'Ferry fish from the shoals home.' },
  spices: { label: 'Spice trade', blurb: 'Bring spices from island villages.' },
};
export const PROGRESS_LABEL: Record<ProgressKind, string> = { alchemy: 'Alchemist', crane: 'Crane', engineering: 'Engineer', invention: 'Inventor', irrigation: 'Irrigation', medicine: 'Medicine', mining: 'Mining', printing: 'Printer', 'road-building': 'Road Building', smithing: 'Smith', 'commercial-harbor': 'Commercial Harbor', 'guild-dues': 'Master Merchant', merchant: 'Merchant', 'merchant-fleet': 'Merchant Fleet', 'resource-monopoly': 'Resource Monopoly', 'trade-monopoly': 'Trade Monopoly', diplomacy: 'Diplomat', espionage: 'Spy', encouragement: 'Bishop', intrigue: 'Intrigue', taxation: 'Deserter', constitution: 'Constitution', treason: 'Warlord', wedding: 'Wedding', sabotage: 'Saboteur' };
export const DEV_META: Record<DevKind, { label: string; blurb: string }> = {
  knight: { label: 'Knight', blurb: 'Move the robber (or pirate) and steal one card. Counts toward Largest Army.' },
  'road-building': { label: 'Road Building', blurb: 'Place two free roads or ships right away.' },
  plenty: { label: 'Year of Plenty', blurb: 'Take any two resources from the bank.' },
  monopoly: { label: 'Monopoly', blurb: 'Name a resource. Everyone hands you all of theirs.' },
  victory: { label: 'Victory Point', blurb: 'A hidden point. It counts toward your total automatically.' },
  'swift-journey': { label: 'Swift Journey', blurb: 'Move your wagon a second time this turn. The extra move appears as a delivery action after your first move.' },
};
export const PIECE_LABEL = { road: 'Road', ship: 'Ship', settlement: 'Settlement', city: 'City', harbor: 'Harbor settlement' } as const;
export const CARGO_META = { settler: { label: 'Settlers', color: '#fff6e5' }, crew: { label: 'Crew', color: '#2b2540' }, fish: { label: 'Fish', color: '#6cc3e8' }, spice: { label: 'Spice', color: '#e07a5f' } } as const;
export const WAGON_CARGO = { tools: { label: 'Tools', color: '#9aa1b8' }, sand: { label: 'Sand', color: '#f0c24d' }, marble: { label: 'Marble', color: '#fff6e5' }, glass: { label: 'Glass', color: '#6cc3e8' } } as const;

export const pips = (n: number) => (n >= 2 && n <= 12 ? 6 - Math.abs(7 - n) : 0);
export const count = (hand: Hand, good: Good) => hand[good] ?? 0;
/** Commodities count wherever they exist in a hand; base hands simply lack those keys. */
export const handTotal = (hand: Hand) => GOODS.reduce((sum, good) => sum + count(hand, good), 0);
export const resourceTotal = (hand: Hand) => RESOURCES.reduce((sum, resource) => sum + count(hand, resource), 0);
export const canAfford = (hand: Hand, cost: Hand) => GOODS.every(good => count(hand, good) >= count(cost, good));
export const goodsIn = (hand: Hand) => GOODS.filter(good => count(hand, good) > 0);
/** A draft picked from a hand or bank must still fit once the hand changes underneath it. */
export const withinLimit = (value: Hand, limit: Hand, goods: readonly Good[] = GOODS) => goods.every(good => count(value, good) <= count(limit, good)) && GOODS.every(good => goods.includes(good) || count(value, good) === 0);
export const titleCase = (text: string) => text.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
export const describeHand = (hand: Hand) => goodsIn(hand).map(good => `${count(hand, good)} ${GOOD_META[good].label}`).join(', ') || 'nothing';
/** Goods a player may pick from: five resources, plus commodities when Cities & Knights is on. */
export const pickableGoods = (settings: Settings, resourcesOnly = false): readonly Good[] => resourcesOnly || !settings.citiesKnights ? RESOURCES : GOODS;
/** Pointy-top corners for a unit-radius hex; y grows downward on phones and toward the viewer on the host. */
export const hexCorners = (x: number, y: number, radius = 1) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i + 30); return [x + radius * Math.cos(a), y + radius * Math.sin(a)] as const; });
export const boardBounds = (board: Board) => {
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const tile of board.tiles) { box.minX = Math.min(box.minX, tile.x - 1); box.maxX = Math.max(box.maxX, tile.x + 1); box.minY = Math.min(box.minY, tile.y - 1); box.maxY = Math.max(box.maxY, tile.y + 1); }
  return Number.isFinite(box.minX) ? box : { minX: -4, maxX: 4, minY: -4, maxY: 4 };
};
/** Land-only centre; coastal signs are pushed away from it so they clear number tokens. */
export const boardCenter = (board: Board) => { const box = boardBounds({ ...board, tiles: board.tiles.filter(tile => tile.terrain !== 'sea') }); return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }; };
export const pushOutward = (center: { x: number; y: number }, x: number, y: number, distance: number) => { const dx = x - center.x, dy = y - center.y, length = Math.hypot(dx, dy); return length < .01 ? { x, y } : { x: x + dx / length * distance, y: y + dy / length * distance }; };
export type BoardIndex = { tiles: Map<string, Tile>; vertices: Map<string, Vertex>; edges: Map<string, Edge> };
export const indexBoard = (board: Board): BoardIndex => ({ tiles: new Map(board.tiles.map(t => [t.id, t])), vertices: new Map(board.vertices.map(v => [v.id, v])), edges: new Map(board.edges.map(e => [e.id, e])) });
export const edgeGeometry = (index: BoardIndex, edgeId: string) => {
  const edge = index.edges.get(edgeId), a = edge && index.vertices.get(edge.a), b = edge && index.vertices.get(edge.b);
  if (!edge || !a || !b) return null;
  return { edge, a, b, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle: Math.atan2(b.y - a.y, b.x - a.x), length: Math.hypot(b.x - a.x, b.y - a.y) };
};
/** Stable pseudo-random in [0,1) from an ID so decorative placement survives reloads. */
export function hashUnit(seed: string, salt = 0) { let h = 2166136261 ^ salt; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }

export const tileLabel = (tile: Tile) => tile.number ? `${TERRAIN_META[tile.terrain].label} ${tile.number}` : TERRAIN_META[tile.terrain].label;
export const vertexTiles = (index: BoardIndex, vertexId: string) => (index.vertices.get(vertexId)?.tiles ?? []).map(id => index.tiles.get(id)).filter((tile): tile is Tile => !!tile);
export const vertexLabel = (index: BoardIndex, vertexId: string) => { const tiles = vertexTiles(index, vertexId).filter(t => t.terrain !== 'sea'); return tiles.length ? tiles.map(tileLabel).join(', ') : 'open sea'; };
export const edgeLabel = (index: BoardIndex, edgeId: string) => { const edge = index.edges.get(edgeId); const tiles = (edge?.tiles ?? []).map(id => index.tiles.get(id)).filter((t): t is Tile => !!t && t.terrain !== 'sea'); return `${edge?.sea && !edge.land ? 'Sea lane' : edge?.sea ? 'Coast' : 'Path'} by ${tiles.length ? tiles.map(tileLabel).join(' and ') : 'open water'}`; };

export const playerOf = (view: PublicView, id: string | null | undefined) => view.players.find(player => player.id === id);
export const nameOf = (view: PublicView, id: string | null | undefined) => playerOf(view, id)?.name ?? 'Someone';
export const names = (view: PublicView, ids: readonly string[]) => ids.map(id => nameOf(view, id)).join(', ');
export const isConnect = (view: PublicView) => withDefaults(view.settings).mode === 'connect';
export const expansionPlayer = (view: PublicView, id: string) => view.expansions?.players.find(player => player.id === id);
/** One-line summary of the chosen systems for the brand chip, results and instructions. */
export function describeSettings(settings: Settings, short = false) {
  const parts = [settings.expansion === 'explorers' ? (short ? 'Explorers' : 'Explorers & Pirates') : settings.expansion === 'seafarers' ? 'Seafarers' : 'Base island'];
  if (settings.citiesKnights) parts.push(short ? 'C&K' : 'Cities & Knights');
  const scenarios = settings.scenarios ?? [];
  if (short && scenarios.length > 1) parts.push(`${scenarios.length} scenarios`); else for (const scenario of scenarios) parts.push(short ? SCENARIO_NAMES[scenario].replace(/^Traders & Barbarians: /, '') : SCENARIO_NAMES[scenario]);
  if (settings.expansion === 'explorers' && settings.missions?.length && settings.missions.length < MISSIONS.length) parts.push(`${settings.missions.length} mission${settings.missions.length === 1 ? '' : 's'}`);
  return parts.join(' + ');
}
export const trackLabel = (track: Track) => TRACK_META[track].label;
export const TRACK_LIST = TRACKS;

export type Step = { title: string; detail: string };
export function describeStep(view: PublicView): Step {
  const actor = nameOf(view, view.actorId), connect = isConnect(view), waiting = view.activeIds.length ? names(view, view.activeIds) : actor;
  switch (view.phase) {
    case 'setup': { const piece = PIECE_LABEL[view.setupPiece ?? 'settlement'].toLowerCase(), mine = view.buildings.filter(b => b.playerId === view.actorId).length, routes = view.routes.filter(r => r.playerId === view.actorId).length + (view.expansions?.explorers?.ships.filter(ship => ship.playerId === view.actorId).length ?? 0); return { title: `${actor} ${mine > routes ? 'chooses a road or ship' : `places a ${piece}`}`, detail: mine > routes ? `Routes must touch the new ${piece}.` : 'Corners must be two steps from any other settlement. Numbers near 6 and 8 produce most often.' }; }
    case 'roll': return { title: connect ? `Round ${view.turn} · Roll the dice` : `${actor} rolls the dice`, detail: view.settings.citiesKnights ? 'Matching numbers produce. The event die moves the barbarians or deals progress cards.' : 'Everyone with a settlement on a matching number collects. A 7 sends in the robber.' };
    case 'discard': return { title: `Too many cards · ${waiting}`, detail: 'Anyone holding more than seven cards discards half. Counts are public, cards stay private.' };
    case 'robber': return { title: `${actor} moves the ${view.pirate !== null ? 'robber or pirate' : 'robber'}`, detail: 'The blocked hex stops producing. One neighbour loses a random card.' };
    case 'gold': return { title: `Gold · ${waiting} choose resources`, detail: 'Gold fields pay in any resource you like.' };
    case 'choice': return { title: `${waiting} ${view.activeIds.length > 1 ? 'decide' : 'decides'}`, detail: view.activeIds.every(id => playerOf(view, id)?.cpu) ? 'The CPU is choosing. Play resumes automatically.' : 'A required choice is open on a player’s screen. Play resumes when it is confirmed.' };
    case 'movement': return { title: connect ? `Round ${view.turn} · Movement` : `${actor} moves`, detail: 'Building and trading are done; ships, wagons and knights move now. Cargo lands where a ship stops.' };
    case 'action': return connect ? { title: `Round ${view.turn} · Everyone trades and builds`, detail: `${view.readyIds.length} of ${view.players.length} ready. Confirmed placements win contested spots.` } : { title: `${actor} trades and builds${view.secondary ? ' · paired turn' : ''}`, detail: view.secondary ? 'Paired turn: bank trades, building and cards only. No player trades.' : 'Negotiate out loud, confirm on phones. Build to reach the target score.' };
    case 'ended': return { title: view.winners.length ? `${names(view, view.winners)} ${view.winners.length > 1 ? 'win' : 'wins'} the island!` : 'Game over', detail: `${withDefaults(view.settings).targetPoints} victory points reached.` };
  }
}

/** Phone drafts are scoped by room, round, player and the game-owned turn ID. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function readDraft<T>(storage: DraftStorage, key: string, turnId: number): T | null {
  try { const saved = JSON.parse(storage.getItem(key) ?? 'null'); return saved && saved.turnId === turnId && saved.draft ? saved.draft as T : null; } catch { return null; }
}
export function saveDraft<T>(storage: DraftStorage, key: string, turnId: number, draft: T | null) {
  try { if (draft === null) storage.removeItem(key); else storage.setItem(key, JSON.stringify({ turnId, draft })); } catch { /* Storage is an optional cache. */ }
}
