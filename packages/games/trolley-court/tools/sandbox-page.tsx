/* Render sandbox page (tools/sandbox.ts bundles and serves it). ?f=<fixture>&seat=<n>|tv&view=tv|phone|results|howto|settings&t=<ms into the phase>&freeze&shout */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../party-ui/src/style.css';
import { client } from '../src/client';
import { defaults, type PrivateView, type PublicView } from '../src/types';

type Fixture = { publicView: PublicView; privates: PrivateView[]; outcome: { complete: boolean; winners: string[]; rows: [] } };
const q = new URLSearchParams(location.search), f: Fixture = await (await fetch(`/fixtures/${q.get('f')}.json`)).json();
const seat = q.get('seat') === null || q.get('seat') === 'tv' ? -1 : Number(q.get('seat')), born = performance.now(), base = f.publicView.startedAt + Number(q.get('t') ?? 0);
const now = () => base + (q.has('freeze') ? 0 : performance.now() - born), view = q.get('view') ?? (seat < 0 ? 'tv' : 'phone');

function App() {
  const [v, setV] = useState(f.publicView), playerId = seat < 0 ? null : v.players[seat].id;
  // ?shout: a heckle every 400 ms from a random seat, to watch the bubbles.
  useEffect(() => { if (!q.has('shout')) return; let seq = 1000; const t = setInterval(() => setV(old => ({ ...old, shouts: [...old.shouts, [++seq, Math.floor(Math.random() * old.players.length), seq % 4] as [number, number, number]].slice(-8) })), 400); return () => clearInterval(t); }, []);
  const props = { roomId: 'sandbox', roundId: 'round', playerId, viewRole: seat < 0 ? 'display' as const : 'controller' as const, isHost: seat < 0, publicView: v, privateView: seat < 0 ? null : f.privates[seat], connected: true, serverNowMs: now, setInput() {}, sendAction: async () => ({ accepted: true }), assetsReady() {} };
  const body = view === 'results' ? <section className="kp-panel kp-round-results">{client.ResultsView && <client.ResultsView outcome={f.outcome} publicView={v} playerId={playerId} isHost={seat < 0}/>}<div className="kp-row kp-result-actions"><button className="kp-btn"><span>Play again</span></button></div></section>
    : view === 'howto' ? <section className="kp-panel kp-instructions-panel">{client.InstructionsView && <client.InstructionsView role={seat < 0 ? 'display' : 'controller'}/>}</section>
    : view === 'settings' ? <section className="kp-panel">{client.SettingsView && <client.SettingsView settings={defaults} onChange={() => undefined} disabled={false}/>}</section>
    : seat < 0 ? <client.DisplayView {...props}/> : <client.ControllerView {...props}/>;
  return <main className={`kp-shell kp-shell-playing${seat < 0 ? '' : ' kp-shell-phone'}`}><header className="kp-header"><div className="kp-header-brand">Trolley Court sandbox</div></header><div className="kp-game-viewport">{body}</div></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
