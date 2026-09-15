/* The wardrobe.
 *
 * Seventeen suits, exactly the set the sprite atlas actually contains. Upstream
 * prices them on a ladder and gates several behind depth, crystals and level —
 * that is meta-progression, which this build removes, so here they are simply
 * all available and the choice is a choice rather than a reward.
 *
 * `swatch` is the mid step of each suit's colour ramp. It is what the schematic
 * renderer draws a digger in today; when the atlas is ported the same `id`
 * selects the real sprite and the swatch goes back to being what it was built
 * for, which is drawing a colour chip without loading the sheet.
 *
 * Browser-safe: the picker imports this directly rather than having the list
 * sent over the wire, because it never changes during a round.
 */

export type Suit = {
  id: string;
  /** Mid step of the suit's ramp, and the digger's colour until the art lands. */
  swatch: string;
  /** What the suit actually looks like. Shown under the chip in the picker. */
  note: string;
};

export const SUITS: readonly Suit[] = Object.freeze([
  { id: 'cobalt', swatch: '#4376bd', note: 'survey blue, brass boots' },
  { id: 'moss', swatch: '#41c983', note: 'lichen green' },
  { id: 'bone', swatch: '#fff5d8', note: 'bleached ceramic over a dark helmet' },
  { id: 'void', swatch: '#594a62', note: 'deep-shift black' },
  { id: 'pressure', swatch: '#616c7a', note: 'heavy pressure suit, caged visor' },
  { id: 'salvage', swatch: '#c0b7ad', note: 'salvaged patchwork rig and a whip aerial' },
  { id: 'cinder', swatch: '#ffae2b', note: 'burnt black shell, a furnace behind the glass' },
  { id: 'amethyst', swatch: '#a55ce5', note: 'deep violet, pale helmet' },
  { id: 'orchid', swatch: '#df67c8', note: 'magenta-violet with brass fittings' },
  { id: 'plum', swatch: '#a04a77', note: 'wine purple over brass' },
  { id: 'heather', swatch: '#b9a6ce', note: 'soft grey-purple, cloth rather than shell' },
  { id: 'tangerine', swatch: '#ff8f30', note: 'saturated orange under a white helmet' },
  { id: 'glacier', swatch: '#bef6ff', note: 'pale ice blue and chrome' },
  { id: 'rust', swatch: '#bc683d', note: 'oxide red-brown, scuffed' },
  { id: 'mustard', swatch: '#e5bc43', note: 'ochre canvas, dark boots' },
  { id: 'verdigris', swatch: '#51c0a5', note: 'oxidised copper over brass' },
  { id: 'carbon', swatch: '#2b2b30', note: 'matte black, red visor' },
]);

export const SUIT_BY_ID: Readonly<Record<string, Suit>> = Object.freeze(
  Object.fromEntries(SUITS.map(s => [s.id, s])));

export function isSuit(id: unknown): id is string {
  return typeof id === 'string' && Object.hasOwn(SUIT_BY_ID, id);
}

/* The fallback for anyone who says nothing before the drill starts.
 *
 * Keyed off seat order rather than picked at random so it is stable across a
 * reconnect, and so two silent diggers never end up in the same suit — which on
 * a schematic renderer would make them the same square. */
export function defaultSuit(seatIndex: number): string {
  return SUITS[seatIndex % SUITS.length].id;
}
