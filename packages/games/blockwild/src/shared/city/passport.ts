/**
 * The City Passport: one stamp for each thing worth trying in Caper City. A stamp is a bit in a player's saved record
 * (the index is the bit: append only), pays a few coins the first time and never again, and the three a player has not
 * got yet are the to-do list on their screen, so a newcomer always has something to aim for. Titles come with the count.
 */
export type Stamp = { key: string; title: string; hint: string; coins: number };
export const STAMPS: readonly Stamp[] = [
  { key: 'wheels', title: 'Take a ride', hint: 'Walk up to any vehicle and press the yellow button. City bikes are free.', coins: 10 },
  { key: 'gig', title: 'Finish a gig', hint: 'Read a job board (the corkboards on the plaza, diners and depots) and follow the beacon.', coins: 15 },
  { key: 'snack', title: 'Eat something', hint: 'Diners and stalls sell food. Hold Use to eat it: it mends your hearts.', coins: 10 },
  { key: 'bonk', title: 'Bonk somebody', hint: 'Bonk (a click, or the Bonk button) swings your bopper. Mind who is watching.', coins: 10 },
  { key: 'fish', title: 'Catch a fish', hint: 'Buy a rod at the bait hut on the pier, face the water and press Use. Use again when the float dips.', coins: 20 },
  { key: 'busk', title: 'Earn a tip busking', hint: 'Play a kazoo (the gadget shops sell them) where people are about.', coins: 15 },
  { key: 'race', title: 'Finish a street race', hint: 'Drive up to a chequered flag post and start one. Friends can join before the lights go out.', coins: 25 },
  { key: 'hat', title: 'Wear a new hat', hint: 'The hat shops (the top-hat signs) sell them.', coins: 10 },
  { key: 'slip', title: 'Give the Watch the slip', hint: 'Get Wanted, then stay out of their sight until the heat is gone.', coins: 30 },
  { key: 'fly', title: 'Take to the air', hint: 'Borrow a helicopter or a plane at Gullwing Field, east of the city.', coins: 30 },
  { key: 'chute', title: 'Float down on a parachute', hint: 'Step out of an aircraft in mid-air, or carry a parasol and jump off a roof.', coins: 20 },
  { key: 'owner', title: 'Buy a vehicle', hint: 'Wheel Deal Motors in Cinder Yards sells them. Yours come when called from the map.', coins: 30 },
  { key: 'home', title: 'Buy a flat', hint: 'Estate agents and the town hall sell flats. Heat drains fast at home.', coins: 40 },
  { key: 'land', title: 'Buy a plot', hint: 'A plot is the one place you can build. The hardware shops sell blocks.', coins: 40 },
  { key: 'boss', title: 'Buy a business', hint: 'Ask at a shop counter: the owner gets a cut of all it sells.', coins: 40 },
  { key: 'hero', title: 'Put out a fire', hint: 'When a fire breaks out, soak it with water balloons or a fire engine.', coins: 40 },
  { key: 'medic', title: 'Deliver a patient', hint: 'The clinic board has ambulance runs. Borrow the Patch Wagon outside.', coins: 30 },
  { key: 'bus', title: 'Finish a bus route', hint: 'The bus depot board has routes. Stop at every stop.', coins: 30 },
  { key: 'gull', title: 'Hold the Golden Gull', hint: 'When the gull lands, grab it and keep it for half a minute. Bonking the holder takes it.', coins: 40 },
  { key: 'bounty', title: 'Collect a bounty', hint: 'Bonk a Wanted player to hand them in.', coins: 40 },
  { key: 'vault', title: 'Crack the bank vault', hint: 'Brasswick Savings. It goes far quicker with a friend, and with a lookout on the alarm.', coins: 60 },
  { key: 'feather', title: 'Find 5 golden feathers', hint: 'They glint on rooftops, in corners and at the ends of things. Walk into one.', coins: 30 },
  { key: 'plume', title: 'Find 20 golden feathers', hint: 'Forty are hidden across the city and its island.', coins: 80 },
  { key: 'stunt', title: 'Land a stunt jump', hint: 'Hit a ramp at speed and stay in the air for ten blocks.', coins: 30 },
  { key: 'sail', title: 'Take a boat out', hint: 'Boats wait at the marina by the pier.', coins: 20 },
  { key: 'island', title: 'Set foot on Gull Rock', hint: 'The island south of the pier: go by boat or by air.', coins: 40 },
  { key: 'story', title: 'See an errand through', hint: 'People with a mark over their heads have errands. Finish all of one person\'s.', coins: 60 },
  { key: 'fair', title: 'Win at the funfair', hint: 'The stalls at Strand Funfair pay out tickets. Swap them at the prize booth.', coins: 20 },
  { key: 'gift', title: 'Give a friend coins', hint: 'Look at another player and press the yellow button.', coins: 10 },
  { key: 'spring', title: 'Spring a friend', hint: 'A friend in the lock-up? Work the lock at the back of the Watch House.', coins: 40 },
  { key: 'tycoon', title: 'Be worth 2,000 coins', hint: 'Coins, vehicles, property and businesses all count.', coins: 100 },
  { key: 'spray', title: 'Respray a vehicle', hint: 'Drive onto the pad at Spray & Pray, beside Wheel Deal Motors. It throws the Watch off, too.', coins: 15 },
];
export const STAMP = Object.fromEntries(STAMPS.map((stamp, index) => [stamp.key, index])) as Record<string, number>;
/** Stamps are kept as two 16-bit halves (bit operators are 32-bit signed, and a save's integers stay short). */
export type Stamps = [number, number];
export const hasStamp = (stamps: readonly number[], id: number) => ((stamps[id >> 4] ?? 0) >> (id & 15) & 1) === 1;
export const stampCount = (stamps: readonly number[]) => STAMPS.reduce((count, _stamp, id) => count + (hasStamp(stamps, id) ? 1 : 0), 0);
/** The next few stamps to go for, in the order a newcomer should meet them. */
export const todo = (stamps: readonly number[], most = 3) => STAMPS.map((_stamp, id) => id).filter(id => !hasStamp(stamps, id)).slice(0, most);
/** Titles by stamp count: [least stamps, title]. */
export const TITLES: readonly (readonly [number, string])[] = [[0, 'Newcomer'], [4, 'Regular'], [9, 'Local'], [15, 'Somebody'], [22, 'Big Cheese'], [28, 'Legend']];
export const titleFor = (count: number) => TITLES.reduce((title, [least, name]) => count >= least ? name : title, TITLES[0]![1]);
