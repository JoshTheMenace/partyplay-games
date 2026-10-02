/* Podium phase: the TV celebration and each phone's placement. */
import type { CSSProperties } from 'react';
import { ArcadeButton, StatusNotice } from '../../../../../party-ui/src/index';
import { miniInfo } from '../../minis/catalog';
import { Avatar, AvatarBadge, BigTitle, Confetti, PhoneShell, Podium, Trophy, ordinal, rankOf, useNow, useSend } from '../ui';
import type { PackPublicView } from '../contract';
import { DEFAULT_ACCENT, type PhoneProps, type ScreenProps } from './shared';

function headlineOf(view: PackPublicView) {
  const result = view.podium!.result, names = result.winners.map(id => view.players.find(p => p.id === id)?.name ?? 'Someone');
  return result.headline ?? (names.length === 0 ? 'No trophy this time!' : names.length === 1 ? `${names[0]} wins!` : names.length === 2 ? `${names[0]} & ${names[1]} tie!` : `A ${names.length}-way tie!`);
}

/** Night trophy tally, most first (top `max` rows). */
function Trophies({ view, max }: { view: PackPublicView; max: number }) {
  const rows = [...view.players].sort((a, b) => (view.trophies[b.id] ?? 0) - (view.trophies[a.id] ?? 0)).filter(p => (view.trophies[p.id] ?? 0) > 0);
  return <section className="hj-tally"><h3>Trophies tonight</h3>{rows.length ? <ol>{rows.slice(0, max).map(p => { const n = view.trophies[p.id]!;
    return <li key={p.id}><AvatarBadge player={p} size={48} /><span className="hj-tally-cups" aria-label={`${n} ${n === 1 ? 'trophy' : 'trophies'}`}>{Array.from({ length: Math.min(n, 4) }, (_, i) => <Trophy key={i} />)}{n > 4 && <b className="kp-numeral">×{n}</b>}</span></li>; })}{rows.length > max && <li>+{rows.length - max} more trophy winners</li>}</ol> : <p>Still up for grabs!</p>}</section>;
}

export function PodiumDisplay({ view, now }: ScreenProps) {
  const podium = view.podium, t = useNow(now, 250);
  if (!podium) return null;
  const info = miniInfo(view.current?.id ?? ''), { result } = podium, awards = result.awards ?? [];
  return <div className="hj-podium-screen" style={{ '--accent': info?.accent ?? DEFAULT_ACCENT } as CSSProperties}>
    {result.winners.length > 0 && <Confetti burst={view.current?.session} />}
    <BigTitle kicker={`${info?.title ?? 'That game'} · final standings`} size={result.headline && result.headline.length > 40 ? 64 : 96}>{headlineOf(view)}</BigTitle>
    <div className="hj-podium-main">
      <Podium players={view.players} scores={result.scores} winners={result.winners} />
      <aside data-many={awards.length > 3 || undefined}>
        {awards.length > 0 && <section className="hj-awards"><h3>Awards</h3><ul>{awards.map((a, i) => { const p = view.players.find(x => x.id === a.playerId);
          return p && <li key={i} style={{ animationDelay: `${2500 + i * 350}ms` }}><span className="hj-award-title">{a.title}</span><AvatarBadge player={p} size={44} mood="happy" /></li>; })}</ul></section>}
        <Trophies view={view} max={awards.length > 3 ? 3 : 6} />
      </aside>
    </div>
    <p className="hj-podium-foot">Back to the game menu in <b className="kp-numeral">{Math.max(0, Math.ceil((podium.endsAt - t) / 1000))}</b> · the VIP can continue now</p>
  </div>;
}

export function PodiumController({ view, me, send }: PhoneProps) {
  const podium = view.podium, [state, run] = useSend(), isVip = view.vip === me.id, info = miniInfo(view.current?.id ?? '');
  if (!podium) return null;
  const { result } = podium, rank = rankOf(result.scores, me.id, view.players.map(p => p.id)), won = result.winners.includes(me.id), mine = (result.awards ?? []).filter(a => a.playerId === me.id);
  return <PhoneShell player={me} vip={isVip} accent={info?.accent} eyebrow={`${info?.title ?? 'Game'} results`} title={won ? 'You won a trophy!' : `You placed ${ordinal(rank)}`}
    action={isVip ? <ArcadeButton tone="sun" size="lg" disabled={state.status === 'pending'} onClick={() => void run(() => send({ k: 'next', session: view.current?.session ?? 0 }))}>Continue to the menu</ArcadeButton> : undefined}>
    <div className="hj-place" data-won={won || undefined}>
      <Avatar avatar={me.avatar} color={me.color} size={150} mood={won || rank <= 3 ? 'happy' : rank === view.players.length ? 'sad' : 'idle'} />
      {won && <Trophy className="hj-place-trophy" />}
      <p><b className="kp-title">{ordinal(rank)}</b> of {view.players.length} · <span className="kp-numeral">{result.scores[me.id] ?? 0}</span> pts</p>
      {mine.map((a, i) => <span key={i} className="hj-place-award">★ {a.title}</span>)}
      <p className="hj-note">Night total: {view.trophies[me.id] ?? 0} {view.trophies[me.id] === 1 ? 'trophy' : 'trophies'}</p>
    </div>
    {!isVip && <p className="hj-note">Next up: the game menu. The VIP can skip ahead.</p>}
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
  </PhoneShell>;
}
