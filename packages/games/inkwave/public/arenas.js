// How a room is dealt into arenas. Shared by the server (src/engine.server.js), the arena iframe (platform.js) and the
// shell views (src/client.tsx), so every screen agrees on who is where before the first snapshot arrives. No imports.
//
// The stages, weapons and spawn decks are built for four a side, and a phone draws eight of the original characters.
// A room of up to eight is therefore one arena, exactly as before. A bigger room keeps its two room-wide teams and plays
// several 4v4 arenas at once (several squads of eight in Boss Battle); their results add up to the room's.
export const ARENA_SEATS = 8;
export const ARENA_NAMES = 'ABCDEFGH';
export const arenaCount = players => Math.max(1, Math.ceil(players / ARENA_SEATS));

/** Seat `index` of `count` players in join order: its arena, place in that arena, team and spawn slot. */
export function dealSeat(index, count, mode) {
  const arenas = arenaCount(count), arena = index % arenas, place = Math.floor(index / arenas);
  // Arenas alternate which team gets the odd player, so the room's two teams stay within one of each other.
  return mode === 'boss' ? { arena, place, team: 0, slot: place } : { arena, place, team: (place + arena) % 2, slot: Math.floor(place / 2) };
}

/**
 * One roster per arena, in the engine's actor order. Humans come first in join order; CPUs fill each arena to eight unless
 * the stage is humans-only. `seat` is the player's index in the round (−1 for a CPU); `nid` is the actor index in its arena.
 */
export function dealArenas(players, settings, weaponOrder, noBots) {
  const arenas = Array.from({ length: arenaCount(players.length) }, () => []);
  players.forEach((player, seat) => {
    const { arena, place, team, slot } = dealSeat(seat, players.length, settings.mode), choice = player.lobbyChoice || {};
    arenas[arena][place] = { nid: place, owner: 'server', bot: false, team, slot, seat, arena, id: player.id, name: player.name, weapon: choice.weapon || weaponOrder[seat % weaponOrder.length], sub: choice.sub || null, special: choice.special || null, style: choice.style || {} };
  });
  if (!noBots) arenas.forEach((roster, arena) => {
    for (let place = roster.length; place < ARENA_SEATS; place++) {
      const boss = settings.mode === 'boss';
      roster.push({ nid: place, owner: 'server', bot: true, team: boss ? 0 : (place + arena) % 2, slot: boss ? place : Math.floor(place / 2), seat: -1, arena, id: `bot-${arena}-${place}`, name: `CPU ${place + 1}`, weapon: weaponOrder[(place + arena * 5) % weaponOrder.length], sub: null, special: null, style: {} });
    }
  });
  return arenas;
}

// ---- Paint baseline: the 0/1/2 gameplay grid as run lengths. Ink lies in patches, so a baseline is a few KB, not 60.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Each run is a base64 digit holding the cell value (2 bits) and the low 3 bits of the length with a continue flag, then 5-bit continuation digits. */
export function packInk(grid) {
  let out = '';
  for (let i = 0; i < grid.length;) {
    const value = grid[i]; let length = 1; while (i + length < grid.length && grid[i + length] === value) length++;
    i += length;
    let rest = length >>> 3; out += B64[value << 4 | (rest ? 8 : 0) | length & 7];
    while (rest) { const next = rest >>> 5; out += B64[(next ? 32 : 0) | rest & 31]; rest = next; }
  }
  return out;
}
export function unpackInk(text, grid) {
  const invalid = () => { throw new Error('Invalid ink baseline.'); };
  let at = 0;
  for (let i = 0; i < text.length;) {
    let digit = B64.indexOf(text[i++]), length = digit & 7, more = digit & 8, shift = 3; const value = digit >> 4;
    while (more) { digit = i < text.length ? B64.indexOf(text[i++]) : -1; if (digit < 0) invalid(); length += (digit & 31) * 2 ** shift; shift += 5; more = digit & 32; }
    if (digit < 0 || value > 2 || !length || at + length > grid.length) invalid();
    grid.fill(value, at, at += length);
  }
  if (at !== grid.length) invalid();
  return grid;
}
