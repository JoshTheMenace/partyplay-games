/** The printed-cardboard layer: sea, hexes, number tokens and harbour plaques (EXPERIENCE §1.2–1.4). */
import type { CSSProperties } from 'react';
import { distance, midpoint, pips, toward, TOKEN_RADIUS, type Point } from '../../geometry';
import type { Port, PublicView, Tile } from '../../model';
import { boardIndex, tileFace } from '../shared/board';
import { GOOD_META, TERRAIN_META } from '../shared/labels';
import { CREAM, Glyph, INK } from './pieces';
import { hexPoints, round } from './spots';

type MapView = Pick<PublicView, 'board' | 'pieces'>;
const HOT = '#c62a22', BEACH = '#e8d6a6', ROBBED_FACE = '#9a9486';

/** Blend two #rrggbb colours: t = 0 gives a, 1 gives b. */
export function mix(a: string, b: string, t: number) {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const part = (i: number) => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, '0');
  return `#${[0, 1, 2].map(part).join('')}`;
}

/** A flat cream token at the hex centre: numeral 0.035 north, one row of pips 0.13 south. */
export function Token({ at, number, robbed }: { at: Point; number: number; robbed: boolean }) {
  const hot = number === 6 || number === 8, ink = hot ? HOT : INK, n = pips(number);
  return <g transform={`translate(${round(at.x)} ${round(at.y)})`} className="island-settlers-token">
    <circle r={TOKEN_RADIUS} fill={robbed ? ROBBED_FACE : CREAM} stroke={INK} strokeWidth={0.03}/>
    <text y={-0.035} fontSize={number > 9 ? 0.27 : 0.3} fill={ink} textAnchor="middle" dominantBaseline="central"
      className="island-settlers-map-text">{number}</text>
    {Array.from({ length: n }, (_, i) =>
      <circle key={i} cx={round((i - (n - 1) / 2) * 0.058)} cy={0.155} r={0.022} fill={ink}/>)}
  </g>;
}

function Hex({ tile, view, robbed }: { tile: Tile; view: MapView; robbed: boolean }) {
  const { terrain, number } = tileFace(view, tile.id), meta = TERRAIN_META[terrain];
  if (terrain === 'sea') return <polygon points={hexPoints(tile, 0.99)} fill={meta.top} opacity={0.55}/>;
  const top = robbed ? mix(meta.top, '#7d7f86', 0.55) : meta.top;
  return <g data-terrain={terrain}>
    <polygon points={hexPoints(tile, 0.965)} fill={top} stroke={meta.side} strokeWidth={0.06}
      strokeLinejoin="round"/>
    {terrain === 'fog'
      ? <path d="M-.4.12a.2.2 0 0 1 .1-.3.26.26 0 0 1 .46-.05.2.2 0 0 1 .24.35Z" fill="#d9dde8" opacity={0.8}
        transform={`translate(${round(tile.x)} ${round(tile.y)})`}/>
      : <Glyph name={terrain} x={tile.x} y={tile.y + (number ? -0.56 : 0)} size={number ? 0.3 : 0.5}
        fill={mix(meta.side, INK, 0.25)}/>}
    {number > 0 && <Token at={tile} number={number} robbed={robbed}/>}
  </g>;
}

/** Sea, beach rims under land, then every hex. Glowing hexes (last roll) fade over 1.5 s. */
export function Terrain({ view, glow, glowAge }: { view: MapView; glow: string[]; glowAge: number }) {
  const { tiles } = view.board, blocked = new Set([view.pieces.robber, view.pieces.pirate]);
  const land = tiles.filter(t => tileFace(view, t.id).terrain !== 'sea');
  const index = boardIndex(view.board);
  return <g className="island-settlers-terrain">
    {land.map(t => <polygon key={t.id} points={hexPoints(t, 1.07)} fill={BEACH}/>)}
    {tiles.map(t => <Hex key={t.id} tile={t} view={view} robbed={blocked.has(t.id)}/>)}
    {glowAge < 1500 && glow.map(id => {
      const t = index.tiles.get(id);
      return t && <polygon key={id} points={hexPoints(t, 0.9)} className="island-settlers-glow"
        style={{ animationDelay: `-${Math.round(glowAge)}ms` } as CSSProperties}/>;
    })}
  </g>;
}

/** Plaque centre: 0.55 out from the port edge's midpoint, toward the sea tile. */
export function plaquePoint(view: MapView, port: Port): { at: Point; a: Point; b: Point } | null {
  const index = boardIndex(view.board);
  const a = index.vertices.get(port.vertices[0]), b = index.vertices.get(port.vertices[1]);
  const sea = index.tiles.get(port.tile);
  if (!a || !b || !sea) return null;
  const mid = midpoint(a, b), d = distance(mid, sea) || 1;
  return { at: toward(mid, sea, 0.55 / d), a, b };
}

/** Harbour plaques: cream face, a band in the resource colour (ink for 3:1) with its icon, the ratio. */
export function Ports({ view }: { view: MapView }) {
  return <g className="island-settlers-ports">
    {view.board.ports.map(port => {
      const p = plaquePoint(view, port);
      if (!p) return null;
      const band = port.good === 'any' ? INK : GOOD_META[port.good].color;
      return <g key={port.id}>
        {[p.a, p.b].map((v, i) => <line key={i} x1={round(v.x)} y1={round(v.y)} x2={round(p.at.x)}
          y2={round(p.at.y)} stroke={INK} strokeWidth={0.07} strokeLinecap="round" opacity={0.8}/>)}
        <g transform={`translate(${round(p.at.x)} ${round(p.at.y)})`}>
          <rect x={-0.36} y={-0.2} width={0.72} height={0.4} rx={0.09} fill={CREAM} stroke={INK} strokeWidth={0.03}/>
          <path d="M-.27-.2H-.1V.2H-.27A.09.09 0 0 1-.36.11V-.11A.09.09 0 0 1-.27-.2Z" fill={band}/>
          {port.good !== 'any' && <Glyph name={port.good} x={-0.23} size={0.2}/>}
          {port.good === 'any' && <text x={-0.23} fontSize={0.2} fill={CREAM} textAnchor="middle"
            dominantBaseline="central" className="island-settlers-map-text">?</text>}
          <text x={0.13} fontSize={0.22} fill={INK} textAnchor="middle" dominantBaseline="central"
            className="island-settlers-map-text">{port.ratio}:1</text>
        </g>
      </g>;
    })}
  </g>;
}
