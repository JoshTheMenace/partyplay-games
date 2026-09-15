import type { Commodity, ExpansionAction, ExpansionPrivate, ExpansionPublic, Good, Mission, Scenario, Variant } from './expansion-model';
/** Browser-safe board and wire types. Hidden hands, deck order and RNG stay on the server. */
export const RESOURCES = ['wood', 'brick', 'wool', 'grain', 'ore'] as const;
export type Resource = typeof RESOURCES[number];
export type Hand = Record<Resource, number> & Partial<Record<Commodity, number>>;
export const emptyHand = (): Hand => ({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
export const COSTS = { road: { ...emptyHand(), wood: 1, brick: 1 }, ship: { ...emptyHand(), wood: 1, wool: 1 }, settlement: { ...emptyHand(), wood: 1, brick: 1, wool: 1, grain: 1 }, city: { ...emptyHand(), ore: 3, grain: 2 }, development: { ...emptyHand(), ore: 1, wool: 1, grain: 1 } };
export type Settings = { tableSize?: number; mode: 'standard' | 'connect'; expansion: 'base' | 'seafarers' | 'explorers'; roundSeconds: 60 | 90 | 120; targetPoints: number; citiesKnights?: boolean; scenarios?: Scenario[]; variants?: Variant[]; missions?: Mission[] };
export type Tile = { id: string; q: number; r: number; x: number; y: number; terrain: Resource | 'desert' | 'sea' | 'gold' | 'fog' | 'spice' | 'shoal' | 'lake' | 'swamp' | 'oasis' | 'castle' | 'quarry' | 'glassworks'; number: number; island: number };
export type Vertex = { id: string; x: number; y: number; tiles: string[]; edges: string[] };
export type Edge = { id: string; a: string; b: string; tiles: string[]; land: boolean; sea: boolean };
export type Board = { tiles: Tile[]; vertices: Vertex[]; edges: Edge[]; ports: { vertices: string[]; resource: Resource | 'any' }[] };
export type Route = { edge: string; playerId: string; kind: 'road' | 'ship' };
export type Building = { vertex: string; playerId: string; kind: 'settlement' | 'city' | 'harbor' };
export type DevKind = 'knight' | 'road-building' | 'plenty' | 'monopoly' | 'victory' | 'swift-journey';
export type Offer = { id: string; playerId: string; give: Hand; get: Hand; accepts: string[] };
export type GameEvent = { id: number; text: string; kind: 'roll' | 'build' | 'trade' | 'robber' | 'card' | 'phase'; playerId: string | null; target: string | null };
export type Phase = 'setup' | 'roll' | 'discard' | 'robber' | 'gold' | 'action' | 'choice' | 'movement' | 'ended';
export type PublicView = {
  setupPiece?: 'settlement' | 'city' | 'harbor'; expansions?: ExpansionPublic; settings: Settings; board: Board; revision: number; turnId: number; turn: number; phase: Phase;
  actorId: string; secondary: boolean; activeIds: string[]; readyIds: string[]; pausedPlayers: string[];
  deadline: number | null; dice: [number, number] | null; robber: string; pirate: string | null;
  routes: Route[]; buildings: Building[]; offers: Offer[]; events: GameEvent[];
  players: { id: string; name: string; color: string; cpu?: boolean; score: number; handCount: number; developmentCount: number; knights: number; longestRoute: number; connected: boolean; pieces: { roads: number; ships: number; settlements: number; cities: number } }[];
  longestOwner: string | null; armyOwner: string | null; deckCount: number; winners: string[];
};
export type PrivateView = {
  expansion?: ExpansionPrivate; bank: Hand; hand: Hand; development: { id: string; kind: DevKind; playable: boolean }[]; score: number;
  discardDue: number; goldDue: number; freeRoutes: number; canRoll: boolean; canAct: boolean; canEnd: boolean; canTrade: boolean;
  legal: { offers: string[]; roads: string[]; ships: string[]; settlements: string[]; cities: string[]; shipMoves: { from: string; to: string[] }[]; robber: string[]; pirate: string[]; victims: Record<string, string[]> };
  rates: Hand;
};
export type Action = { turnId: number } & (
  | ExpansionAction
  | { type: 'roll' | 'end' | 'buy-development' }
  | { type: 'build'; kind: 'road' | 'ship' | 'settlement' | 'city'; target: string }
  | { type: 'move-ship'; from: string; to: string }
  | { type: 'discard' | 'gold'; cards: Hand }
  | { type: 'robber'; target: string; victim: string | null; pirate: boolean }
  | { type: 'bank'; give: Good; get: Good }
  | { type: 'offer'; give: Hand; get: Hand }
  | { type: 'accept-offer' | 'cancel-offer'; offerId: string }
  | { type: 'complete-offer'; offerId: string; partner: string }
  | { type: 'play-development'; cardId: string; resource?: Resource; cards?: Hand }
);
