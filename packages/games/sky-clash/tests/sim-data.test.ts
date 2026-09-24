import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { ACTIONS } from '../fidelity/actions';
import { ATTRIBUTES } from '../fidelity/attributes';
import { MOVE_SOURCES, POSES, ROSTER, ROSTER_DATA, UNIT, type MoveId } from '../src/model';
import { MOVESET, PHYSICS, TIMING, defaultPose } from '../src/moveset';

const roster = JSON.parse(readFileSync(new URL('../fidelity/roster.json', import.meta.url), 'utf8')) as { id: string; sha256: string; bonus: boolean }[];
const REGULAR = ROSTER.filter(k => !ROSTER_DATA[k].bonus);
const CORE: MoveId[] = ['jab1', 'ftilt', 'utilt', 'dtilt', 'dash', 'fsmash', 'usmash', 'dsmash', 'nair', 'fair', 'bair', 'uair', 'dair', 'grab', 'dashgrab', 'pummel', 'ledgeattack', 'ledgeattackSlow', 'getupattack', 'getupattackD'];
const SPECIALS: MoveId[] = ['nspecial', 'nspecialAir', 'sspecial', 'sspecialAir', 'uspecial', 'uspecialAir', 'dspecial', 'dspecialAir'];

test('every regular fighter imports every core move with live windows, four throws, a taunt and eight special slots', () => {
  assert.equal(REGULAR.length, 27);
  for (const k of REGULAR) {
    const m = MOVESET[k];
    for (const id of CORE) assert.ok(m[id]?.windows.length, `${k} ${id}`);
    for (const id of ['fthrow', 'bthrow', 'uthrow', 'dthrow'] as const) { const t = m[id]; assert.ok(t?.throw && t.release !== undefined && t.release <= t.total, `${k} ${id}`); }
    assert.ok(m.taunt, `${k} taunt`);
    for (const id of SPECIALS) assert.ok(m[id]?.phases && Object.keys(m[id]!.phases!).length, `${k} ${id}`);
    for (const [id, move] of Object.entries(m)) {
      assert.ok((POSES as readonly string[]).includes(move!.pose), `${k} ${id} pose`);
      for (const w of move!.windows) {
        assert.ok(w.from < w.to && w.to <= move!.total + 1, `${k} ${id} window ${w.from}-${w.to}/${move!.total}`);
        for (const h of w.hitboxes) assert.ok([h.x, h.y, h.r, h.damage].every(Number.isFinite) && Math.abs(h.x) < 5 && h.y > -2.5 && h.y < 5 && h.r > 0, `${k} ${id} hitbox`);
      }
    }
  }
});
test('bonus fighters borrow their profile scripts; every MOVE_SOURCES name is covered by the importer', () => {
  for (const k of ROSTER.filter(k => ROSTER_DATA[k].bonus)) {
    const profile = ROSTER_DATA[k].profile as string;
    assert.ok(ACTIONS[profile], k);
    assert.ok(MOVESET[k].jab1 && MOVESET[k].nspecial, k);
  }
  const names = new Set(Object.values(ACTIONS).flatMap(p => Object.keys(p.actions)));
  for (const [id, sources] of Object.entries(MOVE_SOURCES)) assert.ok(sources.some(n => names.has(n)), id);
});
test('import is sha-pinned to fidelity/roster.json and stays a reasonable browser download', () => {
  for (const r of roster.filter(r => !r.bonus)) assert.equal(ACTIONS[r.id]!.source.sha256, r.sha256, r.id);
  assert.ok(statSync(new URL('../fidelity/actions.ts', import.meta.url)).size < 700_000);
});
test('script frames follow Melee frame data (frame 1 = first frame)', () => {
  const fox = MOVESET.fox, span = (id: MoveId) => fox[id]!.windows.map(w => [Math.max(1, w.from), w.to - 1]);
  assert.deepEqual(span('jab1'), [[2, 3]]);                  // Fox jab: frames 2–3
  assert.deepEqual(span('nair'), [[4, 7], [8, 31]]);         // Fox nair: 4–7 clean, 8–31 late
  assert.deepEqual(span('fair').map(([a]) => a), [6, 16, 24, 33, 43]);
  assert.equal(fox.fsmash!.charge!.frame, 7);
  assert.deepEqual(fox.dspecial!.phases!.Start!.windows.map(w => [Math.max(1, w.from), w.to - 1]), [[1, 1]]); // shine hits on frame 1
  assert.equal(fox.fair!.landingLag, ATTRIBUTES.fox.landingairf_lag);
  assert.equal(fox.jab1!.iasa, 16);
  assert.deepEqual(TIMING.fox.rollF.intangible, [[4, 20]]);
});
test('throws keep their command knockback and back throws reverse only when the script says so', () => {
  assert.deepEqual(MOVESET.mario.bthrow!.throw, { damage: 12, angle: 45, kbGrowth: 65, fixedKb: 0, kbBase: 80, effect: 'normal' });
  assert.equal(MOVESET.mario.bthrow!.turn, MOVESET.mario.bthrow!.release);
  assert.equal(MOVESET.marth.bthrow!.turn, undefined); // 117° already points backward
  assert.equal(MOVESET.fox.dthrow!.throw!.angle, 270);
  assert.ok(MOVESET['donkey-kong'].fthrow!.throw, 'cargo throw');
});
test('physics come straight from attributes through UNIT', () => {
  for (const k of ROSTER) {
    const a = ATTRIBUTES[k], p = PHYSICS[k];
    assert.equal(p.fullHop, a.jump_v_initial_velocity * UNIT); assert.equal(p.shortHop, a.hop_v_initial_velocity * UNIT);
    assert.equal(p.gravity, a.gravity * UNIT); assert.equal(p.fastFall, a.fast_fall_velocity * UNIT); assert.equal(p.jumps, a.max_jumps);
    assert.equal(p.jumpsquat, a.jump_startup_time); assert.equal(p.weight, a.weight);
  }
  assert.equal(PHYSICS.kirby.jumps, 6); assert.equal(PHYSICS.jigglypuff.jumps, 6);
});
test('default poses give swords their weapon and everyone a limb', () => {
  assert.equal(defaultPose('marth', 'fsmash').limb, 'weapon');
  assert.equal(defaultPose('fox', 'fair').pose, 'kick-front');
  for (const k of ROSTER) for (const id of Object.keys(MOVE_SOURCES) as MoveId[]) assert.ok(defaultPose(k, id).limb);
});
