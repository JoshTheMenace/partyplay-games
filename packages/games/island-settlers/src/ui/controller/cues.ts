/**
 * Personal phone cues (EXPERIENCE §4.5): inbox toasts become notices, plus haptics and 0.6× sounds for your
 * turn, production, being robbed, a new offer and a completed trade. Nothing older than 3.5 s replays.
 */
import { useEffect, useRef } from 'react';
import type { PrivateView, PublicView } from '../../model';
import { goodsIn } from '../shared/format';
import type { Ctl, NoticeTone } from './context';
import { NOTICE_MS } from './Duty';

const OWN_TURN = new Set(['setup', 'roll', 'main', 'paired', 'round', 'prompt']);

export function useCues(pub: PublicView, me: PrivateView, now: () => number, sfx: Ctl['sfx'],
  notify: (tone: NoticeTone, text: string, id?: string) => void) {
  const seen = useRef({ inbox: -1, events: -1, offers: new Set<string>() });
  const turn = OWN_TURN.has(me.task.kind) ? `${pub.turn.id}:${me.task.kind}:${me.task.prompt}` : null;
  const lastTurn = useRef(turn);
  useEffect(() => {
    if (turn && turn !== lastTurn.current) { sfx.haptic('turn'); sfx.cue('turn'); }
    lastTurn.current = turn;
  }, [turn, sfx]);
  useEffect(() => {
    const s = seen.current, fresh = (at: number) => now() - at < NOTICE_MS;
    for (const e of me.inbox.filter(x => x.id > s.inbox && fresh(x.at))) {
      notify(e.tone, e.text, `inbox:${e.id}`);
      if (e.tone === 'gain') { sfx.haptic('production'); sfx.cue('resource', goodsIn(e.cards)[0]); }
      if (e.tone === 'loss' && e.other) { sfx.haptic('robbed'); sfx.cue('robbed'); }
    }
    s.inbox = Math.max(s.inbox, ...me.inbox.map(x => x.id));
    const traded = pub.events.some(e => e.id > s.events && fresh(e.at) && e.kind === 'trade'
      && (e.seat === me.seat || e.partner === me.seat));
    if (traded) sfx.haptic('trade');
    s.events = Math.max(s.events, ...pub.events.map(e => e.id));
    const offers = pub.offers.filter(o => o.from !== me.seat && o.responses[me.seat] && !s.offers.has(o.id));
    if (offers.some(o => fresh(o.at))) sfx.cue('offer');
    offers.forEach(o => s.offers.add(o.id));
  }, [me.inbox, pub.events, pub.offers, me.seat, now, sfx, notify]);
}
