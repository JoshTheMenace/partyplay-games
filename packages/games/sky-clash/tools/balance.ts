/**
 * Headless balance and sanity report: level-3 CPU matches under the real rules, plus offstage recovery drills.
 * Run from the repository root: node --import tsx packages/games/sky-clash/tools/balance.ts [matches|recovery|all] [--quick]
 * Melee is not balanced and is not flattened here; the report exists to catch reconstruction bugs (fighters that cannot
 * recover, specials that self-destruct, loop forever or make a fighter unkillable) and dominant bonus fighters.
 */
import { ROSTER, ROSTER_DATA, type CpuLevel, type FighterKind, type Settings, type StageId } from '../src/model';
import { stageFrame } from '../src/stages';
import { P, setState } from '../src/sim/common';
import { arena } from '../src/sim/harness';

export type MatchResult = { kinds: FighterKind[]; stage: StageId; winners: FighterKind[]; frames: number; dealt: Map<string, number>; kos: { kind: FighterKind; damage: number; self: boolean; as: string }[]; stuck: number; stuckAs: string };
/** One CPU match to the end (stock battle, time limit as a safety net). `stuck` is the longest run of one state + move. */
export function playMatch(kinds: FighterKind[], stage: StageId, seed: number, o: { stocks?: number; seconds?: number; level?: CpuLevel } = {}): MatchResult {
  const a = arena({ fighters: kinds, stage, seed, settings: { stocks: o.stocks ?? 2, seconds: o.seconds ?? 240, hazards: true }, cpu: kinds.map(() => o.level ?? 3) });
  const s = a.s, seen = new Set<number>(), kos: MatchResult['kos'] = [], run = new Map<string, [string, number]>(), dealt = new Map<string, number>();
  let stuck = 0, stuckAs = '';
  const last = new Map<string, string>();
  for (let t = 0; t < 60 * ((o.seconds ?? 240) + 70) && s.phase !== 'complete'; t++) {
    a.tick();
    for (const e of s.events) if (e.kind === 'hit' && e.damage && e.source && e.source !== e.target && !seen.has(e.id)) { seen.add(e.id); const key = `${s.fighters.find(f => f.id === e.source)!.kind}/${e.move ?? 'other'}`; dealt.set(key, (dealt.get(key) ?? 0) + e.damage); }
    for (const e of s.events) if (e.kind === 'ko' && !seen.has(e.id)) { seen.add(e.id); const f = s.fighters.find(g => g.id === e.target)!; kos.push({ kind: f.kind, damage: f.damage, self: !e.source, as: last.get(f.id) ?? '' }); }
    for (const f of s.fighters) {
      if (f.state === 'out' || f.state === 'respawn') { run.delete(f.id); continue; }
      if (!f.grounded && f.state !== 'air') last.set(f.id, `${f.state} ${f.move ?? ''} ${f.phase}`.trim());
      const key = f.state + (f.move ?? '') + f.phase + f.lastHitFrame, [k, n] = run.get(f.id) ?? ['', 0], len = k === key ? n + 1 : 1;
      run.set(f.id, [key, len]); if (len > stuck) { stuck = len; stuckAs = `${f.kind} ${key}`; }
    }
  }
  return { kinds, stage, winners: s.winners.map(id => s.fighters.find(f => f.id === id)!.kind), frames: s.frame, dealt, kos, stuck, stuckAs };
}

/** Standard offstage spots beside the ledge: [dx out, dy relative to the ledge, 1 = air jumps left (0 = up-special only), vx]. */
export const SPOTS: [number, number, number, number][] = [[2.5, -1.2, 1, .05], [4, -2.5, 1, .05], [5.5, .5, 1, .1], [3, -4, 1, 0], [6.5, -1, 1, .12], [2, -1.5, 0, .05]];
/** Hard spots after a typical launch (party recovery's target): 8–10 m out and 2–4 m below the ledge, still drifting away. */
export const HARD_SPOTS: [number, number, number, number][] = [[8, -2, 1, .1], [9, -3, 1, .08], [10, -2.5, 1, .05], [8.5, -4, 1, .05], [5, -3, 0, .05]];
/** Recovery drill: a level-2/3 CPU placed offstage must reach the ledge or the floor. Returns successes per spot. */
export function recoveryDrill(kind: FighterKind, level: CpuLevel = 3, spots = SPOTS, stage: StageId = 'battlefield', recovery: Settings['recovery'] = 'party'): boolean[] {
  const ledge = stageFrame(stage, 0).ledges.reduce((a, l) => (l.x > a.x ? l : a));
  return spots.map(([dx, dy, jumps, vx], i) => {
    const a = arena({ fighters: [kind, 'sandbag'], stage, seed: 5 + i, cpu: [level, null], settings: { recovery } }); a.place(1, ledge.x - 6);
    const f = a.f(0); Object.assign(f, { x: ledge.x + dx, y: ledge.y + dy, vx, vy: 0, grounded: false, ground: null, jumpsLeft: jumps ? P(f).jumps - 1 : 0, facing: -1 }); setState(f, 'air');
    for (let t = 0; t < 600 && f.state !== 'out'; t++) { a.tick(); if (f.grounded || f.state === 'ledge') return true; }
    return false;
  });
}

const STAGES: StageId[] = ['battlefield', 'final-destination', 'dream-land', 'yoshi-story', 'fountain', 'stadium'];
type Row = { games: number; wins: number; frames: number; koDamage: number[]; falls: number; selfs: number; stuck: number };
/** Round robin of 1v1s (every pair, alternating stages and sides). */
export function roundRobin(kinds: readonly FighterKind[], o: { seeds?: number; stages?: StageId[]; stocks?: number } = {}) {
  const rows = new Map<FighterKind, Row>(kinds.map(k => [k, { games: 0, wins: 0, frames: 0, koDamage: [], falls: 0, selfs: 0, stuck: 0 }]));
  const stages = o.stages ?? STAGES, matches: MatchResult[] = [];
  let n = 0;
  for (let i = 0; i < kinds.length; i++) for (let j = i + 1; j < kinds.length; j++) for (let k = 0; k < (o.seeds ?? 1); k++) {
    const pair = (n + k) % 2 ? [kinds[j]!, kinds[i]!] : [kinds[i]!, kinds[j]!], r = playMatch(pair, stages[n++ % stages.length]!, 100 + n * 7 + k, { stocks: o.stocks ?? 2 });
    matches.push(r);
    for (const kind of pair) {
      const row = rows.get(kind)!; row.games++; row.frames += r.frames; row.stuck = Math.max(row.stuck, r.stuck);
      if (r.winners.length === 1 && r.winners[0] === kind) row.wins++;
      else if (r.winners.includes(kind)) row.wins += .5;
    }
    for (const ko of r.kos) { const row = rows.get(ko.kind)!; row.falls++; row.koDamage.push(ko.damage); if (ko.self) row.selfs++; }
  }
  return { rows, matches };
}

/** One fighter against each opponent on alternating standard stages and sides: its win rate (shared wins count half). */
export function gauntlet(kind: FighterKind, opponents: readonly FighterKind[], seeds = 1, stocks = 2): number {
  let wins = 0, n = 0;
  for (const [i, other] of opponents.entries()) for (let k = 0; k < seeds; k++) {
    const pair: FighterKind[] = (i + k) % 2 ? [other, kind] : [kind, other], r = playMatch(pair, STAGES[(i + k) % 5]!, 900 + i * 13 + k, { stocks });
    wins += r.winners.length === 1 && r.winners[0] === kind ? 1 : r.winners.includes(kind) ? .5 : 0; n++;
  }
  return wins / n;
}
const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(5);
const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
export function report(kinds: readonly FighterKind[], o: { seeds?: number; recovery?: boolean; matches?: boolean } = {}) {
  const lines: string[] = [];
  const rec = o.recovery === false ? null : new Map(kinds.map(k => [k, [...recoveryDrill(k, 3), ...recoveryDrill(k, 2)]]));
  const hard = rec && new Map(kinds.map(k => [k, [recoveryDrill(k, 3, HARD_SPOTS), recoveryDrill(k, 3, HARD_SPOTS, 'battlefield', 'melee')]]));
  const rr = o.matches === false ? null : roundRobin(kinds, { seeds: o.seeds ?? 1 });
  lines.push(`fighter              ${rr ? 'games  win   avg s  KO%   falls  SD  stuck' : ''}${rec ? '  recovery  hard party/melee' : ''}`);
  for (const k of kinds) {
    const row = rr?.rows.get(k), r = rec?.get(k), h = hard?.get(k), n = (b: boolean[]) => `${b.filter(Boolean).length}/${b.length}`;
    const cells = row ? `${String(row.games).padStart(5)} ${pct(row.wins / row.games)} ${(row.frames / row.games / 60).toFixed(0).padStart(6)} ${avg(row.koDamage).toFixed(0).padStart(4)} ${String(row.falls).padStart(6)} ${String(row.selfs).padStart(3)} ${String(row.stuck).padStart(6)}` : '';
    lines.push(`${(ROSTER_DATA[k].name + (ROSTER_DATA[k].bonus ? ' *' : '')).padEnd(20)} ${cells}${r ? `  ${n(r).padEnd(8)}  ${n(h![0])} ${n(h![1])}` : ''}`);
  }
  if (rr) {
    // Damage share by move: a special carrying a fighter's whole game is a degenerate-kit warning sign.
    const byMove = new Map<string, number>(), byKind = new Map<string, number>();
    for (const m of rr.matches) for (const [key, d] of m.dealt) { byMove.set(key, (byMove.get(key) ?? 0) + d); const k = key.split('/')[0]!; byKind.set(k, (byKind.get(k) ?? 0) + d); }
    const heavy = [...byMove].map(([key, d]) => [key, d / (byKind.get(key.split('/')[0]!) || 1)] as const).filter(([key, share]) => key.includes('special') && share > .2).sort((a, b) => b[1] - a[1]);
    lines.push(`\nspecials over 20% of a fighter's damage: ${heavy.map(([key, share]) => `${key} ${pct(share).trim()}`).join(', ') || 'none'}`);
    const all = [...rr.rows.values()], ko = all.flatMap(r => r.koDamage);
    const worst = (list: MatchResult[]) => list.reduce((a, m) => (m.stuck > a.stuck ? m : a), list[0]!), std = worst(rr.matches.filter(m => m.stage !== 'stadium')), stadium = rr.matches.filter(m => m.stage === 'stadium');
    lines.push(`\n${rr.matches.length} matches · avg ${(avg(rr.matches.map(m => m.frames)) / 60).toFixed(0)} s · avg KO ${avg(ko).toFixed(0)}% · self-destructs ${all.reduce((n, r) => n + r.selfs, 0)} of ${ko.length} falls`);
    lines.push(`longest single state: ${std.stuck} frames off Stadium (${std.stuckAs})${stadium.length ? `, ${worst(stadium).stuck} on Pokémon Stadium (${worst(stadium).stuckAs})` : ''}`);
  }
  return lines.join('\n');
}

if (process.argv[1]?.endsWith('balance.ts')) {
  const mode = process.argv[2] ?? 'all', quick = process.argv.includes('--quick');
  const kinds = (process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',') as FighterKind[] | undefined) ?? (quick ? ROSTER.filter((_, i) => i % 3 === 0) : ROSTER);
  const started = Date.now();
  console.log(report(kinds, { recovery: mode !== 'matches', matches: mode !== 'recovery', seeds: quick || process.argv.includes('--one') ? 1 : 2 }));
  if (mode !== 'recovery') {
    const regulars = ROSTER.filter(k => !ROSTER_DATA[k].bonus);
    console.log(`\nbonus fighters vs every regular: ${ROSTER.filter(k => ROSTER_DATA[k].bonus).map(k => `${ROSTER_DATA[k].name} ${pct(gauntlet(k, regulars)).trim()}`).join(', ')}`);
  }
  console.log(`(${((Date.now() - started) / 1000).toFixed(1)} s)`);
}
