// Server entry only. Original questions; references support facts, not copied wording.
export type Question = { id: string; category: string; prompt: string; options: string[]; correct: number; explanation: string; source: string };
const nasa = (planet: string) => `https://science.nasa.gov/${planet}/facts/`;
const noaa = (page: string) => `https://oceanservice.noaa.gov/facts/${page}.html`;
const zoo = (animal: string) => `https://nationalzoo.si.edu/animals/${animal}`;
const math = 'https://openstax.org/books/prealgebra-2e/pages/1-2-add-whole-numbers';
const multiplication = 'https://openstax.org/books/prealgebra-2e/pages/1-4-multiply-whole-numbers';
const division = 'https://openstax.org/books/prealgebra-2e/pages/1-5-divide-whole-numbers';
const triangles = 'https://openstax.org/books/prealgebra-2e/pages/9-3-use-properties-of-angles-triangles-and-the-pythagorean-theorem';
const rectangles = 'https://openstax.org/books/prealgebra-2e/pages/9-4-use-properties-of-rectangles-triangles-and-trapezoids';
const circles = 'https://openstax.org/books/prealgebra-2e/pages/9-5-solve-geometry-applications-circles-and-irregular-figures';
type Entry = [string, string, string, string, string];
// First option is the authored key. The server shuffles all four options per round.
const groups: [string, Entry[]][] = [
  ['Space', [
    ['Which planet takes the inside lane nearest the Sun?', 'Mercury|Venus|Earth|Mars', 'Mercury is the innermost planet.', nasa('mercury'), 'mercury'],
    ['Which planet is the smallest of the eight?', 'Mercury|Mars|Neptune|Venus', 'Mercury is the smallest planet.', nasa('mercury'), 'smallest'],
    ['Which planet has the hottest surface on average?', 'Venus|Mercury|Mars|Saturn', 'The thick atmosphere of Venus traps heat.', nasa('venus'), 'hottest'],
    ['Which planet is nicknamed the Red Planet?', 'Mars|Jupiter|Venus|Neptune', 'Iron minerals rust in the Martian surface.', nasa('mars'), 'red'],
    ['Which planet is the largest in our solar system?', 'Jupiter|Saturn|Earth|Uranus', 'Jupiter is the largest planet.', nasa('jupiter'), 'largest'],
    ['The Great Red Spot is a storm on which planet?', 'Jupiter|Mars|Neptune|Mercury', 'This long-lived storm swirls on Jupiter.', nasa('jupiter'), 'spot'],
    ['Which planet has the most prominent icy ring system?', 'Saturn|Earth|Venus|Mars', 'Saturn has an extensive system of icy rings.', nasa('saturn'), 'rings'],
    ['Which planet spins almost on its side?', 'Uranus|Earth|Mercury|Jupiter', 'Uranus has an extreme axial tilt.', nasa('uranus'), 'tilt'],
    ['Which of the eight planets is farthest from the Sun?', 'Neptune|Saturn|Uranus|Mars', 'Neptune is the eighth planet from the Sun.', nasa('neptune'), 'farthest'],
    ['What kind of object is our Sun?', 'Star|Planet|Moon|Comet', 'The Sun is the star at our solar system’s center.', nasa('sun'), 'sun'],
  ]],
  ['Ocean', [
    ['Which ocean basin is the largest?', 'Pacific|Atlantic|Indian|Arctic', 'The Pacific is the largest ocean basin.', noaa('biggestocean'), 'pacific'],
    ['About how much of Earth’s surface is ocean?', '71 percent|21 percent|41 percent|91 percent', 'Ocean covers about 71 percent of Earth.', noaa('oceanwater'), 'cover'],
    ['Corals belong to which group?', 'Animals|Plants|Fungi|Rocks', 'Corals are animals, even though they stay in place.', noaa('coral'), 'coral'],
    ['What happens to water pressure as a diver goes deeper?', 'It increases|It decreases|It disappears|It always stays the same', 'More overlying water means greater pressure.', noaa('pressure'), 'pressure'],
    ['What is the regular rise and fall of sea level called?', 'Tides|Dunes|Frost|Eclipses', 'Tides are long waves seen as sea level rises and falls.', noaa('tides'), 'tides'],
    ['Which object’s gravity is especially important in making ocean tides?', 'The Moon|Mars|Polaris|A passing airplane', 'The Moon and Sun exert tide-generating gravitational forces.', noaa('tides'), 'moon'],
    ['Kelp belongs to which broad group?', 'Algae|Corals|Mammals|Mushrooms', 'Kelp is a large brown alga.', noaa('kelp'), 'kelp'],
    ['What do we call many coastal places where river water meets seawater?', 'Estuaries|Glaciers|Volcanoes|Deserts', 'Many estuaries mix fresh river water and salty seawater.', noaa('estuary'), 'estuary'],
    ['Which animal has visible external ear flaps?', 'Sea lion|True seal|Dolphin|Shark', 'Sea lions have ear flaps; true seals have ear holes.', noaa('seal-sealion'), 'ears'],
    ['Water absorbs which color of light more strongly, helping deep water look blue?', 'Red|Blue|Both equally|Neither color', 'Water absorbs light toward the red end of the spectrum.', noaa('oceanblue'), 'blue'],
  ]],
  ['Animals', [
    ['Which plant supplies most of a giant panda’s meals?', 'Bamboo|Cactus|Seaweed|Pine needles', 'Giant pandas specialize in eating bamboo.', zoo('giant-panda'), 'bamboo'],
    ['Giant pandas are native to which country?', 'China|Brazil|Canada|Kenya', 'Their native mountain forests are in China.', zoo('giant-panda'), 'panda-home'],
    ['A giant panda’s useful extra “thumb” is a modified what?', 'Wrist bone|Tooth|Ear|Claw tip', 'An enlarged wrist bone helps it grip bamboo.', zoo('giant-panda'), 'thumb'],
    ['An elephant’s trunk combines its nose with which body part?', 'Upper lip|Tail|Chin|Ear', 'The trunk is an extension of the nose and upper lip.', zoo('asian-elephant'), 'trunk'],
    ['Elephant tusks are enlarged versions of which body part?', 'Incisor teeth|Toenails|Ribs|Ear bones', 'Tusks are modified upper incisor teeth.', zoo('asian-elephant'), 'tusks'],
    ['Which land animal is famous for the fastest sprint?', 'Cheetah|Zebra|Giraffe|Elephant', 'Cheetahs are specialized for fast, short pursuits.', zoo('cheetah'), 'sprint'],
    ['What pattern covers most of a cheetah’s coat?', 'Solid black spots|Wide zebra stripes|Large white squares|No markings', 'Cheetahs have distinctive solid dark spots.', zoo('cheetah'), 'spots'],
    ['A Komodo dragon is a type of what?', 'Lizard|Crocodile|Bird|Frog', 'Komodo dragons are the largest living lizards.', zoo('komodo-dragon'), 'dragon'],
    ['Which body covering protects an Aldabra tortoise?', 'Shell|Feathers|Fur|Loose scales only', 'A tortoise’s body is protected by its shell.', zoo('aldabra-tortoise'), 'shell'],
    ['An adult green tree python is what kind of animal?', 'Snake|Lizard|Worm|Frog', 'Green tree pythons are tree-dwelling snakes.', zoo('green-tree-python'), 'python'],
  ]],
  ['Number lab', [
    ['The lab has 7 red buttons and 6 blue buttons. How many buttons?', '13|12|14|11', 'Adding 7 and 6 gives 13.', math, 'sum'],
    ['Four shelves hold 6 jars each. How many jars altogether?', '24|10|20|28', 'Four groups of six make 24.', multiplication, 'jars'],
    ['Twenty stickers are shared equally among 5 notebooks. How many each?', '4|5|10|15', '20 divided by 5 is 4.', division, 'stickers'],
    ['A robot makes 3 beeps per turn for 7 turns. How many beeps?', '21|10|18|24', '3 multiplied by 7 is 21.', multiplication, 'beeps'],
    ['Two machines make 8 bubbles each. What is the total?', '16|10|14|18', 'Two groups of eight total 16.', multiplication, 'bubbles'],
    ['A tray has 9 cups. A second tray has 12. How many cups?', '21|19|20|23', '9 plus 12 equals 21.', math, 'cups'],
    ['Thirty tiles form 6 equal rows. How many tiles per row?', '5|4|6|7', '30 divided by 6 is 5.', division, 'rows'],
    ['Five dials have 5 settings each. How many settings when you add their counts?', '25|10|20|30', 'Five counts of five add up to 25.', multiplication, 'dials'],
    ['A tube holds 18 beads. Another holds 14. Total beads?', '32|30|34|28', '18 plus 14 equals 32.', math, 'beads'],
    ['Thirty-six tokens split into 4 equal piles gives how many per pile?', '9|6|8|12', '36 divided by 4 is 9.', division, 'piles'],
  ]],
  ['Shapes', [
    ['A triangle has how many sides?', '3|4|5|6', 'A triangle has three sides.', triangles, 'triangle'],
    ['How many degrees make a right angle?', '90|45|180|360', 'A right angle measures 90 degrees.', triangles, 'right'],
    ['A straight angle measures how many degrees?', '180|90|60|270', 'A straight angle measures 180 degrees.', triangles, 'straight'],
    ['The interior angles of a flat triangle add to what?', '180 degrees|90 degrees|270 degrees|360 degrees', 'A Euclidean triangle’s angles total 180 degrees.', triangles, 'angle-sum'],
    ['Which triangle has all three sides equal?', 'Equilateral|Scalene|Any right triangle|None', 'Equilateral triangles have three equal sides.', triangles, 'equal'],
    ['A square has side length 3 cm. What is its perimeter?', '12 cm|6 cm|9 cm|15 cm', 'Add the four equal sides: 4 times 3 is 12.', rectangles, 'perimeter'],
    ['A rectangle is 5 cm by 2 cm. What is its area?', '10 square cm|7 square cm|14 square cm|25 square cm', 'Rectangle area is length times width.', rectangles, 'area'],
    ['What is the distance from a circle’s center to its edge called?', 'Radius|Diameter|Perimeter|Corner', 'A radius connects a circle’s center to its boundary.', circles, 'radius'],
    ['A circle’s radius is 4 cm. Its diameter is what?', '8 cm|2 cm|4 cm|16 cm', 'The diameter is twice the radius.', circles, 'diameter'],
    ['What is the distance all the way around a circle called?', 'Circumference|Radius|Area|Volume', 'Circumference measures a circle’s boundary.', circles, 'circumference'],
  ]],
  ['Matter', [
    ['Which element uses the symbol O?', 'Oxygen|Gold|Osmium|Hydrogen', 'O is the chemical symbol for oxygen.', 'https://periodic-table.rsc.org/element/8/oxygen', 'oxygen'],
    ['Which element uses the symbol H?', 'Hydrogen|Helium|Carbon|Iron', 'H is the chemical symbol for hydrogen.', 'https://periodic-table.rsc.org/element/1/hydrogen', 'hydrogen'],
    ['Which element uses the symbol C?', 'Carbon|Calcium|Copper|Chlorine', 'C is carbon; calcium uses Ca.', 'https://periodic-table.rsc.org/element/6/carbon', 'carbon'],
    ['Which element uses the symbol Fe?', 'Iron|Fluorine|Gold|Lead', 'Fe is the symbol for iron.', 'https://periodic-table.rsc.org/element/26/iron', 'iron'],
    ['Which metal uses the symbol Au?', 'Gold|Silver|Aluminum|Copper', 'Au is the chemical symbol for gold.', 'https://periodic-table.rsc.org/element/79/gold', 'gold'],
    ['Which element uses the symbol He?', 'Helium|Hydrogen|Mercury|Neon', 'He is the symbol for helium.', 'https://periodic-table.rsc.org/element/2/helium', 'helium'],
    ['Which element uses the symbol Ca?', 'Calcium|Carbon|Copper|Cobalt', 'Ca is calcium.', 'https://periodic-table.rsc.org/element/20/calcium', 'calcium'],
    ['Which element uses the symbol Cu?', 'Copper|Calcium|Carbon|Chlorine', 'Cu is copper.', 'https://periodic-table.rsc.org/element/29/copper', 'copper'],
    ['Which element has atomic number 1?', 'Hydrogen|Helium|Oxygen|Carbon', 'Hydrogen atoms have one proton.', 'https://periodic-table.rsc.org/element/1/hydrogen', 'one'],
    ['Which element uses the symbol Ag?', 'Silver|Gold|Argon|Aluminum', 'Ag is the chemical symbol for silver.', 'https://periodic-table.rsc.org/element/47/silver', 'silver'],
  ]],
];
export const questions: readonly Question[] = groups.flatMap(([category, entries]) => entries.map(([prompt, options, explanation, source, id]) => ({ id, category, prompt, options: options.split('|'), correct: 0, explanation, source })));
