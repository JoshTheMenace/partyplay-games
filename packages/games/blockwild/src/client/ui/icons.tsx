/** Item icons (from the art atlas, with a readable fallback) and the HUD's pixel-art sprites. */
import type { CSSProperties } from 'react';
import { armorOf, itemOf, type Slot } from '../../shared/items';
import { itemIcon } from '../art/atlas';

function iconUrl(id: number): string | null {
  try { return itemIcon(id) || null; } catch { return null; }
}
/** A pixelated item icon; before the atlas is ready (or for an unknown id) shows a tinted tile with the item's initials. */
export function ItemIcon({ id, className = '' }: { id: number; className?: string }) {
  const url = iconUrl(id);
  if (url) return <img className={`bw-icon ${className}`} src={url} alt="" draggable={false}/>;
  const name = itemOf(id)?.name ?? '?', initials = name.split(' ').map(word => word[0]).join('').slice(0, 2);
  return <span className={`bw-icon bw-icon-fallback ${className}`} style={{ '--hue': (id * 47) % 360 } as CSSProperties} aria-hidden="true">{initials}</span>;
}

type Sprite = { rows: readonly string[]; colors: Readonly<Record<string, string>> };
const cache = new Map<string, string>();
/** Pixel pattern → crisp SVG data URL (one path per colour), cached. */
export function spriteUrl(key: string, sprite: Sprite): string {
  let url = cache.get(key);
  if (url) return url;
  const paths = new Map<string, string>();
  sprite.rows.forEach((row, y) => [...row].forEach((char, x) => {
    const color = sprite.colors[char];
    if (color) paths.set(color, `${paths.get(color) ?? ''}M${x} ${y}h1v1h-1z`);
  }));
  const width = Math.max(...sprite.rows.map(row => row.length));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${sprite.rows.length}" shape-rendering="crispEdges">${[...paths].map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join('')}</svg>`;
  cache.set(key, url = `data:image/svg+xml,${encodeURIComponent(svg)}`);
  return url;
}

const HEART = ['.kk...kk.', 'kwrk.krrk', 'kwrrrrrrk', 'krrrrrrdk', '.krrrrdk.', '..krrdk..', '...kdk...', '....k....'];
const SHANK = ['.....kk..', '....kwwk.', '....kbwk.', '..kkkbk..', '.kmmmk...', 'kmwmmk...', 'kmmmdk...', 'kmmdk....', '.kkk.....'];
const BUBBLE = ['..kkkkk..', '.kbbbbbk.', 'kbwwbbbbk', 'kbwbbbbbk', 'kbbbbbbbk', 'kbbbbbbbk', '.kbbbbbk.', '..kkkkk..'];
const CHESTPLATE = ['kkk...kkk', 'kwbk.kbbk', 'kbbbkbbdk', '.kbbbbdk.', '.kwbbbdk.', '.kbbbbdk.', '.kbbbbdk.', '.kbbbddk.', '..kkkkk..'];
/** For half icons, cells right of `split` use the empty palette. */
const halve = (rows: readonly string[], split: number) => rows.map(row => [...row].map((char, x) => x >= split && char !== '.' && char !== 'k' ? 'e' : char).join(''));
type Palette = Readonly<Record<string, string>>;
/** Pattern, half split column, full and empty palettes. */
const METERS: Record<'heart' | 'shank' | 'armor', [readonly string[], number, Palette, Palette]> = {
  heart: [HEART, 4, { k: '#1d0606', w: '#ffc4c4', r: '#e8352b', d: '#9c1712', e: '#3b1414' }, { k: '#1d0606', w: '#3b1414', r: '#3b1414', d: '#2a0c0c', e: '#3b1414' }],
  shank: [SHANK, 5, { k: '#2a1407', w: '#fff1d6', b: '#e3d3b4', m: '#c8702d', d: '#8e4618', e: '#3a2616' }, { k: '#2a1407', w: '#3a2616', b: '#3a2616', m: '#3a2616', d: '#2b1b0f', e: '#3a2616' }],
  armor: [CHESTPLATE, 4, { k: '#14161d', w: '#ffffff', b: '#c9ced8', d: '#7d8595', e: '#353a47' }, { k: '#14161d', w: '#353a47', b: '#353a47', d: '#2a2e39', e: '#353a47' }],
};

export type MeterKind = 'heart' | 'shank' | 'bubble' | 'armor';
/** One meter icon: full, half or empty. `flash` renders the white damage outline. */
export function MeterSprite({ kind, fill, flash = false }: { kind: MeterKind; fill: 'full' | 'half' | 'empty'; flash?: boolean }) {
  const key = `${kind}:${fill}:${flash}`;
  let url: string;
  if (kind === 'bubble') url = spriteUrl(key, { rows: BUBBLE, colors: { k: '#0d2c52', b: '#3f8fe0', w: '#e6f4ff' } });
  else {
    const [rows, split, full, empty] = METERS[kind];
    url = spriteUrl(key, { rows: fill === 'half' ? halve(rows, split) : rows, colors: { ...(fill === 'empty' ? empty : full), ...(flash ? { k: '#ffffff' } : {}) } });
  }
  // Spent air bubbles pop (MC): the slot stays so the rest keep their place.
  return <img className={`bw-sprite bw-sprite-${kind}`} src={url} alt="" draggable={false} style={kind === 'bubble' && fill === 'empty' ? { visibility: 'hidden' } : undefined}/>;
}

/**
 * 12×24 paper doll. Regions H hair or helmet, G face sides or helmet, C shirt or chestplate (with the upper arms), L legs,
 * K lower legs or boot shafts, F feet; lowercase = shaded.
 */
const DOLL = ['...HHHHHH...', '...hHHHHh...', '...GSSSSG...', '...GESSEG...', '...gSSSSg...', '...SSSSSS...', 'CCCCCCCCCCCC', 'cCCCCCCCCCCc', 'cCCcCCCCcCCc',
  ...Array<string>(2).fill('CCCcCCCCcCCC'), ...Array<string>(3).fill('SSScCCCCcSSS'), 'SSSccccccSSS', ...Array<string>(4).fill('...lLLLLl...'), ...Array<string>(2).fill('...kKKKKk...'),
  '...FFFFFF...', '...FFFFFF...', '...ffffff...'];
const MATERIAL: Record<string, string> = { leather: '#9a6236', golden: '#f0c43a', iron: '#d6dbe3', diamond: '#43d8cf' };
const shade = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) ? `#${hex.slice(1).match(/../g)!.map(c => Math.round(parseInt(c, 16) * 0.7).toString(16).padStart(2, '0')).join('')}` : hex;
/** Small inventory preview of the local player wearing their armor (shirt in the player colour). */
export function PlayerDoll({ color, armor }: { color: string; armor: readonly (Slot | null)[] }) {
  const worn = [0, 1, 2, 3].map(i => MATERIAL[armorOf(armor[i]?.id ?? 0)?.material ?? '']);
  const regions = { H: worn[0] ?? '#4a2f1b', G: worn[0] ?? '#c99a74', C: worn[1] ?? color, L: worn[2] ?? '#2e3a8c', K: worn[3] ?? worn[2] ?? '#2e3a8c', F: worn[3] ?? '#4d525e' };
  const colors = { S: '#c99a74', E: '#2c2350', ...regions, ...Object.fromEntries(Object.entries(regions).map(([key, value]) => [key.toLowerCase(), shade(value)])) };
  return <img className="bw-doll-art" src={spriteUrl(`doll:${JSON.stringify(colors)}`, { rows: DOLL, colors })} alt="" draggable={false}/>;
}
