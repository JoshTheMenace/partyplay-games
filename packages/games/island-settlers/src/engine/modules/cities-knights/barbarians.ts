/**
 * The event die (resolved before production), the barbarian ship and its attack: city count vs
 * active knight strength, pillage for the weakest contributors, the Defender of Catan point or shared
 * progress draws, then every knight goes inactive and the robber (and pirate) enter play.
 */
import type { Track } from '../../../model';
import { choice, command, pickField } from '../../commands';
import { emit } from '../../events';
import { setRobber, updateUnit } from '../../pieces';
import { openPrompt } from '../../prompts';
import { int } from '../../rng';
import { random, seatName, type RollDraft, type State } from '../../state';
import type { PromptSpec } from '../registry';
import { coins, rx } from '../rivers';
import { cityLabel, pillage, pipsAt, plainCities } from './city';
import { drawProgress, drawRound, openDecks } from './progress';
import {
  cities, ck, EVENT_FACES, knightsOf, LENGTH, note, shipTrack, strength, sx, TRACK_LABEL,
} from './state';

/** beforeProduce: Alchemist dice, then the event die. */
export function eventDie(s: State, roll: RollDraft) {
  const x = ck(s);
  if (x.alchemy) {
    roll.dice = x.alchemy;
    roll.total = x.alchemy[0] + x.alchemy[1];
    x.alchemy = null;
  }
  const face = EVENT_FACES[int(random(s, 'dice'), EVENT_FACES.length)];
  roll.eventDie = face;
  x.lastEvent = face;
  if (face !== 'ship') return drawRound(s, face, roll.dice[0]);
  if (!shipTrack(s)) return;
  x.position++;
  if (x.position >= LENGTH) return attack(s);
  note(s, 'ship', null, null, `The barbarian ship sails closer (${x.position} of ${LENGTH})`);
}

export function attack(s: State) {
  const x = ck(s), power = cities(s).length, str = new Map(s.order.map(id => [id, strength(s, id)]));
  const defense = [...str.values()].reduce((a, b) => a + b, 0);
  let losers: string[] = [], defenders: string[] = [];
  if (defense >= power) {
    const best = Math.max(0, ...str.values());
    defenders = best > 0 ? s.order.filter(id => str.get(id) === best) : [];
    if (defenders.length === 1) sx(s, defenders[0]).defender++;
    else for (const id of defenders) {
      if (openDecks(s, id).length) openPrompt(s, { seat: id, kind: 'cities-knights/defense-draw', scope: 'table' });
    }
  } else {
    const exposed = s.order.filter(id => plainCities(s, id).length);
    const low = Math.min(...exposed.map(id => str.get(id)!));
    losers = exposed.filter(id => str.get(id) === low);
    for (const id of losers) {
      const spots = plainCities(s, id);
      if (spots.length === 1 && !ransom(s, id)) pillage(s, id, spots[0].vertex);
      else openPrompt(s, { seat: id, kind: 'cities-knights/pillage', scope: 'table' });
    }
  }
  const won = defense >= power, who = (ids: string[]) => ids.map(id => seatName(s, id)).join(', ');
  const hero = defenders.length === 1 ? `: ${who(defenders)} +1` : '';
  const text = won ? `Barbarians repelled (${defense} vs ${power})${hero}`
    : `Barbarians win (${power} vs ${defense}): ${who(losers) || 'no city'} pillaged`;
  const result = won ? 'defended' : 'pillaged';
  emit(s, { kind: 'barbarians', strength: power, defense, result, losers, defenders, text });
  for (const k of knightsOf(s)) updateUnit(s, k.id, { active: false });
  x.position = 0;
  if (++x.attacks === 1 && x.start) setRobber(s, x.start);
}

/** Rivers + C&K (official): a seat about to be pillaged may pay 5 gold to keep its city. */
const RANSOM = 5;
const ransom = (s: State, seat: string) => s.modules.includes('rivers') && coins(s, seat) >= RANSOM;

export const pillagePrompt: PromptSpec = {
  timer: 'prompt', autoText: 'Loses the city that produces least', label: 'Losing a city',
  command(s, p) {
    const spots = plainCities(s, p.seat).map(b => b.vertex).sort((a, b) => pipsAt(s, a) - pipsAt(s, b));
    const keep = ransom(s, p.seat) ? [choice('keep', `Pay ${RANSOM} gold`, 'Keep all your cities')] : [];
    return command({
      id: p.id, module: 'cities-knights', group: 'barbarians', label: 'Barbarians pillage a city', hint: 1,
      detail: 'Pick a city to reduce to a settlement',
      fields: [pickField('city', 'City', [...spots.map(v => choice(v, cityLabel(s, v))), ...keep], 'vertex')],
    });
  },
  apply(s, p, a) {
    if (a.picks.city !== 'keep') return pillage(s, p.seat, a.picks.city);
    rx(s).coins[p.seat] -= RANSOM;
    note(s, 'ransom', p.seat, null, `${seatName(s, p.seat)} paid ${RANSOM} gold to keep a city`);
  },
  auto(s, p) {
    const spots = plainCities(s, p.seat).map(b => b.vertex).sort((a, b) => pipsAt(s, a) - pipsAt(s, b));
    return { picks: { city: spots[0] }, cards: {} };
  },
};

export const defenseDrawPrompt: PromptSpec = {
  timer: 'prompt', autoText: 'Draws from your best track', label: 'Choosing a progress card',
  command: (s, p) => command({
    id: p.id, module: 'cities-knights', group: 'progress', label: 'Shared defense: draw a card', hint: 1,
    detail: 'Tied for the most knights: pick a deck',
    fields: [pickField('track', 'Deck', openDecks(s, p.seat).map(t => choice(t, TRACK_LABEL[t])), 'track')],
  }),
  apply: (s, p, a) => drawProgress(s, p.seat, a.picks.track as Track),
  auto: (s, p) => ({ picks: { track: openDecks(s, p.seat)[0] }, cards: {} }),
};
