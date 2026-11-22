/* Big rooms. Up to ten players every screen can name and show everyone; above that the pack groups, samples and summarises. Client-safe. */

/** The largest roster the original ten-seat layouts and round structures were built for. */
export const COSY = 10;
/** True when a roster needs the big-room rules and layouts. */
export const isCrowd = (players: number) => players > COSY;
