/* Helpers shared by the pack screens. */
import type { GameViewProps } from '../../../../../party-ui/src/index';
import type { MiniInfo, PackAction, PackPlayer, PackPrivateView, PackPublicView } from '../contract';
import { MINI_CLIENTS } from '../../minis/registry.client';

export type PackProps = GameViewProps<null, PackAction, PackPublicView, PackPrivateView>;
export type ScreenProps = { view: PackPublicView; now(): number };
export type PhoneProps = ScreenProps & { me: PackPlayer; send(action: PackAction): ReturnType<PackProps['sendAction']> };
export const DEFAULT_ACCENT = '#b58aff';

/** Why a tile cannot be picked right now, or null when it can. Mirrors the server's roster check. */
export function blocked(info: MiniInfo, count: number): string | null {
  if (!Object.hasOwn(MINI_CLIENTS, info.id)) return 'Coming soon';
  if (count < info.players.min) return `Needs ${info.players.min}+ players`;
  if (count > info.players.max) return `Up to ${info.players.max} players`;
  return null;
}
export const playersLabel = (info: MiniInfo) => info.players.min === info.players.max ? `${info.players.min} players` : `${info.players.min}–${info.players.max} players`;
