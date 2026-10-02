/**
 * Shared ElevenLabs client for Hijinks tools. Reads the key from output/secrets/elevenlabs.key (never print or commit it),
 * records every request's `character-cost` header in output/secrets/el-ledger.json, and refuses a request that could push
 * the run past its credit cap. Run tools from the platform root.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SECRETS = join(process.cwd(), 'output/secrets'), LEDGER = join(SECRETS, 'el-ledger.json');
export type LedgerEntry = { at: string; tool: string; id: string; credits: number; estimated?: boolean };
export type Ledger = { total: number; entries: LedgerEntry[] };

export function readLedger(): Ledger {
  return existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger : { total: 0, entries: [] };
}
/** Credits already recorded for one tool (e.g. the whole SFX library across runs). */
export const spentBy = (tool: string) => readLedger().entries.filter(e => e.tool === tool).reduce((sum, e) => sum + e.credits, 0);

/**
 * A capped client. `cap` bounds credits spent through this client, plus `prior` already-spent credits that count against
 * the same cap. Each request passes a conservative estimate; it is refused when spent + estimate would exceed the cap.
 */
export function client(tool: string, cap: number, prior = 0) {
  const file = join(SECRETS, 'elevenlabs.key');
  if (!existsSync(file)) throw Error(`Missing ${file}`);
  const key = readFileSync(file, 'utf8').trim();
  let spent = prior;
  return {
    get spent() { return spent; },
    remaining: () => cap - spent,
    /** POSTs JSON and returns the audio bytes, after recording the request's real cost. */
    async post(path: string, body: unknown, estimate: number, id: string): Promise<Buffer> {
      if (spent + estimate > cap) throw Error(`Refusing ${id}: ${spent} + ~${estimate} credits would exceed the cap of ${cap}.`);
      const res = await fetch(`https://api.elevenlabs.io${path}`, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' }, body: JSON.stringify(body) });
      if (!res.ok) throw Error(`ElevenLabs ${res.status} for ${id}: ${(await res.text()).slice(0, 300)}`);
      const audio = Buffer.from(await res.arrayBuffer()), header = Number(res.headers.get('character-cost')), credits = Number.isFinite(header) && res.headers.has('character-cost') ? header : estimate;
      const ledger = readLedger(), entry: LedgerEntry = { at: new Date().toISOString(), tool, id, credits };
      if (credits !== header) entry.estimated = true;
      ledger.entries.push(entry); ledger.total = ledger.entries.reduce((sum, e) => sum + e.credits, 0);
      writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
      spent += credits;
      return audio;
    },
  };
}
