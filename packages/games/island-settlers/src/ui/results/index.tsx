/** Results screen (EXPERIENCE §3.11): hero, standings, stats. The shell adds the buttons below. */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ResultsViewProps } from '../../../../../party-ui/src/index';
import type { PublicView } from '../../model';
import { hasDevCards } from '../shared/labels';
import { DiceHistogram, GoodsLegend } from './charts';
import { buildColumns, buildRows } from './data';
import { Hero } from './Hero';
import { Awards, GainedList, StatsTable } from './SeatStats';
import { Standings, YouCard } from './Standings';
import './results.css';

/** wide: two columns (≥ 1100 px); stacked: one column; narrow: phone portrait (< 560 px). */
function useMode() {
  const ref = useRef<HTMLDivElement>(null), [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width >= 1100 ? 'wide' : width >= 560 ? 'stacked' : 'narrow', width] as const;
}

const Section = ({ title, children }: { title: string; children: ReactNode }) =>
  <section className="island-settlers-results-section"><h2>{title}</h2>{children}</section>;

export function ResultsView({ outcome, publicView: pub, playerId }: ResultsViewProps<PublicView>) {
  const [ref, mode, width] = useMode();
  const rows = buildRows(pub, outcome, playerId), columns = buildColumns(rows), stats = pub.results?.stats;
  const wide = mode === 'wide';
  /** Below two columns, a table too wide for every score column keeps rank, name and total only. */
  const compact = !wide && width < 300 + 52 * columns.length;
  const you = compact ? rows.find(r => r.you) : undefined;
  return <div ref={ref} className="island-settlers-results" data-mode={mode}>
    <Hero pub={pub} rows={rows}/>
    {you && <YouCard row={you} of={rows.length}/>}
    <div className="island-settlers-results-grid">
      <Section title="Final standings"><Standings rows={rows} columns={columns} compact={compact}/></Section>
      {stats && (mode === 'narrow' ? <>
        <Section title="Resources gained"><GainedList rows={rows} stats={stats}/></Section>
        <Section title="Robber and trades">
          <StatsTable rows={rows} stats={stats} show={{ gained: false, spark: false, named: true }}/>
        </Section>
      </> : <Section title="Player stats">
        <StatsTable rows={rows} stats={stats} show={{ gained: true, spark: true, named: !wide }}/>
        <GoodsLegend gained={rows.map(r => stats.seats[r.seat]?.gained ?? {})}/>
      </Section>)}
      {stats && <Section title="Dice rolls"><DiceHistogram dice={stats.dice}/></Section>}
      {stats && <Section title="Records"><Awards rows={rows} stats={stats} dev={hasDevCards(pub)}/></Section>}
    </div>
  </div>;
}
