/** Renders Ichi music. Usage (platform root): node --import tsx packages/games/ichi/music/render.ts <outDir> [track-id…] */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Mix, SR, wav } from './synth';
import { tracks } from './tracks';

const [out = 'output/ichi-music', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
for (const t of tracks.filter(t => !only.length || only.includes(t.id))) {
  const start = performance.now(), b = t.render(), file = join(out, `${t.id}.wav`);
  let peak = 0, e = 0; for (let i = 0; i < b.l.length; i++) { peak = Math.max(peak, Math.abs(b.l[i]), Math.abs(b.r[i])); e += b.l[i] ** 2 + b.r[i] ** 2; }
  writeFileSync(file, wav(b));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-codec:a', 'libmp3lame', '-b:a', '192k', join(out, `${t.id}.mp3`)]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-lavfi', 'showspectrumpic=s=1200x400:legend=1:scale=log', join(out, `${t.id}.png`)]);
  const seam = Math.abs(b.l[b.l.length - 1] - b.l[0]);
  console.log(`${t.title}: ${(b.l.length / SR).toFixed(1)}s, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS, rms ${(10 * Math.log10(e / b.l.length / 2)).toFixed(1)} dBFS, seam jump ${seam.toFixed(4)}, ${((performance.now() - start) / 1000).toFixed(1)}s\n  ${Object.entries(Mix.last).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · ')}`);
}
