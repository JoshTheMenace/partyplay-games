import { test } from 'node:test';
import assert from 'node:assert/strict';

// Load the vendored JavaScript modules without adding browser types to the server API.
const { G, emit } = await import(new URL('../upstream/src/core/ctx.js', import.meta.url).href);
const { AudioEngine } = await import(new URL('../upstream/src/audio/audio.js', import.meta.url).href);
const { installBossAudio } = await import(new URL('../upstream/src/audio/bossAudio.js', import.meta.url).href);

test('boss attacks tolerate audio that has not been unlocked by a gesture', () => {
  installBossAudio(); G.audio = new AudioEngine({ music: false });
  emit('boss:spawn', { boss: { pos: { x: 0, y: 0, z: 0 } } });
  try {
    for (const id of ['sweep', 'charge', 'frenzy']) assert.doesNotThrow(() => emit('boss:move', { id, phase: 'act', dur: 2 }));
  } finally { emit('match:state', { state: 'finish', match: { mode: 'boss' } }); }
});
