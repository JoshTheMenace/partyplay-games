/** One step of our own opportunity (roll stage, main, paired, Connect window). */
import type { Action, BuildPiece, Purchase } from '../model';
import { act, type Ctx } from './context';
import { devAction } from './dev';
import { budget, commandAction, moduleAction } from './modules';
import { affordable, buildable, option, type Pick, type Target } from './plan';
import { planSpot, routeToward } from './routes';
import { bankAction, overflow, ownOfferAction, proposeAction, type Needs } from './trade';
import { has } from './cards';

const ROUTES: BuildPiece[] = ['road', 'ship'];

type Place = { piece: Purchase; at: string };

/** Route edge (road or ship) that heads for `spot`, else any legal one when `anyOk`. */
function route(c: Ctx, spot: string | null, anyOk: boolean): Place | null {
  const all = ROUTES.flatMap(p => (option(c, p)?.targets ?? []).map(at => ({ piece: p as Purchase, at })));
  if (!all.length) return null;
  return (spot ? routeToward(c, all, spot) : null) ?? (anyOk ? all[0] : null);
}

/** Owed free routes (Road Building) go toward the plan first. */
function freeRoute(c: Ctx): Action | null {
  const free = ROUTES.some(p => (option(c, p)?.free ?? 0) > 0);
  if (!free) return null;
  const p = route(c, planSpot(c)?.spot ?? null, true);
  if (!p || !buildable(option(c, p.piece), p.at)) return null;
  return act(c, { type: 'build', piece: p.piece as BuildPiece, at: p.at });
}

const pickFor = (c: Ctx) => (t: Target): Pick | null => {
  const { piece, at, command } = t.next;
  if (command) return budget(c, command) ? { command } : null;
  if (!piece) return null;
  if (t.goal === 'road') return at ? { piece, at } : route(c, t.spot, false);
  return { piece, at };
};

function build(c: Ctx, p: Pick, n: Needs): Action | null {
  if ('command' in p) return commandAction(c, p.command, n);
  return p.piece === 'development' ? act(c, { type: 'buy-dev' })
    : act(c, { type: 'build', piece: p.piece as BuildPiece, at: p.at! });
}

/** Too many cards for a 7 and nothing better to do: a development card soaks up three. */
function spill(c: Ctx): Action | null {
  const o = option(c, 'development');
  return overflow(c) > 0 && buildable(o, null) && has(c.me.hand, o!.cost) ? act(c, { type: 'buy-dev' }) : null;
}

export type Step = { action: Action | null; wait: boolean };

export function rollStep(c: Ctx, list: Target[]): Step {
  const blocked = c.pub.prompts.some(p => p.seat !== c.seat);
  if (!c.me.can.roll) return { action: blocked ? null : freeRoute(c), wait: false };
  return { action: devAction(c, list[0], true) ?? act(c, { type: 'roll' }), wait: false };
}

export function mainStep(c: Ctx, n: Needs, list: Target[]): Step {
  if (!c.me.can.end) return { action: null, wait: false };
  const own = ownOfferAction(c, n);
  if (own === 'wait') return { action: null, wait: true };
  const action = own ?? freeRoute(c) ?? devAction(c, list[0], false)
    ?? (() => { const p = affordable(c, list, pickFor(c)); return p && build(c, p, n); })()
    ?? proposeAction(c, n) ?? bankAction(c, n) ?? moduleAction(c, n) ?? spill(c)
    ?? act(c, { type: 'end' });
  return { action, wait: false };
}
