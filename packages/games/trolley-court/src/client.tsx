/* Trolley Court GameClientModule: TV junction, phone counsel/Conductor controller, settings, how-to and the verdict screen. */
import { ToggleRow, type GameClientModule, type InstructionsViewProps, type PrepareContext, type ResultsViewProps, type SettingsViewProps } from '../../../party-ui/src/index';
import { defaults, options, toggles, type Action, type Input, type PrivateView, type PublicView, type Settings, type Toggle } from './types';
import { CardFace, Cap, Chip, Skull, TEAM, art, player, plural, vars } from './cards';
import { DisplayView } from './display';
import { ControllerView } from './phone';
import { AudioView, disposeAudio } from './audio';
import './styles.css';

const LABELS: Record<keyof typeof options, [string, (n: Settings[keyof typeof options]) => string]> = {
  laps: ['Length', n => n === 'auto' ? 'Official (twice at 3–4)' : n === 1 ? 'Everyone conducts once' : 'Everyone conducts twice'],
  pickSeconds: ['Innocent & Guilty timer', n => `${n} seconds`],
  modifierSeconds: ['Twist timer', n => `${n} seconds`],
  floorSeconds: ['Each team’s floor', n => `${n} seconds`],
  leverSeconds: ['Lever decision', n => `${n} seconds`],
};

function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  const s = { ...defaults, ...settings };
  return <div className="tc tc-settings">
    <div className="tc-options">{(Object.keys(options) as (keyof typeof options)[]).map(k => <label key={k}><span>{LABELS[k][0]}</span>
      <select value={String(s[k])} disabled={disabled} onChange={e => onChange({ ...s, [k]: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })}>{options[k].map(n => <option key={n} value={String(n)}>{LABELS[k][1](n)}</option>)}</select></label>)}</div>
    <div className="tc-toggles">{(Object.keys(toggles) as Toggle[]).map(k => <div key={k}><ToggleRow label={toggles[k][0]} checked={s[k]} disabled={disabled} onChange={value => onChange({ ...s, [k]: value })}/><p>{toggles[k][1]}{k === 'blanks' ? ' Write-ins aren’t filtered.' : ''}</p></div>)}</div>
  </div>;
}

const SAMPLE = [{ id: 's1', kind: 'innocent', text: 'A lighthouse keeper who still waves at every boat', figure: 'elder' }, { id: 's2', kind: 'guilty', text: 'A neighbour who leaf-blows at dawn', figure: 'person' }, { id: 's3', kind: 'modifier', text: 'holding the only cure for hiccups' }] as const;
function InstructionsView({ role }: InstructionsViewProps) {
  return <div className="tc tc-howto">
    <div className="tc-howto-cards" aria-hidden="true">{SAMPLE.map(c => <CardFace key={c.id} card={c}/>)}</div>
    <ul>
      <li>Each round one player is the <b>Conductor</b> (Your Honour). Everyone else splits into <b className="tc-team-north">North</b> and <b className="tc-team-south">South</b>.</li>
      <li>Each team ties an <b>Innocent</b> to its own track, plants a <b>Guilty</b> on the other track, then pins <b>Twists</b> on any card.</li>
      <li>Teammates share one secret hand. Tap a card to suggest it; anyone can lock it in, and the first lock wins.</li>
      <li>Both teams plead out loud. The Conductor pulls the lever or does nothing.</li>
      <li>Everyone on the struck team gets a death. Fewest deaths wins, and ties share the win.</li>
    </ul>
    <p>{role === 'display' ? 'The TV shows the tracks and the Clerk reads every card aloud. Write-in cards aren’t filtered; the host can switch them off.' : 'Your phone holds your team’s hand. Keep it away from the other team.'}</p>
  </div>;
}

function ResultsView({ outcome, publicView: v, playerId }: ResultsViewProps<PublicView>) {
  const winners = (outcome.winners.length ? outcome.winners : v.winners).map(id => player(v, id)).filter(p => !!p);
  const rows = v.players.map((p, seat) => ({ p, seat })).sort((a, b) => a.p.deaths - b.p.deaths || a.seat - b.seat);
  const rank = (d: number) => 1 + v.players.filter(p => p.deaths < d).length, names = (ids: string[]) => ids.map(id => player(v, id)?.name ?? '?').join(', ');
  return <div className="tc tc-results" data-display={playerId === null} data-many={v.history.length > 6} style={vars({ '--rows': v.players.length })}>
    <div className="tc-verdict-head">
      <div className="tc-podium" data-many={winners.length > 3}>{winners.map(p => <span key={p.id} className="tc-winner"><Chip p={p} me={p.id === playerId}/><small><Skull/> {plural(p.deaths, 'death')}</small></span>)}</div>
      <h2 className="kp-display">{winners.length > 1 ? `${winners.length} walk free together` : winners[0] ? `${winners[0].id === playerId ? 'You walk' : `${winners[0].name} walks`} free` : 'Court adjourned'}</h2>
      <p>Fewest deaths wins. {winners.length > 1 ? 'A shared verdict: no tie-breaker.' : ''}</p>
    </div>
    <div className="tc-results-grid">
      <table className="kp-results tc-standings"><thead><tr><th>#</th><th>Player</th><th aria-label="Deaths"><Skull/><span> Deaths</span></th><th>Spared</th><th aria-label="Conducted"><Cap/><span> Conducted</span></th></tr></thead>
        <tbody>{rows.map(({ p }) => <tr key={p.id} data-me={p.id === playerId} data-win={winners.includes(p)}><td className="kp-numeral">#{rank(p.deaths)}</td><td><Chip p={p} me={p.id === playerId}/></td><td className="kp-numeral">{p.deaths}</td><td className="kp-numeral">{p.spared}</td><td className="kp-numeral">{p.conducted}</td></tr>)}</tbody></table>
      <ol className="tc-history" aria-label="Case history">{v.history.map(r => <li key={r.round} data-side={r.struck}>
        <b className="kp-numeral">R{r.round}</b><span><Cap/>{player(v, r.conductor)?.name} {r.timedOut ? 'dithered' : r.pulled ? 'pulled' : 'did nothing'}</span><strong>{TEAM[r.struck]} struck</strong><small>{names(r.victims)}</small>
      </li>)}</ol>
    </div>
  </div>;
}

const load = (src: string, signal: AbortSignal) => new Promise<void>(resolve => {
  const image = new Image(); image.src = src;
  signal.addEventListener('abort', () => resolve(), { once: true });
  image.decode().then(() => resolve(), () => resolve());
});
export const client: GameClientModule<Input, Action, Settings, PublicView, PrivateView> = {
  DisplayView, ControllerView, SettingsView, InstructionsView, ResultsView, AudioView, settingsWide: true, immersivePhone: true,
  async prepare({ assetBase, signal, role }: PrepareContext) {
    art.base = assetBase;
    await Promise.all([...(role === 'display' ? ['backdrop.svg', 'trolley.svg'] : []), 'card-back.svg'].map(f => load(`${assetBase}art/${f}`, signal)));
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    signal.throwIfAborted();
  },
  dispose() { disposeAudio(); },
};
export default client;
