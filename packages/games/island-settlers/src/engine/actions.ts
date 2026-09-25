/**
 * Clone-validate-commit and the action dispatcher. Every change (actions, ticks, CPUs, autos,
 * presence) goes through `commit`, so a rejected action leaves the state exactly as it was.
 */
import type { Action, SeatId } from '../model';
import { build, moveShip } from './build';
import { transfer } from './cards';
import { validateAnswer } from './commands';
import { buyDev, playDev } from './dev';
import { wakeCpus } from './auto';
import { advance } from './effects';
import { emit } from './events';
import { afterPlacement, checkWin, end, role, roll, skipPaired } from './flow';
import { hooks, moduleById } from './modules/registry';
import { need } from './need';
import { answerPrompt, seatPrompts, tablePromptOpen } from './prompts';
import { updateAwards } from './score';
import { track } from './stats';
import { cloneState, seat, seatName, type State } from './state';
import * as trade from './trade';

export const EMOTE_GAP_MS = 3000;

/** Run `fn` on a clone, resolve the effect queue and post-commit invariants, then publish. */
export function commit(s: State, now: number, fn: (next: State) => void) {
  const next = cloneState(s);
  next.now = now;
  fn(next);
  advance(next);
  trade.invalidateOffers(next);
  updateAwards(next);
  checkWin(next);
  advance(next);
  track(next);
  wakeCpus(next);
  if (next.mapDirty && JSON.stringify(next.pieces) !== JSON.stringify(s.pieces)) next.mapRev++;
  next.mapDirty = false;
  next.rev++;
  Object.assign(s, next);
}

/** Actions a table prompt (or your own prompt) never blocks. */
const ALWAYS: ReadonlySet<Action['type']> = new Set(['answer', 'respond', 'withdraw', 'emote']);

export function applyAction(s: State, id: SeatId, a: Action, now: number) {
  commit(s, now, next => dispatch(next, id, a));
}

function dispatch(s: State, id: SeatId, a: Action) {
  const p = seat(s, id), stage = s.turn.stage;
  need(stage !== 'ended', 'The game has finished.');
  if (a.type === 'emote') return emote(s, id, a.emote);
  need(stage !== 'finale', 'The game is over. Only emotes now.');
  need(a.turnId === s.turn.id, 'The turn changed. Choose again.');
  if (!ALWAYS.has(a.type)) {
    need(!tablePromptOpen(s), 'Waiting for other players to decide.');
    need(!seatPrompts(s, id).length, 'Finish your open decision first.');
  }
  if (!p.cpu && a.type !== 'intent') Object.assign(p, { autoStreak: 0, away: false });
  switch (a.type) {
    case 'roll': return roll(s, id);
    case 'end': return end(s, id);
    case 'build': {
      const setup = stage === 'setup';
      if (setup) need(role(s, id) === 'setup', 'It is not your placement.');
      build(s, id, a.piece, a.at);
      if (s.intent?.seat === id) s.intent = null;
      return setup ? afterPlacement(s, id, a.at) : undefined;
    }
    case 'move-ship': return moveShip(s, id, a.from, a.to);
    case 'buy-dev': return buyDev(s, id);
    case 'play-dev': return playDev(s, id, a.card, a.goods);
    case 'bank': return trade.bank(s, id, a.give, a.get);
    case 'offer': return trade.offer(s, id, a);
    case 'respond': return trade.respond(s, id, a);
    case 'confirm-trade': return trade.confirmTrade(s, id, a);
    case 'withdraw': return trade.withdraw(s, id, a.offer);
    case 'answer': return answerPrompt(s, id, a.prompt, a.picks, a.cards);
    case 'command': return runCommand(s, id, a);
    case 'skip-paired': return skipPaired(s, id, a.skip);
    case 'intent': {
      if (a.piece === null) { if (s.intent?.seat === id) s.intent = null; return; }
      need(role(s, id) !== null, 'You are not placing anything now.');
      s.intent = { seat: id, piece: a.piece };
      return;
    }
  }
}

function runCommand(s: State, id: SeatId, a: Extract<Action, { type: 'command' }>) {
  const c = hooks(s, 'commands').flatMap(m => m.commands(s, id)).find(c => c.id === a.command);
  need(c, 'That action is no longer available.');
  const answer = validateAnswer(c, a.picks, a.cards);
  const m = c.module === 'core' ? undefined : moduleById(c.module);
  need(m?.apply, 'That action is no longer available.');
  if (c.cost) transfer(s.seats[id].hand, s.bank, c.cost, 'You cannot afford that.');
  m.apply(s, id, c.id, answer);
}

function emote(s: State, id: SeatId, kind: Extract<Action, { type: 'emote' }>['emote']) {
  const p = seat(s, id);
  need(s.now - p.emoteAt >= EMOTE_GAP_MS, 'One emote every 3 seconds.');
  p.emoteAt = s.now;
  emit(s, { kind: 'emote', seat: id, emote: kind, text: `${seatName(s, id)}: ${kind}` });
}
