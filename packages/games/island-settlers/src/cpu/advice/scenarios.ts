/**
 * Traders & Barbarians scenarios. Fishing saves fish for the most useful favour; Rivers values
 * river corners for their gold; Caravans bids for camels that pay us (a building between two
 * camels is +1 VP) and names the engine's best edge for us.
 */
import type { CardsField, Command, Good, PickField, VertexId } from '../../model';
import { option } from '../plan';
import { planSpot } from '../routes';
import type { Ctx } from '../context';
import { shed } from '../prompts';
import { overflow, type Needs } from '../trade';
import { VP, type Advisor } from './index';

const PRICE: Record<string, number> = { steal: 3, resource: 4, route: 5, dev: 7 };

/**
 * Fish buy one favour at a time and overpayment is lost, so save for the most valuable favour we can
 * use (a free road only with somewhere to go), then spend on it; near the token cap, spend anyway.
 */
function fishWorth(c: Ctx, cmd: Command): number | null {
  const kind = cmd.id.slice('fishing-'.length), tokens = c.me.ext.fishing?.fish ?? [];
  if (kind === 'boot') return VP;
  if (kind === 'robber' || kind === 'pirate') return cmd.hint >= 0.5 ? 1.8 : 0.2;
  if (!(kind in PRICE)) return null;
  const dev = !!option(c, 'development') && c.pub.devDeck > 0, road = !!planSpot(c);
  const value: Record<string, number> = { steal: 0.95, resource: 1.1, route: road ? 1.5 : 0.6, dev: 1.6 };
  const goal = dev ? 7 : road ? 5 : 4, fish = tokens.reduce((n, t) => n + t.value, 0);
  const open = c.me.commands.map(x => x.id.slice('fishing-'.length)).filter(k => k in PRICE);
  const best = open.reduce((a, b) => (value[b] > value[a] ? b : a), kind);
  return kind === best && (fish >= goal || tokens.length >= 6) ? value[kind] : 0.3;
}

const rivers$ = new WeakMap<object, Set<string>>();

/** Rivers: each settlement on a river hex corner earns 1 gold (2 gold buy a resource; wealth scores). */
function riverSpot(c: Ctx, v: VertexId) {
  let tiles = rivers$.get(c.pub.board);
  if (!tiles) {
    tiles = new Set(c.pub.board.features.flatMap(f => (f.kind === 'river' ? f.tiles : [])));
    rivers$.set(c.pub.board, tiles);
  }
  return (c.ix.vertex.get(v)?.tiles ?? []).some(t => tiles.has(t)) ? 0.2 : 0;
}

/** Camels touching each corner (for the +1 VP between two camels). */
function camelsAt(c: Ctx, v: VertexId) {
  return Object.values(c.pub.pieces.units).filter(u => u.kind === 'camel' && [c.ix.edge.get(u.at)?.a,
    c.ix.edge.get(u.at)?.b].includes(v)).length;
}

/**
 * Bids are paid win or lose, so bid only for a camel that completes a building between two camels
 * (+1 VP): one spare card, two with a card overflow.
 */
function bid(c: Ctx, cmd: Command, n: Needs) {
  const cards = cmd.fields.find((f): f is CardsField => f.kind === 'cards');
  const edges = cmd.fields.find((f): f is PickField => f.kind === 'pick');
  if (!cards || !edges) return undefined;
  const top = edges.options[0]?.value, e = top ? c.ix.edge.get(top) : undefined;
  const mine = (v: VertexId) => c.pub.pieces.buildings[v]?.seat === c.seat;
  const scores = !!e && [e.a, e.b].some(v => mine(v) && camelsAt(c, v) === 1);
  const offer = scores ? shed(cards, overflow(c) ? 2 : 1, n) : {};
  const spare = Object.entries(offer)
    .filter(([g, x]) => (c.me.hand[g as Good] ?? 0) - x >= (n.a[g as Good] ?? 0));
  return spare.length ? { picks: { [edges.key]: top! }, cards: { [cards.key]: Object.fromEntries(spare) } }
    : { picks: {}, cards: { [cards.key]: {} } };
}

export const fishing: Advisor = { worth: fishWorth };
export const rivers: Advisor = { spot: riverSpot };
export const caravans: Advisor = {
  answer: (c, cmd, n) => (cmd.fields.some(f => f.kind === 'cards' && f.key === 'bid') ? bid(c, cmd, n)
    : undefined),
};
