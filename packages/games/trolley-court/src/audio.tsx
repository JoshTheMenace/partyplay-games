/**
 * Trolley Court audio. Only the host's watching display speaks: AudioView plays every server cue (view.cues) — SFX, Clerk
 * lines and card read-aloud — so views never call sayLine/sayCard for server-cued moments. Phones may call cue() for tiny
 * local tap feedback. Never receives private state, honours the shared `party-sound` mute preference and never throws.
 * Buses: bed (reserved for a future music bed) and sfx duck while the Clerk speaks; everything runs through a limiter.
 */
import { useEffect } from 'react';
import type { GameAudioProps } from '../../../party-ui/src/index';
import { manifest } from './manifest';
import { LINES } from './narration';
import { SFX_IDS, type Card, type LineId, type PublicView, type SfxId } from './types';
import { VO } from './vo-manifest';

const BASE = manifest.assetBase, LEVEL = { bed: .35, sfx: .75, vo: 1, phone: .45 }, DUCK = { bed: 10 ** (-10 / 20), sfx: 10 ** (-4 / 20) };
/** Cues older than this are history; queued narration older than MAX_WAIT_MS is dropped instead of talking over the next beat. */
const STALE_MS = 4000, MAX_WAIT_MS = 8000;
/** Crash choreography: ms after the cue, matched to display.tsx (trolley rolls at 1.3 s, first hit ≈ 2.35 s, ribbon 4.6 s). */
const DELAY: Partial<Record<SfxId | LineId, number>> = { bell: 100, rumble: 1000, crash: 2250, gasp: 3500, aww: 3500, struck: 4400 };
/** Minimum ms between two plays of one effect. */
const COOLDOWN: Partial<Record<SfxId, number>> = { tick: 150, cheer: 1500, gasp: 700, aww: 1200, drumroll: 1500, rumble: 1500, crash: 1000 };
const SFX_SET = new Set<string>(SFX_IDS);
const isMuted = () => { try { return localStorage.getItem('party.sound.muted') === 'true'; } catch { return false; } };
const attempt = <T,>(fn: () => T): T | undefined => { try { return fn(); } catch { return undefined; } };

/** Fetch + decode, cached (LRU when limited). Missing or undecodable files resolve to null and stay silent. */
class Buffers {
  private map = new Map<string, Promise<AudioBuffer | null>>();
  constructor(private ctx: BaseAudioContext, private signal: AbortSignal, private limit = Infinity) {}
  get(path: string) {
    let p = this.map.get(path);
    if (p) this.map.delete(path);
    else p = fetch(BASE + path, { signal: this.signal }).then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(data => this.ctx.decodeAudioData(data)).catch(() => null);
    this.map.set(path, p);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value!);
    return p;
  }
}

type Spoken = { vo?: string; text?: string; queued: number };

class Mixer {
  private ctx = new AudioContext(); private abort = new AbortController();
  private bed: GainNode; private sfxBus: GainNode; private voBus: GainNode; private limiter: DynamicsCompressorNode;
  private sfx: Buffers; private vo: Buffers;
  private last = new Map<string, number>(); private voices = 0; private timers = new Set<number>();
  private queue: Spoken[] = []; private speaking: (() => void) | null = null; private unduckTimer = 0;
  private lastSeq = 0; private seeded = false; private round: string | null = null; private phase: string | null = null;
  private muted = isMuted(); private disposed = false; private voice: SpeechSynthesisVoice | null | undefined;

  /** host: the watching display (preloads, narrates, unlocks on any interaction); otherwise a phone's quiet tap player. */
  constructor(private host: boolean) {
    const ctx = this.ctx, master = ctx.createGain(), trim = ctx.createGain(), l = this.limiter = ctx.createDynamicsCompressor();
    this.bed = ctx.createGain(); this.sfxBus = ctx.createGain(); this.voBus = ctx.createGain();
    l.threshold.value = -8; l.knee.value = 6; l.ratio.value = 12; l.attack.value = .003; l.release.value = .25;
    this.bed.gain.value = LEVEL.bed; this.sfxBus.gain.value = host ? LEVEL.sfx : LEVEL.phone; this.voBus.gain.value = LEVEL.vo; trim.gain.value = 10 ** (-2 / 20);
    for (const bus of [this.bed, this.sfxBus, this.voBus]) bus.connect(master);
    master.connect(l).connect(trim).connect(ctx.destination);
    this.sfx = new Buffers(ctx, this.abort.signal); this.vo = new Buffers(ctx, this.abort.signal, 48);
    window.addEventListener('party-sound', this.preference);
    if (!host) return;
    for (const id of SFX_IDS) void this.sfx.get(`sfx/${id}.mp3`);
    for (const id of Object.keys(VO)) if (!id.startsWith('card.')) void this.vo.get(`vo/${id}.mp3`);
    for (const e of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(e, this.unlock);
    window.addEventListener('pagehide', this.silence); document.addEventListener('visibilitychange', this.visibility);
    globalThis.speechSynthesis?.addEventListener?.('voiceschanged', this.voicesChanged);
    if (this.audible()) this.unlock(); else void ctx.suspend().catch(() => {});
  }
  private audible() { return !this.disposed && !this.muted && !document.hidden; }
  private unlock = () => { if (this.audible() && this.ctx.state !== 'running') void this.ctx.resume().then(() => this.next()).catch(() => {}); };
  private preference = (e: Event) => { this.muted = !!(e as CustomEvent<{ muted?: boolean }>).detail?.muted; if (this.muted) this.silence(); else if (this.host) this.unlock(); };
  private visibility = () => { if (document.hidden) this.silence(); else this.unlock(); };
  /** Drops queued narration and pending effects, then pauses the context. */
  private silence = () => { this.clearSpeech(); this.clearTimers(); void this.ctx.suspend().catch(() => {}); };
  private voicesChanged = () => { this.voice = undefined; };
  private later(ms: number, fn: () => void) { if (ms <= 0) return fn(); const t = window.setTimeout(() => { this.timers.delete(t); fn(); }, ms); this.timers.add(t); }
  private clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }

  /** One effect now, with slight pitch/gain variation, per-id rate limiting and a voice cap. A late effect is worse than none. */
  play(id: SfxId, gain = 1) {
    if (!SFX_SET.has(id) || !this.audible()) return;
    if (!this.host && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {}); // Phones: called inside the tap.
    const now = performance.now();
    if (this.voices >= 16 || now - (this.last.get(id) ?? -Infinity) < (COOLDOWN[id] ?? 70)) return;
    this.last.set(id, now);
    void this.sfx.get(`sfx/${id}.mp3`).then(buffer => {
      if (!buffer || this.ctx.state !== 'running' || !this.audible() || performance.now() - now > 800) return;
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
      src.buffer = buffer; src.playbackRate.value = 1 + (Math.random() - .5) * .05; g.gain.value = gain * (.9 + Math.random() * .1);
      src.connect(g).connect(this.sfxBus); this.voices++;
      src.onended = () => { src.disconnect(); g.disconnect(); this.voices--; };
      src.start();
    });
  }
  /** A Clerk line: a random recorded variant, else the browser voice reading its text. */
  sayLine(id: LineId) {
    const recorded = [id, `${id}.2`, `${id}.3`].filter(v => Object.hasOwn(VO, v)), vo = recorded[Math.floor(Math.random() * recorded.length)];
    this.say(vo ? { vo, queued: performance.now() } : { text: LINES[id], queued: performance.now() });
  }
  /** A card: its recording when one exists (never for write-ins), else speech synthesis of its text. */
  sayCard(card: Card) {
    const vo = `card.${card.id}`;
    this.say(!card.blank && Object.hasOwn(VO, vo) ? { vo, queued: performance.now() } : { text: card.text, queued: performance.now() });
  }
  private say(item: Spoken) { if (this.host && this.audible() && (item.vo || item.text?.trim())) { this.queue.push(item); this.next(); } }

  /** Plays new server cues once, in seq order; the first snapshot after mounting mid-game is history. */
  update(view: PublicView | null, roundId: string | null, connected: boolean, now: number) {
    if (!view) { this.seeded = true; return; }
    const cues = [...view.cues].sort((a, b) => a.seq - b.seq), max = cues.at(-1)?.seq ?? 0, prev = this.phase;
    this.phase = view.phase;
    if (!this.seeded) { this.seeded = true; this.round = roundId; this.lastSeq = max; return; }
    if (roundId !== this.round || max < this.lastSeq) { this.round = roundId; this.lastSeq = 0; }
    if (view.phase === 'complete' && prev && prev !== 'complete' && connected) this.later(900, () => this.play('cheer'));
    for (const cue of cues) {
      if (cue.seq <= this.lastSeq) continue;
      this.lastSeq = cue.seq;
      const wait = (DELAY[cue.id as SfxId] ?? 0) - (now - cue.at);
      if (!connected || wait < -STALE_MS || !this.audible()) continue;
      if (cue.kind === 'sfx') this.later(wait, () => this.play(cue.id));
      else if (cue.kind === 'line') this.later(wait, () => this.sayLine(cue.id));
      else if (view.settings.readAloud) { const card = findCard(view, cue.id); if (card) this.sayCard(card); }
    }
  }

  /** Plays the narration queue one item at a time, ducking the bed and effects while anything is spoken. */
  private next(): void {
    if (this.speaking || this.ctx.state !== 'running' || !this.audible()) return;
    const item = this.queue.shift();
    if (!item) { clearTimeout(this.unduckTimer); this.unduckTimer = window.setTimeout(() => this.duck(false), 250); return; }
    if (performance.now() - item.queued > MAX_WAIT_MS || (!item.vo && !('speechSynthesis' in globalThis))) return this.next();
    clearTimeout(this.unduckTimer); this.duck(true);
    let finished = false;
    const done = () => { if (finished) return; finished = true; this.speaking = null; this.next(); };
    if (item.vo) {
      let src: AudioBufferSourceNode | null = null;
      this.speaking = () => { finished = true; if (src) { src.onended = null; attempt(() => src!.stop()); src.disconnect(); } };
      void this.vo.get(`vo/${item.vo}.mp3`).then(buffer => {
        if (finished) return;
        if (!buffer || this.ctx.state !== 'running') return done();
        src = this.ctx.createBufferSource(); src.buffer = buffer; src.connect(this.voBus);
        src.onended = () => { src?.disconnect(); done(); }; src.start();
      });
    } else {
      const text = item.text!, u = new SpeechSynthesisUtterance(text), timer = window.setTimeout(done, 2000 + text.length * 90);
      const voice = this.pickVoice(); if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB';
      u.rate = 1.02; u.onend = u.onerror = () => { clearTimeout(timer); done(); };
      this.speaking = () => { finished = true; clearTimeout(timer); u.onend = u.onerror = null; speechSynthesis.cancel(); };
      speechSynthesis.speak(u);
    }
  }
  private duck(on: boolean) {
    const t = this.ctx.currentTime;
    for (const [bus, level] of [[this.bed, LEVEL.bed * DUCK.bed], [this.sfxBus, LEVEL.sfx * DUCK.sfx]] as const) { bus.gain.cancelScheduledValues(t); bus.gain.setTargetAtTime(on ? level : bus === this.bed ? LEVEL.bed : LEVEL.sfx, t, on ? .08 : .35); }
  }
  private clearSpeech() { this.queue = []; this.speaking?.(); this.speaking = null; if (this.host) this.duck(false); }
  /** A natural-sounding English voice when the browser has one, British first to match the Clerk. */
  private pickVoice() {
    if (this.voice !== undefined) return this.voice;
    const score = (v: SpeechSynthesisVoice) => (/natural|neural|online/i.test(v.name) ? 8 : 0) + (/google/i.test(v.name) ? 4 : 0) + (/daniel|serena|arthur|ryan|sonia|libby|moira/i.test(v.name) ? 3 : 0) + (/en[-_]gb/i.test(v.lang) ? 3 : /en[-_]us/i.test(v.lang) ? 1 : 0) + (v.localService ? 1 : 0);
    const all = speechSynthesis.getVoices();
    if (!all.length) return null; // Not loaded yet: ask again next time.
    return this.voice = all.filter(v => /^en([-_]|$)/i.test(v.lang)).sort((a, b) => score(b) - score(a))[0] ?? null;
  }

  dispose() {
    if (this.disposed) return;
    this.clearSpeech(); this.clearTimers(); this.disposed = true; this.abort.abort(); clearTimeout(this.unduckTimer);
    for (const e of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(e, this.unlock);
    window.removeEventListener('party-sound', this.preference); window.removeEventListener('pagehide', this.silence);
    document.removeEventListener('visibilitychange', this.visibility);
    globalThis.speechSynthesis?.removeEventListener?.('voiceschanged', this.voicesChanged);
    this.limiter.disconnect(); void this.ctx.close().catch(() => {});
  }
}

/** A card now visible on the tracks (slot card or attached twist). */
function findCard(view: PublicView, id: string) {
  for (const track of Object.values(view.tracks)) for (const slot of track.slots) {
    if (slot?.card.id === id) return slot.card;
    const mod = slot?.mods.find(m => m.card.id === id); if (mod) return mod.card;
  }
  return null;
}

/** The display's mixer while AudioView is active, and a phone's lazily created tap player. */
let display: Mixer | null = null, phone: Mixer | null = null;

/** GameClientModule.AudioView: mounted from lobby to results; active only when isHost && viewRole === 'display'. */
export function AudioView({ isHost, viewRole, roundId, publicView, connected, serverNowMs }: GameAudioProps<PublicView>) {
  const enabled = isHost && viewRole === 'display';
  useEffect(() => {
    if (!enabled) return;
    const mixer = attempt(() => new Mixer(true)); // No Web Audio: play silently.
    if (!mixer) return;
    display = mixer;
    return () => { mixer.dispose(); if (display === mixer) display = null; };
  }, [enabled]);
  useEffect(() => { if (enabled) attempt(() => display?.update(publicView, roundId, connected, serverNowMs())); }, [enabled, publicView, roundId, connected, serverNowMs]);
  return null;
}
/** Plays one effect now on this device (phone tap feedback or display-local animation). */
export function cue(id: SfxId, gain = 1) {
  attempt(() => { if (display) return display.play(id, gain); if (typeof AudioContext === 'undefined' || isMuted()) return; (phone ??= new Mixer(false)).play(id, gain); });
}
/** Queues a Clerk line (picks a recorded variant); the bed and effects duck while it plays. Display only. */
export function sayLine(id: LineId) { attempt(() => display?.sayLine(id)); }
/** Queues a card read-aloud: its recording when one exists, otherwise speech synthesis (write-ins always use synthesis). */
export function sayCard(card: Card) { attempt(() => display?.sayCard(card)); }
/** Closes the phone's tap player. Called from client.dispose(), which runs on every reconnect and on results, so the
 * display mixer (owned by AudioView, which stays mounted across rounds and replays) is left alone. */
export function disposeAudio() { attempt(() => phone?.dispose()); phone = null; }
