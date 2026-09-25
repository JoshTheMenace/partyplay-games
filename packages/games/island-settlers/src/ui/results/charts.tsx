/** Small hand-built charts: dice histogram, stacked resource bars, VP sparklines. */
import type { CSSProperties } from 'react';
import { GOODS, type Cards } from '../../model';
import { cardTotal, cardsText, count, goodText, goodsIn, plural } from '../shared/format';
import { GOOD_META } from '../shared/labels';
import { diceBars } from './data';

const heat = (total: number) => (total === 7 ? 'seven' : total === 6 || total === 8 ? 'hot' : undefined);

/** Rolled counts for 2–12 with a dotted line at the expected count for the same number of rolls. */
export function DiceHistogram({ dice }: { dice: number[] }) {
  const bars = diceBars(dice), rolls = bars.reduce((sum, b) => sum + b.count, 0);
  const max = Math.max(1, ...bars.map(b => Math.max(b.count, b.expected)));
  const line = bars.map((b, i) => `${i + 0.5},${(max - b.expected).toFixed(2)}`).join(' ');
  return <figure className="island-settlers-results-dice">
    <div className="island-settlers-results-plot">
      {bars.map(b => <div key={b.total} data-heat={heat(b.total)} role="img"
        aria-label={`${b.total}: rolled ${plural(b.count, 'time')}, expected ${b.expected.toFixed(1)}`}
        title={`${b.total}: rolled ${b.count}, expected ${b.expected.toFixed(1)}`}
        style={{ '--h': `${(b.count / max) * 100}%` } as CSSProperties}>
        <i/><span className="kp-numeral">{b.count}</span>
      </div>)}
      <svg viewBox={`0 0 11 ${max}`} preserveAspectRatio="none" aria-hidden="true">
        <polyline points={line} vectorEffect="non-scaling-stroke"/>
      </svg>
    </div>
    <div className="island-settlers-results-axis kp-numeral" aria-hidden="true">
      {bars.map(b => <span key={b.total} data-heat={heat(b.total)}>{b.total}</span>)}
    </div>
    <figcaption>
      <span><i className="island-settlers-results-key-bar"/>Rolled</span>
      <span><i className="island-settlers-results-key-dots"/>Expected for {plural(rolls, 'roll')}</span>
    </figcaption>
  </figure>;
}

/** One stacked bar per player, segments in card colours, scaled to the table's largest total. */
export function GainedBar({ gained, max }: { gained: Cards; max: number }) {
  const total = cardTotal(gained);
  const label = `${total}: ${cardsText(gained)}`;
  return <span className="island-settlers-results-gained" role="img" aria-label={label}>
    <span style={{ width: `${max ? (total / max) * 100 : 0}%` }}>
      {goodsIn(gained).map(g => <i key={g} title={goodText(count(gained, g), g)}
        style={{ flexGrow: count(gained, g), background: GOOD_META[g].color }}/>)}
    </span>
    <b className="kp-numeral">{total}</b>
  </span>;
}

/** Legend for the goods that appear anywhere in the bars. */
export function GoodsLegend({ gained }: { gained: Cards[] }) {
  const goods = GOODS.filter(g => gained.some(c => count(c, g) > 0));
  return <p className="island-settlers-results-legend">
    {goods.map(g => <span key={g}><i style={{ background: GOOD_META[g].color }}/>{GOOD_META[g].label}</span>)}
  </p>;
}

const W = 96, H = 28, PAD = 5;

/** Public VP at each round end, on a scale shared by every row. */
export function VpSpark({ series, max, color }: { series: number[]; max: number; color: string }) {
  if (!series.length) return null;
  const x = (i: number) => PAD + (series.length > 1 ? (i / (series.length - 1)) * (W - 2 * PAD) : 0);
  const y = (v: number) => H - PAD - (max ? (v / max) * (H - 2 * PAD) : 0);
  const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = series.length - 1;
  return <svg className="island-settlers-results-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`}
    role="img" aria-label={`VP by round: ${series.join(', ')}`}>
    <title>{`VP by round: ${series.join(', ')}`}</title>
    <polyline points={pts} stroke={color}/>
    <circle cx={x(last)} cy={y(series[last])} r="4" fill={color}/>
  </svg>;
}
