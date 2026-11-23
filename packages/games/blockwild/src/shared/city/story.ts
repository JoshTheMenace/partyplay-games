/**
 * The people with errands: seven characters who stand in their own corners of Caper City (a pure function of the plan,
 * like everything else here) and hand out short chains of things to do, each a little more than the last. An errand
 * is a number to reach, counted from the moment it is taken on, on one of the totals the city already keeps; what is
 * saved is how many of each character's errands a player has done (three bits a character).
 */
import { SEED_CACHE } from '../constants';
import type { Look } from './people';
import { cityPlan, lotSpot, PIER, SHORE, type CityPlan, type Lot } from './plan';

/** What an errand counts: a career total (from when it was taken, or `total`: ever), feathers found, net worth, businesses owned, passport stamps, or one stamp in particular. */
export type Count = { stat: 'gigs' | 'fish' | 'tips' | 'bonks' | 'escapes' | 'helped' | 'drove' | 'flew' | 'gull' | 'bounties' | 'jump' | 'peak'; total?: boolean } | { stat: 'feathers' | 'worth' | 'biz' | 'stamps' } | { stamp: string };
export type Errand = { ask: string; goal: string; count: Count; n: number; pay: number; done: string };
export type Character = { key: string; name: string; role: string; hello: string; bye: string; look: Look; errands: readonly Errand[]; group: 0 | 1 | 2 };
const look = (skin: number, hair: number, cut: number, top: number, legs: number, hat: number, hatColor: number, bib = 0, scale = 1): Look => ({ skin, hair, cut, top, legs, hat, hatColor, bib, scale });

/** The index is saved (three bits each, eight at most): append only. `group`: whose good books an errand done puts a player in (0 townsfolk, 1 the Watch, 2 the Magpies). */
export const CHARACTERS: readonly Character[] = [
  { key: 'marrow', name: 'Granny Marrow', role: 'Feeds the pigeons in Mossback Park', group: 0, look: look(0xf3d2b4, 0x8a8a90, 3, 0x9b6ee0, 0x5a4632, 0, 0, 0xf1ead6, 0.9),
    hello: 'Oh, hello dear. Sit a minute. Nobody sits any more.', bye: 'You have been ever so good to me. The pigeons think so too.',
    errands: [
      { ask: 'I do miss a fish supper. The pier is too far for these knees. Would you catch me a couple?', goal: 'Catch 2 fish', count: { stat: 'fish' }, n: 2, pay: 45, done: 'Fresh as you like! Here, for your trouble. Do not spend it all on donuts.' },
      { ask: 'It is too quiet in this park. Play something. Anything. A kazoo will do: earn yourself ten coins with it and I shall hear it from here.', goal: 'Earn 10 coins busking', count: { stat: 'tips' }, n: 10, pay: 60, done: 'I had not danced since the old bandstand came down. Well. I swayed.' },
      { ask: 'The gulls drop golden feathers all over this city and nobody looks up. Find me three and I will knit you something. No, I will pay you. You would not like my knitting.', goal: 'Find 3 golden feathers', count: { stat: 'feathers' }, n: 3, pay: 90, done: 'Three! Look at the shine on them. You have sharp eyes, dear.' },
      { ask: 'One more thing and then I shall leave you be. Do somebody a good turn: a fire put out, a poorly soul driven to the clinic. This city could use it.', goal: 'Put out a fire or finish an ambulance run', count: { stat: 'helped' }, n: 1, pay: 140, done: 'I knew you had it in you. I told the pigeons so.' },
    ] },
  { key: 'plumley', name: 'Mayor Plumley', role: 'Mayor of Caper City, in person', group: 0, look: look(0xe2b48c, 0x2a1d12, 1, 0x26386e, 0x3a3f4a, 4, 0x23232a, 0xe6b93a, 1.08),
    hello: 'A citizen! Splendid. Shake my hand. Other hand.', bye: 'When they put up my statue, I shall insist yours goes beside it. A smaller one.',
    errands: [
      { ask: 'This city runs on parcels and pies arriving where they should. Do two gigs off any job board and I shall know you are one of us.', goal: 'Finish 2 gigs', count: { stat: 'gigs' }, n: 2, pay: 50, done: 'Punctual! Reliable! I shall mention you in a speech. Briefly.' },
      { ask: 'A city needs people of substance. Make yourself worth five hundred coins, all told, and come and tell me how it feels.', goal: 'Be worth 500 coins', count: { stat: 'worth' }, n: 500, pay: 80, done: 'Substance! I can see it from here. It suits you.' },
      { ask: 'Now invest. Buy a business. Any counter in town will sell you the shop behind it, for a price. Commerce, my friend, is the mayor of everything.', goal: 'Own a business', count: { stat: 'biz' }, n: 1, pay: 150, done: 'A proprietor! Do send me the opening-day ribbon. I collect them.' },
      { ask: 'Last of all: be seen about. Ten stamps in that passport of yours and I shall call you a pillar of the community in front of witnesses.', goal: 'Collect 10 passport stamps', count: { stat: 'stamps' }, n: 10, pay: 200, done: 'A pillar! A column! A whole colonnade! Take this, and my warmest handshake.' },
    ] },
  { key: 'sprocket', name: 'Old Sprocket', role: 'Mends what the scrapyard cannot', group: 0, look: look(0xc98f62, 0x8a8a90, 1, 0xe98f4c, 0x3f5d7a, 2, 0xf2c23e, 0x3a3f4a),
    hello: 'Mind the oil. And the other oil.', bye: 'Nothing left to teach you. Go and frighten somebody.',
    errands: [
      { ask: 'Engines want exercise. Drive six hundred blocks in anything with wheels and come back with the smell of it on you.', goal: 'Drive 600 blocks', count: { stat: 'drove' }, n: 600, pay: 50, done: 'Hear that? Neither do I. Running sweet. Here.' },
      { ask: 'There are ramps on the quays. Nobody put them there for looking at. Clear eight blocks off one and tell me how the landing was.', goal: 'Land a stunt jump of 8 blocks', count: { stat: 'jump', total: true }, n: 8, pay: 90, done: 'Eight! And all four wheels still on. Mostly.' },
      { ask: 'Higher. There is a field east of the yards with machines that leave the ground on purpose. Fly three hundred blocks.', goal: 'Fly 300 blocks', count: { stat: 'flew' }, n: 300, pay: 130, done: 'You came back, then. Some do not. Well: some land elsewhere.' },
      { ask: 'Now do it properly. Twelve blocks off a ramp. Take something quick.', goal: 'Land a stunt jump of 12 blocks', count: { stat: 'jump', total: true }, n: 12, pay: 180, done: 'Twelve. I would have paid to watch that. I am, in fact, paying.' },
    ] },
  { key: 'fingers', name: 'Fingers McGraw', role: 'Knows a fellow who knows a fellow', group: 2, look: look(0xe2b48c, 0x1a1a1f, 1, 0x23232a, 0x23232a, 5, 0x23232a, 0, 0.96),
    hello: 'You did not see me. I did not see you. Lovely to meet you.', bye: 'I have nothing more for you. Which is to say, you never knew me.',
    errands: [
      { ask: 'Let us see what you are made of. Bonk three people. Anybody. It is character-building. For them.', goal: 'Bonk 3 people', count: { stat: 'bonks' }, n: 3, pay: 40, done: 'Crisp. Economical. You have a gift.' },
      { ask: 'Any fool can get into trouble. Get Wanted, properly Wanted, and then walk away from it. Lose them. That is the art.', goal: 'Give the Watch the slip', count: { stat: 'escapes' }, n: 1, pay: 90, done: 'Like smoke. I am almost proud. I am not, but almost.' },
      { ask: 'Hotter. I want the whole Watch out of bed. Get to Hot on their little meter and come and tell me about the sirens.', goal: 'Reach Hot (60 heat)', count: { stat: 'peak', total: true }, n: 60, pay: 120, done: 'I could hear them from here. Beautiful. Like geese.' },
      { ask: 'There is a vault at Brasswick Savings that thinks it is clever. You will want friends: one on the bell outside, the rest on the door. Open it.', goal: 'Crack the bank vault', count: { stamp: 'vault' }, n: 1, pay: 250, done: 'The vault! I shall dine out on this, at a table facing the door.' },
    ] },
  { key: 'peg', name: 'Captain Peg', role: 'Captain of the Watch, off duty (she says)', group: 1, look: look(0xa6703f, 0x2a1d12, 3, 0x26386e, 0x1c2648, 1, 0x1c2648, 0xe6b93a, 1.02),
    hello: 'I know that face. I am deciding whether I like it.', bye: 'You are all right. Do not make me regret saying so.',
    errands: [
      { ask: 'Show me you are some use. Three honest gigs off the boards. Honest. I shall hear if they were not.', goal: 'Finish 3 gigs', count: { stat: 'gigs' }, n: 3, pay: 60, done: 'Three, and nothing fell off the back of anything. Good.' },
      { ask: 'My officers cannot be everywhere. When there is a fire or a call for the Patch Wagon, answer it. Once will do, for now.', goal: 'Put out a fire or finish an ambulance run', count: { stat: 'helped' }, n: 1, pay: 110, done: 'That is the stuff. The city thanks you. I thank you, which is rarer.' },
      { ask: 'Make a habit of it. Three more good turns and I shall tell the desk to go easy on your tickets.', goal: 'Do 3 more good turns', count: { stat: 'helped' }, n: 3, pay: 220, done: 'A model citizen. I shall have to find somebody else to keep an eye on.' },
    ] },
  { key: 'brine', name: 'Dockmaster Brine', role: 'Minds the pier, the moorings and the tide', group: 0, look: look(0xc98f62, 0xd9b45a, 1, 0x2fa69a, 0x2b3f73, 4, 0xf2c23e, 0, 1.05),
    hello: 'Tide is where I left it. What can I do you for?', bye: 'Fair winds. Bring the boat back. Or do not. They restock.',
    errands: [
      { ask: 'You cannot call it a pier if nobody fishes off it. The hut sells rods. Land three of anything.', goal: 'Catch 3 fish', count: { stat: 'fish' }, n: 3, pay: 50, done: 'Three! One of them even looks edible. Here you go.' },
      { ask: 'Now get your feet wet. Well: keep them dry. Take a boat out from the moorings. Any boat.', goal: 'Take a boat out', count: { stamp: 'sail' }, n: 1, pay: 60, done: 'Did not sink it. That puts you ahead of my nephew.' },
      { ask: 'See that rock out in the bay, with the lighthouse? Gull Rock. Go and stand on it. Tell the keeper I have not forgotten the ladder I lent.', goal: 'Set foot on Gull Rock', count: { stamp: 'island' }, n: 1, pay: 120, done: 'He says what ladder? Typical. Well sailed, anyhow.' },
      { ask: 'One last thing. Fish the deep water off the pier head or the island and bring your tally to ten. Then you may call yourself an angler in my hearing.', goal: 'Catch 10 fish in all', count: { stat: 'fish', total: true }, n: 10, pay: 200, done: 'Ten. Angler. There, I have said it.' },
    ] },
  { key: 'fizz', name: 'Madame Fizz', role: 'Proprietress of Strand Funfair', group: 0, look: look(0xf3d2b4, 0xc0503a, 2, 0xd8403a, 0x23232a, 4, 0xd8403a, 0xf2c23e, 1.0),
    hello: 'Roll up! Roll up! Oh, it is only you. Roll up anyway.', bye: 'You have seen all my wonders. Come back when I have invented more.',
    errands: [
      { ask: 'Nobody has won a prize all day and it looks bad. Play my stalls, win tickets, and swap them at the tent for anything. I will even act surprised.', goal: 'Win a prize at the funfair', count: { stamp: 'fair' }, n: 1, pay: 40, done: 'A winner! A WINNER! There. Was that convincing?' },
      { ask: 'They say a golden gull comes down in this city now and then. Hold it for twenty seconds, all told, and tell me if it is as vain as I have heard.', goal: 'Hold the Golden Gull for 20 seconds', count: { stat: 'gull' }, n: 20, pay: 130, done: 'Vainer? I knew it. We would get on.' },
      { ask: 'I am putting on a show and I need a headline act. Earn forty coins with that kazoo and the job is yours. Unpaid. But this bit is paid.', goal: 'Earn 40 coins busking', count: { stat: 'tips' }, n: 40, pay: 180, done: 'A star is born! Mind the bulbs on your way out.' },
    ] },
];
/** Ids for `interact`: characters count on from here, past any resident or extra (CITY_ID + CITY_GUIDE + index). */
export const CITY_GUIDE = 2 ** 19;
/** Where each character stands: [x, z, yaw]. */
export type Standing = { x: number; z: number; yaw: number };
function stand(plan: CityPlan): Standing[] {
  const lot = (kind: Lot['kind']) => plan.lots.find(entry => entry.kind === kind)!, at = (kind: Lot['kind'], u: number, v: number, yaw: number): Standing => { const [x, z] = lotSpot(lot(kind), u, v); return { x, z, yaw }; };
  const facing = (kind: Lot['kind']) => [0, -Math.PI / 2, Math.PI, Math.PI / 2][lot(kind).face]!;
  return [
    at('park', 14, 21, Math.PI / 2), at('hall', 28, 14, facing('hall')), at('scrap', 30, 4, facing('scrap')), at('market', 44, 44, facing('market') + Math.PI),
    at('watch', 21, 2, facing('watch')), { x: PIER.x0 + 5.5, z: SHORE + PIER.d - 13.5, yaw: 0 }, at('fair', 17, 12, facing('fair')),
  ];
}
const cache = new Map<number, Standing[]>();
export function standings(seed: number): Standing[] {
  let list = cache.get(seed);
  if (!list) {
    if (cache.size >= SEED_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(seed, list = stand(cityPlan(seed)));
  }
  return list;
}
/** How many of character `who`'s errands a story number says are done, and the number with one more done. */
export const stepOf = (story: number, who: number) => story >> who * 3 & 7;
export const withStep = (story: number, who: number, step: number) => story & ~(7 << who * 3) | Math.min(7, step) << who * 3;
