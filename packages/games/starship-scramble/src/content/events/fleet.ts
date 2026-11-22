/**
 * Fleet life: what happens to a whole flotilla on the road, drawn only for fleets of several wings. One to four captains keep the library their
 * runs were tuned on: with these in the pool, four captains won 7 of 30 Captain long runs instead of 13. Added in the 2026-11 pass; all original.
 */
import { WING_SIZE } from '../../contracts';
import type { EventDef } from '../types';
import { armada, augment, ev, fight, hull, hurt, kin, leave, opt, opt1, out, pay, recruit, reveal, role, scrap, sys, weapon } from './dsl';

const U = ['unknown'] as const, UN = ['unknown', 'nebula'] as const;

const LIFE: readonly EventDef[] = [
  ev('f-long-table', 'any', U, 'The Long Table', "A quiet beacon, and for once nobody is shooting. Someone suggests docking the whole fleet nose to nose and eating together. Every galley has an opinion about soup.", [
    opt1('feast', 'Dock up and eat', "Forty minutes of soup, three arguments and one toast. The engineers swap spare parts under the table. Every hull leaves a little better than it came.", [hull(4), scrap(6)]),
    opt1('drill', 'Skip dinner, run gunnery drills', "The gunners spend the evening shooting at a towed crate and at each other's pride. One crew comes out of it sharper.", [{ kind: 'upgrade', system: 'weapons', who: 'random' }]),
  ], { weight: .8 }),
  ev('f-signal-lanterns', ['veil', 'sanctum'], ['nebula'], 'Signal Lanterns', "The fog is thick enough to lose a wingmate in. A deckhand proposes hanging running lanterns off every stern, like a school outing.", [
    opt('tight', 'Fly close, lanterns lit', [
      out("The fleet crosses the bank as one long glowing caterpillar. Paint is traded at two corners, but nobody gets lost and time is made up.", [hull(-1), armada(-1)], 3),
      out("Something in the fog likes lanterns. It follows the last ship for an hour, tapping on the hull.", [hurt(15, 'random'), armada(-1)], 1),
    ]),
    opt1('loose', 'Spread out and chart it', "Slower and lonelier, but the wide sweep maps every beacon in the sector.", [reveal]),
  ]),
  ev('f-tin-choir', 'any', ['distress'], 'The Tin Choir', "The distress call is a barge of maintenance robots whose owners left long ago. They have been rehearsing the same song since and would like an audience, and a tow.", [
    opt('tow', 'Applaud, then take them aboard', [
      out("Most of the choir retires to a museum at the next port. One soloist insists on signing on as an engineer.", [recruit(undefined, 'engineer'), scrap(6)], 2),
      out("They pay for the tow in spare parts, all neatly labelled and slightly out of tune.", [scrap(14)], 2),
    ]),
    opt1('conduct', 'A medic conducts them through it', "Your medic has perfect pitch and no shame. The robots finish the song at last, weep oil, and hand over the barge's medical stores.", [augment('nanite-medics')], role('medic')),
    leave("The song follows the fleet on the radio for two jumps. It is not a bad song."),
  ]),
  ev('f-customs-of-nowhere', 'any', U, 'Customs of Nowhere', "A buoy with a rubber stamp declares this beacon a border and the fleet an import. It quotes a toll and a form in triplicate. No nation is named.", [
    opt1('pay', 'Pay the toll', "The buoy stamps every hull with PAID and waves the fleet through a lane the charts don't show.", [armada(-1)], pay(8)),
    opt('argue', 'Argue jurisdiction', [
      out("After a short hearing the buoy concedes it is, legally, a lamp. It refunds a toll nobody paid.", [scrap(16)], 2),
      out("The buoy has more patience than the fleet has time.", [armada(1)], 1),
    ]),
    opt1('confiscate', 'Impound the buoy', "A laser removes the stamp arm. The cash box is real, and so is the guard drone that takes it personally.", [scrap(18), hull(-2, 'random')], { kind: 'weapon', weaponKind: 'laser' }),
  ]),
  ev('f-comet-rodeo', ['rustbelt', 'cinder'], U, 'Comet Rodeo', "Ice miners are riding a comet down the gravity well for sport and dare the fleet to keep pace. The prize is a crate. The crate is ticking, in a friendly way.", [
    opt1('ace', 'Send the best pilot', "Your pilot threads the tail, tips a wing at the judges and wins by a length. The crate holds a weapon and a small trophy.", [weapon(1), scrap(8)], role('pilot')),
    opt('ride', 'Everybody rides', [
      out("The fleet finishes mid-table, soaked in ice and glory. The miners pass a hat.", [scrap(12), hull(-1)], 2),
      out("Comet tails are mostly gravel. One ship learns this in detail.", [hull(-4, 'random'), scrap(6)], 1),
    ]),
    leave("The miners boo cheerfully as the fleet goes by."),
  ]),
  ev('f-greenhouse', 'any', ['derelict'], 'Greenhouse Adrift', "A botanical ship, long abandoned, has gone to forest. Vines hold the airlocks open from inside. Something in there is still watering the plants.", [
    opt('harvest', 'Send a harvest party', [
      out("Seed stock, timber and a working pump. The gardener, an old drone, only asks that you close the door behind you.", [scrap(20)], 3),
      out("The spores get into everything. One crew spends the night sneezing in the medbay.", [scrap(10), hurt(20, 'random')], 2),
    ]),
    opt1('tree', 'Bastion crew carry out the old tree', "Your Bastion crew walk the great tree out root ball and all and plant it in a cargo bay. The air aboard has never been better.", [{ kind: 'upgrade', system: 'oxygen', who: 'weakest' }, hull(2)], kin('bastion')),
    leave("The forest keeps its ship."),
  ]),
  ev('f-drill-buoy', 'any', U, 'Drill Sergeant Buoy', "A navy training buoy is still running exercises for a navy that no longer exists. It scores the fleet's formation on arrival: two out of ten.", [
    opt('drill', 'Run its exercises', [
      out("Three hours of shouted corrections later the buoy awards a grudging six and unlocks its practice magazine and its petty cash.", [{ kind: 'ammo', amount: 3, who: 'fleet' }, scrap(12)], 2),
      out("The buoy fails the fleet, then quietly tunes one ship's drive out of pity.", [{ kind: 'upgrade', system: 'engines', who: 'weakest' }], 1),
    ]),
    opt1('show-off', 'A gunner shows it how it is done', "Ten targets, ten hits. The buoy plays a fanfare it has been saving for a century and hands over its instructor's sidearm.", [weapon(2)], role('gunner')),
  ]),
  ev('f-lamplighter', 'any', UN, 'The Lamplighter', "An old keeper in a patched tug goes from dead beacon to dead beacon relighting them, because somebody should. The tug is out of fuel cells.", [
    opt1('fuel', 'Give her fuel cells', "She relights the lane behind the fleet with every lamp turned to face the wrong way. The Armada's navigators have a very bad week.", [armada(-2)], pay(10)),
    opt1('listen', 'Share a pot of tea', "She has kept these lanes for forty years and knows where everything is. She draws it all on a napkin and sends the fleet off with a crate of spares.", [reveal, scrap(10)]),
  ], { weight: .8 }),
  ev('f-wake-riders', 'any', ['hostile'], 'Wake Riders', "Small fast ships have slipped into the fleet's engine wake and are siphoning the exhaust for fuel. They wave. They do not leave.", [
    opt1('fight', 'Turn and fight', "The riders drop their hoses and come about, guns hot.", [fight('sector', { bonus: 1.25 })]),
    opt1('burn', 'Outrun them on engines', "The fleet's drives flare white. The riders tumble out of the wake like leaves, and their siphon gear is yours to keep.", [scrap(16)], sys('engines', 3)),
    opt('toll', 'Charge them for the ride', [
      out("They pay up, laughing, and peel off at the next beacon.", [scrap(18)], 1),
      out("They pay in bullets.", [fight('sector', { bonus: 1.5 })], 1),
    ]),
  ]),
  ev('f-armistice', 'any', U, 'Armistice Day', "Two crews who fought each other in a war nobody else remembers meet here every year to drink to it. This year there is a spare hull between them and nobody left to fly it.", [
    opt1('join', 'Stand the watch with them', "The fleet keeps the long silence with them. At dawn the old captains sign the spare hull over to people who will use it.", [{ kind: 'reserves', amount: 1 }]),
    opt1('trade', 'Sell them supplies', "They pay well and overtip. One of them presses a medal into your quartermaster's hand and will not take it back.", [scrap(22)]),
  ], { unique: true, weight: .6 }),
];
export const FLEET: readonly EventDef[] = LIFE.map(e => ({ ...e, fleet: WING_SIZE + 1 }));
