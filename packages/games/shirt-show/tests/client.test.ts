import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { rules } from '../src/server';
import type { PrivateView, PublicView } from '../src/model';

let temp: string, bundle: string;
let render: (role: 'display' | 'controller' | 'results', publicView: PublicView, privateView: PrivateView | null, playerId: string | null) => string;
before(async () => {
  temp = await mkdtemp(join(tmpdir(), 'shirt-show-render-'));
  const outfile = join(temp, 'client.cjs');
  await build({
    stdin: { contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { client } from ${JSON.stringify(fileURLToPath(new URL('../src/client.tsx', import.meta.url)))};
export function render(role, publicView, privateView, playerId) {
 const View = role === 'results' ? client.ResultsView : role === 'display' ? client.DisplayView : client.ControllerView;
 return renderToStaticMarkup(React.createElement(View, { roomId:'render-room', roundId:'render-round', playerId, viewRole:role, isHost:role === 'display', publicView, privateView, serverNowMs:()=>0, setInput:()=>{}, sendAction:async()=>({accepted:true}), assetsReady:()=>{}, outcome:{complete:true,winners:[],rows:[]} }));
}`, resolveDir: process.cwd(), loader: 'tsx' },
    outfile, bundle: true, platform: 'node', format: 'cjs', loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  bundle = await readFile(outfile, 'utf8');
  render = createRequire(import.meta.url)(outfile).render;
});
after(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });
const context = { nowMs: 0, phase: 'playing' as const };

test('client bundle excludes server rules, RNG, fallback bank and optional starter bank', () => {
  for (const secret of ['A cloud trying on boots', 'A fortune cookie with stage fright', 'Locally sourced confusion', '1664525', 'finishContributions']) assert.ok(!bundle.includes(secret), secret);
});

test('all seven phases render display and portrait controller markup; missing private state shows recovery', () => {
  const state = rules.create({ roomId: 'render-room', roundId: 'render-round', seed: 2, nowMs: 1000, players: Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `Maker ${i}`, color: '#ff5748' })) }, { pace: 'standard' });
  const phases = new Set<string>();
  for (let step = 0; step < 30; step++) {
    const publicView = rules.publicView(state, context), privateView = rules.playerView(state, 'p0', context);
    phases.add(publicView.phase);
    const display = render('display', publicView, null, null), phone = render('controller', publicView, privateView, 'p0');
    assert.ok(display.includes('Shirt Show')); assert.ok(phone.includes('Shirt Show'));
    assert.ok(!/<img\b|<image\b|<iframe\b|https?:\/\//.test(display));
    assert.ok(!/<img\b|<image\b|<iframe\b|https?:\/\//.test(phone));
    if (state.phase === 'design') { assert.ok(phone.includes('Doodle 1')); assert.ok(phone.includes('Choose a slogan')); }
    if (state.phase === 'gallery') {
      assert.ok(render('results', publicView, null, null).includes('Every shirt, every collaborator'));
      assert.ok(render('controller', publicView, null, null).includes('Waiting for your player seat'));
      break;
    }
    rules.tick(state, new Map(), 0.05, state.deadline);
  }
  assert.deepEqual([...phases].sort(), ['design', 'draw', 'gallery', 'match-result', 'reveal', 'slogan', 'vote']);
});

test('maximum roster gallery renders local bounded strokes and escapes player content', () => {
  const state = rules.create({ roomId: 'render-room', roundId: 'render-round', seed: 4, nowMs: 1000, players: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: i === 0 ? '<script>bad()</script>' : `Maker ${i}`, color: '#ff5748' })) }, { pace: 'standard' });
  const strokes = [{ color: '#05071a', width: 0.012, points: Array.from({ length: 480 }, (_, i) => ({ x: i / 480, y: (i % 10) / 10 })) }];
  for (let slot = 0; slot < 2; slot++) {
    const turnId = state.turnId;
    for (const player of state.players) rules.applyAction(state, player.id, { type: 'drawing', turnId, revision: 1, commit: true, drawing: { strokes } }, state.deadline - 1);
  }
  for (let step = 0; state.phase !== 'gallery' && step < 50; step++) rules.tick(state, new Map(), 0.05, state.deadline);
  assert.equal(state.phase, 'gallery');
  const publicView = rules.publicView(state, context), html = render('results', publicView, null, null);
  assert.equal(publicView.gallery!.art.length, 20);
  assert.equal(publicView.shirts.length, 10);
  assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(!html.includes('<script>')); assert.ok(!/<img\b|<image\b|https?:\/\//.test(html));
  assert.equal((html.match(/<polyline /g) ?? []).length, 31, 'champion + ten shirts + twenty doodles use the shared local renderer');
});
