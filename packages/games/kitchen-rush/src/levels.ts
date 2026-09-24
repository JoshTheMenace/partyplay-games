// Hand-authored kitchens. Browser-safe data: the phone, display and rules all derive the same map from settings + roster.
import { parseMap, type KitchenMap, type Level } from './model';

/*
 * Balance is measured, not guessed: output/kitchen-rush/v2/balance/sim.ts plays every level × roster (1–10) × seed through
 * rules.create/tick at 60 Hz with the crew bot in tests/helpers/bot.ts, which stands in for a strong human crew.
 * - stars: 30 / 55 / 85 % of the median two-bot score over 180 s with the real order stream.
 * - crewScale: crew capacity relative to two chefs (median bot score with the order queue kept full). The server paces
 *   orders by it (one every patience / 2.6 / crewScale s), so bigger crews get proportionally more work.
 * - starScale: the measured real-stream score of each roster relative to two chefs. It rises more slowly than capacity
 *   because the stream (topped up to the opening 2–3 orders, else paced by crewScale) is the limit for big crews.
 *   `crowd` caps it on kitchens that jam before the crew runs out of hands (First Shift, Burger Bar).
 * - patience: strong bots never let an order expire at the intended roster, and a slower, dash-free crew (bot CASUAL)
 *   rarely does on levels 1–3. Levels 4–8 are ~15 % tighter so slower crews occasionally lose one.
 * Re-run the sim (and output/kitchen-rush/v2/balance/ratios.ts) after changing maps, recipes or order rules.
 */
export const LEVELS: Level[] = [
  {
    // Bots, two chefs: 33 dishes (1730). Two board counters with open lanes around them; no washing.
    id: 'first-shift', name: 'First Shift', location: 'Sunny Side Diner', theme: 'diner', recipes: ['side_salad', 'salad'], patience: 55, stars: [520, 950, 1470], crowd: 1.25,
    blurb: 'Chop lettuce and tomatoes, plate them, and ring the hatch. Clean plates come back on their own tonight.',
    small: [
      '###l#t###R#R#',
      'l..@.....@..H',
      '#...#C#C#...#',
      '#...........#',
      'C...#C#C#...#',
      't..@.....@..#',
      '####X###C####',
    ],
    large: [
      '##l#t###l#t#####R#R#',
      'l..@....@..@....@..H',
      '#...#C#C#..#C#C#...R',
      '#.@..............@.#',
      'C...#C#C#..#C#C#...#',
      't..@....@..@....@..H',
      '####X#####C#####X###',
    ],
  },
  {
    // Bots, two chefs: 12 soups (730). Prep and stove sides share one pass board and the bottom walkway.
    id: 'soup-kitchen', name: 'Soup Kitchen', location: 'Harbour Galley', theme: 'harbor', recipes: ['tomato_soup', 'onion_soup'], patience: 75, stars: [220, 400, 620],
    blurb: 'Three chopped tomatoes or onions per pot. Pass them over the wall to the stoves, and keep the sink moving.',
    small: [
      '##t#o##O#O#O##',
      'C..@..#...@..H',
      '#.....C......#',
      'C.....#..##..R',
      't..@..#...@..W',
      'o............D',
      '###C####E#X#R#',
    ],
    large: [
      '##t#o#t#o##O#O#O#O##',
      'C..@...@.#..@...@..H',
      '#........C.........#',
      'C..#CC#..#..#O#O#..R',
      '#..#CC#..#.........W',
      't..@...@.#...@...@.D',
      'o..................R',
      'C...@....#....@....W',
      '###X#C#C###E##X##R##',
    ],
  },
  {
    // Bots, two chefs: 17 dishes (1070). The grill lane is one wide; boards face the open floor.
    id: 'burger-bar', name: 'Burger Bar', location: 'Route 66 Grill', theme: 'diner', recipes: ['burger', 'salad', 'cheeseburger'], patience: 70, stars: [320, 590, 910], crowd: 1.5,
    blurb: 'Chop the beef, fry it in a pan and add a bun. The grill line is tight, so call your moves.',
    small: [
      '##p#F#F#F#b##',
      '#...........#',
      'l..#######..R',
      't..#C#C#C#..#',
      'c..@.....@..R',
      '#..@.....@..#',
      '#X#E#DWR#H#b#',
    ],
    large: [
      '##p##F#F#F###F#F##b##',
      '#...................#',
      'l..@....@...@....@..#',
      't..#C#C#C#.#C#C#C#..R',
      'c..#######.#######..#',
      '#..@....@...@....@..R',
      '#......@.....@......W',
      '#X#E#DWR##H#H###b#E##',
    ],
  },
  {
    // Bots, two chefs: 12 dishes (730), handing chopped beef and cheese over the belts.
    id: 'conveyor-cafe', name: 'Conveyor Cafe', location: 'Night Market', theme: 'market', recipes: ['salad', 'burger', 'cheeseburger'], patience: 62, stars: [220, 400, 620],
    blurb: 'The prep side chops, the grill side fries, plates and washes. Only the belts cross the wall — or take the long way round.',
    small: [
      '#l#t#p###F#F#b#',
      '#......##.....#',
      'c..@..>>>#.@..H',
      '#..@...##..#.@R',
      'C......##.....W',
      'l.....>>>#....D',
      '#.............R',
      '#C#X#C###E#b#X#',
    ],
    large: [
      '#l#t#p#c#l####F#F#F#b#',
      '#.........##.........#',
      'c..@....@.>>>#.@...@.H',
      'C..#CC#...##...#...#.R',
      '#..@....@.>>>#.@....@W',
      'C..#CC#...##...#...#.D',
      'l..@....@.>>>#.@...@.W',
      '#....................H',
      '##X#C#C#####E#X#F#bRE#',
    ],
  },
  {
    // Bots, two chefs: 12 dishes (670); ice slows every trip to the hatch.
    id: 'slippery-summit', name: 'Slippery Summit', location: 'Glacier Lodge', theme: 'alpine', recipes: ['tomato_soup', 'salad', 'onion_soup'], patience: 66, stars: [200, 370, 570],
    blurb: 'The stoves sit in the lodge wall. Carry soup across the icy terrace — mind the crevasses, they swallow thrown food.',
    small: [
      '#l#t#o##R#R####',
      '#.....O*******#',
      'C..@..#**~~**@H',
      '#.....O**~~***#',
      'C..@...*******D',
      '#.....O*@*~~**W',
      '##X#E##~~~~~~R#',
    ],
    large: [
      '##l#t#o#t###R#R#R####',
      '#........O**********#',
      'C..@...@.#***~~****@H',
      '#........O***~~*****#',
      'C..#CC#..#**@****~~*D',
      '#........O*******~~*W',
      'C..@...@.....***@***R',
      '#..#CC#..O**~~******D',
      '#..@...@.#**~~***@**W',
      '##X#E#C##~~~~~~~~~~R#',
    ],
  },
  {
    // Bots, two chefs: 10 burgers (710). Someone must mind the pans while the bridges are up; solo is very hard.
    id: 'drawbridge-deli', name: 'Drawbridge Deli', location: 'Red Rock Canyon', theme: 'canyon', recipes: ['burger', 'cheeseburger', 'deluxe_burger'], patience: 72, stars: [210, 390, 600],
    blurb: 'The drawbridges lift every half minute. Keep chopping on the far side and send food over by belt or by throwing it.',
    small: [
      '#p#c#t~~F#F#b##',
      'l..@..>#..@...H',
      'C.....gg......#',
      '#.....~~..##..R',
      'C..@..~~..@...W',
      '#.....gg......D',
      '#.....>#......#',
      '##X#C#~~#E#R#X#',
    ],
    large: [
      '#p#c#t#l#~~F#F#F#b####',
      'l..@...@.>#..@....@..H',
      'C........gg..........#',
      '#..#CC#..~~....##....R',
      'C..@...@.~~..@....@..W',
      '#........>#..........D',
      'C........gg....##....R',
      '#..@...@.~~..@....@..W',
      '#........>#..........H',
      '##X###C##~~#X#R#b#F#E#',
    ],
    gates: { open: 22, warn: 4, closed: 10 },
  },
  {
    // Bots, two chefs: 18 dishes (1050); every handover needs a portal or a pass counter.
    id: 'portal-pizzeria', name: 'Portal Pizzeria', location: 'Canal Street Market', theme: 'market', recipes: ['pizza', 'salad', 'side_salad'], patience: 56, stars: [310, 580, 890],
    blurb: 'Three islands, two portals. Dough goes on a plate, then tomato and cheese, then into the oven.',
    small: [
      '#l#t#~VRV~#R###',
      '#.T..~...~..T.#',
      'c....~.@.#....H',
      'C.@..~...~.@..#',
      'd....~...#....D',
      'C....~.@.~..@.W',
      '#.T..~.T.~....R',
      '#C#X#~E##~#X###',
    ],
    large: [
      '#l#t#c#d#~V#R#V~#R#R##',
      '#..T.....~.....~....T#',
      'c........~..@..#.....H',
      'C..@...@.~.....~..@..#',
      '#..#CC#..~..@..#.....D',
      'd........~.....~..@..W',
      'C..@...@.~..@..#.....R',
      '#........~..T..~.....W',
      'C..T.....~.....~..@..D',
      '##C#X#l#t~#VEV#~#X#R##',
    ],
  },
  {
    // Bots, two chefs: 14 dishes (910) over five recipes; belts feed the hot line, a portal reaches the pass.
    id: 'grand-opening', name: 'Grand Opening', location: 'The Grand Hotel', theme: 'grand', recipes: ['salad', 'tomato_soup', 'cheeseburger', 'deluxe_burger', 'pizza'], patience: 72, stars: [270, 500, 780],
    blurb: 'Opening night! Pantry, hot line and pass each need a crew. Belts feed the stoves and a portal rushes salads to the pass.',
    small: [
      '#l#tc#O#OV#R#R#',
      '#....#....#...#',
      'p.@.>>#.@.#.@.H',
      'C.........#...D',
      '#.T..#........W',
      'C...>>#...#.T.R',
      '#.@..#.@..#.@.#',
      '#bdX##EF#F#X#E#',
    ],
    large: [
      '#l#t#p#c##O#O#VV##R#R#',
      '#.......#.......#....#',
      'p.@...@>>#.@..@.#.@..H',
      'C..#CC#.........#..@.D',
      'd.......#.......#....W',
      'C.T...@>>#.@..@......R',
      '#.......#.......#.T..W',
      'C.@...@>>#.@..@.#....D',
      '#.......#.......#.@..H',
      '#b#d#X###EF#F#OE#X#R##',
    ],
  },
];

const maps = new Map<string, KitchenMap>();
/** Small maps seat 1–4 chefs; large maps seat 5–10. */
export function kitchenMap(level: number, players: number): KitchenMap {
  const size = players > 4 ? 'large' : 'small', key = `${level}:${size}`;
  let map = maps.get(key);
  if (!map) maps.set(key, map = parseMap(LEVELS[level][size]));
  return map;
}
/** Crew capacity relative to two chefs (paces the order stream): each chef adds half a duo on small maps, less on large ones. */
export const crewScale = (players: number) => players <= 4 ? players / 2 : 2.2 + (players - 5) * .33;
/** Score a crew actually reaches relative to two chefs under that order stream (see the header). */
const starScale = (players: number) => players <= 2 ? players / 2 : players <= 4 ? .9 + players * .12 : 1.62 + players * .06;
/** Roster and service-length scaling of a level's two-chef, 180-second star targets. */
export function starThresholds(level: number, players: number, seconds: number): [number, number, number] {
  const scale = Math.min(starScale(players), LEVELS[level].crowd ?? Infinity);
  return LEVELS[level].stars.map(score => Math.max(20, Math.round(score * scale * seconds / 180 / 10) * 10)) as [number, number, number];
}
