// Big-endian bit fields: melee/lb/types.h spawn_hitbox_0..4.
// Spatial scale and x/z swizzle: ftAction_8007121C in melee/ft/ftaction.c.
// Returns command parameters only; bone transforms and collision resolution remain separate.
const f = Math.fround;
export function commandBytes(hex: string): Uint8Array {
  if (!/^(?:[\da-f]{2})+$/i.test(hex)) throw new Error('Invalid command hex');
  return Uint8Array.from(hex.match(/../g)!, byte => parseInt(byte, 16));
}
export function decodeHitbox(hex: string) {
  const bytes = commandBytes(hex);
  if (bytes.length !== 20 || bytes[0] >>> 2 !== 11) throw new Error('Expected a 20-byte spawn-hitbox command');
  const d = new DataView(bytes.buffer), a = d.getUint32(0), b = d.getUint32(12), c = d.getUint32(16);
  const spatial = (value: number) => f(f(.003906) * value);
  return {
    id: a >>> 23 & 7, group: a >>> 20 & 7, onlyHitGrabbed: !!(a >>> 19 & 1),
    bone: a >>> 11 & 255, commonBoneIds: !!(a >>> 10 & 1), damage: a & 1023,
    size: spatial(d.getUint16(4)), offset: { x: spatial(d.getInt16(6)), y: spatial(d.getInt16(8)), z: spatial(d.getInt16(10)) },
    angle: b >>> 23, growth: b >>> 14 & 511, weightSetKnockback: b >>> 5 & 511,
    itemInteraction: !!(b & 16), ignoreThrown: !!(b & 8), ignoreScale: !!(b & 4), clank: !!(b & 2), rebound: !!(b & 1),
    baseKnockback: c >>> 23, element: c >>> 18 & 31, shieldDamage: (c >>> 10 & 255) << 24 >> 24,
    sfxSeverity: c >>> 7 & 7, sfxKind: c >>> 2 & 31, hitGrounded: !!(c & 2), hitAirborne: !!(c & 1),
  };
}
