/* Intro phase: animated title card on the TV, Skip intro + how-to on phones. */
import type { CSSProperties } from 'react';
import { ArcadeButton, StatusNotice } from '../../../../../party-ui/src/index';
import { miniInfo } from '../../minis/catalog';
import { Avatar, AvatarStack, BigTitle, PhoneShell, Spotlight, useNow, useSend } from '../ui';
import type { PackPublicView } from '../contract';
import { Emblem, hasEmblem } from './brand';
import { playersLabel, type PhoneProps, type ScreenProps } from './shared';

function useIntro(view: PackPublicView) {
  const intro = view.intro ?? { endsAt: 0, skips: [] }, online = view.players.filter(p => p.connected).length;
  return { intro, info: miniInfo(view.current?.id ?? ''), need: Math.floor(online / 2) + 1, skippers: view.players.filter(p => intro.skips.includes(p.id)) };
}

export function IntroDisplay({ view, now }: ScreenProps) {
  const { intro, info, need, skippers } = useIntro(view), t = useNow(now, 100), start = view.current?.startedAt ?? t;
  if (!info) return null;
  // The whole cast takes a bow: one row up to sixteen, two rows of smaller faces for a big room.
  const n = view.players.length, face = n > 44 ? 42 : n > 24 ? 58 : n > 16 ? 72 : n > 10 ? 84 : n > 6 ? 92 : 120;
  return <div className="hj-intro" style={{ '--accent': info.accent } as CSSProperties}>
    <Spotlight className="hj-intro-spot">
      <div className="hj-intro-name">{hasEmblem(info.id) && <span className="hj-intro-emblem"><Emblem id={info.id} /></span>}<BigTitle kicker="Up next" size={info.title.length > 13 ? 140 : 170}>{info.title}</BigTitle></div>
      <p className="hj-intro-tag">{info.tagline}</p>
      <p className="hj-intro-meta"><span>{playersLabel(info)}</span><span>{info.minutes} min</span>{info.tags.map(tag => <span key={tag}>{tag}</span>)}</p>
      <div className="hj-intro-cast" aria-hidden="true" style={{ maxWidth: n > 16 ? Math.ceil(n / 2) * (face + 14) : undefined }}>{view.players.map((p, i) => <span key={p.id} style={{ animationDelay: `${600 + Math.round(i * Math.min(90, 1800 / n))}ms` }}>
        <Avatar avatar={p.avatar} color={p.color} size={face} mood={p.connected ? 'happy' : 'sad'} crown={view.vip === p.id} /></span>)}</div>
    </Spotlight>
    <ol className="hj-howto">{info.howTo.map((step, i) => <li key={i} style={{ animationDelay: `${900 + i * 1100}ms` }}><b className="kp-title">{i + 1}</b><span>{step}</span></li>)}</ol>
    <footer className="hj-intro-foot">
      <span className="hj-intro-skips">{skippers.length > 0 ? <><AvatarStack players={skippers} size={52} /> {skippers.length}/{need} want to skip</> : 'Seen it before? Skip the intro on your phone.'}</span>
      <i className="hj-intro-bar" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(1, Math.max(0, (t - start) / Math.max(1, intro.endsAt - start)))})` }} /></i>
    </footer>
  </div>;
}

export function IntroController({ view, me, send }: PhoneProps) {
  const { intro, info, need, skippers } = useIntro(view), [state, run] = useSend(), isVip = view.vip === me.id;
  const skipped = intro.skips.includes(me.id), session = view.current?.session ?? 0;
  if (!info) return null;
  return <PhoneShell player={me} vip={isVip} accent={info.accent} eyebrow="Up next" title={info.title}
    action={<ArcadeButton tone="sky" size="lg" disabled={skipped || state.status === 'pending'} onClick={() => void run(() => send({ k: 'skip', session }))}>{skipped ? `Skipped ✓ (${skippers.length}/${need})` : isVip ? 'Skip intro for everyone' : 'Skip intro'}</ArcadeButton>}>
    <p className="hj-intro-phone-tag">{info.tagline}</p>
    <ol className="hj-phone-steps">{info.howTo.map((step, i) => <li key={i}><b className="kp-numeral">{i + 1}</b>{step}</li>)}</ol>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
  </PhoneShell>;
}
