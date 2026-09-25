/**
 * One finger pans, two fingers pinch, the wheel zooms at the cursor. A press that travels under 8 px
 * stays a tap, so the click that follows it still lands on the hotspot underneath.
 */
import { useEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { distance, midpoint, type Point } from '../../geometry';
import type { Bounds } from '../../model';
import { panBy, zoomAt, type Cam, type Size } from './camera';

type Args = {
  svg: RefObject<SVGSVGElement | null>; cam: Cam; setCam(update: (cam: Cam) => Cam): void;
  box: Bounds; size: Size; maxZoom: number; enabled: boolean;
};
const TAP_SLOP = 8;

/** Pointer position in the map's own px (0, 0 = its top-left corner). */
const local = (element: Element, event: { clientX: number; clientY: number }): Point => {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

export function usePanZoom({ svg, cam, setCam, box, size, maxZoom, enabled }: Args) {
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ cam: Cam; spread: number; mid: Point } | null>(null);
  const travel = useRef(0), dragged = useRef(false);

  useEffect(() => {
    const element = svg.current;
    if (!element || !enabled) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setCam(c => zoomAt(c, event.deltaY < 0 ? 1.2 : 1 / 1.2, local(element, event), box, size, maxZoom));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [svg, enabled, setCam, box, size, maxZoom]);

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    pinch.current = a && b ? { cam, spread: distance(a, b), mid: midpoint(a, b) } : null;
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (pointers.current.size === 0) { travel.current = 0; dragged.current = false; }
    pointers.current.set(event.pointerId, local(event.currentTarget, event));
    if (pointers.current.size === 2) {
      startPinch();
      for (const id of pointers.current.keys()) event.currentTarget.setPointerCapture?.(id);
    }
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (!before) return;
    const now = local(event.currentTarget, event);
    pointers.current.set(event.pointerId, now);
    travel.current += distance(before, now);
    const start = pinch.current;
    if (pointers.current.size >= 2 && start) {
      const [p, q] = [...pointers.current.values()], mid = midpoint(p, q);
      dragged.current = true;
      const zoomed = zoomAt(start.cam, distance(p, q) / (start.spread || 1), start.mid, box, size, maxZoom);
      setCam(() => panBy(zoomed, mid.x - start.mid.x, mid.y - start.mid.y, box, size, maxZoom));
    } else if (travel.current > TAP_SLOP) {
      if (!dragged.current) event.currentTarget.setPointerCapture?.(event.pointerId);
      dragged.current = true;
      setCam(c => panBy(c, now.x - before.x, now.y - before.y, box, size, maxZoom));
    }
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (pointers.current.size === 2) startPinch();
    else pinch.current = null;
  };

  /** True once, for the click that ends a drag or pinch (so it does not select a spot). */
  const consumeDrag = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };

  return {
    handlers: enabled
      ? { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up, onLostPointerCapture: up }
      : {},
    consumeDrag,
  };
}
