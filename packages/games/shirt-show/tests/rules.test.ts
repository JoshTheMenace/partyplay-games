import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rules } from '../src/server';
import type { State } from '../src/server';
import { artStarters, sloganStarters } from '../src/content';
import { manifest } from '../src/manifest';
import { parseDrawing } from '../../../party-contract/src/index';
import type { Action, Settings } from '../src/model';

const context = { nowMs: 0, phase: 'playing' as const };
const drawing = { strokes: [{ color: '#ff5748', width: 0.012, points: [{ x: 0.123456, y: 0.5 }, { x: 0.8, y: 0.9 }] }] };
function create(count = 5, seed = 42, settings: Settings = { pace: 'standard' }) {
  return rules.create({ roomId: 'room', roundId: 'round', seed, nowMs: 1000, players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Maker ${i}`, color: '#ff5748' })) }, settings);
}
function now(state: State) { return state.deadline - 1; }
function act(state: State, id: string, action: Action) { rules.applyAction(state, id, action, now(state)); }
function deadline(state: State) { rules.tick(state, new Map(), 0.05, state.deadline); }
function fillPhase(state: State) {
  const turnId = state.turnId;
  for (const player of state.players) {
    const base = { turnId, revision: player.work.revision + 1, commit: true };
    if (state.phase === 'draw') act(state, player.id, { type: 'drawing', ...base, drawing });
    else if (state.phase === 'slogan') act(state, player.id, { type: 'slogan', ...base, text: `Private words ${state.slot} ${player.id}` });
    else if (state.phase === 'design') act(state, player.id, { type: 'design', ...base, selection: { artId: player.art[1], sloganId: player.slogans[0], color: 'coral' } });
  }
}
function toDesign(state: State, missing = false) {
  for (let i = 0; i < 4; i++) { if (missing) deadline(state); else fillPhase(state); }
  assert.equal(state.phase, 'design');
}
function toVote(state: State) { toDesign(state); fillPhase(state); deadline(state); assert.equal(state.phase, 'vote'); }
function finish(state: State, voting: boolean) {
  for (let guard = 0; state.phase !== 'gallery' && guard < 50; guard++) {
    if (voting && state.phase === 'vote') {
      const turnId = state.turnId, entry = state.match!.entries[0];
      const voters = state.players.filter(player => rules.playerView(state, player.id, context).canVote);
      for (const voter of voters) act(state, voter.id, { type: 'vote', turnId, designId: entry });
    } else deadline(state);
  }
  assert.equal(state.phase, 'gallery', 'tournament must terminate');
}

test('manifest, default settings, player boundaries and original starters', () => {
  assert.deepEqual(manifest.modes, ['shared-display']);
  assert.deepEqual(manifest.players, { min: 3, max: 10 });
  assert.deepEqual(rules.validateSettings({}), { pace: 'standard' });
  assert.deepEqual(rules.validateSettings({ pace: 'quick' }), { pace: 'quick' });
  for (const value of [null, [], { pace: 'slow' }, { seed: 1 }]) assert.throws(() => rules.validateSettings(value));
  assert.throws(() => create(2)); assert.throws(() => create(11));
  assert.throws(() => create(5, NaN));
  assert.equal(new Set([...artStarters, ...sloganStarters]).size, 44);
  assert.equal(rules.neutralInput(), null); assert.equal(rules.parseInput(null), null);
  assert.throws(() => rules.parseInput({}));
});

for (const count of [3, 5, 10]) {
  test(`${count} players: shuffled pools exclude own work, route each asset once and stay private`, () => {
    for (let seed = 0; seed < 30; seed++) {
      const state = create(count, seed); toDesign(state);
      const allArt: string[] = [], allSlogans: string[] = [];
      for (const player of state.players) {
        const privateView = rules.playerView(state, player.id, context);
        assert.equal(privateView.art.length, 2); assert.equal(privateView.slogans.length, 2);
        assert.ok(privateView.art.every(art => art.owner !== player.id));
        assert.ok(privateView.slogans.every(slogan => slogan.owner !== player.id));
        assert.equal(new Set(privateView.art.map(art => art.owner)).size, 2);
        assert.equal(new Set(privateView.slogans.map(slogan => slogan.owner)).size, 2);
        allArt.push(...privateView.art.map(art => art.id)); allSlogans.push(...privateView.slogans.map(slogan => slogan.id));
        const hidden = state.slogans.find(slogan => !player.slogans.includes(slogan.id))!;
        assert.ok(!JSON.stringify(privateView).includes(hidden.text));
      }
      assert.equal(new Set(allArt).size, count * 2); assert.equal(new Set(allSlogans).size, count * 2);
      const publicPacket = JSON.stringify(rules.publicView(state, context));
      assert.ok(!publicPacket.includes('Private words')); assert.ok(!publicPacket.includes('art-')); assert.ok(!publicPacket.includes('starters'));
      assert.ok(!publicPacket.includes('drawing')); assert.ok(!publicPacket.includes('rng'));
    }
  });

  test(`${count} players: full submitted game, reveal credits, majority votes, scores and final bounded gallery`, () => {
    const state = create(count); toDesign(state); fillPhase(state);
    const reveal = rules.publicView(state, context);
    assert.equal(reveal.phase, 'reveal'); assert.equal(reveal.shirts.length, count);
    assert.equal(reveal.gallery, null);
    for (const shirt of reveal.shirts) {
      assert.ok(shirt.designer !== shirt.art.owner); assert.ok(shirt.designer !== shirt.slogan.owner);
      assert.equal(shirt.automatic, false); assert.equal(shirt.art.fallback, false);
    }
    deadline(state); finish(state, true);
    const result = rules.outcome(state), publicView = rules.publicView(state, context);
    assert.equal(result.complete, true); assert.equal(result.winners.length, 1); assert.equal(result.rows.length, count);
    assert.equal(result.rows[0].playerId, result.winners[0]); assert.equal(result.rows[0].rank, 1);
    assert.equal(result.rows.reduce((total, row) => total + row.score!, 0), (count - 1) * 100 + 300);
    assert.equal(state.history.filter(match => match.policy === 'majority').length, count - 1);
    assert.equal(state.history.filter(match => match.policy === 'bye').length, 2 ** Math.ceil(Math.log2(count)) - count);
    assert.equal(publicView.gallery!.art.length, count * 2); assert.equal(publicView.gallery!.slogans.length, count * 2);
    for (const art of publicView.gallery!.art) assert.deepEqual(parseDrawing(art.drawing), art.drawing);
    for (const player of state.players) assert.deepEqual(rules.playerView(state, player.id, context).art, []);
  });

  test(`${count} players: fully absent round terminates with labeled stock, zero-vote tie policy and byes`, () => {
    const state = create(count); state.players.forEach(player => rules.onPresenceChange(state, player.id, false, 1000));
    finish(state, false);
    assert.ok(state.art.every(art => art.fallback && art.owner === null));
    assert.ok(state.slogans.every(slogan => slogan.fallback && slogan.owner === null));
    assert.ok(state.designs.every(design => design.automatic));
    const contests = state.history.filter(match => match.policy !== 'bye');
    assert.equal(contests.length, count - 1);
    for (const match of contests) {
      assert.equal(match.policy, 'tie-priority'); assert.deepEqual(match.votes, [0, 0]);
      const expected = state.designs.filter(design => match.entries.includes(design.id)).sort((a, b) => a.priority - b.priority)[0];
      assert.equal(match.winner, expected.id);
    }
    assert.equal(state.designs.find(design => design.id === state.champion)!.priority, 1);
    assert.equal(rules.outcome(state).rows.length, count);
  });
}

test('same seed and action schedule replay exactly; a different seed changes allocation', () => {
  const a = create(), b = create(), c = create(5, 12345);
  toDesign(a); toDesign(b); toDesign(c);
  assert.deepEqual(a, b); assert.notDeepEqual(a.players.map(player => player.art), c.players.map(player => player.art));
  fillPhase(a); fillPhase(b); finish(a, true); finish(b, true); assert.deepEqual(a, b);
});

test('draft saves recover after disconnect, remain private and are used on the deadline', () => {
  const state = create();
  const saved: Action = { type: 'drawing', turnId: state.turnId, revision: 1, commit: false, drawing };
  act(state, 'p0', saved);
  rules.onPresenceChange(state, 'p0', false, now(state)); rules.onPresenceChange(state, 'p0', true, now(state));
  assert.deepEqual(rules.playerView(state, 'p0', context).drawing, parseDrawing(drawing));
  assert.equal(rules.playerView(state, 'p0', context).revision, 1);
  assert.deepEqual(rules.playerView(state, 'p1', context).drawing, { strokes: [] });
  assert.throws(() => act(state, 'p0', saved), /already saved/);
  deadline(state);
  assert.equal(state.art[0].owner, 'p0'); assert.equal(state.art[0].fallback, false);
  assert.ok(state.art.slice(1).every(art => art.owner === null));
  assert.throws(() => act(state, 'p0', { ...saved, revision: 2 }), /closed/);
  deadline(state);
  act(state, 'p0', { type: 'slogan', turnId: state.turnId, revision: 1, commit: false, text: 'Server saved slogan' });
  assert.equal(rules.playerView(state, 'p0', context).slogan, 'Server saved slogan');
  assert.ok(!JSON.stringify(rules.publicView(state, context)).includes('Server saved slogan'));
  deadline(state); assert.equal(state.slogans[0].owner, 'p0');
  deadline(state);
  const tray = rules.playerView(state, 'p0', context);
  const chosen = { artId: tray.art[1].id, sloganId: tray.slogans[1].id, color: 'lime' as const };
  act(state, 'p0', { type: 'design', turnId: state.turnId, revision: 1, commit: false, selection: chosen });
  rules.onPresenceChange(state, 'p0', false, now(state)); rules.onPresenceChange(state, 'p0', true, now(state));
  assert.deepEqual(rules.playerView(state, 'p0', context).selection, chosen);
  deadline(state);
  assert.equal(state.designs[0].artId, chosen.artId); assert.equal(state.designs[0].color, 'lime'); assert.equal(state.designs[0].automatic, true);
});

test('submitted drawing, slogan and design reject another submission even with a fresh revision', () => {
  const state = create();
  const first: Action = { type: 'drawing', turnId: state.turnId, revision: 1, commit: true, drawing };
  act(state, 'p0', first); assert.throws(() => act(state, 'p0', { ...first, revision: 2 }), /locked/);
  deadline(state); deadline(state);
  const slogan: Action = { type: 'slogan', turnId: state.turnId, revision: 1, commit: true, text: 'Locked words' };
  act(state, 'p0', slogan); assert.throws(() => act(state, 'p0', { ...slogan, revision: 2 }), /locked/);
  deadline(state); deadline(state);
  const player = state.players[0], selection = { artId: player.art[0], sloganId: player.slogans[0], color: 'sky' as const };
  const action: Action = { type: 'design', turnId: state.turnId, revision: 1, commit: true, selection };
  act(state, 'p0', action); assert.throws(() => act(state, 'p0', { ...action, revision: 2 }), /locked/);
});

test('strict parsing rejects spoofed ownership, malformed drawings, empty work, NaN and oversized values', () => {
  const base = { type: 'drawing', turnId: 'turn', revision: 1, commit: true, drawing };
  const invalid = [null, [], {}, { ...base, playerId: 'p1' }, { ...base, owner: 'p1' }, { ...base, revision: NaN }, { ...base, revision: 0 }, { ...base, revision: 10001 }, { ...base, commit: 'yes' }, { ...base, drawing: { strokes: [] } }, { ...base, drawing: { strokes: Array(25).fill(drawing.strokes[0]) } }, { ...base, drawing: { strokes: [{ ...drawing.strokes[0], width: Infinity }] } }, { ...base, drawing: { strokes: [{ ...drawing.strokes[0], color: 'url(https://remote)' }] } }, { ...base, drawing: { strokes: [{ ...drawing.strokes[0], points: [{ x: NaN, y: 0.5 }] }] } }, { ...base, drawing: { strokes: [{ ...drawing.strokes[0], points: [{ x: -1, y: 0.5 }] }] } }, { ...base, drawing: { strokes: [{ ...drawing.strokes[0], points: Array(481).fill({ x: 0.1, y: 0.2 }) }] } }, { ...base, type: 'slogan', drawing: undefined, text: 'x' }, { type: 'slogan', turnId: 'turn', revision: 1, commit: true, text: ' '.repeat(3) }, { type: 'slogan', turnId: 'turn', revision: 1, commit: true, text: 'x'.repeat(73) }, { type: 'slogan', turnId: 'turn', revision: 1, commit: true, text: 'hello\nworld' }, { type: 'cheer', turnId: '' }, { type: 'cheer', turnId: 'turn', score: 100 }];
  for (const raw of invalid) assert.throws(() => rules.parseAction(raw), JSON.stringify(raw));
  assert.deepEqual((rules.parseAction(base) as Extract<Action, { type: 'drawing' }>).drawing, parseDrawing(drawing));
});

test('wrong seat, phase, deadline and forged tray combinations cannot mutate authoritative state', () => {
  const state = create();
  const drawingAction: Action = { type: 'drawing', turnId: state.turnId, revision: 1, commit: true, drawing };
  for (const value of [NaN, Infinity, state.deadline, state.deadline + 1, 999]) assert.throws(() => rules.applyAction(state, 'p0', drawingAction, value));
  assert.throws(() => act(state, 'spectator-host', drawingAction));
  assert.throws(() => act(state, 'p0', { type: 'vote', turnId: state.turnId, designId: 'shirt-0' }));
  toDesign(state);
  const p = state.players[0], valid = { artId: p.art[0], sloganId: p.slogans[0], color: 'cream' as const };
  const snapshot = structuredClone(state);
  for (const selection of [{ ...valid, artId: state.art.find(art => !p.art.includes(art.id))!.id }, { ...valid, sloganId: state.slogans.find(slogan => !p.slogans.includes(slogan.id))!.id }, { ...valid, artId: 'made-up-art' }]) {
    assert.throws(() => act(state, p.id, { type: 'design', turnId: state.turnId, revision: 1, commit: true, selection }), /assigned tray/);
    assert.deepEqual(state, snapshot);
  }
  assert.throws(() => act(state, 'p0', { ...drawingAction, turnId: state.turnId }), /another task/);
  assert.throws(() => rules.parseAction({ type: 'design', turnId: state.turnId, revision: 1, commit: true, selection: { ...valid, owner: 'p1' } }));
  assert.throws(() => rules.parseAction({ type: 'design', turnId: state.turnId, revision: 1, commit: true, selection: { ...valid, color: 'remote-image' } }));
});

test('designers cannot vote on their own matchup; everyone can cheer once; ballots stay secret', () => {
  const state = create(); toVote(state);
  const match = state.match!, target = match.entries[0], designer = state.designs.find(design => design.id === target)!.designer;
  assert.throws(() => act(state, designer, { type: 'vote', turnId: state.turnId, designId: target }), /sit out/);
  act(state, designer, { type: 'cheer', turnId: state.turnId });
  assert.throws(() => act(state, designer, { type: 'cheer', turnId: state.turnId }), /already cheered/);
  const voter = state.players.find(player => rules.playerView(state, player.id, context).canVote)!;
  assert.throws(() => act(state, voter.id, { type: 'vote', turnId: state.turnId, designId: 'missing-shirt' }));
  act(state, voter.id, { type: 'vote', turnId: state.turnId, designId: target });
  assert.throws(() => act(state, voter.id, { type: 'vote', turnId: state.turnId, designId: match.entries[1] }), /already locked/);
  const packet = rules.publicView(state, context);
  assert.equal(packet.match!.voted, 1); assert.equal(packet.match!.cheers, 1);
  assert.ok(!JSON.stringify(packet).includes('"designId"')); assert.ok(!JSON.stringify(packet).includes('"votes"') || packet.history.length > 0);
  assert.equal(rules.playerView(state, voter.id, context).voted, true);
  assert.equal(state.players.reduce((sum, player) => sum + player.score, 0), 0);
});

test('nonzero tied votes use published priority; a bye never gives points', () => {
  const state = create(5); toVote(state);
  const match = state.match!, priority = rules.publicView(state, context).match!.tiePriority;
  assert.equal(state.history.filter(result => result.policy === 'bye').length, 3);
  assert.equal(state.players.reduce((sum, player) => sum + player.score, 0), 0);
  const voters = state.players.filter(player => rules.playerView(state, player.id, context).canVote);
  act(state, voters[0].id, { type: 'vote', turnId: state.turnId, designId: match.entries[0] });
  act(state, voters[1].id, { type: 'vote', turnId: state.turnId, designId: match.entries[1] });
  deadline(state);
  const result = state.history.at(-1)!;
  assert.deepEqual(result.votes, [1, 1]); assert.equal(result.winner, priority); assert.equal(result.policy, 'tie-priority');
  assert.equal(state.players.reduce((sum, player) => sum + player.score, 0), 100);
});

test('all roster sizes terminate for every seeded bracket, with exactly n−1 contests and stable tied ranks', () => {
  for (let count = 3; count <= 10; count++) for (let seed = 0; seed < 25; seed++) {
    const state = create(count, seed); finish(state, false);
    assert.equal(state.history.filter(result => result.policy !== 'bye').length, count - 1);
    assert.equal(new Set(state.history.map(result => result.id)).size, state.history.length);
    const rows = rules.outcome(state).rows;
    for (const row of rows) assert.equal(row.rank, 1 + rows.filter(other => other.score! > row.score!).length);
    const last = structuredClone(state); deadline(state); assert.deepEqual(state, last);
    assert.throws(() => act(state, 'p0', { type: 'cheer', turnId: state.turnId }));
  }
});

test('projections are detached snapshots and reconnect cannot access an unknown seat', () => {
  const state = create(); toDesign(state);
  const view = rules.playerView(state, 'p0', context), original = structuredClone(state);
  view.art[0].drawing.strokes[0].points[0].x = 0;
  view.slogans[0].text = 'mutated'; assert.deepEqual(state, original);
  fillPhase(state);
  const publicView = rules.publicView(state, context), revealed = structuredClone(state);
  publicView.shirts[0].slogan.text = 'changed'; publicView.players[0].score = 999;
  assert.deepEqual(state, revealed);
  assert.throws(() => rules.playerView(state, 'host', context));
  assert.throws(() => rules.onPresenceChange(state, 'host', true, 1));
});

test('quick pace halves timed tasks; huge clock gaps move one visible phase per tick', () => {
  const standard = create(3), quick = create(3, 42, { pace: 'quick' });
  assert.equal(standard.deadline - 1000, 120000); assert.equal(quick.deadline - 1000, 60000);
  rules.tick(standard, new Map(), 0.1, 10 ** 10);
  assert.equal(standard.slot, 1); assert.equal(standard.phase, 'draw'); assert.equal(standard.deadline, 10 ** 10 + 120000);
  assert.throws(() => rules.tick(standard, new Map(), NaN, 1000));
  assert.throws(() => rules.tick(standard, new Map(), 0.1, NaN));
});
