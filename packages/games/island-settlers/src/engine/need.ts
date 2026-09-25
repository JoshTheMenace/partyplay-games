/** Assert with a player-readable reason (port of legacy `need`). A failed need rejects the whole action. */
export function need(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}
