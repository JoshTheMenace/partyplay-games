/**
 * Shared narrator lines (ids `host.*`), voiced by tools/narrate.ts. Static text only, no player names; ≤ 1,500 characters total.
 * Ids ending in `.1`, `.2`… are variants of one moment: say `variant('host.timeup', random)` to pick one.
 */
export const LINES: Record<string, string> = {
  'host.welcome': "Welcome to Hijinks! Phones out, egos in. Let's make some bad decisions together.",
  'host.pick': 'Pick a game on your phone. Majority rules. Democracy has never been this silly.',
  'host.pick.2': 'Vote for the next game. Choose wisely, or at least choose loudly.',
  'host.locked': 'Locked in! No take-backs.',
  'host.intro': "Right, here's how this one works.",
  'host.intro.2': 'Quick rundown. Try to keep up.',
  'host.everyone-in': "Everyone's in. Thank you for your promptness. Truly heroic.",
  'host.hurry.1': 'Ten seconds left! Type faster, think later.',
  'host.hurry.2': "Clock's ticking! Genius is optional. Finishing is not.",
  'host.timeup.1': "Time's up!",
  'host.timeup.2': "And that's time!",
  'host.pencils-down': 'Pencils down. Step away from the masterpiece.',
  'host.vote.1': 'Time to vote. Pick your favourite. Be honest. Be ruthless.',
  'host.vote.2': "Voting time! Remember, it's not personal. Unless it is.",
  'host.votes-in.1': 'The votes are in.',
  'host.votes-in.2': 'The people have spoken. Loudly.',
  'host.reveal.1': "Let's see how you did.",
  'host.reveal.2': 'Drumroll, please.',
  'host.winner.1': 'We have a winner!',
  'host.winner.2': 'And the crowd goes wild!',
  'host.tie': "It's a tie! Everybody wins, which means nobody does.",
  'host.no-votes': 'Nobody voted. Bold strategy.',
  'host.close': 'Ooh, that was close. Photo finish close.',
  'host.landslide': "A landslide! That wasn't a vote, that was a coronation.",
  'host.final-round': "Final round! Everything so far was just a warm-up.",
  'host.scores': "Let's check the scores.",
  'host.podium': "Here are your champions! Take a bow. Or don't, I'm not your boss.",
  'host.night-over': "That's the night! Thanks for playing Hijinks. You were all wonderful. Most of you.",
  'host.quip.1': 'Bold. Very bold.',
  'host.quip.2': "I've seen worse. Not often, but I have.",
  'host.quip.3': "Somebody's been practising.",
  'host.quip.4': 'Wow. Just... wow.',
};

/** Line ids grouped by moment: 'host.timeup' → ['host.timeup.1', 'host.timeup.2']; a plain id also heads its own group. */
export function variantsOf(lines: Record<string, string>): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const id of Object.keys(lines)) (groups[id.replace(/\.\d+$/, '')] ??= []).push(id);
  return groups;
}
export const VARIANTS = variantsOf(LINES);
/** A random line for a moment (or the id itself when it has no variants). Pass the minigame/pack seeded random. */
export function variant(moment: string, random: () => number, groups: Record<string, string[]> = VARIANTS): string {
  const ids = groups[moment] ?? [moment];
  return ids[Math.min(ids.length - 1, Math.floor(random() * ids.length))];
}
