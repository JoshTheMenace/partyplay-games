/* Crews: how a room is split, and what each crew is called.
 *
 * Browser-safe. The server splits the roster with `crewSizes`, and every screen
 * names and colours a crew from the same table, so neither has to be sent.
 *
 * A crew is at most four because four is what one shaft was tuned for: the
 * shaft widens with its crew and so does everything in it. A bigger room is
 * several crews, each in a shaft of its own, digging the same ground against
 * each other.
 */

/** Sixteen, which is a full room of four-digger crews. Above ten the colours
 *  start to rhyme, so every surface shows the name or the number with it. */
export const CREWS: readonly { name: string; color: string }[] = Object.freeze([
  { name: 'Canaries', color: '#ffd24a' },
  { name: 'Magpies', color: '#28c6e7' },
  { name: 'Sparks', color: '#ff5748' },
  { name: 'Rivets', color: '#78d955' },
  { name: 'Badgers', color: '#b58aff' },
  { name: 'Lanterns', color: '#ff9a3c' },
  { name: 'Winches', color: '#ff8ac0' },
  { name: 'Pulleys', color: '#4fe0c5' },
  { name: 'Chisels', color: '#9fb4ff' },
  { name: 'Shovels', color: '#e3f08a' },
  { name: 'Hardhats', color: '#ffb38a' },
  { name: 'Bellows', color: '#d9a066' },
  { name: 'Flints', color: '#8fd3ff' },
  { name: 'Anvils', color: '#c9c2d6' },
  { name: 'Pickaxes', color: '#e07a4a' },
  { name: 'Hoppers', color: '#6fd08c' },
]);

export const crewOf = (index: number) => CREWS[((index % CREWS.length) + CREWS.length) % CREWS.length];

/* How many diggers each crew gets: as few crews as the size allows, and as even
 * as they can be made, so nine diggers at four to a crew dig as three threes
 * rather than as four, four and one. Seats fill in roster order, which keeps
 * people who joined together in the same shaft. */
export function crewSizes(players: number, size: number): number[] {
  const n = Math.max(1, players | 0);
  const crews = Math.ceil(n / Math.max(1, size | 0));
  const base = Math.floor(n / crews), extra = n % crews;
  return Array.from({ length: crews }, (_, i) => base + (i < extra ? 1 : 0));
}

/** 1st, 2nd, 3rd, 4th… for a zero-based place. */
export function ordinal(place: number) {
  const n = place + 1, t = n % 100;
  return n + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
}
