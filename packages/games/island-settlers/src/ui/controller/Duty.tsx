/** Duty cards (EXPERIENCE §4.1 row 2): offers to answer and notices, newest first, 2 visible, "+n more". */
import { useEffect, useState } from 'react';
import { OfferDuty } from '../trade/index';
import { useCtl, type Notice, type NoticeTone } from './context';
import { incoming } from './logic';

export const NOTICE_MS = 3500;

/**
 * Notices clear after 3.5 s or when the task changes; errors stay until the next action or turn.
 * `taskKey` identifies the task, `turn` the turn id.
 */
export function useNotices(taskKey: string, turn: number, now: () => number) {
  const [list, setList] = useState<(Notice & { task: string; turn: number })[]>([]);
  const [, tick] = useState(0);
  const live = list.filter(n =>
    (n.tone === 'error' ? n.turn === turn : n.task === taskKey && now() - n.at < NOTICE_MS));
  const next = Math.min(...live.filter(n => n.tone !== 'error').map(n => n.at + NOTICE_MS));
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const id = setTimeout(() => tick(n => n + 1), Math.max(50, next - now()));
    return () => clearTimeout(id);
  }, [next, now]);
  const notify = (tone: NoticeTone, text: string, id = `${tone}:${now()}:${text}`) => setList(old =>
    [...old.filter(n => n.id !== id && (tone !== 'error' || n.tone !== 'error')).slice(-8),
      { id, tone, text, at: now(), task: taskKey, turn }]);
  const clearErrors = () => setList(old => old.filter(n => n.tone !== 'error'));
  return { live: live.reverse(), notify, clearErrors };
}

/**
 * The seated host's dock passes `limit` 1 and `offers` false while its sheet is up, so floating cards never
 * bury the board; there "+n more" opens the Trade sheet, which lists every offer.
 */
export function Duty({ notices, limit = 2, offers = true }: { notices: Notice[]; limit?: number; offers?: boolean }) {
  const { pub, me, props, go } = useCtl();
  const [open, setOpen] = useState(false);
  const trade = () => go({ tab: 'trade', place: null, command: null, card: null });
  const items = [
    ...(offers ? incoming(pub, me.seat) : []).map(o => ({ at: o.at, node: <div key={o.id}
      className="island-settlers-duty" data-kind="offer"><OfferDuty {...props} offer={o} onOpenTrade={trade}/>
    </div> })),
    ...notices.map(n => ({ at: n.at, node: <p key={n.id} className="island-settlers-duty" data-tone={n.tone}
      role={n.tone === 'error' ? 'alert' : 'status'}>{n.text}</p> })),
  ].sort((a, b) => b.at - a.at);
  const shown = open ? items : items.slice(0, limit), more = items.length - shown.length;
  useEffect(() => { if (items.length <= limit) setOpen(false); }, [items.length, limit]);
  if (!items.length) return null;
  return <section className="island-settlers-duties" aria-label="Things for you">
    {shown.map(i => i.node)}
    {more > 0 && <button type="button" className="island-settlers-more"
      onClick={() => (limit < 2 ? trade() : setOpen(true))}>
      +{more} more</button>}
  </section>;
}
