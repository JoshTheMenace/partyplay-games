/** Hostile beacon intros: usually a fight, sometimes a clever way around one. */
import type { ChoiceDef, EventDef } from '../types';
import { armada, augment, ev, fight, hull, hurt, kin, opt, opt1, out, pay, recruit, reveal, role, scrap, store, sys, weapon } from './dsl';

const hostile = (id: string, sectors: EventDef['sectors'], title: string, text: string, choices: ChoiceDef[]) => ev(id, sectors, ['hostile'], title, text, choices);
const battle = (label = 'Battle stations', text = "Shields up, guns out. Here they come.", ...extra: Parameters<typeof fight>) => opt1('fight', label, text, [fight(...extra)]);

export const HOSTILE: readonly EventDef[] = [
  // ---------- Rustbelt: Scrap Raiders ----------
  hostile('rb-toll-gate', ['rustbelt'], 'Toll Gate', "Raiders have welded three dead freighters across the lane and painted TOLL on the middle one. A voice crackles over comms. 'Pay up, or become part of the gate.'", [
    battle('Refuse and open fire'),
    opt1('pay', 'Pay the toll', "They count it twice, salute with a wrench and drag the gate aside. Almost polite.", [], pay(15)),
    opt1('bluff', 'Bastion crew pose as toll inspectors', "Your Bastion crew demand to see the raiders' permits. The raiders flee, leaving the day's takings behind.", [scrap(15)], kin('bastion')),
  ]),
  hostile('rb-scrapper-pack', ['rustbelt'], 'Scrapper Pack', "A pack of raider skiffs circles the fleet like gulls around a fishing boat, waiting for someone to look weak.", [
    battle('Show them teeth', "They wanted weak. They are about to be disappointed.", ['raider-skiff', 'raider-skiff']),
    opt('cloak', 'Cloak and slip away', [
      out("The fleet ghosts past while the skiffs squabble over who saw you first.", [], 3),
      out("One sharp-eyed skiff rakes your tail before you jump clear.", [hull(-3, 'random')]),
    ], sys('cloak')),
  ]),
  hostile('rb-duel', ['rustbelt'], 'A Formal Challenge', "A raider brawler blocks the lane, its captain shirtless on the viewscreen. 'Your best against my best! Loser pays!' The rest of his crew are already placing bets.", [
    battle('Accept, with every gun you have', "He meant fists. You meant cannons. Nobody reads the fine print.", ['raider-brawler'], { bonus: 1.5 }),
    opt('ember', 'Send an Ember brawler to fight', [
      out("Ninety seconds of fire-blooded fury. The raider captain pays up from the floor and asks for your fighter's autograph.", [scrap(30)], 3),
      out("A close fight. Your Ember loses a tooth but wins the purse.", [scrap(15), hurt(30)]),
    ], kin('ember')),
  ]),
  hostile('rb-rock-ambush', ['rustbelt'], 'Ambush in the Rocks', "Raiders burst from behind a tumbling asteroid field. The rocks are big, fast and completely indifferent to whose side they're on.", [
    battle('Fight in the field', "Mind the rocks. They hit everyone.", 'sector', { hazard: 'asteroids' }),
    opt1('missile', 'Crack their hiding rock with a missile', "The rock splits, and so do the raiders. Their dropped cargo tumbles your way.", [scrap(20), { kind: 'ammo', amount: -1, who: 'random' }], { kind: 'weapon', weaponKind: 'missile' }),
  ]),
  hostile('rb-hauler', ['rustbelt'], 'Guarded Hauler', "A fat raider hauler lumbers past under gunship escort, its hold stuffed with stolen goods. Nobody on board expects company.", [
    battle('Hit the escort', "The gunship turns to face you. The hauler starts praying.", ['raider-gunship', 'raider-skiff']),
    opt('board', 'Beam a team into the hauler first', [
      out("Your away team loots the hold and beams back before the escort notices. Then it notices.", [weapon(1), fight(['raider-gunship', 'raider-skiff'])], 2),
      out("The hauler's crew were waiting with pipes. Your team grabs what it can and retreats, bruised.", [scrap(10), hurt(25), fight(['raider-gunship', 'raider-skiff'])]),
    ], sys('teleporter')),
  ]),
  hostile('rb-rogue-trader', ['rustbelt'], 'Merchant With Teeth', "A rogue trader drifts up, guns bigger than its storefront. 'Browsing is free. Shooting at me is very expensive.'", [
    opt1('trade', 'Browse the wares', "The trader grins and rolls up the shutters. The guns stay pointed at you the whole time.", [store]),
    battle('Rob the merchant', "Bold. The trader sighs and powers up everything.", ['rogue-trader'], { bonus: 1.5 }),
  ]),
  hostile('rb-scrapyard-siege', ['rustbelt'], 'Scrapyard Siege', "You dock at a salvage yard for repairs just as raiders arrive in waves. The yard boss yells that the big cannons need a minute to warm up.", [
    opt1('hold', 'Hold the line', "Keep everyone alive until the yard's cannons come online.", [fight('sector', { objective: 'survive' })]),
    opt1('run', 'Cut the moorings and run', "You tear free with a docking clamp still attached. The long way around costs time.", [armada(1)]),
  ]),
  hostile('rb-red-star', ['rustbelt'], 'Raiders at the Red Star', "Raiders lurk in the glare of a swollen red star, hoping the flares hide them. The star is having a very bad day.", [
    battle('Fight in the flare', "Every few seconds the star throws fire at someone. Try to make it them.", 'sector', { hazard: 'solar' }),
    opt('lure', 'Have a pilot bait them sunward', [
      out("Your pilot dances along the corona. The raiders follow, overheat and flee, trailing loose cargo.", [scrap(20)], 7),
      out("The raiders don't bite. They do, however, shoot.", [fight('sector', { hazard: 'solar' })], 3),
    ], role('pilot')),
  ]),

  // ---------- Veil: the Vesk Hive ----------
  hostile('vl-fog-shapes', ['veil'], 'Shapes in the Fog', "Something moves in the nebula, too big and too patient to be weather. Sensors show chitin. A lot of chitin.", [
    battle('Fight blind', "The fog hides you and them alike. Aim well.", 'sector', { hazard: 'nebula' }),
  ]),
  hostile('vl-brood', ['veil'], 'Brood Hunters', "A Vesk brood swarm fans out ahead, sniffing the ion trails your engines leave. They haven't spotted you. Yet.", [
    battle('Strike first', "The swarm shrieks and turns. At least you picked the moment.", ['vesk-brood']),
    opt('cloak', 'Cloak and drift through the fog', [
      out("The brood passes close enough to count legs. Nobody breathes. Then they're gone.", [], 4),
      out("One straggler bumps into your wake and panics. Its bite leaves a dent.", [hull(-2, 'random')]),
    ], sys('cloak')),
  ]),
  hostile('vl-hungry-hive', ['veil'], 'Hungry Hive', "A Vesk hive ship opens its teleporter maw and hums. The hum translates, roughly, as 'lunch'.", [
    battle(),
    opt('soldiers', 'Let them board. Soldiers wait at the doors', [
      out("The boarders beam in and meet a wall of your soldiers. The survivors beam home and the hive flees, shedding scrap.", [scrap(25), hurt(15)], 3),
      out("A rough brawl. You win the corridor, but the hive stays to finish the job.", [hurt(25), fight(['vesk-hive'])]),
    ], role('soldier')),
  ]),
  hostile('vl-ion-storm', ['veil'], 'Storm Chasers', "An ion storm rolls through the nebula and a Vesk pack rides it straight at you. Shields crackle and recharge at half speed.", [
    battle('Fight in the storm', "Shields will be slow. Make every volley count.", 'sector', { hazard: 'ion-storm' }),
    opt1('outrun', 'Punch the engines and outrun it', "Your engines scream through the storm's edge. The Vesk lose you in the lightning.", [], sys('engines', 3)),
  ]),
  hostile('vl-scout-call', ['veil'], 'Scout Calling Home', "A lone Vesk scout spots the fleet and starts a long, rising call. Somewhere in the fog, something much larger answers.", [
    battle('Shoot it before the hive arrives', "Too late for quiet. The hive arrives mid-fight.", ['vesk-scout', 'vesk-hive']),
    opt1('jam', 'Jam its call with ion fire', "An ion shot scrambles the call into a hiccup. The scout faces you alone, and knows it.", [fight(['vesk-scout'], { bonus: 1.3 })], { kind: 'weapon', weaponKind: 'ion' }),
  ]),
  hostile('vl-nest', ['veil'], 'Into the Nest', "Your jump lands the fleet inside a Vesk nesting ground. Eggs the size of shuttles drift past. Every one of them is twitching.", [
    opt1('hold', 'Hold out while the drives cool', "Keep the fleet alive until the FTL drives are ready.", [fight('sector', { objective: 'survive', hazard: 'nebula' })]),
    opt('song', 'Skitter crew hum the hive-song', [
      out("Your Skitter crew click a low lullaby. The nest settles. You tiptoe out, pockets full of shed chitin.", [scrap(20)], 7),
      out("Someone hits a wrong note. The whole nest wakes up furious.", [fight('sector', { objective: 'survive', hazard: 'nebula' })], 3),
    ], kin('skitter')),
  ]),
  hostile('vl-queens-guard', ['veil'], "The Queen's Guard", "A Vesk hive and its brood guard the lane, gnawing idly on a freighter hull. They look up at your fleet with obvious interest.", [
    battle('Break through', "The guard is tough, and so is its loot.", ['vesk-hive', 'vesk-brood'], { bonus: 1.4 }),
    opt1('feed', 'Toss them scrap to chew on', "The Vesk fall on the scrap like cats on tuna. Nobody watches you leave.", [], pay(20)),
  ]),
  hostile('vl-mimic', ['veil'], 'A Familiar Voice', "A distress call in a perfect human voice. 'Please, we're hurt.' The same four words, on a loop, from a wreck coated in something wet.", [
    battle('Approach carefully', "The wreck opens like a flower. It was never a wreck.", 'sector', { hazard: 'nebula' }),
    opt1('beam', 'Sweep the wreck with a beam first', "The beam cuts open the brood hiding inside. They come out hurt and angry, which is better than healthy and angry.", [fight('sector', { bonus: 1.5 })], { kind: 'weapon', weaponKind: 'beam' }),
  ]),

  // ---------- Meridian: Warden drones ----------
  hostile('md-checkpoint', ['meridian'], 'Warden Checkpoint', "A ring of Warden drones blinks awake. 'STATE AUTHORIZATION CODE.' You do not have an authorization code. You have a fleet.", [
    battle('Open fire'),
    opt1('bribe', 'Offer a bribe', "Wardens don't take bribes. They take offence. Weapons online.", [fight()]),
    opt1('bastion', 'Bastion crew recite the old accords', "The drones pause, then dim their lights in respect. They even share a map of the lane ahead.", [reveal], kin('bastion')),
  ]),
  hostile('md-lancer-picket', ['meridian'], 'Lancer Picket', "Two Warden lancers glide in on perfect parallel lines, charging their beams. Their hail is a single word. 'NONCOMPLIANT.'", [
    battle('Engage', "They fight like a math problem. Solve it.", ['warden-lancer', 'warden-drone']),
    opt('cloak', 'Cloak and let them lose the lock', [
      out("The lancers sweep empty space, confused, and return to patrol.", [], 3),
      out("A stray beam catches you on the way out.", [hull(-4, 'random')]),
    ], sys('cloak')),
  ]),
  hostile('md-sentinel', ['meridian'], 'The Sentinel Wakes', "A Warden sentinel the size of a moonlet unfolds from a dormant platform. Lights ripple down its length like it's clearing its throat.", [
    opt1('survive', 'Survive until the drives cool', "No need to kill it. Just stay alive.", [fight(['warden-sentinel'], { objective: 'survive' })]),
    battle('Bring it down', "Bigger machines make bigger scrap piles.", ['warden-sentinel'], { bonus: 1.5 }),
  ]),
  hostile('md-solar-array', ['meridian'], 'Solar Array', "Wardens guard a vast mirror array that focuses sunlight into anyone they dislike. They dislike you.", [
    battle('Fight under the mirrors', "The array lances flares across the battlefield.", 'sector', { hazard: 'solar' }),
    opt1('shields', 'Double shields and ride through', "The flares splash off your shields. The Wardens sulk in binary as you pass.", [], sys('shields', 2)),
  ]),
  hostile('md-drone-graveyard', ['meridian'], 'Drone Graveyard', "A field of dead Warden drones drifts in slow orbit. Some of them are not as dead as the others, and they're waking up.", [
    battle('Fight in the debris', "The wreckage tumbles into everyone. Shields help.", 'sector', { hazard: 'asteroids' }),
    opt1('ion', 'Pulse the field with ion', "Half the drones reboot into sleep mode. The rest are awake and very alert.", [fight(['warden-drone'], { hazard: 'asteroids' })], { kind: 'weapon', weaponKind: 'ion' }),
  ]),
  hostile('md-archive-guard', ['meridian'], 'Archive Guardians', "Warden drones circle a data archive in tight, jealous loops. The archive's hull is studded with sealed cargo pods.", [
    battle('Clear the guardians', "Beat the guards, then crack the pods."),
    opt('board', 'Beam in and grab pods mid-fight', [
      out("Your team loots two pods before the drones notice. The fight is on, but you're already ahead.", [augment(), fight('sector')], 2),
      out("The pods are rigged. Your team comes back singed and empty-handed.", [hurt(20), fight('sector')]),
    ], sys('teleporter')),
  ]),
  hostile('md-ion-lattice', ['meridian'], 'Ion Lattice', "Warden relays have strung an ion lattice across the lane. Anything caught inside flickers and slows. Drones wait at the far side.", [
    battle('Fight through the lattice', "Shields recharge slowly in here. So do theirs.", 'sector', { hazard: 'ion-storm' }),
    opt1('dampers', 'Ride the lattice on ion dampers', "Your dampers soak up the static. You hit the drones before their shields come up.", [fight('sector', { bonus: 1.3 })], { kind: 'augment', augment: 'ion-dampers' }),
  ]),
  hostile('md-recycle', ['meridian'], 'Decommission Order', "Every Warden in range broadcasts at once. 'VESSELS SCHEDULED FOR RECYCLING. PLEASE HOLD STILL.' The fleet does not hold still.", [
    battle('Decline recycling'),
    opt('spoof', 'Have an engineer fake a shutdown', [
      out("Your engineer powers everything down to a flicker. The Wardens log you as 'already recycled' and leave you a receipt.", [scrap(15)], 7),
      out("The Wardens check twice. They are thorough like that.", [fight('sector')], 3),
    ], role('engineer')),
  ]),

  // ---------- Anywhere: the Armada's reach ----------
  hostile('any-outrider', 'any', 'Armada Outrider', "A lone Crimson interceptor sniffs along your wake. If it reports home, the whole Armada knows where you are.", [
    opt1('fight', 'Kill it before it calls in', "Quick and quiet. Its report dies with it.", [armada(-1), fight(['armada-interceptor'])]),
    opt1('ignore', 'Let it go', "It peels away, transmitting. Somewhere behind you, engines turn your way.", [armada(1)]),
  ]),
  hostile('any-bounty', 'any', 'Bounty Hunter', "A rogue trader drops out of warp waving a holo-poster of your fleet. Bad likeness. Big number. 'Nothing personal, captains.'", [
    battle('Make it personal', "He sighs. He always hopes they'll come quietly.", ['rogue-trader']),
    opt1('buy', 'Outbid the bounty and hire him', "He shrugs, rips up the poster and signs on. Loyalty is just the highest bid, after all.", [recruit('human', 'gunner')], pay(25)),
  ]),
  hostile('any-picket', 'any', 'Crimson Picket', "An Armada gunship sits across the lane, gold trim polished, guns tracking. It's the Armada's way of saying you are expected.", [
    battle('Punch through', "Armada ships carry good salvage. Take it.", ['armada-gunship'], { bonus: 1.3 }),
    opt1('detour', 'Take the long way around', "The detour works. The Armada gains ground while you take it.", [armada(1)]),
  ]),
];
