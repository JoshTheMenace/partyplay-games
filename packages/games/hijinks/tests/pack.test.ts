import assert from 'node:assert/strict';
import test from 'node:test';
import { manifest } from '../src/manifest';
import { CUE_LIMIT, createRules, miniApi, rules as realRules } from '../src/server';
import { MINIS, eligible, miniInfo } from '../src/minis/catalog';
import { validateSnapshotCache } from '../../../party-contract/src/snapshot-cache';
import { dealFresh, freshDeck } from '../src/core/server/deck';
import { createNight, type NightOptions } from './harness';
import { fixtureCatalog, fixtureServers, tapBot } from './fixtures/tap';

const rules = createRules({ servers: fixtureServers, catalog: fixtureCatalog });
const night = (options: NightOptions = {}) => createNight({ rules, ...options });
const rejects = (result: { accepted: boolean; reason?: string }, pattern: RegExp) => { assert.equal(result.accepted, false); assert.match(result.reason!, pattern); };

test('manifest, catalog helpers and the real registry wiring', () => {
  assert.equal(manifest.id, 'hijinks');
  assert.deepEqual(manifest.players, { min: 2, max: 10 });
  validateSnapshotCache(manifest.snapshotCache);
  assert.equal(miniInfo('quip-clash')?.title, 'Quip Clash');
  assert.ok(eligible(miniInfo('quip-clash')!, 3) && !eligible(miniInfo('quip-clash')!, 2));
  for (const info of MINIS) assert.equal(new Set(MINIS.map(item => item.id)).size, MINIS.length, info.id);
  assert.deepEqual(realRules.validateSettings({}), { family: true, timers: 'standard', readAloud: false, tutorials: true, startWith: '' });
});

test('settings: defaults, strict validation, startWith', () => {
  assert.deepEqual(rules.validateSettings(undefined), { family: true, timers: 'standard', readAloud: false, tutorials: true, startWith: '' });
  assert.equal(rules.validateSettings({ timers: 'speedy', startWith: 'tap' }).startWith, 'tap');
  for (const bad of [{ timers: 'warp' }, { family: 'yes' }, { startWith: 'ghost' }, { startWith: 'nope' }, { extra: 1 }, [], 'x']) assert.throws(() => rules.validateSettings(bad));
  const n = night({ settings: { startWith: 'tap' } });
  assert.equal(n.state.phase, 'intro'); assert.equal(n.state.current?.id, 'tap');
  assert.equal(night({ players: 3, settings: { startWith: 'big' } }).state.phase, 'menu', 'ineligible startWith opens the menu');
});

test('lobby choice and avatar assignment', () => {
  const parse = rules.parseLobbyChoice!;
  assert.deepEqual(parse(undefined, false), {});
  assert.deepEqual(parse({}, false), {});
  assert.deepEqual(parse({ avatar: 15 }, true), { avatar: 15 });
  for (const bad of [{ avatar: 16 }, { avatar: -1 }, { avatar: 1.5 }, { avatar: 2, hat: 1 }, 'x']) assert.throws(() => parse(bad, false));
  assert.throws(() => parse(undefined, true), /avatar/); assert.throws(() => parse({}, true), /avatar/);
  assert.deepEqual(night().state.players.map(p => p.avatar), [0, 1, 2, 3], 'index defaults when absent');
  assert.deepEqual(night({ avatars: [5, 5, undefined, 0] }).state.players.map(p => p.avatar), [5, 1, 2, 0], 'duplicates take the first free avatar');
});

test('parseAction is strict', () => {
  assert.deepEqual(rules.parseAction({ k: 'mini', session: 2, a: { x: 1 } }), { k: 'mini', session: 2, a: { x: 1 } });
  for (const bad of [null, [], { k: 'dance' }, { k: 'lock', x: 1 }, { k: 'vote' }, { k: 'vote', game: '' }, { k: 'vote', game: 'x'.repeat(41) },
    { k: 'skip', session: -1 }, { k: 'next', session: 1.5 }, { k: 'mini', session: 1, a: [] }, { k: 'mini', session: 1, a: { t: 'x'.repeat(30000) } }])
    assert.throws(() => rules.parseAction(bad), JSON.stringify(bad));
  assert.throws(() => realRules.parseInput({}));
});

test('menu voting: eligibility, live countdown, lock and VIP rules', () => {
  const n = night();
  assert.equal(n.state.music, 'menu'); assert.equal(n.vip(), 'p0');
  rejects(n.tryAct('p1', { k: 'vote', game: 'nope' }), /library/);
  rejects(n.tryAct('p1', { k: 'vote', game: 'ghost' }), /not ready/);
  rejects(n.tryAct('p1', { k: 'vote', game: 'big' }), /5–10 players/);
  rejects(n.tryAct('p0', { k: 'lock' }), /Vote/);
  n.act('p1', { k: 'vote', game: 'tap' });
  assert.equal(n.me('p1').vote, 'tap'); assert.equal(n.me('p0').vote, null);
  assert.deepEqual(n.view().menu, { votes: { p1: 'tap' }, lockAt: null });
  rejects(n.tryAct('p1', { k: 'lock' }), /VIP/);
  rejects(n.tryAct('p1', { k: 'end' }), /VIP/);
  for (const id of ['p0', 'p2', 'p3']) n.act(id, { k: 'vote', game: 'tap' });
  n.advance(100);
  const lockAt = n.view().menu!.lockAt!;
  assert.equal(lockAt, n.now + 4000);
  n.advance(3800); assert.equal(n.state.phase, 'menu');
  n.advance(200); assert.equal(n.state.phase, 'intro'); assert.equal(n.state.current?.id, 'tap'); assert.equal(n.view().menu, null);
  rejects(n.tryAct('p0', { k: 'vote', game: 'tap' }), /closed/);
  rejects(n.tryAct('p0', { k: 'end' }), /Finish/);
  const big = night({ players: 6 });
  big.act('p0', { k: 'vote', game: 'big' }); big.act('p0', { k: 'lock' });
  assert.equal(big.state.current?.id, 'big', 'VIP can lock before everyone votes');
});

test('ties resolve with the seeded RNG, deterministically', () => {
  const pick = (seed: number) => {
    const n = night({ seed, players: 6 });
    n.act('p0', { k: 'vote', game: 'tap' }); n.act('p1', { k: 'vote', game: 'big' }); n.act('p2', { k: 'vote', game: 'tap' }); n.act('p3', { k: 'vote', game: 'big' });
    n.act('p0', { k: 'lock' });
    return n.state.current!.id;
  };
  const picks = Array.from({ length: 12 }, (_, seed) => pick(seed));
  assert.deepEqual(picks, Array.from({ length: 12 }, (_, seed) => pick(seed)));
  assert.deepEqual(new Set(picks), new Set(['tap', 'big']));
  const n = night({ players: 6 });
  for (const [id, game] of [['p0', 'tap'], ['p1', 'big'], ['p2', 'big']]) n.act(id!, { k: 'vote', game });
  n.act('p0', { k: 'lock' });
  assert.equal(n.state.current!.id, 'big', 'a clear leader always wins');
});

test('VIP hands off on disconnect and the countdown ignores offline seats', () => {
  const n = night();
  n.connect('p0', false);
  assert.equal(n.vip(), 'p1');
  for (const id of ['p1', 'p2', 'p3']) n.act(id, { k: 'vote', game: 'tap' });
  rejects(n.tryAct('p0', { k: 'lock' }), /VIP/);
  n.advance(100); assert.notEqual(n.view().menu!.lockAt, null);
  n.connect('p0', true); assert.equal(n.vip(), 'p0');
  n.act('p0', { k: 'lock' }); assert.equal(n.state.phase, 'intro');
  for (const id of n.ids) n.connect(id, false);
  assert.equal(n.vip(), null);
});

test('intro: duration, majority skip, VIP skip, stale skip', () => {
  const n = night();
  n.startMini('tap');
  assert.equal(n.state.phase, 'mini');
  const timed = night();
  timed.act('p0', { k: 'vote', game: 'tap' }); timed.act('p0', { k: 'lock' });
  const intro = timed.view().intro!;
  assert.equal(intro.endsAt - timed.now, 9000, 'no recordings → minimum 9 s');
  assert.deepEqual(timed.view().cues.filter(c => c.kind === 'vo').map(c => c.id).slice(-2), ['tap.intro', 'tap.rules']);
  const session = timed.state.current!.session;
  timed.act('p1', { k: 'skip', session }); timed.act('p1', { k: 'skip', session });
  timed.act('p2', { k: 'skip', session });
  assert.deepEqual(timed.view().intro!.skips, ['p1', 'p2']); assert.equal(timed.state.phase, 'intro', 'half is not a majority');
  rejects(timed.tryAct('p3', { k: 'skip', session: session + 1 }), /over/);
  timed.connect('p3', false); timed.advance(100);
  assert.equal(timed.state.phase, 'mini', 'a disconnect can complete the majority');
  rejects(timed.tryAct('p3', { k: 'skip', session }), /over/);
  const quick = night({ settings: { tutorials: false } });
  quick.act('p0', { k: 'vote', game: 'tap' }); quick.act('p0', { k: 'lock' });
  assert.equal(quick.view().intro!.endsAt - quick.now, 3000);
  assert.equal(quick.view().cues.filter(c => c.kind === 'vo' && c.id.startsWith('tap.')).length, 0);
  quick.advance(2900); assert.equal(quick.state.phase, 'intro'); quick.advance(100); assert.equal(quick.state.phase, 'mini');
});

test('mini routing, stale sessions, podium trophies and continue', () => {
  const n = night();
  n.startMini('tap');
  const first = n.state.current!.session, turn = n.mini().turn;
  rejects(n.tryAct('p1', { k: 'mini', session: first - 1, a: { turn, n: 1 } }), /already finished/);
  rejects(n.trySend('p1', { turn: 'old', n: 1 }), /turn is over/);
  n.send('p1', { turn, n: 2 });
  assert.deepEqual(n.mini().tapped, ['p1']); assert.equal(n.miniMe('p1').tapped, true);
  n.assertHidden(n.miniMe('p1').secret); n.assertHiddenFrom('p2', n.miniMe('p1').secret);
  const { result, accepted } = n.runMini(tapBot);
  assert.equal(accepted, 3);
  assert.deepEqual(result.winners, ['p3']); assert.deepEqual(result.scores, { p0: 1, p1: 2, p2: 3, p3: 4 });
  assert.deepEqual(result.awards, [{ title: 'Tapper', playerId: 'p0' }], 'awards for unknown players are dropped');
  assert.equal(n.view().mini, null); assert.equal(n.me('p1').mini, null); assert.equal(n.state.music, 'podium');
  assert.deepEqual(n.view().trophies, { p0: 0, p1: 0, p2: 0, p3: 1 }); assert.deepEqual(n.view().played, ['tap']);
  rejects(n.trySend('p1', { turn, n: 1 }), /already finished/);
  rejects(n.tryAct('p1', { k: 'next', session: first }), /VIP/);
  rejects(n.tryAct('p0', { k: 'next', session: first + 1 }), /moving on/);
  n.toMenu();
  assert.equal(n.state.phase, 'menu'); assert.equal(n.state.music, 'menu'); assert.equal(n.view().current?.id, 'tap');
  n.startMini('tap');
  assert.equal(n.state.current!.session, first + 1);
  rejects(n.tryAct('p1', { k: 'mini', session: first, a: { turn, n: 1 } }), /already finished/);
  n.runMini(tapBot); n.advance(11_900); assert.equal(n.state.phase, 'podium'); n.advance(100); assert.equal(n.state.phase, 'menu', 'podium times out after 12 s');
  assert.equal(n.view().trophies.p3, 2);
});

test('ending the night: outcome ranks trophies then points', () => {
  const n = night({ players: 3 });
  assert.equal(n.rules.outcome(n.state).complete, false);
  n.startMini('tap');
  n.send('p0', { turn: n.mini().turn, n: 9 }); n.send('p1', { turn: n.mini().turn, n: 9 }); n.send('p2', { turn: n.mini().turn, n: 1 });
  n.advance(100); assert.equal(n.state.phase, 'podium');
  rejects(n.tryAct('p0', { k: 'end' }), /Finish/);
  n.startMini('tap');
  n.runMini(tapBot);
  n.endNight();
  const outcome = n.rules.outcome(n.state);
  assert.deepEqual(outcome.winners, ['p0', 'p1', 'p2'], 'tied trophy leaders all win');
  assert.deepEqual(outcome.rows.map(r => r.playerId), ['p1', 'p0', 'p2']);
  assert.deepEqual(outcome.rows.map(r => r.rank), [1, 1, 1]);
  assert.equal(outcome.rows[0]!.label, '1 trophy · 11 pts');
  rejects(n.tryAct('p0', { k: 'vote', game: 'tap' }), /over/);
  const empty = night(); empty.endNight();
  assert.deepEqual(empty.rules.outcome(empty.state).winners, [], 'no trophies, no winners');
});

test('minigame exceptions end that game with zero scores and keep the night alive', () => {
  const errors: unknown[][] = [], original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    for (const boom of ['tick', 'view'] as const) {
      const n = night();
      n.startMini('tap');
      n.send('p1', { turn: n.mini().turn, n: 3 });
      n.send('p0', { turn: n.mini().turn, boom });
      if (boom === 'view') { assert.equal(n.view().mini, null); assert.equal(n.view().mini, null); rejects(n.trySend('p2', { turn: 'x' }), /snag/); }
      n.advance(100);
      assert.equal(n.state.phase, 'podium');
      assert.deepEqual(n.state.podium!.result.scores, { p0: 0, p1: 0, p2: 0, p3: 0 });
      assert.deepEqual(n.state.podium!.result.winners, []); assert.match(n.state.podium!.result.headline!, /next/);
      n.toMenu(); n.startMini('tap'); n.runMini(tapBot);
      assert.equal(n.state.trophies.p3, 1, 'the night continues');
    }
    const dud = night(); dud.startMini('dud'); dud.advance(100);
    assert.equal(dud.state.phase, 'podium'); assert.deepEqual(dud.view().played, ['dud']);
    assert.equal(errors.length, 3, 'each failure logs once');
  } finally { console.error = original; }
});

test('cues: monotonic seq, bounded log, read-aloud only when enabled', () => {
  const n = night();
  n.startMini('tap');
  for (let i = 0; i < 40; i++) miniApi(n.state).sfx('tick');
  n.runMini(tapBot);
  const seqs = n.view().cues.map(cue => cue.seq), last = seqs.at(-1)!;
  assert.equal(seqs.length, CUE_LIMIT);
  assert.ok(seqs.every((seq, i) => i === 0 || seq === seqs[i - 1]! + 1));
  n.toMenu();
  assert.ok(n.view().cues.at(-1)!.seq > last);
  const quiet = night(), loud = night({ settings: { readAloud: true } });
  miniApi(quiet.state).speak('  hello  '); miniApi(loud.state).speak('  hello  ');
  assert.equal(quiet.view().cues.some(c => c.kind === 'speak'), false);
  assert.deepEqual(loud.view().cues.at(-1), { seq: loud.view().cues.at(-1)!.seq, at: loud.now, kind: 'speak', id: 'hello' });
  assert.equal(miniApi(loud.state).seconds(10), 10_000);
  assert.equal(miniApi(night({ settings: { timers: 'speedy' } }).state).seconds(10), 7000);
  assert.equal(miniApi(night({ settings: { timers: 'relaxed' } }).state).seconds(10), 15_000);
  assert.equal(miniApi(loud.state).say('host.unknown-line'), 0);
});

test('media store: revisions, removal, cleared between minigames', () => {
  const n = night();
  n.startMini('tap');
  const turn = n.mini().turn, base = n.view().mediaRev;
  n.send('p1', { turn, media: 'put' });
  assert.deepEqual(n.view().media, { 'doodle-p1': { by: 'p1' } }); assert.equal(n.view().mediaRev, base + 1);
  n.send('p1', { turn, media: 'remove' }); n.send('p1', { turn, media: 'remove' });
  assert.equal(n.view().mediaRev, base + 2); assert.deepEqual(n.view().media, {});
  n.send('p2', { turn, media: 'put' });
  n.runMini(tapBot);
  assert.deepEqual(Object.keys(n.view().media), ['doodle-p2'], 'the podium may still show media');
  n.toMenu();
  assert.deepEqual(n.view().media, {}); assert.equal(n.view().mediaRev, base + 4);
});

for (const players of [2, 10]) test(`${players} players: full night join → minigame → podium → end`, () => {
  const n = night({ players });
  assert.equal(n.view().players.length, players);
  n.startMini('tap');
  const { result } = n.runMini(tapBot);
  assert.deepEqual(result.winners, [`p${players - 1}`]);
  if (players === 10) { n.toMenu(); n.startMini('big'); n.runMini(tapBot, { skip: ['p9'] }); assert.equal(n.state.trophies.p8, 1); }
  n.endNight();
  const outcome = n.rules.outcome(n.state);
  assert.deepEqual(outcome.winners, players === 10 ? ['p8', 'p9'] : ['p1']);
  assert.deepEqual(outcome.rows.filter(r => r.rank === 1).map(r => r.playerId).sort(), outcome.winners, 'only trophy leaders share 1st');
  assert.equal(outcome.rows[outcome.winners.length]!.rank, outcome.winners.length + 1, 'points break ties below the leaders');
});

test('real pack: quip-clash ineligible without its server, never crashes the menu', () => {
  const n = createNight({ players: 3 });
  const result = n.tryAct('p0', { k: 'vote', game: 'quip-clash' });
  if (!result.accepted) assert.match(result.reason!, /not ready/);
  n.endNight();
});

test('night memory decks: unused content first, used content only once the bank runs out, scoped per minigame', () => {
  const n = night();
  n.startMini('tap');
  const api = miniApi(n.state), bank = ['a', 'b', 'c', 'd', 'e'];
  const first = dealFresh(api, bank, 3), second = dealFresh(api, bank, 3);
  assert.equal(new Set(first).size, 3);
  assert.deepEqual(second.slice(0, 2).sort(), bank.filter(x => !first.includes(x)).sort(), 'the two unused cards come first');
  assert.ok(first.includes(second[2]!), 'then a used one');
  assert.deepEqual(freshDeck(api, bank).length, 5);
  assert.ok(bank.every(x => api.used.has(x)));
  assert.deepEqual(n.state.used, { tap: [...first, ...second.slice(0, 2)] });
});
