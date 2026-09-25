/** Renders each mission's loop into public/games/night-job/music/<mission>.mp3. Usage (platform root): node --import tsx packages/games/night-job/music/export.ts */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MUSIC } from '../src/audio';
import { SR, bus, wav } from './synth';
import { tracks } from './tracks';

const CHOSEN = { velvet: 'velvet-noir', glasshouse: 'glass-bossa', ferry: 'ferry-shanty' } as const, out = 'game-modules/public/games/night-job/music';
mkdirSync(out, { recursive: true });
for (const [mission, id] of Object.entries(CHOSEN) as [keyof typeof CHOSEN, string][]) {
  const loop = tracks.find(t => t.id === id)!.render(), n = loop.l.length, seconds = n / SR;
  if (Math.abs(seconds - MUSIC[mission]) > .001) throw Error(`${id} is ${seconds}s but src/audio.ts MUSIC.${mission} says ${MUSIC[mission]}s`);
  // One wrapped extra second: the player loops [0.5, 0.5 + seconds], clear of MP3 encoder padding at both ends.
  const padded = bus(n + SR); for (let i = 0; i < n + SR; i++) { padded.l[i] = loop.l[i % n]; padded.r[i] = loop.r[i % n]; }
  const file = join(out, `${mission}.wav`); writeFileSync(file, wav(padded));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-codec:a', 'libmp3lame', '-b:a', '160k', join(out, `${mission}.mp3`)]); rmSync(file);
  console.log(`${mission}: ${id}, ${seconds.toFixed(3)} s loop`);
}
