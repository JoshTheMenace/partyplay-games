export type Input = { x: number; y: number; boost: boolean };
export type Settings = { seconds: number };
export type Racer = { id: string; name: string; color: string; x: number; z: number; score: number; connected: boolean };
export type View = { players: Racer[]; stars: { x: number; z: number }[]; endsAt: number; complete: boolean };
// World units: metres, +Y up, +X right, +Z toward the bottom of the screen.
export const ARENA = { halfX: 8, halfZ: 5, radius: .38, pillarRadius: 1.2, speed: 3.2, boostSpeed: 5.2 };
export function interpolate(a: View, b: View, alpha: number): View {
  return { ...b, players: b.players.map(player => { const before = a.players.find(item => item.id === player.id); return before ? { ...player, x: before.x + (player.x - before.x) * alpha, z: before.z + (player.z - before.z) * alpha } : player; }) };
}
