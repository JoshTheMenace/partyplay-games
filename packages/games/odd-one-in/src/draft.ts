export type Draft = { value: string; target?: string | null };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function readDraft(storage: StorageLike, key: string, turnId: string): Draft {
  try {
    const draft = JSON.parse(storage.getItem(key) ?? 'null');
    if (draft?.turnId === turnId && typeof draft.value === 'string' && draft.value.length <= 48 && (draft.target === undefined || draft.target === null || typeof draft.target === 'string')) return { value: draft.value, target: draft.target };
  } catch { /* A blocked store or old draft must never block joining. */ }
  return { value: '' };
}
export function saveDraft(storage: StorageLike, key: string, turnId: string, draft: Draft | null) {
  try {
    if (draft) storage.setItem(key, JSON.stringify({ turnId, ...draft }));
    else if (JSON.parse(storage.getItem(key) ?? 'null')?.turnId === turnId) storage.removeItem(key);
  } catch { /* Play remains available when browser storage is full or disabled. */ }
}
