/**
 * Voices Hijinks narrator lines with ElevenLabs and regenerates src/core/vo-manifest.ts (line id → spoken ms).
 * Sources: LINES from src/core/narration.ts (`host.*`, ≤ 1,500 chars) and every src/minis/<id>/narration.ts (`<id>.*`, ≤ 250).
 * A line is regenerated only when its text, voice, model or settings change (hashes in public/games/hijinks/vo/index.json).
 * Usage (platform root): node --import tsx packages/games/hijinks/tools/narrate.ts [--dry-run] [--cap <credits>] [--only <prefix>]
 * A real run requires --cap; requests that would exceed it are refused. Spend is recorded in output/secrets/el-ledger.json.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { client } from './elevenlabs';

const root = join(import.meta.dirname, '..'), out = join(root, '../../../public/games/hijinks/vo'), indexFile = join(out, 'index.json');
const VOICE = 'JBFqnCBsd6RMkjVDRZzb', MODEL = 'eleven_turbo_v2_5', SETTINGS = { stability: .4, similarity_boost: .8, style: .35, speed: 1.05, use_speaker_boost: true };
const BUDGET = { host: 1500, mini: 250 };
type Index = Record<string, { hash: string; ms: number }>;

const args = process.argv.slice(2), flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const dry = args.includes('--dry-run'), only = flag('--only') ?? '', cap = Number(flag('--cap'));
if (!dry && !(cap > 0)) throw Error('A real run needs --cap <credits> (use --dry-run to preview the cost).');

// Collect every line and enforce the per-file character budgets.
const sources: { file: string; prefix: string; budget: number }[] = [{ file: join(root, 'src/core/narration.ts'), prefix: 'host.', budget: BUDGET.host }];
for (const id of readdirSync(join(root, 'src/minis')).sort()) if (existsSync(join(root, 'src/minis', id, 'narration.ts'))) sources.push({ file: join(root, 'src/minis', id, 'narration.ts'), prefix: `${id}.`, budget: BUDGET.mini });
const lines: Record<string, string> = {}, problems: string[] = [];
for (const s of sources) {
  const found = (await import(s.file)).LINES as Record<string, string> | undefined;
  if (!found || typeof found !== 'object') { problems.push(`${s.file} must export LINES: Record<string, string>`); continue; }
  const total = Object.values(found).reduce((sum, text) => sum + text.length, 0);
  if (total > s.budget) problems.push(`${s.file}: ${total} characters, over its ${s.budget}-character budget by ${total - s.budget}. Shorten or cut lines.`);
  for (const [id, text] of Object.entries(found)) {
    if (!id.startsWith(s.prefix) || !/^[a-z0-9.-]+$/.test(id)) problems.push(`${s.file}: line id "${id}" must start with "${s.prefix}" and use a-z, 0-9, dots and dashes.`);
    else if (typeof text !== 'string' || !text.trim()) problems.push(`${s.file}: line "${id}" is empty.`);
    else if (Object.hasOwn(lines, id)) problems.push(`${s.file}: duplicate line id "${id}".`);
    else lines[id] = text.trim();
  }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

const hash = (text: string) => createHash('sha256').update(JSON.stringify({ text, VOICE, MODEL, SETTINGS })).digest('hex').slice(0, 16);
const index: Index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {};
const pending = Object.keys(lines).filter(id => id.startsWith(only) && (index[id]?.hash !== hash(lines[id]) || !existsSync(join(out, `${id}.mp3`))));
// Turbo models bill about half a credit per character; estimate a full credit so the cap is never overrun.
const estimate = (id: string) => lines[id].length;
for (const s of sources) {
  const ids = pending.filter(id => id.startsWith(s.prefix));
  if (ids.length) console.log(`${s.prefix.slice(0, -1)}: ${ids.length} line(s), ${ids.reduce((sum, id) => sum + lines[id].length, 0)} chars, ≤ ${ids.reduce((sum, id) => sum + estimate(id), 0)} credits`);
}
const total = pending.reduce((sum, id) => sum + estimate(id), 0);
console.log(`Total: ${pending.length} line(s), ≤ ${total} credits${dry ? ' (dry run)' : `, cap ${cap}`}.`);

if (!dry) {
  if (total > cap) throw Error(`Estimated ${total} credits exceeds --cap ${cap}. Raise the cap or narrow with --only.`);
  mkdirSync(out, { recursive: true });
  const api = client('narrate', cap);
  for (const id of pending) {
    const raw = await api.post(`/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, { text: lines[id], model_id: MODEL, voice_settings: SETTINGS }, estimate(id), `vo/${id}`);
    const tmp = join(out, `${id}.raw.mp3`), file = join(out, `${id}.mp3`); writeFileSync(tmp, raw);
    // Trim leading and trailing silence (keeping a breath of tail), then re-encode.
    const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse';
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-af', trim, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '128k', file]); rmSync(tmp);
    const ms = Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' })) * 1000);
    index[id] = { hash: hash(lines[id]), ms };
    writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
    console.log(`${id}: ${ms} ms (${api.spent} credits so far)`);
  }
  // Forget lines that no longer exist.
  for (const id of Object.keys(index)) if (!Object.hasOwn(lines, id)) { delete index[id]; rmSync(join(out, `${id}.mp3`), { force: true }); }
  writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
  const voiced = Object.keys(index).filter(id => existsSync(join(out, `${id}.mp3`))).sort();
  writeFileSync(join(root, 'src/core/vo-manifest.ts'), `/* GENERATED by tools/narrate.ts: narrator line id → spoken length in ms (only lines with recordings). */
export const VO: Record<string, number> = {
${voiced.map(id => `  '${id}': ${index[id].ms},`).join('\n')}
};
`);
  console.log(`Spent ${api.spent} credits; ${voiced.length} line(s) in src/core/vo-manifest.ts.`);
}
