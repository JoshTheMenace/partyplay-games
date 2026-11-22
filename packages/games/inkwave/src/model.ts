export type Settings = { map: string; mode: 'turf' | 'zones' | 'boss'; time: 'day' | 'dusk'; duration: number; difficulty: 'easy' | 'normal' | 'hard' };
export type Input = { moveX: number; moveY: number; hasAim: boolean; yaw: number; pitch: number; aimX: number; aimY: number; aimZ: number; fire: boolean; squid: boolean; jump: boolean; sub: boolean; special: boolean; cheer: boolean };
export type Action = { turnId: string; type: 'superjump'; target: number } | { turnId: string; type: 'beacon'; target: number } | { turnId: string; type: 'strike'; x: number; z: number };
export type Choice = { weapon: string; sub: string | null; special: string | null; style: Record<string, number | string> };
/** `seat` is the player's index in the round (−1 for a CPU); `nid` is the actor's index inside its arena. */
export type Roster = Choice & { nid: number; id: string; name: string; owner: string; bot: boolean; team: number; slot: number; seat: number; arena: number };
export type ArenaResult = { winner: number; coverage: number[]; [key: string]: unknown };
export type Zones = { count: number[]; penalty: number[]; overtime: boolean; [key: string]: unknown };
/** One arena, one snapshot. `stats` per actor: turf, splats, splatted, specials, boss damage, weak-point hits, zone turf. */
export type Feed = {
  t: number; actors: number[][]; events: unknown[][]; eventBase: number; beacons: number[][]; time: number; state: string; coverage: number[];
  zones: Zones | null; boss: unknown[] | null; bossMoves: unknown[]; stats: number[][]; result: ArenaResult | null;
};
/** The scoreboard line of one arena: `count` in Zone Control, `boss` (HP fraction, phase) in Boss Battle, `winner` once decided. */
export type ArenaSummary = { state: string; time: number; coverage: number[]; count?: number[]; boss?: number[]; winner?: number };
/** `score` is what decided the room: mean turf share, arenas won (Zone Control) or bosses sunk and squads lost. */
export type RoomResult = { winner: number; tie: boolean; coverage: number[]; wins: number[]; arenas: { coverage: number[]; zones: Zones | null; stats: number[][]; result: ArenaResult }[] };
export type PublicView = {
  roundId: string; settings: Settings; colors: string[]; teams: string[]; roster: Roster[][];
  arenas: ArenaSummary[]; feature: number; live: Feed;
  /** The featured arena's newest paint baseline, for a screen that connects now; `fresh` is each retaken baseline, once. */
  revision: number; ink: string; inkSequence: number; fresh?: { ink: string; inkSequence: number }; result: RoomResult | null;
};
/** A seat's own arena when the room plays several; null in a one-arena room, where the public view is that arena. */
export type PrivateView = { arena: number; feed: Feed; ink?: string; inkSequence?: number } | null;
export const neutral = (): Input => ({ moveX: 0, moveY: 0, hasAim: false, yaw: 0, pitch: 0, aimX: 0, aimY: 0, aimZ: 0, fire: false, squid: false, jump: false, sub: false, special: false, cheer: false });
