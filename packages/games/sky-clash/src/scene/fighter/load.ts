/**
 * Fighter GLB loading: one download and parse per fighter per page, at most three at a time. Callers share jobs; a job
 * nobody waits for any more is cancelled (see queue.ts). Vite-only (import.meta.glob).
 */
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FIGHTERS, type Costume, type FighterKind } from '../../model';
import { prepareModel, type FighterModel, type FighterModels, type PropMode } from './prepare';
import { keyedLoader } from './queue';

const URLS = import.meta.glob('../../../assets/fighters/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const COSTUMES = import.meta.glob('../../../assets/costumes/*.json', { eager: true, import: 'default' }) as Record<string, Costume[] | { costumes: Costume[] }>;
const META = import.meta.glob('../../../assets/models/*.json', { eager: true, import: 'prop' }) as Record<string, { visible?: PropMode } | undefined>;
export const modelUrl = (kind: FighterKind) => URLS[`../../../assets/fighters/${kind}.glb`];
export const costumesOf = (kind: FighterKind): Costume[] => { const raw = COSTUMES[`../../../assets/costumes/${kind}.json`]; return Array.isArray(raw) ? raw : raw?.costumes ?? []; };
/** The model pipeline's prop mode (assets/models/<kind>.json → prop.visible). */
export const propModeOf = (kind: FighterKind): PropMode | undefined => META[`../../../assets/models/${kind}.json`]?.visible;

const loader = keyedLoader<FighterKind, FighterModel>(async (kind, signal) => {
  const url = modelUrl(kind);
  if (!url) throw new Error(`Sky Clash is missing the ${FIGHTERS[kind].name} model.`);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not download the ${FIGHTERS[kind].name} model (${response.status}).`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), url.slice(0, url.lastIndexOf('/') + 1));
  return prepareModel(kind, gltf.scene, costumesOf(kind), propModeOf(kind));
});

/** Resolves every requested fighter (duplicates collapse). Aborting rejects this call and cancels jobs nobody else needs. */
export const loadFighterModels = (kinds: readonly FighterKind[], signal: AbortSignal): Promise<FighterModels> => loader.load(kinds, signal);
