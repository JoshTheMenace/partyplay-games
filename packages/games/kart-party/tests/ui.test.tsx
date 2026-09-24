/* UI tests: input composition (pure) plus server-side renders of every view with max-roster fixtures. */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { rules } from '../src/server';
import { decodeRaceView } from '../src/net/wire';
import { InputComposer, keyBinding, keySteer, readPad, steerFromDrag } from '../src/ui/input';
import { Controller } from '../src/ui/Controller';
import { Lobby } from '../src/ui/Lobby';
import { partyAwards, Results } from '../src/ui/Results';
import { SettingsPanel } from '../src/ui/Settings';
import { formatTime } from '../src/ui/common';
import { Instructions } from '../src/ui/Instructions';
import { trackOutline } from '../src/ui/Minimap';
import { TRACK_DEFS, TRACK_IDS } from '../src/tracks/index';
import { buildTrack } from '../src/sim/track';
import type { Input, Race, RaceEvent, RaceView, Settings } from '../src/sim/types';
import type { RosterPlayer } from '../../../party-contract/src/protocol';

// Hud.tsx and client.tsx import the stylesheet: stub .css, then import those modules dynamically.
register('data:text/javascript,export async function load(url, ctx, next) { return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, ctx); }');

const NAMES = ['Maximilian Storm', 'Alexandria Quinn', 'Bartholomew Lee', 'Christopher Rays', 'Anastasia Belle', 'Wolfgang Amadeus', 'Gwendolyn Parker', 'Jo', 'Sam', 'WWWWWWWWWWWWWWWW'];
const settings = (extra: Partial<Settings> = {}) => rules.validateSettings({ gridSize: 10, ...extra });
function makeRace(humans = 1, extra: Partial<Settings> = {}): Race {
  const players = Array.from({ length: humans }, (_, i) => ({ id: `p${i}`, name: NAMES[i], color: '#ff5748', lobbyChoice: { character: i % 8, kart: 'bolt' } }));
  return rules.create({ roomId: 'r', roundId: 'u', players, seed: 5, nowMs: 0 }, settings(extra));
}
const view = (race: Race) => decodeRaceView(rules.publicView(race, { nowMs: 0, phase: 'playing' }));
const count = (html: string, needle: string) => html.split(needle).length - 1;
const noop = () => {};
const ctlProps = (race: RaceView, playerId: string, isHost = false) => ({ roomId: 'r', roundId: 'u', playerId, viewRole: 'controller' as const, isHost, publicView: race, privateView: null, connected: true,
  serverNowMs: () => 0, setInput: noop, releaseInput: noop, sendAction: async () => ({ accepted: true }), assetsReady: noop });

test('composer: presses become counters, every change bumps seq, nothing is emitted when unchanged', () => {
  const sent: Input[] = [], c = new InputComposer(i => sent.push(i));
  c.hold('drift', 'k:Space', true);
  assert.deepEqual(sent.at(-1), { steer: 0, drift: true, brake: false, item: false, hop: 1, fire: 0, seq: 1 });
  c.hold('drift', 't:drift:1', true);                     // a second source holding drift is not a new press
  assert.equal(sent.length, 1);
  c.hold('drift', 'k:Space', false); c.hold('drift', 't:drift:1', false);
  assert.equal(sent.at(-1)!.drift, false); assert.equal(sent.at(-1)!.hop, 1);
  c.hold('item', 'k:KeyE', true); c.hold('item', 'k:KeyE', false); c.hold('item', 'k:KeyE', true);
  assert.equal(sent.at(-1)!.fire, 2); assert.equal(sent.at(-1)!.item, true);
  c.steer('k:ArrowLeft', -1); c.steer('k:ArrowRight', 1);  // opposite keys cancel
  assert.equal(sent.at(-1)!.steer, 0);
  c.steer('k:ArrowRight', 0); c.steer('pad', -.7);
  assert.equal(sent.at(-1)!.steer, -1);                   // sources sum and clamp
  const seqs = sent.map(i => i.seq);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1));
  const before = sent.length; c.steer('pad', -.7); c.hold('item', 'k:KeyE', true); assert.equal(sent.length, before);
});

test('composer: clear releases held sources but keeps the counters; seed continues the server counters', () => {
  const sent: Input[] = [], c = new InputComposer(i => sent.push(i));
  c.seed(254, 9, 40); c.flush();
  assert.deepEqual(sent[0], { steer: 0, drift: false, brake: false, item: false, hop: 254, fire: 9, seq: 41 });
  c.hold('drift', 'a', true); c.hold('brake', 'b', true); c.steer('t:steer', .5); c.hold('item', 'g:x', true);
  assert.equal(sent.at(-1)!.hop, 255);
  c.clear('g:');
  assert.equal(sent.at(-1)!.item, false); assert.equal(sent.at(-1)!.drift, true); assert.equal(c.neutral, false);
  c.clear();
  assert.deepEqual({ ...sent.at(-1)!, seq: 0 }, { steer: 0, drift: false, brake: false, item: false, hop: 255, fire: 10, seq: 0 });
  assert.equal(c.neutral, true);
  c.hold('drift', 'a', true); assert.equal(sent.at(-1)!.hop, 0);  // wraps at 256
  c.seed(1, 1, 1); assert.equal(sent.at(-1)!.hop, 0);                // seeding after sending is ignored
});

test('steering, keys and gamepad mapping', () => {
  assert.equal(steerFromDrag(3, 60), 0);
  assert.equal(steerFromDrag(60, 60), 1); assert.equal(steerFromDrag(-200, 60), -1);
  assert.ok(steerFromDrag(30, 60) > 0 && steerFromDrag(30, 60) < .5);
  assert.equal(keySteer(0), .35); assert.equal(keySteer(200), .68); assert.equal(keySteer(400), 1); assert.equal(keySteer(2000), 1);   // taps are gentle, holds build to full lock
  assert.deepEqual(keyBinding('ArrowLeft'), { steer: -1 }); assert.deepEqual(keyBinding('D'), { steer: 1 });
  assert.deepEqual(keyBinding(' '), { hold: 'drift' }); assert.deepEqual(keyBinding('Shift'), { hold: 'drift' });
  assert.deepEqual(keyBinding('Enter'), { hold: 'item' }); assert.deepEqual(keyBinding('e'), { hold: 'item' });
  assert.deepEqual(keyBinding('ArrowDown'), { hold: 'brake' }); assert.deepEqual(keyBinding('h'), { honk: true });
  assert.equal(keyBinding('ArrowUp'), null);
  const b = (...on: number[]) => Array.from({ length: 16 }, (_, i) => ({ pressed: on.includes(i) }));
  assert.deepEqual(readPad({ axes: [.1], buttons: b(0, 5) }), { steer: 0, drift: true, item: true, brake: false, honk: false });
  assert.equal(readPad({ axes: [1], buttons: b(1) }).steer, 1);
  assert.equal(readPad({ axes: [0], buttons: b(14) }).steer, -1);
});

test('phone controller (TV mode): steer zone, drift/item/brake, no text captions, and a status strip', () => {
  const race = makeRace(2), me = race.racers.find(r => r.id === 'p1')!;
  me.item = 'triple-nitro'; me.itemCount = 3; me.drift = 1; me.driftTier = 2; me.driftCharge = 3;
  const html = renderToStaticMarkup(<Controller {...ctlProps(view(race), 'p1')}/>);
  assert.match(html, /kp2-ctl-full/);
  assert.match(html, /Steering area/);
  assert.match(html, /aria-label="Drift and hop \(hold\)"/);
  assert.match(html, /kp2-drift is-drifting tier-2/);
  assert.match(html, /Use Triple Nitro/); assert.match(html, /×3/);
  assert.match(html, /Brake and reverse/); assert.doesNotMatch(html, /aria-label="Honk"|kp2-stick-hint|grab a box|tap to use/);
  assert.match(html, /kp2-status/); assert.match(html, /Alexandria Quinn/); assert.match(html, /\/10/);
  assert.match(html, /Ready/);                                              // countdown on the phone
  me.driftCharge = 2.3;                                                     // halfway from orange (1.6) to purple (3)
  const ring = Number(/stroke-dasharray="([\d.]+) /.exec(renderToStaticMarkup(<Controller {...ctlProps(view(race), 'p1')}/>))?.[1]);
  assert.ok(Math.abs(ring - 50) < 2, `drift ring ${ring}% follows PHYSICS.driftTiers`);
});

test('formatTime rounds once: never ":60.00"', () => {
  assert.equal(formatTime(119.996), '2:00.00'); assert.equal(formatTime(59.999), '1:00.00');
  assert.equal(formatTime(61.234), '1:01.23'); assert.equal(formatTime(0), '0:00.00'); assert.equal(formatTime(null), '--:--.--');
});

test('controller item states: roulette, holdable trailing, empty slot', () => {
  const race = makeRace(2), me = race.racers.find(r => r.id === 'p1')!;
  me.rollT = 1; me.item = 'bomb';
  assert.match(renderToStaticMarkup(<Controller {...ctlProps(view(race), 'p1')}/>), /Rolling an item/);
  me.rollT = 0; me.item = 'peel'; me.trailing = true;
  const trailing = renderToStaticMarkup(<Controller {...ctlProps(view(race), 'p1')}/>);
  assert.match(trailing, /is-trailing/); assert.match(trailing, /hold to trail behind/);
  me.item = null; me.trailing = false;
  assert.match(renderToStaticMarkup(<Controller {...ctlProps(view(race), 'p1')}/>), /kp2-item is-empty/);
});

test('controller: personal mode overlays controls without the status strip; a desktop host gets keyboard only', () => {
  const personal = view(makeRace(6, { views: 'personal' })), g = globalThis as { matchMedia?: unknown };
  g.matchMedia = (q: string) => ({ matches: q === '(pointer: coarse)', addEventListener: noop, removeEventListener: noop });
  const html = renderToStaticMarkup(<Controller {...ctlProps(personal, 'p2')}/>);
  delete g.matchMedia;
  assert.match(html, /kp2-ctl-overlay/); assert.doesNotMatch(html, /kp2-status/); assert.match(html, /kp2-drift/);
  assert.match(renderToStaticMarkup(<Controller {...ctlProps(personal, 'p2')}/>), /kp2-ctl-keys/);   // a laptop in personal mode
  // node has no (pointer: coarse): a hosting desktop in TV mode drives with keys/gamepad and draws nothing extra.
  const host = renderToStaticMarkup(<Controller {...ctlProps(view(makeRace(2)), 'p0', true)}/>);
  assert.match(host, /kp2-ctl-keys/); assert.doesNotMatch(host, /kp2-pad/);
});

test('viewport HUD: rank, lap, item slot, timer, final-lap banner, respawn, ink and finish', async () => {
  const { ViewportHud } = await import('../src/ui/Hud');
  const race = makeRace(1); race.phase = 'racing'; race.time = 61.25;
  const me = race.racers.find(r => r.id === 'p0')!;
  Object.assign(me, { rank: 3, lap: 3, lapStart: 60.5, item: 'bouncer', respawnT: 1, inkT: 3 });
  const rect = { x: 0, y: 0, w: 1, h: 1 }, v = view(race);
  const html = renderToStaticMarkup(<ViewportHud race={v} racer={v.racers.find(r => r.id === 'p0')!} rect={rect} viewports={1}/>);
  assert.match(html, /Position 3 of 10/); assert.match(html, />3<sup>rd<\/sup>/);
  assert.match(html, /<small>Lap<\/small>3<span>\/3<\/span>/);
  assert.match(html, /aria-label="Bouncer"/); assert.match(html, /1:01\.25/);
  assert.match(html, /Final lap!/); assert.match(html, /Back on track/); assert.match(html, /kp2-ink/);
  Object.assign(me, { finishTime: 128.4, rank: 1, respawnT: 0, inkT: 0 });
  const done = view(race), fin = renderToStaticMarkup(<ViewportHud race={done} racer={done.racers.find(r => r.id === 'p0')!} rect={rect} viewports={4}/>);
  assert.match(fin, /Finish!/); assert.match(fin, /2:08\.40/); assert.match(fin, /kp2-hud-tag/);
});

test('shared HUD: countdown sequence, standings tower, spare-cell panel and spectator label', async () => {
  const { SharedHud } = await import('../src/ui/Hud');
  const race = makeRace(1), text = (t: number) => { race.time = t; return renderToStaticMarkup(<SharedHud race={view(race)} followId={null} mode="split"/>); };
  assert.match(text(-3.4), /n-ready">Ready</); assert.match(text(-2.2), /n-3">3</); assert.match(text(-.4), /n-1">1</);
  assert.match(text(.3), /n-go">GO!</); assert.doesNotMatch(text(1.5), /kp2-count/);
  const full = text(5);
  assert.equal(count(full, '<li '), 10); assert.match(full, /kp2-minimap-full/); assert.match(full, /Maximilian Storm/);
  for (const n of [3, 5, 7, 8, 10]) {
    const r = makeRace(n); r.time = 5;
    const html = renderToStaticMarkup(<SharedHud race={view(r)} followId={null} mode="split"/>);
    assert.match(html, /kp2-spare/, `${n} views`); assert.equal(count(html, '<li '), 10);
  }
  const duo = makeRace(2); duo.time = 5;
  const duoHtml = renderToStaticMarkup(<SharedHud race={view(duo)} followId={null} mode="split"/>);
  assert.doesNotMatch(duoHtml, /kp2-tower/); assert.match(duoHtml, /kp2-minimap-duo/);
  const spec = makeRace(8, { views: 'personal' }); spec.time = 5;
  assert.match(renderToStaticMarkup(<SharedHud race={view(spec)} followId="p3" mode="spectator"/>), /Following.*Christopher Rays/);
});

test('course outlines are finite SVG paths for every track', () => {
  for (const id of TRACK_IDS) {
    const o = trackOutline(id);
    assert.match(o.d, /^M-?\d/); assert.ok(!/NaN|Infinity/.test(o.d + o.viewBox + o.over.join('')), id);
  }
  assert.deepEqual(trackOutline('palm-bay').over, [], 'a flat course has no overpass');
});

test('course outlines redraw the upper road of a crossing on top, so overpasses read on the map', async () => {
  const points = Array.from({ length: 32 }, (_, i) => { const t = i / 32 * Math.PI * 2; return { x: 160 * Math.sin(t), z: 110 * Math.sin(t) * Math.cos(t), y: 6 + 6 * Math.cos(t) }; });
  const eight = buildTrack({ ...TRACK_DEFS['rainbow-road'], points, boostPads: [], ramps: [], itemRows: [], rings: [], springs: [], gravity: [], movers: [] });
  const o = trackOutline('rainbow-road', eight);
  assert.equal(o.over.length, 1, 'one overpass');
  const xs = [...o.over[0].matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(m => Number(m[1]));
  assert.ok(Math.min(...xs) < 0 && Math.max(...xs) > 0, 'the redrawn stretch spans the crossing');
  assert.ok(o.rainbow);
  const { Minimap } = await import('../src/ui/Minimap');
  const race = view(makeRace(1, { track: 'rainbow-road' }));
  const map = renderToStaticMarkup(<Minimap race={race}/>);
  assert.equal(count(map, 'kp2-map-road'), 1 + trackOutline('rainbow-road').over.length);
  const loops = trackOutline('rainbow-road').loops;
  assert.equal(loops.length, 1); assert.equal(count(map, 'kp2-map-loop'), 1, 'the loop-the-loop is marked with a ring');
  assert.ok(map.lastIndexOf('kp2-map-dot') < map.indexOf('kp2-map-loop'), 'the loop ring draws above the racer dots');
  assert.equal(count(map, 'pathLength="7"'), 7, 'the ring is seven rainbow arcs');
  assert.ok(Number.isFinite(loops[0].cx + loops[0].cy)); assert.deepEqual(trackOutline('palm-bay').loops, []);
});

test('viewport HUD: no event captions (rings, springs, loops); the bumper flash is the racer\'s own and short-lived', async () => {
  const { ViewportHud } = await import('../src/ui/Hud');
  const race = makeRace(2, { track: 'rainbow-road' }); race.phase = 'racing'; race.time = 20;
  const hud = (e: Omit<RaceEvent, 'id'>) => { race.events = [{ id: 1, ...e }]; race.serial = 1; const v = view(race);
    return renderToStaticMarkup(<ViewportHud race={v} racer={v.racers.find(r => r.id === 'p0')!} rect={{ x: 0, y: 0, w: 1, h: 1 }} viewports={1}/>); };
  for (const type of ['ring', 'spring', 'loop'] as const) assert.doesNotMatch(hud({ t: 19.8, type, racer: 'p0' }), /Star ring|Boing|Loop-de-loop|kp2-callout/);
  assert.match(hud({ t: 19.8, type: 'bumper', racer: 'p0' }), /kp2-hud-bump/);
  assert.doesNotMatch(hud({ t: 19.8, type: 'bumper', racer: 'p1' }), /kp2-hud-bump/, 'not for someone else');
  assert.doesNotMatch(hud({ t: 19.4, type: 'bumper', racer: 'p0' }), /kp2-hud-bump/, 'the flash is brief');
});

test('lobby: picker shows 8 racers, 3 karts with stat bars and the roster; the board shows picks for a watching host', () => {
  const players: RosterPlayer[] = NAMES.map((name, i) => ({ id: `p${i}`, name, color: '#28c6e7', connected: i !== 4, ready: i % 2 === 1, ...(i % 3 ? { lobbyChoice: { character: i % 8, kart: 'tank' } } : {}) }));
  const base = { roomId: 'r', lobbyId: 'l', players, settings: settings(), connected: true, onChoice: noop, onReady: noop };
  const picker = renderToStaticMarkup(<Lobby {...base} playerId="p0" isHost={false}/>);
  assert.equal(count(picker, 'class="kp2-char '), 8); assert.equal(count(picker, 'class="kp2-kart '), 3);
  assert.match(picker, /Mochi/); assert.match(picker, /Dino|Rex/); assert.match(picker, /Tank/);
  assert.match(picker, /Ready — surprise me!/); assert.match(picker, /Also picked by/);
  assert.match(picker, /5\/10 ready/);
  assert.equal(count(picker, '<dt>'), 5 * 4);                       // hero + 3 karts
  const picked = renderToStaticMarkup(<Lobby {...base} playerId="p1" isHost={false}/>);
  assert.match(picked, /Not ready/); assert.match(picked, /kp2-char is-picked/);
  // A clash is spelled out: the other picker's name on the card, and a warning in the hero.
  const clash = renderToStaticMarkup(<Lobby {...base} players={players.map(p => p.id === 'p0' ? { ...p, lobbyChoice: { character: 2, kart: 'bolt' } } : p)} playerId="p0" isHost={false}/>);
  assert.match(clash, /kp2-lobby-clash">Also picked by Bartholomew Lee/); assert.match(clash, /kp2-char-by[^>]*>Bartholomew Lee</);
  const board = renderToStaticMarkup(<Lobby {...base} playerId={null} isHost/>);
  assert.equal(count(board, 'kp2-board-state'), 10); assert.match(board, /WWWWWWWWWWWWWWWW/); assert.match(board, /Surprise racer|Choosing/); assert.match(board, /Palm Bay/);
  // The picker's choice shape is what the rules accept.
  assert.deepEqual(rules.parseLobbyChoice!({ character: 7, kart: 'tank' }, true), { character: 7, kart: 'tank' });
});

test('results: podium, full table with best laps, DNF, awards and the viewer highlighted', () => {
  const race = makeRace(3);
  race.racers.forEach((r, i) => { r.rank = i + 1; r.finishTime = 120 + i * 3; r.lapTimes = [42 + i, 40.5 + i * .3, 41]; r.stats = { ...r.stats, miniTurbos: 10 - i, hitsDealt: i === 2 ? 4 : 0, overtakes: i, tricks: i === 1 ? 3 : 0 }; });
  const p2 = race.racers.find(r => r.id === 'p2')!; p2.finishTime = null;
  race.phase = 'results';
  const v = decodeRaceView(rules.publicView(race, { nowMs: 0, phase: 'results' }));
  assert.ok(v.racers.every(r => r.stats));
  const html = renderToStaticMarkup(<Results outcome={rules.outcome(race)} publicView={v} playerId="p0"/>);
  assert.equal(count(html, 'class="kp2-step '), 3);
  assert.equal(count(html, '<tr class'), 10);
  assert.match(html, /DNF/); assert.match(html, /0:40\.50/); assert.match(html, /is-fastest/);
  assert.match(html, /is-me/); assert.match(html, /Party awards/); assert.match(html, /Drift Royalty/);
  const mine = renderToStaticMarkup(<Results outcome={rules.outcome(race)} publicView={v} playerId="p2"/>);   // your own line leads, before the podium
  assert.match(mine, /kp2-results-me.*>DNF<.*Best lap.*kp2-results-me-award"><small>Drift Royalty.*<\/header><ol class="kp2-podium/);
  assert.match(renderToStaticMarkup(<Results outcome={rules.outcome(race)} publicView={v} playerId={null}/>), /wins!/);
  const awards = partyAwards(v.racers);
  assert.ok(awards.length > 0 && awards.every(a => !a.racer.bot));
  assert.equal(new Set(awards.map(a => a.racer.id)).size, awards.length);   // one award per racer
});

test('settings: five course cards with outlines, the Rainbow Road finale card and every rule group', () => {
  const html = renderToStaticMarkup(<SettingsPanel settings={settings()} onChange={noop} disabled={false}/>);
  assert.equal(count(html, 'class="kp2-course '), 5); assert.equal(count(html, 'kp2-track-shape'), 5);
  const finale = html.slice(html.indexOf('kp2-theme-space'));
  assert.match(finale, /Grand finale.*<b>Rainbow Road<\/b>.*Star rings.*Pinball bumpers.*Loop-the-loop/);
  const gradient = /<linearGradient id="(kp2-rainbow[\w-]+)"/.exec(finale)?.[1];
  assert.ok(gradient && finale.includes(`stroke:url(#${gradient})`), 'the road is stroked with its own rainbow gradient');
  assert.equal(count(html, '<linearGradient'), 1, 'only Rainbow Road is rainbow');
  for (const label of ['Laps', 'Engine class', 'CPU racers', 'Items', 'Grid size', 'Where people race']) assert.match(html, new RegExp(`<legend>${label}</legend>`));
  assert.match(html, /200cc/); assert.match(html, /Frantic/); assert.match(html, /Own phone/);
  assert.match(renderToStaticMarkup(<SettingsPanel settings={settings()} onChange={noop} disabled/>), /disabled/);
});

test('instructions per role', () => {
  assert.match(renderToStaticMarkup(<Instructions role="controller"/>), /left thumb/);
  assert.match(renderToStaticMarkup(<Instructions role="display"/>), /share this screen/);
});

test('client module: scene roles, and TV-mode phones render no scene', async () => {
  const { client } = await import('../src/client');
  assert.deepEqual(client.sceneRoles, ['display', 'controller']); assert.equal(client.settingsWide, true);
  const SceneView = client.SceneView!, race = view(makeRace(2));
  const props = { roundId: 'u', phase: 'playing' as const, settings: settings(), viewRole: 'controller' as const, connected: true, privateView: null, setInput: noop, releaseInput: noop,
    sendAction: async () => ({ accepted: true }), players: [{ id: 'p0', name: 'A', color: '#fff' }, { id: 'p1', name: 'B', color: '#fff' }], publicView: race, snapshotTime: 0,
    signal: new AbortController().signal, serverNowMs: () => 0, onReady: noop, onError: noop };
  assert.equal(renderToStaticMarkup(<SceneView {...props} playerId="p1" isHost={false}/>), '');
});

test('the browser UI graph never pulls in the server rules', async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/client.tsx', import.meta.url))], bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', jsx: 'automatic',
    loader: { '.css': 'empty' }, logLevel: 'silent', plugins: [{ name: 'scene-external', setup: b => b.onResolve({ filter: /^\.\/scene$/ }, a => ({ path: a.path, external: true })) }] });
  const inputs = Object.keys(result.metafile!.inputs);
  assert.ok(inputs.some(p => p.endsWith('ui/Controller.tsx')));
  assert.ok(!inputs.some(p => p.endsWith('kart-party/src/server.ts')), inputs.join('\n'));
});
