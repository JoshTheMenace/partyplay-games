/** Browser-safe contracts. Hidden guard state and spawn schedules live in server-only files. */
export type Point = { x: number; y: number };
export type MissionId = 'velvet' | 'glasshouse' | 'ferry';
export type Role = 'cracker' | 'scout' | 'magpie' | 'ghost' | 'breacher' | 'impostor' | 'wire' | 'face';
export type Tool = 'smoke' | 'medkit' | 'tranq' | 'wrench' | 'emp' | 'shotgun';
export type Settings = { mission: MissionId; difficulty: 'normal' | 'relaxed' };
export type Input = Point & { sneak: boolean };
export type Action = { type: 'tool'; heistId: string; aim?: Point };
export type Choice = { role: Role; tool: Tool };
export type Room = { name: string; x: number; y: number; w: number; h: number; tone: string; floor: 'tile' | 'carpet' | 'wood' | 'garden' | 'concrete' };
export type Prop = Point & { kind: 'table' | 'chair' | 'plant' | 'sofa' | 'desk' | 'shelf' | 'crate' | 'statue' | 'rug' | 'water' | 'bar'; w?: number; h?: number };
export type MapObject = Point & { id: string; kind: 'door' | 'safe' | 'terminal' | 'camera' | 'laser' | 'objective' | 'exit' | 'medkit' | 'hide' | 'vent'; label: string; circuit?: string; facing?: number; target?: Point };
export type HeistMap = { id: MissionId; title: string; subtitle: string; briefing: string; objective: string; width: number; height: number; tiles: string[]; rooms: Room[]; props: Prop[]; objects: MapObject[]; loot: Point[]; spawns: Point[] };
export type ObjectView = MapObject & { state: 'ready' | 'open' | 'empty' | 'disabled'; until: number };
export type PlayerView = Point & { id: string; name: string; color: string; role: Role; tool: Tool; health: number; coins: number; charges: number; facingX: number; facingY: number; down: boolean; connected: boolean; suspended: boolean; hidden: boolean; disguised: boolean; work: { target: string; label: string; progress: number } | null };
export type GuardView = Point & { id: string; facing: number; alert: 'patrol' | 'suspicious' | 'chase' | 'search' | 'stunned'; suspicion: number; charmed: boolean };
export type Effect = Point & { id: number; kind: 'coin' | 'alarm' | 'smoke' | 'heal' | 'shot' | 'unlock' | 'rescue' | 'hack' | 'break'; at: number; label: string };
export type View = {
  heistId: string; mission: MissionId; phase: 'infiltrate' | 'escape' | 'clear' | 'failed'; now: number; elapsed: number;
  players: PlayerView[]; guards: GuardView[]; markers: Point[]; objects: ObjectView[]; loot: Point[];
  tiles: string[]; visible: number[]; smoke: (Point & { until: number; radius: number })[]; effects: Effect[];
  collected: number; totalLoot: number; objectiveTaken: boolean; alarm: boolean; message: string; adjustedSeconds: number;
};
export const ROLES: Record<Role, { name: string; color: string; icon: string; description: string }> = {
  cracker: { name: 'Cracker', color: '#53bcff', icon: '◇', description: 'Picks locks and opens safes three times faster.' },
  scout: { name: 'Scout', color: '#ff675f', icon: '◎', description: 'Stand still or sneak to sense guards beyond walls.' },
  magpie: { name: 'Magpie', color: '#ffd65a', icon: '✦', description: 'A nimble companion gathers nearby coins for you.' },
  ghost: { name: 'Ghost', color: '#f888cd', icon: '✧', description: 'Touch an unsuspecting guard to knock them out.' },
  breacher: { name: 'Breacher', color: '#b196ff', icon: '▥', description: 'Push against cracked walls to make noisy shortcuts.' },
  impostor: { name: 'Impostor', color: '#7be0ce', icon: '◈', description: 'Regains a disguise after staying out of sight.' },
  wire: { name: 'Wire', color: '#99dc65', icon: 'ϟ', description: 'Hacks terminals faster and keeps circuits disabled longer.' },
  face: { name: 'Face', color: '#ffb16c', icon: '♡', description: 'One nearby guard follows you peacefully. Rescues faster.' },
};
export const TOOLS: Record<Tool, { name: string; icon: string; description: string }> = {
  smoke: { name: 'Smoke', icon: '◌', description: 'Break sight with a cloud of smoke.' },
  medkit: { name: 'Medkit', icon: '+', description: 'Heal and revive nearby teammates.' },
  tranq: { name: 'Tranquilizer', icon: '➶', description: 'Quietly put a guard ahead to sleep.' },
  wrench: { name: 'Wrench', icon: '⚒', description: 'Complete the interaction in front of you instantly.' },
  emp: { name: 'EMP', icon: 'ϟ', description: 'Temporarily shut down security circuits.' },
  shotgun: { name: 'Shotgun', icon: '✹', description: 'Loudly knock down guards in a cone ahead.' },
};
export const MISSIONS: Record<MissionId, { title: string; subtitle: string }> = {
  velvet: { title: 'The Velvet Ledger', subtitle: 'A casino. A crooked ledger. One way out.' },
  glasshouse: { title: 'Glasshouse Exchange', subtitle: 'Steal the auction jewel under glass.' },
  ferry: { title: 'Last Ferry', subtitle: 'Lift the manifest. Make the last boat.' },
};
export const neutralInput = (): Input => ({ x: 0, y: 0, sneak: false });
export const DEFAULT_CHOICE: Choice = { role: 'cracker', tool: 'smoke' };

/** Shared detection geometry for authoritative sensing and its visible cues. */
export const SIGHT = { near: .85, guard: { range: 7, sneak: 5, wide: .45 }, camera: { range: 6, wide: .65 }, laser: { range: 5, wide: .985 } } as const;
