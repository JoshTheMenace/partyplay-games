/** Strict input validation helpers. Messages are short and player-facing. */
export function record(raw: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw new Error('Expected an object.');
  if (allowed && Object.keys(raw).some(key => !allowed.includes(key))) throw new Error('Unknown field.');
  return raw as Record<string, unknown>;
}

export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Expected a whole number from ${min} to ${max}.`);
  return value;
}

export function text(value: unknown, max: number, what = 'Text'): string {
  if (typeof value !== 'string' || !value.length || value.length > max) throw new Error(`${what} must be 1–${max} characters.`);
  return value;
}

export function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${what} must be on or off.`);
  return value;
}
