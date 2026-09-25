/** EXPERIENCE §4.5 vibration patterns (ms). Android only; iOS hears the cue alone. */
export const HAPTICS = {
  turn: [30, 60, 30],
  production: 15,
  robbed: 80,
  trade: [20, 40, 20],
  warning: 10,
} as const satisfies Record<string, number | readonly number[]>;

export type HapticKind = keyof typeof HAPTICS;

export function haptic(kind: HapticKind) {
  if (typeof navigator === 'undefined' || typeof document === 'undefined' || document.hidden) return;
  const pattern = HAPTICS[kind];
  try { navigator.vibrate?.(typeof pattern === 'number' ? pattern : [...pattern]); } catch { /* Blocked. */ }
}
