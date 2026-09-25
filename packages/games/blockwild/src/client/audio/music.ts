export const SOUNDTRACKS = ['horizon-dawn', 'pastoral-horizons', 'pastoral-quiet', 'silent-exploration'] as const;

/** One streamed track at a time, through Web Audio so volume also works on phones. */
export class BackgroundMusic {
  private index = 0;
  private playing = false;
  private closed = false;
  private readonly failed = new Set<number>();
  private readonly source: MediaElementAudioSourceNode;
  private readonly gain: GainNode;

  constructor(ctx: AudioContext, destination: AudioNode, private readonly audio: HTMLAudioElement = new Audio()) {
    audio.preload = 'none';
    audio.loop = false;
    this.source = ctx.createMediaElementSource(audio);
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.18;
    this.source.connect(this.gain);
    this.gain.connect(destination);
    audio.onended = () => this.next();
    audio.onerror = () => { this.failed.add(this.index); this.next(); };
    this.load();
  }
  private load() { this.audio.src = `/games/blockwild/music/${SOUNDTRACKS[this.index]}.mp3`; }
  private next() {
    if (this.closed) return;
    if (this.failed.size === SOUNDTRACKS.length) { this.audio.pause(); return; }
    do this.index = (this.index + 1) % SOUNDTRACKS.length;
    while (this.failed.has(this.index));
    this.load();
    if (this.playing) this.start();
  }
  private start() { void this.audio.play().catch(() => {}); }
  setPlaying(playing: boolean, retry = false) {
    if (this.closed || this.failed.size === SOUNDTRACKS.length || this.playing === playing && !retry) return;
    this.playing = playing;
    if (playing) this.start();
    else this.audio.pause();
  }
  dispose() {
    this.closed = true;
    this.audio.onended = this.audio.onerror = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.source.disconnect();
    this.gain.disconnect();
  }
}
