/* Quip Clash screens: the comedy-club TV (writing, duels, scores, Last Laugh) and the phone controller. */
import type { CSSProperties, ReactNode } from 'react';
import { ArcadeButton, StatusNotice } from '../../../../../party-ui/src/index';
import type { MiniClient, MiniViewProps, PackPlayer } from '../../core/contract';
import {
  Avatar, AvatarBadge, AvatarStack, BigTitle, Callout, Confetti, PhoneChoices, PhoneDone, PhoneShell, PhoneTextEntry, PhoneWaiting,
  PlayerStrip, PromptCard, Scoreboard, Timer, fitText, ordinal, rankOf, useDraft, useNow, useSend, useTimeline,
} from '../../core/ui';
import { FINAL_VOTES, MAX_ANSWER, RESULT, ROUND_NAMES, finalBeats, letter, showBeats, type Final, type Match, type QuipPrivate, type QuipPublic, type Reveal } from './types';
import './styles.css';

type P = MiniViewProps<QuipPublic, QuipPrivate>;
type Phone = P & { me: QuipPrivate; player: PackPlayer };
const ACCENT = '#ff5748';
const find = (players: readonly PackPlayer[], id: string) => players.find(p => p.id === id);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const RESULT_STEPS = [RESULT.voters, RESULT.authors, RESULT.points];

const MARQUEE_LINES = [
  'Make it snappy. Make it weird.', 'Nobody knows which answer is yours. Yet.', 'Funny beats clever. Clever beats nothing.',
  'Two prompts. One reputation.', 'Type now. Apologise later.', 'Your rival is already giggling. Suspicious.',
  'Short and silly wins the room.', 'Stuck? The safety quip has your back, at half price.', 'The audience is warm. Mostly.',
];
const WAIT_LINES = [
  'Practise your “oh, that one was mine?” face.', 'Rehearse a humble victory speech.', 'Act like you didn’t write the weird one.',
  'Stretch. Comedy is a contact sport.', 'Think of a callback joke for later.', 'Look at your rival. Smile. Say nothing.',
  'Polish your best fake laugh.', 'Pretend to still be typing. Mind games.',
];

// ---------- TV ----------

/** Brick wall and tied-back curtains: the comedy club behind every TV screen. */
const Club = () => <div className="qc-club" aria-hidden="true"><i className="qc-curtain qc-curtain-l" /><i className="qc-curtain qc-curtain-r" /></div>;

function Mic({ className = '' }: { className?: string }) {
  return <svg className={`qc-mic ${className}`} viewBox="0 0 200 420" aria-hidden="true">
    <ellipse className="qc-mic-shadow" cx="100" cy="406" rx="74" ry="10" />
    <path className="qc-mic-pole" d="M100 200V396" /><path className="qc-mic-base" d="M40 402Q100 372 160 402Z" />
    <rect className="qc-mic-body" x="84" y="150" width="32" height="80" rx="10" />
    <rect className="qc-mic-head" x="56" y="16" width="88" height="148" rx="44" />
    <path className="qc-mic-grill" d="M60 56H140M57 86H143M60 116H140M78 22V158M100 18V162M122 22V158" />
    <rect className="qc-mic-band" x="60" y="146" width="80" height="16" rx="7" />
    <path className="qc-mic-shine" d="M72 40Q70 70 74 100" />
  </svg>;
}

function Head({ view, children }: { view: QuipPublic; children?: ReactNode }) {
  return <header className="qc-head">
    <span className="qc-sign kp-title">Quip <em>Clash</em></span>
    <span className="qc-round" data-round={view.round}>{ROUND_NAMES[view.round - 1]}</span>
    <span className="qc-head-side">{children}</span>
  </header>;
}

function WriteTV({ view, players, vip, now }: P) {
  const final = view.phase === 'final-write', t = useNow(now, 1000), line = Math.floor(Math.max(0, t - view.at) / 6000) % MARQUEE_LINES.length;
  return <section className="qc-write" data-final={final || undefined}>
    <Head view={view}><Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={132} /></Head>
    <div className="qc-write-main">
      <div className="qc-stage-mic"><Mic /></div>
      <div className="qc-write-copy">
        <div className="qc-marquee"><span className="kp-title">{final ? 'The Last Laugh!' : view.round === 2 ? 'Double points!' : 'Write something funny!'}</span></div>
        {final && view.final
          ? <PromptCard eyebrow="One prompt for everyone" size={58}>{view.final.prompt}</PromptCard>
          : <p className="qc-quipline" key={line}>{MARQUEE_LINES[line]}</p>}
        <div className="qc-tally" role="status"><b className="kp-numeral">{view.done.length}<small>/{players.length}</small></b>
          <span>{final ? 'answers in' : 'players finished'}<small>{final ? 'Everyone gets three votes next.' : 'Two prompts each. Every prompt is shared with a rival.'}</small></span></div>
      </div>
    </div>
    <PlayerStrip players={players} done={view.done} vip={vip} />
  </section>;
}

function Side({ i, text, visible, reveal, winner, step, players }: { i: number; text: string; visible: boolean; reveal?: Reveal; winner: number | null; step: number; players: readonly PackPlayer[] }) {
  const author = reveal && find(players, reveal.author), voters = reveal ? reveal.voters.map(id => find(players, id)).filter(p => !!p) : [];
  const state = step >= 3 && reveal ? (winner === null ? 'tie' : winner === i ? 'win' : 'lose') : 'idle';
  return <div className={`qc-side qc-side-${i}`} data-state={state}>
    <div className="qc-bubble" data-empty={!visible || undefined}>
      <span className="qc-letter kp-title">{letter(i)}</span>
      {visible ? <p style={{ fontSize: fitText(text, 66) }}>{text}</p> : <p className="qc-dots" aria-label="Coming up"><i /><i /><i /></p>}
      {step >= 1 && reveal && <div className="qc-voters">{voters.length > 0 && <AvatarStack players={voters} size={60} max={9} />}<b>{voters.length ? plural(voters.length, 'vote') : 'No votes'}</b></div>}
      {step >= 2 && reveal?.safety && <span className="qc-safety">Safety quip · half points</span>}
      {step >= 3 && reveal && <b className="qc-points kp-numeral">+{reveal.points}</b>}
    </div>
    <div className="qc-speaker">{step >= 2 && author
      ? <AvatarBadge player={author} size={150} layout="column" mood={state === 'win' ? 'happy' : state === 'lose' ? 'sad' : 'idle'} />
      : <span className="qc-mystery kp-title" aria-label="Mystery author">?</span>}</div>
  </div>;
}

function DuelTV({ view, match, players, now }: P & { match: Match }) {
  const beats = showBeats(match.answers), result = match.result, phase = view.phase;
  const shown = useTimeline(view.at, phase === 'show' ? [beats[1], beats[2]] : [0, 0], now);
  const step = useTimeline(view.at, phase === 'result' ? RESULT_STEPS : [Infinity], now);
  const winner = result && result.winner !== null ? find(players, result.sides[result.winner]!.author) : undefined;
  return <section className="qc-duel" data-phase={phase} key={match.index}>
    <Head view={view}>{phase === 'vote' ? <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={120} /> : <span className="qc-match-count">Matchup <b className="kp-numeral">{match.index + 1}</b> of {match.count}</span>}</Head>
    <PromptCard className="qc-duel-prompt" eyebrow="The prompt" size={60}>{match.prompt}</PromptCard>
    <div className="qc-arena">
      {match.answers.map((a, i) => <Side key={i} i={i} text={a.text} visible={phase !== 'show' || shown > i} reveal={result?.sides[i]} winner={result?.winner ?? null} step={step} players={players} />)}
      <span className="qc-vs kp-title" aria-hidden="true">VS</span>
    </div>
    <p className="qc-duel-foot" role="status">
      {phase === 'show' ? 'Read ’em and weep. Voting opens in a moment…'
        : phase === 'vote' ? <><b>Vote on your phone!</b> <span className="kp-numeral">{plural(match.votes, 'vote')} in</span></>
        : step < 3 || !result ? 'And the room says…'
        : result.jinx ? 'Great minds think alike. Nobody scores.'
        : winner ? <><b>{winner.name}</b> takes the laugh!</> : 'Dead heat!'}
    </p>
    {result?.wipe && step >= 3 && <><Confetti burst={match.index} count={110} /><div className="qc-wipe" role="status"><span className="kp-title">Quipwipe!</span><small>Every single vote</small></div></>}
    {result?.jinx && step >= 3 && <div className="qc-jinx"><Callout tone="coral">Jinx!</Callout></div>}
  </section>;
}

function ScoresTV({ view, players }: P) {
  const prev = view.prev ?? {}, gains = players.map(p => (view.scores[p.id] ?? 0) - (prev[p.id] ?? 0)), best = Math.max(0, ...gains);
  return <section className="qc-scores">
    <Head view={view} />
    <div className="qc-scores-main">
      <div className="qc-scores-side">
        <BigTitle kicker={`After round ${view.round}`} size={130}>Scores!</BigTitle>
        <Mic className="qc-mic-small" />
        <p className="qc-next">{view.round === 1 ? <>Round 2 is worth <b>double</b>.</> : <>Next: the Last Laugh. <b>Triple</b> points!</>}</p>
      </div>
      <Scoreboard players={players} scores={view.scores} from={prev} delay={900} rowHeight={players.length > 8 ? 82 : 92} highlight={best > 0 ? players.filter((_, i) => gains[i] === best).map(p => p.id) : []} />
    </div>
  </section>;
}

function FinalTV({ view, final, players, vip, now }: P & { final: Final }) {
  const result = final.result, n = final.entries.length, beats = finalBeats(result?.entries.length ?? 0);
  const step = useTimeline(view.at, result ? [...beats.reveals, beats.winner] : [Infinity], now);
  const order = new Map(result?.entries.map((r, i) => [r.id, i]));
  const crowned = !!result && step > result.entries.length, champs = result?.winners.map(id => find(players, id)).filter(p => !!p) ?? [];
  const cols = n <= 4 ? Math.max(1, n) : n <= 6 ? 3 : n <= 8 ? 4 : 5;
  return <section className="qc-final" data-phase={view.phase}>
    <Head view={view}>{view.phase === 'final-vote' ? <Timer deadline={view.deadline} now={now} total={view.deadline - view.at} size={120} /> : null}</Head>
    <PromptCard className="qc-final-prompt" eyebrow="One prompt for everyone" size={50}>{final.prompt}</PromptCard>
    <ol className="qc-grid" style={{ '--cols': cols } as CSSProperties} data-dense={n > 6 || undefined} data-roomy={n <= 4 || undefined}>
      {final.entries.map((e, i) => {
        const at = order.get(e.id) ?? -1, r = result?.entries[at], shown = !!r && step > at, author = r && find(players, r.author);
        const won = crowned && !!r && result!.winners.includes(r.author), voters = r ? r.voters.map(id => find(players, id)).filter(p => !!p) : [];
        return <li key={e.id} className="qc-card" data-state={!shown ? 'idle' : crowned ? (won ? 'win' : 'lose') : 'shown'} style={{ animationDelay: `${i * 80}ms` }}>
          <span className="qc-letter kp-title">{letter(i)}</span>
          <p style={{ fontSize: fitText(e.text, n > 6 ? 38 : n > 4 ? 48 : 62) }}>{e.text}</p>
          {shown && r && <footer>
            <b className="qc-card-votes kp-numeral">{r.votes}<small>{r.votes === 1 ? 'vote' : 'votes'}</small></b>
            {n <= 6 && voters.length > 0 && <AvatarStack players={voters} size={n <= 4 ? 56 : 34} max={5} />}
            {author && <AvatarBadge player={author} size={n > 6 ? 40 : n <= 4 ? 72 : 46} mood={won ? 'happy' : 'idle'} />}
          </footer>}
          {shown && r && <b className="qc-points kp-numeral">+{r.points}</b>}
          {shown && r?.safety && <span className="qc-safety">Safety quip</span>}
        </li>;
      })}
    </ol>
    {view.phase === 'final-vote'
      ? <PlayerStrip className="qc-final-strip" players={players} done={view.done} vip={vip} size={64} />
      : <p className="qc-final-foot" role="status">{!crowned ? 'Counting the votes…' : champs.length ? <><b>{champs.map(p => p.name).join(' & ')}</b> {champs.length > 1 ? 'share' : 'gets'} the Last Laugh!</> : 'Nobody voted. The silence is deafening.'}</p>}
    {crowned && champs.length > 0 && <Confetti burst="last-laugh" count={130} />}
  </section>;
}

function Display(props: P) {
  const { view } = props;
  return <div className="hj-quip-clash qc-tv" data-phase={view.phase}>
    <Club />
    {view.phase === 'write' || view.phase === 'final-write' ? <WriteTV {...props} />
      : view.match ? <DuelTV {...props} match={view.match} />
      : view.phase === 'scores' ? <ScoresTV {...props} />
      : view.final ? <FinalTV {...props} final={view.final} /> : null}
  </div>;
}

// ---------- phone ----------

function Standing({ view, players, player }: { view: QuipPublic; players: readonly PackPlayer[]; player: PackPlayer }) {
  const rank = rankOf(view.scores, player.id, players.map(p => p.id));
  return <p className="qc-standing"><b className="kp-title">{ordinal(rank)}</b> place · <span className="kp-numeral">{(view.scores[player.id] ?? 0).toLocaleString()}</span> pts</p>;
}

function WritePhone({ view, me, player, players, vip, now, send, sessionKey }: Phone) {
  const [safe, run] = useSend(), final = view.phase === 'final-write', total = me.prompts.length, open = me.prompts.find(p => p.answer === undefined);
  const shell = { player, vip: vip === player.id, accent: ACCENT, timer: { deadline: view.deadline, now, total: view.deadline - view.at } };
  if (!open) {
    const waiting = players.filter(p => p.connected && !view.done.includes(p.id));
    return <PhoneShell {...shell} eyebrow={ROUND_NAMES[view.round - 1]} title={total > 1 ? 'Both quips locked in!' : 'Locked in!'}>
      <PhoneDone title="Nailed it." detail="Now act innocent.">
        <ul className="qc-mine">{me.prompts.map(p => <li key={p.slot}><small>{p.prompt}</small><b>{p.answer}</b>{p.safety && <em>Safety quip</em>}</li>)}</ul>
      </PhoneDone>
      {waiting.length > 0 && <PhoneWaiting title="Waiting on the slowpokes" waitingFor={waiting} lines={WAIT_LINES} />}
    </PhoneShell>;
  }
  return <PhoneShell {...shell} eyebrow={final ? 'Last Laugh · one answer' : `${ROUND_NAMES[view.round - 1]} · prompt ${open.slot + 1} of ${total}`}>
    <PhoneTextEntry multiline label={open.prompt} draftKey={`${sessionKey}:${view.turn}:${open.slot}`} maxLength={MAX_ANSWER} placeholder="Make it funny…"
      submitLabel={open.slot + 1 < total ? 'Lock it in · next prompt' : 'Lock it in'} onSubmit={text => send({ turn: view.turn, k: 'answer', slot: open.slot, text })} />
    <ArcadeButton tone="ghost" size="md" className="qc-safety-btn" disabled={safe.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'safety', slot: open.slot }))}>
      Stuck? Use a safety quip <small className="qc-nowrap">(half points)</small>
    </ArcadeButton>
    {safe.status === 'rejected' && <StatusNotice tone="error">{safe.reason}</StatusNotice>}
  </PhoneShell>;
}

function DuelPhone({ view, me, player, players, vip, now, send }: Phone) {
  const match = view.match!, result = match.result, step = useTimeline(view.at, view.phase === 'result' ? [RESULT.points] : [Infinity], now) > 0;
  const shell = { player, vip: vip === player.id, accent: ACCENT, eyebrow: `Matchup ${match.index + 1} of ${match.count}` };
  if (view.phase === 'result') {
    const mine = me.role === 'author' && result ? result.sides[me.side!] : undefined, won = result?.winner === me.side;
    const title = !step || !result ? 'Here come the votes…' : result.jinx ? (mine ? 'Jinx!' : 'Jinx! Nobody scores.')
      : mine ? (result.winner === null ? 'Dead heat!' : won ? (result.wipe ? 'QUIPWIPE!' : 'You won the room!') : 'Tough crowd.')
      : me.side === undefined ? 'The room has spoken.' : result.winner === null ? 'Dead heat!' : won ? 'You backed the winner!' : 'Bold choice.';
    return <PhoneShell {...shell} title={title}>
      {!step && <p className="qc-phone-prompt">{match.prompt}</p>}
      <div className="qc-phone-result" data-won={(step && mine && won) || undefined}>
        <Avatar avatar={player.avatar} color={player.color} size={132} mood={!step ? 'thinking' : mine ? (won ? 'happy' : result?.winner === null ? 'idle' : 'sad') : 'idle'} />
        {step && mine && <b className="qc-phone-points kp-numeral">+{mine.points}</b>}
        {step && mine && <p>{plural(mine.voters.length, 'vote')} for “{mine.text}”</p>}
        {step ? <Standing view={view} players={players} player={player} /> : <p className="qc-tv-cue">Eyes on the TV!</p>}
      </div>
    </PhoneShell>;
  }
  if (me.role === 'author') return <PhoneShell {...shell} title="Your answer is up!">
    <div className="qc-phone-up"><Avatar avatar={player.avatar} color={player.color} size={140} mood="happy" />
      <p className="qc-phone-bubble">{match.answers[me.side!]?.text}</p>
      <p className="hj-note">Act natural. Nobody knows it’s yours… yet. No voting in your own matchup.</p></div>
  </PhoneShell>;
  if (view.phase === 'show') return <PhoneShell {...shell} title="Get ready to vote!">
    <p className="qc-phone-prompt">{match.prompt}</p>
    <PhoneWaiting title="Eyes on the TV" detail="The answers are being revealed." lines={WAIT_LINES} />
  </PhoneShell>;
  const voted = me.side !== undefined;
  return <PhoneShell {...shell} title={voted ? 'Vote locked in!' : 'Which is funnier?'} timer={{ deadline: view.deadline, now, total: view.deadline - view.at }}>
    <p className="qc-phone-prompt">{match.prompt}</p>
    <PhoneChoices className="qc-vote" label="Pick the funnier answer" picked={voted ? [String(me.side)] : null} locked={voted}
      options={match.answers.map((a, i) => ({ id: String(i), label: <><span className="qc-letter kp-title">{letter(i)}</span><span>{a.text}</span></>, ariaLabel: `Answer ${letter(i)}: ${a.text}`, color: i ? 'var(--kp-sky)' : 'var(--kp-sun)' }))}
      onSubmit={([side]) => send({ turn: view.turn, k: 'vote', side: Number(side) })} />
  </PhoneShell>;
}

function ScoresPhone({ view, player, players, vip }: Phone) {
  return <PhoneShell player={player} vip={vip === player.id} accent={ACCENT} eyebrow={`After round ${view.round}`} title="Scores!">
    <div className="qc-phone-result"><Avatar avatar={player.avatar} color={player.color} size={132} mood={rankOf(view.scores, player.id, players.map(p => p.id)) === 1 ? 'happy' : 'idle'} />
      <Standing view={view} players={players} player={player} />
      <p className="hj-note">{view.round === 1 ? 'Round 2 is worth double. Plenty of time for a comeback!' : 'The Last Laugh is worth triple. Anything can happen.'}</p></div>
  </PhoneShell>;
}

/** Last Laugh ballot: tap answers to give them votes (stacking allowed, never your own), then cast all three. */
function FinalVotePhone({ view, me, player, vip, now, send, sessionKey }: Phone) {
  const entries = view.final?.entries ?? [], [draft, setDraft] = useDraft<string[]>(`${sessionKey}:${view.turn}:picks`, []), [state, run] = useSend();
  const picks = draft.filter(id => id !== me.mine && entries.some(e => e.id === id)).slice(0, FINAL_VOTES), left = FINAL_VOTES - picks.length;
  const count = (id: string) => picks.filter(x => x === id).length, shell = { player, vip: vip === player.id, accent: ACCENT, eyebrow: 'The Last Laugh', timer: { deadline: view.deadline, now, total: view.deadline - view.at } };
  if (me.picks) return <PhoneShell {...shell} title="Votes cast!">
    <PhoneDone detail="Watch the TV for the big reveal.">
      <ul className="qc-mine">{[...new Set(me.picks)].map(id => <li key={id}><b>{entries.find(e => e.id === id)?.text}</b><em>×{me.picks!.filter(x => x === id).length}</em></li>)}</ul>
    </PhoneDone>
  </PhoneShell>;
  if (!entries.some(e => e.id !== me.mine)) return <PhoneShell {...shell} title="Sit back"><PhoneWaiting title="Nothing to vote on" detail="Enjoy the show!" lines={WAIT_LINES} /></PhoneShell>;
  return <PhoneShell {...shell} title={left ? `Give out ${plural(left, 'vote')}` : 'Ready to cast!'}>
    <p className="qc-phone-prompt">{view.final?.prompt}</p>
    <p className="qc-pips" aria-label={`${left} of ${FINAL_VOTES} votes left`}>{Array.from({ length: FINAL_VOTES }, (_, i) => <i key={i} data-on={i < picks.length || undefined} />)}<span>Tap an answer to give it a vote. Stack them if you love it.</span></p>
    <ul className="qc-ballot">{entries.map((e, i) => { const mine = e.id === me.mine, n = count(e.id);
      return <li key={e.id} data-on={n > 0 || undefined} data-mine={mine || undefined}>
        <button type="button" className="qc-ballot-add" disabled={mine || !left || state.status === 'pending'} aria-label={mine ? `Your answer: ${e.text}` : `Give a vote to answer ${letter(i)}: ${e.text}`} onClick={() => setDraft([...picks, e.id])}>
          <span className="qc-letter kp-title">{letter(i)}</span><span className="qc-ballot-text">{e.text}</span>
          {mine ? <em>Yours</em> : n > 0 && <b className="kp-numeral" aria-label={`${n} of your votes`}>×{n}</b>}
        </button>
        {n > 0 && <button type="button" className="qc-ballot-remove" aria-label={`Take a vote back from answer ${letter(i)}`} disabled={state.status === 'pending'} onClick={() => { const at = picks.lastIndexOf(e.id); setDraft(picks.filter((_, k) => k !== at)); }}>−</button>}
      </li>; })}</ul>
    {state.status === 'rejected' && <StatusNotice tone="error">{state.reason}</StatusNotice>}
    <div className="hj-sticky"><ArcadeButton tone="lime" size="lg" disabled={left > 0 || state.status === 'pending'} onClick={() => void run(() => send({ turn: view.turn, k: 'picks', picks }))}>
      {state.status === 'pending' ? 'Sending…' : `Cast my votes (${picks.length}/${FINAL_VOTES})`}</ArcadeButton></div>
  </PhoneShell>;
}

function FinalResultPhone({ view, me, player, players, vip, now }: Phone) {
  const result = view.final?.result, beats = finalBeats(result?.entries.length ?? 0), step = useTimeline(view.at, [...beats.reveals, beats.winner], now);
  const at = result?.entries.findIndex(r => r.id === me.mine) ?? -1, mine = at >= 0 ? result!.entries[at] : undefined, shown = !!mine && step > at;
  const crowned = !!result && step > result.entries.length, won = crowned && result.winners.includes(player.id);
  return <PhoneShell player={player} vip={vip === player.id} accent={ACCENT} eyebrow="The Last Laugh" title={won ? 'You got the Last Laugh!' : crowned ? 'That’s the show!' : 'Counting the votes…'}>
    <div className="qc-phone-result" data-won={won || undefined}>
      <Avatar avatar={player.avatar} color={player.color} size={132} mood={won ? 'happy' : shown ? 'idle' : 'thinking'} />
      {shown && <b className="qc-phone-points kp-numeral">+{mine.points}</b>}
      {shown && <p>{plural(mine.votes, 'vote')} for “{mine.text}”</p>}
      {crowned ? <Standing view={view} players={players} player={player} /> : !shown && <p className="qc-tv-cue">{mine ? 'Your answer is coming up. Eyes on the TV!' : 'Eyes on the TV!'}</p>}
    </div>
  </PhoneShell>;
}

function Controller(props: P) {
  const { view, me, players, playerId } = props, player = playerId ? find(players, playerId) : undefined;
  if (!me || !player || me.turn !== view.turn) return <PhoneShell player={player} accent={ACCENT}><PhoneWaiting title="Enjoy the show!" lines={WAIT_LINES} /></PhoneShell>;
  const phone: Phone = { ...props, me, player };
  return <div className="hj-quip-clash qc-phone">
    {view.phase === 'write' || view.phase === 'final-write' ? <WritePhone {...phone} />
      : view.match ? <DuelPhone {...phone} />
      : view.phase === 'scores' ? <ScoresPhone {...phone} />
      : view.phase === 'final-vote' ? <FinalVotePhone {...phone} />
      : <FinalResultPhone {...phone} />}
  </div>;
}

export default { Display, Controller } satisfies MiniClient;
