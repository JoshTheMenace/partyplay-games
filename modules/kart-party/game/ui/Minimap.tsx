import React, { useId, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils';
import type { Hazard, Racer, TrackId } from '../types';
import { TRACKS, sample } from '../tracks';
import { driverOf } from './format';

type Projection = { minX: number; minZ: number; scale: number; width: number; height: number; pad: number };

/** Road centreline as the simulation sees it, including any magnetic loop that replaces part of the base road. */
const PATH_SAMPLES = 256;
function centreline(id: TrackId) {
  const track = TRACKS[id];
  return Array.from({ length: PATH_SAMPLES }, (_, i) => sample(track, i / PATH_SAMPLES));
}

function projectionFor(id: TrackId, size: number): Projection {
  const track = TRACKS[id];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of centreline(id)) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const pad = track.width * 1.4;
  const spanX = maxX - minX + pad * 2;
  const spanZ = maxZ - minZ + pad * 2;
  const scale = size / Math.max(spanX, spanZ);
  return { minX: minX - pad, minZ: minZ - pad, scale, width: spanX * scale, height: spanZ * scale, pad };
}

function usePath(id: TrackId, size: number) {
  return useMemo(() => {
    const track = TRACKS[id];
    const proj = projectionFor(id, size);
    const px = (x: number) => (x - proj.minX) * proj.scale;
    const pz = (z: number) => (z - proj.minZ) * proj.scale;
    const d = centreline(id).map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)} ${pz(p.z).toFixed(1)}`).join(' ') + ' Z';
    const start = sample(track, 0);
    const across = { x: Math.cos(start.heading), z: -Math.sin(start.heading) };
    const half = track.width / 2;
    const startLine = {
      x1: px(start.x + across.x * half),
      y1: pz(start.z + across.z * half),
      x2: px(start.x - across.x * half),
      y2: pz(start.z - across.z * half),
    };
    const boosts = track.boosts.map((s) => {
      const p = sample(track, s);
      return { x: px(p.x), y: pz(p.z), angle: (-p.heading * 180) / Math.PI + 180 };
    });
    const boxes = track.boxes.map((s) => {
      const p = sample(track, s);
      return { x: px(p.x), y: pz(p.z) };
    });
    return { proj, d, px, pz, startLine, boosts, boxes, roadWidth: track.width * proj.scale };
  }, [id, size]);
}

/** Track outline used by track cards and the lobby preview. */
export const RAINBOW_STOPS = ['#ff5748', '#ff974f', '#ffd24a', '#78d955', '#28c6e7', '#b58aff', '#ff7bb7'];

export function TrackOutline({ id, size = 200, className, glow = true }: { id: TrackId; size?: number; className?: string; glow?: boolean }) {
  const track = TRACKS[id];
  const { proj, d, startLine, roadWidth } = usePath(id, size);
  const gradientId = useId();
  // Rainbow Road paints its road with a spectrum instead of the single track color.
  const rainbow = id === 'rainbow';
  const stroke = rainbow ? `url(#${gradientId})` : track.color;
  return (
    <svg
      viewBox={`0 0 ${proj.width.toFixed(1)} ${proj.height.toFixed(1)}`}
      className={cn('h-auto w-full', className)}
      aria-hidden="true"
      style={{ filter: glow ? `drop-shadow(0 0 10px ${rainbow ? '#ffffff' : track.color}66)` : undefined } as CSSProperties}
    >
      {rainbow ? (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            {RAINBOW_STOPS.map((color, index) => (
              <stop key={color} offset={index / (RAINBOW_STOPS.length - 1)} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
      ) : null}
      <path d={d} fill="none" stroke="rgba(5,7,26,0.85)" strokeWidth={roadWidth + 4} strokeLinejoin="round" />
      <path d={d} fill="none" stroke={stroke} strokeWidth={roadWidth} strokeLinejoin="round" strokeOpacity={rainbow ? 1 : 0.9} />
      <path d={d} fill="none" stroke="#fff" strokeWidth={Math.max(1, roadWidth * 0.12)} strokeDasharray={`${roadWidth * 0.6} ${roadWidth * 0.6}`} strokeOpacity="0.55" />
      <line {...startLine} stroke="#fff" strokeWidth={Math.max(2, roadWidth * 0.3)} strokeLinecap="round" />
    </svg>
  );
}

export function Minimap({
  track: id,
  racers,
  hazards,
  focusId,
  size = 180,
  className,
}: {
  track: TrackId;
  racers: Racer[];
  hazards: Hazard[];
  focusId: string;
  size?: number;
  className?: string;
}) {
  const track = TRACKS[id];
  const { proj, d, px, pz, startLine, boosts, boxes, roadWidth } = usePath(id, size);
  const dot = Math.max(4, roadWidth * 0.45);
  const others = racers.filter((r) => r.id !== focusId);
  const focus = racers.find((r) => r.id === focusId);
  return (
    <svg
      viewBox={`0 0 ${proj.width.toFixed(1)} ${proj.height.toFixed(1)}`}
      width={size}
      height={(size * proj.height) / proj.width}
      className={cn('overflow-visible', className)}
      aria-label="Track map"
    >
      <path d={d} fill="none" stroke="rgba(5,7,26,0.75)" strokeWidth={roadWidth + 5} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="rgba(255,246,229,0.9)" strokeWidth={roadWidth} strokeLinejoin="round" />
      <path d={d} fill="none" stroke={track.color} strokeWidth={roadWidth * 0.7} strokeLinejoin="round" strokeOpacity="0.55" />
      <line {...startLine} stroke="#05071a" strokeWidth={Math.max(2, roadWidth * 0.35)} strokeLinecap="round" />
      {boosts.map((b, i) => (
        <g key={`boost-${i}`} transform={`translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${b.angle.toFixed(1)})`}>
          <path d={`M${-dot * 0.6} ${dot * 0.5} L0 ${-dot * 0.5} L${dot * 0.6} ${dot * 0.5}`} fill="none" stroke="#ffd24a" strokeWidth={1.5} strokeLinejoin="round" />
        </g>
      ))}
      {boxes.map((b, i) => (
        <rect key={`box-${i}`} x={b.x - dot * 0.35} y={b.y - dot * 0.35} width={dot * 0.7} height={dot * 0.7} fill="#b58aff" stroke="#05071a" strokeWidth={1} transform={`rotate(45 ${b.x} ${b.y})`} />
      ))}
      {hazards.map((h) => (
        <circle key={`hz-${h.id}`} cx={px(h.x)} cy={pz(h.z)} r={dot * 0.4} fill={h.kind === 'banana' ? '#ffd24a' : '#ff5748'} stroke="#05071a" strokeWidth={1} />
      ))}
      {others.map((r) => (
        <circle
          key={r.id}
          cx={px(r.x)}
          cy={pz(r.z)}
          r={dot * (r.bot ? 0.7 : 0.85)}
          fill={driverOf(r.driver).color}
          stroke="#05071a"
          strokeWidth={1.5}
          opacity={r.finishTime != null ? 0.45 : 1}
        />
      ))}
      {focus ? (
        <g transform={`translate(${px(focus.x).toFixed(1)} ${pz(focus.z).toFixed(1)})`}>
          <circle r={dot * 1.35} fill="#fff" opacity="0.9" />
          <circle r={dot} fill={driverOf(focus.driver).color} stroke="#05071a" strokeWidth={1.5} />
          <path
            d={`M0 ${-dot * 1.9} L${dot * 0.55} ${-dot * 1.1} L${-dot * 0.55} ${-dot * 1.1} Z`}
            fill="#fff"
            transform={`rotate(${((-focus.heading * 180) / Math.PI + 180).toFixed(1)})`}
          />
        </g>
      ) : null}
    </svg>
  );
}
