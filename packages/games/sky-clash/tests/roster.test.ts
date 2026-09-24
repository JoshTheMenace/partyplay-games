import assert from 'node:assert/strict';
import test from 'node:test';
import { MOVE_SOURCES, ROSTER, ROSTER_DATA, type MoveId } from '../src/model';
import { MOVESET } from '../src/moveset';
import { setState } from '../src/sim/common';
import { arena } from '../src/sim/harness';
import type { Slot } from '../src/sim/kits';
import { kitOf } from '../src/sim/specials';

const AIMS = { n: { x: 0, y: 0 }, s: { x: 1, y: 0 }, hi: { x: 0, y: 1 }, lw: { x: 0, y: -1 } } as const;
test('all 33 fighters are playable: 27 sourced, 6 bonus borrowing a profile', () => {
  assert.equal(ROSTER.length, 33);
  assert.equal(ROSTER.filter(k => ROSTER_DATA[k].bonus).length, 6);
});
test('every fighter starts, runs and leaves each of its eight specials on the ground and in the air', () => {
  for (const kind of ROSTER) for (const [slot, aim] of Object.entries(AIMS)) for (const air of [false, true]) {
    if (air && kitOf(kind)[slot as Slot]?.groundOnly) continue;
    const a = arena({ fighters: [kind, 'sandbag'] }); a.place(1, 3); a.place(0, 0, { facing: 1 });
    const f = a.f(0);
    if (air) { f.y += 3; f.grounded = false; f.ground = null; setState(f, 'air'); }
    a.press(0, 'special', aim); a.hold(0, { special: true });
    a.tick(); const started = f.move;
    assert.ok(started?.includes('special'), `${kind} ${slot} ${air ? 'air' : 'ground'} did not start (${f.state})`);
    a.hold(0, { special: false, x: 0, y: 0 });
    let t = 0;
    for (; t < 900 && f.move?.includes('special'); t++) { if (t === 200) a.press(0, 'special'); a.tick(); }
    assert.ok(t < 900, `${kind} ${slot} ${air ? 'air' : 'ground'} stuck in ${f.move}/${f.phase}`);
    assert.ok([f.x, f.y, f.vx, f.vy].every(Number.isFinite), `${kind} ${slot} NaN`);
    if (f.kind !== kind) assert.ok(['zelda', 'sheik'].includes(kind) && slot === 'lw', `${kind} changed into ${f.kind}`);
  }
});
test('every normal move of every fighter plays through its frames and hands control back', () => {
  const moves = Object.keys(MOVE_SOURCES).filter(id => !id.includes('special') && !['grab', 'dashgrab', 'pummel', 'fthrow', 'bthrow', 'uthrow', 'dthrow', 'ledgeattack', 'ledgeattackSlow', 'getupattack', 'getupattackD'].includes(id)) as MoveId[];
  for (const kind of ROSTER) for (const id of moves) {
    const m = MOVESET[kind][id]; if (!m) continue;
    const a = arena({ fighters: [kind, 'sandbag'] }); a.place(1, 4); const f = a.place(0, 0, { facing: 1 });
    if (['nair', 'fair', 'bair', 'uair', 'dair'].includes(id)) { f.y += 4; f.grounded = false; f.ground = null; setState(f, 'air'); }
    f.move = id; f.moveFrame = 0; f.state = 'attack';
    a.tick(m.total + 40 + (m.charge ? 60 : 0));
    assert.notEqual(f.move, id, `${kind} ${id}`);
  }
});
