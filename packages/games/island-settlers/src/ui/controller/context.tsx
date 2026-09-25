/** Controller state shared by every panel: views, the action sender, notices, drafts and the screen draft. */
import { createContext, useContext, useState } from 'react';
import type { GameViewProps } from '../../../../../party-ui/src/index';
import type { Action, PrivateView, PublicView } from '../../model';
import { draftKey, draftStorage, readDraft, saveDraft } from '../shared/drafts';
import type { Sfx } from '../sfx/index';

export type Props = GameViewProps<null, Action, PublicView, PrivateView>;
type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An action before the game-owned turn id is stamped on. */
export type Move = Without<Action, 'turnId'>;

export type Tab = 'now' | 'build' | 'trade' | 'cards';
/** Which screen the phone shows inside the current task. Saved as a draft, so reloads keep it. */
export type Screen = {
  tab: Tab; place: string | null; command: string | null; card: string | null;
  skipFree: boolean;
};
export const HOME: Screen = { tab: 'now', place: null, command: null, card: null, skipFree: false };

export type NoticeTone = 'error' | 'gain' | 'loss' | 'info';
export type Notice = { id: string; tone: NoticeTone; text: string; at: number };

export type Ctl = {
  pub: PublicView;
  me: PrivateView;
  props: Props;
  now(): number;
  /** Stamps the turn id and sends; a rejection becomes an error notice. Resolves true when accepted. */
  act(move: Move, quiet?: boolean): Promise<boolean>;
  busy: boolean;
  /** The seated host's dock (mouse and keyboard, picks on the 3D board) rather than a phone. */
  docked: boolean;
  screen: Screen;
  go(next: Partial<Screen>): void;
  notify(tone: NoticeTone, text: string): void;
  sfx: Omit<Sfx, 'dispose'>;
  /** Draft scope: room, round, player, and the turn id every draft is checked against. */
  scope: { roomId: string; roundId: string; playerId: string; turnId: number };
};

export const CtlContext = createContext<Ctl | null>(null);

export function useCtl(): Ctl {
  const ctl = useContext(CtlContext);
  if (!ctl) throw new Error('Controller panels need a CtlContext provider');
  return ctl;
}

/** State that survives a reload for this room, round, player and turn; a new turn starts from `initial`. */
export function useDraftIn<T>(scope: Ctl['scope'], name: string, initial: T): [T, (next: T) => void] {
  const key = draftKey(scope.roomId, scope.roundId, scope.playerId, name), id = `${key}#${scope.turnId}`;
  const [state, setState] = useState<{ id: string; value: T } | null>(null);
  const value = state?.id === id ? state.value : readDraft<T>(draftStorage(), key, scope.turnId) ?? initial;
  const set = (next: T) => {
    saveDraft(draftStorage(), key, scope.turnId, next);
    setState({ id, value: next });
  };
  return [value, set];
}

export const useDraft = <T,>(name: string, initial: T) => useDraftIn(useCtl().scope, name, initial);
