export type Settings = { map: string; mode: 'turf' | 'zones' | 'boss'; time: 'day' | 'dusk'; duration: number; difficulty: 'easy' | 'normal' | 'hard' };
export type Input = { moveX: number; moveY: number; hasAim: boolean; yaw: number; pitch: number; aimX: number; aimY: number; aimZ: number; fire: boolean; squid: boolean; jump: boolean; sub: boolean; special: boolean; cheer: boolean };
export type Action = { turnId: string; type: 'superjump'; target: number } | { turnId: string; type: 'beacon'; target: number } | { turnId: string; type: 'strike'; x: number; z: number };
export type Choice = { weapon: string; sub: string | null; special: string | null; style: Record<string, number | string> };
export type Roster = Choice & { nid: number; id: string; name: string; owner: string; bot: boolean; team: number; slot: number };
export type PublicView = {
  roundId: string; roster: Roster[]; colors: string[]; teams: string[]; actors: number[][]; events: unknown[][]; beacons: number[][];
  revision: number; ink: string; inkSequence: number; time: number; state: string; coverage: number[]; settings: Settings;
  boss: unknown[] | null; bossMoves: unknown[];
  zones: { count: number[]; penalty: number[]; overtime: boolean; [key: string]: unknown } | null;
  stats: { turf: number; splats: number; deaths: number; specials: number; bossDmg?: number; weakHits?: number; zoneTurf?: number }[];
  result: { winner: number; coverage: number[]; [key: string]: unknown } | null;
};
export const neutral = (): Input => ({ moveX: 0, moveY: 0, hasAim: false, yaw: 0, pitch: 0, aimX: 0, aimY: 0, aimZ: 0, fire: false, squid: false, jump: false, sub: false, special: false, cheer: false });
