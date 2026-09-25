/**
 * The typed module registry (ENGINE §14). Core code never names an expansion: it calls
 * `hooks(s, name)` and gets the active modules that implement that hook, in MODULE_IDS order.
 *
 * Helpers a module needs live next to the concept they touch: `seat`/`queueEffect` (state.ts),
 * `emit`/`inbox` (events.ts), `openPrompt` (prompts.ts), piece mutators (pieces.ts), card math
 * (cards.ts), command builders and `validateAnswer` (commands.ts), stats (stats.ts).
 */
import type {
  Badge, CardPicks, Command, DevKind, EdgeId, Good, HudItem, ModuleId, ModulePrivate, ModulePublic, Picks,
  RouteKind, ScorePart, SeatId, Settings, TileId, TimedStep, VertexId, Why, Building, Route, Unit,
} from '../../model';
import type { BoardDraft, GenContext } from '../board/types';
import type { Profile } from '../profile';
import type { Json, OpenPrompt, RollDraft, SetupStep, State } from '../state';
import { allModules } from './index';

/** A validated set of choices (see commands.ts `validateAnswer`). */
export type Answer = { picks: Picks; cards: CardPicks };

/** One prompt kind. Core registers discard, robber and gold; modules register `${id}/${key}`. */
export type PromptSpec = {
  /** Fields and options for the phone and the CPU. */
  command(s: State, p: OpenPrompt): Command;
  /** Runs after validateAnswer; the prompt is already closed. */
  apply(s: State, p: OpenPrompt, a: Answer): void;
  /** Always legal. */
  auto(s: State, p: OpenPrompt): Answer;
  /** Which preset entry sets the deadline. */
  timer: TimedStep;
  /** What happens at the deadline, shown on the phone ("Random discard"). */
  autoText: string;
  /** Public chip label ("Discarding"); defaults to "Choosing". */
  label?: string;
};

export type PlacedPiece =
  | { kind: 'building'; piece: Building } | { kind: 'route'; piece: Route } | { kind: 'unit'; piece: Unit };

export interface Module<X = unknown> {
  id: ModuleId;
  /** Rule switches applied in registry order before create. */
  profile?(p: Profile, s: Settings): void;
  /** Create-time only. Retypes tiles, adds features, hidden faces and noPorts. */
  board?: { decorate?(draft: BoardDraft, ctx: GenContext): void };
  /** Stored in s.ext[id]. Runs after the bank is stocked, so it may also set stock (`s.bank.paper = 12`). */
  init?(s: State): X;
  setupPlan?(plan: SetupStep[], s: State): SetupStep[];
  /** Replaces the base development deck (unshuffled) for this table size. */
  devDeck?(seats: number): DevKind[];

  // Production
  beforeProduce?(s: State, roll: RollDraft): void;
  produce?(s: State, roll: RollDraft): void;
  afterProduce?(s: State, roll: RollDraft): void;
  onSeven?(s: State, seat: SeatId | null): 'replace' | void;
  blocksTile?(s: State, tile: TileId): 'robber' | 'barbarians' | null;

  // Legality and economy
  legal?: {
    settlement?(s: State, seat: SeatId, v: VertexId): Why | null;
    route?(s: State, seat: SeatId, e: EdgeId, kind: RouteKind): Why | null;
    city?(s: State, seat: SeatId, v: VertexId): Why | null;
    robberTile?(s: State, seat: SeatId, t: TileId): Why | null;
    /** May this ship (at edge `from`) move now? Seafarers: not one built this turn. */
    shipMove?(s: State, seat: SeatId, from: EdgeId): Why | null;
  };
  /** May `thief` rob `victim` with the robber or pirate? Friendly Robber: not seats with 2 VP or less. */
  robbable?(s: State, thief: SeatId, victim: SeatId): boolean;
  rates?(s: State, seat: SeatId, rates: Record<Good, number>): void;
  /** Added to 7. */
  discardLimit?(s: State, seat: SeatId): number;

  // Commands and prompts
  /** Voluntary commands available now; each carries `module: id`. */
  commands?(s: State, seat: SeatId): Command[];
  apply?(s: State, seat: SeatId, commandId: string, a: Answer): void;
  /** Keys become `${id}/${key}`. */
  prompts?: Record<string, PromptSpec>;
  effects?: Record<string, (s: State, data: Json) => void>;

  // Lifecycle
  onBuild?(s: State, seat: SeatId, piece: PlacedPiece): void;
  onOpportunityStart?(s: State, seat: SeatId): void;
  onOpportunityEnd?(s: State, seat: SeatId): void;
  /** After a development card's own effect (Deliveries: a Knight moves a road barbarian). */
  onDevPlay?(s: State, seat: SeatId, kind: DevKind): void;

  // Scoring
  score?(s: State, seat: SeatId): ScorePart[];
  target?(s: State, seat: SeatId): number;
  awards?(s: State): void;
  routeWeight?(s: State, edge: EdgeId): number;
  blocksRoute?(s: State, seat: SeatId, v: VertexId): boolean;

  // Projections
  publicView?(s: State): ModulePublic[keyof ModulePublic];
  privateView?(s: State, seat: SeatId): ModulePrivate[keyof ModulePrivate];
  /** Generic TV widgets (left rail slot A). */
  hud?(s: State): HudItem[];
  /** Seat-rail badges (fish, coins, missions). */
  badges?(s: State, seat: SeatId): Badge[];
}

type WithHook<K extends keyof Module> = Module & Required<Pick<Module, K>>;

let byId: Map<ModuleId, Module> | null = null;
const activeCache = new WeakMap<readonly ModuleId[], Module[]>();

export const moduleById = (id: ModuleId): Module | undefined =>
  (byId ??= new Map(allModules().map(m => [m.id, m]))).get(id);

/** Active modules in registry order (s.modules is fixed at create, so this is cached). */
export function activeModules(ids: readonly ModuleId[]): Module[] {
  let list = activeCache.get(ids);
  if (!list) activeCache.set(ids, (list = allModules().filter(m => ids.includes(m.id))));
  return list;
}

/** Active modules implementing hook `name`: `for (const m of hooks(s, 'produce')) m.produce(s, roll)`. */
export function hooks<K extends keyof Module>(s: Pick<State, 'modules'>, name: K): WithHook<K>[] {
  return activeModules(s.modules).filter((m): m is WithHook<K> => m[name] !== undefined);
}

/** Module prompt spec for a `${module}/${key}` kind, if that module is active. */
export function modulePrompt(s: State, kind: string): PromptSpec | null {
  const slash = kind.indexOf('/');
  if (slash < 0) return null;
  const m = moduleById(kind.slice(0, slash) as ModuleId);
  return m && s.modules.includes(m.id) ? m.prompts?.[kind.slice(slash + 1)] ?? null : null;
}
