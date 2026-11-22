import type { Settings, Input, Action, Feed, Roster } from './model';
/** One arena of up to eight seats. */
export class Engine {
  /** `phase` (0–1) offsets this arena's periodic paint baselines from the other arenas'; `world` is another arena's static stage to share. */
  constructor(roster: Roster[], settings: Settings, seed: number, phase?: number, world?: unknown);
  readonly world: unknown;
  roster: Roster[]; ink: string; inkSequence: number; baselines: number; ticks: number;
  readonly result: Feed['result']; readonly state: string; readonly time: number;
  tick(inputs: ReadonlyMap<string, Input>, dt: number, elapsed?: number): void;
  presence(id: string, connected: boolean): void;
  action(id: string, action: Action): void;
  rebaseline(): void;
  stats(): number[][];
  coverage(): number[];
  feed(): Feed;
  dispose(): void;
}
