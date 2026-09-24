import { DEFAULT_SETTINGS, MAX_FIGHTERS, isFighterKind, type CpuLevel, type LobbyChoice, type Settings } from '../model';
import { STAGE_IDS, type StageId } from '../stages';
/** Pure lobby helpers. Every screen derives from the roster's public lobbyChoice, so a reloaded phone resumes its draft. */
type Seat = { id: string; lobbyChoice?: unknown };
export type StagePick = StageId | 'random';
export const EMPTY_CHOICE: LobbyChoice = { fighter: null, costume: 0, stage: null };
const isStage = (v: unknown): v is StageId => (STAGE_IDS as readonly unknown[]).includes(v);
export function readChoice(raw: unknown): LobbyChoice {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fighter = c.fighter === 'random' || isFighterKind(c.fighter) ? c.fighter : null;
  const stage = c.stage === 'random' || isStage(c.stage) ? c.stage : null;
  const costume = typeof c.costume === 'number' && Number.isInteger(c.costume) && c.costume >= 0 && c.costume < 4 && fighter !== 'random' ? c.costume : 0;
  return { fighter, costume, stage };
}
export const isComplete = (c: LobbyChoice) => c.fighter !== null && c.stage !== null;
export const pickFighter = (c: LobbyChoice, fighter: LobbyChoice['fighter']): LobbyChoice => ({ ...c, fighter, costume: fighter === c.fighter && fighter !== 'random' ? c.costume : 0 });
export const pickCostume = (c: LobbyChoice, costume: number): LobbyChoice => ({ ...c, costume: c.fighter && c.fighter !== 'random' ? Math.max(0, Math.min(3, Math.floor(costume))) : 0 });
export const pickStage = (c: LobbyChoice, stage: LobbyChoice['stage']): LobbyChoice => ({ ...c, stage });
/** When the host fixed the stage, Ready still sends a complete choice. */
export const readyChoice = (c: LobbyChoice, voting: boolean): LobbyChoice => voting || c.stage ? c : { ...c, stage: 'random' };
/** Which step a (re)loaded phone opens on. */
export const firstStep = (c: LobbyChoice, voting: boolean): 'fighter' | 'stage' => c.fighter && voting ? 'stage' : 'fighter';
export function voteCounts(players: readonly Seat[]) {
  const counts = Object.fromEntries([...STAGE_IDS, 'random'].map(id => [id, 0])) as Record<StagePick, number>;
  for (const p of players) { const s = readChoice(p.lobbyChoice).stage; if (s) counts[s] += 1; }
  return counts;
}
/** Stages with the most votes (several on a tie; empty before anyone votes). The engine breaks ties by seed. */
export function leaders(players: readonly Seat[]): StagePick[] {
  const counts = voteCounts(players), max = Math.max(...Object.values(counts));
  return max ? (Object.keys(counts) as StagePick[]).filter(id => counts[id] === max) : [];
}
/** Costumes other seats already picked for the same fighter. */
export function takenCostumes(players: readonly Seat[], me: string | null, fighter: LobbyChoice['fighter']) {
  const taken = new Set<number>(); if (!fighter || fighter === 'random') return taken;
  for (const p of players) if (p.id !== me) { const c = readChoice(p.lobbyChoice); if (c.fighter === fighter) taken.add(c.costume); }
  return taken;
}
export const TIME_OPTIONS = [0, 120, 180, 300, 480, 600] as const;
export const timeLabel = (seconds: number) => seconds ? `${seconds / 60} min` : 'No time limit';
export function readSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) } as Settings;
  return { ...s, cpuLevel: ([1, 2, 3].includes(s.cpuLevel) ? s.cpuLevel : 2) as CpuLevel };
}
/** CPU fighters the engine adds for this roster: capped at four fighters, and a lone human always gets one. */
export function cpuCount(humans: number, settings: Settings) {
  const cpus = Math.max(0, Math.min(settings.cpus, MAX_FIGHTERS - humans));
  return humans === 1 && cpus === 0 ? 1 : cpus;
}
export const rulesLine = (s: Settings) => [`${s.stocks} stock${s.stocks === 1 ? '' : 's'}`, timeLabel(s.seconds), s.teams ? 'Teams' : 'Free-for-all', s.hazards ? 'Hazards on' : 'Hazards off'].join(' · ');
