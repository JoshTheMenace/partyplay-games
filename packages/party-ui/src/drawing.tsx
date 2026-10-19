import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { DRAWING_COLORS, DRAWING_LIMITS, packDrawing, parseDrawing, type Drawing, type DrawingPoint as Pt, type DrawingStroke } from '../../party-contract/src/index';

const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;
/** Paints strokes in order onto a transparent square of `size` px; the element's background is the paper. `bold` thickens fine pens for viewing from the sofa. */
function paint(ctx: CanvasRenderingContext2D, strokes: readonly DrawingStroke[], size: number, bold = false) {
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const s of strokes) {
    const path = new Path2D(), at = (p: Pt) => [p.x * size, p.y * size] as const;
    ctx.globalCompositeOperation = s.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.fillStyle = ctx.strokeStyle = s.color;
    if (s.tool === 'fill') {
      let start: Pt | null = null;
      for (const p of s.points) if (!start) { path.moveTo(...at(p)); start = p; } else { path.lineTo(...at(p)); if (same(p, start)) { path.closePath(); start = null; } }
      ctx.fill(path, 'evenodd'); continue;
    }
    // Curves through the midpoints smooth the line; the tiny first segment turns a tap into a round dot.
    const [x, y] = at(s.points[0]!); path.moveTo(x, y); path.lineTo(x + .01, y);
    for (let i = 1; i < s.points.length - 1; i++) { const p = s.points[i]!, q = s.points[i + 1]!; path.quadraticCurveTo(...at(p), ...at({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })); }
    path.lineTo(...at(s.points.at(-1)!));
    ctx.lineWidth = (bold && !s.tool ? Math.max(s.width, .018 + s.width * .6) : s.width) * size; ctx.stroke(path);
  }
  ctx.globalCompositeOperation = 'source-over';
}
/** A canvas whose backing store tracks its on-screen size, so art stays crisp on any screen. */
function useCanvas() {
  const ref = useRef<HTMLCanvasElement>(null), [px, setPx] = useState(0);
  useEffect(() => { const c = ref.current!, ro = new ResizeObserver(() => setPx(Math.min(2048, Math.round(c.clientWidth * devicePixelRatio)))); ro.observe(c); return () => ro.disconnect(); }, []);
  return [ref, px] as const;
}
/** Shows a drawing object or its packed string. `edge` adds a screen-print outline in that colour around the art (inset to leave room for it). */
export function DrawingRenderer({ drawing, label = 'Player drawing', className = '', edge, bold = false }: { drawing: Drawing | string; label?: string; className?: string; edge?: string; bold?: boolean }) {
  const [ref, px] = useCanvas(), strokes = useMemo(() => { try { return parseDrawing(drawing).strokes; } catch { return []; } }, [drawing]);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d'); if (!ctx || !px) return;
    ctx.clearRect(0, 0, px, px);
    if (!edge) return paint(ctx, strokes, px, bold);
    const layer = () => { const c = document.createElement('canvas'); c.width = c.height = px; return [c, c.getContext('2d')!] as const; };
    const [art, a] = layer(), [sil, s] = layer(), inset = px / 22;
    a.translate(inset, inset); paint(a, strokes, px - 2 * inset, bold);
    s.drawImage(art, 0, 0); s.globalCompositeOperation = 'source-in'; s.fillStyle = edge; s.fillRect(0, 0, px, px);
    for (let i = 0; i < 16; i++) ctx.drawImage(sil, Math.cos(i * Math.PI / 8) * px * .01, Math.sin(i * Math.PI / 8) * px * .01);
    ctx.drawImage(art, 0, 0);
  }, [strokes, px, edge, bold]);
  return <canvas ref={ref} width={px || 300} height={px || 300} className={`kp-drawing ${className}`} {...label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }} />;
}

/** Ramer–Douglas–Peucker: drops points within `eps` of the line through their neighbours. */
function simplify(p: Pt[], eps: number) {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length), stack = [[0, p.length - 1]]; keep[0] = keep[p.length - 1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop()!, A = p[a!]!, B = p[b!]!, dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
    let far = 0, at = 0;
    for (let i = a! + 1; i < b!; i++) { const d = len ? Math.abs(dx * (A.y - p[i]!.y) - dy * (A.x - p[i]!.x)) / len : Math.hypot(p[i]!.x - A.x, p[i]!.y - A.y); if (d > far) { far = d; at = i; } }
    if (far > eps) { keep[at] = 1; stack.push([a!, at], [at, b!]); }
  }
  return p.filter((_, i) => keep[i]);
}
const N = 1000, SEGMENTS = ['', '32', '21', '31', '01', '30 21', '02', '30', '30', '02', '01 32', '01', '31', '21', '32'];
/** Paint bucket: floods the region under `at` on a raster of the drawing, then traces its outline (with holes) into a vector fill. */
function bucket(strokes: readonly DrawingStroke[], at: Pt, color: string): DrawingStroke | null {
  const c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true })!; paint(ctx, strokes, N);
  const d = ctx.getImageData(0, 0, N, N).data, W = N + 2, mask = new Uint8Array(W * W), stack = new Int32Array(N * N);
  const seed = Math.min(N - 1, Math.floor(at.y * N)) * N + Math.min(N - 1, Math.floor(at.x * N)), ink = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  if (d[seed * 4 + 3] === 255 && ink.every((v, i) => v === d[seed * 4 + i])) return null;
  // Compare premultiplied colour so soft line edges count as near-paper and the fill tucks under them.
  const pm = (i: number, ch: number) => ch === 3 ? d[i + 3]! : d[i + ch]! * d[i + 3]! / 255, ref = [0, 1, 2, 3].map(ch => pm(seed * 4, ch));
  let top = 0;
  const visit = (k: number) => { const y = (k / N) | 0, m = k + 2 * y + W + 1; if (!mask[m] && ref.every((v, ch) => Math.abs(pm(k * 4, ch) - v) <= 96)) { mask[m] = 1; stack[top++] = k; } };
  visit(seed);
  while (top) { const k = stack[--top]!, x = k % N; if (x) visit(k - 1); if (x < N - 1) visit(k + 1); if (k >= N) visit(k - N); if (k < N * N - N) visit(k + N); }
  // Marching squares on the padded mask; edge midpoints are keyed on a doubled grid and every one joins exactly two segments.
  const K = 2 * W + 1, links = new Map<number, number[]>(), join = (a: number, b: number) => { for (const [p, q] of [[a, b], [b, a]]) { const l = links.get(p!); if (l) l.push(q!); else links.set(p!, [q!]); } };
  for (let y = 0; y < W - 1; y++) for (let x = 0; x < W - 1; x++) {
    const i = y * W + x, segs = SEGMENTS[mask[i]! << 3 | mask[i + 1]! << 2 | mask[i + W + 1]! << 1 | mask[i + W]!];
    if (!segs) continue;
    const edge = [2 * y * K + 2 * x + 1, (2 * y + 1) * K + 2 * x + 2, (2 * y + 2) * K + 2 * x + 1, (2 * y + 1) * K + 2 * x];
    for (const s of segs.split(' ')) join(edge[+s[0]!]!, edge[+s[1]!]!);
  }
  const points: Pt[] = [], q = (v: number) => Math.round(Math.max(0, Math.min(1, (v / 2 - .5) / N)) * 1000) / 1000;
  for (const [start] of links) {
    const ring: Pt[] = []; let prev = -1, cur = start;
    do { const [a, b] = links.get(cur)!; links.delete(cur); ring.push({ x: q(cur % K), y: q(Math.floor(cur / K)) }); [prev, cur] = [cur, a !== prev ? a! : b!]; } while (cur !== start && links.has(cur));
    const kept = simplify([...ring, ring[0]!], .001).filter((p, i, all) => !i || !same(p, all[i - 1]!));
    if (kept.length > 3) points.push(...kept);
  }
  return points.length ? { tool: 'fill', color, width: DRAWING_LIMITS.widthMin, points } : null;
}

type Tool = 'pen' | 'erase' | 'fill' | 'pick';
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const TOOLS: readonly [Tool, string, string][] = [
  ['pen', 'Brush', 'M4 20l4.5-1L19.5 8a2.1 2.1 0 0 0-3-3L5.5 15.5zM14.5 7l2.5 2.5'],
  ['erase', 'Eraser', 'M8 20h12M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8zM9 11l4 4'],
  ['fill', 'Paint bucket', 'M4.5 11.5l7-7 7 7-7 7zM4.5 11.5h14M20.5 15.5s1.8 2.3 1.8 3.6a1.8 1.8 0 0 1-3.6 0c0-1.3 1.8-3.6 1.8-3.6'],
  ['pick', 'Colour picker', 'M16.5 3.5l4 4-3 3-4-4zM14.5 5.5l-9 9V18h3.5l9-9M3.5 20.5l2-2.5'],
];
/** The slider is quadratic so fine pens get most of its travel. */
const toWidth = (v: number) => Math.round((DRAWING_LIMITS.widthMin + (DRAWING_LIMITS.widthMax - DRAWING_LIMITS.widthMin) * (v / 100) ** 2) * 1000) / 1000;
const toSlider = (w: number) => Math.round(Math.sqrt((w - DRAWING_LIMITS.widthMin) / (DRAWING_LIMITS.widthMax - DRAWING_LIMITS.widthMin)) * 100);

/**
 * Drawing pad: brush, eraser, paint bucket and colour picker; palette plus custom colour; brush size; undo/redo/clear
 * (clear is undoable) and a two-finger tap to undo. Strokes commit on release, so `onChange` (and any draft) runs once per mark.
 */
export function DrawingPad({ value, onChange, disabled = false, label = 'Draw here' }: { value: Drawing; onChange(drawing: Drawing): void; disabled?: boolean; label?: string }) {
  const [tool, setTool] = useState<Tool>('pen'), [color, setColor] = useState<string>(DRAWING_COLORS[0]), [width, setWidth] = useState(.012), [full, setFull] = useState(false);
  const [ref, px] = useCanvas(), base = useRef<HTMLCanvasElement | null>(null), frame = useRef(0), gesture = useRef(0);
  const live = useRef<{ id: number; at: number; stroke: DrawingStroke } | null>(null);
  // Undo history belongs to this pad's own edits: a new value from outside (next round, restored draft) starts it afresh.
  const history = useRef({ past: [] as Drawing[], future: [] as Drawing[] }), mine = useRef(value), current = useRef(value);
  if (value !== mine.current) { history.current = { past: [], future: [] }; mine.current = value; }
  current.current = value;
  const used = useMemo(() => packDrawing(value).length / DRAWING_LIMITS.chars, [value]);
  function emit(next: Drawing) { mine.current = next; setFull(false); onChange(next); }
  function commit(next: Drawing) {
    if (packDrawing(next).length > DRAWING_LIMITS.chars) { setFull(true); return false; }
    const h = history.current; h.past = [...h.past.slice(-99), current.current]; h.future = []; emit(next); return true;
  }
  const undo = () => { const h = history.current; if (!h.past.length && !current.current.strokes.length) return; const prev = h.past.pop() ?? { strokes: current.current.strokes.slice(0, -1) }; h.future.push(current.current); emit(prev); };
  const redo = () => { const h = history.current, next = h.future.pop(); if (next) { h.past.push(current.current); emit(next); } };

  function draw() {
    const ctx = ref.current?.getContext('2d'); if (!ctx || !px) return;
    ctx.clearRect(0, 0, px, px); if (base.current) ctx.drawImage(base.current, 0, 0);
    if (live.current) paint(ctx, [live.current.stroke], px);
  }
  useEffect(() => {
    if (!px) return;
    const c = base.current ??= document.createElement('canvas'); c.width = c.height = px;
    paint(c.getContext('2d')!, value.strokes, px); draw();
  }, [value, px]);
  function finish() {
    const l = live.current; live.current = null;
    if (!l) return;
    if (ref.current?.parentElement?.hasPointerCapture(l.id)) ref.current.parentElement.releasePointerCapture(l.id);
    if (!commit({ strokes: [...current.current.strokes, { ...l.stroke, points: simplify(l.stroke.points, .0008) }] })) draw();
  }
  useEffect(() => { addEventListener('blur', finish); return () => { removeEventListener('blur', finish); cancelAnimationFrame(frame.current); frame.current = 0; }; });
  useEffect(() => { if (disabled) finish(); }, [disabled]);

  function point(e: { clientX: number; clientY: number }, box = ref.current!.getBoundingClientRect()): Pt {
    const f = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
    return { x: f((e.clientX - box.left) / box.width), y: f((e.clientY - box.top) / box.height) };
  }
  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return;
    // A second finger right after the first is a two-finger tap: drop the fresh mark and undo on release.
    if (live.current) { if (performance.now() - live.current.at < 300) { live.current = null; gesture.current = performance.now(); draw(); } return; }
    e.preventDefault();
    const p = point(e);
    if (tool === 'fill') { const fill = bucket(current.current.strokes, p, color); if (fill) commit({ strokes: [...current.current.strokes, fill] }); return; }
    if (tool === 'pick') {
      const [r, g, b, a] = base.current && px ? base.current.getContext('2d')!.getImageData(Math.min(px - 1, Math.floor(p.x * px)), Math.min(px - 1, Math.floor(p.y * px)), 1, 1).data : [0, 0, 0, 0];
      setColor(a! < 128 ? '#fff6e5' : `#${[r, g, b].map(v => v!.toString(16).padStart(2, '0')).join('')}`); setTool('pen'); return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    live.current = { id: e.pointerId, at: performance.now(), stroke: { ...(tool === 'erase' && { tool: 'erase' as const }), color, width, points: [p] } }; draw();
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const l = live.current; if (!l || l.id !== e.pointerId) return;
    const box = ref.current!.getBoundingClientRect();
    for (const ev of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) {
      const p = point(ev, box), last = l.stroke.points.at(-1)!;
      if (Math.hypot(p.x - last.x, p.y - last.y) >= .002) l.stroke.points.push(p);
    }
    frame.current ||= requestAnimationFrame(() => { frame.current = 0; draw(); });
  }
  function up(e: ReactPointerEvent<HTMLDivElement>) {
    if (live.current?.id === e.pointerId) return finish();
    if (gesture.current && performance.now() - gesture.current < 500) { gesture.current = 0; undo(); }
  }
  const choose = (ink: string) => { setColor(ink); if (tool === 'erase' || tool === 'pick') setTool('pen'); };
  const custom = !DRAWING_COLORS.includes(color as typeof DRAWING_COLORS[number]);
  const past = history.current.past.length > 0 || value.strokes.length > 0, ahead = history.current.future.length > 0;
  return <div className="kp-drawing-pad">
    <div className="kp-row kp-draw-palette">
      <button type="button" className="kp-tool" aria-label="Undo" title="Undo (or tap with two fingers)" disabled={disabled || !past} onClick={() => { finish(); undo(); }}><Icon d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></button>
      <button type="button" className="kp-tool" aria-label="Redo" title="Redo" disabled={disabled || !ahead} onClick={redo}><Icon d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" /></button>
      <div className="kp-swatches" role="group" aria-label="Ink colour">
        <label className="kp-swatch kp-swatch-custom" title="Any colour" data-on={custom || undefined} style={{ '--ink': color } as CSSProperties}><input type="color" aria-label="Custom ink" value={color} disabled={disabled} onChange={e => choose(e.target.value)} /></label>
        {DRAWING_COLORS.map(ink => <button key={ink} type="button" className="kp-swatch" style={{ background: ink }} aria-label={`Ink ${ink}`} aria-pressed={ink === color} disabled={disabled} onClick={() => choose(ink)} />)}
      </div>
    </div>
    <div className="kp-drawing-surface" data-tool={tool} aria-label={label} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={finish} onContextMenu={e => e.preventDefault()}>
      <canvas ref={ref} width={px || 300} height={px || 300} className="kp-drawing" role="img" aria-label={label} />
    </div>
    <div className="kp-row kp-draw-tools">
      <div className="kp-tools" role="radiogroup" aria-label="Tool">{TOOLS.map(([id, name, d]) => <button key={id} type="button" role="radio" className="kp-tool" aria-checked={tool === id} aria-label={name} title={name} disabled={disabled} onClick={() => setTool(id)}><Icon d={d} /></button>)}</div>
      <label className="kp-size" title="Brush size"><i><b style={{ width: Math.max(3, width * 300), background: tool === 'erase' ? 'var(--kp-cream)' : color }} /></i><input type="range" min="0" max="100" aria-label="Brush size" value={toSlider(width)} disabled={disabled} onChange={e => setWidth(toWidth(+e.target.value))} /></label>
      <button type="button" className="kp-tool" aria-label="Clear" title="Clear (undo brings it back)" disabled={disabled || !value.strokes.length} onClick={() => { finish(); commit({ strokes: [] }); }}><Icon d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></button>
      {(full || used > .75) && <span role="status" className="kp-ink">{full ? 'Canvas full: undo or clear to keep drawing' : `Ink ${Math.round(used * 100)}%`}</span>}
    </div>
  </div>;
}
