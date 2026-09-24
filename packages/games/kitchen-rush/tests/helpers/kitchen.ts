// Test harness: builds rounds on custom maps and drives them only through rules.tick with real inputs.
import { createState, rules, type State } from '../../src/server';
import { DEFAULT_SETTINGS, WALKABLE, neutral, parseMap, type Command, type Input, type Level, type Settings } from '../../src/model';
import { LEVELS } from '../../src/levels';
import { travel } from './bot';

export const DT = 1 / 60;
export type Setup = { players?: number; settings?: Partial<Settings>; level?: Partial<Level>; seed?: number };
export const roster = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Chef number ${i}`, color: '#ff5748' }));

/** A round on a custom map (rows) or, with rows = null, the real level map via rules.create. */
export function setup(rows: readonly string[] | null, options: Setup = {}): State {
  const settings = { ...DEFAULT_SETTINGS, ...options.settings }, ctx = { roomId: 'room', roundId: 'round', seed: options.seed ?? 7, nowMs: 1000, players: roster(options.players ?? 1) };
  return rows ? createState(ctx, settings, parseMap(rows), { ...LEVELS[0], ...options.level }) : rules.create(ctx, settings);
}

/** Advance whole 60 Hz steps with the given held inputs (missing fields are neutral). */
export function step(s: State, inputs: Record<string, Partial<Input>> = {}, seconds = DT) {
  const map = new Map(Object.entries(inputs).map(([id, input]) => [id, { ...neutral(), ...input }]));
  for (let i = 0, n = Math.max(1, Math.round(seconds / DT)); i < n; i++) rules.tick(s, map, DT, s.now + DT * 1000);
}
/** One tick carrying a fresh command, like a phone tap. */
export function press(s: State, player: number, cmd: Command, input: Partial<Input> = {}) {
  const chef = s.players[player];
  step(s, { [chef.id]: { ...input, cmd, seq: chef.seq + 1 } });
}

/** Locate the n-th occurrence of a map character. */
export function find(rows: readonly string[], char: string, n = 0): number {
  let seen = 0;
  for (let row = 0; row < rows.length; row++) for (let col = 0; col < rows[row].length; col++) if (rows[row][col] === char && seen++ === n) return row * rows[0].length + col;
  throw new Error(`No "${char}" #${n} in map`);
}
export const slot = (s: State, tile: number) => s.slots[tile];

/** Stand a chef on the floor tile beside `tile`, facing it, then let one tick update targeting. */
export function standAt(s: State, player: number, tile: number) {
  const { map } = s, target = map.tiles[tile], chef = s.players[player];
  for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const col = target.col + dc, row = target.row + dr;
    if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) continue;
    const floor = map.tiles[row * map.cols + col];
    if (!WALKABLE.has(floor.kind)) continue;
    Object.assign(chef, { x: floor.x, z: floor.z, vx: 0, vz: 0, fx: -dc, fz: -dr });
    step(s);
    if (chef.target !== tile) throw new Error(`Chef ${player} cannot target tile ${tile}`);
    return chef;
  }
  throw new Error(`No floor beside tile ${tile}`);
}

/** Walk a chef with real movement inputs until it targets `tile` (throws after `limit` seconds). */
export function walkTo(s: State, player: number, tile: number, limit = 12) {
  const chef = s.players[player];
  for (let t = 0; t < limit; t += DT) {
    const way = travel(s.map, s.gatesOpen, chef, tile);
    if (way.ready) return chef;
    step(s, { [chef.id]: { x: way.x, y: way.y } });
  }
  throw new Error(`Chef ${player} did not reach tile ${tile}`);
}
