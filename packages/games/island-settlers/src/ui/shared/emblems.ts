/** Seat emblems (EXPERIENCE §1.6): filled 24×24 SVG paths, drawn in ink inside a seat-coloured chip. */
export type EmblemId = 'triangle' | 'circle' | 'square' | 'diamond' | 'star'
  | 'heart' | 'wave' | 'bolt' | 'crescent' | 'cross';

/** Palette order: index = PublicSeat.seat. */
export const EMBLEMS: readonly EmblemId[] = [
  'triangle', 'circle', 'square', 'diamond', 'star', 'heart', 'wave', 'bolt', 'crescent', 'cross',
];

export const EMBLEM_NAMES: Record<EmblemId, string> = {
  triangle: 'Triangle', circle: 'Circle', square: 'Square', diamond: 'Diamond', star: 'Star',
  heart: 'Heart', wave: 'Wave', bolt: 'Bolt', crescent: 'Crescent', cross: 'Cross',
};

export const EMBLEM_PATHS: Record<EmblemId, string> = {
  triangle: 'M12 3 21.5 20H2.5Z',
  circle: 'M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 1 0-17 0Z',
  square: 'M4 4h16v16H4Z',
  diamond: 'M12 2 22 12 12 22 2 12Z',
  star: 'M12 2.8 14.5 9.3 21.5 9.7 16.1 14.1 17.9 20.9 12 17.1 6.1 20.9 7.9 14.1 2.5 9.7 9.5 9.3Z',
  heart: 'M12 21C6.5 17.4 2.5 13.8 2.5 9.3A5 5 0 0 1 12 6.8a5 5 0 0 1 9.5 2.5c0 4.5-4 8.1-9.5 11.7Z',
  wave: 'M2 7.6c3.3-3 6.7-3 10 0s6.7 3 10 0v4c-3.3 3-6.7 3-10 0s-6.7-3-10 0Z'
    + 'M2 15.4c3.3-3 6.7-3 10 0s6.7 3 10 0v4c-3.3 3-6.7 3-10 0s-6.7-3-10 0Z',
  bolt: 'M14 1.5 4 13.5h6.5L9 22.5l11-13h-6.6Z',
  crescent: 'M15 2.6A9.7 9.7 0 1 0 21.6 16 7.8 7.8 0 0 1 15 2.6Z',
  cross: 'M9 2.5h6v6.5h6.5v6H15v6.5H9V15H2.5V9H9Z',
};
