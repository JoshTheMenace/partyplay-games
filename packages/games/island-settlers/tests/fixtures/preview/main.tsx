/**
 * Island Settlers UI preview: mounts the real client module views on fixtures with a fake room.
 * ?view=display|controller|personal|results|settings|instructions &fixture=<name> &seat=<id>
 * &t=<ms offset> &paused=1 &replay=1 &chrome=0 &reject=<reason>. See README.md.
 */
import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ActionResult } from '../../../../../party-contract/src/index';
import type { GameClientModule } from '../../../../../party-ui/src/index';
import { usesScene } from '../../../../../party-runtime/src/scene-policy';
import '../../../../../party-ui/src/style.css';
import type { Action, PrivateView, PublicView, Settings } from '../../../src/model';
import { FIXTURE_NAMES, loadFixture, outcomeOf } from '../index';
import { makeClock } from './clock';
import { useReplay } from './replay';
import { Toolbar, VIEWS, type ViewName } from './toolbar';
import './preview.css';

type Client = GameClientModule<null, Action, Settings, PublicView, PrivateView>;

const q = new URLSearchParams(location.search);
const view: ViewName = VIEWS.find(v => v === q.get('view')) ?? 'display';
const fixture = loadFixture(FIXTURE_NAMES.find(n => n === q.get('fixture')) ?? 'mid-4');
const seat = q.get('seat') ?? fixture.seat;
const clock = makeClock(fixture.now + Number(q.get('t') ?? 0), q.get('paused') === '1');
const reject = q.get('reject');
const actions: Action[] = [];
/** Handles for automation (Playwright): clock, sent actions, the published view, replay. */
const handle = { clock, actions, fixture, pub: fixture.pub, replay: () => {} };
Object.assign(window, { islandPreview: handle });

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error ? <pre className="isp-error">{this.state.error.stack}</pre> : this.props.children;
  }
}

function App({ client }: { client: Client }) {
  const { pub, time, replay } = useReplay(fixture.pub, fixture.now, clock, q.get('replay') === '1');
  const [log, setLog] = useState<string[]>([]);
  const [scene, setScene] = useState(['display', 'controller', 'personal'].includes(view) ? 'loading' : 'none');
  const [prepared, setPrepared] = useState(false), [settings, setSettings] = useState(fixture.pub.settings);
  const role = view === 'display' ? 'display' : 'controller', host = view === 'personal';
  const abort = useMemo(() => new AbortController(), []);
  Object.assign(handle, { replay, pub });
  useEffect(() => {
    Promise.resolve(client.prepare({ role, signal: abort.signal, assetBase: '/games/island-settlers/' }))
      .then(() => setPrepared(true), error => setScene(`prepare failed: ${error}`));
    return () => { abort.abort(); client.dispose(); };
  }, [client, role, abort]);

  const sendAction = (action: Action): Promise<ActionResult> => {
    console.info('[preview] sendAction', action);
    actions.push(action);
    setLog(list => [...list.slice(-9), JSON.stringify(action)]);
    return Promise.resolve(reject ? { accepted: false, reason: reject } : { accepted: true });
  };
  const playerId = role === 'display' ? null : seat;
  const privateView = playerId ? fixture.views[playerId] ?? null : null;
  const noop = () => {};
  const props = {
    roomId: 'PREVIEW', roundId: fixture.name, playerId, viewRole: role, isHost: host, connected: true,
    publicView: pub,
    privateView, serverNowMs: clock.now, setInput: noop, releaseInput: noop, sendAction, assetsReady: noop,
  } as const;

  const stage = () => {
    if (view === 'settings') {
      const change = (next: Settings) => { console.info('[preview] settings', next); setSettings(next); };
      return <div className="kp-panel"><client.SettingsView settings={settings} disabled={false} onChange={change}/></div>;
    }
    if (view === 'instructions') {
      const as = (['display', 'controller', 'personal'] as const).find(r => r === q.get('role')) ?? 'controller';
      return <div className="kp-panel"><client.InstructionsView role={as}/></div>;
    }
    if (view === 'results') {
      const outcome = outcomeOf(pub), Results = client.ResultsView, id = q.get('seat');
      return <div className="kp-panel kp-round-results">{Results
        ? <Results outcome={outcome} publicView={pub} playerId={id} isHost={id === null}/>
        : <pre>{JSON.stringify(outcome, null, 1)}</pre>}</div>;
    }
    const View = role === 'display' ? client.DisplayView : host && client.PersonalView ? client.PersonalView
      : client.ControllerView;
    const body = <View {...props}/>;
    if (!usesScene(client, host ? 'display' : role, true) || !client.SceneView) {
      return <fieldset className="kp-game-viewport">{body}</fieldset>;
    }
    return <div className={`kp-scene-stage kp-scene-stage-${role}`} data-view-role={role}>
      <div className="kp-scene-surface"><client.SceneView {...props} phase="playing" settings={pub.settings}
        players={pub.seats.map(({ id, name, color }) => ({ id, name, color }))} viewRole={role} snapshotTime={time}
        signal={abort.signal} onReady={() => setScene('ready')} onError={error => setScene(`error: ${error}`)}/></div>
      <div className="kp-scene-overlay">{body}</div>
    </div>;
  };

  return <div className={q.get('chrome') === '0' ? 'isp-bare' : 'kp-shell kp-shell-playing'}>
    {q.get('chrome') !== '0' && <Toolbar {...{ clock, view, seat, fixture, replay, log, scene }}/>}
    {prepared && <Boundary>{stage()}</Boundary>}
  </div>;
}

const found = import.meta.glob<{ client?: Client }>('../../../src/client.tsx');
const root = createRoot(document.getElementById('root')!);
const load = Object.values(found).at(0);
const loaded = load ? await load() : null;
root.render(loaded?.client ? <App client={loaded.client}/>
  : <p className="kp-notice kp-notice-error">src/client.tsx {load ? 'has no client export' : 'is missing'}.</p>);
