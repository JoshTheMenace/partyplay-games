/** The frontier sectors: Glasswater Drift, the Cinder Expanse, the Choir Sanctum and the Crimson Marches, plus the Lost Note quest. */
import type { ChoiceDef, EventDef } from '../types';
import { armada, augment, ev, fight, flag, hull, hurt, kin, leave, opt, opt1, out, pay, recruit, reveal, role, scrap, store, sys, weapon } from './dsl';

const hostile = (id: string, sectors: EventDef['sectors'], title: string, text: string, choices: ChoiceDef[]) => ev(id, sectors, ['hostile'], title, text, choices);
const battle = (label = 'Battle stations', text = "Shields up, guns out. Here they come.", ...extra: Parameters<typeof fight>) => opt1('fight', label, text, [fight(...extra)]);
const U = ['unknown'] as const, D = ['distress'] as const, UD = ['unknown', 'distress'] as const;

export const FRONTIER: readonly EventDef[] = [
  // ---------- Glasswater Drift: the Lumen Choir and glass raiders ----------
  hostile('gw-choir-hymn', ['glasswater'], 'The Hymn Begins', "Crystal shards turn toward the fleet in perfect unison and start to sing. The note climbs until shield emitters whine. It is not a welcome.", [
    battle('Drown them out', "Guns are louder than hymns. Mostly."),
    opt1('lumen', 'Lumen crew sing the answering verse', "The shards fall silent, then drift aside, still humming. One leaves a crystal behind.", [scrap(20)], kin('lumen')),
  ]),
  hostile('gw-shard-swarm', ['glasswater'], 'Shard Swarm', "A swarm of Choir shards flickers in and out of sight, cloaking and reappearing closer each time.", [
    battle('Fire at every flicker', "They vanish when they sense a volley coming. Time your shots.", ['choir-shard', 'choir-shard']),
    opt1('ion', 'Ion blast the swarm before it cloaks', "The ion burst locks their cloaks. The shards fight half blind.", [fight(['choir-shard', 'choir-shard'], { bonus: 1.3 })], { kind: 'weapon', weaponKind: 'ion' }),
  ]),
  hostile('gw-cantor', ['glasswater'], 'A Cantor Descends', "A Choir cantor, a spire of living crystal, lowers itself into the lane. Its prism beams warm up with a sound like a finger on a wine glass.", [
    battle('Engage the cantor', "Keep the shields up. Prism beams slip through one layer.", ['choir-cantor']),
    opt('cloak', 'Cloak and drift past', [
      out("The cantor sings to empty space for a while, then forgets the fleet existed.", [], 3),
      out("The cantor hears the cloak hum and sweeps a beam across one hull.", [hull(-4, 'random')], 2),
    ], sys('cloak')),
  ]),
  hostile('gw-glass-miners', ['glasswater'], 'Glass Miners', "Raiders are strip-mining a crystal field, cutting pieces out of things that are clearly alive. They want a cut of your cargo too.", [
    battle('Stop the mining', "The raiders trade their saws for guns.", ['raider-brawler', 'raider-skiff']),
    opt1('pay', 'Pay their toll and move on', "They count the scrap and wave the fleet through.", [], pay(15)),
  ]),
  hostile('gw-refraction', ['glasswater'], 'Refraction Field', "The crystal tide bends light into a maze of mirror images. Somewhere in there, Choir ships are watching the fleet's reflections.", [
    battle('Fight through the mirrors', "Asteroid-sized crystals tumble through the field.", 'sector', { hazard: 'asteroids' }),
    opt1('map', 'Map the field and slip out', "Your science teams find the true path through the reflections.", [reveal, armada(1)]),
  ]),
  ev('gw-singing-tide', ['glasswater'], U, 'The Singing Tide', "A wave of crystal dust rolls through the drift, humming a chord so low it rattles teeth. Where it passes, dents in the fleet's hulls seem to close.", [
    opt1('bathe', 'Let the tide wash over the fleet', "The dust settles into every crack and hardens. Strange, but welcome.", [hull(5)]),
    opt1('collect', 'Collect the dust', "Crystal dust sells well. The fleet fills its holds.", [scrap(20)]),
  ]),
  ev('gw-cracked-chorister', ['glasswater'], D, 'A Cracked Chorister', "A Lumen chorister drifts in a cracked escape shard, off-key and afraid. The Choir cast them out for singing the wrong note.", [
    opt1('rescue', 'Bring them aboard', "The chorister joins the fleet and hums quietly while they work.", [recruit('lumen', 'engineer')]),
    opt1('medic', 'Have a medic mend the crack', "Mended, the chorister hums a note of thanks and a location: a cache the Choir forgot.", [recruit('lumen'), scrap(15)], role('medic')),
    leave("The chorister's song fades behind the fleet."),
  ]),
  ev('gw-prism-market', ['glasswater'], UD, 'Prism Market', "Traders have set up stalls on a floating slab of crystal, selling Choir glass to anyone brave enough to shop this deep.", [
    opt1('shop', 'Browse the stalls', "The traders roll out their wares.", [store]),
    opt1('sell', 'Sell them crystal dust', "The traders pay well for Glasswater dust.", [scrap(15)]),
  ]),

  // ---------- The Cinder Expanse: raider warlords and forge worlds ----------
  hostile('cx-forge-guard', ['cinder'], 'Forge Guard', "A raider forge glows in the red giant's shadow, hammering out hulls. Its guard ships are brand new and very eager to try their guns.", [
    battle('Test their new guns', "Fresh paint. Fresh crews. Fresh mistakes."),
    opt1('bastion', 'Bastion crew pose as forge inspectors', "The guards salute and hand over a crate of 'quality samples'.", [weapon(2)], kin('bastion')),
  ]),
  hostile('cx-ember-rite', ['cinder'], 'Ember Rite', "Ember raiders are holding a trial by fire: any ship that wants passage must fly through the corona with them. They're lining up to race.", [
    battle('Race them, guns hot', "The race becomes a running battle in the solar flares.", 'sector', { hazard: 'solar' }),
    opt('ember', 'Ember crew claim the rite', [
      out("Your Ember crew recite the rite. The raiders escort the fleet through the corona with honor.", [armada(-1)], 3),
      out("Your Ember crew win the argument about the rite by headbutt.", [hurt(20), scrap(20)], 2),
    ], kin('ember')),
  ]),
  hostile('cx-warband', ['cinder'], 'Warband Crossing', "A raider warband crosses the lane: brawlers, gunships and one hull painted entirely with teeth.", [
    battle('Hit them mid-crossing', "They are strung out and slow. Punish it.", ['raider-gunship', 'raider-brawler']),
    opt1('wait', 'Wait for them to pass', "It takes a long time for a warband to cross.", [armada(1)]),
  ]),
  hostile('cx-slag-ambush', ['cinder'], 'Slag Ambush', "Raiders burst out of cooling slag clouds, dripping molten metal. The slag is still flying around, and it is still very hot.", [
    battle('Fight in the slag', "Molten debris hits everyone.", 'sector', { hazard: 'asteroids' }),
    opt1('shields', 'Double shields and plow through', "The slag spatters off the fleet's shields. The raiders are left behind cursing.", [scrap(10)], sys('shields', 2)),
  ]),
  hostile('cx-hive-raid', ['cinder'], 'Hive Raid', "A Vesk hive has latched onto a raider forge and is eating the crew. Both sides stop to look at your fleet with interest.", [
    battle('Fight the hive', "Better the raiders owe you than the Vesk eat you.", ['vesk-hive', 'vesk-scout']),
    opt1('leave', 'Let them keep each other busy', "Nobody follows the fleet out. Everybody is busy.", []),
  ]),
  ev('cx-corona-dive', ['cinder'], U, 'Corona Dive', "The red giant's corona is rich with heavy metals. A tight dive could skim a fortune, or cook a hull.", [
    opt('dive', 'Skim the corona', [
      out("A perfect dive. The fleet's holds fill with molten salvage.", [scrap(30)], 6),
      out("Too close. The fleet comes out glowing, and not in the good way.", [hull(-4)], 4),
    ]),
    opt1('pilot', 'Let the best pilot lead the dive', "Your pilot threads the flares like a needle. Every ship skims its fill.", [scrap(35)], role('pilot')),
    leave(),
  ]),
  ev('cx-forge-sale', ['cinder'], UD, 'Fire Sale', "A raider forge is going out of business, in the sense that its owner is fleeing a rival warlord. Everything must go.", [
    opt1('shop', 'Shop the fire sale', "The shelves are stacked and the prices are desperate.", [store]),
    opt1('crew', 'Hire the forge crew', "One of the forge hands would rather be anywhere else.", [recruit('ember', 'engineer')], pay(15)),
  ]),
  ev('cx-marooned', ['cinder'], D, 'Marooned', "A raider crew is marooned on a cooling rock, abandoned by their warlord. They promise to behave. They are not very convincing.", [
    opt('rescue', 'Pick them up', [
      out("They behave. One of them even stays on as a gunner.", [recruit('human', 'gunner')], 6),
      out("They tried to steal a shuttle on the way out. Now they are walking.", [scrap(10)], 4),
    ]),
    leave("They shout colorful words at the fleet as it leaves."),
  ]),

  // ---------- The Choir Sanctum: the heart of the Choir ----------
  hostile('cs-choir-wall', ['sanctum'], 'The Choir Wall', "A wall of cantors blocks the lane, singing one unbroken chord. The Sanctum does not welcome visitors.", [
    battle('Break the wall', "Find the weakest voice and silence it.", ['choir-cantor', 'choir-shard']),
    opt1('lumen', 'Lumen crew request passage', "The chord shifts key. The wall parts, grudgingly.", [], kin('lumen')),
  ]),
  hostile('cs-pilgrim-hunters', ['sanctum'], 'Pilgrim Hunters', "Warden drones are hunting Lumen pilgrims through the Sanctum's nebula. The pilgrims scatter toward the fleet, begging for shelter.", [
    battle('Shelter the pilgrims', "The Wardens reclassify the fleet as hostile.", ['warden-lancer', 'warden-drone']),
    opt1('hide', 'Hide the pilgrims under the cloak', "The Wardens sweep past. The pilgrims leave a gift before they go.", [augment()], sys('cloak')),
    leave("The fleet looks away. The Wardens do not."),
  ]),
  hostile('cs-dissonance', ['sanctum'], 'Dissonance', "Two Choir ships are singing against each other, and the clash is tearing shields apart for a light-second around.", [
    battle('Fight in the dissonance', "Shields recharge slowly while the song rages.", 'sector', { hazard: 'ion-storm' }),
    opt1('dampers', 'Ride it out on ion dampers', "The dampers soak up the noise. You hit the singers before their shields recover.", [fight('sector', { bonus: 1.3 })], { kind: 'augment', augment: 'ion-dampers' }),
  ]),
  hostile('cs-cathedral-shadow', ['sanctum'], 'Cathedral Shadow', "The fleet jumps into the shadow of a cathedral that is too busy singing to notice. Its escorts notice.", [
    battle('Fight the escorts quietly', "Loud enough to kill them. Not loud enough to wake the cathedral.", ['choir-cantor', 'choir-shard']),
    opt1('survive', 'Hold position until it passes', "Survive the escorts until the cathedral drifts on.", [fight(['choir-cantor', 'choir-shard'], { objective: 'survive' })]),
  ]),
  ev('cs-choir-archive', ['sanctum'], U, 'Choir Archive', "A crystal the size of a mountain holds every song the Choir ever sang. Sensors say it also holds star charts. Very old, very accurate star charts.", [
    opt1('read', 'Read the charts', "The fleet charts a route through the Sanctum and beyond.", [reveal, armada(-1)]),
    opt1('chip', 'Chip off a piece', "The archive sings a sour note, but crystal is crystal.", [scrap(25)]),
  ]),
  ev('cs-silent-choir', ['sanctum'], D, 'The Silent Choir', "A circle of Choir ships floats in total silence. For the Choir, silence is mourning. One ship is broadcasting a single, tiny note: help.", [
    opt1('help', 'Answer the note', "A lone chorister, last of its circle, asks to sing with the fleet instead.", [recruit('lumen', 'medic')]),
    opt1('respect', 'Keep a respectful silence', "The circle notices. Their song follows the fleet as a blessing.", [hull(4)]),
  ]),

  // ---------- The Crimson Marches: Armada territory ----------
  hostile('cm-picket-line', ['marches'], 'Picket Line', "The Armada has strung a picket line across the Marches: gunships every few light-seconds, all watching the lanes.", [
    battle('Break the line', "Punch a hole and keep going.", ['armada-gunship', 'armada-interceptor']),
    opt1('cloak', 'Slip through a gap under cloak', "The fleet ghosts between two pickets. Nobody sees a thing.", [], sys('cloak')),
  ]),
  hostile('cm-shipyard', ['marches'], 'Armada Shipyard', "A shipyard is building dreadnoughts for the Armada. Half-finished hulls hang in their cradles. Some of them already have guns.", [
    battle('Wreck the shipyard', "Every hull you break here is one that never chases you.", 'sector', { bonus: 1.3 }),
    opt1('sabotage', 'Beam in saboteurs', "Your team rigs the cradles and beams out. The shipyard lights up behind you.", [armada(-2), hurt(15)], sys('teleporter')),
  ]),
  hostile('cm-burnt-fleet', ['marches'], 'The Burnt Fleet', "Wrecks of a dozen fleets drift here, all of them crimson-scorched. Armada scavengers pick through them and do not like to share.", [
    battle('Drive off the scavengers', "Fight among the wrecks.", 'sector', { hazard: 'asteroids' }),
    opt1('salvage', 'Salvage quietly around the edges', "The fleet picks the edges clean before the scavengers notice.", [scrap(20), armada(1)]),
  ]),
  hostile('cm-warden-remnant', ['marches'], 'Warden Remnant', "An old Warden patrol still guards the Marches, fighting the Armada on its own. It sees the fleet and hesitates.", [
    battle('Fight the Wardens', "They were here first. They will be here last.", ['warden-lancer', 'warden-drone']),
    opt1('accords', 'Bastion crew offer an alliance', "The Wardens log the fleet as allies and share their Armada sensor logs.", [reveal, armada(-1)], kin('bastion')),
  ]),
  hostile('cm-deserters', ['marches'], 'Deserters', "Armada deserters are fleeing through the Marches with a hunter squad on their tail. They beg the fleet for cover.", [
    battle('Cover the deserters', "The hunters decide two fleets are better than one.", ['armada-interceptor', 'armada-gunship']),
    opt1('ignore', 'Let the hunters have them', "The hunters are busy. The fleet slips by.", []),
  ]),
  ev('cm-war-room', ['marches'], U, 'Abandoned War Room', "A forward command post, abandoned in a hurry. The Armada's plan for the Flagship's defense is still pinned to the wall.", [
    opt1('study', 'Study the plans', "The fleet learns where the Armada is looking, and goes somewhere else.", [armada(-2)]),
    opt1('loot', 'Loot the armory', "The armory still has a few crates in it.", [weapon(2)]),
  ]),
  ev('cm-resistance', ['marches'], D, 'Resistance Cell', "A resistance cell hides inside a hollowed asteroid, painting slogans on Armada wrecks. They have been waiting for someone brave enough to reach the Flagship.", [
    opt1('join', 'Accept their help', "The resistance loads the fleet with repairs and one volunteer.", [hull(5), recruit()]),
    opt1('arm', 'Trade for their prototype', "They have been saving something for the Flagship.", [weapon(3)], pay(30)),
  ]),

  // ---------- Quest: The Lost Note ----------
  ev('q-lost-note', ['glasswater', 'sanctum'], ['distress', 'unknown'], 'The Lost Note', "A Choir elder hails the fleet in a voice like a bell. 'Our song is missing a note. It fell far from here. Find it, and the Choir will remember.'", [
    opt1('accept', 'Promise to find the note', "The elder hums the missing note so the fleet will know it when it hears it.", [flag('lost-note')]),
    opt1('lumen', 'Lumen crew learn the note by heart', "Your Lumen crew learn the song and promise to carry the note home.", [flag('lost-note'), scrap(10)], kin('lumen')),
    leave("The elder's bell-voice fades behind the fleet."),
  ], { unique: true }),
  ev('q-lost-note-found', 'any', ['unknown', 'derelict', 'nebula'], 'A Note in the Dark', "A tiny crystal drifts at the beacon, humming the exact note the Choir elder sang. It is lodged in a raider mine.", [
    opt('pry', 'Pry it free', [
      out("The note comes loose and sings in the hold, clear as a bell.", [flag('note-found')], 7),
      out("The mine was live. The note survives. So does most of the hull.", [flag('note-found'), hull(-4, 'random')], 3),
    ]),
    opt1('defense', 'Shoot the mine off with point defense', "The mine pops harmlessly and the note floats free.", [flag('note-found')], sys('defense')),
  ], { unique: true, requiresFlag: 'lost-note', weight: 3 }),
  ev('q-lost-note-home', 'any', ['unknown', 'distress', 'nebula', 'wormhole'], 'The Song Completed', "The Choir elder finds the fleet again. When the note sings, every crystal for a light-year sings with it. 'The Choir remembers.'", [
    opt1('gift', 'Accept the Choir\'s gift', "The Choir sheds a prism weapon and hides the fleet's trail in its song.", [weapon(2, 'prism-beam'), armada(-2)]),
    opt1('singer', 'Ask for a singer', "A Lumen chorister joins the fleet, and the Choir hides your trail.", [recruit('lumen', 'engineer'), armada(-2)]),
  ], { unique: true, requiresFlag: 'note-found', weight: 3 }),
];
