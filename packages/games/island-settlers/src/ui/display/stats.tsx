import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { AwardId, Badge, PublicSeat, PublicView } from '../../model';
import { Icon } from '../shared/icons';
import { AWARD_LABEL, TRACK_META } from '../shared/labels';

const AWARD_ICON: Partial<Record<AwardId, string>> = {
  harbormaster: 'harbor', wealthiest: 'coin', 'old-boot': 'boot',
};

/** Icon + number, labelled for screen readers; `tone` fills it (alert, road, army, award). */
export const Stat = ({ icon, value, label, tone }: {
  icon: string; value?: ReactNode; label: string; tone?: string;
}) => <span className="island-settlers-hud-stat" data-tone={tone} title={label} aria-label={label}>
  <Icon name={icon}/>{value !== undefined && <b className="kp-numeral">{value}</b>}
</span>;

/** Module badge: C&K improvements draw as a 5-segment bar in the track colour, others as icon + value. */
function BadgeStat({ badge }: { badge: Badge }) {
  const track = TRACK_META[badge.icon as keyof typeof TRACK_META];
  if (!track) return <Stat icon={badge.icon} value={badge.value} label={badge.label}/>;
  return <span className="island-settlers-hud-bar" title={badge.label} aria-label={badge.label}
    style={{ '--track': track.color } as CSSProperties}>
    {[1, 2, 3, 4, 5].map(i => <i key={i} data-on={i <= badge.value || undefined}/>)}
  </span>;
}

export type Extra = { key: string; label: string; node: ReactNode };

/** Optional line-2 items in priority order: Longest Road ribbon, other award ribbons, module badges. */
export function extrasFor(pub: PublicView, seat: PublicSeat): Extra[] {
  const held = (id: AwardId) => pub.awards[id] === seat.id, road = `Longest Road, ${seat.longestRoute} long`;
  return [
    ...(held('longest-road')
      ? [{ key: 'road', label: road,
        node: <Stat icon="road" value={seat.longestRoute} tone="road" label={road}/> }]
      : []),
    ...(Object.keys(AWARD_ICON) as AwardId[]).filter(held).map(id => ({ key: id, label: AWARD_LABEL[id],
      node: <Stat icon={AWARD_ICON[id]!} label={AWARD_LABEL[id]} tone="award"/> })),
    // C&K progress cards take the (otherwise unused) dev-card glyph, so they never read as resource cards.
    ...seat.badges.map(b => ({ key: b.key, label: b.label,
      node: <BadgeStat badge={b.key === 'progress' ? { ...b, icon: 'development' } : b}/> })),
  ];
}

/**
 * Extras show while they fit; the rest collapse into a "+n" pill whose label lists them (EXPERIENCE §3.2).
 * Measured, so any name, badge mix or rail width stays unclipped: like packing a suitcase and taking the
 * last item out until the lid shuts.
 */
export function useRoom(extras: Extra[]) {
  const row = useRef<HTMLElement>(null), line = useRef<HTMLParagraphElement>(null);
  const key = extras.map(e => e.key).join(), [room, setRoom] = useState(extras.length);
  useLayoutEffect(() => setRoom(extras.length), [key, extras.length]);
  useLayoutEffect(() => {
    const r = row.current, l = line.current;
    const over = !!r && !!l && (l.scrollWidth > l.clientWidth + 1 || r.scrollHeight > r.clientHeight + 1);
    if (over && room > 0) setRoom(room - 1);
  });
  return { row, line, room };
}
