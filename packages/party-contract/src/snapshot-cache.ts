import type { SnapshotCachePolicy } from './index';
import type { PairPatch, PublicCache, Snapshot } from './protocol';

export function validateSnapshotCache(policy: SnapshotCachePolicy) {
  const safe = (field: string) => typeof field === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field) && !['constructor', 'prototype', '__proto__'].includes(field);
  if (!safe(policy.revisionField) || !Array.isArray(policy.fields) || !policy.fields.length || policy.fields.length > 8 || policy.fields.some(field => !safe(field) || field === policy.revisionField) || new Set(policy.fields).size !== policy.fields.length) throw new Error('Invalid snapshot cache policy.');
  if (policy.keyedPairsFields && (!Array.isArray(policy.keyedPairsFields) || policy.keyedPairsFields.some(field => !policy.fields.includes(field)) || new Set(policy.keyedPairsFields).size !== policy.keyedPairsFields.length)) throw new Error('Invalid keyed-pair cache policy.');
}
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function pairs(value: unknown): Map<number, number> {
  if (!Array.isArray(value) || value.some(pair => !Array.isArray(pair) || pair.length !== 2 || !pair.every(integer))) throw new Error('Cached pairs must contain nonnegative integer keys and values.');
  const map = new Map<number, number>(value);
  if (map.size !== value.length) throw new Error('Cached pair keys must be unique.');
  return map;
}
export type SnapshotCursor = { roundId: string; revision: number };
export class SnapshotEncoder {
  private cursor: (SnapshotCursor & { pairs: Map<string, Map<number, number>> }) | null = null;
  reset() { this.cursor = null; }
  encode(roundId: string, publicView: unknown, policy?: SnapshotCachePolicy): { publicView: unknown; publicCache?: PublicCache } {
    if (!policy) return { publicView };
    const view = publicView as Record<string, unknown>, revision = view?.[policy.revisionField];
    if (!integer(revision) || policy.fields.some(field => !Object.hasOwn(view, field))) throw new Error('Invalid cached public projection.');
    const previous = this.cursor?.roundId === roundId ? this.cursor : null;
    const reused = previous?.revision === revision, omitted = new Set(reused ? policy.fields : []);
    const publicCache: PublicCache = { revision, reused };
    if (!reused) {
      const nextPairs = new Map<string, Map<number, number>>(), patches: Record<string, PairPatch> = {};
      for (const field of policy.keyedPairsFields ?? []) {
        const next = pairs(view[field]), before = previous?.pairs.get(field); nextPairs.set(field, next);
        if (!before) continue;
        const set = [...next].filter(([key, value]) => before.get(key) !== value), remove = [...before.keys()].filter(key => !next.has(key));
        // Large rewrites are cheaper as a new baseline; sparse edits remain proportional to changes.
        if ((set.length + remove.length) * 2 >= next.size) continue;
        patches[field] = { set, remove }; omitted.add(field);
      }
      if (Object.keys(patches).length) { publicCache.baseRevision = previous!.revision; publicCache.patches = patches; }
      this.cursor = { roundId, revision, pairs: nextPairs };
    }
    return { publicView: omitted.size ? Object.fromEntries(Object.entries(view).filter(([field]) => !omitted.has(field))) : publicView, publicCache };
  }
}
export class SnapshotDecoder {
  private cursor: (SnapshotCursor & { fields: Record<string, unknown> }) | null = null;
  reset() { this.cursor = null; }
  decode(snapshot: Snapshot, policy?: SnapshotCachePolicy): Snapshot | null {
    if (!policy || !snapshot.publicCache) return snapshot;
    const { revision, reused, baseRevision, patches } = snapshot.publicCache;
    const view = snapshot.publicView as Record<string, unknown>;
    if (!view || !integer(revision) || view[policy.revisionField] !== revision) return null;
    if (reused) {
      if (this.cursor?.roundId !== snapshot.roundId || this.cursor.revision !== revision) return null;
      return { ...snapshot, publicView: { ...view, ...this.cursor.fields } };
    }
    const fields: Record<string, unknown> = {};
    try {
      if (patches && (this.cursor?.roundId !== snapshot.roundId || this.cursor.revision !== baseRevision || Object.keys(patches).some(field => !policy.keyedPairsFields?.includes(field)))) return null;
      for (const field of policy.fields) {
        const patch = patches?.[field];
        if (patch) {
          if (!Array.isArray(patch.remove) || !patch.remove.every(integer)) return null;
          const next = pairs(this.cursor!.fields[field]), changed = pairs(patch.set);
          for (const key of patch.remove) next.delete(key);
          for (const [key, value] of changed) next.set(key, value);
          fields[field] = [...next];
        } else {
          if (!Object.hasOwn(view, field)) return null;
          if (policy.keyedPairsFields?.includes(field)) pairs(view[field]);
          fields[field] = view[field];
        }
      }
    } catch { return null; }
    this.cursor = { roundId: snapshot.roundId, revision, fields };
    return { ...snapshot, publicView: { ...view, ...fields } };
  }
}


/** Reuse one computed world delta for a room; lagging/new recipients get the full baseline. */
export function snapshotForCursor(roundId: string, publicView: unknown, encoded: ReturnType<SnapshotEncoder['encode']>, policy?: SnapshotCachePolicy, cursor?: SnapshotCursor): ReturnType<SnapshotEncoder['encode']> {
  if (!policy || !encoded.publicCache) return encoded;
  const revision = encoded.publicCache.revision;
  if (cursor?.roundId === roundId && cursor.revision === revision) return { publicView: Object.fromEntries(Object.entries(publicView as Record<string, unknown>).filter(([field]) => !policy.fields.includes(field))), publicCache: { revision, reused: true } };
  if (cursor?.roundId === roundId && cursor.revision === encoded.publicCache.baseRevision) return encoded;
  return { publicView, publicCache: { revision, reused: false } };
}
