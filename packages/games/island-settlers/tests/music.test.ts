import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Soundtrack, SOUNDTRACKS } from '../src/music';
class Media {
  src = ''; preload = ''; loop = true; volume = 1; currentTime = 0; paused = true; plays = 0; blocked = false;
  onended: (() => void) | null = null; onerror: (() => void) | null = null;
  play() { this.plays++; if (this.blocked) return Promise.reject(new Error('Gesture required')); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() { this.src = ''; }
  load() {}
}
const setup = () => { const audio = new Media(); return { audio, music: new Soundtrack(audio as unknown as HTMLAudioElement) }; };
test('streams the supplied tracks in order and wraps without layering', () => {
  const { audio, music } = setup(); assert.equal(audio.preload, 'none'); assert.equal(audio.plays, 0); assert.equal(audio.volume, .22); assert.equal(audio.loop, false);
  music.setPlaying(true);
  for (let i = 0; i < 6; i++) { assert.equal(audio.src, `/games/island-settlers/music/${SOUNDTRACKS[i % 3]}.mp3`); audio.onended!(); }
  assert.equal(audio.plays, 7); music.dispose();
});
test('mute and inactivity preserve playback position, including a muted track boundary', () => {
  const { audio, music } = setup(); music.setPlaying(true); audio.currentTime = 37;
  for (let i = 0; i < 100; i++) music.setPlaying(true);
  assert.equal(audio.plays, 1); music.setPlaying(false); assert.equal(audio.paused, true); assert.equal(audio.currentTime, 37);
  music.setPlaying(true); assert.equal(audio.currentTime, 37); music.setPlaying(false); audio.onended!(); assert.equal(audio.plays, 2); music.dispose();
});
test('missing tracks are skipped and a wholly missing playlist stops retrying', () => {
  const { audio, music } = setup(); music.setPlaying(true); audio.onerror!(); assert.ok(audio.src.includes(SOUNDTRACKS[1]));
  audio.onended!(); audio.onended!(); assert.ok(audio.src.includes(SOUNDTRACKS[1]));
  audio.onerror!(); audio.onerror!(); const plays = audio.plays;
  for (let i = 0; i < 100; i++) music.setPlaying(true);
  assert.equal(audio.plays, plays); assert.equal(audio.paused, true);
  music.setPlaying(true, true); assert.equal(audio.plays, plays + 1); assert.equal(audio.paused, false); music.dispose();
});
test('blocked autoplay can retry, and disposal prevents late playback', async () => {
  const { audio, music } = setup(); audio.blocked = true; music.setPlaying(true); await Promise.resolve();
  music.setPlaying(true); assert.equal(audio.plays, 1); audio.blocked = false; music.setPlaying(true, true); assert.equal(audio.paused, false);
  const ended = audio.onended!; music.dispose(); ended(); music.setPlaying(true, true);
  assert.equal(audio.plays, 2); assert.equal(audio.src, ''); assert.equal(audio.paused, true); assert.equal(audio.onended, null); assert.equal(audio.onerror, null);
});
