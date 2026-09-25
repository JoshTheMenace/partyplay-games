import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Crew, HullDef, PublicView, RoomState, ShipView } from '../contracts';
import { hullDef } from '../defs/hulls';
import { SPRITE_MARGIN_X, SPRITE_MARGIN_Y, shipLayout, type Box, type ShipLayout } from '../defs/geometry';
import { drawShip, type ShipDrawOptions } from '../render/ship';
import { alive, ownerColors } from './common';

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null), [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => { const el = ref.current; if (!el) return; const observer = new ResizeObserver(([entry]) => setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) })); observer.observe(el); return () => observer.disconnect(); }, []);
  return [ref, size] as const;
}
/** DPR-aware canvas repainted every animation frame with the latest draw callback. */
function useCanvas(size: { w: number; h: number }, draw: (ctx: CanvasRenderingContext2D) => void) {
  const ref = useRef<HTMLCanvasElement>(null), latest = useRef(draw); latest.current = draw;
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext('2d'); if (!canvas || !ctx || !size.w || !size.h) return;
    const dpr = Math.min(devicePixelRatio || 1, 3); canvas.width = Math.round(size.w * dpr); canvas.height = Math.round(size.h * dpr);
    let frame = 0; const paint = () => { frame = requestAnimationFrame(paint); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size.w, size.h); latest.current(ctx); };
    paint(); return () => cancelAnimationFrame(frame);
  }, [size.w, size.h]);
  return ref;
}
/** Fit the room grid (not the whole sprite) to the box so rooms are as large as possible; the hull art bleeds past the edges. */
export function roomsLayout(hull: HullDef, w: number, h: number, facing: 1 | -1): ShipLayout {
  const cell = Math.min(w / (hull.gridW + 1.2), h / (hull.gridH + 1)), sw = (hull.gridW + 2 * SPRITE_MARGIN_X) * cell, sh = (hull.gridH + 2 * SPRITE_MARGIN_Y) * cell;
  return shipLayout(hull, { x: (w - sw) / 2, y: (h - sh) / 2, w: sw, h: sh }, facing);
}
/** Grow a room box to a 44 px touch target, kept inside the stage. */
const target = (b: Box, w: number, h: number) => { const bw = Math.max(44, b.w), bh = Math.max(44, b.h);
  return { left: Math.max(0, Math.min(w - bw, b.x - (bw - b.w) / 2)), top: Math.max(0, Math.min(h - bh, b.y - (bh - b.h) / 2)), width: bw, height: bh }; };
/** Space kept free under the ship for the stage caption. */
const CAPTION = 20;
export const facingOf = (ship: ShipView): 1 | -1 => ship.faction === 'enemy' ? -1 : 1;

type Draw = Omit<ShipDrawOptions, 'nowMs' | 'ownerColors'>;
const paintShip = (ctx: CanvasRenderingContext2D, view: PublicView, ship: ShipView, crew: readonly Crew[], layout: ShipLayout, options: Draw, nowMs: number) =>
  drawShip(ctx, ship, crew, layout, { nowMs, ownerColors: ownerColors(view), ...options });

export type StageProps = {
  view: PublicView; ship: ShipView; serverNowMs(): number; crew?: readonly Crew[];
  onRoom?(roomId: string): void; roomLabel?(room: RoomState): string;
  highlight?: readonly string[]; selectedRoom?: string | null; selectedCrew?: readonly string[]; detail?: ShipDrawOptions['detail']; children?: ReactNode; className?: string;
};
/** A ship drawn big with transparent, labelled room buttons on top. */
export function ShipStage({ view, ship, serverNowMs, crew = alive(view.crew).filter(c => c.shipId === ship.id), onRoom, roomLabel, highlight = [], selectedRoom = null, selectedCrew = [], detail = 'phone', children, className = '' }: StageProps) {
  const [box, size] = useSize<HTMLDivElement>(), hull = hullDef(ship.hullId), layout = roomsLayout(hull, size.w, size.h - CAPTION, facingOf(ship));
  const canvas = useCanvas(size, ctx => paintShip(ctx, view, ship, crew, layout, { detail, highlightRooms: highlight, selectedRoom, selectedCrew }, serverNowMs()));
  const rooms = [...hull.rooms].sort((a, b) => b.w * b.h - a.w * a.h);
  return <div ref={box} className={`sp-stage ${className}`}>
    <canvas ref={canvas} className="sp-stage-canvas" aria-hidden="true"/>
    {onRoom && size.w > 0 && <div className="sp-rooms">{rooms.map(room => { const state = ship.rooms.find(r => r.id === room.id)!;
      return <button key={room.id} type="button" className="sp-room" style={target(layout.rooms[room.id], size.w, size.h)} aria-label={roomLabel?.(state) ?? room.id}
        data-hl={highlight.includes(room.id) || undefined} data-sel={selectedRoom === room.id || undefined} data-hurt={state.damage > 0 || state.fire > 0 || state.breach || undefined} onClick={() => onRoom(room.id)}/>; })}</div>}
    {children}
  </div>;
}
/** Whole-sprite thumbnail of a ship (target pickers, hangar). */
export function ShipThumb({ view, ship, crew, serverNowMs, detail = 'thumb', facing = facingOf(ship) }: { view: PublicView; ship: ShipView; crew?: readonly Crew[]; serverNowMs(): number; detail?: ShipDrawOptions['detail']; facing?: 1 | -1 }) {
  const [box, size] = useSize<HTMLDivElement>(), hull = hullDef(ship.hullId), people = crew ?? alive(view.crew).filter(c => c.shipId === ship.id);
  const canvas = useCanvas(size, ctx => paintShip(ctx, view, ship, people, shipLayout(hull, { x: 0, y: 0, w: size.w, h: size.h }, facing), { detail }, serverNowMs()));
  return <div ref={box} className="sp-thumb" aria-hidden="true"><canvas ref={canvas}/></div>;
}
