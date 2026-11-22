/* One renderer, two framings.
 *
 * A phone follows its own digger through its own crew's shaft. The shared
 * screen is a broadcast of whichever shaft the server has it on, with a camera
 * that goes to where the story is. Both rebuild the same terrain from seed plus
 * delta and draw it with the same sprites, lamp and effects — the shared screen
 * used to be a schematic of coloured boxes, which is the one place nobody at a
 * party should have to look at a schematic.
 *
 * Viewport size stays in presentation and never changes the simulation. */

import { useEffect, useRef } from 'react';
import { ResourceScope } from '../../../party-runtime/src/index';
import { QualityGovernor, SnapshotBuffer } from '../../../party-runtime/src/index';
import type { SceneViewProps } from '../../../party-ui/src/index';
import type { PlayerId } from '../../../party-contract/src/index';
import { THEME_BY_ID } from './themes';
import { crewOf } from './crews';
import type { PrivateView, PublicView, Settings } from './model';
import { blend, createAdapter, createReader, remember, sameWorld } from './viewstate';
import type { ShaftView } from './viewstate';
import * as view from './view';
import * as vfx from './vfx';
import { createSound } from './sound';
import * as perf from './perf';

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
/** The broadcast camera stays with one digger about this long when nothing is happening. */
const FOCUS_SECONDS = 7;

/* Who the broadcast camera is on.
 *
 * A crew is up to four people in a shaft far taller than the screen, so the
 * camera cannot simply hold them all. It goes to whoever has the most going on
 * — somebody being pulled up, somebody on the floor, a fight — and otherwise
 * takes turns, so everyone at the party gets watched. Presentation only: the
 * server decides which SHAFT is shown, this decides where in it to look. */
function createDirector() {
  let on: PlayerId | null = null, since = 0;
  const interest = (v: ShaftView, id: PlayerId) => {
    const q = v.players.find(p => p.id === id);
    if (!q || q.dying) return -1;
    if (q.downed) return q.reviveProgress > 0 ? 6 : 5;
    const line = v.harpoons.find(h => h.ownerId === id);
    if (line?.state === 'hit') return 4;
    const hunted = v.monsters.some(m => m.hunting && !m.dying && Math.abs(m.x - q.x) + Math.abs(m.y - q.y) < 12);
    return hunted ? 3 : q.digging || q.moving ? 1 : 0;
  };
  return (v: ShaftView, now: number): PlayerId | null => {
    let best: PlayerId | null = null, top = -1;
    const start = Math.max(0, v.players.findIndex(p => p.id === on));
    // Walk the crew starting AFTER the current one, so a tie hands on rather than staying.
    for (let i = 1; i <= v.players.length; i++) {
      const p = v.players[(start + i) % v.players.length];
      const score = interest(v, p.id);
      if (score > top) { top = score; best = p.id; }
    }
    const held = on === null ? -1 : interest(v, on);
    const tired = now - since > FOCUS_SECONDS * 1000;
    if (on === null || held < 0 || top >= held + 2 || (tired && top >= held)) {
      if (best !== on) since = now;
      on = best;
    }
    return on;
  };
}

/* Which framing this screen gets.
 *
 * Keyed on whether the screen is DRIVING A DIGGER, and deliberately not on
 * `viewRole`. The shell sets `sceneRole = isHost ? 'display' : role`, so a host
 * is 'display' even while playing — which would send a solo player, and anyone
 * hosting from the machine they play on, to the broadcast.
 *
 * `playerId` is the honest question: non-null for anyone holding a seat, null
 * for a watch-only host or a spectator. The shell already draws the same
 * distinction one line up, where a host with a seat gets PersonalView rather
 * than DisplayView.
 *
 * Latched for the life of the mount: the seat cannot change within a round. */
export function PhonedigScene(props: SceneViewProps<Settings, PublicView, PrivateView>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const broadcast = useRef(props.playerId === null).current;
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scope = new ResourceScope(props.signal);

    /* view.ts is a module singleton — one canvas, one camera, one terrain
     * cache. That is correct for a client showing one shaft, and it means the
     * mount has to be symmetric: every init() is paired with a dispose(), or a
     * remount inherits the previous round's chunks. */
    view.init(canvas, canvas.parentElement, { broadcast });
    scope.defer(() => { view.dispose(); vfx.clear(); });

    const observer = new ResizeObserver(() => view.resize());
    observer.observe(canvas.parentElement ?? canvas);
    scope.defer(() => observer.disconnect());

    const reader = createReader(), adapter = createAdapter(), director = createDirector();
    /* The shared screen is usually the only speakers in the room, so it gets
     * the full mix too. With no digger of its own the ambient bed follows
     * whoever is worst off, which is right for a screen a room is watching. */
    const sound = createSound();
    scope.defer(sound.attach());
    // Opt-in diagnostics: `?pdperf`. A no-op returning a no-op when off.
    scope.defer(perf.mount(canvas.parentElement));
    const buffer = new SnapshotBuffer<ShaftView>(100, 32, PRESENTATION);
    scope.listen(document, 'visibilitychange', () => { if (document.hidden) buffer.clear(); });
    let lastSnapshot: number | null = null;
    let latest: ShaftView | null = null;
    /* Events are replayed by sequence, so a resent snapshot costs nothing and a
     * dropped one costs only the effects it carried. Starts at -1 rather than
     * 0 because seq 0 is a real event. Sequences are per shaft. */
    let seenSeq = -1, seenShaft = '', askedAt = 0, kitting = false;

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
      vfx.setBudget(motion.matches ? 1 : EFFECT_BUDGET[shownTier]);
      const t0 = perf.now();
      perf.frameStart(t0);
      try { draw(now); failedFrames = 0; } catch (error) {
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

    const draw = (now: number) => {
      const p = live.current;
      const raw = p.publicView;
      if (!raw) return;
      if ((p.snapshotTime !== null && p.snapshotTime !== lastSnapshot) || !latest) {
        const next = reader.read(raw, p.privateView, remember(p.roundId, raw.roster));
        /* The buffer samples behind the newest snapshot, so a new world would
         * otherwise draw the old world's entities over freshly generated ground. */
        if (latest && !sameWorld(latest, next)) buffer.clear();
        latest = next;
        if (p.snapshotTime !== null) {
          lastSnapshot = p.snapshotTime;
          buffer.push(p.snapshotTime, latest, performance.now());
          perf.snapshot();
        }
        /* A phone that slept through more than the journal's tail has a hole in
         * its ground. Ask for all of it — once a second at most, because the
         * answer rides on the next snapshot and asking again cannot hurry it. */
        if (reader.ground()?.gap && now - askedAt > 1000) {
          askedAt = now;
          void p.sendAction({ type: 'sync', turnId: 1 }).catch(() => {});
        }
      }
      const g = reader.ground();
      if (!g) return;
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
      const follow = broadcast ? director(shown, now) : p.playerId;
      const drawn = adapter.build(g, shown, follow, p.playerId);
      perf.add('adapter', tBuild);
      // Before the events below: a world change must clear the OLD world's effects.
      if (view.syncWorld(drawn)) {
        /* Say where we are. Every arrival is a new biome or a deeper cut of the
         * same one, and the broadcast also says whose shaft it has gone to. */
        const theme = THEME_BY_ID[shown.theme]?.name ?? '';
        const crew = crewOf(shown.crew);
        const shaft = `${shown.crew}.${shown.run}`;
        if (broadcast && raw.crewCount > 1 && shaft !== seenShaft) vfx.announce(crew.name, `Level ${shown.level} · ${theme}`, crew.color, 2.4, 0.5);
        else if (!raw.kitup) vfx.announce(`Level ${shown.level}`, theme, 'text', 1.8);
      }
      // The drill starting is an arrival too; the shaft was only waiting behind the picker.
      if (kitting && !raw.kitup) vfx.announce(`Level ${shown.level}`, THEME_BY_ID[shown.theme]?.name ?? '', 'text', 1.8);
      kitting = !!raw.kitup;

      /* Dust, sparks, shockwaves and popups are made HERE, from the event
       * channel, and never cross the wire: sixty frames a second of particles
       * would dwarf the rest of the snapshot, and every phone wants its own
       * anyway. Read off the newest snapshot rather than the blended one — an
       * interpolated frame is a copy and would replay the same events.
       *
       * The same list drives the ears. Upstream runs both off one loop for
       * the same reason: an event with no entry in either table is silently
       * ignored, so a new event type is one row in each and nothing here. */
      const shaft = `${latest.crew}.${latest.run}`;
      if (shaft !== seenShaft) { seenShaft = shaft; seenSeq = -1; }
      for (const e of latest.events) {
        if (e.seq <= seenSeq) continue;
        seenSeq = e.seq;
        vfx.emit(e.type, e.x, e.y, e.value);
      }
      const tSound = perf.now();
      try { sound.play(latest.events, shaft); sound.ambient(latest, p.playerId); } catch (error) { reportSound(error); }
      perf.add('sound', tSound);

      const tRender = perf.now();
      view.render(drawn, 1, null, motion.matches);
      perf.add('render', tRender);
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

  /* The broadcast leaves the left of the screen to the board; see .pd-stage-tv. */
  return (
    <div className={broadcast ? 'pd-stage pd-stage-tv' : 'pd-stage'}>
      <canvas ref={canvasRef} className="pd-canvas" />
    </div>
  );
}

export default PhonedigScene;
