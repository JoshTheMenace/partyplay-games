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
  prepareTimeoutMs?: number;
  snapshotCache?: SnapshotCachePolicy;
  simulation?: { stepHz: number; snapshotHz: number; maxCatchUpSteps: number };
};
export type RoundContext = { roomId: string; roundId: string; players: readonly { id: PlayerId; name: string; color: string; lobbyChoice?: unknown }[]; seed: number; nowMs: number };
export type ViewContext = { nowMs: number; phase: 'preparing' | 'playing' | 'results' };
export type Outcome = { complete: boolean; winners: PlayerId[]; rows: { playerId: PlayerId; score?: number; rank?: number; label?: string }[] };
export type GameRules<State, Input, Action, Settings, PublicView, PrivateView> = {
  validateSettings(raw: unknown): Settings; parseInput(raw: unknown): Input; parseAction(raw: unknown): Action;
  /** Public, per-seat setup. Validate incomplete drafts; require a complete choice when ready is true. */
  parseLobbyChoice?(raw: unknown, ready: boolean): unknown;
  validateStart?(players: RoundContext['players'], settings: Settings): void;
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
/** Pen by default. `erase` cuts through earlier ink; `fill` is a filled region whose rings each end on their first point. */
export type DrawingStroke = { color: string; width: number; points: DrawingPoint[]; tool?: 'erase' | 'fill' };
export type Drawing = { strokes: DrawingStroke[] };
/** The pad's palette. The first six keep their order: older content refers to them by index. Any #rrggbb is valid ink. */
export const DRAWING_COLORS = ['#05071a', '#ff5748', '#28c6e7', '#78d955', '#b58aff', '#ffd24a', '#ffffff', '#9aa0b8', '#4a4e69', '#ffd9b8', '#d9a066', '#8a5a33', '#4a2c1a', '#ff9a3c', '#ff7eb6', '#d6246e', '#8b1e3f', '#c9f04f', '#2e9b4f', '#14786e', '#3a6df0', '#1e2f8a', '#6d3fd9', '#f4e9ff'] as const;
/** `chars` caps the packed form, which keeps any legal drawing inside one 32 KiB message. */
export const DRAWING_LIMITS = { chars: 30000, widthMin: 0.002, widthMax: 0.12 } as const;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', enc = (n: number) => B64[n >> 6]! + B64[n & 63]!;
const dec = (s: string, i: number) => B64.indexOf(s[i]!) * 64 + B64.indexOf(s[i + 1]!);
/** Compact wire form: strokes split by spaces, each `tool colour width points…` with numbers in thousandths as two base64url digits. */
export function packDrawing(drawing: Drawing): string {
  return drawing.strokes.map(s => (s.tool?.[0] ?? 'p') + s.color.slice(1).toLowerCase() + enc(Math.round(s.width * 1000)) + s.points.map(p => enc(Math.round(p.x * 1000)) + enc(Math.round(p.y * 1000))).join('')).join(' ');
}
/** Accepts a drawing object or its packed string and returns a validated drawing object. */
export function parseDrawing(raw: unknown): Drawing {
  if (typeof raw === 'string') {
    if (raw.length > DRAWING_LIMITS.chars) throw new Error('Drawing is too detailed.');
    const strokes = raw ? raw.split(' ') : [];
    if (!strokes.every(s => /^[pef][0-9a-f]{6}[\w-]{2}(?:[\w-]{4})+$/.test(s))) throw new Error('Invalid drawing stroke.');
    raw = { strokes: strokes.map(s => ({ ...(s[0] !== 'p' && { tool: s[0] === 'e' ? 'erase' : 'fill' }), color: `#${s.slice(1, 7)}`, width: dec(s, 7) / 1000, points: Array.from({ length: (s.length - 9) / 4 }, (_, i) => ({ x: dec(s, 9 + i * 4) / 1000, y: dec(s, 11 + i * 4) / 1000 })) })) };
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Drawing).strokes)) throw new Error('Drawing must contain strokes.');
  const drawing = { strokes: (raw as Drawing).strokes.map(stroke => {
    if (!stroke || typeof stroke.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(stroke.color) || (stroke.tool !== undefined && stroke.tool !== 'erase' && stroke.tool !== 'fill') || !Number.isFinite(stroke.width) || stroke.width < DRAWING_LIMITS.widthMin || stroke.width > DRAWING_LIMITS.widthMax || !Array.isArray(stroke.points) || !stroke.points.length) throw new Error('Invalid drawing stroke.');
    return { ...(stroke.tool && { tool: stroke.tool }), color: stroke.color.toLowerCase(), width: Math.round(stroke.width * 1000) / 1000, points: stroke.points.map(point => {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new Error('Invalid drawing point.');
      return { x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 };
    }) };
  }) };
  if (packDrawing(drawing).length > DRAWING_LIMITS.chars) throw new Error('Drawing is too detailed.');
  return drawing;
}
