/** The special beacons: elite contacts, drydocks, derelicts and wormholes. */
import type { EventDef, EventEffect } from '../types';
import { armada, augment, ev, fight, hull, hurt, kin, leave, opt, opt1, out, pay, recruit, reveal, role, scrap, sys, weapon } from './dsl';

const EL = ['elite'] as const, DD = ['drydock'] as const, DR = ['derelict'] as const, WH = ['wormhole'] as const;
/** Elite fights field heavier squads (see run/combat) and pay out 1.5× loot. */
const elite = (enemies: Parameters<typeof fight>[0] = 'sector'): EventEffect => fight(enemies, { elite: true, bonus: 1.5 });
const upgrade = (system: Extract<EventEffect, { kind: 'upgrade' }>['system'], who: Extract<EventEffect, { kind: 'upgrade' }>['who'] = 'random'): EventEffect => ({ kind: 'upgrade', system, who });
const ammo = (amount: number, who: Extract<EventEffect, { kind: 'ammo' }>['who'] = 'fleet'): EventEffect => ({ kind: 'ammo', amount, who });

export const BEACONS: readonly EventDef[] = [
  // ---------- Elite contacts: a hard fight guarding a rare prize ----------
  ev('el-warlord', ['rustbelt', 'cinder'], EL, "The Warlord's Parade", "A raider warlord is holding a victory parade: a trophy-hung gunship, escorts in formation and a very loud anthem. The trophies include a crate of military hardware.", [
    opt1('fight', 'Crash the parade', "The anthem stops mid-chorus. Every gun in the parade turns your way.", [weapon(3), elite(['raider-warlord', 'raider-brawler'])]),
    opt('ember', 'Ember crew challenge the warlord', [
      out("Your Ember brawler wins the duel in front of the whole parade. The warlord pays up to save face.", [scrap(35), weapon(2)], 3),
      out("A brutal fight. Your Ember wins on points and comes home with a black eye and a purse.", [scrap(20), hurt(40)], 2),
    ], kin('ember')),
    opt1('wait', 'Wait for the parade to pass', "It is a long parade. The Armada closes the gap while the fleet waits.", [armada(1)]),
  ]),
  ev('el-brood-queen', ['veil', 'cinder'], EL, 'The Brood Queen', "A Vesk brood queen nests in a gutted freighter, guarded by her hive. Her nest glitters with everything her brood ever stole.", [
    opt1('fight', 'Burn out the nest', "The queen rises from the wreck, shrieking loud enough to rattle every hull.", [augment(), elite(['vesk-queen', 'vesk-hive'])]),
    opt1('call', 'Skitter crew mimic her call', "The queen answers, confused, and leaves the nest to search. Your Skitter crew loot it in her absence.", [augment(), scrap(15)], kin('skitter')),
    leave("The fleet gives the nest a very wide berth."),
  ]),
  ev('el-arbiter', ['meridian', 'sanctum', 'marches'], EL, 'The Arbiter', "A Warden sentinel older than any on record hangs over a sealed vault. 'ARBITER ONLINE. JUDGMENT PENDING.' Its lancers take position around it.", [
    opt1('fight', 'Contest the judgment', "The Arbiter weighs the fleet, finds it wanting, and opens fire.", [weapon(3), elite(['warden-sentinel', 'warden-lancer'])]),
    opt1('accords', 'Bastion crew invoke the old accords', "The Arbiter hesitates, then rules in your favor. The vault opens without a shot fired.", [augment(), reveal], kin('bastion')),
    opt1('detour', 'Leave the Arbiter to its vault', "The detour costs time. The Armada is grateful.", [armada(1)]),
  ]),
  ev('el-cathedral', ['glasswater', 'sanctum'], EL, 'A Cathedral Sings', "A Choir cathedral drifts across the lane, its spires ringing a chord that makes shield emitters whine. Shards of prism crystal orbit it like moons.", [
    opt1('fight', 'Break the chord', "The chord turns into a scream. The cathedral and its cantors wheel to face the fleet.", [weapon(2, 'prism-beam'), elite(['choir-cathedral', 'choir-cantor'])]),
    opt1('lumen', 'Lumen crew join the song', "Your Lumen crew add a harmony the cathedral has never heard. It lets the fleet pass and sheds a gift of crystal.", [weapon(2, 'prism-beam'), armada(-1)], kin('lumen')),
    leave("The fleet waits for the cathedral to drift past. It takes a while. Cathedrals are not in a hurry."),
  ]),
  ev('el-hunter-pack', 'any', EL, 'Armada Hunter Pack', "An Armada hunter pack has picked up the fleet's trail: a dreadnought with interceptors on its flanks. Destroy it and the Armada loses track of you.", [
    opt1('fight', 'Ambush the hunters', "Turn the hunt around. Make them the ones being chased.", [armada(-2), weapon(3), elite(['armada-dreadnought', 'armada-interceptor'])]),
    opt('cloak', 'Cloak and let them overshoot', [
      out("The pack thunders past into empty space and keeps going.", [], 3),
      out("The pack overshoots, but a trailing interceptor spots the fleet and calls it in.", [armada(1)], 2),
    ], sys('cloak')),
    opt1('run', 'Run for it', "The fleet runs. The pack follows, and the whole Armada hears about it.", [armada(2)]),
  ]),
  ev('el-ace', 'any', EL, 'The Ace', "A lone mercenary ace hails the fleet. 'Heard you were good. I want to find out.' Behind the ace, a hired squadron powers up.", [
    opt1('fight', 'Accept the challenge', "The ace salutes and breaks formation. Show off, then.", [augment(), elite()]),
    opt1('hire', 'Hire the ace instead', "The ace laughs and signs the contract. 'Smart. I'd have won.' A new pilot joins, with a thruster kit.", [recruit('human', 'pilot'), augment('thruster-kit')], pay(35)),
    leave("The ace looks disappointed and lets the fleet go."),
  ]),
  ev('el-glass-reavers', ['glasswater'], EL, 'Glass Reavers', "Raiders have harpooned a Choir shard and are sawing it apart for crystal. The Choir is coming, and the raiders are armed to the teeth.", [
    opt1('fight', 'Take the crystal from the raiders', "The raiders drop their saws and pick up guns.", [weapon(3), elite(['raider-gunship', 'raider-brawler'])]),
    opt1('free', 'Cut the shard loose', "The shard flees, singing. The Choir remembers who helped.", [armada(-1), scrap(15)], { kind: 'weapon', weaponKind: 'beam' }),
    leave("Some fights belong to other people."),
  ]),
  ev('el-gatekeeper', ['marches'], EL, 'The Gatekeeper', "An Armada gate station guards a lane straight into the Marches. Its commander is proud, well armed and sitting on a strongroom of prototype weapons.", [
    opt1('fight', 'Storm the gate', "The gate's guns wake up one by one.", [weapon(3), elite(['armada-dreadnought', 'armada-gunship'])]),
    opt1('bribe', 'Bribe the commander', "The commander pockets the scrap and looks the other way. The strongroom stays shut.", [armada(-1)], pay(30)),
    leave("The fleet slips around the gate the long way."),
  ]),

  // ---------- Drydocks: recovery for long runs ----------
  ev('dd-free-dock', 'any', DD, 'Independent Drydock', "A family-run drydock hangs off a comet, all spotlights and welding sparks. The owner waves the fleet in. 'Everyone gets fixed. Paying customers get fixed better.'", [
    opt1('patch', 'Take the free patch job', "Quick welds, fresh paint over the worst of it.", [hull(5)]),
    opt1('full', 'Pay for the full service', "Every hull gets stripped, straightened and sealed. Good as new, or close enough.", [hull(10)], pay(15)),
    opt1('engines', 'Pay to overhaul the engines', "The mechanics rebuild every drive in the fleet. The engines purr.", [hull(4), upgrade('engines', 'fleet')], pay(25)),
  ], { weight: 2 }),
  ev('dd-warden-cradle', ['meridian', 'sanctum', 'marches'], DD, 'Maintenance Cradle', "A Warden repair cradle sits idle, servo arms folded. It will fix anything that holds still. It is not picky about what it fixes.", [
    opt1('dock', 'Dock and hold very still', "The cradle repairs every hull with eerie precision, then logs the fleet as Warden property. The paperwork takes time.", [hull(8), armada(1)]),
    opt1('hack', 'Have an engineer reprogram it', "Your engineer convinces the cradle the fleet is a Warden prototype. It repairs and upgrades with enthusiasm.", [hull(8), upgrade('shields')], role('engineer')),
    leave("The cradle watches the fleet go, arms twitching."),
  ]),
  ev('dd-chop-shop', ['rustbelt', 'cinder', 'glasswater'], DD, 'The Chop Shop', "A raider chop shop, open for business and not asking questions. The mechanic chews a bolt and quotes prices that change every time you blink.", [
    opt1('repair', 'Buy repairs', "Mismatched plates, loud welds and a sticker that says NO REFUNDS. It holds.", [hull(9)], pay(10)),
    opt1('guns', 'Buy something from under the counter', "The mechanic unwraps an oily bundle. 'Fell off a gunship.'", [weapon(2)], pay(30)),
    opt1('hire', 'Hire the apprentice', "The apprentice has been waiting for a way out for years. Grease on every finger.", [recruit('ember', 'engineer')], pay(15)),
    leave("The mechanic shrugs and goes back to chewing the bolt."),
  ]),
  ev('dd-hospital', 'any', DD, 'Hospital Ship', "A white hospital ship with a faded red cross drifts at the beacon. Its surgeons will treat anyone, and they are very bored.", [
    opt1('treat', 'Let the surgeons work', "The surgeons patch every crew member, then everyone's hull while they are in the mood.", [hull(6)]),
    opt1('medic', 'Recruit a surgeon', "One surgeon decides a warship sounds more exciting. Probably a mistake. Welcome aboard.", [recruit('human', 'medic')], pay(15)),
    opt1('medbay', 'Pay to refit the medbays', "The surgeons install their own equipment in one of the fleet's medbays.", [upgrade('medbay')], pay(20)),
  ]),
  ev('dd-resonance', ['glasswater', 'sanctum'], DD, 'Resonance Chamber', "A hollow geode the size of a station hums at a pitch that makes shield emitters glow. Lumen pilgrims come here to retune.", [
    opt1('tune', 'Tune the weakest shields', "The chamber sings, and the most battered ship in the fleet comes out with stronger shields.", [upgrade('shields', 'weakest')]),
    opt1('lumen', 'Lumen crew conduct the chamber', "Your Lumen crew lead the chamber in a full chord. Every shield in the fleet rings clearer.", [upgrade('shields', 'fleet')], kin('lumen')),
    leave("The fleet leaves the chamber humming."),
  ]),
  ev('dd-mothballs', 'any', DD, 'Mothball Yard', "Rows of retired hulls sleep under tarps at an old naval yard. The caretaker will sell one if the price is right and nobody asks where it came from.", [
    opt1('buy', 'Buy a spare hull', "One old hull, refitted and rolled out. The fleet's reserves grow by one.", [{ kind: 'reserves', amount: 1 }], pay(35)),
    opt1('strip', 'Strip parts for repairs', "The caretaker lets you cannibalize a wreck for plating.", [hull(6)]),
  ], { weight: .7 }),
  ev('dd-captured-yard', ['marches', 'cinder'], DD, 'Captured Shipyard', "Rebels have seized an Armada shipyard and are busy painting over the crimson. 'Friends of anyone the Armada hates. Dock up.'", [
    opt1('dock', 'Dock with the rebels', "Armada tools, rebel hands. Every hull gets reinforced.", [hull(10)]),
    opt1('arms', 'Raid the Armada armory together', "The rebels hand over the armory keys. Some of what's inside is still crated.", [weapon(3), ammo(4)], pay(25)),
  ]),

  // ---------- Derelicts: salvage with teeth ----------
  ev('dr-armada-wreck', 'any', DR, 'Armada Wreck', "A crimson hull drifts with its engines cold and its gun ports open. Its hold should be full of Armada kit. Its crew should be dead.", [
    opt('search', 'Board and search it', [
      out("The hold is intact and full of military salvage.", [weapon(2)], 5),
      out("The wreck was playing dead. Its guns come alive.", [fight(['armada-interceptor'])], 3),
      out("A booby trap goes off in the hold.", [hurt(25), scrap(15)], 2),
    ]),
    opt1('beam', 'Beam straight into the strongroom', "Your away team skips the traps and comes home with an augment.", [augment()], sys('teleporter')),
    leave(),
  ]),
  ev('dr-ghost-liner', 'any', DR, 'Ghost Liner', "A luxury liner floats with every cabin lit, music still playing in the ballroom. The passenger manifest lists three hundred names. Nobody answers.", [
    opt('explore', 'Explore the liner', [
      out("The purser's safe is still full.", [scrap(30)], 5),
      out("A stowaway cook bursts out of the galley, overjoyed to be rescued.", [recruit()], 3),
      out("Something in the ballroom is still dancing. Not everyone makes it back.", [{ kind: 'crewLoss' }], 1),
    ]),
    leave("The music follows the fleet out, fainter and fainter."),
  ]),
  ev('dr-reactor', 'any', DR, 'Leaking Reactor', "A mining barge has a reactor leaking bright blue light. Its fuel cells would fill every missile rack in the fleet, if nothing explodes.", [
    opt('salvage', 'Salvage the fuel cells', [
      out("Careful hands, steady nerves. Every ship loads up.", [ammo(4)], 6),
      out("One cell ruptures. The fleet gets the rest, and one ship gets a scorch mark.", [ammo(3), hull(-4, 'random')], 4),
    ]),
    opt1('engineer', 'Have an engineer stabilize it', "Your engineer calms the reactor and pulls its injectors for your own drives.", [ammo(3), upgrade('engines')], role('engineer')),
    leave(),
  ]),
  ev('dr-hive-husk', ['veil', 'cinder'], DR, 'Hive Husk', "A dead Vesk hive ship, split open like a seed pod. Its egg chambers are empty. Its trophy room is not.", [
    opt('loot', 'Loot the trophy room', [
      out("Stolen goods from a dozen fleets. Finders keepers.", [scrap(25), augment()], 5),
      out("The hive's last guards wake up hungry.", [fight(['vesk-hive'])], 3),
    ]),
    opt1('burn', 'Burn it out with a beam first', "Nothing survives the sweep. The trophies are a little scorched but still valuable.", [scrap(30)], { kind: 'weapon', weaponKind: 'beam' }),
    leave(),
  ]),
  ev('dr-shed-shell', ['glasswater', 'sanctum'], DR, 'A Shed Shell', "The Choir grows new ships inside old ones. An empty crystal shell drifts here, still faintly humming, its weapon mounts intact.", [
    opt('cut', 'Cut out the weapon mounts', [
      out("The mounts come free whole.", [weapon(1, 'shard-flak')], 5),
      out("The shell sings when you cut it. Something answers.", [fight(['choir-shard'])], 3),
    ]),
    opt1('lumen', 'Lumen crew wake the shell', "The shell's last chorister stirs awake, confused, and asks to join the fleet.", [recruit('lumen')], kin('lumen')),
    leave("The shell hums on behind the fleet."),
  ]),
  ev('dr-warden-vault', ['meridian', 'sanctum', 'marches'], DR, 'Warden Vault', "A cracked Warden vault drifts among dead drones. Its lock still cycles, patient as ever, and something valuable glows inside.", [
    opt('crack', 'Crack the vault', [
      out("The lock gives. Inside: one immaculate augment.", [augment()], 5),
      out("The vault calls its guardians home.", [fight(['warden-drone', 'warden-drone'])], 3),
    ]),
    opt1('ion', 'Ion the lock', "The lock sparks, stutters and opens. The guardians never get the message.", [augment(), scrap(10)], { kind: 'weapon', weaponKind: 'ion' }),
    leave(),
  ]),
  ev('dr-mining-rig', ['rustbelt', 'cinder'], DR, 'Abandoned Mining Rig', "A mining rig sits in a slow tumble, its ore bins full. The rocks around it are tumbling too, and they are not slow.", [
    opt('mine', 'Grab the ore', [
      out("The bins empty straight into the fleet's holds.", [scrap(25)], 6),
      out("A boulder clips a ship on the way out.", [scrap(20), hull(-3, 'random')], 4),
    ]),
    opt1('defense', 'Let point defense clear the rocks', "Point defense turns the rocks to gravel and the fleet takes its time.", [scrap(35)], sys('defense')),
    leave(),
  ]),
  ev('dr-escape-pods', 'any', DR, 'Escape Pods', "A cluster of escape pods drifts at the beacon, beacons blinking in a slow, hopeful rhythm.", [
    opt('collect', 'Collect the pods', [
      out("One pod holds a survivor who has been waiting a very long time. They want to help.", [recruit()], 5),
      out("The pods are bait. Hostiles pour out of the dark.", [fight('sector')], 3),
      out("Empty pods, but their emergency rations are worth something.", [scrap(15)], 2),
    ]),
    leave("The pods blink on behind the fleet."),
  ]),
  ev('dr-munitions-hulk', 'any', DR, 'Munitions Hulk', "A supply hulk has spilled a cloud of missile crates. Most of them are intact. Some of them are ticking.", [
    opt('grab', 'Grab the crates', [
      out("The fleet loads every intact crate.", [ammo(5)], 6),
      out("A ticking crate lives up to its promise.", [ammo(3), hull(-4, 'random')], 4),
    ]),
    opt1('defense', 'Shoot the ticking ones first', "Point defense pops every live warhead. The rest are yours.", [ammo(6)], sys('defense')),
  ]),

  // ---------- Wormholes: strange beacons with a shortcut ahead ----------
  ev('wh-stable', 'any', WH, 'A Stable Wormhole', "A wormhole turns slowly at the beacon, a lens of bent starlight. Through it, sensors show a beacon two jumps ahead. The fleet can take the shortcut on its next jump.", [
    opt1('study', 'Study it', "The science teams map the far side and the lanes around it.", [reveal]),
    opt1('fish', 'Fish in the event horizon', "Things fall into wormholes. Some of them fall out again, into your cargo net.", [scrap(15)]),
  ], { weight: 2 }),
  ev('wh-echo', 'any', WH, 'Echo From Tomorrow', "A message comes out of the wormhole in the fleet's own voices, dated three days from now. It is mostly static. The static sounds worried.", [
    opt1('listen', 'Decode the message', "It is a warning about the Armada's route. The fleet adjusts course.", [armada(-1)]),
    opt1('reply', 'Send a reply back through', "Nothing answers. A crate of spare parts tumbles out anyway, labelled THANKS.", [hull(4)]),
  ]),
  ev('wh-mirror', 'any', WH, 'Mirror Fleet', "A fleet drops out of the wormhole. It is yours: same hulls, same paint, same dents. The other captains look just as surprised.", [
    opt('trade', 'Trade stories and supplies', [
      out("The mirror fleet shares what it learned on its route and wishes you luck.", [reveal, scrap(15)], 6),
      out("The mirror fleet decides it would rather have your supplies. Only one fleet leaves.", [fight('sector')], 4),
    ]),
    leave("Both fleets back away slowly. Neither turns its back."),
  ]),
  ev('wh-spillover', 'any', WH, 'Exotic Spillover', "Exotic matter sprays from the wormhole's rim in sparkling sheets. It does strange things to engines. Mostly good things.", [
    opt('scoop', 'Scoop some up', [
      out("A ship's engines drink it in and come out stronger.", [upgrade('engines')], 6),
      out("It does a bad thing to one ship's engines.", [{ kind: 'systemDamage', system: 'engines', amount: 1, who: 'random' }, hull(-2, 'random')], 3),
    ]),
    opt1('pilot', 'Let a pilot surf the rim', "Your pilot rides the rim for a whole orbit and comes back grinning, with a full tank of exotic fuel.", [upgrade('engines', 'fleet')], role('pilot')),
    leave(),
  ]),
  ev('wh-castaway', 'any', WH, 'The Castaway', "A ship three centuries old drifts out of the wormhole, its captain alive and very confused. 'What year is it? Never mind. Do you have coffee?'", [
    opt1('rescue', 'Take the castaway aboard', "The old captain joins up and hands over an antique augment that still works.", [recruit(), augment()]),
    opt1('trade', 'Trade coffee for their cargo', "Three-hundred-year-old weapons, still in the wrapping.", [weapon(2)]),
  ], { unique: true }),
];
