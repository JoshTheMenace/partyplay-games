import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Scene } from 'three';
import { ResourceScope } from '../../../party-runtime/src/index';
import type { EventKind, FighterView, GameEvent, HitEffect, ProjectileView, View } from '../src/model';
import { FX_FEED, createFx } from '../src/scene/fx';
import { ProjectileArt } from '../src/scene/fx/projectiles';

const EFFECTS: HitEffect[] = ['normal', 'fire', 'electric', 'slash', 'coin', 'ice', 'sleep', 'grass', 'darkness', 'water', 'star', 'psychic', 'magic'];
const KINDS: EventKind[] = ['hit', 'shield', 'parry', 'shieldbreak', 'ko', 'jump', 'airjump', 'land', 'swing', 'projectile', 'grab', 'throw', 'tech', 'ledge', 'respawn', 'counter', 'reflect',
  'absorb', 'armor', 'clash', 'dodge', 'hazard-warn', 'hazard', 'taunt', 'sudden-death', 'star-ko'];
const fighter = (o: Partial<FighterView> = {}) => ({ id: 'a', color: '#40a0ff', fighter: 'fox', x: 0, y: 0, vx: 0, vy: 0, facing: 1, grounded: true, state: 'idle', launch: 0, ...o }) as FighterView;
const view = { fighters: [fighter(), fighter({ id: 'b', color: '#ff4040' })] } as unknown as View;
const ev = (kind: EventKind, o: Partial<GameEvent> = {}): GameEvent => ({ id: 1, kind, frame: 0, x: 1, y: 2, source: 'a', target: 'b', power: .8, angle: 40, damage: 15, ...o });
const make = () => { const scene = new Scene(), scope = new ResourceScope(); return { scene, scope, fx: createFx(scene, scope) }; };
/** Projectile kinds the engine can emit, read from the special kits. */
function engineKinds() {
  const dir = new URL('../src/sim/', import.meta.url), files = readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => readFileSync(new URL(f, dir), 'utf8'));
  const kits = new URL('../src/specials/', import.meta.url);
  files.push(readFileSync(new URL('../src/specials.ts', import.meta.url), 'utf8'), ...readdirSync(kits).map(f => readFileSync(new URL(f, kits), 'utf8')));
  const kinds = new Set<string>();
  for (const src of files) for (const m of src.matchAll(/[sS]hot\([^,()]*,?\s*'([a-z0-9-]+)'|\bkind:\s*'([a-z0-9-]+)',\s*(?:effect|damage|speed|vx)/g)) kinds.add(m[1] ?? m[2]);
  return [...kinds];
}

test('every event kind and hit effect renders finite, bounded particles', () => {
  const { fx, scope } = make();
  for (const kind of KINDS) for (const effect of kind === 'hit' ? EFFECTS : ['normal' as HitEffect]) {
    fx.event(ev(kind, { effect }), view); fx.update(1 / 60, false);
  }
  assert.ok(fx.stats.particles > 200, `${fx.stats.particles} particles`);
  assert.ok(fx.stats.particles <= 2100, 'pools cap the count');
  const k = fx.cameraKick();
  for (const n of [k.x, k.y, k.zoom, k.flash]) assert.ok(Number.isFinite(n));
  for (let i = 0; i < 180; i++) fx.update(1 / 60, false);
  assert.equal(fx.stats.particles, 0, 'everything expires');
  scope.dispose();
});

test('hit sparks scale with damage and power', () => {
  const count = (damage: number, power: number) => { const { fx, scope } = make(); fx.event(ev('hit', { damage, power }), view); fx.update(1 / 60, false); const n = fx.stats.particles; scope.dispose(); return n; };
  assert.ok(count(24, 1) > count(3, .1) * 1.5);
});

test('camera kick decays; strong hits punch-zoom; reduced motion disables shake and flash and thins particles', () => {
  const { fx, scope } = make();
  fx.event(ev('ko', { power: 1 }), view); fx.update(1 / 60, false);
  let k = fx.cameraKick();
  assert.ok(k.zoom > 0 && k.flash > 0 && Math.hypot(k.x, k.y) > 0, 'KO shakes, zooms and flashes');
  const full = fx.stats.particles;
  for (let i = 0; i < 180; i++) fx.update(1 / 60, false);
  k = fx.cameraKick();
  assert.ok(Math.abs(k.x) < 1e-6 && Math.abs(k.y) < 1e-6 && k.zoom < 1e-3 && k.flash === 0, 'decays to rest');
  const weak = make(); weak.fx.event(ev('hit', { power: .3 }), view); weak.fx.update(1 / 60, false);
  assert.equal(weak.fx.cameraKick().zoom, 0, 'no punch-zoom at power ≤ 0.6'); weak.scope.dispose();
  const r = make(); r.fx.update(0, true); r.fx.event(ev('ko', { power: 1 }), view); r.fx.update(1 / 60, true);
  k = r.fx.cameraKick();
  assert.deepEqual([k.x, k.y, k.zoom, k.flash], [0, 0, 0, 0]);
  assert.ok(r.fx.stats.particles < full * .6, 'fewer particles');
  scope.dispose(); r.scope.dispose();
});

test('every engine projectile kind has a tailored, pooled visual', () => {
  const kinds = engineKinds();
  assert.ok(kinds.length >= 20, kinds.join());
  const scene = new Scene(), art = new ProjectileArt(scene);
  for (const kind of kinds) assert.equal(art.build(kind, 'normal').generic, false, `${kind} falls back to the generic orb`);
  assert.equal(art.build('something-new', 'fire').generic, true);
  art.dispose();
  const { fx, scope, scene: s2 } = make();
  const list = (n: number): ProjectileView[] => kinds.slice(0, n).map((kind, i) => ({ id: i + 1, owner: 'a', kind, x: i, y: 1, vx: .1, vy: 0, r: .2, life: 30, effect: 'normal' }));
  fx.projectiles(list(kinds.length), 0); fx.update(1 / 60, false);
  assert.equal(fx.stats.projectiles, kinds.length);
  const objects = s2.children.length;
  fx.projectiles([], 1 / 60); assert.equal(fx.stats.projectiles, 0);
  fx.projectiles(list(kinds.length).map(p => ({ ...p, id: p.id + 100 })), 2 / 60);
  assert.equal(s2.children.length, objects, 'visuals are reused from the pool');
  for (const o of s2.children) o.traverse(c => assert.ok(c.position.toArray().every(Number.isFinite)));
  scope.dispose();
});

test('fighters feed dust, fast-fall glints and launch trails once per frame; dispose leaves the scene empty', () => {
  const { fx, scope, scene } = make(), feed = scene.userData[FX_FEED] as (f: FighterView) => void;
  assert.equal(typeof feed, 'function');
  feed(fighter()); fx.update(1 / 60, false);
  feed(fighter({ state: 'run', vx: .2 })); fx.update(1 / 60, false);
  const dust = fx.stats.particles; assert.ok(dust > 0, 'dash dust');
  fx.track([fighter({ state: 'run', vx: .2 })]); feed(fighter({ state: 'tumble', grounded: false, vx: .3, vy: .2, launch: .25 }));
  fx.update(1 / 60, false);
  for (let i = 0; i < 10; i++) { feed(fighter({ state: 'tumble', grounded: false, vx: .3, vy: .2, launch: .25 })); fx.track([fighter({ state: 'tumble', grounded: false, vx: .3, vy: .2, launch: .25 })]); fx.update(1 / 60, false); }
  assert.ok(fx.stats.particles > dust, 'launch trail');
  scope.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(scene.userData[FX_FEED], undefined);
});
