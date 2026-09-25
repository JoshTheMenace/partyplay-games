/** Everything one decision needs, built once per `decide` call, plus the CPU's small memory. */
import {
  type Action, type CpuLevel, type Good, type PrivateView, type PublicSeat, type PublicView,
  type Resource, type SeatId,
} from '../model';
import { indexOf, type Index } from './board';
import { KNOBS, personaOf, type Knobs, type Persona } from './personas';
import { production, scarcity } from './value';

/** Facts from this CPU's own views only; reset when the turn id changes. */
export type Memory = {
  turn: number;
  /** Player offers posted this turn and their give/want keys. */
  proposals: number; tried: string[];
  /** Decide calls spent waiting on our own open offer. */
  waits: number;
  /** Offers we already countered. */
  countered: string[];
  banks: number;
  /** Uses per module command id this turn. */
  used: Record<string, number>;
};

export const freshMemory = (turn: number): Memory =>
  ({ turn, proposals: 0, tried: [], waits: 0, countered: [], banks: 0, used: {} });

export function recall(memory: unknown, turn: number): Memory {
  const m = memory as Memory | null;
  const valid = m && typeof m === 'object' && m.turn === turn && Array.isArray(m.tried);
  return valid ? structuredClone(m) : freshMemory(turn);
}

export type Ctx = {
  pub: PublicView; me: PrivateView; seat: SeatId;
  level: CpuLevel; k: Knobs; persona: Persona;
  ix: Index; random: () => number; mem: Memory;
  prod: Record<Good, number>; scarce: Record<Resource, number>;
  /** Public VP per seat. */
  vp: Map<SeatId, number>;
  /** The other seat most likely to win (public VP, then cards and dev cards). */
  leader: SeatId | null;
  jitter: (x: number) => number;
};

export function context(pub: PublicView, me: PrivateView, level: CpuLevel, persona: string,
  random: () => number, mem: Memory): Ctx {
  const k = KNOBS[level] ?? KNOBS.normal, ix = indexOf(pub.board);
  const others = pub.seats.filter(s => s.id !== me.seat);
  const rank = (s: PublicSeat) => s.vp * 100 + s.cards + s.dev * 2;
  const leader = others.reduce<PublicSeat | null>((a, b) => (!a || rank(b) > rank(a) ? b : a), null);
  return {
    pub, me, seat: me.seat, level, k, persona: personaOf(persona), ix, random, mem,
    prod: production(pub, ix, me.seat), scarce: scarcity(pub),
    vp: new Map(pub.seats.map(s => [s.id, s.id === me.seat ? me.vp : s.vp])), leader: leader?.id ?? null,
    jitter: x => (k.noise ? x * (1 + k.noise * (random() * 2 - 1)) : x),
  };
}

type Payload<T extends Action['type']> = Omit<Extract<Action, { type: T }>, 'turnId'>;

/** Stamp the current turn id on an action. */
export const act = <T extends Action['type']>(c: Ctx, a: { type: T } & Payload<T>): Action =>
  ({ ...a, turnId: c.pub.turn.id }) as Action;

/** Seats close enough to winning that we stop helping them (target − 2 or more). */
export const nearWin = (c: Ctx, id: SeatId) => (c.vp.get(id) ?? 0) >= c.pub.settings.targetPoints - 2;
