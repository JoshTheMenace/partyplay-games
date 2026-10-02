/* Airlock test banks (server only; never imported by client code). Every pair is original: the crew's real prompt, then the
   aliens' near miss. Adult extras are filtered in family mode. */
import type { IconId, Kind } from './types';

export type Pair = { kind: Kind; crew: string; alien: string; icons?: IconId[]; adult?: true };
type Two = readonly [crew: string, alien: string];
type Four = readonly [crew: string, alien: string, icons: readonly [IconId, IconId, IconId, IconId]];

const ANSWER: Two[] = [
  ['Name a breakfast food', 'Name a dinner food'],
  ['Name a fruit', 'Name a vegetable'],
  ['Name something you find at the beach', 'Name something you find in a forest'],
  ['Name a pet', 'Name a farm animal'],
  ['Name something yellow', 'Name something orange'],
  ['Name a winter sport', 'Name a summer sport'],
  ['Name something in a kitchen drawer', 'Name something in a bathroom cabinet'],
  ['Name a reason to be late', 'Name a reason to leave early'],
  ['Name something you’d pack for a holiday', 'Name something you’d pack for a camping trip'],
  ['Name a smelly food', 'Name a spicy food'],
  ['Name something that flies', 'Name something that floats'],
  ['Name a job with a uniform', 'Name a job you can do from home'],
  ['Name a rainy-day hobby', 'Name a sunny-day hobby'],
  ['Name something sticky', 'Name something slippery'],
  ['Name something you’d find in a castle', 'Name something you’d find in a museum'],
  ['Name a pizza topping', 'Name a sandwich filling'],
  ['Name something with wheels', 'Name something with wings'],
  ['Name an instrument you blow into', 'Name an instrument you hit'],
  ['Name a superpower you’d love', 'Name a superpower you’d hate'],
  ['Name something you do every morning', 'Name something you do every night'],
  ['Name a sea creature', 'Name a jungle creature'],
  ['Name a dessert', 'Name a snack'],
  ['Name something in a school bag', 'Name something in a handbag'],
  ['Name something you shouldn’t touch', 'Name something you shouldn’t eat'],
  ['Name a nice smell', 'Name a nasty smell'],
  ['Name a colour of the rainbow', 'Name a colour you’d paint a bedroom'],
  ['Name something round', 'Name something square'],
  ['Name a word that rhymes with cat', 'Name a word that rhymes with dog'],
  ['Name something a dog does', 'Name something a cat does'],
  ['Name something at a birthday party', 'Name something at a wedding'],
  ['Name a cold drink', 'Name a hot drink'],
  ['Name something you’d see in space', 'Name something you’d see underwater'],
  ['Name a thing you’re always losing', 'Name a thing you’re always breaking'],
  ['Name a country in Europe', 'Name a country in Asia'],
  ['Name something noisy', 'Name something quiet'],
  ['Name a vegetable you love', 'Name a vegetable you hate'],
  ['Name a fairy-tale creature', 'Name a creature from a nightmare'],
  ['Name a thing you’d find in a garden shed', 'Name a thing you’d find in a garage'],
  ['Name a famous kind of cheese', 'Name a famous kind of bread'],
  ['Name something that melts', 'Name something that freezes'],
];
const ANSWER_ADULT: Two[] = [
  ['Name a reason to cancel a date', 'Name a reason to leave a date early'],
  ['Name a bad place for a first kiss', 'Name a bad place for a first date'],
  ['Name something you’d hide from your parents', 'Name something you’d hide from your flatmates'],
  ['Name a cocktail', 'Name a pub snack'],
  ['Name a hangover cure', 'Name a hangover cause'],
  ['Name something people do at the office party', 'Name something people regret after the office party'],
];

const RATING: Two[] = [
  ['How much do you like rain?', 'How much do you like sunshine?'],
  ['How scary are spiders?', 'How scary are dogs?'],
  ['How good are you at cooking?', 'How good are you at dancing?'],
  ['How much do you enjoy mornings?', 'How much do you enjoy late nights?'],
  ['How tasty is broccoli?', 'How tasty is chocolate?'],
  ['How fun is a theme park?', 'How fun is a museum?'],
  ['How messy is your bedroom?', 'How tidy is your bedroom?'],
  ['How brave are you?', 'How lazy are you?'],
  ['How much do you love the beach?', 'How much do you love the snow?'],
  ['How annoying are mosquitoes?', 'How annoying are alarm clocks?'],
  ['How good is pineapple on pizza?', 'How good is cheese on pizza?'],
  ['How much do you like singing in public?', 'How much do you like singing in the shower?'],
  ['How cool are dinosaurs?', 'How cool are spreadsheets?'],
  ['How likely are you to cry at a film?', 'How likely are you to laugh at a film?'],
  ['How good is your sense of direction?', 'How good is your memory?'],
  ['How much do you like surprises?', 'How much do you like routines?'],
  ['How sporty are you?', 'How artistic are you?'],
  ['How scary is the dark?', 'How scary is the dentist?'],
  ['How much would you enjoy a trip to the Moon?', 'How much would you enjoy a trip to the shops?'],
  ['How much spice can you handle?', 'How sweet is your sweet tooth?'],
  ['How patient are you in a queue?', 'How patient are you with a slow computer?'],
  ['How cuddly is a hedgehog?', 'How cuddly is a teddy bear?'],
  ['How fun is homework?', 'How fun is a water fight?'],
  ['How good are you at keeping secrets?', 'How good are you at telling jokes?'],
  ['How exciting is a thunderstorm?', 'How exciting is a car wash?'],
  ['How tasty are Brussels sprouts?', 'How tasty are chips?'],
  ['How loud is your laugh?', 'How loud is your sneeze?'],
  ['How much do you like camping?', 'How much do you like hotels?'],
  ['How good are you at video games?', 'How good are you at board games?'],
  ['How often do you lose your keys?', 'How often do you lose your temper?'],
  ['How much do you trust robots?', 'How much do you trust cats?'],
  ['How good would you be on a desert island?', 'How good would you be in a big city?'],
];
const RATING_ADULT: Two[] = [
  ['How good are you at flirting?', 'How good are you at karaoke?'],
  ['How wild was your last night out?', 'How wild was your last birthday?'],
  ['How much do you love a nightclub?', 'How much do you love a quiz night?'],
  ['How strong do you like your drinks?', 'How strong do you like your coffee?'],
  ['How embarrassing were your teenage years?', 'How embarrassing is your music taste?'],
];

const PICK: Two[] = [
  ['Who is the best cook?', 'Who is the worst cook?'],
  ['Who would last longest on a desert island?', 'Who would be first to give up on a desert island?'],
  ['Who is most likely to become famous?', 'Who is most likely to become a hermit?'],
  ['Who would win a dance-off?', 'Who would lose a dance-off?'],
  ['Who is the tidiest?', 'Who is the messiest?'],
  ['Who is most likely to adopt ten cats?', 'Who is most likely to be scared of a cat?'],
  ['Who would make the best astronaut?', 'Who would make the best ship’s cook?'],
  ['Who tells the best jokes?', 'Who laughs loudest at their own jokes?'],
  ['Who is always early?', 'Who is always late?'],
  ['Who would survive a zombie film?', 'Who would be first out in a zombie film?'],
  ['Who is the best singer?', 'Who is the loudest singer?'],
  ['Who would make the best teacher?', 'Who would make the best spy?'],
  ['Who is most likely to get lost?', 'Who is most likely to find a shortcut?'],
  ['Who has the best laugh?', 'Who has the best sneeze?'],
  ['Who is most likely to win the lottery?', 'Who is most likely to lose a winning ticket?'],
  ['Who would make the best ship’s captain?', 'Who would make the best co-pilot?'],
  ['Who is most likely to talk to plants?', 'Who is most likely to talk to animals?'],
  ['Who would win at hide-and-seek?', 'Who would lose at hide-and-seek?'],
  ['Who is best at keeping secrets?', 'Who is worst at keeping secrets?'],
  ['Who would make the scariest villain?', 'Who would make the bravest hero?'],
  ['Who is most likely to eat dessert first?', 'Who is most likely to skip dessert?'],
  ['Who has the neatest handwriting?', 'Who has the messiest handwriting?'],
  ['Who would win a talent show?', 'Who would host a talent show?'],
  ['Who is most likely to fall asleep during a film?', 'Who is most likely to cry during a film?'],
  ['Who is the most competitive?', 'Who is the sorest loser?'],
  ['Who would make the best detective?', 'Who would make the best criminal?'],
  ['Who is most likely to be an alien?', 'Who is least likely to be an alien?'],
  ['Who would you trust with your pet?', 'Who would you trust with your phone?'],
  ['Who has the most stuff in their pockets?', 'Who has the most apps on their phone?'],
  ['Who would make the best leader?', 'Who would make the best sidekick?'],
];
const PICK_ADULT: Two[] = [
  ['Who is most likely to text an ex tonight?', 'Who is most likely to ignore an ex’s text?'],
  ['Who would be the best wingman?', 'Who would be the worst wingman?'],
  ['Who is most likely to dance on a table?', 'Who is most likely to leave the party first?'],
  ['Who would win a drinking contest?', 'Who would lose a drinking contest?'],
  ['Who has the wildest dating history?', 'Who has the tamest dating history?'],
  ['Who is most likely to get married on a whim?', 'Who is most likely to run from their own wedding?'],
];

/** Draw tests: the thing to draw, as in “Draw a cat”. */
const DRAW: Two[] = [
  ['a cat', 'a dog'], ['a rocket', 'an aeroplane'], ['a snowman', 'a sandcastle'], ['a pizza', 'a birthday cake'], ['a shark', 'a whale'],
  ['an apple', 'a pear'], ['a castle', 'a lighthouse'], ['a spider', 'an octopus'], ['the sun', 'a flower'], ['a car', 'a bus'],
  ['a ghost', 'a jellyfish'], ['a guitar', 'a violin'], ['an umbrella', 'a mushroom'], ['a robot', 'a knight in armour'], ['a cup of tea', 'a bowl of soup'],
  ['a tree', 'a cactus'], ['a fish', 'a bird'], ['a house', 'a tent'], ['a crown', 'a top hat'], ['an ice-cream cone', 'a lollipop'],
  ['a duck', 'a chicken'], ['a train', 'a submarine'], ['the moon', 'a banana'], ['a pair of glasses', 'a pair of headphones'], ['a dinosaur', 'a dragon'],
  ['a volcano', 'a mountain'], ['a toothbrush', 'a hairbrush'], ['a bicycle', 'a scooter'], ['a sock', 'a boot'], ['an alien', 'an astronaut'],
];
const DRAW_ADULT: Two[] = [['a bad first date', 'a boring meeting'], ['your last night out', 'your last holiday']];

const CHOICE: Four[] = [
  ['What would you bring to a desert island?', 'What would you leave behind on a desert island?', ['guitar', 'book', 'pizza', 'dog']],
  ['Which makes the best pet?', 'Which makes the worst pet?', ['cat', 'dog', 'fish', 'robot']],
  ['Which is the best birthday present?', 'Which is the worst birthday present?', ['gift', 'cake', 'sock', 'guitar']],
  ['Where would you most like to live?', 'Where would you least like to live?', ['house', 'tent', 'boat', 'planet']],
  ['What would you grab on a rainy day?', 'What would you grab on a sunny day?', ['umbrella', 'book', 'icecream', 'ball']],
  ['Which is the best treat?', 'Which is the worst treat?', ['donut', 'icecream', 'cake', 'pizza']],
  ['What would you pack for a trip to space?', 'What would you pack for a trip to the beach?', ['ball', 'umbrella', 'music', 'coffee']],
  ['Which is the most relaxing?', 'Which is the most exciting?', ['music', 'book', 'rocket', 'car']],
  ['What do you need at a sleepover?', 'What do you need at a picnic?', ['pizza', 'ghost', 'music', 'cake']],
  ['Which is the spookiest?', 'Which is the cutest?', ['ghost', 'cat', 'moon', 'snowman']],
  ['Which would you rather drive?', 'Which would you rather sleep in?', ['car', 'boat', 'tent', 'rocket']],
  ['What gets you up in the morning?', 'What sends you to sleep at night?', ['coffee', 'sun', 'music', 'book']],
  ['Which would you hug?', 'Which would you avoid?', ['cat', 'cactus', 'snowman', 'robot']],
  ['Which is the best holiday?', 'Which is the worst holiday?', ['tent', 'boat', 'snowman', 'sun']],
  ['What would a king love most?', 'What would a pirate love most?', ['crown', 'boat', 'cake', 'guitar']],
  ['Which do you use the most?', 'Which do you use the least?', ['phone', 'book', 'umbrella', 'sock']],
  ['What would cheer you up?', 'What would calm you down?', ['music', 'icecream', 'dog', 'book']],
  ['What would you eat at midnight?', 'What would you eat at breakfast?', ['pizza', 'donut', 'coffee', 'cake']],
  ['Which is the best Saturday?', 'Which is the worst Saturday?', ['ball', 'book', 'tent', 'phone']],
  ['Which would scare an alien most?', 'Which would confuse an alien most?', ['ghost', 'cat', 'sock', 'robot']],
  ['What makes the best party?', 'What ruins a party?', ['music', 'cake', 'ghost', 'phone']],
  ['Which would you draw on a birthday card?', 'Which would you draw on a get-well card?', ['sun', 'moon', 'heart', 'flower']],
  ['Which would you want as a sidekick?', 'Which would you want as a butler?', ['robot', 'dog', 'cat', 'ghost']],
  ['Which would you bring to a talent show?', 'Which would you bring to a job interview?', ['guitar', 'cat', 'book', 'crown']],
  ['What’s the best gift for a teacher?', 'What’s the best gift for a grandparent?', ['flower', 'coffee', 'book', 'heart']],
  ['What should every spaceship have?', 'What should no spaceship have?', ['coffee', 'cat', 'music', 'cactus']],
];
const CHOICE_ADULT: Four[] = [
  ['What would you bring on a first date?', 'What would you bring to a break-up?', ['flower', 'heart', 'phone', 'icecream']],
  ['Which is the best hangover cure?', 'Which is the worst hangover cure?', ['coffee', 'pizza', 'music', 'sun']],
  ['What would you hide from a date?', 'What would you show off to a date?', ['sock', 'phone', 'guitar', 'crown']],
];

const two = (kind: Kind, list: readonly Two[], adult = false): Pair[] => list.map(([crew, alien]) => ({ kind, crew, alien, ...(adult ? { adult: true as const } : {}) }));
const four = (list: readonly Four[], adult = false): Pair[] => list.map(([crew, alien, icons]) => ({ kind: 'choice', crew, alien, icons: [...icons], ...(adult ? { adult: true as const } : {}) }));
export const PAIRS: readonly Pair[] = [
  ...two('answer', ANSWER), ...two('answer', ANSWER_ADULT, true), ...two('rating', RATING), ...two('rating', RATING_ADULT, true),
  ...two('pick', PICK), ...two('pick', PICK_ADULT, true), ...two('draw', DRAW), ...two('draw', DRAW_ADULT, true), ...four(CHOICE), ...four(CHOICE_ADULT, true),
];
/** Night-memory key: the crew prompt (unique across the bank). */
export const pairKey = (p: Pair) => `${p.kind}:${p.crew}`;
export const pairPool = (kind: Kind, family: boolean) => PAIRS.filter(p => p.kind === kind && (!family || !p.adult));
