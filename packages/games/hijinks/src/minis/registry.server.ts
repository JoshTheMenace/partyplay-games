import type { MiniServer } from '../core/contract';
import { server as quipClash } from './quip-clash/server';
import { server as tallTales } from './tall-tales/server';
import { server as sketchBluff } from './sketch-bluff/server';
import { server as shirtShow } from './shirt-show/server';
import { server as quizPanic } from './quiz-panic/server';
import { server as oddOneIn } from './odd-one-in/server';
import { server as ballparkServer } from './ballpark/server';
import { server as commentSection } from './comment-section/server';
import { server as bracketBrawl } from './bracket-brawl/server';
import { server as airlock } from './airlock/server';
import { server as splitDecision } from './split-decision/server';

/**
 * Minigame id → MiniServer (server only). Add one import and one entry per minigame, e.g.
 *   import { server as quipClash } from './quip-clash/server';
 *   export const SERVERS: Record<string, MiniServer> = { 'quip-clash': quipClash };
 * Catalog entries without a server here are treated as ineligible by the pack.
 */
export const SERVERS: Record<string, MiniServer> = {
  'quip-clash': quipClash,
  'tall-tales': tallTales,
  'sketch-bluff': sketchBluff,
  'shirt-show': shirtShow,
  'quiz-panic': quizPanic,
  'odd-one-in': oddOneIn,
  ballpark: ballparkServer,
  'comment-section': commentSection,
  'bracket-brawl': bracketBrawl,
  'split-decision': splitDecision,
  airlock,
};
