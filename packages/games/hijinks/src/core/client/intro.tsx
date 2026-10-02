/* Intro phase: animated title card on the TV, Skip intro + how-to on phones. */
import type { CSSProperties } from 'react';
import { ArcadeButton, StatusNotice } from '../../../../../party-ui/src/index';
import { miniInfo } from '../../minis/catalog';
import { Avatar, AvatarStack, BigTitle, PhoneShell, Spotlight, useNow, useSend } from '../ui';
import type { PackPublicView } from '../contract';
import type { PhoneProps, ScreenProps } from './shared';

function useIntro(view: PackPublicView) {
  const intro = view.intro ?? { endsAt: 0, skips: [] }, online = view.players.filter(p => p.connected).length;
  return { intro, info: miniInfo(view.current?.id ?? ''), need: Math.floor(online / 2) + 1, skippers: view.players.filter(p => intro.skips.includes(p.id)) };
}

export function IntroDisplay({ view, now }: ScreenProps) {
  const { intro, info, need, skippers } = useIntro(view), t = useNow(now, 100), start = view.current?.startedAt ?? t;
  if (!info) return null;
  return <div className="hj-intro" style={{ '--accent': info.accent } as CSSProperties}>
    <Spotlight className="hj-intro-spot">
      <BigTitle kicker="Up next" size={170}>{info.title}</BigTitle>
      <p className="hj-intro-tag">{info.tagline}</p>
      <div className="hj-intro-cast" aria-hidden="true">{view.players.map((p, i) => <span key={p.id} style={{ animationDelay: `${600 + i * 90}ms` }}>
        <Avatar avatar={p.avatar} color={p.color} size={view.players.length > 6 ? 92 : 120} mood={p.connected ? 'happy' : 'sad'} crown={view.vip === p.id} /></span>)}</div>
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
