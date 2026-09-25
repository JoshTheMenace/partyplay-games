/**
 * Named, hand-built PublicView/PrivateView samples for UI and CPU work before the engine plays.
 * Each entry is a factory, so callers get a fresh copy they may mutate. WP-qa later regenerates
 * the same names from real engine states.
 */
import type { Outcome } from '../../../../party-contract/src/index';
import type { PublicView } from '../../src/model';
import { concurrent8, mid4, paired6, roll3, setup4, sevenDiscard4, sevenRobber4 } from './base';
import type { Fixture } from './build';
import { citiesKnights4 } from './ck';
import { explorers4, seafarers4 } from './sea';
import { connect6, ended6, finale6, max10, offers12 } from './table';

export type { Fixture } from './build';

export const FIXTURES = {
  'setup-4': setup4,
  'roll-3': roll3,
  'mid-4': mid4,
  'seven-discard-4': sevenDiscard4,
  'seven-robber-4': sevenRobber4,
  'paired-6': paired6,
  'concurrent-8': concurrent8,
  'connect-6': connect6,
  'offers-12': offers12,
  'max-10': max10,
  'finale-6': finale6,
  'ended-6': ended6,
  'ck-4': citiesKnights4,
  'seafarers-4': seafarers4,
  'explorers-4': explorers4,
} satisfies Record<string, () => Fixture>;

export type FixtureName = keyof typeof FIXTURES;
export const FIXTURE_NAMES = Object.keys(FIXTURES) as FixtureName[];
export const loadFixture = (name: FixtureName): Fixture => FIXTURES[name]();

/** The platform Outcome the server would report for this view (complete only once ended). */
export function outcomeOf(pub: PublicView): Outcome {
  const standings = pub.results?.standings ?? [...pub.seats].sort((a, b) => b.vp - a.vp)
    .map((s, i) => ({ seat: s.id, rank: i + 1, vp: s.vp }));
  return {
    complete: pub.turn.stage === 'ended',
    winners: pub.results?.winners ?? [],
    rows: standings.map(s => ({ playerId: s.seat, score: s.vp, rank: s.rank })),
  };
}
