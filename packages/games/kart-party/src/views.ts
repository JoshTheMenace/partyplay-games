/* Where races are drawn. Auto: up to 4 humans share the TV split screen; 5–10 race on their own devices. */
import type { ViewMode } from './sim/types';
export type ScreenMode = 'split' | 'personal' | 'spectator' | 'controls';
export const resolveViewMode = (mode: ViewMode, humans: number): 'tv' | 'personal' => mode === 'personal' || (mode === 'auto' && humans > 4) ? 'personal' : 'tv';
/** What this device draws. A watching host follows the race; a playing host sees its own kart
 * (plus the other TV racers in TV mode); TV-mode phones show controls only. */
export function screenMode(mode: 'tv' | 'personal', playerId: string | null, isHost: boolean): ScreenMode {
  if (!playerId) return mode === 'tv' ? 'split' : 'spectator';
  if (isHost) return mode === 'tv' ? 'split' : 'personal';
  return mode === 'tv' ? 'controls' : 'personal';
}
