/* Shirt Show content banks (server only; never imported by client code). Every prompt, slogan and design is original. */
import { DRAWING_COLORS, type Drawing, type DrawingStroke } from '../../../../../party-contract/src/index';

/** Slogan helper prompts shown on phones while writing. */
export const HINTS: readonly string[] = [
  'A slogan your dentist would wear', 'What a retired superhero’s shirt says', 'A shirt for a very proud pigeon', 'The motto of a sleepy dragon',
  'What a goldfish would print on a tee', 'A shirt sold only at the moon’s gift shop', 'Words to live by, according to a sloth', 'A slogan for the world’s slowest marathon',
  'What your fridge would wear to a party', 'A shirt for someone who just lost at board games', 'The team shirt of a haunted bowling league', 'A shirt for a nervous astronaut',
  'Something a grandma wears to a skate park', 'A slogan for a library that just got cool', 'What a cat would print about its humans', 'A shirt only a wizard would understand',
  'The slogan of a very honest car wash', 'A tee from the worst summer camp ever', 'What a vampire wears to the beach', 'A slogan for a gym that only does naps',
  'A shirt a toddler would design', 'What a T-shirt cannon fires at the crowd', 'A slogan for a dinosaur fan club', 'What the office printer would wear',
  'A shirt for someone who loves Mondays', 'A tee for a goat that won a talent show', 'A slogan for a robot’s first birthday', 'What a ghost puts on its shirt',
  'A shirt to wear to your own surprise party', 'A tee celebrating a very average achievement', 'The slogan of a disappointed volcano', 'What a penguin wears to a fancy dinner',
  'A shirt for a pizza delivery knight', 'A slogan for a clumsy ninja school', 'A shirt your houseplants would make for you', 'What a crab says on its tee',
  'A slogan for the ultimate snack fan', 'A shirt for a pirate on holiday', 'What a cloud would wear on a bad day', 'A slogan for a band made of kitchen utensils',
  'A shirt for someone who peaked in year three', 'Words of wisdom from a fortune cookie', 'A tee for a very competitive spelling bee', 'The slogan of a lazy weather forecaster',
  'What an alien tourist buys at the airport', 'A shirt for the world’s most dramatic hamster', 'A slogan for the corner shop that never closes', 'What a snowman wears in July',
  'A tee for a bee who quit its job', 'What a knight wears under the armour', 'A slogan for a picnic that went wrong', 'What a raccoon prints on its gang jacket',
  'The motto of a sock that lost its partner', 'A shirt for someone who talks to their car', 'A tee from a theme park for pigeons', 'A slogan for an extremely tiny horse',
  'What a toaster would brag about', 'A shirt for a nap champion', 'A slogan for a broccoli fan club', 'What your shadow would wear',
  'A tee for a family road trip gone wild', 'The motto of a magnificent moustache', 'A shirt for an overconfident chef', 'A slogan for a squirrel with a plan',
  'What a lighthouse would wear', 'A tee for a wizard’s apprentice on day one', 'A shirt to wear to a dance-off', 'A slogan for the fastest snail alive',
  'What a kettle says when it gets excited', 'A tee for an unbeatable rock-paper-scissors player', 'A slogan that would scare a seagull', 'What a sandwich would wear',
  'A shirt for a cowboy who is scared of horses', 'A slogan for a museum of lost umbrellas', 'What a teacher secretly wants on a shirt', 'A shirt for a karaoke legend',
  'A tee from the town’s worst festival', 'A slogan for a sock puppet uprising', 'What a cactus would print about hugs', 'A shirt for someone who brings snacks to everything',
  'A slogan for a bakery run by owls', 'What a referee wears on a day off', 'A shirt for a superhero whose power is mild', 'A slogan from a very polite protest',
  'A dog’s honest review of the postie', 'A tee for a laser tag veteran', 'A slogan for a frog’s election campaign', 'A shirt for the loudest person at the cinema',
  'What a mermaid would wear on land', 'A tee for a spaceship’s dinner lady', 'A slogan about the last slice of pizza', 'What a parrot would print on its shirt',
  'A shirt for someone who always gets lost', 'A slogan for a sandcastle building company', 'What your alarm clock would wear', 'A tee for a yeti on a city break',
  'A slogan for a club that only meets at midnight', 'A shirt for a professional bubble-wrap popper', 'What a jellyfish wants you to know', 'A slogan for the comeback of the century',
  'A shirt for a chicken who finally crossed the road', 'A tee to wear while losing gracefully', 'A slogan for a very serious tea party', 'What a mime would put on a shirt',
  'A shirt for an octopus who loves hugs', 'A slogan for the bravest mouse in town', 'What a zombie wears to a job interview', 'A tee that brags about a tiny victory',
  'A slogan for a disco on the moon', 'A shirt for the relative who never stops talking', 'A coconut that has been through a lot', 'A slogan for a wrestling ring made of jelly',
  'A shirt for an elf who quit the workshop', 'A slogan for the world’s slowest fast food', 'What a unicorn wears on casual Friday', 'A tee for someone who just learned to whistle',
  'A slogan for a bin that has seen things', 'A shirt for a dragon on a diet', 'What a hedgehog says about personal space', 'A slogan for a superstore that sells only spoons',
  'A tee for someone who bites ice lollies', 'A shirt for the champion of thumb wars', 'A slogan for a pigeon’s motivational seminar', 'What a cheese would wear to impress',
  'A shirt for someone still waiting for a parcel', 'A slogan for the world’s most tired battery', 'A tee for a beach full of grumpy crabs', 'What a shark wears on its day off',
  'A shirt for a hero who only rescues snacks', 'A shirt for someone who replies “k” to everything', 'A slogan for a tortoise who just discovered skateboarding', 'A tee for someone who argues with the satnav', 'A slogan for a cereal mascot’s midlife crisis',
  'What a bouncy castle would say if it could talk', 'A shirt for the wrestler nobody has heard of', 'A slogan for a runway show for dogs', 'What a disco ball wears to relax',
];
export const ADULT_HINTS: readonly string[] = [
  'A slogan for your ex’s new partner', 'What you’d wear to a divorce party', 'A shirt for a hangover support group', 'A slogan for the office party nobody remembers',
  'A tee for someone avoiding their landlord', 'What a bartender really thinks of you', 'A slogan for a stag do in a tiny village', 'A tee for the walk of shame home',
  'A slogan for a dating app for wizards', 'A tee for a very messy wine tasting', 'What a hungover pirate wears', 'A shirt for someone whose “one more drink” means six',
  'A slogan for a brutally honest tax return', 'A tee for an awkward school reunion', 'The slogan of a gym nobody actually goes to', 'A shirt for a group chat that got out of hand',
  'A slogan for a very spicy cooking show', 'What you’d wear the morning after a wedding', 'A slogan for a hen do in a garden centre', 'A tee for someone who is “fine, honestly”',
];

/** House slogans fill the make-phase hands when players write too few (all ≤ 40 characters). */
export const SLOGANS: readonly string[] = [
  'I Survived Tuesday', 'Professional Snack Taster', 'Powered by Toast', 'Ask Me About My Goose', 'Certified Couch Potato', 'Napping Is My Cardio',
  'World’s Okayest Wizard', 'Emotional Support Human', 'I Paused My Game for This', 'Legally a Sandwich', 'Sorry I’m Late, I Was Late', 'Team Pyjamas Forever',
  'Running on Biscuits', 'Here for the Snacks', 'Kind of a Big Pickle', 'This Is My Dancing Shirt', 'Undefeated at Hide and Seek', 'My Other Shirt Is a Cape',
  'Trust Me, I’m a Raccoon', 'Mildly Famous in My Kitchen', 'Proud Owner of a Rock', 'Don’t Talk to Me Before Soup', 'Professional Overthinker', 'Feral Since Breakfast',
  'Allergic to Mornings', 'Ask My Cat', 'I Brake for Ducks', 'Officially Out of Office', 'Part-Time Dragon', 'Beware of the Hamster', 'Now With Extra Cheese',
  'Loading Personality…', 'Stay Calm, Hide the Cake', 'One Sock Short of a Pair', 'Moon Landing Enthusiast', 'Built Different (Badly)', 'Ate the Last Cookie',
  'Fastest Snail in the West', 'Chief Executive of Naps', 'Will Dance for Crisps', 'Too Glam to Give a Clam', 'Ruler of the Remote', 'Born to Yodel',
  'Spoon Collector, Retired', 'Hug Me, I’m a Cactus', 'Banana for Scale', 'Grumpy but Fabulous', 'Undisputed Pillow Fort Champ',
];
export const ADULT_SLOGANS: readonly string[] = [
  'Hungover but Hydrated', 'Ask Me About My Divorce', 'Wine O’Clock Somewhere', 'My Therapist Says Hi', 'Professional Bad Decision Maker',
  'I Peaked at the Afterparty', 'Single and Ready to Nap', 'Here for the Open Bar', 'Recovering Karaoke Addict', 'Sober-ish Since Lunch',
];

/** Drawing ideas for anyone staring at a blank pad. */
export const SPARKS: readonly string[] = [
  'a sad volcano', 'a cat in sunglasses', 'a skateboarding dinosaur', 'a muscly banana', 'a crying cloud', 'a pizza slice with wings', 'a flaming bowling ball',
  'a wrestling chicken', 'a rocket made of cheese', 'a heart flexing its arms', 'an angry teapot', 'a ghost eating noodles', 'a snail with a turbo', 'a potato wearing a crown',
  'a shark in a bow tie', 'a lightning bolt with a face', 'a cactus in a cowboy hat', 'a winking moon', 'a robot holding a flower', 'a frog king', 'a burger in shades',
  'a disco dog', 'a donut planet', 'a heroic sock', 'a sleepy sun', 'a jellyfish in boots', 'an eyeball with fancy lashes', 'a llama with a mohawk', 'a happy toaster',
  'a very cool cucumber', 'a wrestling mask', 'a championship belt', 'a giant fist', 'a flying taco', 'a sloth on a motorbike', 'a smiling tooth', 'a bee with a jetpack',
  'a mushroom house', 'an octopus DJ', 'a haunted sock', 'a pineapple with a crown', 'a tiger with a guitar', 'a sneaker with wings', 'a dramatic carrot', 'a ninja cat',
];

export const hintPool = (family: boolean) => family ? HINTS : [...HINTS, ...ADULT_HINTS];
export const sloganPool = (family: boolean) => family ? SLOGANS : [...SLOGANS, ...ADULT_SLOGANS];

// ---------- house designs: simple line art drawn in code, in the shared drawing format ----------
type Pt = [number, number];
const TAU = Math.PI * 2, r3 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
/** Ink index: 0 ink, 1 coral, 2 sky, 3 lime, 4 grape, 5 sun. */
const line = (ink: number, width: number, pts: Pt[]): DrawingStroke => ({ color: DRAWING_COLORS[ink]!, width, points: pts.map(([x, y]) => ({ x: r3(x), y: r3(y) })) });
const arc = (cx: number, cy: number, rx: number, ry = rx, from = 0, to = TAU, n = 28): Pt[] => Array.from({ length: n + 1 }, (_, i) => { const a = from + (to - from) * i / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
const loop = (pts: Pt[]): Pt[] => [...pts, pts[0]!];
/** A round dot; past the 0.04 pen limit it becomes a small filled ring. */
const dot = (ink: number, x: number, y: number, size = .04) => size <= .04 ? line(ink, size, [[x, y], [x + .004, y + .004]]) : line(ink, .04, arc(x, y, size * .32, size * .32, 0, TAU, 10));
const starPts = (cx: number, cy: number, big: number, small: number, tips = 5): Pt[] => loop(Array.from({ length: tips * 2 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / tips, r = i % 2 ? small : big; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }));
const heartPts = (cx: number, cy: number, s: number): Pt[] => Array.from({ length: 41 }, (_, i) => { const t = i / 40 * TAU; return [cx + s * 16 * Math.sin(t) ** 3 / 16, cy - s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16]; });

export const HOUSE_DESIGNS: readonly { name: string; drawing: Drawing }[] = [
  { name: 'Lightning bolt', drawing: { strokes: [line(5, .04, loop([[.56, .08], [.26, .54], [.47, .54], [.38, .92], [.76, .4], [.53, .4], [.64, .08]])), line(5, .03, [[.5, .2], [.4, .44]])] } },
  { name: 'Big heart', drawing: { strokes: [line(1, .04, heartPts(.5, .5, .36)), line(1, .03, heartPts(.5, .5, .22)), line(5, .025, arc(.36, .36, .07, .07, Math.PI, Math.PI * 1.5, 8))] } },
  { name: 'Superstar', drawing: { strokes: [line(5, .04, starPts(.5, .52, .42, .18)), line(1, .025, starPts(.5, .52, .2, .09)), dot(0, .5, .52, .03)] } },
  { name: 'Smiley', drawing: { strokes: [line(5, .04, arc(.5, .5, .36)), dot(0, .38, .4, .05), dot(0, .62, .4, .05), line(0, .03, arc(.5, .5, .2, .18, Math.PI * .15, Math.PI * .85, 14))] } },
  { name: 'Sunshine', drawing: { strokes: [line(5, .04, arc(.5, .5, .2)), ...Array.from({ length: 12 }, (_, i) => { const a = i * TAU / 12; return line(i % 2 ? 1 : 5, .03, [[.5 + .28 * Math.cos(a), .5 + .28 * Math.sin(a)], [.5 + .42 * Math.cos(a), .5 + .42 * Math.sin(a)]]); }), dot(0, .43, .46), dot(0, .57, .46), line(0, .02, arc(.5, .52, .08, .06, .2, Math.PI - .2, 8))] } },
  { name: 'Flame', drawing: { strokes: [line(1, .04, [[.5, .92], [.3, .82], [.22, .6], [.32, .38], [.36, .52], [.44, .3], [.52, .08], [.6, .3], [.7, .22], [.78, .52], [.74, .8], [.5, .92]]), line(5, .035, [[.5, .84], [.38, .72], [.42, .55], [.5, .42], [.56, .56], [.62, .5], [.64, .72], [.5, .84]])] } },
  { name: 'Crown', drawing: { strokes: [line(5, .04, loop([[.16, .74], [.12, .3], [.32, .5], [.5, .2], [.68, .5], [.88, .3], [.84, .74]])), line(5, .04, [[.16, .84], [.84, .84]]), dot(1, .5, .6, .06), dot(2, .32, .64, .045), dot(3, .68, .64, .045)] } },
  { name: 'Pizza slice', drawing: { strokes: [line(5, .04, loop([[.5, .9], [.16, .2], [.84, .2]])), line(1, .04, arc(.5, .2, .34, .07, Math.PI, TAU, 16)), ...[[.42, .34], [.58, .4], [.5, .58], [.44, .5]].map(([x, y]) => line(1, .03, arc(x!, y!, .04, .04, 0, TAU, 10)))] } },
  { name: 'Cactus', drawing: { strokes: [line(3, .04, [[.42, .92], [.42, .2], [.5, .12], [.58, .2], [.58, .92]]), line(3, .04, [[.42, .56], [.26, .56], [.24, .34]]), line(3, .04, [[.58, .46], [.74, .46], [.76, .28]]), line(0, .012, [[.46, .3], [.5, .34]]), line(0, .012, [[.54, .5], [.5, .54]]), line(0, .012, [[.46, .7], [.5, .74]]), line(1, .035, starPts(.5, .1, .06, .03)), line(4, .04, [[.3, .92], [.7, .92]])] } },
  { name: 'Rocket', drawing: { strokes: [line(2, .04, loop([[.5, .08], [.62, .26], [.62, .66], [.38, .66], [.38, .26]])), line(0, .03, arc(.5, .36, .06)), line(1, .04, loop([[.38, .52], [.24, .72], [.38, .66]])), line(1, .04, loop([[.62, .52], [.76, .72], [.62, .66]])), line(5, .035, [[.42, .72], [.46, .9], [.5, .76], [.54, .92], [.58, .72]])] } },
  { name: 'Ghost', drawing: { strokes: [line(4, .04, [...arc(.5, .42, .26, .28, Math.PI, TAU, 18), [.76, .84], [.67, .76], [.59, .86], [.5, .76], [.41, .86], [.33, .76], [.24, .84], [.24, .42]]), dot(0, .42, .44, .06), dot(0, .58, .44, .06), line(0, .025, arc(.5, .6, .05, .06))] } },
  { name: 'Cool cat', drawing: { strokes: [line(4, .04, [...arc(.5, .56, .3, .27, -Math.PI * .2, Math.PI * 1.2, 24), [.24, .2], [.36, .32], [.5, .29], [.64, .32], [.76, .2], [.76, .43]]), line(0, .035, [[.3, .5], [.46, .5], [.5, .53], [.54, .5], [.7, .5]]), line(0, .03, [[.3, .5], [.36, .58], [.44, .5]]), line(0, .03, [[.56, .5], [.64, .58], [.7, .5]]), line(1, .03, [[.47, .64], [.53, .64], [.5, .68], [.47, .64]]), line(0, .012, [[.14, .62], [.34, .66]]), line(0, .012, [[.86, .62], [.66, .66]])] } },
  { name: 'Ringed planet', drawing: { strokes: [line(4, .04, arc(.5, .5, .24)), line(2, .035, arc(.5, .52, .44, .12, -.1, Math.PI + .1, 20)), line(2, .035, arc(.5, .52, .44, .12, Math.PI + .15, Math.PI + .75, 6)), line(2, .035, arc(.5, .52, .44, .12, TAU - .75, TAU - .15, 6)), dot(5, .2, .18), dot(5, .82, .82), dot(5, .86, .2, .03)] } },
  { name: 'Mountain sunrise', drawing: { strokes: [line(5, .04, arc(.62, .42, .14, .14, Math.PI, TAU, 14)), line(3, .04, [[.08, .78], [.34, .34], [.5, .6], [.64, .46], [.92, .78]]), line(0, .03, [[.06, .8], [.94, .8]]), line(2, .03, [[.2, .9], [.4, .9]]), line(2, .03, [[.56, .9], [.8, .9]])] } },
  { name: 'Fish', drawing: { strokes: [line(2, .04, [...arc(.46, .5, .3, .2, Math.PI * .2, Math.PI * 1.8, 24), [.88, .3], [.88, .7], [.703, .618]]), dot(0, .3, .45, .05), line(2, .025, arc(.5, .5, .06, .1, -1.2, 1.2, 8)), line(2, .02, arc(.18, .2, .04)), line(2, .02, arc(.26, .1, .025))] } },
  { name: 'Lucky mushroom', drawing: { strokes: [line(1, .04, [...arc(.5, .48, .36, .32, Math.PI, TAU, 20), [.14, .48]]), line(5, .04, [[.38, .48], [.36, .86], [.64, .86], [.62, .48]]), dot(5, .36, .32, .06), dot(5, .6, .26, .07), dot(5, .72, .4, .05), dot(0, .45, .64, .04), dot(0, .55, .64, .04)] } },
  { name: 'Iron dumbbell', drawing: { strokes: [line(0, .035, [[.24, .5], [.76, .5]]), line(1, .04, [[.2, .3], [.2, .7]]), line(1, .04, [[.12, .36], [.12, .64]]), line(1, .04, [[.8, .3], [.8, .7]]), line(1, .04, [[.88, .36], [.88, .64]])] } },
];
