/* Bloom for full-quality displays (tier 0). The frame is drawn into a float target instead of the canvas, the brightest pixels
 * glow (boost flames, drift sparks, item effects, neon, sun glints, the rainbow ribbon) and one output pass tone-maps the
 * result to the screen with the renderer's own tone mapping and colour space, so nothing else changes colour. Phones start at
 * tier 1 and keep drawing straight to the canvas; a device without float render targets gets no post-processing at all. */
import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** `threshold` is scene-linear luminance before tone mapping: about 1 is a sunlit white surface. */
export type Bloom = { strength: number; radius: number; threshold: number };
/** What glows: the part of each pixel's luminance above the threshold, counted up to 1. The cap matters: emissive windows and
 * stacked additive sparks reach many times the threshold, and uncapped they flood the whole frame with haze. */
const BRIGHT = /* glsl */`
  uniform sampler2D tDiffuse; uniform float luminosityThreshold; varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    float v = luminance(texel.rgb);
    gl_FragColor = vec4(texel.rgb * (clamp(v - luminosityThreshold, 0.0, 1.0) / max(v, 1e-4)), 1.0);
  }`;
export type Post = {
  /** The bloom pass (strength, radius and threshold are live: the dev sandbox tunes them). */
  glow: UnrealBloomPass;
  /** The scene target: compile shaders against it (render targets use other program variants than the canvas). */
  target: THREE.WebGLRenderTarget;
  /** Start a frame of W×H device pixels, cleared to `clear`. */
  begin(W: number, H: number, clear: THREE.Color): void;
  /** Aim the next scene render at this device-pixel rectangle (origin bottom-left). */
  viewport(x: number, y: number, w: number, h: number): void;
  /** Bloom and present. */
  end(dt: number): void;
  dispose(): void;
};

export function createPost(renderer: THREE.WebGLRenderer, bloom: Bloom): Post | null {
  if (!renderer.extensions.has('EXT_color_buffer_float')) return null;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const glow = new UnrealBloomPass(new THREE.Vector2(1, 1), bloom.strength, bloom.radius, bloom.threshold), output = new OutputPass();
  output.renderToScreen = true; glow.materialHighPassFilter.fragmentShader = BRIGHT;
  const whole = () => { target.scissorTest = false; target.viewport.set(0, 0, target.width, target.height); target.scissor.set(0, 0, target.width, target.height); };
  return {
    target, glow,
    begin(W, H, clear) {
      if (target.width !== W || target.height !== H) { target.setSize(W, H); glow.setSize(W, H); }
      whole(); renderer.setRenderTarget(target); renderer.setClearColor(clear, 1); renderer.clear();
    },
    viewport(x, y, w, h) { target.viewport.set(x, y, w, h); target.scissor.set(x, y, w, h); target.scissorTest = true; renderer.setRenderTarget(target); },
    end(dt) { whole(); glow.render(renderer, target, target, dt, false); output.render(renderer, target, target, dt, false); },
    dispose() { target.dispose(); glow.dispose(); output.dispose(); },
  };
}
