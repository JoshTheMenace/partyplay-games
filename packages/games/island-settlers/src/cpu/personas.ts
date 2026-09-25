/** Named CPU personalities (goal and resource biases) and the difficulty knobs. */
import type { CpuLevel, Resource } from '../model';

export type Goal = 'city' | 'settlement' | 'road' | 'dev' | 'module';

export type Persona = {
  id: string; name: string; label: string;
  /** Multipliers on goal scores. */
  goals: Partial<Record<Goal, number>>;
  /** Multipliers on resource values when scoring spots. */
  likes: Partial<Record<Resource, number>>;
  /** Weight of port access in spot scores. */
  ports: number;
  /** Multiplier on module command hints (C&K, E&P, T&B commands). */
  modules: number;
};

export const PERSONA_LIST: readonly Persona[] = [
  { id: 'trader', name: 'Maya', label: 'Harbor trader', goals: {}, likes: {}, ports: 2, modules: 1 },
  { id: 'roads', name: 'Theo', label: 'Road builder', goals: { road: 1.4, settlement: 1.1 },
    likes: { wood: 1.2, brick: 1.2 }, ports: 1, modules: 1 },
  { id: 'knights', name: 'Iris', label: 'Knight captain', goals: { dev: 1.6 },
    likes: { ore: 1.1, wool: 1.1 }, ports: 1, modules: 1.2 },
  { id: 'cities', name: 'Omar', label: 'City planner', goals: { city: 1.35 },
    likes: { ore: 1.2, grain: 1.2 }, ports: 1, modules: 1.1 },
  { id: 'farmer', name: 'Lena', label: 'Grain farmer', goals: {}, likes: { grain: 1.3 }, ports: 1,
    modules: 1 },
  { id: 'miner', name: 'Ravi', label: 'Ore miner', goals: { city: 1.15, dev: 1.1 },
    likes: { ore: 1.3 }, ports: 1, modules: 1 },
  { id: 'sailor', name: 'Nora', label: 'Sea captain', goals: { road: 1.2 },
    likes: { wool: 1.15, wood: 1.1 }, ports: 1.5, modules: 1.3 },
  { id: 'banker', name: 'Felix', label: 'Banker', goals: { city: 1.1 }, likes: {}, ports: 1.6, modules: 0.9 },
  { id: 'scout', name: 'Juno', label: 'Scout', goals: { settlement: 1.25, road: 1.1 },
    likes: {}, ports: 1, modules: 1.2 },
];

/** The platform-facing list (same shape the engine seats CPUs with). */
export const PERSONAS: readonly { id: string; name: string; label: string }[] =
  PERSONA_LIST.map(({ id, name, label }) => ({ id, name, label }));

export const personaOf = (id: string) => PERSONA_LIST.find(p => p.id === id) ?? PERSONA_LIST[0];

export type Knobs = {
  /** Relative random spread on scores (0 = exact). */
  noise: number;
  /** Player trades posted per opportunity. */
  proposals: number;
  counters: boolean;
  /** Decline offers from seats at target − 2 or more. */
  embargo: boolean;
  /** Minimum hand-utility gain to accept or propose a trade. */
  greed: number;
  /** Leader-aware robber (Easy just avoids itself). */
  smartRobber: boolean;
  /** Race to contested spots and cut opponents off. */
  blocking: boolean;
  /** Plan the second setup settlement when placing the first. */
  lookahead: number;
};

export const KNOBS: Record<CpuLevel, Knobs> = {
  easy: {
    noise: 0.5, proposals: 0, counters: false, embargo: false, greed: 0, smartRobber: false, blocking: false,
    lookahead: 0,
  },
  normal: {
    noise: 0.06, proposals: 1, counters: false, embargo: true, greed: 0.1, smartRobber: true, blocking: false,
    lookahead: 0.35,
  },
  sharp: {
    noise: 0, proposals: 2, counters: true, embargo: true, greed: 0.3, smartRobber: true, blocking: true,
    lookahead: 0.45,
  },
};
