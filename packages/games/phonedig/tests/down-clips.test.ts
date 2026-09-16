import { strict as assert } from 'node:assert';
import test from 'node:test';
import { clipFor } from '../src/anim';
import { CLIPS, FRAMES, SKINS } from '../src/sprites';

test('a downed digger plays down, then inflates on banked pumps, facing their way', () => {
  const p = { id: 1, x: 0, y: 0, dir: 1, downed: true, suit: null };
  assert.equal(clipFor(p), 'player.down.R');
  assert.equal(clipFor(p, { phase: 0 }), 'player.inflate.R');
  assert.equal(clipFor({ ...p, dir: 3, suit: 'salvage' }, { phase: 0.5 }), 'player.salvage.inflate.L');
  assert.equal(clipFor({ ...p, downed: false }), 'player.walk.R');
});

test('every suit has both clips, and down hands over to inflate on the same pixels', () => {
  for (const prefix of ['player', ...SKINS.map(s => 'player.' + s.id)]) {
    for (const h of ['R', 'L']) {
      const down = CLIPS[`${prefix}.down.${h}`], inflate = CLIPS[`${prefix}.inflate.${h}`];
      assert.ok(down && inflate, `${prefix} ${h} is missing a clip`);
      assert.equal(down.loop, false); assert.equal(inflate.loop, false);
      // Different names, one packed rect: the generator dedupes identical pixels into an alias.
      assert.deepEqual(FRAMES[down.frames.at(-1)!], FRAMES[inflate.frames[0]], `${prefix} ${h} jumps between down and inflate`);
    }
  }
});
