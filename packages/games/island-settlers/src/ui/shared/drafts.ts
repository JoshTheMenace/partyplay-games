/** Phone drafts survive a reload, scoped by room, round, player and the game-owned turn id. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const memory = new Map<string, string>();
const fallback: DraftStorage = {
  getItem: k => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: k => void memory.delete(k),
};
/** sessionStorage, or an in-memory stand-in where it is missing or blocked (SSR, private mode). */
export const draftStorage = (): DraftStorage => {
  try { return typeof sessionStorage === 'undefined' ? fallback : sessionStorage; } catch { return fallback; }
};

export const draftKey = (roomId: string, roundId: string, playerId: string, name: string) =>
  `island-settlers:${roomId}:${roundId}:${playerId}:${name}`;

/** The saved draft, or null when missing, unreadable or from another turn. */
export function readDraft<T>(storage: DraftStorage, key: string, turnId: number): T | null {
  try {
    const saved = JSON.parse(storage.getItem(key) ?? 'null');
    return saved && saved.turnId === turnId && saved.draft !== undefined ? saved.draft as T : null;
  } catch { return null; }
}

/** null clears the draft. Storage is an optional cache, so failures are ignored. */
export function saveDraft<T>(storage: DraftStorage, key: string, turnId: number, draft: T | null) {
  try {
    if (draft === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ turnId, draft }));
  } catch { /* private mode or quota */ }
}
