/** Card IDs 1–24 in color groups of three, matching the original hopehendricks.com deck. */
export const COLOR_GROUPS = {
  blue: [1, 2, 3], brown: [4, 5, 6], green: [7, 8, 9], orange: [10, 11, 12],
  purple: [13, 14, 15], red: [16, 17, 18], white: [19, 20, 21], yellow: [22, 23, 24],
} as const;
export type Color = keyof typeof COLOR_GROUPS;
export const COLOR_HEX: Record<Color, string> = {
  blue: '#3b82f6', brown: '#b45309', green: '#16a34a', orange: '#f97316',
  purple: '#a855f7', red: '#dc2626', white: '#e5e7eb', yellow: '#facc15',
};
const cards = [
  ['blue_crab_claw', 'crab claw'], ['blue_fish', 'fish'], ['blue_shrimp', 'shrimp'],
  ['brown_bacon', 'bacon'], ['brown_noodles', 'noodles'], ['brown_squid', 'squid'],
  ['green_bok_choy', 'bok choy'], ['green_cabbage', 'cabbage'], ['green_onion', 'onion'],
  ['orange_cauliflower', 'cauliflower'], ['orange_garlic', 'garlic'], ['orange_prawn', 'prawn'],
  ['purple_bmushroom', 'blue mushroom'], ['purple_mushroom_cluster', 'mushroom cluster'], ['purple_rmushroom', 'red mushroom'],
  ['red_beef', 'beef'], ['red_mutton', 'mutton'], ['red_sausage_roll', 'sausage roll'],
  ['white_fish_cake', 'fish cake'], ['white_oyster', 'oyster'], ['white_tofu', 'tofu'],
  ['yellow_carrot', 'carrot'], ['yellow_corn', 'corn'], ['yellow_potato', 'potato'],
] as const;
export const cardFile = (id: number | null) => id === null ? 'card_back' : cards[id - 1][0];
export const cardName = (id: number) => cards[id - 1][1];
export const colorOf = (id: number) => (Object.keys(COLOR_GROUPS) as Color[])[Math.floor((id - 1) / 3)];
