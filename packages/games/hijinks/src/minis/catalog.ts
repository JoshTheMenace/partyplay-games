import type { MiniInfo } from '../core/contract';

/** Client-safe menu/intro metadata. A catalog id without a server in registry.server.ts is shown but never playable. */
export const MINIS: MiniInfo[] = [
  {
    id: 'quip-clash', title: 'Quip Clash', tagline: 'Two answers enter. One gets the laughs.',
    howTo: ['Write funny answers to two prompts on your phone.', 'Answers face off head-to-head on the big screen.', 'Vote for the one that made you laugh. Big wins score big.'],
    players: { min: 3, max: 10 }, minutes: '8–12', tags: ['writing', 'comedy', 'voting'], accent: '#ff5748', intro: ['quip-clash.intro'],
  },
  {
    id: 'tall-tales', title: 'Tall Tales', tagline: 'Every story is true. Except the bit you made up.',
    howTo: ['A true but weird story appears with one word missing.', 'Write a believable lie to fill the blank on your phone.', 'Find the truth among the fibs. Every friend you fool pays.'],
    players: { min: 3, max: 10 }, minutes: '12–16', tags: ['bluffing', 'trivia', 'writing'], accent: '#e0301e', intro: ['tall-tales.intro'],
  },
  {
    id: 'sketch-bluff', title: 'Sketch Bluff', tagline: 'Draw the truth. Title the lies.',
    howTo: ['Draw your secret, ridiculous prompt on your phone.', 'Everyone else forges a fake title for your masterpiece.', 'Spot the real title among the forgeries. Fool friends to score.'],
    players: { min: 3, max: 10 }, minutes: '10–15', tags: ['drawing', 'bluffing', 'writing'], accent: '#d9a93a', intro: ['sketch-bluff.intro'],
  },
  {
    id: 'shirt-show', title: 'Shirt Show', tagline: 'Draw it. Slogan it. Wear the belt.',
    howTo: ['Draw designs and write slogans on your phone.', 'Stitch other players’ designs and slogans into a shirt.', 'Shirts battle in the ring. The winner stays on to face the next.'],
    players: { min: 3, max: 10 }, minutes: '10–15', tags: ['drawing', 'writing', 'voting'], accent: '#ff3fae', intro: ['shirt-show.intro'],
  },
  {
    id: 'quiz-panic', title: 'Quiz Panic', tagline: 'Check in. Answer right. Try to check out.',
    howTo: ['Answer spooky trivia on your phone. Right answers pay cash.', 'Wrong answers visit the Panic Room. Fail and you become a ghost.', 'Race for the exit in the final. Ghosts can steal a body back!'],
    players: { min: 2, max: 10 }, minutes: '8–12', tags: ['trivia', 'survival', 'spooky'], accent: '#4ff0a0', intro: ['quiz-panic.intro'],
  },
  {
    id: 'odd-one-in', title: 'Odd One In', tagline: 'Everyone’s in on it. Except the faker.',
    howTo: ['Everyone gets a secret task on their phone. One faker gets nothing.', 'Answer, then act it out for real on 3. Fakers, copy the room!', 'Argue, then accuse. Most votes is accused; a tie lets the faker walk.'],
    players: { min: 3, max: 10 }, minutes: '9–14', tags: ['bluffing', 'acting', 'social'], accent: '#22c9c6', intro: ['odd-one-in.intro'],
  },
  {
    id: 'ballpark', title: 'Ballpark', tagline: 'How many of you have…? Only this room knows.',
    howTo: ['Answer a secret yes-or-no question on your phone. It’s anonymous.', 'One agent dials in what % of the room said yes.', 'Everyone else bets: higher or lower? The needle reveals the truth.'],
    players: { min: 3, max: 10 }, minutes: '8–13', tags: ['guessing', 'social', 'betting'], accent: '#ffb238', intro: ['ballpark.intro'],
  },
  {
    id: 'comment-section', title: 'Comment Section', tagline: 'You said it. They just added context.',
    howTo: ['Answer an innocent question about yourself on your phone.', 'Get a friend’s answer and a fake app. Write the context that ruins it.', 'The feed plays every post. Vote for the most ruinous one.'],
    players: { min: 3, max: 10 }, minutes: '9–13', tags: ['writing', 'comedy', 'voting'], accent: '#4d7cff', intro: ['comment-section.intro'],
  },
  {
    id: 'bracket-brawl', title: 'Bracket Brawl', tagline: 'Every answer gets a title shot.',
    howTo: ['Write an answer on your phone. It enters a knockout bracket.', 'Call the champion, then vote every matchup head-to-head.', 'Winners climb the bracket. Blind and Smackdown rounds twist the rules.'],
    players: { min: 3, max: 10 }, minutes: '8–13', tags: ['writing', 'voting', 'tournament'], accent: '#c8ff2e', intro: ['bracket-brawl.intro'],
  },
  {
    id: 'split-decision', title: 'Split Decision', tagline: 'Half the room says yes. That’s the whole trick.',
    howTo: ['Finish your own dilemma: “You can fly, but…” Fill in the catch.', 'Everyone else votes yes or no. Nobody votes on their own.', 'A perfect 50/50 split scores big. Unanimous scores nothing.'],
    players: { min: 3, max: 10 }, minutes: '6–12', tags: ['writing', 'voting', 'social'], accent: '#ffe23a', intro: ['split-decision.intro'],
  },
  {
    id: 'airlock', title: 'Airlock', tagline: 'Somebody aboard isn’t human. Push the button.',
    howTo: ['Answer quick crew tests on your phone. Aliens get a slightly different question.', 'Compare everyone’s answers on the big screen. Who doesn’t quite fit?', 'Push the red button on a suspect. Space every alien, but never a human!'],
    players: { min: 4, max: 10 }, minutes: '8–12', tags: ['social', 'bluffing', 'deduction'], accent: '#ff2d55', intro: ['airlock.intro'],
  },
];

export function miniInfo(id: string, catalog: readonly MiniInfo[] = MINIS): MiniInfo | undefined {
  return catalog.find(info => info.id === id);
}

export function eligible(info: MiniInfo, count: number): boolean {
  return count >= info.players.min && count <= info.players.max;
}
