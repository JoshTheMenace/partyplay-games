export function assertSerializable(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error('Message nesting is too deep.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) assertSerializable(item, depth + 1); return; }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) { for (const item of Object.values(value)) assertSerializable(item, depth + 1); return; }
  throw new Error('Message contains a non-serializable value.');
}
