import { MAX_PLAYERS } from './types';

/** Shared by the WebGL scissor rectangles and the HTML HUD grid. */
export function splitLayout(count: number) {
  const players = Math.max(1, Math.min(MAX_PLAYERS, count));
  const columns = players <= 2 ? 1 : players <= 4 ? 2 : players <= 9 ? 3 : 4;
  return { columns, rows: Math.ceil(players / columns) };
}

export function viewportRect(count: number, index: number) {
  const { columns, rows } = splitLayout(count);
  return { x: (index % columns) / columns, y: Math.floor(index / columns) / rows, width: 1 / columns, height: 1 / rows };
}
