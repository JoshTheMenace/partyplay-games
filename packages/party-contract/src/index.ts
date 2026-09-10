/** Stable, dependency-free game API. Server state must never cross this boundary. */
export const CONTRACT_VERSION = '1.0' as const;
export const MAX_MESSAGE_BYTES = 32 * 1024;
export const MAX_SAVE_BYTES = 256 * 1024;
export type SnapshotCachePolicy = { revisionField: string; fields: readonly string[]; keyedPairsFields?: readonly string[] };
export type PlayerId = string;
export type GameManifest = {
  contractVersion: '1.0'; id: string; title: string; description: string; assetBase: string;
  modes: readonly ('shared-display' | 'phones-only')[];
  players: { min: number; max: number };
  orientation: { controller: 'portrait' | 'landscape' | 'any'; personalView: 'portrait' | 'landscape' | 'any' };
  timing: 'realtime' | 'turn-based'; input: readonly ('state' | 'action')[];
  privatePlayerViews: boolean; supportsSolo: boolean;
  sessionControls?: readonly ('save' | 'finish')[];
  snapshotCache?: SnapshotCachePolicy;
  simulation?: { stepHz: number; snapshotHz: number; maxCatchUpSteps: number };
};
export type RoundContext = { roomId: string; roundId: string; players: readonly { id: PlayerId; name: string; color: string }[]; seed: number; nowMs: number };
export type ViewContext = { nowMs: number; phase: 'preparing' | 'playing' | 'results' };
export type Outcome = { complete: boolean; winners: PlayerId[]; rows: { playerId: PlayerId; score?: number; rank?: number; label?: string }[] };
export type GameRules<State, Input, Action, Settings, PublicView, PrivateView> = {
  validateSettings(raw: unknown): Settings; parseInput(raw: unknown): Input; parseAction(raw: unknown): Action;
  create(ctx: RoundContext, settings: Settings): State; neutralInput(): Input;
  applyAction(state: State, playerId: PlayerId, action: Action, nowMs: number): void;
  tick(state: State, inputs: ReadonlyMap<PlayerId, Input>, dtSeconds: number, nowMs: number): void;
  onPresenceChange(state: State, playerId: PlayerId, connected: boolean, nowMs: number): void;
  publicView(state: State, ctx: ViewContext): PublicView; playerView(state: State, playerId: PlayerId, ctx: ViewContext): PrivateView;
  exportSave?(state: State): unknown;
  loadSave?(ctx: RoundContext, raw: unknown, currentSettings: Settings): { state: State; settings: Settings };
  finish?(state: State, nowMs: number): void;
  outcome(state: State): Outcome; dispose(state: State): void;
};
export type ActionResult = { accepted: boolean; reason?: string };
export type GameClientContext<Input, Action, PublicView, PrivateView> = {
  roomId: string; roundId: string; playerId: string | null; viewRole: 'display' | 'controller' | 'personal'; isHost: boolean;
  publicView: PublicView; privateView: PrivateView | null; connected?: boolean;
  serverNowMs(): number; setInput(input: Input): void; releaseInput?(): void; sendAction(action: Action): Promise<ActionResult>; assetsReady(): void;
};
export type DrawingPoint = { x: number; y: number };
export type DrawingStroke = { color: string; width: number; points: DrawingPoint[] };
export type Drawing = { strokes: DrawingStroke[] };
export const DRAWING_COLORS = ['#05071a', '#ff5748', '#28c6e7', '#78d955', '#b58aff', '#ffd24a'] as const;
export const DRAWING_LIMITS = { strokes: 24, points: 480, widthMin: 0.003, widthMax: 0.04 } as const;
export function parseDrawing(raw: unknown): Drawing {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Drawing).strokes)) throw new Error('Drawing must contain strokes.');
  const strokes = (raw as Drawing).strokes;
  if (strokes.length > DRAWING_LIMITS.strokes) throw new Error('Too many drawing strokes.');
  let count = 0;
  return { strokes: strokes.map(stroke => {
    if (!stroke || !DRAWING_COLORS.includes(stroke.color as typeof DRAWING_COLORS[number]) || !Number.isFinite(stroke.width) || stroke.width < 0.003 || stroke.width > 0.04 || !Array.isArray(stroke.points) || !stroke.points.length) throw new Error('Invalid drawing stroke.');
    count += stroke.points.length;
    if (count > DRAWING_LIMITS.points) throw new Error('Drawing is too detailed.');
    return { color: stroke.color, width: stroke.width, points: stroke.points.map(point => {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new Error('Invalid drawing point.');
      return { x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 };
    }) };
  }) };
}
