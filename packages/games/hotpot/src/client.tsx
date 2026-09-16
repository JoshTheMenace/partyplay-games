import { createContext, useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Eyebrow, Panel, StatusNotice } from '../../../party-ui/src/index';
import type { GameClientModule, GameViewProps, PrepareContext, ResultsViewProps } from '../../../party-ui/src/index';
import { COLOR_HEX, cardFile, cardName } from './cards';
import { manifest } from './manifest';
import type { Action, PrivateView, PublicView, Settings } from './types';
import './styles.css';
type Props = GameViewProps<null, Action, PublicView, PrivateView>;
type Own = NonNullable<PrivateView>;
const PendingMove = createContext(false);
const POSITIONS = ['bottom', 'left', 'top', 'right'] as const;
const SEAT_COUNT = POSITIONS.length;
const src = (id: number | null, base: string = manifest.assetBase) => `${base}cards/${cardFile(id)}.webp`;

function Card({ id, size = 'md', onClick, glow, pos, label, style }: { id: number | null; size?: 'xs' | 'sm' | 'md' | 'lg'; onClick?(): void; glow?: boolean; pos?: string; label?: string; style?: CSSProperties }) {
  const pending = useContext(PendingMove);
  const props = { className: `hotpot-card hotpot-${size}`, 'data-pos': pos, 'data-glow': glow || undefined, 'aria-label': label ?? (id === null ? 'Face-down card' : cardName(id)), style };
  const image = <img src={src(id)} alt="" draggable={false} />;
  return onClick ? <button type="button" {...props} onClick={onClick} disabled={pending}>{image}</button> : <span role="img" {...props}>{image}</span>;
}
function useMove(props: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false), turn = useRef(props.publicView.turnId);
  turn.current = props.publicView.turnId;
  useEffect(() => setError(''), [props.publicView.turnId]);
  const view = props.publicView, own = props.privateView;
  async function send(action: Action) {
    if (sending.current || !props.connected) return;
    sending.current = true;
    setPending(true); setError('');
    try {
      const result = await props.sendAction(action);
      if (!result.accepted && turn.current === action.turnId) setError(result.reason || 'That move was not accepted.');
    } catch { if (turn.current === action.turnId) setError('Could not send. Reconnect and try again.'); }
    finally { sending.current = false; setPending(false); }
  }
  const mine = !!own && own.seat === view.current && props.connected;
  return {
    error, own, pending,
    draw: mine && view.phase === 'draw' ? (from: 'deck' | number) => void send({ type: 'draw', turnId: view.turnId, from }) : undefined,
    discard: mine && view.phase === 'discard' ? (card: number) => void send({ type: 'discard', turnId: view.turnId, card }) : undefined,
  };
}
function status(view: PublicView, own: PrivateView) {
  const seat = view.seats[view.current];
  if (view.phase === 'won') return `${view.seats[view.winner!].name} wins!`;
  if (own?.seat === view.current) return view.phase === 'draw' ? 'Your turn — draw a card' : 'Your turn — discard a card';
  return `${seat.name}${seat.away ? ' (bot covering)' : ''} is ${view.phase === 'draw' ? 'drawing' : 'choosing a discard'}`;
}
function Log({ view, count }: { view: PublicView; count: number }) {
  return <ol className="hotpot-log" aria-label="Recent moves">{view.log.slice(-count).map(entry => <li key={entry.n}>{entry.text}</li>)}</ol>;
}
function Name({ view, index, you }: { view: PublicView; index: number; you?: boolean }) {
  const seat = view.seats[index];
  return <span className="hotpot-name" data-turn={view.current === index && view.phase !== 'won' || undefined} style={{ '--seat': seat.color } as CSSProperties}>{seat.name}{you ? ' · you' : seat.bot ? ' · bot' : seat.away ? ' · away' : ''}</span>;
}
function Pile({ view, index, pos, draw, size = 'sm' }: { view: PublicView; index: number; pos?: string; draw?(from: number): void; size?: 'sm' | 'md' }) {
  const top = view.seats[index].pile.at(-1);
  if (top === undefined) return <span className={`hotpot-card hotpot-${size} hotpot-empty`} data-pos={pos} role="img" aria-label={`${view.seats[index].name}’s discard pile is empty`} />;
  return <Card id={top} size={size} pos={pos} glow={!!draw} onClick={draw && (() => draw(index))} label={`${view.seats[index].name}’s discard: ${cardName(top)}`} />;
}
function Hand({ own, discard }: { own: Own; discard?(card: number): void }) {
  const cards = [...own.hand].sort((a, b) => a - b);
  return <div className="hotpot-hand" aria-label="Your hand">
    {own.drawn !== null && <div className="hotpot-drawn"><Card id={own.drawn} size="lg" glow onClick={discard && (() => discard(own.drawn!))} label={`Drawn card: ${cardName(own.drawn)}`} /><span>New</span></div>}
    {cards.map((id, i) => <Card key={`${id}-${i}`} id={id} onClick={discard && (() => discard(id))} style={{ '--i': i - (cards.length - 1) / 2 } as CSSProperties} />)}
  </div>;
}
function Table(props: Props) {
  const view = props.publicView, { own, draw, discard, error, pending } = useMove(props);
  const me = own?.seat ?? 0;
  return <PendingMove.Provider value={pending}><main className="hotpot hotpot-table">
    <header className="hotpot-hud"><span className="hotpot-pill">Round {view.round}</span><p className="hotpot-status" aria-live="polite">{pending ? 'Sending…' : status(view, own)}</p><Log view={view} count={4} /></header>
    {view.seats.map((seat, i) => {
      const pos = POSITIONS[(i - me + SEAT_COUNT) % SEAT_COUNT];
      if (own && pos === 'bottom') return <section key={i} className="hotpot-seat" data-pos="bottom"><Hand own={own} discard={discard} /><Name view={view} index={i} you /></section>;
      return <section key={i} className="hotpot-seat" data-pos={pos}><Name view={view} index={i} /><div className="hotpot-backs">{Array.from({ length: seat.handSize + (view.current === i && view.phase === 'discard' ? 1 : 0) }, (_, k) => <Card key={k} id={null} size="xs" pos={pos} label="" />)}</div></section>;
    })}
    <div className="hotpot-pot">
      <div className="hotpot-deck"><Card id={null} size="md" glow={!!draw} onClick={draw && (() => draw('deck'))} label="Draw from the deck" /><span>Deck</span></div>
      {view.seats.map((_, i) => <div key={i} className="hotpot-pile" data-pos={POSITIONS[(i - me + SEAT_COUNT) % SEAT_COUNT]}><Pile view={view} index={i} pos={POSITIONS[(i - me + SEAT_COUNT) % SEAT_COUNT]} draw={draw} /></div>)}
    </div>
    {error && <div className="hotpot-error"><StatusNotice tone="error">{error}</StatusNotice></div>}
  </main></PendingMove.Provider>;
}
function Phone(props: Props) {
  const view = props.publicView, { own, draw, discard, error, pending } = useMove(props);
  if (!own) return <main className="hotpot hotpot-phone"><StatusNotice>Watch the shared screen. New players join at the next game.</StatusNotice></main>;
  const others = [1, 2, 3].map(offset => (own.seat + offset) % SEAT_COUNT);
  return <PendingMove.Provider value={pending}><main className="hotpot hotpot-phone">
    <header className="hotpot-phone-head"><span className="hotpot-pill">Round {view.round}</span><p className="hotpot-status" aria-live="polite">{pending ? 'Sending…' : status(view, own)}</p></header>
    <section className="hotpot-phone-hand"><Name view={view} index={own.seat} you /><Hand own={own} discard={discard} /></section>
    <div className="hotpot-phone-pot">
      <div className="hotpot-deck"><Card id={null} size="sm" glow={!!draw} onClick={draw && (() => draw('deck'))} label="Draw from the deck" /><span>Deck</span></div>
      <div className="hotpot-deck"><Pile view={view} index={own.seat} draw={draw} /><span>Your discard</span></div>
      <p>{draw ? 'Tap the deck or a discard to draw.' : discard ? 'Tap any card to discard it.' : ''}</p>
    </div>
    <ul className="hotpot-rows" aria-label="Other players">{others.map(i => <li key={i} data-turn={view.current === i || undefined}>
      <div><Name view={view} index={i} /><small>{view.seats[i].handSize} cards{view.current === i && view.phase === 'discard' ? ' + 1 drawn' : ''}</small></div>
      <Pile view={view} index={i} draw={draw} />
    </li>)}</ul>
    <Log view={view} count={2} />
    {error && <StatusNotice tone="error">{error}</StatusNotice>}
  </main></PendingMove.Provider>;
}
function Personal(props: Props) {
  const query = '(min-width: 760px) and (min-height: 560px)';
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => { const media = matchMedia(query), change = () => setWide(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  return wide ? <Table {...props} /> : <Phone {...props} />;
}
function ResultsView({ publicView: view, playerId }: ResultsViewProps<PublicView>) {
  if (view.winner === null) return <Panel className="hotpot hotpot-results"><h2 className="kp-display">The pot went cold</h2><p>No one completed three sets.</p></Panel>;
  const winner = view.seats[view.winner];
  return <Panel className="hotpot hotpot-results">
    <Eyebrow>Round {view.round} · three sets</Eyebrow>
    <h2 className="kp-display">{winner.id !== null && winner.id === playerId ? 'You win! A delicious victory.' : `${winner.name} wins!`}</h2>
    <div className="hotpot-sets">{view.sets?.map((set, i) => <figure key={i} style={{ '--set': set.type === 'color' ? COLOR_HEX[set.color] : 'var(--kp-sun)' } as CSSProperties}>
      <div>{set.cards.map((id, k) => <Card key={k} id={id} size="sm" />)}</div>
      <figcaption>{set.type === 'color' ? `${set.color} set` : `Triple ${cardName(set.cardId)}`}</figcaption>
    </figure>)}</div>
    <div className="hotpot-hands">{view.seats.map((seat, i) => i !== view.winner && <section key={i}>
      <h3>{seat.name}{seat.bot ? ' · bot' : seat.id === playerId ? ' · you' : ''}</h3>
      <div>{[...(seat.hand ?? [])].sort((a, b) => a - b).map((id, k) => <Card key={k} id={id} size="xs" />)}</div>
    </section>)}</div>
  </Panel>;
}
function SettingsView() {
  return <Panel className="hotpot"><p>Seats up to four. Bots fill every empty seat and cover for anyone who disconnects until they return. After 60 seconds without a move, a bot plays that turn.</p></Panel>;
}
function InstructionsView() {
  return <Panel className="hotpot hotpot-instructions">
    <h2 className="kp-display">Three sets to win</h2>
    <ol>
      <li><strong>Draw.</strong> Take a card from the deck, or the top card of any discard pile, including your own.</li>
      <li><strong>Check.</strong> Nine cards that split into three sets win instantly.</li>
      <li><strong>Discard.</strong> Otherwise, put one card on your pile and pass the turn.</li>
    </ol>
    <p>A set is one of each ingredient in a color, like crab claw, fish and shrimp, or three copies of the same card. The deck never runs out. After 60 seconds idle, a bot plays your turn; you can take over on your next move.</p>
  </Panel>;
}
export const client: GameClientModule<null, Action, Settings, PublicView, PrivateView> = {
  DisplayView: Table, ControllerView: Phone, PersonalView: Personal, SettingsView, InstructionsView, ResultsView,
  async prepare({ assetBase, signal }: PrepareContext) {
    await Promise.all([null, ...Array.from({ length: 24 }, (_, i) => i + 1)].map(id => { const image = new Image(); image.src = src(id, assetBase); return image.decode().catch(() => {}); }));
    signal.throwIfAborted();
  },
  dispose() {},
};
export default client;
