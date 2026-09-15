/* Everything that moves: player, monsters, rocks, harpoon, fire, pickups,
 * particles and popups — plus the three passes that hang off them: animation
 * (anim.js), the effect layer (vfx.js) and the lamp (light.js).
 *
 * Drawing only. Never mutates state, never reads input, knows no rules.
 *
 * Every actor has the same shape — a sprite fast path guarded by
 * sprites.has(), falling through to a procedural silhouette. The fallback is
 * deliberately kept: the sheet is fetched, and a cold offline first launch is
 * exactly when a fetch is least likely to succeed. It is a silhouette, not a
 * second renderer — flat shapes, no animation — because maintaining two full
 * renderers for seven animated monsters is not affordable.
 *
 * ── seven kinds, seven silhouettes ────────────────────────────────────────
 *
 * This file used to branch on `m.kind === 'fygar'` and fall through to
 * drawPooka, so five of the seven kinds rendered as Pookas. Two of them cannot
 * survive that, because their silhouette IS the mechanic:
 *
 *   GEODE   is harpoonImmune. The only thing that kills it is a rock dropped on
 *           it, and the only warning the player gets is the clang. It has to
 *           look like something a harpoon would bounce off before you fire —
 *           so: no soft edges anywhere, a faceted mineral shell, hard specular
 *           highlights and a visible chip line. Nothing round, nothing soft.
 *   WARDEN  is `blocking`: solid to the player and to pathing, exactly like a
 *           boulder. Walking into one stops you dead, and a Pooka-shaped thing
 *           that stops you dead reads as a bug. So it is drawn as MASONRY that
 *           fills its cell corner to corner — square, bevelled, studded, with a
 *           visor rather than eyes. The absence of rounding is the message.
 *
 * The other three are read at a glance: the Mite is small, red and spiky (one
 * pump, fastest thing in the game), the Sapper carries a lit fuse, and the Grub
 * is a segmented digger with mandibles.
 *
 * ── why the render-rate clock lives here ──────────────────────────────────
 *
 * view.js hands this module a clock through setClock() for the hunter ring, and
 * the harness pins it. That same clock is the ONLY time source anim.js, vfx.js
 * and light.js see: they are ticked from here with the delta between two calls
 * to it. Nothing in the animation chain ever touches Date.now() or
 * performance.now() directly, which is what keeps two capture runs identical.
 */

import { GRID, TUNE, DX, DY } from './worldgen';
import type {
  Ctx, EntityView, Palette, RenderState, ViewBonus, ViewBox, ViewFire,
  ViewHarpoon, ViewMonster, ViewPlayer, ViewRock, ViewWheel,
} from './render';
import type { ClipCtx, Drawable } from './anim';
import { FALLBACK_PALETTE } from './palette';
import * as perf from './perf';
import * as sprites from './sprites';
import * as anim from './anim';
import * as vfx from './vfx';
import * as light from './light';
import { COOP } from './tuning';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* What actor() can place and animate: anything with a position and a previous
 * position. Deliberately structural — diggers, monsters, rocks and wheels all
 * satisfy it and none of them share a base type. */
type ActorEntity = Drawable & { x: number; y: number; px?: number; py?: number };

/** Per-call overrides for one actor's blit. */
type ActorOpts = {
  /** Whole-sprite opacity, for ghosts and fading corpses. */
  alpha?: number;
  /** Pumps landed, which swells the silhouette. */
  pump?: number;
  /** Radians about the sprite centre, for a digger lying on the floor. */
  angle?: number;
};

/** A procedural silhouette: drawn at the origin, `s` cells across. */
type Silhouette<E> = (g: Ctx, e: E, s: number) => void;

/* View transform, set once per frame by view.js. `top` is the first visible
 * fine row — the camera. */
let V = { ox: 0, oy: 0, scale: 1, top: 0 };
/* The authored colours until view.js hands over the document's own. Never
 * null: the bestiary draws silhouettes with no field renderer mounted, and
 * every one of them reads a colour off this. */
let P: Palette = FALLBACK_PALETTE;
let clock: () => number = () => Date.now();
let lastClock: number | null = null;
let seenWorld: string | null = null;
let seenSerial = -1;
let drillT = 0;
let renderT = 0;

export function setClock(fn: (() => number) | null) {
  clock = fn || (() => Date.now());
  lastClock = null;
}
export function setView(v: EntityView, palette: Palette) { V = v; P = palette; }

/* Which biome's art to prefer. Set from view.js alongside terrain.reset, and
 * used only by the boulder — everything else an actor draws is the same object
 * in every biome, where a boulder is made of the ground it was quarried from. */
let themeId: string | null = null;
export function setTheme(id: string | null) { themeId = id || null; }

/* The themed frame if the sheet has it, the bare one otherwise — the same
 * fallback terrain.js uses, so a theme the generator knows and the sheet does
 * not still draws rather than vanishing. */
function themedFrame(kind: string) {
  const t = themeId ? themeId + '.' + kind : null;
  return t && sprites.has(t) ? t : kind;
}

const sx = (x: number) => V.ox + x * V.scale;
const sy = (y: number) => V.oy + (y - V.top) * V.scale;

/* A variant's body colour, or the kind's own when it is the plain kind.
 *
 * monsters.js has always put a variant's `tint` on the instance, and for a long
 * time NOTHING in the view read it: variants were told apart purely by having
 * their own rows on the sprite sheet. That silently fails for any kind the
 * generator has not drawn yet — every variant of it renders pixel-for-pixel as
 * the base kind, so a Hammerhead was a Shark with different numbers and no way
 * to know before it was on you, which is the opposite of what a variant is for.
 *
 * The sheet has since grown Shark and Mole rows, so that is no longer WHY this
 * exists — but the fallback path still has to be right, because it is what
 * every new kind gets before the generator catches up, and what every kind gets
 * on a cold offline first launch before the atlas has loaded.
 *
 * Used by the procedural silhouettes only. A kind WITH sheet art still gets its
 * proper tinted frames and must not be recoloured on top of them. */
function bodyTint(m: { tint?: string | null } | null, base: string) {
  return (m && m.tint) || base;
}

function drawRoundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
  g.fill();
}

/* ── the actor frame ──────────────────────────────────────────────────────
 *
 * One place decides what an actor's animation frame is and how squashed it is,
 * so a new kind is a fallback function and nothing else. Returns the anim
 * descriptor either way — the squash applies to the procedural silhouette too,
 * which is the one animated thing the fallback path gets. */
function actor<E extends ActorEntity>(
  g: Ctx, e: E, alpha: number, ctx: ClipCtx,
  fallback: Silhouette<E>, opts?: ActorOpts,
) {
  const o = opts || {};
  const x = sx(lerp(e.px === undefined ? e.x : e.px, e.x, alpha));
  const y = sy(lerp(e.py === undefined ? e.y : e.py, e.y, alpha));
  const s = 2 * V.scale;
  const fr = anim.frame(e, ctx);
  const swellSprite = 1 + (o.pump || 0) * 0.08;
  const swellFlat = 1 + (o.pump || 0) * 0.2;

  g.save();
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  // Squash and stretch is applied about the sprite CENTRE, which is why the
  // translate happens before the scale and the blit is offset by -s/2 rather
  // than being drawn from its corner.
  g.translate(x + s / 2, y + s / 2);
  if (o.angle) g.rotate(o.angle);

  let drawn = false;
  if (fr && sprites.ready()) {
    g.save();
    g.scale(fr.sx * swellSprite, fr.sy * swellSprite);
    drawn = sprites.draw(g, fr.name, -s / 2, -s / 2, s, s);
    g.restore();
  }
  if (!drawn) {
    const qx = fr ? fr.sx : 1, qy = fr ? fr.sy : 1;
    g.scale(qx * swellFlat, qy * swellFlat);
    fallback(g, e, s);
  }
  g.restore();
}

/* ── player ───────────────────────────────────────────────────────────── */

function playerFlat(g: Ctx, p: ViewPlayer, s: number) {
  if (p.dying) g.rotate((1 - p.dyingT / TUNE.DEATH_TIME) * Math.PI * 2);

  g.fillStyle = P.player;
  drawRoundRect(g, -s * 0.42, -s * 0.42, s * 0.84, s * 0.84, s * 0.22);

  // Suit stripe and visor, oriented so facing is readable at a glance.
  g.fillStyle = P.playerAccent;
  drawRoundRect(g, -s * 0.42, -s * 0.06, s * 0.84, s * 0.26, s * 0.06);

  const fx = p.dir === 1 ? 1 : p.dir === 3 ? -1 : 0;
  const fy = p.dir === 2 ? 1 : p.dir === 0 ? -1 : 0;
  g.fillStyle = '#2a3550';
  drawRoundRect(g, -s * 0.26 + fx * s * 0.1, -s * 0.34 + fy * s * 0.06,
                s * 0.52, s * 0.24, s * 0.1);
}

/* One digger. Takes the digger rather than the state, because a co-op shaft has
 * up to four of them and each carries its own harpoon and its own suit. */
function drawPlayer(g: Ctx, p: ViewPlayer, alpha: number) {
  // Blink while invulnerable, but stay visible more than half the time so the
  // player never loses track of where they are.
  if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 1) return;

  /* DOWN reads as down. Drawn standing, a downed digger looked exactly like one
   * waiting for a teammate, which is the one thing a rescuer has to be able to
   * tell at a glance.
   *
   * With the sheet: 'down' plays once and leaves the suit flat on the floor,
   * then 'inflate' takes over with banked pumps as its frame — each pump puffs
   * them up, and they sag back if the line comes off. The first pump cuts the
   * fall short, because a rescuer already pumping needs to see it land. Without
   * those clips (the sheet still loading) the old read holds: on their side and
   * dimmed. */
  if (p.downed) {
    const down = sprites.ready() ? sprites.CLIPS['player.down.R'] : undefined;
    if (down) {
      const settled = p.reviveProgress > 0 || COOP.DOWN_WINDOW - p.downT >= down.frames.length / down.fps;
      actor(g, p, alpha, { firing: false, phase: settled ? p.reviveProgress : null }, playerFlat,
            { alpha: p.reviveProgress > 0 ? 1 : 0.85 });
    } else {
      actor(g, p, alpha, { firing: false }, playerFlat,
            { alpha: 0.72, angle: p.dir === 3 ? -Math.PI / 2 : Math.PI / 2 });
    }
    light.add(lerp(p.px, p.x, alpha) + 1, lerp(p.py, p.y, alpha) + 1.2,
              1.6, P.harpoon, 0.22);
    return;
  }

  const h = p.harpoon;
  const firing = !!(h && h.active && h.state !== 'back');
  actor(g, p, alpha, { firing }, playerFlat, {});

  /* The helmet lamp has a source. Small and warm, sitting on the player rather
   * than centred on them, so the light reads as coming FROM the helmet. */
  light.add(lerp(p.px, p.x, alpha) + 1, lerp(p.py, p.y, alpha) + 0.7,
            2.6, P.harpoon, 0.5);
}

/* ── monsters ─────────────────────────────────────────────────────────── */

function pookaFlat(g: Ctx, m: ViewMonster, s: number) {
  g.fillStyle = P.pooka;
  g.beginPath();
  g.arc(0, 0, s * 0.42, 0, Math.PI * 2);
  g.fill();

  // The goggles are the whole silhouette at this size, so draw them big.
  const gx = m.dir === 1 ? s * 0.06 : m.dir === 3 ? -s * 0.06 : 0;
  g.fillStyle = P.pookaEye;
  g.beginPath();
  g.arc(gx - s * 0.15, -s * 0.05, s * 0.15, 0, Math.PI * 2);
  g.arc(gx + s * 0.15, -s * 0.05, s * 0.15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a1410';
  g.beginPath();
  g.arc(gx - s * 0.13, -s * 0.05, s * 0.07, 0, Math.PI * 2);
  g.arc(gx + s * 0.17, -s * 0.05, s * 0.07, 0, Math.PI * 2);
  g.fill();
}

function fygarFlat(g: Ctx, m: ViewMonster, s: number) {
  const face = m.dir === 3 ? -1 : 1;
  g.scale(face, 1);

  g.fillStyle = P.fygar;
  drawRoundRect(g, -s * 0.44, -s * 0.34, s * 0.8, s * 0.68, s * 0.18);
  g.fillStyle = P.fygarBelly;
  drawRoundRect(g, -s * 0.3, s * 0.02, s * 0.5, s * 0.24, s * 0.08);

  // Snout, so "which way is it facing" is legible before it breathes.
  g.fillStyle = P.fygar;
  drawRoundRect(g, s * 0.28, -s * 0.2, s * 0.2, s * 0.22, s * 0.06);
  g.fillStyle = '#1a1410';
  g.beginPath();
  g.arc(s * 0.2, -s * 0.16, s * 0.07, 0, Math.PI * 2);
  g.fill();
}

/* The Mite: one pump, and the fastest thing in the game at MON_SPEED * 1.6.
 * Small and angular, so a swarm of them reads as a swarm rather than as a group
 * of undersized Pookas. */
function miteFlat(g: Ctx, m: ViewMonster, s: number) {
  const face = m.dir === 3 ? -1 : 1;
  g.scale(face, 1);
  const r = s * 0.27;

  g.strokeStyle = P.danger;
  g.lineWidth = Math.max(1, s * 0.07);
  g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
    g.lineTo(Math.cos(a) * r * 1.9, Math.sin(a) * r * 1.9);
    g.stroke();
  }

  g.fillStyle = P.danger;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = P.pookaEye;
  g.beginPath();
  g.arc(r * 0.35, -r * 0.2, r * 0.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a1410';
  g.beginPath();
  g.arc(r * 0.45, -r * 0.2, r * 0.2, 0, Math.PI * 2);
  g.fill();
}

/* The Sapper: it is carrying the bang. A drum of charges and a lit fuse, so the
 * thing that goes off is visible before it goes off. */
function sapperFlat(g: Ctx, m: ViewMonster, s: number) {
  const face = m.dir === 3 ? -1 : 1;
  g.scale(face, 1);

  g.fillStyle = P.rockShade;
  drawRoundRect(g, -s * 0.38, -s * 0.22, s * 0.76, s * 0.6, s * 0.1);
  g.fillStyle = P.rock;
  drawRoundRect(g, -s * 0.32, -s * 0.16, s * 0.64, s * 0.2, s * 0.06);

  // Banding, so it reads as a barrel rather than a rock.
  g.fillStyle = P.fire;
  g.fillRect(-s * 0.38, s * 0.02, s * 0.76, s * 0.07);

  g.fillStyle = P.pookaEye;
  g.beginPath();
  g.arc(s * 0.12, s * 0.2, s * 0.08, 0, Math.PI * 2);
  g.arc(-s * 0.12, s * 0.2, s * 0.08, 0, Math.PI * 2);
  g.fill();

  // The fuse, lit.
  g.strokeStyle = P.rockShade;
  g.lineWidth = Math.max(1, s * 0.05);
  g.beginPath();
  g.moveTo(0, -s * 0.22);
  g.quadraticCurveTo(s * 0.12, -s * 0.36, s * 0.04, -s * 0.44);
  g.stroke();
  g.fillStyle = P.fire;
  g.beginPath();
  g.arc(s * 0.04, -s * 0.46, s * 0.08, 0, Math.PI * 2);
  g.fill();
}

/* The Warden: a wall that walks.
 *
 * It fills its cell CORNER TO CORNER with no rounding anywhere, because the one
 * thing the player has to learn about it is that they cannot walk through it —
 * and the shape of a boulder is the vocabulary this game already uses for that.
 * Bevel light from the top-left, shadow bottom-right, studs at the corners, and
 * a visor slit instead of eyes. */
function wardenFlat(g: Ctx, m: ViewMonster, s: number) {
  const h = s * 0.5;

  g.fillStyle = P.rockShade;
  g.fillRect(-h, -h, s, s);
  g.fillStyle = P.rock;
  g.fillRect(-h, -h, s * 0.94, s * 0.94);
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(-h, -h, s, s * 0.1);
  g.fillRect(-h, -h, s * 0.1, s);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(-h, h - s * 0.12, s, s * 0.12);
  g.fillRect(h - s * 0.12, -h, s * 0.12, s);

  // Course lines: masonry, not a metal box.
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(-h, -s * 0.08, s, Math.max(1, s * 0.045));
  g.fillRect(-s * 0.02, -s * 0.08, Math.max(1, s * 0.045), s * 0.58);

  // Studs.
  g.fillStyle = P.rockShade;
  const st = s * 0.07;
  for (const [ax, ay] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.beginPath();
    g.arc(ax * (h - st * 1.6), ay * (h - st * 1.6), st, 0, Math.PI * 2);
    g.fill();
  }

  // The visor. Faces the way it walks so a Warden coming at you is readable.
  const gx = m.dir === 1 ? s * 0.08 : m.dir === 3 ? -s * 0.08 : 0;
  g.fillStyle = '#1a1410';
  g.fillRect(-s * 0.28 + gx, -s * 0.3, s * 0.56, s * 0.14);
  g.fillStyle = P.danger;
  g.fillRect(-s * 0.22 + gx, -s * 0.27, s * 0.16, s * 0.08);
  g.fillRect(s * 0.06 + gx, -s * 0.27, s * 0.16, s * 0.08);
}

/* The Geode: the harpoon bounces off this.
 *
 * Every edge is straight, every highlight is hard. A round silhouette would
 * invite a shot; a mineral one says "drop something on it". The chip line
 * across the top-left facet is there so it reads as already-struck stone. */
function geodeFlat(g: Ctx, m: ViewMonster, s: number) {
  const h = s * 0.48;
  const shell = [
    [-0.86, -0.34], [-0.42, -0.92], [0.4, -0.94], [0.9, -0.3],
    [0.72, 0.62], [-0.1, 0.96], [-0.8, 0.56],
  ];
  g.beginPath();
  for (let i = 0; i < shell.length; i++) {
    const p = shell[i];
    if (i === 0) g.moveTo(p[0] * h, p[1] * h); else g.lineTo(p[0] * h, p[1] * h);
  }
  g.closePath();
  g.fillStyle = P.rockShade;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = Math.max(1, s * 0.05);
  g.stroke();

  // Facets, cut across the shell.
  g.fillStyle = P.rock;
  g.beginPath();
  g.moveTo(-0.86 * h, -0.34 * h);
  g.lineTo(-0.42 * h, -0.92 * h);
  g.lineTo(-0.12 * h, -0.2 * h);
  g.lineTo(-0.6 * h, 0.16 * h);
  g.closePath();
  g.fill();

  // The crystal core: the ore this thing is sitting on, showing through.
  g.fillStyle = P.ore;
  g.beginPath();
  g.moveTo(0.1 * h, -0.42 * h);
  g.lineTo(0.62 * h, -0.04 * h);
  g.lineTo(0.34 * h, 0.56 * h);
  g.lineTo(-0.16 * h, 0.3 * h);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.moveTo(0.1 * h, -0.42 * h);
  g.lineTo(0.62 * h, -0.04 * h);
  g.lineTo(0.36 * h, 0.02 * h);
  g.closePath();
  g.fill();

  // Chip line — struck before, and it held.
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = Math.max(1, s * 0.035);
  g.beginPath();
  g.moveTo(-0.7 * h, -0.1 * h);
  g.lineTo(-0.3 * h, -0.5 * h);
  g.stroke();
}

/* The Grub: it does not use your tunnels, it makes its own. Segmented, with
 * mandibles at the leading end. */
function grubFlat(g: Ctx, m: ViewMonster, s: number) {
  const face = m.dir === 3 ? -1 : 1;
  g.scale(face, 1);
  const seg = [[-0.34, 0.3], [-0.08, 0.36], [0.16, 0.34], [0.36, 0.28]];

  g.fillStyle = P.fygar;
  for (const [ox, r] of seg) {
    g.beginPath();
    g.arc(ox * s, s * 0.06, r * s * 0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = P.fygarBelly;
  for (const [ox, r] of seg) {
    g.beginPath();
    g.arc(ox * s, s * 0.02, r * s * 0.36, 0, Math.PI * 2);
    g.fill();
  }

  // Mandibles.
  g.strokeStyle = P.rockShade;
  g.lineWidth = Math.max(1, s * 0.07);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(s * 0.4, -s * 0.06);
  g.lineTo(s * 0.56, -s * 0.16);
  g.moveTo(s * 0.4, s * 0.1);
  g.lineTo(s * 0.56, s * 0.2);
  g.stroke();

  g.fillStyle = '#1a1410';
  g.beginPath();
  g.arc(s * 0.3, -s * 0.06, s * 0.06, 0, Math.PI * 2);
  g.fill();
}

/* The shark. Read as a shark from the silhouette alone — the dorsal fin is
 * doing all the work and it is the one part that must survive being two
 * centimetres tall, so it is drawn oversized against a real animal's
 * proportions. Everything else is one tapered body and a tail. */
function sharkFlat(g: Ctx, m: ViewMonster, s: number) {
  const face = m.dir === 3 ? -1 : 1;
  g.scale(face, 1);

  // Tail first, so the body overlaps its root rather than butting against it.
  const body = bodyTint(m, P.shark);
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(-s * 0.3, 0);
  g.lineTo(-s * 0.56, -s * 0.26);
  g.lineTo(-s * 0.46, 0);
  g.lineTo(-s * 0.56, s * 0.22);
  g.closePath();
  g.fill();

  /* Body: a POINTED snout and a hard taper to the tail, not an oval.
   *
   * The first version put the widest point in the middle and rounded both ends,
   * which reads as a generic fish. A shark's mass sits forward — blunt-nosed
   * but wedge-shaped in plan — so the widest point moves ahead of centre and
   * the rear third narrows sharply into the caudal peduncle. */
  g.beginPath();
  g.moveTo(s * 0.5, -s * 0.02);
  g.quadraticCurveTo(s * 0.34, -s * 0.3, s * 0.06, -s * 0.32);
  g.quadraticCurveTo(-s * 0.2, -s * 0.3, -s * 0.34, -s * 0.09);
  g.quadraticCurveTo(-s * 0.38, 0, -s * 0.34, s * 0.09);
  g.quadraticCurveTo(-s * 0.2, s * 0.28, s * 0.06, s * 0.3);
  g.quadraticCurveTo(s * 0.34, s * 0.28, s * 0.5, s * 0.02);
  g.closePath();
  g.fill();

  // Pectoral fin, swept back. Two fins beat one for saying "shark".
  g.beginPath();
  g.moveTo(s * 0.1, s * 0.16);
  g.lineTo(-s * 0.06, s * 0.44);
  g.lineTo(s * 0.24, s * 0.2);
  g.closePath();
  g.fill();

  // Dorsal fin. Deliberately oversized against a real animal's proportions:
  // at 32px it is the only part that survives as pure silhouette.
  g.beginPath();
  g.moveTo(-s * 0.06, -s * 0.26);
  g.lineTo(s * 0.06, -s * 0.62);
  g.lineTo(s * 0.24, -s * 0.2);
  g.closePath();
  g.fill();

  // Pale underside, so it is not one flat wedge of grey.
  g.fillStyle = P.sharkBelly;
  g.beginPath();
  g.moveTo(s * 0.36, s * 0.06);
  g.quadraticCurveTo(s * 0.0, s * 0.28, -s * 0.28, s * 0.1);
  g.quadraticCurveTo(s * 0.0, s * 0.16, s * 0.36, s * 0.06);
  g.closePath();
  g.fill();

  // Mouth and eye. The mouth is under the snout, which is most of what makes a
  // grey wedge read as a shark rather than a fish.
  g.strokeStyle = '#1a1410';
  g.lineWidth = Math.max(1, s * 0.045);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(s * 0.42, s * 0.08);
  g.quadraticCurveTo(s * 0.26, s * 0.16, s * 0.12, s * 0.08);
  g.stroke();
  g.fillStyle = '#1a1410';
  g.beginPath();
  g.arc(s * 0.28, -s * 0.06, s * 0.055, 0, Math.PI * 2);
  g.fill();
}

/* The mole: a fat body, a pink snout, and the two spade-shaped forepaws it digs
 * and throws with. Drawn facing its direction of travel like everything else,
 * but with the paws always forward — they are the reason it is a threat. */
function moleFlat(g: Ctx, m: ViewMonster, s: number) {
  const face = m.dir === 3 ? -1 : 1;
  g.scale(face, 1);

  /* A lit rim along the top, then the body inside it.
   *
   * A mole stands on a tunnel floor, which is the darkest surface in the game,
   * so at phone size the animal was separating from the background on hue
   * alone — and losing. Drawing a slightly larger shape in a lighter tone first
   * leaves a one-pixel lit edge all along the top, which is what actually cuts
   * it out of the dark. Cheaper and more robust than lightening the whole body,
   * which would have made it read as sand. */
  g.fillStyle = P.moleRim;
  g.beginPath();
  g.ellipse(-s * 0.04, s * 0.0, s * 0.42, s * 0.35, 0, 0, Math.PI * 2);
  g.fill();

  // Body.
  g.fillStyle = bodyTint(m, P.mole);
  g.beginPath();
  g.ellipse(-s * 0.04, s * 0.04, s * 0.4, s * 0.33, 0, 0, Math.PI * 2);
  g.fill();

  // Haunch, a shade darker, to stop the ellipse reading as a pebble.
  g.fillStyle = P.moleDark;
  g.beginPath();
  g.ellipse(-s * 0.26, s * 0.06, s * 0.2, s * 0.26, 0, 0, Math.PI * 2);
  g.fill();

  // Snout.
  g.fillStyle = P.moleNose;
  g.beginPath();
  g.ellipse(s * 0.38, s * 0.02, s * 0.13, s * 0.1, 0, 0, Math.PI * 2);
  g.fill();

  // Spade paws.
  g.fillStyle = P.moleNose;
  for (const oy of [-s * 0.14, s * 0.16]) {
    g.beginPath();
    g.ellipse(s * 0.32, oy, s * 0.13, s * 0.08, 0.3, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = P.moleDark;
  g.lineWidth = Math.max(0.8, s * 0.03);
  for (const oy of [-s * 0.14, s * 0.16]) {
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(s * 0.34 + i * s * 0.04, oy - s * 0.06);
      g.lineTo(s * 0.4 + i * s * 0.045, oy + s * 0.05);
      g.stroke();
    }
  }

  // A mole's eyes are famously not much use; one dark bead is enough and keeps
  // the face from competing with the paws.
  g.fillStyle = '#140f0c';
  g.beginPath();
  g.arc(s * 0.16, -s * 0.1, s * 0.05, 0, Math.PI * 2);
  g.fill();
}

const FLAT: Record<string, Silhouette<ViewMonster>> = {
  pooka: pookaFlat, fygar: fygarFlat, mite: miteFlat,
  sapper: sapperFlat, warden: wardenFlat, geode: geodeFlat, grub: grubFlat,
  shark: sharkFlat, mole: moleFlat,
};

const GHOST_TINT: Record<string, string> = {
  pooka: 'pooka', fygar: 'fygar', mite: 'danger', sapper: 'rock',
  warden: 'rock', geode: 'ore', grub: 'fygarBelly',
  // The shark spends most of its life in this silhouette rather than its own,
  // so of every entry here this is the one that had to be its real colour.
  shark: 'shark', mole: 'mole',
};

/* The ghost silhouette means exactly one thing — intangible, so it can neither
 * be harpooned nor kill you. Nothing else may borrow it. The alpha comes from
 * actor(), not from here, so a ghosting kind is never faded twice. */
/* A submerged shark keeps its OWN outline.
 *
 * The shared ghost dome is right for a Pooka phasing through rock for a couple
 * of seconds — a wisp with eyes, obviously not itself. It is wrong for a shark,
 * because submerged is the shark's RESTING state: it is the silhouette the
 * player sees most, in a water biome, where a rounded dome with two eye dots
 * reads as a cartoon ghost and nothing else in the game is a ghost.
 *
 * So: the shark's own body and fin, flattened and eyeless. Intangibility is
 * already carried by the alpha actor() applies, which is why the eyes can go —
 * they were the single most cartoon thing about it. The fin is kept full height
 * because the fin is the whole tell, and the ridge the view draws in the dirt
 * above it has to agree with something. */
function sharkGhostFlat(g: Ctx, m: ViewMonster, s: number) {
  const face = m.dir === 3 ? -1 : 1;
  g.scale(face, 1);
  g.fillStyle = P.shark;

  g.beginPath();
  g.moveTo(-s * 0.3, 0);
  g.lineTo(-s * 0.58, -s * 0.22);
  g.lineTo(-s * 0.46, 0);
  g.lineTo(-s * 0.58, s * 0.2);
  g.closePath();
  g.fill();

  g.beginPath();
  g.moveTo(s * 0.48, 0);
  g.quadraticCurveTo(s * 0.2, -s * 0.3, -s * 0.32, -s * 0.11);
  g.quadraticCurveTo(-s * 0.38, 0, -s * 0.32, s * 0.11);
  g.quadraticCurveTo(s * 0.2, s * 0.28, s * 0.48, 0);
  g.closePath();
  g.fill();

  // Taller than the solid one. Under the dirt this is often the only part with
  // any contrast, so it is the part that has to survive.
  g.beginPath();
  g.moveTo(-s * 0.04, -s * 0.22);
  g.lineTo(s * 0.05, -s * 0.6);
  g.lineTo(s * 0.2, -s * 0.18);
  g.closePath();
  g.fill();
}

/* Per-kind override for the intangible silhouette. Anything absent gets the
 * shared wisp, which is still the right answer for every kind that ghosts
 * occasionally rather than habitually. */
const GHOST_FLAT: Record<string, Silhouette<ViewMonster>> = { shark: sharkGhostFlat };

/* One kind's silhouette, drawn into any context at any size.
 *
 * For the bestiary, which has to show a picture of every kind and could once
 * only show the kinds the sprite sheet draws — a kind without sheet art mounted
 * a canvas, failed to blit, and left an EMPTY BOX, which is worse than the
 * lettered tile the canvas had just replaced.
 *
 * Reusing the game's own fallback rather than authoring a second picture is the
 * point: whatever the bestiary shows is then, by construction, the thing the
 * player will meet underground. It also means a kind added later is illustrated
 * the moment it has a silhouette, with no separate art step to forget.
 *
 * Returns false when there is nothing to draw, so the caller can keep its
 * lettered tile instead of clearing to nothing. */
export function drawKindFlat(g: Ctx, kind: string, px: number, dir?: number) {
  const fn = FLAT[kind];
  if (!fn) return false;

  /* Drawn once oversized, MEASURED, then fitted.
   *
   * A silhouette is authored to fill its 2x2 cell in the field, where anything
   * that overhangs is cropped harmlessly by the tunnel around it — and none of
   * them are symmetric about the origin. The Shark reaches 0.62 up to the tip
   * of its dorsal and 0.58 back to its tail against 0.5 forward, so centring it
   * on the origin and scaling to fit the box clipped the fin and the tail flat
   * against two edges.
   *
   * Measuring the alpha bounds costs one offscreen pass and removes the whole
   * class of problem: no per-kind fudge factor to tune, and a kind added later
   * frames itself correctly the first time. It runs once per slot, not per
   * frame, because a procedural row has a single unchanging frame. */
  const PAD = 2;
  const work = document.createElement('canvas');
  work.width = px * 2;
  work.height = px * 2;
  const wg = work.getContext('2d');
  if (!wg) return false;
  wg.imageSmoothingEnabled = false;
  wg.save();
  wg.translate(work.width / 2, work.height / 2);
  wg.scale(px / 32, px / 32);
  /* The silhouettes read `kind`, `dir` and `tint` and nothing else — they are
   * drawing a picture, not an actor — so the bestiary hands them a scrap with
   * those three fields rather than conjuring a whole Monster. */
  fn(wg, { kind, dir: dir === undefined ? 1 : dir, tint: null } as unknown as ViewMonster, 32);
  wg.restore();

  const d = wg.getImageData(0, 0, work.width, work.height).data;
  let x0 = work.width, y0 = work.height, x1 = -1, y1 = -1;
  for (let y = 0; y < work.height; y++) {
    for (let x = 0; x < work.width; x++) {
      if (d[(y * work.width + x) * 4 + 3] <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return false;            // drew nothing at all

  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const fit = Math.min((px - PAD * 2) / w, (px - PAD * 2) / h);
  const dw = w * fit, dh = h * fit;
  g.drawImage(work, x0, y0, w, h, (px - dw) / 2, (px - dh) / 2, dw, dh);
  return true;
}

function ghostFlat(g: Ctx, m: ViewMonster, s: number) {
  g.fillStyle = (P[GHOST_TINT[m.kind] || 'pooka'] as string) || P.pooka;
  g.beginPath();
  g.arc(0, -s * 0.06, s * 0.36, Math.PI, 0);
  g.lineTo(s * 0.36, s * 0.3);
  for (let i = 0; i < 3; i++) {
    g.lineTo(s * (0.36 - 0.24 * i - 0.12), s * (i % 2 ? 0.3 : 0.16));
  }
  g.lineTo(-s * 0.36, s * 0.3);
  g.closePath();
  g.fill();
  g.fillStyle = P.pookaEye;
  g.beginPath();
  g.arc(-s * 0.13, -s * 0.08, s * 0.09, 0, Math.PI * 2);
  g.arc(s * 0.13, -s * 0.08, s * 0.09, 0, Math.PI * 2);
  g.fill();
}

function drawMonster(g: Ctx, m: ViewMonster, alpha: number, state: RenderState) {
  const ghost = m.mode === 'ghost';
  const stages = m.stages || TUNE.PUMP_STAGES;
  /* Only a breather ever owns fire, so owning some IS breathing — the extra
   * `k.breathes` test upstream makes was reading the kind table, which a client
   * does not have. */
  const jetting = hasFireFrom(state, m);
  const ctx: ClipCtx = { jetting: !!jetting };
  if (m.pump > 0 && !m.dying) ctx.phase = Math.min(1, m.pump / Math.max(1, stages));

  const a = ghost ? 0.75 : (m.alpha === undefined ? 1 : m.alpha);
  const flat = ghost ? (GHOST_FLAT[m.kind] || ghostFlat) : (FLAT[m.kind] || pookaFlat);
  actor(g, m, alpha, ctx, flat, {
    alpha: a,
    pump: m.dying ? 0 : m.pump,
  });

  const wx = lerp(m.px, m.x, alpha) + 1;
  const wy = lerp(m.py, m.y, alpha) + 1;

  // Telegraph spark at the mouth. Drawn here rather than inside the silhouette
  // so it is identical on the sprite and fallback paths — it is the warning the
  // whole fairness argument rests on, and it must never be art-dependent.
  if (m.telegraph > 0) {
    const t = 1 - m.telegraph / TUNE.FIRE_TELEGRAPH;
    const face = m.dir === 3 ? -1 : 1;
    const s = 2 * V.scale;
    g.save();
    g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 40);
    g.fillStyle = P.fire;
    g.beginPath();
    g.arc(sx(wx) + face * s * 0.5, sy(wy) - s * 0.05, s * 0.1 * (0.4 + t), 0, Math.PI * 2);
    g.fill();
    g.restore();
    light.add(wx + face * 1, wy, 2.5 + t * 2, P.fire, 0.5 + t * 0.4);
  }

  // A Geode is ore in a shell. It catches the lamp even when nothing else does,
  // which is most of what marks it out as worth the trouble of setting a rock.
  if (m.kind === 'geode' && !m.dying) light.add(wx, wy, 1.8, P.ore, 0.32);
}

function hasFireFrom(state: RenderState, m: ViewMonster) {
  for (const f of state.fire) if (f.owner === m.id) return true;
  return false;
}

/* The last monster alive stops patrolling and comes for you. Nothing else on
 * screen changes when that happens, so without a mark the shift from "clearing
 * a level" to "being hunted" is invisible. A ring, and a brief expanding pulse
 * on the turn itself. */
function drawHunterMark(g: Ctx, m: ViewMonster, alpha: number) {
  const x = sx(lerp(m.px, m.x, alpha));
  const y = sy(lerp(m.py, m.y, alpha));
  const s = 2 * V.scale;
  g.save();
  g.translate(x + s / 2, y + s / 2);
  g.strokeStyle = P.danger;
  g.lineWidth = Math.max(1.5, s * 0.06);
  g.globalAlpha = 0.5 + 0.3 * Math.sin(clock() / 120);
  g.beginPath();
  g.arc(0, 0, s * 0.56, 0, Math.PI * 2);
  g.stroke();
  if (m.markT > 0) {
    const t = 1 - m.markT / TUNE.HUNT_MARK;
    g.globalAlpha = Math.max(0, 1 - t);
    g.lineWidth = Math.max(2, s * 0.1);
    g.beginPath();
    g.arc(0, 0, s * (0.56 + t * 1.6), 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

/* ── props ────────────────────────────────────────────────────────────── */

function drawRock(g: Ctx, r: ViewRock, alpha: number) {
  const wob = r.state === 'wobble' ? Math.sin(r.t * 42) * V.scale * 0.22 : 0;
  const x = sx(lerp(r.px, r.x, alpha)) + wob;
  const y = sy(lerp(r.py, r.y, alpha));
  const s = 2 * V.scale;

  if (r.state === 'breaking') {
    const t = 1 - r.t / TUNE.ROCK_BREAK;
    const fr = sprites.ready() ? shatterFrame(t) : null;
    g.save();
    g.globalAlpha = Math.max(0, r.t / TUNE.ROCK_BREAK);
    if (fr && sprites.draw(g, fr, x, y, s, s)) { g.restore(); return; }
    g.translate(x + s / 2, y + s / 2);
    g.scale(1 + t * 0.5, 1 - t * 0.35);
    rockFlat(g, s);
    g.restore();
    return;
  }

  if (sprites.draw(g, themedFrame('rock'), x, y, s, s)) return;
  g.save();
  g.translate(x + s / 2, y + s / 2);
  rockFlat(g, s);
  g.restore();
}

function shatterFrame(t: number) {
  const c = anim.clips()['rock.shatter'];
  if (!c) return null;
  const i = Math.min(c.frames.length - 1, Math.max(0, Math.floor(t * c.frames.length)));
  return c.frames[i];
}

function rockFlat(g: Ctx, s: number) {
  g.fillStyle = P.rockShade;
  g.beginPath();
  g.arc(0, 0, s * 0.46, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = P.rock;
  g.beginPath();
  g.arc(-s * 0.05, -s * 0.05, s * 0.38, 0, Math.PI * 2);
  g.fill();
}

function drawHarpoon(g: Ctx, h: ViewHarpoon, p: ViewPlayer, alpha: number) {
  if (!h || !h.active) return;
  const s = V.scale;
  const px = lerp(p.px, p.x, alpha) + 1;
  const py = lerp(p.py, p.y, alpha) + 1;
  const dx = h.dir === 1 ? 1 : h.dir === 3 ? -1 : 0;
  const dy = h.dir === 2 ? 1 : h.dir === 0 ? -1 : 0;
  const x0 = sx(px), y0 = sy(py);
  const wx = px + dx * h.len, wy = py + dy * h.len;
  const x1 = sx(wx), y1 = sy(wy);

  g.strokeStyle = P.harpoon;
  g.lineWidth = Math.max(2, s * 0.35);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();

  g.fillStyle = P.harpoon;
  g.save();
  g.translate(x1, y1);
  g.rotate(Math.atan2(dy, dx));
  g.beginPath();
  g.moveTo(s * 0.6, 0);
  g.lineTo(-s * 0.3, -s * 0.45);
  g.lineTo(-s * 0.3, s * 0.45);
  g.closePath();
  g.fill();
  g.restore();

  // The tip is the only light source the player controls the aim of.
  light.add(wx, wy, 2.2, P.harpoon, 0.5);
}

/* Fire comes in two flavours and they must not look alike.
 *
 * A Fygar's breath is a DIRECTED jet down a corridor: you survive it by not
 * being in that corridor. A Sapper's crater is a RADIUS: you survive it by not
 * being near. Drawing both as a horizontally-graded lozenge — which is what
 * this did — told the player the wrong thing about the second one every time. */
/* The flame's wobble, and why it is not on a clock.
 *
 * Every other animation in the view runs off anim.js's render-rate clock, which
 * is right for anything looping. This one may not: tests/shots.html demands two
 * consecutive capture runs be byte-identical, and a jet whose edges depend on
 * wall time would differ between them, which would make every future visual
 * diff meaningless. So the wobble is derived from values the SIMULATION already
 * owns — where the jet started, how far it has grown, how long it has left —
 * which vary frame to frame exactly like a clock would, and reproduce exactly
 * like a seed does. */
function jetNoise(f: ViewFire, i: number) {
  // Only a jet is ever passed here, and a jet always has a mouth.
  const s = Math.sin(((f.ox || 0) * 12.9898 + (f.oy || 0) * 78.233 + i * 37.719) * 0.5);
  const t = (f.growT || 0) * 9 + (0.55 - (f.t || 0)) * 7;
  return Math.sin(t + s * 6.283) * 0.5 + Math.sin(t * 1.7 + i) * 0.28;
}

/* Half-width of the jet at fraction `u` along its length, 0 at the mouth.
 *
 * Full height for the first stretch and then a taper to a point: the art must
 * not be visibly thinner than the hitbox anywhere the hitbox is still lethal,
 * or the flame teaches the player a safe margin that does not exist. The taper
 * is spent on the last third, which is the end you have the most warning of. */
function jetProfile(u: number, n: number) {
  const body = u < 0.62 ? 1 : 1 - Math.pow((u - 0.62) / 0.38, 1.5);
  return Math.max(0, body * (0.88 + 0.12 * n));
}

/* Turns of the wheel per fine cell travelled. A LOOK, and deliberately not in
 * TUNE: a number the simulation can read is a number the simulation will
 * eventually be tempted to read, and the spin must never mean anything. */
const WHEEL_TURNS_PER_CELL = 0.42;
const WHEEL_VANES = 5;

/* The vent's wheel: a burning cartwheel rolling down a corridor.
 *
 * THE ANGLE COMES FROM `travel`, not from a clock. anim.js's clock runs at
 * render rate and would give a smoother spin, and it would also make two
 * capture runs differ — the same argument jetNoise makes above. Distance
 * travelled varies frame to frame exactly like a clock does and reproduces
 * exactly like a seed does, which is the property that matters. `pTravel` is
 * interpolated alongside px/py so the spin lerps with the position; without it
 * the wheel slides smoothly and rotates in steps, which reads as a stutter on a
 * 120 Hz panel.
 *
 * Same palette as a Fygar's breath, on purpose. It is the same element — the
 * same relic turns both of them off — and borrowing the exact ramp is the thing
 * that says so without a word of UI. */
function drawWheel(g: Ctx, w: ViewWheel, alpha: number) {
  const wx = lerp(w.px, w.x, alpha) + 1;
  const wy = lerp(w.py, w.y, alpha) + 1;
  const travel = lerp(w.pTravel, w.travel, alpha);
  const s = 2 * V.scale;
  const R = s * 0.48;

  // Sign so the rim appears to grip the ground it is rolling along: rightward
  // and downward travel spin clockwise, the other two counter.
  const sign = (w.dir === 1 || w.dir === 2) ? 1 : -1;
  const spin = travel * WHEEL_TURNS_PER_CELL * Math.PI * 2 * sign;

  g.save();
  g.translate(sx(wx), sy(wy));
  g.globalCompositeOperation = 'lighter';

  /* Two trailing arcs, drawn BEFORE the wheel so they sit under it. These are
   * what make a STILL frame read as moving, which is not a nicety: the
   * screenshot harness only ever produces still frames, so a wheel whose motion
   * lives entirely in the animation cannot be reviewed at all.
   *
   * Anchored to the direction of TRAVEL, not to the spin. The first version
   * lagged them in rotation — `spin - 0.45` — which is a different thing and
   * looks it: a wheel climbing a shaft had its smear at ten o'clock, ahead of
   * itself, so the frame read as something being pulled rather than something
   * arriving. `back` is the screen-space angle opposite the way it is going,
   * and DY is negative for 'up' because screen y grows downward. */
  const back = Math.atan2(-DY[w.dir], -DX[w.dir]);
  g.strokeStyle = P.danger;
  g.lineWidth = Math.max(1, s * 0.07);
  for (let k = 0; k < 2; k++) {
    g.globalAlpha = k ? 0.16 : 0.32;
    g.beginPath();
    g.arc(0, 0, R * (1.04 + k * 0.16), back - 0.62 + k * 0.12, back + 0.62 - k * 0.12);
    g.stroke();
  }

  g.rotate(spin);

  // Vanes. Five because it is ODD: an even count is mirror-symmetric and at
  // phone size the rotation stops reading as spin and becomes a shimmer.
  const grad = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
  grad.addColorStop(0, 'rgba(255,251,232,0.95)');
  grad.addColorStop(0.45, '#ffd07a');
  grad.addColorStop(1, P.fire);
  g.fillStyle = grad;
  g.globalAlpha = 0.92;
  for (let i = 0; i < WHEEL_VANES; i++) {
    const a0 = (i / WHEEL_VANES) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a0 - 0.34) * R * 0.22, Math.sin(a0 - 0.34) * R * 0.22);
    g.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
    g.lineTo(Math.cos(a0 + 0.34) * R * 0.22, Math.sin(a0 + 0.34) * R * 0.22);
    g.closePath();
    g.fill();
  }

  // Rim, then a hot hub over the vane roots so the centre does not read as a
  // pinwheel of separate flames.
  g.globalAlpha = 0.8;
  g.strokeStyle = P.fire;
  g.lineWidth = Math.max(1, s * 0.09);
  g.beginPath();
  g.arc(0, 0, R * 0.9, 0, Math.PI * 2);
  g.stroke();

  g.globalAlpha = 0.95;
  g.fillStyle = 'rgba(255,247,214,0.9)';
  g.beginPath();
  g.arc(0, 0, R * 0.3, 0, Math.PI * 2);
  g.fill();

  g.restore();
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  /* Wider and hotter than the jet's emitter. Basalt's ambient is 0.16 and this
   * thing arrives down a shaft you cannot see the end of — the glow reaching
   * you before the wheel does IS the second warning, and it is also the only
   * thing that ever marks where a vent is. */
  light.add(wx, wy, 3.2, P.fire, 0.95);
}

function drawFire(g: Ctx, f: ViewFire) {
  if (f.blast) { drawBlast(g, f); return; }
  /* dir is 0..3 = up, right, down, left, so the odd directions are the
   * horizontal ones — the same test the engine uses everywhere else. Rather
   * than grading a rectangle along whichever axis it happened to use, the jet
   * is now drawn in its OWN space: translate to the mouth, rotate so the flame
   * always runs along +x, and every shape below is written once. */
  const horiz = (f.dir & 1) === 1;
  const len = horiz ? f.w : f.h;
  if (!(len > 0)) return;

  // The mouth is the end of the rect nearest the Fygar, which is the low edge
  // for right/down and the high edge for left/up.
  const mx = horiz ? (f.dir === 1 ? f.x : f.x + f.w) : f.x + 1;
  const my = horiz ? f.y + 1 : (f.dir === 2 ? f.y : f.y + f.h);
  const ang = f.dir === 1 ? 0 : f.dir === 2 ? Math.PI / 2
    : f.dir === 3 ? Math.PI : -Math.PI / 2;

  const L = len * V.scale;
  const HW = V.scale;                 // half of the rect's 2-cell width
  const fade = 0.55 + 0.45 * Math.min(1, f.t * 8);

  g.save();
  g.translate(sx(mx), sy(my));
  g.rotate(ang);
  // Additive, so the overlapping lobes build a hot core instead of stacking up
  // into a flat opaque slab the way alpha compositing would.
  g.globalCompositeOperation = 'lighter';

  /* Three colour zones, not two. The old two-stop gradient ran white straight
   * into the danger pink and read as one red lozenge; the orange in the middle
   * is what makes it read as fire at all. */
  const grad = g.createLinearGradient(0, 0, L, 0);
  grad.addColorStop(0, 'rgba(255,251,232,0.95)');
  grad.addColorStop(0.18, '#ffd07a');
  grad.addColorStop(0.55, P.fire);
  grad.addColorStop(1, 'rgba(255,84,112,0.10)');

  // Body: one tapered sheet, its edges rippling independently top and bottom.
  g.globalAlpha = fade * 0.85;
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    const y = -HW * jetProfile(u, jetNoise(f, i));
    if (i === 0) g.moveTo(0, y); else g.lineTo(L * u, y);
  }
  for (let i = 12; i >= 0; i--) {
    const u = i / 12;
    g.lineTo(L * u, HW * jetProfile(u, jetNoise(f, i + 19)));
  }
  g.closePath();
  g.fill();

  /* Lobes. A jet with a smooth outline is a shape; a jet made of overlapping
   * bulges is a flame. Five is enough to read at phone size and few enough that
   * the additive blend does not blow out to white in the middle. */
  const lobes = Math.max(3, Math.min(7, Math.round(len * 0.5)));
  for (let i = 0; i < lobes; i++) {
    const u = (i + 0.5) / lobes;
    const n = jetNoise(f, i * 5);
    const r = HW * jetProfile(u, n) * (0.62 + 0.22 * n);
    if (r <= 0) continue;
    g.globalAlpha = fade * (0.30 - 0.16 * u);
    g.beginPath();
    g.ellipse(L * u, HW * 0.18 * n, r * 1.5, r, 0, 0, Math.PI * 2);
    g.fill();
  }

  // The core: a thin, near-white streak down the first half, which is what
  // makes the mouth end read as the hot end at a glance.
  g.globalAlpha = fade * 0.7;
  g.fillStyle = 'rgba(255,247,214,0.9)';
  g.beginPath();
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const y = -HW * 0.34 * jetProfile(u, jetNoise(f, i + 41)) * (1 - u * 0.85);
    if (i === 0) g.moveTo(0, y); else g.lineTo(L * u * 0.72, y);
  }
  for (let i = 8; i >= 0; i--) {
    const u = i / 8;
    g.lineTo(L * u * 0.72, HW * 0.34 * jetProfile(u, jetNoise(f, i + 57)) * (1 - u * 0.85));
  }
  g.closePath();
  g.fill();
  g.restore();

  // Light follows the LIVE rect, so a growing jet lights the corridor ahead of
  // itself as it travels rather than flashing the whole length at once.
  light.add(f.x + f.w / 2, f.y + f.h / 2, Math.max(f.w, f.h) * 0.75, P.fire, 0.9);
}

function drawBlast(g: Ctx, f: ViewFire) {
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  const r = Math.max(f.w, f.h) / 2;
  const x = sx(cx), y = sy(cy);
  const rp = r * V.scale;
  // The crater is HOT for FIRE_ACTIVE and then gone; the flash is front-loaded
  // so the bang reads as a bang and the lingering damage reads as embers.
  const t = Math.max(0, Math.min(1, f.t / TUNE.FIRE_ACTIVE));
  const grad = g.createRadialGradient(x, y, 0, x, y, rp);
  grad.addColorStop(0, `rgba(255,240,200,${0.25 + 0.7 * t})`);
  grad.addColorStop(0.45, `rgba(255,140,43,${0.2 + 0.55 * t})`);
  grad.addColorStop(0.85, `rgba(255,84,112,${0.12 + 0.25 * t})`);
  grad.addColorStop(1, 'rgba(255,84,112,0)');
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, rp, 0, Math.PI * 2);
  g.fill();
  g.restore();

  light.add(cx, cy, r * 1.6, P.fire, 0.5 + 0.5 * t);
}

function drawBonus(g: Ctx, b: ViewBonus) {
  const x = sx(b.x), y = sy(b.y), s = 2 * V.scale;
  light.add(b.x + 1, b.y + 1, 2.6, P.fygarBelly, 0.55);
  if (sprites.draw(g, 'bonus', x, y, s, s)) return;
  g.save();
  g.translate(x + s / 2, y + s / 2);
  g.fillStyle = P.fygar;
  g.beginPath();
  g.ellipse(0, s * 0.08, s * 0.3, s * 0.36, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = P.fygarBelly;
  g.lineWidth = Math.max(2, s * 0.08);
  g.beginPath();
  g.moveTo(0, -s * 0.24);
  g.lineTo(0, -s * 0.46);
  g.stroke();
  g.restore();
}

/* ── the buried things ────────────────────────────────────────────────────
 *
 * The relic and the crystal were on `state` and drawn by nobody, which made the
 * `crystal` capture a photograph of an empty cavity. They are worth a detour
 * only if you can see them, and they are the only two objects in the game whose
 * whole job is to be worth a detour. */
function drawPickup(
  g: Ctx, wx: number, wy: number, frame: string, colour: string, bob: number,
) {
  const s = 1.5 * V.scale;
  const y = sy(wy + bob) - s / 2;
  const x = sx(wx) - s / 2;
  light.add(wx, wy + bob, 3.4, colour, 0.8);
  if (sprites.draw(g, frame, x, y, s, s)) return;
  g.save();
  g.translate(x + s / 2, y + s / 2);
  g.rotate(Math.PI / 4);
  g.fillStyle = colour;
  g.fillRect(-s * 0.28, -s * 0.28, s * 0.56, s * 0.56);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(-s * 0.22, -s * 0.22, s * 0.2, s * 0.2);
  g.restore();
}

function drawBuried(g: Ctx, state: RenderState) {
  const t = clock() / 1000;
  const bob = Math.sin(t * 2.2) * 0.16;
  const c = state.crystalAt;
  if (c) {
    drawPickup(g, c.lc * 2 + 1, c.lr * 2 + 1, 'pickup.crystal', P.ore, bob);
  }
  /* The relic on the floor is drawn as the relic it actually is.
   *
   * Which one that will be is not stored anywhere — the engine resolves it at
   * the moment of pickup as "the first id in this chamber's pre-shuffled pool
   * that the run is not already carrying" — so the view asks the same question
   * to draw it. It must stay the SAME question: showing one object and handing
   * over another is worse than showing the generic disc.
   *
   * Worth the read, because a relic is a detour decided from across the level.
   * Barbed Head is the case that made this necessary: its effect (a harpoon
   * that ignores terrain) is indistinguishable from a bug if you never learn
   * you picked it up. */
  const r = state.relicSite;
  if (r) {
    const id = r.pool.find((x: string) => !state.relics.includes(x));
    const specific = id ? 'pickup.relic.' + id : null;
    const frame = specific && sprites.has(specific) ? specific : 'pickup.relic';
    drawPickup(g, r.x + 1, r.y + 1, frame, P.harpoon, -bob);
  }
}

/* The engine tags particles with a semantic kind, not a colour — it has no
 * business knowing the palette. */
function particleColor(kind: string, y: number) {
  switch (kind) {
    case 'dirt':   return P.dirt[bandIndex(y)];
    case 'rock':   return P.rock;
    case 'pooka':  return P.pooka;
    case 'fygar':  return P.fygar;
    case 'ore':    return P.ore;
    case 'bonus':  return P.fygarBelly;
    case 'mite':   return P.danger;
    case 'warden': return P.rock;
    case 'grub':   return P.fygarBelly;
    default:       return P.text;
  }
}

function bandIndex(y: number) {
  const b = Math.floor(Math.round(y) / GRID.BAND_ROWS);
  return b < 0 ? 0 : b > GRID.BAND_COUNT - 1 ? GRID.BAND_COUNT - 1 : b;
}

/* ── the pass ─────────────────────────────────────────────────────────── */

/* Effects fired from an engine event. app.js forwards drainEvents() here so the
 * one place that knows "what happened" is the one place that decides "what it
 * looks like" — see the table in vfx.js. */
export { emit } from './vfx';

export function reset() {
  anim.reset();
  vfx.reset();
  light.reset();
  seenWorld = null;
  seenSerial = -1;
  lastClock = null;
}

/* A new level — or a new run, which has a new world key with levelSerial back
 * at 1 — throws away every animation track and every live effect. Same
 * two-part test camera.js makes, and for the same reason: keying on the
 * serial alone leaves the second run of a session wearing the first run's
 * dust.
 *
 * Exported so the client can call it BEFORE emitting a frame's events. Called
 * only from render(), it ran after them and erased the new world's first
 * effects. Idempotent, so render() still calls it for callers that do not. */
export function syncWorld(worldKey: string, levelSerial: number) {
  if (worldKey === seenWorld && levelSerial === seenSerial) return false;
  seenWorld = worldKey;
  seenSerial = levelSerial;
  anim.reset();
  vfx.reset();
  drillT = 0;
  return true;
}

export function render(g: Ctx, state: RenderState, alpha: number, font: string) {
  /* Render-rate delta, from the SAME injected clock view.js pins for the
   * harness. Everything animated downstream of here reads this and nothing
   * else. */
  const now = clock();
  if (lastClock === null) lastClock = now;
  let dt = (now - lastClock) / 1000;
  lastClock = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;

  syncWorld(state.worldKey, state.levelSerial);

  anim.tick(dt);
  vfx.tick(dt);

  /* Hit-stop is RENDER-ONLY. It freezes the interpolation alpha, and that is
   * the whole of it — loop.setPaused() would reset the fixed-step accumulator
   * and silently drop simulated time, which is invisible in play and fatal to
   * `?seed=` and to the harness. See anim.js. */
  const a = anim.lerpAlpha(alpha);

  const dpr = deviceScale(g);
  const cssW = g.canvas.width / dpr;
  const cssH = g.canvas.height / dpr;
  /* `t` is seconds of render time accumulated from the injected clock, handed
   * down so light.js can twinkle without acquiring a clock of its own. Anything
   * with its own time source is a thing the harness cannot pin. */
  renderT += dt;
  const view: ViewBox = {
    ox: V.ox, oy: V.oy, scale: V.scale, top: V.top,
    vx: V.ox, visCols: cssW / V.scale, visRows: cssH / V.scale,
    cssW, cssH, dpr, k: 1, t: renderT,
  };

  const tActors = perf.now();
  if (state.bonus && state.bonus.active) drawBonus(g, state.bonus);
  drawBuried(g, state);
  for (const r of state.rocks) drawRock(g, r, a);
  for (const q of state.players) drawHarpoon(g, q.harpoon, q, a);

  /* No `dead` test: a dead monster never reaches a client. packMonsters drops
   * them at the projection, which is the one place that knows the difference
   * between dead and merely dying. */
  for (const m of state.monsters) {
    /* The ghost silhouette means exactly one thing — intangible, so it can
     * neither be harpooned nor kill you. Nothing else may borrow it.
     *
     * 'ghostwind' deliberately keeps the SOLID silhouette and just pulses its
     * alpha (set by the engine): during the wind-up it is still tangible and
     * still killable, and swapping to the ghost shape early would say
     * otherwise. */
    drawMonster(g, m, a, state);
    if (m.hunting) drawHunterMark(g, m, a);
  }

  /* Every digger, this screen's own included. Drawn after the monsters so a
   * teammate standing in a Pooka never disappears behind it. */
  for (const q of state.players) drawPlayer(g, q, a);
  for (const f of state.fire) drawFire(g, f);
  for (const w of state.wheels) drawWheel(g, w, a);

  for (const p of state.particles) {
    g.globalAlpha = Math.max(0, p.life / p.max);
    g.fillStyle = particleColor(p.kind, p.y);
    const sz = Math.max(1, p.size * V.scale);
    g.fillRect(sx(p.x) - sz / 2, sy(p.y) - sz / 2, sz, sz);
  }
  g.globalAlpha = 1;

  /* The drill throws dust for as long as it is drilling. Paced off the render
   * clock rather than per frame, so it looks the same at 60 and at 120 Hz. */
  if (state.phase === 'descend') {
    drillT += dt;
    while (drillT > 0.045) {
      drillT -= 0.045;
      vfx.emit('dig', state.player.x, state.player.y + 1);
    }
  } else drillT = 0;

  perf.add('actors', tActors);
  let tPass = perf.now();
  if (!perf.skip('vfx')) vfx.render(g, view, P);
  perf.add('vfx', tPass);
  tPass = perf.now();
  /* Skipping the lamp still has to drain what the actors queued for it: the
   * emitter list is only cleared at the end of a render, and left alone it
   * grows by a dozen entries a frame for as long as the switch is on. */
  if (!perf.skip('light')) light.render(g, state, view, P);
  else light.reset();
  perf.add('light', tPass);
  tPass = perf.now();
  if (!perf.skip('vfx')) vfx.overlay(g, cssW, cssH);
  perf.add('overlay', tPass);

  if (state.popups.length) {
    g.font = `700 ${Math.round(V.scale * 1.3)}px ${font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of state.popups) {
      g.globalAlpha = Math.max(0, Math.min(1, p.life * 3));
      g.fillStyle = P.text;
      g.fillText(String(p.text), sx(p.x), sy(p.y - (1 - p.life / p.max) * 1.5));
    }
    g.globalAlpha = 1;
  }
}

/* The device pixel ratio, read back off the context transform rather than off
 * window.devicePixelRatio.
 *
 * view.js sets the transform to (dpr,0,0,dpr,...) every frame and the harness
 * OVERRIDES the dpr it uses, so reading the real one here would size the light
 * buffer for a device the shot is not of — and two captures at different
 * overrides would then differ for a reason that has nothing to do with the
 * scene. The screen shake adds a translate, which does not disturb the scale. */
function deviceScale(g: Ctx) {
  if (!g.getTransform) return 1;
  const t = g.getTransform();
  return t && t.a > 0 ? t.a : 1;
}
