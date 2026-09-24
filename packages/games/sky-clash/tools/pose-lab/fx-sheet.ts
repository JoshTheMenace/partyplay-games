/** FX contact sheet (?fx=1): every hit effect, combat event and projectile kind, frozen at a readable moment. */
import { Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import { ResourceScope } from '../../../../party-runtime/src/index';
import type { EventKind, FighterView, GameEvent, HitEffect, ProjectileView, View } from '../../src/model';
import { createFx } from '../../src/scene/fx';

const EFFECTS: HitEffect[] = ['normal', 'fire', 'electric', 'slash', 'coin', 'ice', 'sleep', 'grass', 'darkness', 'water', 'star', 'psychic', 'magic'];
const EVENTS: [EventKind, number][] = [['ko', .18], ['shield', .08], ['parry', .06], ['shieldbreak', .15], ['clash', .06], ['land', .15], ['jump', .15], ['tech', .1], ['respawn', .4], ['counter', .08], ['reflect', .08], ['absorb', .12]];
const KINDS = ['fireball', 'pill', 'laser', 'thunder-jolt', 'thunder', 'charge-shot', 'shadow-ball', 'pk-fire', 'pk-flash', 'arrow', 'fire-arrow', 'needle', 'boomerang', 'bomb', 'missile', 'egg', 'turnip', 'sausage', 'ice', 'blizzard', 'flame', 'dins-fire', 'star', 'wave', 'disable', 'mystery'];
type Cell = { label: string; run: (fx: ReturnType<typeof createFx>, view: View) => number };
const fighter = { id: 't', color: '#4fb3ff', fighter: 'mario' } as FighterView;
const view = { fighters: [fighter] } as unknown as View;
const ev = (kind: EventKind, o: Partial<GameEvent> = {}): GameEvent => ({ id: 1, kind, frame: 0, x: 0, y: 0, target: 't', power: .8, angle: 35, damage: 14, ...o });

export function fxCells(): Cell[] {
  return [
    ...EFFECTS.map((effect): Cell => ({ label: `hit ${effect}`, run: fx => { fx.event(ev('hit', { effect }), view); return .07; } })),
    ...EVENTS.map(([kind, t]): Cell => ({ label: kind, run: fx => { fx.event(ev(kind, kind === 'ko' ? { x: 4, y: 1, angle: 20 } : {}), view); return t; } })),
    ...KINDS.map((kind): Cell => ({ label: kind, run: fx => {
      const p: ProjectileView = { id: 1, owner: 'a', kind, x: 0, y: 0, vx: .12, vy: kind === 'thunder' ? -.2 : 0, r: kind === 'charge-shot' || kind === 'shadow-ball' ? .45 : .22, life: 60, effect: kind.includes('fire') || kind === 'flame' ? 'fire' : 'normal' };
      for (let i = 0; i < 18; i++) { fx.projectiles([{ ...p, x: -1.5 + i * .09 }], i / 60); fx.update(1 / 60, false); }
      return 0;
    } })),
  ];
}

export function drawFx(renderer: WebGLRenderer, cells: Cell[], cols: number, cw: number, ch: number) {
  const rows = Math.ceil(cells.length / cols), cam = new PerspectiveCamera(30, cw / ch, .05, 100);
  cells.forEach((cell, i) => {
    const scope = new ResourceScope(), scene = new Scene(); scene.background = new Color('#1d2238');
    const key = new DirectionalLight('#ffffff', 2.2); key.position.set(2, 4, 6); scene.add(new HemisphereLight('#dfe8ff', '#4a3a5a', 1.1), key);
    const fx = createFx(scene, scope), t = cell.run(fx, view);
    for (let k = 0; k < Math.round(t * 60); k++) fx.update(1 / 60, false);
    const wide = cell.label === 'ko';
    cam.position.set(wide ? 2 : 0, 0, wide ? 18 : 7); cam.lookAt(wide ? 2 : 0, 0, 0); cam.aspect = cw / ch; cam.updateProjectionMatrix();
    const col = i % cols, row = Math.floor(i / cols), y = (rows - 1 - row) * ch;
    renderer.setViewport(col * cw, y, cw, ch); renderer.setScissor(col * cw, y, cw, ch); renderer.render(scene, cam);
    scope.dispose();
  });
  return rows;
}
