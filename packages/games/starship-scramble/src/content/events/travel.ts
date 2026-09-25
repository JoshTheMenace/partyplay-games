/** Things that happen on the road: weather, wrecks, oddities and the occasional free lunch. */
import type { EventDef } from '../types';
import { armada, ev, fight, hull, hurt, kin, leave, opt, opt1, out, recruit, reveal, role, scrap, sys, weapon, augment } from './dsl';

const U = ['unknown'] as const, UN = ['unknown', 'nebula'] as const;

export const TRAVEL: readonly EventDef[] = [
  ev('t-quiet-beacon', 'any', U, 'A Quiet Beacon', "Nothing here but a dim nav beacon and a lot of stars. The crews break out the welders and the good coffee.", [
    opt1('rest', 'Take a breather', "Dents get hammered out. Someone finally fixes that rattle. Nobody gets shot at.", [hull(3)]),
  ], { weight: 1.5 }),
  ev('t-drifting-cargo', 'any', UN, 'Drifting Cargo', "A cloud of cargo crates tumbles past, stencilled PROPERTY OF SOMEONE ELSE. Someone else is nowhere to be seen.", [
    opt1('collect', 'Scoop it up', "Finders keepers. The crates hold good salvage and one very confused hamster.", [scrap(12)]),
  ]),
  ev('t-munitions', 'any', U, 'Munitions Cache', "An old military cache hangs from a burnt-out relay, its missile racks still sealed. The paperwork expired a century ago. The warheads didn't.", [
    opt1('load', 'Load the racks', "Your crews pass missiles hand to hand like buckets at a fire. Every ship tops up.", [{ kind: 'ammo', amount: 3, who: 'fleet' }]),
  ]),
  ev('t-space-whales', 'any', UN, 'Space Whales', "A pod of star-whales glides past, each longer than the whole fleet, singing in radio. One calf rolls over to look at you.", [
    opt('follow', 'Follow the pod', [
      out("The whales lead you down a current you'd never have found. The Armada falls behind.", [armada(-1), reveal], 3),
      out("The calf wants to play. Its idea of play is a gentle nudge. Your hull disagrees about 'gentle'.", [hull(-3, 'random')], 2),
    ]),
    opt('harvest', 'Collect their shed scales', [
      out("Whale scale fetches a fortune at any market. The pod doesn't seem to mind.", [scrap(25)], 7),
      out("The mother minds. One swat of her tail and you're done collecting.", [scrap(10), hull(-4, 'weakest')], 3),
    ]),
    opt1('sing', 'Skitter crew sing back', "The pod answers your Skitter crew's song and carries the fleet along in its wake for a whole jump.", [armada(-2)], kin('skitter')),
  ]),
  ev('t-micrometeors', 'any', U, 'Micrometeor Shower', "A glittering sheet of sand-sized meteors sweeps toward the fleet. Beautiful, and very sandpapery.", [
    opt1('push', 'Push through', "The fleet comes out the far side pitted, scratched and slightly shinier.", [hull(-2)]),
    opt1('detour', 'Go around it', "A long, dull detour. Not a scratch on anyone, but the Armada gains ground.", [armada(1)]),
    opt1('defense', 'Let point defense clear a path', "Point defense turns the shower into a light show and a debris trail worth salvaging.", [scrap(15)], sys('defense')),
  ]),
  ev('t-solar-flare', 'any', U, 'Flare Warning', "The local star is about to sneeze. Instruments give you maybe a minute before a solar flare washes over the beacon.", [
    opt1('hide', 'Hide behind a moon', "The flare roars past harmlessly. Waiting it out costs time.", [armada(1)]),
    opt('ride', 'Ride it out', [
      out("A bright minute and a lot of static. Everyone is fine. Probably.", [], 3),
      out("The flare fries shield emitters and gives the crew a nasty sunburn.", [{ kind: 'systemDamage', system: 'shields', amount: 1, who: 'random' }, hurt(15, 'fleet')], 2),
    ]),
  ]),
  ev('t-derelict', 'any', UN, 'Derelict Freighter', "A freighter drifts dark and silent, cargo doors half open. The name on the hull has been scratched out by hand.", [
    opt('search', 'Dock and search it', [
      out("The hold is full of forgotten salvage.", [scrap(20)], 5),
      out("Behind a false wall, a weapon crate. Someone was smuggling.", [weapon(1)], 3),
      out("A corroded pipe bursts. Your boarding crew get a faceful of coolant.", [hurt(20)], 2),
    ]),
    opt1('beam', 'Beam an away team deep inside', "Your team materializes in the sealed hold. It's dark, and something is scratching.", [{ kind: 'event', eventId: 't-derelict-hold' }], sys('teleporter')),
    leave(),
  ]),
  ev('t-derelict-hold', 'any', [], "The Freighter's Hold", "Your away team finds a sealed vault in the hold. The scratching is coming from inside it.", [
    opt('open', 'Open the vault', [
      out("Inside sits a pristine augment and a very angry maintenance robot. You keep the augment.", [augment()], 3),
      out("It was not cargo. It was a stowaway, and it has friends outside.", [fight('sector')], 2),
    ]),
    opt1('loose', 'Grab what is loose and leave', "Your team fills its pockets and beams out. The scratching gets louder behind them.", [scrap(15)]),
  ]),
  ev('t-ghost-station', 'any', U, 'Ghost Station', "A research station with every light on and nobody home. Half-eaten dinners still sit on the tables.", [
    opt('explore', 'Explore it', [
      out("The lab is abandoned, but the supply lockers are not.", [scrap(25)], 5),
      out("An engineer crawls out of a vent. 'Are they gone?' She won't say who. She joins up anyway.", [recruit('human', 'engineer')], 3),
      out("The air recyclers fail while your crews are inside. Everyone comes back gasping.", [hurt(15, 'fleet')], 2),
    ]),
    leave("Some dinners are best left uneaten."),
  ]),
  ev('t-fuel-leak', 'any', U, 'Leaky Fuel Lines', "A fuel line ruptures mid-jump on one ship, spraying glittering vapor through the engine room. The fleet drops out to fix it.", [
    opt('patch', 'Patch it and pray', [
      out("Tape, sealant and a prayer. It holds, mostly.", [hull(-2, 'random')], 3),
      out("The patch fails and the engines choke on vapor.", [{ kind: 'systemDamage', system: 'engines', amount: 1, who: 'random' }], 2),
    ]),
    opt1('engineer', 'Let an engineer rebuild the manifold', "Your engineer rebuilds the whole manifold, better than factory spec.", [{ kind: 'upgrade', system: 'engines', who: 'random' }], role('engineer')),
  ]),
  ev('t-shortcut', 'any', U, 'Uncharted Shortcut', "An old smuggler's lane cuts straight through a debris field. It would save a lot of time, if the charts are right.", [
    opt('take', 'Take the shortcut', [
      out("The charts were right. You pop out well ahead of schedule.", [armada(-1), reveal], 1),
      out("The charts were optimistic. So is your hull plating, now.", [hull(-3)], 1),
    ]),
    opt1('pilot', 'Let a pilot thread the needle', "Your pilot flies it like a racing line. The fleet gains a full jump on the Armada.", [armada(-2), reveal], role('pilot')),
    opt1('stay', 'Stick to the known route', "Slow and steady. Nothing happens, and that's fine."),
  ]),
  ev('t-graveyard', ['rustbelt'], U, 'Ship Graveyard', "Acres of wrecked hulls, stripped and restripped by generations of scavengers. There's always one more panel worth prying off.", [
    opt('salvage', 'Salvage the wrecks', [
      out("Hours of sweaty work pay off in good scrap.", [scrap(25)], 13),
      out("A 'wreck' starts its engines. Raiders were hiding in the pile.", [scrap(10), fight(['raider-skiff', 'raider-brawler'])], 7),
    ]),
    leave("Graveyards are for the dead. You intend to stay otherwise."),
  ]),
  ev('t-lonely-probe', 'any', U, 'Lonely Probe', "An ancient survey probe drifts past, playing a scratchy recording of someone's favorite song on every channel.", [
    opt1('strip', 'Strip it for parts', "It stops singing mid-chorus. The parts are good. You feel a little bad.", [scrap(12)]),
    opt1('charts', 'Download its star charts', "The probe has mapped this whole sector. It was waiting for someone to ask.", [reveal]),
    opt1('mascot', 'Adopt it as a fleet mascot', "The probe gets a name, a tiny hat and a spot on the hull. Its song becomes the fleet's anthem."),
  ]),
  ev('t-nebula-drift', ['veil'], ['nebula'], 'Drifting Blind', "The nebula is so thick that the ships ahead vanish into violet soup. Sensors only pick up soft, curious pings.", [
    opt('slow', 'Crawl along', [
      out("Hours of slow flying, then clear space. Nothing followed you.", [armada(1)], 3),
      out("Something follows. It's hungry.", [fight('sector', { hazard: 'nebula' })], 1),
    ]),
    opt('fast', 'Full speed ahead', [
      out("The fleet bursts out the far side, ahead of schedule and unscratched.", [], 1),
      out("You bounce off a rock the size of a city. Everyone does.", [hull(-3)], 1),
    ]),
  ]),
  ev('t-cold-comet', ['rustbelt', 'meridian'], U, 'Comet Tail', "A comet drags a tail of ice past the fleet. Rich in minerals, and thick enough to cool overheated systems.", [
    opt1('mine', 'Mine the tail', "The ice melts into coolant and the rock into scrap.", [scrap(10), hull(2)]),
    opt1('ride', 'Ride the tail for a jump', "The comet flings you forward. Your hulls get a light frosting.", [armada(-1)]),
  ]),
];
