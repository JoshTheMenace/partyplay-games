/** Test helper: a save as versions 9 and 10 wrote it (6-byte edit records, slot tuples, a raw chunk bitset). */
import { inflateRawSync } from 'node:zlib';
import type { Slot } from '../src/shared/items';
import { parseSave, unpackEdits, type SaveData } from '../src/sim/save';

const tuples = (slots: readonly (Slot | null)[]) => slots.flatMap((slot, i) => !slot ? [] : slot.d ? [[i, slot.id, slot.n, slot.d]] : [[i, slot.id, slot.n]]);
export function asOldSave(save: SaveData, version: 9 | 10): Record<string, unknown> {
  const parsed = parseSave(save), edits = unpackEdits(save.edits), bytes = new Uint8Array(edits.size * 6), view = new DataView(bytes.buffer);
  [...edits.keys()].sort((a, b) => a - b).forEach((index, i) => { view.setUint32(i * 6, index, true); view.setUint16(i * 6 + 4, edits.get(index)!, true); });
  return {
    ...structuredClone(save), version, edits: Buffer.from(bytes).toString('base64'), populated: inflateRawSync(Buffer.from(save.populated, 'base64')).toString('base64'),
    players: save.players.map((player, i) => ({ ...player, inv: tuples(parsed.players[i]!.inv), armor: tuples(parsed.players[i]!.armor) })),
    chests: save.chests.map(chest => ({ i: chest.i, slots: tuples(parsed.chests.get(chest.i)!) })),
    furnaces: save.furnaces.map(furnace => ({ ...furnace, slots: tuples(parsed.furnaces.get(furnace.i)!.slots) })),
  };
}
