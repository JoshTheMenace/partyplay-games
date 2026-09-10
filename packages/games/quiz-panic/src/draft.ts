// Optional per-tab cache. Only this phone's unfinished input is stored here.
export type Draft = { sequence: number[]; estimate: string };
export type DraftScope = { roomId: string; roundId: string; playerId: string; turnId: string; family: 'memory' | 'estimate' };
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (scope: DraftScope) => `quiz-panic:draft:${JSON.stringify([scope.roomId, scope.playerId])}`;
const matches = (saved: DraftScope, scope: DraftScope) => ['roomId', 'roundId', 'playerId', 'turnId', 'family'].every(field => saved[field as keyof DraftScope] === scope[field as keyof DraftScope]);
export function readDraft(storage: DraftStorage, scope: DraftScope, sequenceLength = 5): Draft | null {
  try {
    const raw = storage.getItem(key(scope));
    if (!raw || raw.length > 1000) return null;
    const saved = JSON.parse(raw);
    if (!saved || !matches(saved, scope) || !Array.isArray(saved.sequence) || saved.sequence.length > sequenceLength || !saved.sequence.every((n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 3) || typeof saved.estimate !== 'string' || !/^\d{0,3}$/.test(saved.estimate)) return null;
    return { sequence: scope.family === 'memory' ? saved.sequence : [], estimate: scope.family === 'estimate' ? saved.estimate : '' };
  } catch { return null; }
}
export function saveDraft(storage: DraftStorage, scope: DraftScope, draft: Draft) {
  try { storage.setItem(key(scope), JSON.stringify({ ...scope, ...draft })); } catch { /* Keep editing when storage is unavailable. */ }
}
export function clearDraft(storage: DraftStorage, scope: DraftScope) {
  try { if (readDraft(storage, scope)) storage.removeItem(key(scope)); } catch { /* Browser storage is optional. */ }
}
