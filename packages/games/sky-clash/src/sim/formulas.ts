/**
 * Melee combat formulas. Structure and constants follow the Melee decompilation's knockback path (ftcommon.c /
 * ftcoll.c helpers and the PlCo common-data constants they read). The pinned research checkout was empty when this
 * was written, so the constants below are the widely documented Melee values rather than a fresh source read:
 * 1.4, 18, weight 200/(w+100), set-knockback percent 10, hitstun ×0.4, launch ×0.03, decay 0.051/frame,
 * tumble at 80, Sakurai angle 361 (air 45°, ground 0° below 32 knockback, else 44°), DI 18°, hitlag d/3+3
 * (electric ×1.5, crouch ×2/3, cap 20), crouch-cancel knockback ×2/3, shieldstun (d+4.45)×0.447, the 9-slot stale
 * queue and 1.367× full smash charge. Knockback units are Melee units; callers convert speeds with UNIT.
 */
export const KB_CAP = 2500, HITSTUN = .4, LAUNCH = .03, DECAY = .051, TUMBLE = 80, DI_MAX = 18, SDI = 6, ASDI = 3, HITLAG_CAP = 20;
export const CHARGE_FRAMES = 60, CHARGE_MAX = 1.367, SHIELD_MAX = 100, SHIELD_SCALE = 100 / 60;
/** Shield loses 0.28/frame held and regains 0.07/frame released on Melee's 60-point scale. */
export const SHIELD_DRAIN = .28 * SHIELD_SCALE, SHIELD_REGEN = .07 * SHIELD_SCALE;
const STALE = [.09, .08, .07, .06, .05, .04, .03, .02, .01];

/** Melee knockback. `percent` is the target's damage after this hit; `damage` the (staled) hit damage; `setKb` weight-dependent set knockback. */
export function knockback(percent: number, damage: number, weight: number, base: number, growth: number, setKb = 0): number {
  const p = setKb ? 10 : percent, d = setKb || damage;
  const kb = ((p / 10 + p * d / 20) * (200 / (weight + 100)) * 1.4 + 18) * (growth / 100) + base;
  return Math.min(KB_CAP, Math.max(0, kb));
}
export const hitstunFrames = (kb: number) => Math.floor(kb * HITSTUN);
export const hitlagFrames = (damage: number, electric = false, crouch = false) =>
  Math.min(HITLAG_CAP, Math.floor((damage / 3 + 3) * (electric ? 1.5 : 1) * (crouch ? 2 / 3 : 1)));
export const shieldstunFrames = (damage: number) => Math.floor((damage + 4.45) * .447);
/** Resolve angle 361 and convert a facing-relative angle to world degrees. */
export function launchAngle(angle: number, kb: number, grounded: boolean, dir: 1 | -1): number {
  const a = angle === 361 ? (grounded ? (kb < 32 ? 0 : 44) : 45) : angle;
  return dir === 1 ? a : 180 - a;
}
/** Trajectory DI: the stick component perpendicular to the launch rotates it by up to 18°. Below Melee's 0.2875 deadzone nothing changes. */
export function applyDI(angleDeg: number, sx: number, sy: number): number {
  const mag = Math.hypot(sx, sy); if (mag < .2875) return angleDeg;
  const a = angleDeg * Math.PI / 180, scale = Math.min(1, mag) / mag, perp = (-sx * Math.sin(a) + sy * Math.cos(a)) * scale;
  return angleDeg + DI_MAX * perp;
}
/** Damage multiplier from the last nine connecting moves (most recent first). */
export const staleness = (queue: readonly string[], move: string) => 1 - queue.reduce((sum, m, i) => sum + (m === move ? STALE[i]! : 0), 0);
export const chargeMultiplier = (frames: number) => 1 + (CHARGE_MAX - 1) * Math.min(1, frames / CHARGE_FRAMES);
/** Reconstructed: shield damage is hit damage plus the hitbox's shield bonus, on the 100-point scale. */
export const shieldDamage = (damage: number, bonus = 0) => Math.max(0, damage + bonus) * SHIELD_SCALE;
/** Reconstructed grab hold: longer at higher damage; each mash input removes MASH frames. */
export const grabFrames = (percent: number) => Math.min(300, Math.floor(90 + percent * 1.5));
export const MASH = 6;
