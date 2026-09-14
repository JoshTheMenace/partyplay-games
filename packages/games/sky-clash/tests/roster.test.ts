import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ATTRIBUTES } from '../fidelity/attributes';
import { SCRIPTS } from '../fidelity/scripts';
import { ROSTER_DATA } from '../src/roster';
import { ROSTER, FIGHTERS, neutralInput, getMove, type FighterKind, type Input, type Move } from '../src/model';
import { rules, hitPosition } from '../src/server';
import { assertSerializable } from '../../../party-contract/src/serializable';
const moves: Move[] = ['jab','side','upper','sweep','smash','upsmash','downsmash','aerial','forwardair','backair','upair','downair'];
const create = (kinds: FighterKind[]) => {
  const state = rules.create({ roomId: 'r', roundId: 'r', nowMs: 0, seed: 1, players: kinds.map((kind, i) => ({ id: String(i), name: kind, color: '#ffffff' })) }, { stocks: 3, seconds: 60 });
  kinds.forEach((kind, i) => rules.applyAction(state, String(i), rules.parseAction({ turnId: 'r', kind }), 0));
  rules.tick(state, new Map(), 1 / 60, 3000);
  state.players.forEach(p => rules.applyAction(state, p.id, { turnId: 'r', stage: 'cloudbreak' }, 3000));
  rules.tick(state, new Map(), 1 / 60, 3000); rules.tick(state, new Map(), 1 / 60, 6000); return state;
};
const step = (state: ReturnType<typeof create>, input = neutralInput(), frames = 1) => {
  for (let i = 0; i < frames; i++) rules.tick(state, new Map([['0', input]]), 1 / 60, 6000 + state.frame * 1000 / 60);
};
test('all 33 source fighter kinds are selectable, 27 profiles sourced and 6 bonus profiles explicit', () => {
  assert.equal(ROSTER.length, 33); assert.equal(new Set(ROSTER).size, 33);
  assert.deepEqual(ROSTER.map(k => ROSTER_DATA[k].sourceIndex), Array.from({ length: 33 }, (_, i) => i));
  assert.equal(Object.keys(SCRIPTS).length, 27); assert.equal(ROSTER.filter(k => FIGHTERS[k].bonus).length, 6);
  for (const kind of ROSTER) {
    const state = create([kind, 'fox']); assert.equal(state.players[0].kind, kind); assert.equal(state.players[0].chosen, true);
    assert.equal(Object.keys(ATTRIBUTES[kind]).length, 53);
    if (FIGHTERS[kind].bonus) assert.deepEqual(ATTRIBUTES[kind], ATTRIBUTES[ROSTER_DATA[kind].profile]);
    else assert.equal(SCRIPTS[kind as keyof typeof SCRIPTS].source.revisionVerified, false);
  }
  for (const kind of ['none','max','__proto__','constructor','ice-climbers']) assert.throws(() => rules.parseAction({ turnId: 'r', kind }));
});
test('each authored GLB and portrait exists, models are distinct and fit the loading budget', () => {
  const hashes = new Set<string>(); let total = 0;
  for (const kind of ROSTER) {
    const bytes = readFileSync(new URL(`../assets/${kind}-replacement.glb`, import.meta.url)); total += bytes.length;
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF'); hashes.add(createHash('sha256').update(bytes).digest('hex'));
    const png = readFileSync(new URL(`../assets/${kind}-portrait.png`, import.meta.url)); assert.equal(png.toString('ascii', 1, 4), 'PNG');
  }
  // Smooth authored models and costume geometry share materials and need no texture downloads.
  assert.equal(hashes.size, 33); assert.ok(total < 20 * 1024 * 1024, `Roster payload ${total}`);
});
test('every fighter has twelve finite source normal attacks and four available special slots', () => {
  for (const kind of ROSTER) for (const move of [...moves, 'laser','dash','rise','reflect'] as Move[]) {
    const spec = getMove(kind, move); assert.ok(spec.end > 0 && spec.end < 500, `${kind} ${move}`);
    if (moves.includes(move)) assert.ok(spec.windows.length > 0, `${kind} ${move} must hit`);
    for (const window of spec.windows) {
      assert.ok(window.to > window.from && window.from >= 0);
      for (const hit of window.hitboxes) assert.ok([hit.damage, hit.size, hit.angle, hit.growth].every(Number.isFinite));
    }
  }
  assert.equal(ATTRIBUTES.pichu.weight, 55); assert.equal(ATTRIBUTES.bowser.weight, 117);
  assert.equal(getMove('ganondorf','jab').windows[0].hitboxes[0].damage, 7);
  assert.equal(getMove('marth','jab').startup, 4); assert.equal(getMove('zelda','jab').startup, 11);
  assert.deepEqual(getMove('nana','jab'), getMove('popo','jab'));
  assert.deepEqual(getMove('kirby','aerial').windows.map(w => w.hitboxes[0].damage), [10, 8, 6]);
});
test('Kirby and Jigglypuff preserve all six jumps, reject a seventh, and restore them on landing', () => {
  for (const kind of ['kirby','jigglypuff'] as const) {
    const state = create([kind, 'fox']), p = state.players[0]; assert.equal(p.jumps, 6);
    step(state, { ...neutralInput(), jump: true, presses: { ...neutralInput().presses, jump: 1 } }, ATTRIBUTES[kind].jump_startup_time + 1);
    assert.equal(p.jumps, 5);
    for (let jump = 2; jump <= 6; jump++) { p.y = 2; step(state, { ...neutralInput(), presses: { ...neutralInput().presses, jump } }); assert.equal(p.jumps, 6 - jump); }
    p.vy = 0; step(state, { ...neutralInput(), presses: { ...neutralInput().presses, jump: 7 } }); assert.ok(p.vy < 0); assert.equal(p.jumps, 0);
    p.y = .01; p.vy = -2; p.x = 0; step(state); assert.equal(p.jumps, 6);
  }
});
test('authored hurt/attack geometry follows body size and sword reach', () => {
  const state = create(['kirby','bowser']);
  const [small, large] = state.players; small.x = large.x = 0; small.facing = large.facing = 1;
  const a = hitPosition(small, 'jab', getMove('kirby','jab').windows[0].hitboxes[0]);
  const b = hitPosition(large, 'jab', getMove('bowser','jab').windows[0].hitboxes[0]);
  assert.ok(a.y < b.y); assert.ok(a.x < b.x); assert.ok(FIGHTERS.kirby.height < FIGHTERS.bowser.height);
});
test('counter, absorption and Pichu recoil differ from a generic reflector', () => {
  const counter = create(['fox','marth']), [fox, marth] = counter.players;
  fox.x = -.5; marth.x = .5; marth.move = 'reflect'; marth.moveFrame = 6;
  step(counter, { ...neutralInput(), attack: true }, 4); assert.equal(marth.damage, 0); assert.ok(fox.damage >= 10);
  const absorb = create(['fox','ness']), [shooter, ness] = absorb.players; shooter.x = -3; ness.x = 0; ness.damage = 30; ness.move = 'reflect'; ness.moveFrame = 6;
  step(absorb, { ...neutralInput(), special: true }, 15); assert.ok(ness.damage < 30);
  const recoil = create(['pichu','fox']); step(recoil, { ...neutralInput(), special: true }, 19); assert.equal(recoil.players[0].damage, 1);
});
test('all 33 fighters survive mixed four-player simulation, transport and timeout results', () => {
  for (let start = 0; start < ROSTER.length; start += 4) {
    const kinds = Array.from({ length: 4 }, (_, i) => ROSTER[(start + i) % ROSTER.length]), state = create(kinds);
    for (let frame = 0; frame < 1200 && state.phase !== 'complete'; frame++) {
      const inputs = new Map<string, Input>(state.players.map((p, i) => [p.id, { ...neutralInput(), x: Math.sin(frame / 21 + i), y: Math.cos(frame / 43 + i), attack: frame % 70 < 30, special: frame % 120 > 90,
        presses: { jump: Math.floor(frame / 90), attack: Math.floor(frame / 55), special: Math.floor(frame / 130), smash: Math.floor(frame / 180) } }]));
      rules.tick(state, inputs, 1 / 60, 6000 + frame * 1000 / 60);
      assertSerializable(rules.publicView(state, { nowMs: 6000, phase: 'playing' }));
      assert.ok(state.players.every(p => [p.x,p.y,p.vx,p.vy,p.damage].every(Number.isFinite)));
      assert.ok(state.projectiles.length <= 24);
    }
    rules.tick(state, new Map(), 1 / 60, 70000); assert.equal(rules.outcome(state).complete, true);
    assert.ok(JSON.stringify(rules.publicView(state, { nowMs: 70000, phase: 'playing' })).length < 20000);
  }
});
