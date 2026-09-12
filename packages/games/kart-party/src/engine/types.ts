export type TrackId = 'coast' | 'canyon' | 'midnight' | 'rainbow';
export type SpeedClass = 50 | 100 | 150 | 200;
export type Item = 'boost' | 'shell' | 'banana' | 'shield' | 'pulse' | 'triple' | 'oil' | 'frost' | 'magnet' | 'star' | 'rocket' | 'decoy';
export type Phase = 'countdown' | 'racing' | 'results';
export type Input = { steer: number; throttle: boolean; brake: boolean; drift: boolean; use: boolean };
export const NEUTRAL: Input = { steer: 0, throttle: false, brake: false, drift: false, use: false };
export const MAX_PLAYERS = 10;
export const DEFAULT_GRID_SIZE = 8;
export const DRIVERS = [
  { name: 'Ember', color: '#ff5748', accent: '#ffdf64', animal: 'fox' },
  { name: 'Splash', color: '#28c6e7', accent: '#e7ffff', animal: 'penguin' },
  { name: 'Clover', color: '#78d955', accent: '#ffe2b1', animal: 'frog' },
  { name: 'Nova', color: '#b58aff', accent: '#ffbdf0', animal: 'cat' },
  { name: 'Sunny', color: '#ffd24a', accent: '#fff3b0', animal: 'duck' },
  { name: 'Rose', color: '#ff7bb7', accent: '#ffe9f3', animal: 'rabbit' },
  { name: 'Bolt', color: '#5488ff', accent: '#b8e9ff', animal: 'bear' },
  { name: 'Pepper', color: '#ff974f', accent: '#f3e6da', animal: 'raccoon' },
  { name: 'Frost', color: '#d6f4ff', accent: '#80c9de', animal: 'fox' },
  { name: 'Jade', color: '#1ca993', accent: '#c8f5d5', animal: 'rabbit' },
] as const;
export type Racer = {
  loopDistance?:number; loopOffset?:number;
  id: string; name: string; driver: number; bot: boolean;
  x: number; z: number; y:number; verticalSpeed:number; airborne:boolean; rampCooldown:number; heading: number; speed: number; lateral: number;
  s: number; checkpoints: number; lap: number; rank: number; coins: number;
  frost: number; oil: number; magnet: number; star: number;
  drift: number; driftSide: number; boost: number; shield: number; stun: number;
  item: Item | null; itemCooldown: number; finishTime: number | null;
  lastUse: boolean; offroad: boolean; connected: boolean; distance: number; wallTime: number; coinsTaken: number[];
};
export type Hazard = { s?:number; offset?:number; id: number; kind: 'shell' | 'banana' | 'oil' | 'frost' | 'rocket' | 'decoy'; owner: string; x: number; z: number; heading: number; life: number; target?: string; affected?: string[] };
export type RaceEvent = { id: number; type: 'boost' | 'hit' | 'item' | 'coin' | 'finish' | 'lap'; racer: string; time: number; lap?: number };
export type Race = {
  viewMode?: 'tv' | 'personal';
  startId?: string; startAt?: number | null;
  track: TrackId; speedClass: SpeedClass; phase: Phase; time: number; countdown: number; laps: number;
  racers: Racer[]; hazards: Hazard[]; events: RaceEvent[]; seed: number; serial: number;
  firstFinish: number | null; firstHumanFinish: number | null; difficulty: 'easy' | 'normal' | 'hard';
};
export type Player = { id: string; name: string; driver: number; connected: boolean; ready: boolean };
export type RoomView = { code: string; host: string; hostPlays?:boolean; players: Player[]; track: TrackId; laps: number; speedClass: SpeedClass; difficulty: Race['difficulty']; race: Race | null };
export type Session = { room: RoomView; playerId: string; token: string; role: 'host' | 'player' | 'display' };
export type RaceOptions = { track: TrackId; laps?: number; speedClass?: SpeedClass; difficulty?: Race['difficulty']; players: { id: string; name: string; driver: number }[]; seed?: number };
