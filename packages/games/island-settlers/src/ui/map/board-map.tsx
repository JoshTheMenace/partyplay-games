/**
 * BoardMap: the phone (and host dock) SVG island (EXPERIENCE §4.2 placement, §4.3).
 *
 * - `mode="mini"`: read-only 366×230 overview. Your pieces at full colour, others at 75%, the last
 *   roll's hexes glow for 1.5 s. With `onOpen`, the whole map is one button that opens the full map.
 * - `mode="full"` (default): fills its container, pans and pinches, and auto-zooms so every spot
 *   in `spots` is at least 48 px from its neighbours. Spots are server target ids (vertex, edge,
 *   tile or unit ids, in any mix); tapping or Enter calls `onSelect`, and `ghost` previews the
 *   piece at `selected`.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import type { PublicView, SeatId } from '../../model';
import { boardIndex } from '../shared/board';
import { autoZoom, clamp, home, inView, MAX_ZOOM, viewBox, zoomAt, type Cam, type Size } from './camera';
import { Ghost, Hotspots, type GhostPiece } from './hotspots';
import { Features, Pieces } from './layers';
import { usePanZoom } from './pan-zoom';
import { resolveSpots, rolledTiles, round, type Spot } from './spots';
import { Ports, Terrain } from './terrain';
import './map.css';


export type BoardMapProps = {
  pub: PublicView;
  /** The viewer: their pieces stay full colour, ghosts use their colour, "Yours too" uses it. */
  seat?: SeatId | null;
  mode?: 'mini' | 'full';
  /** Legal target ids to show as hotspots. Nothing else is tappable. */
  spots?: readonly string[];
  selected?: string | null;
  onSelect?(id: string): void;
  /** Piece previewed at `selected` in the viewer's colour. */
  ghost?: GhostPiece | null;
  /** Spoken label overrides by spot id (for example Command choice labels). */
  labels?: Record<string, string>;
  /** Mini mode: makes the map a button ("Open the full map"). */
  onOpen?(): void;
  /** Server clock, for the 1.5 s last-roll glow. */
  serverNowMs?(): number;
  className?: string;
};

/** The land box plus room for harbour plaques. */
const PAD = 0.75;
/** Mini-map pieces are drawn 25% larger so owners stay readable at ~25 px per hex unit. */
const MINI_SCALE = 1.25;

function useSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(read);
    observer.observe(element);
    read();
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function BoardMap(props: BoardMapProps) {
  const { pub, seat = null, mode = 'full', spots: ids = [], selected = null, ghost = null, serverNowMs } = props;
  const mini = mode === 'mini', wrap = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const size = useSize(wrap), land = boardIndex(pub.board).land, measured = size.width > 0 && size.height > 0;
  const box = { minX: land.minX - PAD, minY: land.minY - PAD, maxX: land.maxX + PAD, maxY: land.maxY + PAD };
  const spots = mini ? [] : resolveSpots(pub, ids);

  // The camera re-fits only when the legal spots, the container or the island change, never on
  // ordinary snapshots: a pan is remembered under the key it was made for.
  const key = [spots.map(s => s.id).join(','), size.width, size.height, box.minX, box.minY, box.maxX, box.maxY]
    .join('|');
  const fitted = measured ? autoZoom(spots.map(s => s.at), box, size) : home(box);
  const [held, setHeld] = useState<{ key: string; cam: Cam } | null>(null);
  const cam = held?.key === key ? held.cam : fitted, maxZoom = Math.max(MAX_ZOOM, fitted.zoom);
  const setCam = (fn: (c: Cam) => Cam) => setHeld(h => ({ key, cam: fn(h?.key === key ? h.cam : fitted) }));

  const { handlers, consumeDrag } = usePanZoom({ svg, cam, setCam, box, size, maxZoom, enabled: !mini && measured });
  const view = viewBox(cam, box, measured ? size : { width: 1, height: 1 });
  const byId = new Map(spots.map(s => [s.id, s])), chosen = selected ? byId.get(selected) : undefined;

  const pick = (id: string) => { if (byId.has(id)) props.onSelect?.(id); };
  const click = (event: MouseEvent) => {
    if (consumeDrag()) return;
    const id = (event.target as Element).closest('[data-spot]')?.getAttribute('data-spot');
    if (id) pick(id);
  };
  const focusSpot = (spot: Spot) => {
    if (inView(spot.at, cam, box, size)) return;
    setCam(c => clamp({ ...c, cx: spot.at.x, cy: spot.at.y }, box, size, maxZoom));
  };
  const zoom = (factor: number) =>
    setCam(c => zoomAt(c, factor, { x: size.width / 2, y: size.height / 2 }, box, size, maxZoom));

  // The static board only re-renders on a new snapshot, not on every pan frame.
  const board = useMemo(() => {
    const age = serverNowMs && pub.lastRoll ? serverNowMs() - pub.lastRoll.at : Infinity;
    return <>
      <Terrain view={pub} glow={age < 1500 ? rolledTiles(pub) : []} glowAge={age}/>
      <Features pub={pub}/>
      <Ports view={pub}/>
      <Pieces pub={pub} seat={seat} scale={mini ? MINI_SCALE : 1}/>
    </>;
  }, [pub, seat, serverNowMs, mini]);

  const open = mini && props.onOpen;
  const refit = fitted.zoom > 1 && held?.key === key;
  return <div ref={wrap} className={`island-settlers-map ${props.className ?? ''}`} data-mode={mode}
    role={open ? 'button' : undefined} tabIndex={open ? 0 : undefined}
    aria-label={open ? 'Island map. Open the full map' : undefined}
    onClick={open ? props.onOpen : undefined}
    onKeyDown={open ? e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onOpen?.(); }
    } : undefined}>
    <svg ref={svg} className="island-settlers-map-svg" onClick={mini ? undefined : click} {...handlers}
      viewBox={`${round(view.x)} ${round(view.y)} ${round(view.width)} ${round(view.height)}`}
      role={mini ? 'img' : 'group'} aria-label={mini ? 'Island map' : 'Island map. Drag to pan, pinch to zoom.'}>
      {board}
      {spots.length > 0 && <Hotspots pub={pub} spots={spots} seat={seat} selected={selected} ppu={view.ppu}
        labels={props.labels} onPick={pick} onFocusSpot={focusSpot}/>}
      {chosen && ghost && seat && <Ghost pub={pub} spot={chosen} piece={ghost} seat={seat}/>}
    </svg>
    {!mini && <div className="island-settlers-map-tools" role="group" aria-label="Map zoom">
      <button type="button" aria-label="Zoom in" onClick={() => zoom(1.5)} disabled={cam.zoom >= maxZoom}>+</button>
      <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.5)} disabled={cam.zoom <= 1}>−</button>
      <button type="button" aria-label={refit ? 'Fit the legal spots' : 'Show the whole island'}
        onClick={() => (refit ? setHeld(null) : setCam(() => home(box)))}>⤢</button>
    </div>}
  </div>;
}
