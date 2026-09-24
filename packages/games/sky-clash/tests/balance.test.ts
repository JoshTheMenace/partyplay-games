import assert from 'node:assert/strict';
import test from 'node:test';
import { ROSTER, ROSTER_DATA, type FighterKind, type StageId } from '../src/model';
import { HARD_SPOTS, SPOTS, gauntlet, recoveryDrill, roundRobin } from '../tools/balance';

// Melee-faithful weak spots: Yoshi and Jigglypuff have no rising up-special, and some slow recoveries cannot cover the far spot.
const NO_UP_B = new Set<FighterKind>(['yoshi', 'jigglypuff']), FAR = SPOTS.findIndex(([dx]) => dx > 6), UP_ONLY = SPOTS.findIndex(([, , jumps]) => !jumps);
const STANDARD: StageId[] = ['battlefield', 'final-destination', 'dream-land', 'yoshi-story', 'fountain'];

test('every fighter recovers from standard offstage spots (levels 2 and 3, Battlefield and Final Destination)', () => {
  let far = 0, runs = 0;
  for (const stage of ['battlefield', 'final-destination'] as StageId[]) for (const level of [2, 3] as const) for (const kind of ROSTER) {
    const r = recoveryDrill(kind, level, SPOTS, stage), tag = `${kind} L${level} ${stage}`;
    r.forEach((ok, i) => { if (i !== FAR && (i !== UP_ONLY || !NO_UP_B.has(kind))) assert.ok(ok, `${tag} failed spot ${i} (${SPOTS[i]!.join(', ')})`); });
    far += Number(r[FAR]); runs++;
  }
  assert.ok(far / runs >= .75, `far spot recovered ${far}/${runs}`);
});

test('party recovery: every regular fighter makes it back from 9 m out and 3 m below (level 3, Battlefield); Melee differences remain', () => {
  const hard = HARD_SPOTS.find(([dx, dy]) => dx === 9 && dy === -3)!, far: [number, number, number, number] = [11.5, -3, 1, .08];
  for (const kind of ROSTER.filter(k => !ROSTER_DATA[k].bonus)) assert.ok(recoveryDrill(kind, 3, [hard])[0], `${kind} from ${hard.join(', ')}`);
  assert.ok(recoveryDrill('fox', 3, [far])[0] && !recoveryDrill('link', 3, [far])[0], 'Fox still out-recovers Link');
  assert.ok(!recoveryDrill('link', 3, [hard], 'battlefield', 'melee')[0], 'melee recovery keeps Melee values');
});
test('CPU matches on standard stages finish, rarely self-destruct, and nobody gets stuck', () => {
  const cast: FighterKind[] = ['mario', 'fox', 'captain-falcon', 'kirby', 'ness', 'peach', 'pikachu', 'jigglypuff', 'marth', 'game-watch', 'giga-bowser'];
  const { rows, matches } = roundRobin(cast, { stages: STANDARD });
  const falls = [...rows.values()].reduce((n, r) => n + r.falls, 0), selfs = [...rows.values()].reduce((n, r) => n + r.selfs, 0);
  for (const m of matches) {
    assert.equal(m.winners.length, 1, `${m.kinds.join(' v ')} on ${m.stage} ended without a single winner`);
    assert.ok(m.stuck < 900, `${m.kinds.join(' v ')} on ${m.stage}: ${m.stuckAs} for ${m.stuck} frames`);
  }
  assert.ok(selfs / falls <= .03, `${selfs} self-destructs in ${falls} falls`);
  const ko = [...rows.values()].flatMap(r => r.koDamage), avg = ko.reduce((a, b) => a + b, 0) / ko.length;
  assert.ok(avg > 90 && avg < 200, `average KO at ${avg.toFixed(0)}%`);
});

test('bonus fighters are fun but not dominant against the regular cast', () => {
  const regulars: FighterKind[] = ['mario', 'fox', 'marth', 'peach', 'samus', 'pikachu', 'sheik', 'bowser'];
  const rates = ROSTER.filter(k => ROSTER_DATA[k].bonus).map(k => [k, gauntlet(k, regulars)] as const);
  for (const [kind, rate] of rates) assert.ok(rate <= .8, `${kind} wins ${Math.round(rate * 100)}%`);
  assert.ok(rates.reduce((n, [, r]) => n + r, 0) / rates.length <= .6, rates.map(([k, r]) => `${k} ${Math.round(r * 100)}%`).join(', '));
});
