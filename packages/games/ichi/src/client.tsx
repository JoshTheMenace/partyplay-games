import { ToggleRow, type GameClientModule, type InstructionsViewProps, type PrepareContext, type ResultsViewProps, type SettingsViewProps } from '../../../party-ui/src/index';
import { defaults, houseRules, options, type Action, type HouseRule, type PrivateView, type PublicView, type Settings } from './types';
import { CardFace, Emblem, art, cardLabel } from './cards';
import { DisplayView, css, ordinal } from './table';
import { ControllerView } from './phone';
import { disposeSfx } from './sfx';
import { AudioView } from './music';
import './styles.css';

const rules = Object.keys(houseRules) as HouseRule[], on = (...keys: HouseRule[]) => Object.fromEntries(rules.map(k => [k, keys.includes(k)])) as Record<HouseRule, boolean>;
const presets: [string, string, Record<HouseRule, boolean>][] = [
  ['Classic', 'Straight rules with the +4 challenge.', on('challenge')],
  ['Party', 'Stacking, challenges and Gifts. The house favorite.', on('stacking', 'challenge', 'gifts')],
  ['Chaos', 'Every house rule on. Hands fly.', on(...rules)],
];
const optionLabels = {
  target: ['Match length', (n: number) => n ? `First to ${n} points` : 'One hand'], handSize: ['Starting hand', (n: number) => `${n} cards`], turnSeconds: ['Turn timer', (n: number) => `${n} seconds`],
  tableSize: ['Tables', (n: number) => n ? `Tables of ${n}` : 'Auto'],
} as const;

function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  const s = { ...defaults, ...settings };
  return <div className="ichi ichi-settings">
    <div className="ichi-presets" role="group" aria-label="Presets">{presets.map(([name, text, values]) => <button key={name} className="ichi-preset" aria-pressed={rules.every(k => s[k] === values[k])} disabled={disabled} onClick={() => onChange({ ...s, ...values })}><strong className="kp-display">{name}</strong><span>{text}</span></button>)}</div>
    <div className="ichi-rule-list">{rules.map(k => <div key={k} className="ichi-rule"><ToggleRow label={houseRules[k][0]} checked={s[k]} disabled={disabled} onChange={value => onChange({ ...s, [k]: value })}/><p>{houseRules[k][1]}</p></div>)}</div>
    <div className="ichi-options">{(Object.keys(optionLabels) as (keyof typeof options)[]).map(k => <label key={k}><span>{optionLabels[k][0]}</span><select value={s[k]} disabled={disabled} onChange={e => onChange({ ...s, [k]: Number(e.target.value) })}>{options[k].map(n => <option key={n} value={n}>{optionLabels[k][1](n)}</option>)}</select></label>)}</div>
    <p className="ichi-options-note">Auto seats up to ten players at one table and bigger rooms at tables of four. With several tables everyone plays at once, in six-minute rounds: one, three or five of them for a one-hand, 200 or 500 match. A bell ends each round and the room reseats by score.</p>
  </div>;
}

const sample = [{ id: 'a', color: 'coral', value: '7' }, { id: 'b', color: 'sky', value: 'reverse' }, { id: 'd', color: 'lime', value: 'gift' }, { id: 'c', color: 'wild', value: 'wild4' }] as const;
function InstructionsView({ role }: InstructionsViewProps) {
  return <div className="ichi ichi-howto">
    <div className="ichi-howto-cards" aria-hidden="true">{sample.map(c => <CardFace key={c.id} card={c}/>)}</div>
    <ul>
      <li><b>Match</b> the top card’s color or its number or symbol. Wilds go on anything and pick the next color.</li>
      <li><b>Can’t match?</b> Draw one. If it fits, play it or keep it.</li>
      <li><b>Skip, Reverse, +2 and Wild +4</b> hit the next player. With stacking, answer a +2 with a +2 or +4 to pass the pile along.</li>
      <li><b>Gift:</b> play it, then hand any other card from your hand to whoever you like.</li>
      <li><b>Down to one card?</b> It’s a race: tap <b>Ichi!</b> before anyone else taps <b>Catch!</b>, or you draw two.</li>
      <li><b>Go out</b> to score every card left in other hands. First to the target wins.</li>
      <li><b>Big room?</b> Past ten players you play at tables of four, all at once, in six-minute rounds. The bell gives everyone one last turn, then the room reseats by score.</li>
    </ul>
    <p>{role === 'display' ? 'The TV shows the table. Each phone holds a private hand.' : 'Your hand stays on your phone. Watch the TV for the table.'}</p>
  </div>;
}

function ResultsView({ outcome, publicView: v, playerId }: ResultsViewProps<PublicView>) {
  const rows = v.roster.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score || b.handsWon - a.handsWon || a.i - b.i);
  const rank = (score: number) => 1 + rows.filter(p => p.score > score).length, me = rows.find(p => p.id === playerId);
  const winners = (outcome.winners.length ? outcome.winners.map(id => rows.find(p => p.id === id)!) : v.match.winners.map(i => rows.find(p => p.i === i)!)).filter(Boolean);
  const r = v.match.parlor ? null : v.feature?.handResult, left = (i: number) => r?.hands.find(h => h.p === i)?.cards ?? [];
  const n = rows.length, oneHand = !v.match.parlor && v.settings.target === 0, cols = n > 40 ? 4 : n > 20 ? 3 : n >= 7 ? 2 : 1;
  return <div className="ichi ichi-results" data-display={playerId === null} data-crowd={n > 10} style={css({ '--rows': Math.ceil(n / cols), '--cols': cols })}>
    <div className="ichi-petals" aria-hidden="true">{Array.from({ length: 18 }, (_, k) => <i key={k} style={{ left: `${k * 37 % 100}%`, animationDelay: `${-(k % 9) * .45}s`, animationDuration: `${4 + k % 5 * .7}s` }}/>)}</div>
    <div className="ichi-podium">{winners.slice(0, 3).map(p => <div key={p.id} style={css({ '--seat': p.color })}><Emblem color="wild"/><strong className="kp-display">{p.id === playerId ? 'You' : p.name}</strong><span className="kp-numeral">{p.score} pts</span></div>)}</div>
    <h2 className="kp-display">{winners.length > 3 ? `${winners.length} players share the win` : winners.length > 1 ? `${winners.map(p => p.name).join(' & ')} share the win` : `${winners[0]?.name ?? 'Nobody'} wins`}</h2>
    {me && n > 3 && <p className="ichi-you">You finished <b>{ordinal(rank(me.score))} of {n}</b> with {me.score} points.</p>}
    {v.match.finishReason && <p>{v.match.finishReason}</p>}
    <ol className="ichi-standings">{rows.map(p => <li key={p.id} data-me={p.id === playerId} data-winner={winners.includes(p)}><span className="kp-numeral">#{rank(p.score)}</span><strong style={{ color: p.color }}>{p.name}</strong>{oneHand && r ? <span className="ichi-leftover" style={css({ '--n': Math.max(left(p.i).length, 1) })} aria-label={left(p.i).length ? left(p.i).map(cardLabel).join(', ') : 'Went out'}>{left(p.i).length ? left(p.i).map(c => <CardFace key={c.id} card={c} className="is-in"/>) : <em>Went out</em>}</span>
      : <span>{p.handsWon} {p.handsWon === 1 ? 'hand' : 'hands'}</span>}<b className="kp-numeral">{p.score}</b></li>)}</ol>
    {r && !oneHand && <details className="ichi-last-hand"><summary>Last hand: {v.roster[r.winner ?? -1]?.name ?? 'Nobody'} +{r.points}</summary><ul>{r.hands.filter(h => h.cards.length).map(h => <li key={h.p}><strong>{v.roster[h.p].name}</strong><span>{h.cards.map(cardLabel).join(', ')}</span><b className="kp-numeral">{h.points}</b></li>)}</ul></details>}
  </div>;
}

const load = (src: string, signal: AbortSignal) => new Promise<boolean>(resolve => {
  const image = new Image(); image.src = src;
  signal.addEventListener('abort', () => resolve(false), { once: true });
  image.decode().then(() => resolve(true), () => resolve(false));
});
export const client: GameClientModule<null, Action, Settings, PublicView, PrivateView> = {
  DisplayView, ControllerView, SettingsView, InstructionsView, ResultsView, AudioView, settingsWide: true, immersivePhone: true,
  async prepare({ assetBase, signal, role }: PrepareContext) {
    art.base = assetBase;
    const [back, table] = await Promise.all([load(`${assetBase}card-back.webp`, signal), load(`${assetBase}${role === 'display' ? 'table' : 'table-portrait'}.webp`, signal)]);
    signal.throwIfAborted();
    Object.assign(art, { back, table });
  },
  dispose() { disposeSfx(); },
};
export default client;
