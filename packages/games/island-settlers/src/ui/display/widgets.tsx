import type { CSSProperties } from 'react';
import type { HudItem, PublicView } from '../../model';
import { Icon } from '../shared/icons';
import { TRACK_META } from '../shared/labels';
import { SeatChip } from '../shared/SeatChip';
import { nameOf } from '../shared/seats';

const u = (n: number) => `calc(${n} * var(--u))`;
const tint = (icon: string) => TRACK_META[icon as keyof typeof TRACK_META]?.color;

/** One module widget, drawn from its generic `hud` descriptor (EXPERIENCE §3.4 A, ENGINE §14.1). */
function Widget({ pub, item }: { pub: PublicView; item: HudItem }) {
  switch (item.kind) {
    case 'track': {
      const cells = Array.from({ length: item.max + 1 }, (_, i) => i);
      return <div className="island-settlers-hud-widget" data-alert={item.alert || undefined}>
        <p><Icon name={item.icon}/><span>{item.label}</span>
          <b className="kp-numeral">{item.value}/{item.max}</b></p>
        <ol className="island-settlers-hud-cells" style={{ '--cells': cells.length } as CSSProperties}
          aria-label={`${item.label}: ${item.value} of ${item.max}`}>
          {cells.map(i => <li key={i} data-past={i < item.value || undefined}
            data-now={i === item.value || undefined}>{i === item.value && <Icon name={item.icon}/>}</li>)}
        </ol>
      </div>;
    }
    case 'versus':
      return <div className="island-settlers-hud-widget">
        <p><span>{item.label}</span></p>
        <p className="island-settlers-hud-versus">
          <span>{item.left.label} <b className="kp-numeral">{item.left.value}</b></span><small>vs</small>
          <span>{item.right.label} <b className="kp-numeral">{item.right.value}</b></span>
        </p>
      </div>;
    case 'table':
      return <div className="island-settlers-hud-widget">
        <p><span>{item.label}</span></p>
        {item.rows.map(row => {
          const seats = Object.entries(row.values).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
          return <p key={row.label} className="island-settlers-hud-widget-row">
            <small>{row.label}</small>
            {seats.length ? seats.map(([id, v]) => <span key={id} aria-label={`${nameOf(pub, id)} ${v}`}>
              <SeatChip pub={pub} seat={id} size={u(20)}/><b className="kp-numeral">
                {row.max === null ? v : `${v}/${row.max}`}</b></span>) : <small>none yet</small>}
          </p>;
        })}
      </div>;
    case 'holder':
      return <div className="island-settlers-hud-widget">
        <p><span style={{ color: tint(item.icon) }}><Icon name={item.icon}/></span><span>{item.label}</span>
          {item.seat ? <><SeatChip pub={pub} seat={item.seat} size={u(24)}/><b>{nameOf(pub, item.seat)}</b></>
            : <small>nobody yet</small>}</p>
      </div>;
  }
}

/** Slot A of the left rail: every module widget in one panel; not drawn without modules. */
export function HudPanel({ pub }: { pub: PublicView }) {
  if (!pub.hud.length) return null;
  return <section className="island-settlers-hud-module island-settlers-panel" aria-label="Expansion status">
    {pub.hud.map(item => <Widget key={item.key} pub={pub} item={item}/>)}
  </section>;
}
