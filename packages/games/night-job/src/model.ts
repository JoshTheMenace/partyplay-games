/** Browser-safe contract for Night Job. NPC placement and patrols live only in server-levels/. See DESIGN.md. */
export type Point = { x: number; y: number };
export type MissionId = 'velvet' | 'glasshouse' | 'ferry';
export type Role = 'cracker' | 'scout' | 'magpie' | 'ghost' | 'breacher' | 'impostor' | 'wire' | 'face';
export type Tool = 'smoke' | 'tranq' | 'shotgun' | 'emp' | 'medkit' | 'decoy';
export type Settings = { mission: MissionId; difficulty: 'normal' | 'relaxed' };
/** Held stick state. |x,y| ≤ 1; magnitude below SNEAK_STICK (or sneak) moves quietly. */
export type Input = Point & { sneak: boolean };
export type Action = { type: 'tool'; heistId: string };
export type Choice = { role: Role; tool: Tool };

/* ── authored level data (public) ─────────────────────────────────────────── */
export type Floor = 'carpet' | 'tile' | 'marble' | 'wood' | 'grass' | 'concrete' | 'asphalt' | 'deck' | 'checker';
export type Room = { name: string; x: number; y: number; w: number; h: number; floor: Floor; light: string; tint?: string };
export type PropKind =
  | 'desk' | 'chair' | 'table' | 'sofa' | 'bed' | 'shelf' | 'bookcase' | 'crate' | 'barrel' | 'plant' | 'tree' | 'statue' | 'rug' | 'bar'
  | 'piano' | 'slot' | 'roulette' | 'cards' | 'counter' | 'locker' | 'fountain' | 'car' | 'van' | 'boat' | 'lamp' | 'painting' | 'server' | 'bench' | 'flowerbed' | 'container';
export type Prop = { kind: PropKind; x: number; y: number; w: number; h: number; rot: number; solid: boolean };
export type ObjectKind = 'door' | 'window' | 'safe' | 'terminal' | 'camera' | 'laser' | 'objective' | 'exit' | 'medkit' | 'hide' | 'vent';
/** x,y is the cell centre. facing is radians (0 = +x, π/2 = +y). */
export type MapObject = Point & { id: string; kind: ObjectKind; label: string; locked?: boolean; circuit?: string; facing?: number; pair?: string; horizontal?: boolean };
export type LegendEntry = { kind: ObjectKind; label?: string; circuit?: string; facing?: number | 'N' | 'E' | 'S' | 'W'; pair?: string };
export type LevelSource = {
  id: MissionId; title: string; subtitle: string; briefing: string; objective: string; objectiveKind: 'ledger' | 'jewel' | 'manifest';
  parTimes: [number, number, number]; outdoor: Floor;
  grid: string[]; rooms: Room[]; props: [PropKind, number, number, number?, number?, number?][]; legend: Record<string, LegendEntry>;
};
export type HeistMap = Omit<LevelSource, 'grid' | 'props' | 'legend'> & {
  width: number; height: number;
  /** Structural tiles only: # % = ~ ' ' . , (objects replaced by their floor). */
  tiles: string[];
  props: Prop[]; objects: MapObject[]; coins: Point[]; spawns: Point[];
};

/* ── public view ──────────────────────────────────────────────────────────── */
export type Phase = 'infiltrate' | 'escape' | 'clear' | 'failed';
export type Work = { target: string; label: string; progress: number };
export type PlayerView = Point & {
  id: string; name: string; color: string; seat: number; role: Role; tool: Tool;
  health: number; coins: number; charges: number; facing: number;
  moving: boolean; running: boolean; down: boolean; connected: boolean; suspended: boolean; hidden: boolean; disguised: boolean; carrying: boolean;
  work: Work | null; hint: string;
};
export type NpcKind = 'guard' | 'dog' | 'civilian';
export type NpcState = 'patrol' | 'suspicious' | 'investigate' | 'chase' | 'search' | 'stunned' | 'charmed' | 'panic';
export type NpcView = Point & { id: string; kind: NpcKind; facing: number; state: NpcState; suspicion: number; aiming: Point | null; moving: boolean };
/** Scout/Wire intelligence seen through walls. */
export type Intel = Point & { kind: NpcKind | 'camera' | 'laser'; facing: number };
export type ObjectState = { id: string; state: 'ready' | 'open' | 'empty' | 'disabled' | 'used'; progress: number; until: number };
export type Smoke = Point & { radius: number; until: number; born: number };
export type Noise = Point & { radius: number; at: number; kind: 'step' | 'loud' | 'decoy' | 'scream' | 'alarm' };
export type Shot = { from: Point; to: Point; at: number; hit: boolean; kind: 'guard' | 'tranq' | 'shotgun' };
export type EffectKind = 'coin' | 'safe' | 'unlock' | 'hack' | 'rescue' | 'heal' | 'hurt' | 'down' | 'spotted' | 'takedown' | 'break' | 'smoke' | 'emp' | 'decoy' | 'objective' | 'charge' | 'alarm' | 'escape' | 'charm' | 'disguise';
/** player: the thief the effect concerns (phones use it for vibration). */
export type Effect = Point & { id: number; kind: EffectKind; at: number; label: string; player?: string };
export type CrewStats = { coins: number; spotted: number; takedowns: number; revives: number; downs: number; tools: number };
export type View = {
  heistId: string; mission: MissionId; phase: Phase; now: number; elapsed: number; message: string;
  players: PlayerView[]; npcs: NpcView[]; intel: Intel[];
  /** One char per map door/window object in HeistMap.objects order: c closed, o open, l locked, b broken. */
  doors: string;
  /** Cell indices (y * width + x) that became floor: dug walls, shattered glass. */
  broken: number[];
  /** One char per HeistMap.coins entry: 1 remaining, 0 taken. */
  coins: string;
  objects: ObjectState[]; objective: Point & { carrier: string | null; taken: boolean }; objectiveTaken: boolean;
  smoke: Smoke[]; noises: Noise[]; shots: Shot[]; effects: Effect[];
  alarm: (Point & { until: number }) | null;
  collected: number; totalLoot: number; stats: Record<string, CrewStats>;
};

/* ── metadata and tuning ──────────────────────────────────────────────────── */
export const ROLES: Record<Role, { name: string; color: string; icon: string; description: string }> = {
  cracker: { name: 'Cracker', color: '#53bcff', icon: '◇', description: 'Locks, safes and the objective go three times faster.' },
  scout: { name: 'Scout', color: '#ff675f', icon: '◎', description: 'Stand still or sneak to sense guards through walls.' },
  magpie: { name: 'Magpie', color: '#ffd65a', icon: '✦', description: 'A bird companion grabs coins around you.' },
  ghost: { name: 'Ghost', color: '#f888cd', icon: '✧', description: 'Walk into an unaware guard to knock them out.' },
  breacher: { name: 'Breacher', color: '#b196ff', icon: '▥', description: 'Dig through cracked walls and force locked doors. Noisy.' },
  impostor: { name: 'Impostor', color: '#7be0ce', icon: '◈', description: 'Disguised as staff. Guards barely notice you unless you run.' },
  wire: { name: 'Wire', color: '#99dc65', icon: 'ϟ', description: 'Hacks terminals fast and senses cameras through walls.' },
  face: { name: 'Face', color: '#ffb16c', icon: '♡', description: 'Charms a nearby guard into following you. Revives fast.' },
};
export const TOOLS: Record<Tool, { name: string; icon: string; description: string }> = {
  smoke: { name: 'Smoke', icon: '◌', description: 'A cloud that blocks every line of sight.' },
  tranq: { name: 'Tranq', icon: '➶', description: 'Silently puts the guard ahead to sleep.' },
  shotgun: { name: 'Shotgun', icon: '✹', description: 'Knocks down everyone ahead. Very loud.' },
  emp: { name: 'EMP', icon: 'ϟ', description: 'Shuts down nearby cameras, lasers and radios.' },
  medkit: { name: 'Medkit', icon: '+', description: 'Heals and revives teammates around you.' },
  decoy: { name: 'Decoy', icon: '♪', description: 'Throws a noisemaker that lures guards.' },
};
export const MISSIONS: Record<MissionId, { title: string; subtitle: string }> = {
  velvet: { title: 'The Velvet Ledger', subtitle: 'A casino. A crooked ledger. One way out.' },
  glasshouse: { title: 'Glasshouse Exchange', subtitle: 'Lift the prism jewel from the conservatory.' },
  ferry: { title: 'Last Ferry', subtitle: 'Steal the manifest. Make the last boat.' },
};
export const DEFAULT_CHOICE: Choice = { role: 'cracker', tool: 'smoke' };
export const neutralInput = (): Input => ({ x: 0, y: 0, sneak: false });

export const SNEAK_STICK = .6;
export const SPEED = { run: 3.4, sneak: 1.6, carry: .85, guardPatrol: 1.2, guardSearch: 1.8, guardChase: 3.1, dog: 3.6, civilian: 1.0, panic: 2.6 } as const;
export const RADIUS = { actor: .3, interact: .9, exit: 1.8, crewSight: 10, stepNoise: 3, loudNoise: 14, scream: 6, decoyNoise: 8 } as const;
export const SIGHT = { guardRange: 7, guardHalfAngle: 50 * Math.PI / 180, near: 1.2, cameraRange: 6, cameraHalfAngle: 30 * Math.PI / 180, cameraSweep: 40 * Math.PI / 180, cameraPeriod: 6000, civilianRange: 6, shootRange: 6.5 } as const;
/** Seconds of work per interaction before role multipliers. */
export const WORK = { lock: 3, safe: 5, terminal: 3, objective: 1.5, pickup: .5, window: 1, vent: .6, hide: .3, medkit: 1, revive: 2.5, dig: 1.5, force: 1.2 } as const;
export const TIMING = { doorClose: 2500, aim: 700, shotCooldown: 1300, search: 8000, alarm: 15000, circuitOff: 20000, smoke: 8000, emp: 12000, suspend: 15000, disguise: 6000, charm: 20000, charmCooldown: 10000, stepEvery: 400 } as const;
export const DAMAGE = { shot: 34, bite: 25 } as const;
export const COIN_PENALTY = 3;
export const SAFE_COINS = 8;
export const COINS_PER_CHARGE = 10;
export const MAX_CHARGES = 9;
export const WALL_HEIGHT = 1.6;
export const WINDOW = { sill: .58, head: 1.56 } as const;
/** Security camera heading at server time `now`; each camera's phase comes from its position so they desynchronise. */
export const cameraAngle = (o: Point & { facing?: number }, now: number) => (o.facing ?? 0) + SIGHT.cameraSweep * Math.sin(2 * Math.PI * now / SIGHT.cameraPeriod + o.x * 1.7 + o.y * .9);
/** Stars earned by a clear: one per parTimes entry the adjusted time beats (parTimes are loosest first). */
export const starsFor = (parTimes: readonly number[], adjustedSeconds: number, cleared: boolean) => cleared ? parTimes.filter(par => adjustedSeconds <= par).length : 0;
