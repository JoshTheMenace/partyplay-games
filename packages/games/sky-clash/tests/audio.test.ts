import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { AUDIO_ROOT, BATTLE_TRACKS, CueTracker, LOBBY_TRACK, SAMPLES, audioMode, eventCues } from '../src/audio';
import type { EventKind, GameEvent, HitEffect, View } from '../src/model';
const root = new URL(`../../../../public${AUDIO_ROOT}`, import.meta.url);
const view = (frame: number, events: Partial<GameEvent>[] = [], extra: Partial<View> = {}): View => ({
  turnId: 't1', phase: 'fight', phaseEndsAt: 0, endsAt: 0, frame, stageId: 'battlefield', stageTick: frame, hazards: true, teams: false, stocks: 4, fighters: [], projectiles: [],
  events: events.map((e, i) => ({ id: i, kind: 'hit', frame, x: 0, y: 0, ...e }) as GameEvent), ...extra,
});
const ev = (kind: EventKind, extra: Partial<GameEvent> = {}): GameEvent => ({ id: 3, kind, frame: 0, x: 0, y: 0, ...extra });
test('the user’s five tracks are intact (one lobby, four battle) and every cue is a small WAV', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as { music: { role: string; file: string; sha256: string }[] };
  assert.deepEqual(manifest.music.filter(t => t.role === 'lobby').map(t => t.file), [LOBBY_TRACK]); assert.deepEqual(manifest.music.filter(t => t.role === 'battle').map(t => t.file), [...BATTLE_TRACKS]);
  for (const track of manifest.music) assert.equal(createHash('sha256').update(readFileSync(new URL(track.file, root))).digest('hex'), track.sha256, track.file);
  for (const file of Object.values(SAMPLES)) { assert.equal(readFileSync(new URL(file, root)).toString('ascii', 0, 4), 'RIFF', file); assert.ok(statSync(new URL(file, root)).size < 90_000, file); }
});
test('the first snapshot is a baseline: reconnects and duplicate snapshots never replay the fight', () => {
  const tracker = new CueTracker(), v = view(100, [{ id: 7, kind: 'ko' }, { id: 8, kind: 'hit', power: 1 }]);
  assert.deepEqual(tracker.next(v), []); assert.deepEqual(tracker.next(v), [], 'duplicate snapshot');
  assert.deepEqual(tracker.next(view(102, [{ id: 7, kind: 'ko' }, { id: 8, kind: 'hit' }])), [], 'same ids in a newer snapshot');
  assert.deepEqual(tracker.next(view(104, [{ id: 8, kind: 'hit' }, { id: 9, kind: 'shield' }])).map(c => c.sound), ['block']);
});
test('round changes, frame regressions and long gaps reset the baseline', () => {
  const tracker = new CueTracker(); tracker.next(view(10));
  assert.deepEqual(tracker.next(view(12, [{ id: 1, kind: 'jump' }], { turnId: 't2' })), [], 'new round');
  assert.deepEqual(tracker.next(view(400, [{ id: 2, kind: 'jump' }], { turnId: 't2' })), [], 'long stall');
  assert.deepEqual(tracker.next(view(300, [{ id: 3, kind: 'jump' }], { turnId: 't2' })), [], 'frame went backwards');
  assert.equal(tracker.next(view(302, [{ id: 4, kind: 'jump' }], { turnId: 't2' })).length, 1);
});
test('GO and GAME cue once on the transitions this mount saw', () => {
  const tracker = new CueTracker(); tracker.next(view(0, [], { phase: 'countdown' }));
  assert.deepEqual(tracker.next(view(2)).map(c => c.sound), ['go']);
  assert.deepEqual(tracker.next(view(4, [], { phase: 'complete' })).map(c => c.sound), ['end']); assert.deepEqual(tracker.next(view(6, [], { phase: 'complete' })), []);
});
test('hit strength drives gain, pitch and the heavy layer; effects vary pitch and add a signature layer', () => {
  const soft = eventCues(ev('hit', { power: .1 })), hard = eventCues(ev('hit', { power: 1 }));
  assert.ok(hard[0].gain > soft[0].gain); assert.ok(hard[0].rate < soft[0].rate);
  assert.ok(hard.some(c => c.sound === 'heavy') && !soft.some(c => c.sound === 'heavy'));
  const at = (effect: HitEffect) => eventCues(ev('hit', { power: .5, effect }));
  assert.ok(at('darkness')[0].rate < at('star')[0].rate);
  assert.ok(at('coin').some(c => c.sound === 'coin')); assert.ok(at('electric').some(c => c.sound === 'zap')); assert.ok(at('fire').some(c => c.sound === 'burn')); assert.ok(at('slash').some(c => c.sound === 'swish'));
  assert.ok(eventCues(ev('hit', { x: 40 }))[0].pan <= .8); assert.equal(eventCues(ev('hazard-warn', { x: 40 }))[0].pan, 0, 'warnings are centered');
});
test('every event kind that should be heard has a cue, all inside safe ranges', () => {
  const kinds: EventKind[] = ['hit', 'shield', 'parry', 'shieldbreak', 'ko', 'jump', 'airjump', 'land', 'swing', 'projectile', 'grab', 'throw', 'tech', 'ledge', 'respawn', 'counter', 'reflect', 'absorb', 'armor', 'clash', 'dodge', 'hazard-warn', 'hazard', 'taunt', 'sudden-death', 'star-ko'];
  for (const kind of kinds) { const cues = eventCues(ev(kind, { x: -30, power: 1 })); assert.ok(cues.length, kind); for (const c of cues) assert.ok(c.gain >= 0 && c.gain <= 1 && c.rate >= .35 && c.rate <= 2.5 && Math.abs(c.pan) <= .8, kind); }
  const tracker = new CueTracker(); tracker.next(view(0));
  assert.ok(tracker.next(view(2, Array.from({ length: 40 }, (_, i) => ({ id: i + 1, kind: 'hit' as const })))).length <= 16, 'a burst is capped');
});
test('music follows the room phase', () => {
  assert.equal(audioMode('lobby', null), 'lobby'); assert.equal(audioMode('preparing', null), 'lobby');
  assert.equal(audioMode('playing', view(0, [], { phase: 'countdown' })), 'lobby'); assert.equal(audioMode('playing', view(0)), 'battle'); assert.equal(audioMode('playing', view(0, [], { phase: 'sudden' })), 'battle');
  assert.equal(audioMode('playing', view(0, [], { phase: 'complete' })), 'hush'); assert.equal(audioMode('results', null), 'results'); assert.equal(audioMode('picker', null), 'silent');
});
