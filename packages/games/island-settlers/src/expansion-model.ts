import type { Hand, Resource } from './model';

export const COMMODITIES = ['paper', 'cloth', 'coin'] as const;
export type Commodity = typeof COMMODITIES[number];
export type Good = Resource | Commodity;
export const TRACKS = ['science', 'trade', 'politics'] as const;
export type Track = typeof TRACKS[number];
export type Improvements = Record<Track, number>;
export const SCENARIOS = ['fishing', 'rivers', 'caravans', 'barbarian-attack', 'traders'] as const;
export type Scenario = typeof SCENARIOS[number];
export const VARIANTS = ['friendly-robber', 'harbormaster'] as const;
export type Variant = typeof VARIANTS[number];
export const MISSIONS = ['lairs', 'fish', 'spices'] as const;
export type Mission = typeof MISSIONS[number];
export type ProgressKind = 'alchemy' | 'crane' | 'engineering' | 'invention' | 'irrigation' | 'medicine' | 'mining' | 'printing' | 'road-building' | 'smithing' | 'commercial-harbor' | 'guild-dues' | 'merchant' | 'merchant-fleet' | 'resource-monopoly' | 'trade-monopoly' | 'diplomacy' | 'espionage' | 'encouragement' | 'intrigue' | 'taxation' | 'constitution' | 'treason' | 'wedding' | 'sabotage';
export type Knight = { id: string; playerId: string; vertex: string; strength: 1 | 2 | 3; active: boolean };
export type Cargo = { kind: 'settler' | 'crew' | 'fish' | 'spice'; source: string };
export type ExpeditionShip = { id: string; playerId: string; edge: string; cargo: Cargo[]; remaining: number };
export type Wagon = { playerId: string; vertex: string; level: number; remaining: number; cargo: 'tools' | 'sand' | 'marble' | 'glass' | null; delivered: number };
export type Choice = { value: string; label: string };
/** Server-provided legal choices. The phone edits a draft; the server revalidates on confirmation. */
export type CommandField = { key: string; label: string; options: Choice[]; map?: 'vertex' | 'edge' | 'tile'; optional?: boolean };
export type ExpansionCommand = {
  id: string; group: 'Cities' | 'Knights' | 'Progress' | 'Fishing' | 'Rivers' | 'Caravans' | 'Barbarians' | 'Deliveries' | 'Expeditions' | 'Choice';
  label: string; detail: string; fields: CommandField[]; cost?: Hand;
  cards?: { label: string; available: Hand; min: number; max: number; allowed: Good[] };
};
export type ExpansionAction = { type: 'expansion'; command: string; choices: Record<string, string>; cards?: Hand };
export type ExpansionPrivate = {
  movement: boolean; hasMovement: boolean; commands: ExpansionCommand[]; task: string | null; progress: { id: string; kind: ProgressKind; track: Track }[];
  fish: { id: string; value: number }[]; coins: number; improvements: Improvements;
};
export type ExpansionPublic = {
  knights: Knight[]; walls: string[]; metropolises: { track: Track; vertex: string; playerId: string }[];
  barbarian: { position: number; attacks: number; event: Track | 'barbarian' | null } | null;
  merchant: { tile: string; playerId: string } | null;
  players: { id: string; improvements: Improvements; progressCount: number; defenderPoints: number; coins: number; fishCount: number; prisoners: number; missions: Record<Mission, number> }[];
  fishing: { grounds: { id: string; vertices: string[]; numbers: number[] }[]; bootOwner: string | null } | null;
  rivers: { edges: string[]; bridgeSites: string[]; bridges: string[]; wealthiest: string | null; poorest: string[] } | null;
  caravans: { oasis: string; segments: { edge: string; from: string; to: string }[]; bids: { playerId: string; count: number; target: string }[] } | null;
  attack: { castle: string; barbarians: { tile: string; count: number }[]; guards: { id: string; playerId: string; edge: string; strength: number; active: boolean }[] } | null;
  deliveries: { depots: { tile: string; vertex: string; kind: 'castle' | 'quarry' | 'glassworks' }[]; barbarians: string[]; wagons: Wagon[] } | null;
  explorers: {
    ships: ExpeditionShip[]; harbors: { vertex: string; cargo: Cargo[] }[]; council: string[]; pirateOwner: string | null;
    lairs: { tile: string; captured: boolean; crews: string[] }[]; shoals: { tile: string; number: number; fish: boolean }[];
    spices: { tile: string; benefit: 'speed' | 'pirate' | 'gold'; visitors: string[] }[]; missionOwners: Record<Mission, string | null>;
  } | null;
  harborOwner: string | null; event: string | null;
};
