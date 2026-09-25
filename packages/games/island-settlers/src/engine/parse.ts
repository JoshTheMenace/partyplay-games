/** `parseAction`: shape and bounds only (legality is checked by the handlers). Port of legacy bounds. */
import {
  ACTION_LIMITS, EMOTES, GOODS, RESOURCES, type Action, type CardPicks, type Cards, type Emote,
  type Good, type IntentPiece, type Picks, type Resource,
} from '../model';
import { need } from './need';

type Raw = Record<string, unknown>;

const PIECES = ['road', 'ship', 'settlement', 'city'] as const;
const INTENTS: readonly IntentPiece[] = [...PIECES, 'knight', 'move'];

function object(raw: unknown, what = 'an object'): Raw {
  need(raw !== null && typeof raw === 'object' && !Array.isArray(raw), `Expected ${what}.`);
  return raw as Raw;
}

function id(raw: unknown): string {
  need(typeof raw === 'string' && raw.length > 0 && raw.length <= 80, 'Invalid identifier.');
  return raw;
}

function cards(raw: unknown): Cards {
  const value = object(raw, 'cards'), out: Cards = {};
  for (const [key, n] of Object.entries(value)) {
    need(GOODS.includes(key as Good), 'Unknown resource.');
    need(Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 200, 'Invalid card count.');
    if (n) out[key as Good] = n as number;
  }
  return out;
}

function record<T>(raw: unknown, max: number, value: (v: unknown) => T): Record<string, T> {
  const entries = Object.entries(object(raw));
  need(entries.length <= max, 'Too many choices.');
  return Object.fromEntries(entries.map(([k, v]) => [id(k), value(v)]));
}

const picks = (raw: unknown): Picks => record(raw ?? {}, 16, id);
const cardPicks = (raw: unknown): CardPicks => record(raw ?? {}, 8, cards);
const choices = (a: Raw) => ({ picks: picks(a.picks), cards: cardPicks(a.cards) });

function oneOf<T>(raw: unknown, allowed: readonly T[], reason: string): T {
  need(allowed.includes(raw as T), reason);
  return raw as T;
}

export function parseAction(raw: unknown): Action {
  let bytes = Infinity;
  try { bytes = new TextEncoder().encode(JSON.stringify(raw)).length; } catch { /* rejected below */ }
  need(bytes <= ACTION_LIMITS.maxBytes, 'That action is too large.');
  const a = object(raw, 'an action');
  need(Number.isSafeInteger(a.turnId) && (a.turnId as number) >= 0, 'Invalid turn.');
  const turnId = a.turnId as number;
  switch (a.type) {
    case 'roll': case 'end': case 'buy-dev': return { type: a.type, turnId };
    case 'build':
      return { type: 'build', turnId, piece: oneOf(a.piece, PIECES, 'Unknown piece.'), at: id(a.at) };
    case 'move-ship': return { type: 'move-ship', turnId, from: id(a.from), to: id(a.to) };
    case 'play-dev': {
      need(Array.isArray(a.goods) && a.goods.length <= 2, 'Choose up to two resources.');
      const goods = a.goods.map(g => oneOf<Resource>(g, RESOURCES, 'Unknown resource.'));
      return { type: 'play-dev', turnId, card: id(a.card), goods };
    }
    case 'bank': return { type: 'bank', turnId, give: cards(a.give), get: cards(a.get) };
    case 'offer': {
      need(Array.isArray(a.to) && a.to.length <= 10, 'Choose up to ten players.');
      const counterTo = a.counterTo === null || a.counterTo === undefined ? null : id(a.counterTo);
      return { type: 'offer', turnId, give: cards(a.give), want: cards(a.want), to: a.to.map(id), counterTo };
    }
    case 'respond': {
      const answer = oneOf(a.answer, ['accept', 'decline'] as const, 'Answer accept or decline.');
      const reason = a.reason;
      need(reason === undefined || (typeof reason === 'string' && reason.length <= 80), 'Reason is too long.');
      return { type: 'respond', turnId, offer: id(a.offer), answer, ...(reason ? { reason: reason as string } : {}) };
    }
    case 'confirm-trade': return { type: 'confirm-trade', turnId, offer: id(a.offer), partner: id(a.partner) };
    case 'withdraw': return { type: 'withdraw', turnId, offer: id(a.offer) };
    case 'answer': return { type: 'answer', turnId, prompt: id(a.prompt), ...choices(a) };
    case 'command': return { type: 'command', turnId, command: id(a.command), ...choices(a) };
    case 'skip-paired':
      need(typeof a.skip === 'boolean', 'Choose whether to skip.');
      return { type: 'skip-paired', turnId, skip: a.skip };
    case 'intent': {
      const piece = a.piece === null ? null : oneOf(a.piece, INTENTS, 'Unknown piece.');
      return { type: 'intent', turnId, piece };
    }
    case 'emote': return { type: 'emote', turnId, emote: oneOf<Emote>(a.emote, EMOTES, 'Unknown emote.') };
    default: throw new Error('Unknown action.');
  }
}
