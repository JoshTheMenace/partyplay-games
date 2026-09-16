/* The ears: the mixer, the score, and the bit that joins them to the round.
 *
 * `audio.ts` and `music.ts` are ported whole from upstream and know nothing
 * about the platform. This module is the join, and it exists so scene.tsx stays
 * about drawing: it owns the unlock gesture, follows the shell's mute toggle,
 * plays whatever is new on the event channel, and retunes the ambient bed from
 * the snapshot.
 *
 * ── one mix per screen, on purpose ────────────────────────────────────────
 * Every phone renders its own. The events are already on every client for the
 * particles, the synthesis is procedural with no asset files, and a mix made on
 * the device can follow THAT player's air — which is what the bed's intensity
 * is, and it is personal. A single mix on the shared screen would be the wrong
 * answer to a question nobody asked.
 *
 * ── the shell owns the volume ─────────────────────────────────────────────
 * There is exactly one sound control in this app and it is in the header. The
 * shell writes `party.sound.muted` and fires a `party-sound` event; this module
 * reads both and adds no control of its own. Browsers also require a gesture
 * before audio starts, so `unlock` rides on the first pointer or key event —
 * the same shape kart-party uses.
 */

import * as audio from './audio';
import * as music from './music';
import { DEPTH_PER_LEVEL } from './worldgen';
import type { NetEvent, PublicView } from './model';
import type { PlayerId } from '../../../party-contract/src/index';

/* How deep the bed treats as "as cold as it gets". Twelve levels of shaft,
 * which is past where most runs end — the point is that the bed keeps
 * descending with you rather than resetting at every arrival. */
const FULL_DEPTH = DEPTH_PER_LEVEL * 12;

function mutedInShell() {
  try { return localStorage.getItem('party.sound.muted') === 'true'; } catch { return false; }
}

export type Sound = ReturnType<typeof createSound>;

export function createSound() {
  /* Events are replayed by sequence, so a resent snapshot costs nothing and a
   * dropped one costs only what it carried. -1 rather than 0 because seq 0 is a
   * real event. */
  let seen = -1;
  let live = false;

  const unlock = () => {
    audio.setMuted(mutedInShell());
    audio.unlock();
    live = audio.ready();
  };
  const follow = (event: Event) => {
    const wanted = (event as CustomEvent<{ muted: boolean }>).detail?.muted;
    audio.setMuted(!!wanted);
    if (!wanted) unlock();
  };

  return {
    /** Installs the listeners and returns the teardown. */
    attach() {
      unlock();
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
      window.addEventListener('party-sound', follow);
      return () => {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('party-sound', follow);
        /* Silence anything sounding and let the bed go. The context itself is
         * left alive: it is the page's, not the round's, and tearing one down
         * per round would eventually exhaust the browser's supply. */
        audio.panic();
        audio.stopAmbient(0.6);
      };
    },

    /* Everything newer than the last event this screen heard.
     *
     * Deliberately takes the RAW snapshot, not an interpolated one: a blended
     * frame is a copy of the newer of two and would replay its events. */
    play(events: readonly NetEvent[]) {
      if (!live) { for (const e of events) if (e.seq > seen) seen = e.seq; return; }
      for (const e of events) {
        if (e.seq <= seen) continue;
        seen = e.seq;
        audio.play(e.type, e);
      }
    },

    /* The bed follows the descent, and is retuned rather than restarted so it
     * slides between biomes instead of cutting.
     *
     * `intensity` is the pressure the player is under, which is what the air
     * budget already measures — so it is read off THIS screen's digger, and off
     * whoever is worst off when this screen has no digger of its own. Cheap
     * enough to call every frame; it only schedules ramps. */
    ambient(view: PublicView, localId: PlayerId | null) {
      if (!live || view.phase === 'gameover') return;
      const me = view.players.find(q => q.id === localId);
      let air = 1;
      if (me) air = me.airMax > 0 ? me.air / me.airMax : 1;
      else for (const q of view.players) {
        if (q.airMax > 0) air = Math.min(air, q.air / q.airMax);
      }
      audio.setAmbient({
        theme: view.theme,
        depth: Math.min(1, view.depth / FULL_DEPTH),
        intensity: 0.55 + 0.45 * (1 - air),
      });
    },

    /** For the results screen and for leaving: let the bed down gently. */
    fade(seconds = 2.5) { music.stop(seconds); },
  };
}
