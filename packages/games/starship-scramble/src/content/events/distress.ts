/** Distress calls: people in trouble, and people pretending to be. */
import type { EventDef } from '../types';
import { armada, augment, crewLoss, ev, fight, hull, hurt, kin, leave, opt, opt1, out, pay, recruit, role, scrap, sys } from './dsl';

const D = ['distress'] as const, DU = ['distress', 'unknown'] as const;

export const DISTRESS: readonly EventDef[] = [
  ev('d-refugees', 'any', D, 'Refugee Convoy', "A convoy of battered transports limps past, fleeing the Armada. Their leader asks for anything you can spare. Kids wave from every porthole.", [
    opt1('share', 'Share supplies', "The convoy cheers. A medic from the lead ship insists on repaying you in person, permanently.", [scrap(-8), recruit('human', 'medic')]),
    opt1('medbay', 'Treat their wounded in your medbay', "Your medbay works through the night. Two of the healed ask to fly with you.", [recruit(), recruit()], sys('medbay', 2)),
    leave("You wish them luck. The kids keep waving until they're out of sight."),
  ]),
  ev('d-burning-liner', 'any', D, 'Burning Liner', "A passenger liner is on fire from bow to stern, lifeboats jammed in their bays. Someone is banging on a hatch.", [
    opt('rescue', 'Pull them out', [
      out("You cut the hatch free. A grateful Ember deckhand climbs aboard, still smoking.", [recruit('ember'), hull(-2, 'random')], 3),
      out("The liner's reactor goes up as you pull away. Everyone got out, but your hull took the blast.", [hull(-5, 'random')], 2),
    ]),
    opt1('douse', 'Douse the fire with suppressant', "Your fire suppressant smothers the blaze. The captain pays you from the ship's safe and sends a crewman along.", [scrap(15), recruit()], { kind: 'augment', augment: 'fire-suppressant' }),
    leave(),
  ]),
  ev('d-escape-pod', 'any', DU, 'Escape Pod', "A lone escape pod tumbles past, beacon blinking. The window is frosted, but something inside is moving.", [
    opt('open', 'Bring it aboard', [
      out("A dazed survivor stumbles out and asks if you're hiring. You are.", [recruit()], 4),
      out("A raider stowaway bursts out swinging before your crew subdue him and toss him back.", [hurt(20)], 1),
    ]),
    leave("You log the pod's position. Someone else will come. Probably."),
  ]),
  ev('d-trapped-miners', ['rustbelt'], D, 'Trapped Miners', "A mining rig has collapsed on an asteroid, sealing its crew inside. Their foreman taps SOS on the hull in steady, patient Morse.", [
    opt1('dig', 'Dig them out', "Heavy work in unstable rock. The foreman joins your crew and the rest pay what they have.", [recruit('bastion', 'engineer'), scrap(10), hull(-3, 'random')]),
    opt1('beam', 'Cut them out with a beam', "Your beam slices a clean doorway. The miners pay handsomely and their foreman signs on.", [recruit('bastion', 'engineer'), scrap(20)], { kind: 'weapon', weaponKind: 'beam' }),
    leave(),
  ]),
  ev('d-infested-colony', ['veil'], D, 'Infested Colony Ship', "Colonists are barricaded in their bridge while Vesk swarm the corridors. 'We can hold ten more minutes. Maybe.'", [
    opt('dock', 'Dock and pull them out', [
      out("You grab the colonists and slam the airlock on the swarm.", [recruit(), scrap(10)], 3),
      out("The swarm pours through the airlock. You lose someone, and the hive chases you out.", [crewLoss, fight(['vesk-brood'])], 2),
    ]),
    opt1('soldiers', 'Soldiers hold the corridors', "Your soldiers carve a path to the bridge. Two colonists sign on and the rest pay in scrap.", [recruit(), recruit(), scrap(15)], role('soldier')),
    leave("Their channel goes quiet as you leave. You don't talk about it."),
  ]),
  ev('d-looping-ai', ['meridian'], DU, 'Malfunctioning AI', "A Warden control AI is stuck in a loop, broadcasting 'PLEASE DEFINE: FRIEND' on every frequency. Its drones hover, waiting for an answer.", [
    opt('define', 'Try to define friend', [
      out("It thinks about it for a very long time, then uploads shield schematics as a gift.", [{ kind: 'upgrade', system: 'shields', who: 'random' }], 1),
      out("'FRIEND: INSUFFICIENT DATA. DEFAULTING TO THREAT.' Oops.", [fight(['warden-drone'])], 1),
    ]),
    opt1('reboot', 'Have an engineer reboot it', "The AI wakes up clear-headed and deeply embarrassed. It pays you in Warden tech.", [augment('precision-optics')], role('engineer')),
    leave("'FRIEND: ONE WHO LEAVES.' It seems satisfied."),
  ]),
  ev('d-plague-ship', 'any', D, 'Quarantine Flag', "A hospital ship flies a yellow quarantine flag. The crew are sick but stubborn, and running out of medicine.", [
    opt1('supplies', 'Send over supplies', "They radio a thank-you between coughs and send back spare parts.", [scrap(-5), hull(3)]),
    opt('board', 'Board and help them', [
      out("Your crews find the cure in the ship's own lab stock. The grateful captain empties the treasury.", [scrap(25)], 3),
      out("You help, and catch it. Everyone spends a miserable day coughing.", [scrap(10), hurt(15, 'fleet')], 2),
    ]),
    leave(),
  ]),
  ev('d-ambassador', 'any', D, 'The Stolen Ambassador', "A Bastion ambassador has been kidnapped. Her captors are holed up at this beacon, demanding a ransom from anyone listening.", [
    opt1('assault', 'Storm the kidnappers', "They won't give her up without a fight. The fight pays well, though.", [fight('sector', { bonus: 1.3 })]),
    opt('snatch', 'Beam her out from under them', [
      out("Your team grabs the ambassador before anyone blinks. She insists on joining up.", [recruit('bastion'), scrap(15)], 7),
      out("You grab her, but the kidnappers notice and come after you.", [recruit('bastion'), fight('sector')], 3),
    ], sys('teleporter')),
    leave("Her captors keep broadcasting. Not your problem. It still feels like your problem."),
  ]),
  ev('d-armada-deserter', 'any', D, 'Crimson Deserter', "A crippled Armada scout drifts at the beacon. Its officer begs for help and offers patrol routes in exchange.", [
    opt('help', 'Help him', [
      out("He's telling the truth. His routes help you slip past the Armada.", [armada(-2)], 1),
      out("He's not. Interceptors decloak around the fleet. He waves at you as they do.", [fight(['armada-interceptor', 'armada-interceptor'])], 1),
    ]),
    opt1('scrap', 'Finish the scout and salvage it', "The scout's distress beacon goes out as it dies. The Armada now knows where you are.", [scrap(20), armada(1)]),
  ]),
  ev('d-lifepods', 'any', DU, 'Lifepod Cluster', "A cluster of lifepods tethered together, drifting around a burned-out cruiser. Heat signatures inside. Several.", [
    opt1('tow', 'Pull in the nearest pod', "One pod, one very grateful survivor.", [recruit()]),
    opt1('all', 'Collect every pod', "It takes hours to reel in the whole cluster. Two survivors join up.", [recruit(), recruit(), armada(1)]),
  ]),
  ev('d-stranded-racer', 'any', DU, 'Stranded Racer', "A Skitter racing pilot has run out of fuel mid-rally and is furious about it. 'Help me finish and I'll make it worth your while.'", [
    opt('tow', 'Tow them to the finish', [
      out("They cross the line first on a tow cable. The prize money is split fairly.", [scrap(20), armada(1)], 7),
      out("They win, and hand over their spare thruster kit as thanks.", [augment('thruster-kit'), armada(1)], 3),
    ]),
    opt1('fuel', 'Give them fuel', "They blast off in a cloud of exhaust. A thruster kit arrives at your airlock a moment later.", [augment('thruster-kit')], pay(12)),
    leave(),
  ]),
  ev('d-ember-feud', ['rustbelt', 'veil'], D, 'Ember Feud', "Two Ember clan ships are locked in a feud neither side remembers starting. Both hail you and demand you pick a side.", [
    opt1('side', 'Back the clan that hailed first', "Your guns join theirs. The other clan does not appreciate it.", [fight('sector', { bonus: 1.2 })]),
    opt1('ember', 'Ember crew settle it clan-style', "Your Ember crew call for a fistfight. Both clans love it, and both reward you.", [scrap(25), recruit('ember', 'soldier')], kin('ember')),
    leave("The feud continues without you. It will outlive everyone involved."),
  ]),
  ev('d-poisoned-station', ['meridian'], D, 'Silent Relay', "A Human repair crew on a Warden relay reports toxic gas in the vents. The Wardens say it's 'within parameters'.", [
    opt1('help', 'Vent the gas and pull them out', "The crew escapes. They pay you in hull plating and apologies.", [hull(4), hurt(10)]),
    leave("The Wardens log your departure as 'within parameters'."),
  ]),
];
