import type { RoundContext } from '../../../party-contract/src/index';
import type { Settings, Input, Action, PublicView, Roster } from './model';
export class Engine {
  constructor(players: RoundContext['players'], settings: Settings, seed: number, roundId?: string);
  roster: Roster[];
  tick(inputs: ReadonlyMap<string, Input>, dt: number, elapsed?: number): void;
  presence(id: string, connected: boolean): void;
  action(id: string, action: Action): void;
  view(): PublicView;
  dispose(): void;
}
