/**
 * HTML overlay for the shared display: a player chip above every fighter and, for fighters outside the frame,
 * a Melee-style magnifier bubble pinned to the screen edge with an arrow toward them and their damage.
 * The fighter inside each bubble is the real fighter, redrawn by createMagnifier into the bubble's rect.
 */
import { CircleGeometry, Color, Mesh, PerspectiveCamera, ShaderMaterial, Vector2, type Scene, type WebGLRenderer } from 'three';
import type { ResourceScope } from '../../../../party-runtime/src/index';
import { BUBBLE_LAYER } from './stage/kit';
export type TagItem = { id: string; label: string; name: string; color: string; x: number; y: number; height: number; damage: number; visible: boolean; connected: boolean };
/** World point to overlay CSS pixels (y down). */
export type Project = (x: number, y: number) => { x: number; y: number };
/** An offscreen fighter's bubble in CSS pixels, for the magnifier pass. */
export type Bubble = { id: string; x: number; y: number; r: number };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** Bubble radius in CSS pixels for a viewport. */
export const bubbleRadius = (width: number, height: number) => clamp(Math.min(width, height) * .062, 30, 64);
/** Where an offscreen point's bubble sits: slid along the inset edge nearest the point, shrinking with distance (Melee's magnifier). */
export function edgeBubble(sx: number, sy: number, width: number, height: number, r: number) {
  const inset = r + 14, x = clamp(sx, inset, width - inset), y = clamp(sy, inset, height - inset), distance = Math.hypot(sx - x, sy - y);
  return { x, y, angle: Math.atan2(sy - y, sx - x), scale: clamp(1 - distance / (height * 2.2), .6, 1) };
}
/** Melee's damage ramp: white, yellow, orange, red, then a deep crimson past 150%. */
export function damageColor(damage: number) {
  const t = clamp(damage / 150, 0, 1);
  return `hsl(${Math.round(55 - 55 * t)} 100% ${Math.round(96 - 44 * t - clamp((damage - 150) / 150, 0, 1) * 16)}%)`;
}

const CSS = `.sct-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;contain:strict;font-family:var(--font-display,'Lilita One',sans-serif)}
.sct-tag,.sct-bubble{position:absolute;left:0;top:0;will-change:transform}
.sct-tag{display:flex;flex-direction:column;align-items:center;transition:opacity .2s}
.sct-tag b{font-weight:400;font-size:clamp(14px,1.2vw,22px);line-height:1;padding:.16em .42em .1em;border-radius:.4em;background:var(--c);color:#fff;-webkit-text-stroke:.1em #05071a;paint-order:stroke;border:2px solid #05071a;box-shadow:0 2px 0 #05071a}
.sct-tag span{font-family:var(--font-body,Nunito,sans-serif);font-weight:900;font-size:clamp(11px,.9vw,16px);color:#fff6e5;text-shadow:0 1px 0 #05071a,0 0 6px #05071a;white-space:nowrap;max-width:13em;overflow:hidden;text-overflow:ellipsis}
.sct-tag i{width:0;height:0;border:6px solid transparent;border-top:7px solid var(--c);border-bottom:0;filter:drop-shadow(0 1.5px 0 #05071a)}
.sct-compact span{display:none}.sct-dim{opacity:.5}
.sct-bubble{width:0;height:0}
.sct-ring{position:absolute;left:calc(var(--r)*-1);top:calc(var(--r)*-1);width:calc(var(--r)*2);height:calc(var(--r)*2);border-radius:50%;border:4px solid var(--c);box-shadow:0 0 0 3px #05071a,inset 0 0 0 2px #05071a88,0 6px 18px #05071a99}
.sct-arrow{position:absolute;left:0;top:-10px;width:0;height:0;border:10px solid transparent;border-left:15px solid var(--c);transform-origin:0 50%;filter:drop-shadow(0 0 1.5px #05071a) drop-shadow(0 0 1.5px #05071a)}
.sct-dmg{position:absolute;left:0;top:calc(var(--r) - .45em);transform:translateX(-50%);font-size:clamp(17px,1.35vw,26px);line-height:1;color:var(--d);-webkit-text-stroke:.13em #05071a;paint-order:stroke;white-space:nowrap}
.sct-dmg small{font-size:.6em}
.sct-chip{position:absolute;left:0;top:calc(var(--r)*-1 - .7em);transform:translateX(-50%);font-size:clamp(12px,.95vw,17px);line-height:1;padding:.14em .4em .08em;border-radius:.4em;background:var(--c);color:#fff;-webkit-text-stroke:.1em #05071a;paint-order:stroke;border:2px solid #05071a}`;

type Entry = { tag: HTMLDivElement; label: HTMLElement; name: HTMLElement; bubble: HTMLDivElement; arrow: HTMLElement; dmg: HTMLElement; chip: HTMLElement; key: string; text: string };

/** Creates the overlay inside `root`, which the caller positions over the canvas. */
export function createTags(root: HTMLElement) {
  const layer = document.createElement('div'), style = document.createElement('style'), entries = new Map<string, Entry>(), seen = new Set<string>();
  layer.className = 'sct-layer'; layer.setAttribute('aria-hidden', 'true'); style.textContent = CSS; root.append(style, layer);
  const make = (): Entry => {
    const tag = document.createElement('div'), bubble = document.createElement('div');
    tag.className = 'sct-tag'; tag.innerHTML = '<b></b><span></span><i></i>';
    bubble.className = 'sct-bubble'; bubble.innerHTML = '<div class="sct-arrow"></div><div class="sct-ring"></div><div class="sct-chip"></div><div class="sct-dmg"></div>';
    layer.append(tag, bubble);
    const [arrow, , chip, dmg] = [...bubble.children] as HTMLElement[];
    return { tag, bubble, arrow, chip, dmg, label: tag.children[0] as HTMLElement, name: tag.children[1] as HTMLElement, key: '', text: '' };
  };
  return {
    /** Positions every tag and bubble. compact hides names (during combat). Returns the bubbles to magnify. */
    update(items: readonly TagItem[], project: Project, width: number, height: number, compact: boolean): Bubble[] {
      seen.clear();
      const bubbles: Bubble[] = [], r0 = bubbleRadius(width, height), placed: { x: number; y: number; w: number }[] = [];
      const font = clamp(innerWidth * .012, 14, 22), rowH = font * 1.3 + 12; // the tag chip's CSS size, so crowded tags stack instead of overlapping
      for (const item of items) {
        seen.add(item.id);
        const e = entries.get(item.id) ?? entries.set(item.id, make()).get(item.id)!, key = `${item.color}|${item.label}|${item.name}`;
        if (e.key !== key) {
          e.key = key; e.label.textContent = e.chip.textContent = item.label; e.name.textContent = item.name;
          for (const el of [e.tag, e.bubble]) el.style.setProperty('--c', item.color);
        }
        const feet = project(item.x, item.y), head = project(item.x, item.y + item.height), mx = (feet.x + head.x) / 2, my = (feet.y + head.y) / 2;
        const h = Math.abs(feet.y - head.y), off = item.visible && (head.y + h * .4 > height || feet.y - h * .4 < 0 || mx < h * .12 || mx > width - h * .12); // mostly out: bubble
        e.tag.style.display = item.visible && !off ? '' : 'none'; e.bubble.style.display = off ? '' : 'none';
        if (off) {
          const b = edgeBubble(mx, my, width, height, r0), r = r0 * b.scale;
          e.bubble.style.transform = `translate3d(${b.x.toFixed(1)}px,${b.y.toFixed(1)}px,0)`; e.bubble.style.setProperty('--r', `${r.toFixed(1)}px`);
          e.arrow.style.transform = `rotate(${b.angle.toFixed(3)}rad) translateX(${(r + 3).toFixed(1)}px)`;
          const text = String(Math.floor(item.damage));
          if (e.text !== text) { e.text = text; e.dmg.innerHTML = `${text}<small>%</small>`; e.dmg.style.setProperty('--d', damageColor(item.damage)); }
          bubbles.push({ id: item.id, x: b.x, y: b.y, r: r - 4 });
        } else if (item.visible) {
          const x = clamp(head.x, 28, width - 28), w = font * (item.label.length * .62 + 1.2);
          let y = clamp(head.y - 10, 44, height - 8);
          for (let i = 0; i < 4 && placed.some(p => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < rowH); i++) y -= rowH;
          placed.push({ x, y, w });
          e.tag.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-100%)`;
          e.tag.classList.toggle('sct-compact', compact); e.tag.classList.toggle('sct-dim', !item.connected);
        }
      }
      for (const [id, e] of entries) if (!seen.has(id)) { e.tag.remove(); e.bubble.remove(); entries.delete(id); }
      return bubbles;
    },
    dispose() { layer.remove(); style.remove(); entries.clear(); },
  };
}

export type MagnifyJob = { bubble: Bubble; x: number; y: number; height: number; color: string };
/**
 * Melee's magnifier: after the main render, redraw only the BUBBLE_LAYER (fighters and lights) into each offscreen
 * bubble with a scissored close-up camera over a player-colored disc. Hooks scene.onAfterRender, so it runs inside
 * the shared render loop; render counters accumulate into the frame's metrics.
 */
export function createMagnifier(scene: Scene, scope: ResourceScope) {
  const camera = new PerspectiveCamera(30, 1, .1, 60), size = new Vector2(), tan = Math.tan(15 * Math.PI / 180);
  const material = scope.own(new ShaderMaterial({
    depthTest: false, depthWrite: false, uniforms: { uColor: { value: new Color() } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform vec3 uColor; varying vec2 vP; void main(){ float r = length(vP); gl_FragColor = vec4(mix(mix(uColor, vec3(1.), .35), uColor * .35, smoothstep(.1, 1., r)), 1.);\n#include <colorspace_fragment>\n}',
  }));
  const disc = new Mesh(scope.own(new CircleGeometry(1, 48)), material); disc.layers.set(BUBBLE_LAYER); disc.renderOrder = -1000; disc.frustumCulled = false;
  camera.layers.set(BUBBLE_LAYER); scene.add(disc);
  let jobs: MagnifyJob[] = [], busy = false;
  const previous = scene.onAfterRender;
  scene.onAfterRender = (renderer: WebGLRenderer, ...rest) => {
    previous.call(scene, renderer, ...rest);
    if (busy || !jobs.length) return;
    busy = true; renderer.getSize(size);
    const autoClear = renderer.autoClear, autoReset = renderer.info.autoReset;
    renderer.autoClear = false; renderer.info.autoReset = false; disc.visible = true;
    try {
      for (const job of jobs) {
        const { x, y, r } = job.bubble, d = r * 2, half = job.height * .62 + .25, dist = half / tan, cy = job.y + job.height * .5;
        renderer.setViewport(x - r, size.y - y - r, d, d); renderer.setScissor(x - r, size.y - y - r, d, d); renderer.setScissorTest(true); renderer.clearDepth();
        camera.aspect = 1; camera.position.set(job.x, cy + dist * .06, dist); camera.lookAt(job.x, cy, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        const back = dist + 3; disc.position.set(job.x, cy, -3); disc.scale.setScalar(back * tan * 1.02); disc.quaternion.copy(camera.quaternion); disc.updateMatrixWorld();
        material.uniforms.uColor.value.set(job.color);
        renderer.render(scene, camera);
      }
    } finally {
      renderer.setScissorTest(false); renderer.setViewport(0, 0, size.x, size.y); renderer.autoClear = autoClear; renderer.info.autoReset = autoReset; disc.visible = false; busy = false;
    }
  };
  disc.visible = false;
  scope.defer(() => { scene.onAfterRender = previous; disc.removeFromParent(); });
  return { set(next: MagnifyJob[]) { jobs = next; } };
}
