/* The shaft, drawn — twice, because the two screens want opposite things.
 *
 * A PHONE gets the real thing: sprites, lighting, particles, a camera twenty
 * cells wide locked to its own digger. That is view.ts and the eight modules
 * under it, ported whole from upstream.
 *
 * The SHARED SCREEN gets a schematic: solid blocks, flat colours, the whole
 * crew at once. Not a fallback — a different job. At 1920x1080 the field
 * renderer's integer-scale fit shows about 22 of 160 rows, which is barely more
 * than a phone shows and useless for the thing a shared screen is actually for,
 * which is four people pointing at it and agreeing where to dig.
 *
 * Both rebuild the level from the seed and apply the server's run-length delta,
 * so both are drawing the same world the simulation is running.
 *
 * THE CAMERA LIVES HERE AND NOWHERE ELSE. The simulation must never learn the
 * size of a viewport; if it did, two phones would stop playing the same game.
 */

import { useEffect, useRef } from 'react';
import { ResourceScope } from '../../../party-runtime/src/index';
import { QualityGovernor, SnapshotBuffer } from '../../../party-runtime/src/index';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { GRID, bandOf, idx } from './worldgen';
import { THEME_BY_ID, THEMES } from './themes';
import { SUIT_BY_ID } from './suits';
import type { PrivateView, PublicView, Settings } from './model';
import { blend, createAdapter, createGround, decode, sameWorld } from './viewstate';
import type { DecodedView, Ground } from './viewstate';
import * as view from './view';
import * as vfx from './vfx';
import { createSound } from './sound';
import * as perf from './perf';

const { GW, GH } = GRID;

/* How much of the shaft the shared screen shows, at its most zoomed IN.
 *
 * Sixty fine rows is thirty metres, against the forty-five or so a phone shows
 * — and the whole 160 when the crew spreads out. The first version of this view
 * mirrored the phone's own fit and showed twenty-six rows, which is LESS than a
 * phone: a shared screen that shows less than the device in your hand has no
 * reason to exist. Its job is the thing a phone cannot do, which is let four
 * people see each other and point. */
const DISPLAY_MIN_ROWS = 60;
/** Slack around the crew, so nobody sits against the edge of the picture. */
const DISPLAY_MARGIN = 16;
/** Camera smoothing and slack, in the same units as camera.js upstream. */
const FOLLOW_K = 8, DEADZONE = 2;
/* Both screens present 100 ms behind the newest snapshot to start, adapting
 * between 75 and 150 ms to the arrival gaps this device actually sees. The
 * clock never runs backward, and a suspended tab starts clean. */
const PRESENTATION = { adaptive: { minMs: 75, maxMs: 150 }, monotonic: true, resetGapMs: 500 };
/** Live-effect ceilings per automatic quality tier; see view.setQualityTier. */
const EFFECT_BUDGET = [260, 90];
/* One bad frame is logged and ridden out. Three seconds of nothing but failed
 * frames is a renderer that will not recover, and the shell's retry is the
 * only way out, so it is reported then — once. */
const PERSISTENT_FAILURE_FRAMES = 180;

const hex = (c: string) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

/** One pixel per fine cell, repainted only when the terrain actually changes. */
function paintField(field: HTMLCanvasElement, view: PublicView, t: Ground) {
  const g = field.getContext('2d');
  if (!g) return;
  const theme = THEME_BY_ID[view.theme] ?? THEMES[0];
  const bands = theme.bands.map(hex);
  const sky = hex(theme.sky), cave = hex(theme.cave);
  const img = g.createImageData(GW, GH);
  const px = img.data;
  for (let r = 0; r < GH; r++) {
    const band = bands[Math.min(bands.length - 1, bandOf(r))];
    for (let c = 0; c < GW; c++) {
      if (c >= view.activeGW) {                 // past the edge of the world
        const o = idx(c, r) * 4;
        px[o] = 5; px[o + 1] = 7; px[o + 2] = 26; px[o + 3] = 255;
        continue;
      }
      const i = idx(c, r);
      const o = i * 4;
      let rgb: readonly [number, number, number];
      if (t.dirt[i] === 1) {
        const grade = t.ore[i];
        // Ore reads as a brighter seam in the same band, not a separate colour,
        // so a vein still looks like the rock it is embedded in.
        rgb = grade > 0
          ? [Math.min(255, band[0] + 40 + grade * 26),
             Math.min(255, band[1] + 34 + grade * 22),
             Math.min(255, band[2] + 10 + grade * 12)]
          : band;
      } else {
        rgb = r < view.skyRows ? sky : cave;
      }
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/* Which renderer this screen gets.
 *
 * Keyed on whether the screen is DRIVING A DIGGER, and deliberately not on
 * `viewRole`. The shell sets `sceneRole = isHost ? 'display' : role`, so a host
 * is 'display' even while playing — which sent a solo player, and anyone
 * hosting from the machine they play on, to the schematic. It reads as the art
 * never having been wired up at all.
 *
 * `playerId` is the honest question: non-null for anyone holding a seat, null
 * for a watch-only host or a spectator. The shell already draws the same
 * distinction one line up, where a host with a seat gets PersonalView rather
 * than DisplayView.
 *
 * Latched for the life of the mount. Swapping renderers mid-round would tear
 * down a canvas and rebuild every terrain chunk, and the seat cannot change
 * within a round anyway. */
export function PhonedigScene(props: SceneViewProps<Settings, PublicView, PrivateView>) {
  const digging = useRef(props.playerId !== null).current;
  return digging ? <FieldScene {...props} /> : <SchematicScene {...props} />;
}

/* ── the phone: the real renderer ─────────────────────────────────────── */

function FieldScene(props: SceneViewProps<Settings, PublicView, PrivateView>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scope = new ResourceScope(props.signal);

    /* view.ts is a module singleton — one canvas, one camera, one terrain
     * cache. That is correct for a client showing one shaft, and it means the
     * mount has to be symmetric: every init() is paired with a dispose(), or a
     * remount inherits the previous round's chunks. */
    view.init(canvas, canvas.parentElement);
    scope.defer(() => view.dispose());

    const observer = new ResizeObserver(() => view.resize());
    observer.observe(canvas);
    scope.defer(() => observer.disconnect());

    const adapter = createAdapter();
    const sound = createSound();
    scope.defer(sound.attach());
    // Opt-in diagnostics: `?pdperf`. A no-op returning a no-op when off.
    scope.defer(perf.mount(canvas.parentElement));
    const buffer = new SnapshotBuffer<DecodedView>(100, 32, PRESENTATION);
    scope.listen(document, 'visibilitychange', () => { if (document.hidden) buffer.clear(); });
    let lastSnapshot: number | null = null;
    let latest: DecodedView | null = null;
    /* Events are replayed by sequence, so a resent snapshot costs nothing and a
     * dropped one costs only the effects it carried. Starts at -1 rather than
     * 0 because seq 0 is a real event. */
    let seenSeq = -1;

    /* A throw inside this loop used to end the game.
     *
     * `requestAnimationFrame` is scheduled at the BOTTOM of the body, so an
     * exception anywhere above it — a decode, an adapter, a voice handed a bad
     * number — unwound past the reschedule and the loop simply never ran again.
     * The canvas then froze on its last painted frame: digger, monsters and
     * rocks all stopped, while React carried on updating the HUD from live
     * snapshots. That reads as "the game froze" and points at the simulation,
     * which is the one place it was not.
     *
     * So: the loop always reschedules, and the first fault is reported once.
     * Frame N+1 usually draws fine, because most faults are a bad value in one
     * snapshot rather than a broken renderer. */
    /* Phones only. Sustained slow frames lower resolution and effect volume a
     * tier at a time; snapshot underruns are not an input. */
    const governor = matchMedia('(pointer: coarse)').matches ? new QualityGovernor(view.QUALITY_TIERS) : null;
    let lastFrameAt = performance.now(), shownTier = 0, failedFrames = 0;
    scope.defer(() => vfx.setBudget(EFFECT_BUDGET[0]));
    const frame = (now: number) => {
      if (governor) {
        const tier = governor.frame(now - lastFrameAt, now);
        lastFrameAt = now;
        if (tier !== shownTier) { shownTier = tier; view.setQualityTier(tier); vfx.setBudget(EFFECT_BUDGET[tier]); }
      }
      const t0 = perf.now();
      perf.frameStart(t0);
      try { draw(); failedFrames = 0; } catch (error) {
        report(error);
        if (++failedFrames === PERSISTENT_FAILURE_FRAMES && !props.signal.aborted) live.current.onError(error);
      }
      perf.frameEnd(t0);
      handle = requestAnimationFrame(frame);
    };

    let faulted = false, soundFaulted = false;
    /* Sound is isolated from drawing: a voice handed a bad value used to throw
     * out of draw() before view.render, freezing the canvas every frame. */
    const reportSound = (error: unknown) => {
      if (soundFaulted) return;
      soundFaulted = true;
      console.error('[phonedig] sound failed; drawing continues', error);
    };
    /* Logged, NOT reported to the shell.
     *
     * `onError` stops the round and tells the room the host cannot render the
     * game — which is right for a renderer that will never work, and wrong for
     * one bad frame. Most faults here are a single snapshot carrying a value
     * something downstream did not expect, and frame N+1 draws correctly. Ending
     * the shift over it would turn a flicker into a lost run. */
    const report = (error: unknown) => {
      if (faulted) return;            // one report, not sixty a second
      faulted = true;
      console.error('[phonedig] render frame failed; the loop continues', error);
    };

    const draw = () => {
      const p = live.current;
      const raw = p.publicView;
      if (raw) {
        if (p.snapshotTime !== null && p.snapshotTime !== lastSnapshot) {
          lastSnapshot = p.snapshotTime;
          const next = decode(raw);
          /* The buffer samples behind the newest snapshot, so a new world would
           * otherwise draw the old world's entities over freshly generated ground. */
          if (latest && !sameWorld(latest, next)) buffer.clear();
          latest = next;
          buffer.push(p.snapshotTime, latest, performance.now());
          perf.snapshot();
        } else if (!latest) {
          latest = decode(raw);
        }
        const tBlend = perf.now();
        /* Running past the newest snapshot means showing it frozen. Counted,
         * because it looks exactly like a slow frame and has the opposite fix. */
        if (perf.on && lastSnapshot !== null) {
          const ahead = p.serverNowMs() - buffer.delayMs - lastSnapshot;
          if (ahead > 0) perf.underrun(ahead);
        }
        const shown = buffer.sample(p.serverNowMs(), (a, b, k) => blend(a, b, k)) ?? latest;
        perf.add('blend', tBlend);

        const tBuild = perf.now();
        const drawn = adapter.build(raw, shown, p.playerId);
        perf.add('adapter', tBuild);
        // Before the events below: a world change must clear the OLD world's effects.
        view.syncWorld(drawn);

        /* Dust, sparks, shockwaves and popups are made HERE, from the event
         * channel, and never cross the wire: sixty frames a second of particles
         * would dwarf the rest of the snapshot, and every phone wants its own
         * anyway. Read off the raw snapshot rather than the blended one — an
         * interpolated frame is a copy and would replay the same events.
         *
         * The same list drives the ears. Upstream runs both off one loop for
         * the same reason: an event with no entry in either table is silently
         * ignored, so a new event type is one row in each and nothing here. */
        for (const e of raw.events) {
          if (e.seq <= seenSeq) continue;
          seenSeq = e.seq;
          vfx.emit(e.type, e.x, e.y, e.value);
        }
        const tSound = perf.now();
        try { sound.play(raw.events); sound.ambient(raw, p.playerId); } catch (error) { reportSound(error); }
        perf.add('sound', tSound);

        const tRender = perf.now();
        view.render(drawn, 1);
        perf.add('render', tRender);
      }
    };
    let handle = requestAnimationFrame(frame);
    scope.defer(() => cancelAnimationFrame(handle));

    if (!props.signal.aborted) props.onReady();
    return scope.dispose;
  }, [props.roundId, props.signal]);

  return <canvas ref={canvasRef} className="pd-canvas" />;
}

/* ── the shared screen: the whole shaft at a glance ───────────────────── */

function SchematicScene(props: SceneViewProps<Settings, PublicView, PrivateView>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scope = new ResourceScope(props.signal);
    const g = canvas.getContext('2d');
    if (!g) { props.onError(new Error('This browser has no 2D canvas.')); return scope.dispose; }

    const field = document.createElement('canvas');
    field.width = GW; field.height = GH;
    const ground = createGround();
    let painted = -1;

    /* The shared screen draws no particles but is usually the only speakers in
     * the room, so it still gets the full mix. With no digger of its own the
     * ambient bed follows whoever is worst off, which is the right thing for a
     * screen four people are watching. */
    const sound = createSound();
    scope.defer(sound.attach());

    const buffer = new SnapshotBuffer<DecodedView>(100, 32, PRESENTATION);
    scope.listen(document, 'visibilitychange', () => { if (document.hidden) buffer.clear(); });
    let camX = 0, camY = 0, started = false;
    let lastSnapshot: number | null = null;
    let latestFrame: DecodedView | null = null;

    let cssW = 1, cssH = 1, dpr = 1;
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      cssW = Math.max(1, Math.floor(box.width));
      cssH = Math.max(1, Math.floor(box.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    scope.defer(() => observer.disconnect());

    let last = performance.now();
    let faulted = false, soundFaulted = false, failedFrames = 0;
    /* Same reasoning as the field renderer above: the loop must outlive a bad
     * frame. On the shared screen it matters more, not less — nobody watching a
     * TV can reload it. */
    const frame = (now: number) => {
      try { draw(now); failedFrames = 0; } catch (error) {
        if (!faulted) {
          faulted = true;
          console.error('[phonedig] display frame failed; the loop continues', error);
        }
        if (++failedFrames === PERSISTENT_FAILURE_FRAMES && !props.signal.aborted) live.current.onError(error);
      }
      handle = requestAnimationFrame(frame);
    };

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const p = live.current;
      const view = p.publicView;
      if (view) {
        if (p.snapshotTime !== null && p.snapshotTime !== lastSnapshot) {
          lastSnapshot = p.snapshotTime;
          const next = decode(view);
          if (latestFrame && !sameWorld(latestFrame, next)) buffer.clear();
          latestFrame = next;
          buffer.push(p.snapshotTime, latestFrame, performance.now());
        } else if (!latestFrame) {
          latestFrame = decode(view);
        }
        const shown = buffer.sample(p.serverNowMs(), (a, b, k) => blend(a, b, k)) ?? latestFrame;

        try { sound.play(view.events); sound.ambient(view, p.playerId); } catch (error) {
          if (!soundFaulted) { soundFaulted = true; console.error('[phonedig] display sound failed; drawing continues', error); }
        }

        const t = ground.update(view);
        if (painted !== t.revision) { paintField(field, view, t); painted = t.revision; }

        /* The WHOLE shaft across, and as much of it down as the crew needs.
         *
         * Nothing here is locked to VIS_COLS. A phone is; that is the width the
         * game was tuned at and the reason the field renderer pans. This screen
         * has the opposite job — it exists so a crew spread across sixty lanes
         * can see each other — so it fits the full played width and then zooms
         * out vertically until everyone is in frame.
         *
         * A fractional scale makes every dirt edge shimmer as it scrolls, so
         * the scale is integer device pixels and the origin is quantised to
         * one. It shows worse horizontally than vertically, because the strata
         * are horizontal bands and a sub-pixel pan crawls all of them at once. */
        let lo = Infinity, hi = -Infinity;
        for (const q of shown.players) {
          if (q.y < lo) lo = q.y;
          if (q.y + 2 > hi) hi = q.y + 2;
        }
        const spread = hi > lo ? hi - lo : 0;
        const wantRows = Math.max(DISPLAY_MIN_ROWS,
                                  Math.min(GH, spread + DISPLAY_MARGIN * 2));

        const k = Math.max(1, Math.min(
          Math.floor((cssW * dpr) / (shown.activeGW + 2)),
          Math.floor((cssH * dpr) / wantRows),
        ));
        const scale = k / dpr;
        const visRows = cssH / scale;
        const visCols = Math.min(shown.activeGW, cssW / scale);

        /* Centred on the CREW, not on any one digger. There is usually nobody
         * whose screen this is — the host is often watching rather than playing
         * — and even when there is, following them would be the phone's job
         * done worse. */
        const mid = (lo + hi) / 2;
        const wantY = Math.max(0, Math.min(GH - visRows,
                                           (spread ? mid : 0) - visRows / 2));
        const wantX = Math.max(0, Math.min(shown.activeGW - visCols,
                                           shown.activeGW / 2 - visCols / 2));
        if (!started) { camY = wantY; camX = wantX; started = true; }
        else {
          if (Math.abs(wantY - camY) > DEADZONE / 2) camY += (wantY - camY) * Math.min(1, FOLLOW_K * dt);
          if (Math.abs(wantX - camX) > DEADZONE) camX += (wantX - camX) * Math.min(1, FOLLOW_K * dt);
        }
        const snap = scale * dpr;
        const top = Math.round(camY * snap) / snap;
        const left = Math.round(camX * snap) / snap;
        // The viewport's left edge on screen, and the world origin relative to
        // it. Everything else draws through ox, so the pan falls out for free.
        const vx = Math.round(((cssW - visCols * scale) / 2) * dpr) / dpr;
        const ox = vx - left * scale;

        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.imageSmoothingEnabled = false;
        const theme = THEME_BY_ID[shown.theme] ?? THEMES[0];
        g.fillStyle = theme.cave;
        g.fillRect(0, 0, cssW, cssH);
        g.drawImage(field, ox, -top * scale, GW * scale, GH * scale);
        // Gutters mask everything outside the viewport, including the rest of
        // a shaft that is now far wider than the screen.
        g.fillStyle = '#05071a';
        g.fillRect(0, 0, vx, cssH);
        g.fillRect(vx + visCols * scale, 0, cssW - (vx + visCols * scale), cssH);

        const sx = (x: number) => ox + x * scale;
        const sy = (y: number) => (y - top) * scale;
        const box = (x: number, y: number, w: number, h: number, fill: string) => {
          g.fillStyle = fill;
          g.fillRect(sx(x), sy(y), w * scale, h * scale);
        };

        for (const z of shown.hazards) {
          if (z.warnT > 0) box(z.lc * 2, z.lr * 2, 2, 2, 'rgba(255,210,74,.5)');
        }
        if (shown.relicSite) box(shown.relicSite.x, shown.relicSite.y, 2, 2, '#b58aff');
        if (shown.crystalAt) box(shown.crystalAt.lc * 2, shown.crystalAt.lr * 2, 2, 2, '#28c6e7');
        if (shown.bonus) box(shown.bonus.x, shown.bonus.y, 2, 2, '#ffd24a');
        for (const r of shown.rocks) {
          box(r.x, r.y, 2, 2, r.state === 'wobble' ? '#b9b0a4' : '#8b8378');
        }
        for (const f of shown.fire) box(f.x, f.y, f.w, f.h, 'rgba(255,87,72,.75)');
        for (const w of shown.wheels) box(w.x, w.y, 2, 2, '#ff90ba');
        for (const m of shown.monsters) {
          const tone = m.hunting ? '#ff5748' : m.kind === 'fygar' ? '#ffa260' : '#b58aff';
          g.globalAlpha = m.mode === 'ghost' || m.mode === 'ghostwind' ? 0.45 : 1;
          box(m.x, m.y, 2, 2, tone);
          if (m.pump > 0) {
            box(m.x, m.y - 0.5, 2 * (m.pump / Math.max(1, m.stages)), 0.4, '#ffd24a');
          }
          g.globalAlpha = 1;
        }
        for (const h of shown.harpoons) {
          const horiz = h.dir === 1 || h.dir === 3;
          const len = Math.max(0.2, h.len);
          box(h.dir === 3 ? h.x - len : h.x + (h.dir === 1 ? 2 : 0),
              h.dir === 0 ? h.y - len : h.y + (h.dir === 2 ? 2 : 0),
              horiz ? len : 2, horiz ? 2 : len, '#fff6e5');
        }
        /* Each digger wears the colour the room already gave them, so the
         * watching screen and the phones agree on who is who without anyone
         * having to read a name off a 6px square. The local digger gets a ring
         * as well, because on a shared display colour alone is not enough to
         * find yourself in a crowded shaft. */
        for (const q of shown.players) {
          if (q.drilling && shown.phase !== 'descend') continue;
          g.globalAlpha = q.dying ? 0.35 : q.invuln > 0 ? 0.55 : 1;
          /* The suit is the identity once they have picked one; the room's
           * colour stands in until then, which is what the kit-up screen is
           * showing anyway. */
          const worn = (q.suit && SUIT_BY_ID[q.suit]?.swatch) || q.color;
          if (q.downed) {
            /* Down reads as a flat, halved bar rather than a body: it has to be
             * distinguishable from a standing digger at a glance and from three
             * metres away, which a dimmed square is not. */
            g.globalAlpha = 1;
            box(q.x, q.y + 1, 2, 1, worn);
            const held = q.reviveProgress;
            if (held > 0) box(q.x, q.y + 0.6, 2 * held, 0.35, '#fff6e5');
          } else {
            box(q.x, q.y, 2, 2, worn);
          }
          if (q.id === p.playerId) {
            g.globalAlpha = 1;
            g.strokeStyle = '#fff6e5';
            g.lineWidth = Math.max(1, scale * 0.2);
            g.strokeRect(sx(q.x) - scale * 0.2, sy(q.y) - scale * 0.2,
                         2 * scale + scale * 0.4, 2 * scale + scale * 0.4);
          }
          g.globalAlpha = 1;
        }

        /* Someone off the top or bottom of the screen is invisible in a shaft
         * 160 rows deep, and a downed teammate you cannot find is a teammate
         * you cannot save. An edge marker points at them and counts down. */
        for (const q of shown.players) {
          if (!q.downed || q.id === p.playerId) continue;
          const offY = q.y < top - 2 ? -1 : q.y > top + visRows ? 1 : 0;
          const offX = q.x < left - 2 ? -1 : q.x > left + visCols ? 1 : 0;
          if (!offX && !offY) continue;
          const pad = scale * 1.2;
          const ex = offX < 0 ? vx + pad
            : offX > 0 ? vx + visCols * scale - pad
            : Math.min(vx + visCols * scale - pad, Math.max(vx + pad, ox + (q.x + 1) * scale));
          const ey = offY < 0 ? pad
            : offY > 0 ? cssH - pad
            : Math.min(cssH - pad, Math.max(pad, (q.y + 1 - top) * scale));
          g.fillStyle = (q.suit && SUIT_BY_ID[q.suit]?.swatch) || q.color;
          g.beginPath();
          // Point along whichever axis they are off, corners included.
          const ax = offX || 0, ay = offY || 0;
          const len = Math.hypot(ax, ay) || 1;
          const ux = ax / len, uy = ay / len;
          g.moveTo(ex + ux * scale * 0.8, ey + uy * scale * 0.8);
          g.lineTo(ex - ux * scale * 0.5 - uy * scale * 0.6, ey - uy * scale * 0.5 + ux * scale * 0.6);
          g.lineTo(ex - ux * scale * 0.5 + uy * scale * 0.6, ey - uy * scale * 0.5 - ux * scale * 0.6);
          g.closePath();
          g.fill();
          g.fillStyle = '#fff6e5';
          g.font = `${Math.round(scale * 0.9)}px sans-serif`;
          g.textAlign = 'center';
          g.fillText(`${Math.ceil(q.downT)}s`, ex - ux * scale * 1.6, ey - uy * scale * 1.6 + scale * 0.3);
        }
      }
    };
    let handle = requestAnimationFrame(frame);
    scope.defer(() => cancelAnimationFrame(handle));

    /* Ready NOW, not from inside the frame loop.
     *
     * requestAnimationFrame does not fire in a hidden tab, and a phone with its
     * screen off is a hidden tab. Reporting readiness from the first rendered
     * frame therefore meant a player who looked away during preparation never
     * reported at all — and the barrier waits for every screen, so one dark
     * phone failed the round for the whole room after a twenty-second timeout.
     *
     * A 3D scene has shaders to compile and a first frame worth waiting for.
     * This one has a canvas and a context; once they exist there is nothing
     * left to warm up, so the honest answer is immediately. */
    if (!props.signal.aborted) props.onReady();
    return scope.dispose;
  }, [props.roundId, props.signal]);

  return <canvas ref={canvasRef} className="pd-canvas" />;
}

export default PhonedigScene;
