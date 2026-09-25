/** Pure seated-host helpers (EXPERIENCE §4.9): which dock layer a screen uses, sheet titles, spot cycling. */
import type { View } from '../controller/logic';

/**
 * Where a controller screen lives on the host:
 * - `pick`: placement and the robber stay in the collapsed dock; spots are picked on the 3D board.
 * - `sheet`: menus and prompts raise the sheet over the lower board.
 * - `bar`: glanceable states keep the dock collapsed with its buttons.
 */
export type Layer = 'pick' | 'sheet' | 'bar';

const PICK = new Set<View['view']>(['setup', 'place', 'free', 'move', 'robber']);
const SHEET = new Set<View['view']>(['trade', 'cards', 'build', 'prompt', 'command']);

export const layerOf = (v: View): Layer => (PICK.has(v.view) ? 'pick' : SHEET.has(v.view) ? 'sheet' : 'bar');

/** The sheet's heading; commands bring their own. */
export function sheetTitle(v: View, task: string): string | null {
  switch (v.view) {
    case 'trade': return 'Trade';
    case 'cards': return 'Cards';
    case 'build': return 'Build';
    case 'prompt': return task;
    default: return null;
  }
}

/** ←/→ through the legal spots, wrapping; the first press lands on the selected spot or an end. */
export function stepSpot(ids: readonly string[], from: string | null, dir: 1 | -1): string | null {
  if (!ids.length) return null;
  const at = from === null ? -1 : ids.indexOf(from);
  if (at < 0) return dir > 0 ? ids[0] : ids.at(-1)!;
  return ids[(at + dir + ids.length) % ids.length];
}

/** "Spot 3 of 12: Forest 6, Hills 8", or how to start when nothing is focused. */
export function spotHint(ids: readonly string[], focus: string | null, label: string | null): string {
  const at = focus === null ? -1 : ids.indexOf(focus);
  if (at < 0) return `${ids.length} ${ids.length === 1 ? 'spot' : 'spots'} · click the board or press ← →`;
  return `Spot ${at + 1} of ${ids.length}${label ? `: ${label}` : ''}`;
}
