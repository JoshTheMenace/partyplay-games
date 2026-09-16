import type { RoundContext } from '../../../party-contract/src/index';
import type { Board, Building, DevKind, GameEvent, Hand, Offer, Phase, Route, Settings } from './model';
import type { ExpansionState } from './expansion-state';

export type Player = RoundContext['players'][number] & { cpu: boolean; hand: Hand; development: { id: string; kind: DevKind; bought: number }[]; turns: number; played: boolean; freeRoutes: number; moved: boolean; builtShips: string[]; knights: number; longestRoute: number; islands: number[]; connected: boolean; discardDue: number; goldDue: number };
export type State = {
  cpuAt: number; cpuCursor: number;
  modules: ExpansionState | null; settings: Settings; board: Board; players: Player[]; bank: Hand; deck: DevKind[]; random: number;
  routes: Route[]; buildings: Building[]; offers: Offer[]; events: GameEvent[]; serial: number; revision: number;
  phase: Phase; returnPhase: 'roll' | 'action'; actorId: string; primary: number; secondary: boolean; setupIndex: number; setupVertex: string | null;
  turnId: number; turn: number; deadline: number | null; actionStarted: number; readyIds: string[]; pausedAt: number | null; interruptedAt: number | null;
  dice: [number, number] | null; robber: string; pirate: string | null; longestOwner: string | null; armyOwner: string | null; winners: string[];
};
