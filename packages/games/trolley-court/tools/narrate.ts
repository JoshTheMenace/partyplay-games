/**
 * Voices the Clerk with ElevenLabs and regenerates src/vo-manifest.ts (recorded id → spoken ms). Sources: LINES from
 * src/narration.ts (every LineId, variants `<id>.2|.3`, ≤ 1,500 chars) and, unless --no-cards, every stock card in
 * deck.server.ts as `card.<id>`. An id is regenerated only when its text, voice, model or settings change (hashes in
 * public/games/trolley-court/vo/index.json). Spend is recorded as tool `trolley-court-narrate`.
 * Usage (platform root): node --import tsx packages/games/trolley-court/tools/narrate.ts [--dry-run] [--cap <credits>] [--only <prefix>] [--no-cards]
 * A real run requires --cap; it refuses to start when the estimate exceeds it.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUILTY, INNOCENT, MODIFIERS } from '../src/deck.server';
import { LINES } from '../src/narration';
import { LINE_IDS } from '../src/types';
import { client } from './elevenlabs';

const root = join(import.meta.dirname, '..'), out = join(root, '../../../public/games/trolley-court/vo'), indexFile = join(out, 'index.json');
/** "Daniel": a premade British broadcaster voice, a crisp court Clerk. */
const VOICE = 'onwK4e9ZLuTAKqWW03F9', MODEL = 'eleven_turbo_v2_5', BUDGET = 1500;
const SETTINGS = { line: { stability: .4, similarity_boost: .8, style: .4, speed: 1.02, use_speaker_boost: true }, card: { stability: .5, similarity_boost: .8, style: .25, speed: 1.06, use_speaker_boost: true } };
type Index = Record<string, { hash: string; ms: number }>;

const args = process.argv.slice(2), flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const dry = args.includes('--dry-run'), only = flag('--only') ?? '', cap = Number(flag('--cap'));
if (!dry && !(cap > 0)) throw Error('A real run needs --cap <credits> (use --dry-run to preview the cost).');

// Lines: every LineId present, only known ids and variants, within budget.
const problems: string[] = [], total = Object.values(LINES).reduce((sum, t) => sum + t.length, 0);
if (total > BUDGET) problems.push(`narration.ts: ${total} characters, over the ${BUDGET}-character budget by ${total - BUDGET}.`);
for (const id of LINE_IDS) if (!LINES[id]?.trim()) problems.push(`narration.ts: missing line "${id}".`);
for (const id of Object.keys(LINES)) if (!(LINE_IDS as readonly string[]).includes(id.replace(/\.[23]$/, ''))) problems.push(`narration.ts: unknown line id "${id}".`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
/** Spoken text: stock card text starts a sentence and ends with a full stop (twists begin lower-case: "who…"). */
const spoken = (text: string) => { const t = text.trim(); return t[0].toUpperCase() + t.slice(1) + (/[.!?…]$/.test(t) ? '' : '.'); };
const items: Record<string, { text: string; kind: 'line' | 'card' }> = {};
for (const [id, text] of Object.entries(LINES)) items[id] = { text: text.trim(), kind: 'line' };
if (!args.includes('--no-cards')) for (const card of [...INNOCENT, ...GUILTY, ...MODIFIERS]) if (card) items[`card.${card.id}`] = { text: spoken(card.text), kind: 'card' };

const hash = (id: string) => createHash('sha256').update(JSON.stringify({ text: items[id].text, VOICE, MODEL, settings: SETTINGS[items[id].kind] })).digest('hex').slice(0, 16);
const index: Index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {};
const pending = Object.keys(items).filter(id => id.startsWith(only) && (index[id]?.hash !== hash(id) || !existsSync(join(out, `${id}.mp3`))));
// Turbo bills about half a credit per character; estimate a full credit so the cap is never overrun.
const estimate = (id: string) => items[id].text.length, cost = pending.reduce((sum, id) => sum + estimate(id), 0);
for (const kind of ['line', 'card'] as const) { const ids = pending.filter(id => items[id].kind === kind); if (ids.length) console.log(`${kind}s: ${ids.length}, ${ids.reduce((s, id) => s + items[id].text.length, 0)} chars`); }
console.log(`Total: ${pending.length} recording(s), ≤ ${cost} credits${dry ? ' (dry run)' : `, cap ${cap}`}.`);

if (!dry) {
  if (cost > cap) throw Error(`Estimated ${cost} credits exceeds --cap ${cap}. Raise the cap or narrow with --only / --no-cards.`);
  mkdirSync(out, { recursive: true });
  const api = client('trolley-court-narrate', cap), queue = [...pending];
  // Trim leading and trailing silence (keeping a breath of tail), then re-encode small mono mp3s.
  const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse';
  const work = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const { text, kind } = items[id], raw = await api.post(`/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, { text, model_id: MODEL, voice_settings: SETTINGS[kind] }, estimate(id), `vo/${id}`);
      const file = join(out, `${id}.mp3`), enc = kind === 'line' ? ['-b:a', '64k'] : ['-ar', '24000', '-b:a', '48k'];
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', 'pipe:0', '-af', trim, '-ac', '1', '-codec:a', 'libmp3lame', ...enc, file], { input: raw });
      index[id] = { hash: hash(id), ms: Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' })) * 1000) };
      writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
      console.log(`${id}: ${index[id].ms} ms (${api.spent} credits so far)`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, work));
  // Forget recordings whose source no longer exists (a --no-cards run keeps existing card recordings).
  for (const id of Object.keys(index)) if (!Object.hasOwn(items, id) && !(id.startsWith('card.') && args.includes('--no-cards'))) { delete index[id]; rmSync(join(out, `${id}.mp3`), { force: true }); }
  writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
  const voiced = Object.keys(index).filter(id => existsSync(join(out, `${id}.mp3`))).sort();
  writeFileSync(join(root, 'src/vo-manifest.ts'), `/* GENERATED by tools/narrate.ts: recorded id (Clerk line or card.<id>) → spoken length in ms. */
export const VO: Record<string, number> = {
${voiced.map(id => `  '${id}': ${index[id].ms},`).join('\n')}
};
`);
  console.log(`Spent ${api.spent} credits; ${voiced.length} recording(s) in src/vo-manifest.ts.`);
}
