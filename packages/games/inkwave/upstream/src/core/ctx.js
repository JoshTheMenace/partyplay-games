// Global game context + tiny event bus. Modules read shared systems off G lazily (G.paint, G.physics, ...).
const defaults = {
  renderer: null, scene: null, camera: null,
  settings: null, quality: null,
  level: null, paint: null, physics: null, fx: null, env: null,
  audio: null, music: null, hud: null, menus: null, input: null,
  match: null, actors: [], local: null, projectiles: null,
  teamColors: [null, null],      // THREE.Color (linear) per team
  teamHex: ['#ff8a14', '#2f5bff'],
  time: 0,
  mode: 'boot',                  // 'boot' | 'menu' | 'match'
};

let current = defaults;
const modules = [];
export function registerState(read, write) {
  const initial = read();
  modules.push({ read, write, create: () => initial.map(value => value instanceof Map ? new Map() : value instanceof Set ? new Set() : Array.isArray(value) ? [] : value) });
}
const globalListeners = new Map();
export const G = new Proxy(defaults, { get: (_, key) => current[key], set: (_, key, value) => (current[key] = value, true) });
export function withContext(context, fn) {
  const previous = current;
  if (previous === context) return fn();
  previous.modules = modules.map(module => module.read());
  current = context;
  context.modules ||= modules.map(module => module.create());
  modules.forEach((module, i) => module.write(context.modules[i]));
  try { return fn(); } finally {
    context.modules = modules.map(module => module.read()); current = previous;
    modules.forEach((module, i) => module.write(previous.modules[i]));
  }
}
export function createContext(extra) { return { ...defaults, modules: modules.map(module => module.create()), actors: [], listeners: new Map(), ...extra }; }
export function random() { return G.random ? G.random() : Math.random(); }
export function on(name, fn) {
  const listeners = G.listeners || globalListeners;
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}
export function emit(name, payload) {
  for (const listeners of [globalListeners, G.listeners]) for (const fn of listeners?.get(name) || []) fn(payload);
}

// ---- small math helpers shared by core modules ----
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function angleDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
export function dampAngle(a, b, lambda, dt) { return a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt)); }

// Deterministic hash → [0,1)
export function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }

// Seeded RNG (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
