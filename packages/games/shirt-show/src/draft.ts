import { parseDrawing } from '../../../party-contract/src/index';
import type { Drawing } from '../../../party-contract/src/index';
import type { Selection } from './model';

export type Draft = { drawing: Drawing; slogan: string; selection: Selection | null };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function readDraft(storage: StorageLike, key: string, turnId: string, serverRevision = 0): Draft | null {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > 32768) return null;
    const saved = JSON.parse(raw);
    if (saved.turnId !== turnId || !Number.isInteger(saved.revision) || saved.revision < serverRevision || typeof saved.value.slogan !== 'string' || saved.value.slogan.length > 72) return null;
    const selection = saved.value.selection;
    if (selection !== null && (!selection || typeof selection.artId !== 'string' || selection.artId.length > 80 || typeof selection.sloganId !== 'string' || selection.sloganId.length > 80 || !['cream', 'coral', 'sky', 'lime'].includes(selection.color))) return null;
    return { drawing: parseDrawing(saved.value.drawing), slogan: saved.value.slogan, selection: selection ? { artId: selection.artId, sloganId: selection.sloganId, color: selection.color } : null };
  } catch { return null; }
}
export function saveDraft(storage: StorageLike, key: string, turnId: string, value: Draft, revision = 0) {
  try { storage.setItem(key, JSON.stringify({ turnId, revision, value })); } catch { /* Private mode or full storage: the explicit server save still works. */ }
}
export function clearDraft(storage: StorageLike, key: string, turnId: string) {
  try { if (JSON.parse(storage.getItem(key) ?? 'null')?.turnId === turnId) storage.removeItem(key); } catch { /* Cache cleanup is optional. */ }
}
