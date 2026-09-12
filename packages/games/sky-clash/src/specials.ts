import { ROSTER, ROSTER_DATA, type FighterKind } from './roster';
export type Special = { startup: number; active: number; end: number; damage: number; angle: number; growth: number; base: number; travel: number; projectile: boolean; speed: number; gravity: number; bounce: boolean; reflect: boolean; absorb: boolean; counter: boolean; armor: boolean; heal: number; selfDamage: number; flinch: boolean };
// Reconstructed specials: original character-specific parameter banks and behavior are incomplete.
// Names live in roster.json; numerical adaptations here are deliberately separate from imported normals.
const hit = (startup: number, damage: number, angle = 45, active = 4, extra: Partial<Special> = {}): Special => ({ startup, active, end: startup + active + 22, damage, angle, growth: 90, base: 35, travel: 0, projectile: false, speed: 20, gravity: 0, bounce: false, reflect: false, absorb: false, counter: false, armor: false, heal: 0, selfDamage: 0, flinch: true, ...extra });
const shot = (startup: number, damage: number, speed = 20, extra: Partial<Special> = {}) => hit(startup, damage, 45, 1, { projectile: true, speed, ...extra });
const rush = (startup: number, damage: number, travel = 2.4, active = 15) => hit(startup, damage, 45, active, { travel });
const rise = (startup: number, damage: number, travel = 3.2, active = 20) => hit(startup, damage, 80, active, { travel });
const counter = () => hit(5, 10, 70, 24, { counter: true });
const fireball = () => shot(17, 6, 14, { gravity: 14, bounce: true });
type Kit = [Special, Special, Special, Special];
const kits: Partial<Record<FighterKind, Kit>> = {
  mario: [fireball(), hit(12, 8, 60, 8, { reflect: true }), rise(3, 8, 3.4, 18), hit(8, 10, 75, 22)],
  fox: [shot(10, 3, 38, { flinch: false }), rush(21, 7, 18, 4), rise(43, 14, 3.8, 30), hit(1, 5, 0, 3, { reflect: true })],
  falco: [shot(16, 3, 38), rush(17, 7, 18, 4), rise(43, 16, 2.8, 24), hit(1, 8, 90, 3, { reflect: true })],
  'captain-falcon': [hit(52, 27, 361, 5, { base: 30 }), rush(14, 7, 2.5, 18), rise(13, 12, 3.3, 22), rush(15, 13, 2.8, 22)],
  'donkey-kong': [hit(25, 24, 361, 7), hit(20, 10, 270, 8), rise(4, 12, 1.8, 35), hit(19, 11, 80, 20)],
  kirby: [hit(10, 8, 80, 26), hit(20, 23, 45, 7), rise(12, 8, 3.1, 20), hit(14, 18, 70, 32, { armor: true })],
  bowser: [shot(12, 2, 11, { end: 20 }), hit(16, 14, 65, 10), rise(5, 13, 2.2, 27), hit(22, 21, 75, 16, { armor: true })],
  link: [shot(18, 8, 29, { gravity: 3 }), shot(27, 11, 18), rise(8, 15, 2.7, 25), shot(20, 12, 11, { gravity: 15, bounce: true })],
  sheik: [shot(7, 3, 36), hit(18, 8, 70, 22), rise(30, 10, 5, 9), hit(20, 8, 75, 10, { reflect: true })],
  ness: [shot(30, 19, 10), shot(18, 8, 17, { gravity: 6 }), rise(25, 22, 4.4, 18), hit(6, 0, 0, 25, { absorb: true })],
  peach: [counter(), rush(15, 16, 2.3, 14), rise(7, 12, 2.5, 30), shot(18, 9, 13, { gravity: 14, bounce: true })],
  popo: [shot(18, 6, 13, { gravity: 12, bounce: true }), rush(12, 12, 1.8, 25), rise(15, 10, 3.8, 18), shot(9, 2, 9, { end: 18 })],
  nana: [shot(18, 6, 13, { gravity: 12, bounce: true }), rush(12, 12, 1.8, 25), rise(15, 10, 3.8, 18), shot(9, 2, 9, { end: 18 })],
  pikachu: [shot(19, 7, 18, { gravity: 20, bounce: true }), rush(20, 15, 3.6, 18), rise(8, 3, 5.5, 12), hit(30, 17, 80, 12)],
  samus: [shot(28, 22, 24), shot(20, 12, 19), rise(4, 12, 2.9, 24), shot(14, 7, 5, { gravity: 20, bounce: true })],
  yoshi: [hit(17, 10, 80, 8), rush(18, 12, 2.2, 26), rise(14, 6, 2.7, 22), hit(18, 16, 75, 22, { armor: true })],
  jigglypuff: [rush(25, 18, 3, 25), rush(12, 11, 75 / 60, 16), rise(12, 0, 1.8, 25), hit(1, 28, 88, 3, { end: 180, base: 78 })],
  mewtwo: [shot(25, 20, 18), hit(12, 10, 80, 14, { reflect: true }), rise(18, 0, 5.5, 10), hit(16, 6, 80, 8)],
  luigi: [shot(17, 6, 14), rush(24, 21, 3.4, 20), rise(5, 25, 3.8, 16), hit(10, 12, 75, 26)],
  marth: [hit(22, 22, 361, 5, { base: 30 }), hit(6, 12, 65, 17), rise(5, 13, 3.7, 15), counter()],
  zelda: [hit(10, 11, 70, 20, { reflect: true }), shot(26, 16, 15), rise(30, 0, 5, 11), hit(20, 8, 75, 10, { reflect: true })],
  'young-link': [shot(16, 7, 27, { gravity: 4 }), shot(25, 10, 20), rise(8, 12, 2.9, 25), shot(18, 10, 12, { gravity: 15, bounce: true })],
  'dr-mario': [shot(17, 8, 14, { gravity: 14, bounce: true }), hit(12, 10, 60, 8, { reflect: true }), rise(3, 12, 3.1, 18), hit(8, 13, 75, 22)],
  pichu: [shot(19, 7, 18, { gravity: 20, bounce: true, selfDamage: 1 }), rush(20, 12, 3.8, 18), rise(8, 0, 5.8, 12), hit(30, 16, 80, 12, { selfDamage: 3 })],
  'game-watch': [shot(15, 6, 10, { gravity: 12, bounce: true }), hit(16, 16, 75, 5), rise(3, 6, 3.7, 20), hit(7, 0, 0, 26, { absorb: true })],
  ganondorf: [hit(70, 32, 361, 6, { base: 35 }), rush(16, 17, 2.2, 18), rise(14, 17, 2.8, 23), rush(16, 15, 2.6, 22)],
  roy: [hit(24, 25, 361, 5), hit(6, 13, 65, 18), rise(9, 15, 3.1, 19), counter()],
  'master-hand': [shot(14, 10, 25), rush(14, 16, 2.8, 18), rise(12, 8, 3.5, 20), hit(22, 23, 270, 10)],
  'crazy-hand': [shot(11, 8, 28), rush(10, 13, 3.4, 18), rise(10, 10, 3.8, 18), hit(28, 26, 70, 9)],
  sandbag: [shot(18, 7, 12, { gravity: 10 }), rush(14, 12, 2.3, 17), rise(8, 8, 3.8, 19), hit(18, 15, 75, 15, { armor: true })],
};
export const SPECIALS = Object.fromEntries(ROSTER.map(kind => {
  const kit = kits[kind] ?? kits[ROSTER_DATA[kind].profile as FighterKind]!;
  return [kind, { laser: kit[0], dash: kit[1], rise: kit[2], reflect: kit[3] }];
})) as Record<FighterKind, Record<'laser' | 'dash' | 'rise' | 'reflect', Special>>;
export const specialFor = (kind: FighterKind, move: string | null): Special | undefined => move && move in SPECIALS[kind] ? SPECIALS[kind][move as keyof typeof SPECIALS.fox] : undefined;
