/** Merchants, casinos and questionable business opportunities. */
import type { EventDef } from '../types';
import { augment, ev, hull, hurt, kin, leave, opt, opt1, out, pay, recruit, role, scrap, store, weapon } from './dsl';

const U = ['unknown'] as const, UD = ['unknown', 'distress'] as const;

export const TRADE: readonly EventDef[] = [
  ev('tr-casino', 'any', U, 'The Lucky Comet Casino', "A casino station spins in the dark, neon on every surface. A robot doorman bows. 'Captains! Fortune favors the fleet!'", [
    opt('slots', 'Play the slots', [
      out("Cherries, cherries, cherries! The machine spits scrap for a full minute.", [scrap(40)], 9),
      out("The house wins. The house always wins. The doorman sympathizes.", [], 11),
    ], pay(15)),
    opt('cards', 'Let a Skitter count cards', [
      out("Four eyes, eight arms, perfect recall. Your Skitter walks out with a fortune.", [scrap(35)], 7),
      out("Security spots the extra arms. They're thrown out, but not before cashing in some chips.", [scrap(10)], 3),
    ], kin('skitter')),
    opt1('shop', 'Visit the gift shop', "The gift shop sells weapons. Of course it does.", [store]),
  ]),
  ev('tr-junk-market', ['rustbelt'], U, 'Junk Market', "A floating bazaar made of lashed-together hulls. Stall owners shout prices at each other and at you.", [
    opt1('shop', 'Browse the stalls', "Everything is used and nothing has a warranty. Some of it is great.", [store]),
    leave("A stall owner throws a wrench at you as you leave. It's a nice wrench. You keep it."),
  ]),
  ev('tr-arms-dealer', 'any', UD, 'Arms Dealer', "A sleek ship hails you on a private channel. 'I have something special, captains. Not on any catalog. Scrap only.'", [
    opt1('buy', 'Buy the special', "The crate is heavy and warm. Inside is a weapon a lot better than it has any right to be.", [weapon(2)], pay(30)),
    leave("'Your loss,' says the dealer, and vanishes."),
  ]),
  ev('tr-fight-club', ['rustbelt', 'veil'], U, 'Ember Fight Club', "An Ember fight club runs out of a gutted ore freighter. The ring is a cargo bay. The crowd is loud, the purse is real.", [
    opt('ember', 'Enter an Ember fighter', [
      out("Your Ember fighter wins three bouts back to back. The crowd carries them home.", [scrap(35)], 7),
      out("Your Ember fighter wins, barely, and limps home with the purse.", [scrap(15), hurt(40)], 3),
    ], kin('ember')),
    opt('soldier', 'Send a soldier into the ring', [
      out("Solid, patient boxing. The purse is yours.", [scrap(25)], 3),
      out("Your soldier learns why Embers run fight clubs. The purse goes to someone else.", [hurt(30)], 2),
    ], role('soldier')),
    opt('bet', 'Place a bet', [
      out("Your pick wins by knockout!", [scrap(25)], 1),
      out("Your pick loses by knockout.", [], 1),
    ], pay(10)),
    leave("You watch one bout from the bleachers and leave with a headache."),
  ]),
  ev('tr-ordnance-barge', 'any', U, 'Ordnance Barge', "A slow barge stacked with missiles sits at the beacon. Its pilot seems remarkably calm for someone sitting on a bomb.", [
    opt1('buy', 'Buy missiles', "Crates of missiles slide into every ship's magazine.", [{ kind: 'ammo', amount: 4, who: 'fleet' }], pay(12)),
    leave(),
  ]),
  ev('tr-mechanic', 'any', UD, 'Back-Alley Mechanic', "A mechanic with a mustache and several missing fingers offers to tune your engines. Cash up front. 'Trust me.'", [
    opt('trust', 'Trust him', [
      out("He's good. Every engine in the fleet runs cleaner and faster.", [{ kind: 'upgrade', system: 'engines', who: 'fleet' }], 7),
      out("He's gone before you check his work. So is a part of your engine.", [{ kind: 'systemDamage', system: 'engines', amount: 1, who: 'random' }], 3),
    ], pay(20)),
    leave("He shrugs and goes back to his soup."),
  ]),
  ev('tr-monastery', ['meridian', 'veil'], U, 'Bastion Monastery', "A monastery carved into an asteroid, home to silent Bastion monks. They offer to mend your hulls, for a small donation.", [
    opt1('donate', 'Make a donation', "The monks mend your hulls in perfect silence.", [hull(6)], pay(10)),
    opt1('bastion', 'Your Bastion crew join their chant', "The monks welcome your Bastion crew like family. They mend your hulls and one monk joins the fleet.", [hull(6), recruit('bastion')], kin('bastion')),
    opt1('meditate', 'Meditate briefly', "It's very quiet. Someone falls asleep. Somehow the hulls look better.", [hull(2, 'weakest')]),
  ]),
  ev('tr-auction', ['rustbelt', 'meridian'], U, 'Salvage Auction', "A salvage auction broadcasts from a derelict station. Most lots are junk. One lot is labeled MYSTERY CRATE, which is either great or terrible.", [
    opt('crate', 'Bid on the mystery crate', [
      out("It's a weapon! Slightly used.", [weapon(1)], 5),
      out("It's scrap. Better scrap than you paid for.", [scrap(20)], 3),
      out("It's full of packing foam. Very nice packing foam.", [], 2),
    ], pay(10)),
    opt1('premium', 'Bid on the premium lot', "A shrink-wrapped augment, never opened.", [augment()], pay(25)),
    leave(),
  ]),
  ev('tr-repair-dock', 'any', U, 'Friendly Repair Dock', "A family-run repair dock with a hand-painted sign. The owner's kid offers to fix the worst of your dents for free.", [
    opt1('pay', 'Pay for a full repair', "The whole family pitches in. Your hulls shine.", [hull(8)], pay(12)),
    opt1('free', 'Take the free patch', "The kid does a surprisingly good job on your worst ship.", [hull(4, 'weakest')]),
  ]),
  ev('tr-crew-bar', 'any', U, 'Dockside Bar', "A bar at the end of the universe, or near enough. Out-of-work spacers line the counter, looking hopeful.", [
    opt1('hire', 'Buy a round and hire someone', "One spacer finishes their drink and follows you out.", [recruit()], pay(15)),
    opt1('brawler', 'Hire the Ember in the corner', "The Ember cracks her knuckles, grins and grabs her bag.", [recruit('ember', 'soldier')], pay(20)),
    leave("The bartender waves goodbye with a dirty rag."),
  ]),
];
