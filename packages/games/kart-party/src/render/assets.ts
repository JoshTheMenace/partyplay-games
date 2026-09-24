/* GLB loading (karts.glb + props.glb). Parsed once per page and shared by every round; a missing or
 * broken file yields a null group and callers fall back to primitives. clone(name) shares geometry
 * and materials with the library (callers clone materials they tint). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KartAssets } from './types';

export const MODELS_URL = '/games/kart-party/models/';
type Library = { group: THREE.Group | null; retry: boolean };
let cache: Promise<[Library, Library]> | null = null;

async function loadLibrary(file: string): Promise<Library> {
  try {
    const response = await fetch(MODELS_URL + file);
    if (!response.ok) return { group: null, retry: response.status >= 500 };
    const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), MODELS_URL);
    return { group: gltf.scene, retry: false };
  } catch (error) {
    console.warn(`Kart Party: ${file} could not be loaded; using primitive models.`, error);
    return { group: null, retry: true };
  }
}

/** Build the lookup/clone facade over two loaded libraries. */
export function kartAssets(karts: THREE.Group | null, props: THREE.Group | null): KartAssets {
  const index = new Map<string, THREE.Object3D>();
  for (const lib of [props, karts]) lib?.traverse(o => { if (o.name) index.set(o.name, o); });
  return {
    karts, props,
    clone(name) {
      const source = index.get(name);
      if (!source) return null;
      const copy = source.clone(true);
      copy.position.set(0, 0, 0);          // library layout offsets are irrelevant; origins sit on the ground
      return copy;
    },
  };
}

/** Resolves with the shared libraries; rejects if `signal` aborts first (the load itself continues for the next round). */
export async function loadKartAssets(signal: AbortSignal): Promise<KartAssets> {
  signal.throwIfAborted();
  const pending = cache ??= Promise.all([loadLibrary('karts.glb'), loadLibrary('props.glb')]);
  const libs = await new Promise<[Library, Library]>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    pending.then(v => { signal.removeEventListener('abort', abort); resolve(v); }, e => { signal.removeEventListener('abort', abort); reject(e); });
  });
  if (libs.some(l => l.retry) && cache === pending) cache = null;    // transient failure: try again next round
  return kartAssets(libs[0].group, libs[1].group);
}
