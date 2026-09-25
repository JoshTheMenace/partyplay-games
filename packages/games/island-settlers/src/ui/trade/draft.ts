/**
 * The trade draft: one per room/round/player/turn, kept in sessionStorage so a reload keeps it, and shared
 * live between every mounted trade component (a duty card's Counter prefills the Trade tab's composer).
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ActionResult } from '../../../../../party-contract/src/index';
import type { Action, Cards, SeatId } from '../../model';
import { draftKey, draftStorage, readDraft, saveDraft } from '../shared/drafts';

export type Segment = 'players' | 'bank';
export type Draft = {
  seg: Segment | null;
  give: Cards; want: Cards; to: SeatId[]; counterTo: string | null;
  bankGive: Cards; bankGet: Cards;
};
export const EMPTY_DRAFT: Draft =
  { seg: null, give: {}, want: {}, to: [], counterTo: null, bankGive: {}, bankGet: {} };

export type DraftScope = { roomId: string; roundId: string; playerId: string | null; turnId: number };

const memory = new Map<string, Draft>(), listeners = new Set<() => void>();
const base = (s: DraftScope) => draftKey(s.roomId, s.roundId, s.playerId ?? '-', 'trade');
const keyOf = (s: DraftScope) => `${base(s)}#${s.turnId}`;

function read(s: DraftScope): Draft {
  const key = keyOf(s), cached = memory.get(key);
  if (cached) return cached;
  const saved = readDraft<Draft>(draftStorage(), base(s), s.turnId);
  const draft = saved ? { ...EMPTY_DRAFT, ...saved } : EMPTY_DRAFT;
  memory.set(key, draft);
  return draft;
}

export function writeDraft(s: DraftScope, patch: Partial<Draft>) {
  const draft = { ...read(s), ...patch };
  memory.set(keyOf(s), draft);
  saveDraft(draftStorage(), base(s), s.turnId, draft);
  listeners.forEach(fn => fn());
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** [draft, patch]: patch merges into the draft for this scope. */
export function useDraft(s: DraftScope): [Draft, (patch: Partial<Draft>) => void] {
  const draft = useSyncExternalStore(subscribe, () => read(s), () => EMPTY_DRAFT);
  const { roomId, roundId, playerId, turnId } = s;
  const patch = useCallback((p: Partial<Draft>) => writeDraft({ roomId, roundId, playerId, turnId }, p),
    [roomId, roundId, playerId, turnId]);
  return [draft, patch];
}

/** Sends one action at a time; keeps the server's rejection text until the next send. */
export function useSend(sendAction: (action: Action) => Promise<ActionResult>) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const send = useCallback(async (action: Action, onOk?: () => void) => {
    setBusy(true); setError(null);
    try {
      const result = await sendAction(action);
      if (result.accepted) onOk?.(); else setError(result.reason ?? 'The server refused that trade');
    } catch { setError('Could not reach the room. Try again.'); } finally { setBusy(false); }
  }, [sendAction]);
  return { busy, error, send };
}

/** Server time, refreshed every `ms` while mounted (expiry bars and the completed-trade flash). */
export function useNow(serverNowMs: () => number, ms = 250) {
  const [now, setNow] = useState(serverNowMs);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNowMs()), ms);
    return () => clearInterval(timer);
  }, [serverNowMs, ms]);
  return now;
}
