/**
 * Deterministic scripting harness for tests and tuning tools (server-only): a match already in the fight phase with
 * chosen fighters, and phone-shaped inputs driven per seat (held stick/buttons plus monotonic press counters).
 */
import { DEFAULT_SETTINGS, neutralInput, type CpuLevel, type FighterKind, type Input, type Settings, type StageId } from '../model';
import { PHYSICS } from '../moveset';
import { stageFrame } from '../stages';
import { setState } from './common';
import { createMatch, stepMatch, viewOf } from './match';
import { surfaces } from './world';
import type { Fighter, PressKey, State } from './types';

export type Pad = { x?: number; y?: number; attack?: boolean; special?: boolean; jump?: boolean; shield?: boolean; smash?: boolean };
export type Arena = {
  s: State; now: number; inputs: Map<string, Input>;
  f(i: number): Fighter;
  /** Hold a stick (world +y up) and buttons until changed. */
  hold(i: number, pad: Pad): void;
  /** One press (counter +1) with the stick aimed (world +y up) at the moment of the press. */
  press(i: number, key: PressKey, aim?: { x?: number; y?: number }): void;
  tick(n?: number): void;
  view(): ReturnType<typeof viewOf>;
  /** Stand fighter i idle at x on the highest surface at or below y (default: anywhere), facing `facing`. */
  place(i: number, x: number, o?: { y?: number; facing?: 1 | -1 }): Fighter;
};
export function arena(o: { fighters: FighterKind[]; stage?: StageId; seed?: number; settings?: Partial<Settings>; cpu?: (CpuLevel | null)[]; keepCountdown?: boolean }): Arena {
  const settings: Settings = { ...DEFAULT_SETTINGS, cpus: 0, hazards: false, stage: o.stage ?? 'final-destination', ...o.settings };
  const players = o.fighters.map((fighter, i) => ({ id: `p${i}`, name: `P${i + 1}`, color: '#ff5748', lobbyChoice: { fighter, costume: 0, stage: null } }));
  const s = createMatch({ roomId: 'test', roundId: 'round', seed: o.seed ?? 1, nowMs: 0, players }, settings);
  s.fighters = s.fighters.filter(f => !f.cpu); // the lone-human CPU is added explicitly through `cpu`
  s.fighters.forEach((f, i) => { const lv = o.cpu?.[i]; if (lv) f.cpu = lv; });
  const a: Arena = {
    s, now: 0, inputs: new Map(s.fighters.map(f => [f.id, neutralInput()])),
    f: i => s.fighters[i]!,
    hold(i, pad) {
      const input = a.inputs.get(s.fighters[i]!.id)!;
      if (pad.x !== undefined) input.x = pad.x;
      if (pad.y !== undefined) input.y = -pad.y;
      for (const k of ['attack', 'special', 'jump', 'shield', 'smash'] as const) if (pad[k] !== undefined) input.held[k] = pad[k]!;
    },
    press(i, key, aim) {
      const input = a.inputs.get(s.fighters[i]!.id)!;
      input.presses[key]++;
      if (aim) { if (aim.x !== undefined) input.x = aim.x; if (aim.y !== undefined) input.y = -aim.y; }
      input.aim = { x: input.x, y: input.y };
    },
    tick(n = 1) { for (let k = 0; k < n; k++) { a.now += 1000 / 60; stepMatch(s, a.inputs, a.now); } },
    view: () => viewOf(s),
    place(i, x, o = {}) {
      const f = s.fighters[i]!, list = surfaces(stageFrame(s.stageId, s.stageTick, s.hazards));
      const q = list.filter(q => x >= q.left && x <= q.right && q.y <= (o.y ?? 1e9) + 1e-6).sort((p, q) => q.y - p.y)[0];
      if (!q) throw new Error(`No floor at ${x}`);
      Object.assign(f, { x, px: x, y: q.y, py: q.y, vx: 0, vy: 0, kx: 0, ky: 0, grounded: true, ground: q.id, facing: o.facing ?? f.facing, move: null, jumpsLeft: PHYSICS[f.kind].jumps });
      setState(f, 'idle');
      return f;
    },
  };
  if (!o.keepCountdown) { s.phase = 'fight'; s.phaseEndsAt = s.endsAt = settings.seconds ? 3000 + settings.seconds * 1000 : 0; }
  return a;
}
