import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArcadeButton, Countdown, DrawingPad, DrawingRenderer, Eyebrow, Panel, StatusNotice, TextInput } from '../../../party-ui/src/index';
import type { GameClientModule, GameViewProps, SettingsViewProps } from '../../../party-ui/src/index';
import type { Action, Phase, PrivateView, PublicView, Selection, Settings, Shirt, ShirtColor } from './model';
import { clearDraft, readDraft, saveDraft } from './draft';
import type { Draft } from './draft';
import { ShirtArt, StudioArt } from './StudioArt';
import './styles.css';

type Props = GameViewProps<null, Action, PublicView, PrivateView>;
const phases: Record<Phase, string> = { draw: 'Doodle desk', slogan: 'Word workshop', design: 'Your secret supply tray', reveal: 'Fresh off the press', vote: 'The shirt showdown', 'match-result': 'The votes are in', gallery: 'The closing exhibition' };
const colors: ShirtColor[] = ['cream', 'coral', 'sky', 'lime'];
const nameOf = (view: PublicView, id: string | null) => id === null ? 'Studio stock' : view.players.find(player => player.id === id)?.name ?? 'Unknown player';

function ShirtCard({ shirt, view, credits = true }: { shirt: Shirt; view: PublicView; credits?: boolean }) {
  return <figure className="shirt-show-piece">
    <div className={`shirt-show-shirt shirt-show-shirt--${shirt.color}`}><ShirtArt />
      <div className="shirt-show-print"><DrawingRenderer drawing={shirt.art.drawing} label={`Doodle by ${nameOf(view, shirt.art.owner)}`} /><strong aria-hidden="true">{shirt.slogan.text}</strong></div>
    </div>
    <figcaption className="shirt-show-credits"><p className="shirt-show-slogan">“{shirt.slogan.text}”</p>
      {credits && <><div className="shirt-show-byline">{([['Design', shirt.designer], ['Art', shirt.art.owner], ['Words', shirt.slogan.owner]] as const).map(([role, id]) => <span className="shirt-show-credit" key={role}><b>{role}</b><span>{nameOf(view, id)}</span></span>)}</div>
      <small className="shirt-show-priority">Tie priority #{shirt.priority}{shirt.automatic ? ' · Auto-assembled' : ''}</small></>}
    </figcaption>
  </figure>;
}
function InstructionsView() {
  return <div className="shirt-show-copy"><h2 className="kp-display">Open your pop-up print studio</h2>
    <p>3–10 players · about 10–15 minutes at standard pace. Phones draw, write, remix and vote; the shared screen runs the show.</p>
    <ol><li>Make two doodles, then two short slogans. Optional starters help if you get stuck.</li><li>Your private tray gets two drawings and two slogans from other players. Combine one of each and choose a shirt color.</li><li>All shirts reveal with designer, artist and writer credits. Every shirt enters a single-elimination bracket.</li><li>Vote in every matchup except one featuring your design. Artists and writers can vote. Eliminated designers keep voting; everyone can send one unscored cheer.</li></ol>
    <p>Each match win gives its designer 100 points. The champion earns 300 more. Artists and writers receive credit, not points. Byes advance a shirt with no points. Ties, including 0–0, go to the lower seeded priority number printed on each shirt.</p>
    <p>Submitted work locks. Save draft keeps a server copy; this browser also remembers unfinished edits. At the deadline we use your saved draft, then labeled studio stock if needed. Missing designs use saved choices or the first tray items. The clock keeps moving for disconnected seats.</p>
    <p>The final local gallery includes every shirt, doodle and slogan. Nothing is uploaded and there is no merchandise checkout.</p>
  </div>;
}
function Header({ publicView: view, serverNowMs, playerId }: Props) {
  return <header className="shirt-show-header"><div><Eyebrow>Shirt Show <span>· pop-up print studio</span></Eyebrow><h1 className={playerId ? 'kp-display' : 'kp-title'}>{playerId && (view.phase === 'draw' || view.phase === 'slogan') ? `${view.phase === 'draw' ? 'Doodle' : 'Slogan'} ${view.slot + 1} of 2` : phases[view.phase]}</h1></div>
    {view.phase !== 'gallery' && <div className="shirt-show-clock"><Countdown deadline={view.deadline} serverNowMs={serverNowMs} /><span>seconds</span></div>}
  </header>;
}
function History({ view }: { view: PublicView }) {
  if (!view.history.length) return null;
  return <details className="shirt-show-history"><summary>Bracket results and byes ({view.history.length})</summary><ol>{view.history.map(result => <li key={result.id}>
    Stage {result.stage}: {result.entries.map(id => nameOf(view, view.shirts.find(shirt => shirt.id === id)!.designer)).join(' vs ')}. {nameOf(view, view.shirts.find(shirt => shirt.id === result.winner)!.designer)} advances.
    {result.policy === 'bye' ? ' Seeded bye; 0 points.' : ` ${result.votes.join('–')}. ${result.policy === 'tie-priority' ? 'Tie resolved by lower priority number.' : 'Majority vote.'} +100 designer points.`}
  </li>)}</ol></details>;
}
function Gallery({ view }: { view: PublicView }) {
  const champion = view.shirts.find(shirt => shirt.id === view.champion);
  const standings = [...view.players].sort((a, b) => b.score - a.score);
  return <div className="shirt-show-gallery">
    {champion && <Panel className="shirt-show-champion"><div><Eyebrow>The studio's best in show</Eyebrow><h2 className="kp-title">{nameOf(view, champion.designer)} takes the final bow</h2><p className="shirt-show-champion-total kp-numeral">{standings.find(player => player.id === champion.designer)?.score}<span>points</span></p><p className="shirt-show-award">Champion designer · includes the 300-point bonus</p></div><ShirtCard shirt={champion} view={view} /></Panel>}
    <Panel className={`shirt-show-scoreboard ${view.players.length > 5 ? 'shirt-show-scoreboard-many' : ''}`}><h2 className="kp-display">Designer scores</h2><ol>{standings.map(player => <li key={player.id}><span className="shirt-show-rank kp-numeral">#{standings.findIndex(other => other.score === player.score) + 1}</span><span>{player.name}</span><strong className="kp-numeral">{player.score}<small> points</small></strong></li>)}</ol><p>100 per match win, 300 for the champion, 0 for a bye. Art and words earn their own credits.</p></Panel>
    <div className="shirt-show-gallery-heading"><h2 className="kp-display">Every shirt, every collaborator</h2><p>Keep scrolling to explore the collection ↓</p></div><div className="shirt-show-grid">{view.shirts.map(shirt => <Panel key={shirt.id}><ShirtCard shirt={shirt} view={view} /></Panel>)}</div>
    <History view={view} />
    <details><summary>All doodles and slogans, including unused contributions</summary><div className="shirt-show-grid">{view.gallery?.art.map(art => <Panel key={art.id}><DrawingRenderer drawing={art.drawing} label={`Doodle by ${nameOf(view, art.owner)}`} /><p>Art: {nameOf(view, art.owner)}{art.fallback ? ' · fallback' : ''}</p></Panel>)}</div><ul>{view.gallery?.slogans.map(slogan => <li key={slogan.id}>“{slogan.text}” · Words: {nameOf(view, slogan.owner)}{slogan.fallback ? ' · fallback' : ''}</li>)}</ul></details>
    <p>This gallery stays in the current round. Use the shared host controls for a rematch or the next game.</p>
  </div>;
}
function DisplayView(props: Props) {
  const view = props.publicView;
  const creating = ['draw', 'slogan', 'design'].includes(view.phase);
  const stage = view.phase === 'draw' ? 0 : view.phase === 'slogan' ? 1 : 2;
  const matchShirts = view.match?.entries.map(id => view.shirts.find(shirt => shirt.id === id)!) ?? [];
  const latest = view.history.filter(result => result.policy !== 'bye').at(-1);
  return <main className="shirt-show shirt-show-display"><Header {...props} />
    {creating && <><ol className="shirt-show-process" aria-label="Studio stages">{['Doodle', 'Write', 'Remix', 'Showdown'].map((label, index) => <li key={label} aria-current={index === stage ? 'step' : undefined} data-done={index < stage}><b>{index < stage ? '✓' : index + 1}</b>{label}</li>)}</ol><Panel className="shirt-show-workshop"><div className="shirt-show-scene"><StudioArt /><span>{view.phase === 'draw' ? 'SMALL BATCH. BIG PERSONALITY.' : view.phase === 'slogan' ? 'GOOD WORDS. GREAT SHIRTS.' : 'MADE TO BE REMIXED.'}</span></div><div className="shirt-show-workshop-copy">
      <Eyebrow>{view.phase === 'design' ? 'Your secret supply tray is ready' : `${view.phase === 'draw' ? 'Doodle' : 'Slogan'} ${view.slot + 1} of 2`}</Eyebrow><h2 className="kp-display">{view.phase === 'draw' ? 'A little weird looks good on you.' : view.phase === 'slogan' ? 'Big ideas. Very few words.' : 'Two ingredients. One classic.'}</h2>
      <p>{view.phase === 'design' ? 'Choose one doodle, one slogan and a shirt color on your phone. The whole collection reveals together.' : 'Create on your phone. Your work goes to another maker for a surprising remix.'}</p>
      <div className="shirt-show-progress"><span role="status"><strong className="kp-numeral">{view.submitted} / {view.total}</strong> makers submitted</span><div><i style={{ width: `${view.submitted / view.total * 100}%` }} /></div></div><p className="shirt-show-fine">Saved drafts or labeled studio stock fill any gaps at the deadline.</p>
    </div></Panel><details className="shirt-show-help"><summary>How the studio works</summary><InstructionsView /></details></>}
    {view.phase === 'reveal' && <><p>Every shirt starts here. Credits are separate; only designers earn tournament points. The seeded bracket gives byes where needed. Lower tie-priority numbers break tied votes.</p><div className={`shirt-show-grid shirt-show-reveal-grid ${view.shirts.length > 5 ? 'shirt-show-reveal-many' : ''}`} style={{ '--shirt-show-columns': Math.ceil(view.shirts.length / (view.shirts.length > 5 ? 2 : 1)) } as CSSProperties}>{view.shirts.map(shirt => <Panel key={shirt.id}><ShirtCard shirt={shirt} view={view} /></Panel>)}</div></>}
    {(view.phase === 'vote' || view.phase === 'match-result') && <>
      <Panel className="shirt-show-match-heading"><div><Eyebrow>Bracket stage {view.match?.stage}</Eyebrow>{view.phase === 'vote' ? <><h2>Which shirt would you wear?</h2><p>Both designers sit this vote out. Ties favor {nameOf(view, matchShirts.find(shirt => shirt.id === view.match?.tiePriority)?.designer ?? null)} by seeded priority.</p></> : <><h2>{nameOf(view, view.shirts.find(shirt => shirt.id === latest?.winner)?.designer ?? null)} advances!</h2><p>{latest?.policy === 'tie-priority' ? 'Lower seeded priority broke the tie.' : 'The judges have spoken.'} +100 designer points.</p></>}</div><strong className="shirt-show-vote-count kp-numeral">{view.phase === 'vote' ? `${view.match?.voted} / ${view.match?.eligible}` : latest?.votes.join('–')}<small>{view.phase === 'vote' ? `judges voted · ${view.match?.cheers} cheers` : 'final vote'}</small></strong></Panel>
      <div className="shirt-show-match" key={view.turnId}>{matchShirts.length === 2 && <span className="shirt-show-versus kp-title" aria-hidden="true">VS</span>}{matchShirts.map((shirt, index) => <Panel key={shirt.id} className={view.phase === 'match-result' && latest?.winner === shirt.id ? 'shirt-show-winning-entry' : ''}><div className="shirt-show-entry-number"><b className="kp-numeral">{index + 1}</b><span>{view.phase === 'match-result' && latest?.winner === shirt.id ? 'ADVANCES · +100' : 'ON THE RACK'}</span></div><ShirtCard shirt={shirt} view={view} /></Panel>)}</div><History view={view} />
    </>}
    {view.phase === 'gallery' && <Gallery view={view} />}
  </main>;
}
function ControllerTask(props: Props) {
  const view = props.publicView, privateView = props.privateView!;
  const key = `shirt-show:draft:${props.roomId}:${props.playerId}`;
  const [draft, setDraft] = useState<Draft>(() => {
    const server = { drawing: privateView.drawing, slogan: privateView.slogan, selection: privateView.selection };
    try { return privateView.submitted ? server : readDraft(sessionStorage, key, view.turnId, privateView.revision) ?? server; } catch { return server; }
  });
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const revision = useRef(privateView.revision);
  const blocked = busy || locked || privateView.submitted;
  useEffect(() => { if (!locked && !privateView.submitted) { try { saveDraft(sessionStorage, key, view.turnId, draft, privateView.revision); } catch { /* Server drafts remain available. */ } } }, [draft, key, view.turnId, locked, privateView.submitted, privateView.revision]);
  async function send(action: Action, commit = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await props.sendAction(action);
      if (!result.accepted) setError(result.reason ?? 'That action was not accepted. Try again.');
      else {
        if (commit) { setLocked(true); try { clearDraft(sessionStorage, key, view.turnId); } catch { /* Optional browser cache. */ } }
        setNotice(commit ? 'Submitted and locked. Watch the shared screen.' : action.type === 'cheer' ? 'Cheer sent! It does not affect scoring.' : action.type === 'vote' ? 'Vote locked. Watch the shared screen.' : 'Draft saved on the server. You can keep editing.');
      }
    } catch { setError('Could not send. Your draft is still here; reconnect and try again.'); }
    finally { setBusy(false); }
  }
  function save(commit: boolean) {
    const base = { turnId: view.turnId, revision: Math.max(revision.current, privateView.revision) + 1, commit };
    revision.current = base.revision;
    if (view.phase === 'draw') void send({ type: 'drawing', ...base, drawing: draft.drawing }, commit);
    if (view.phase === 'slogan') void send({ type: 'slogan', ...base, text: draft.slogan }, commit);
    if (view.phase === 'design' && draft.selection) void send({ type: 'design', ...base, selection: draft.selection }, commit);
  }
  function choose(patch: Partial<Selection>) {
    setDraft(current => ({ ...current, selection: { artId: current.selection?.artId ?? privateView.art[0].id, sloganId: current.selection?.sloganId ?? privateView.slogans[0].id, color: current.selection?.color ?? 'cream', ...patch } }));
  }
  const creating = ['draw', 'slogan', 'design'].includes(view.phase);
  const valid = view.phase === 'draw' ? draft.drawing.strokes.length > 0 : view.phase === 'slogan' ? !!draft.slogan.trim() : !!draft.selection;
  const previewArt = privateView.art.find(art => art.id === draft.selection?.artId), previewSlogan = privateView.slogans.find(slogan => slogan.id === draft.selection?.sloganId);
  return <main className={`shirt-show shirt-show-controller shirt-show-task-${view.phase}`}><Header {...props} />
    {notice && <StatusNotice tone="success">{notice}</StatusNotice>}{error && <StatusNotice tone="error">{error}</StatusNotice>}
    {creating && blocked && !busy && <StatusNotice tone="success">Your submission is locked. Waiting for the other makers or the deadline.</StatusNotice>}
    {view.phase === 'draw' && <Panel className="shirt-show-create-card shirt-show-draw-card"><p className="shirt-show-task-hint">Your doodle. Another maker's next great shirt.</p><DrawingPad value={draft.drawing} onChange={drawing => setDraft(current => ({ ...current, drawing }))} disabled={blocked} label={`Your original doodle ${view.slot + 1}`} /></Panel>}
    {view.phase === 'slogan' && <Panel className="shirt-show-create-card"><label htmlFor="shirt-show-slogan">Slogan {view.slot + 1} of 2</label><p>A short line. A surprising picture. An instant classic.</p><TextInput id="shirt-show-slogan" value={draft.slogan} onChange={event => setDraft(current => ({ ...current, slogan: event.target.value }))} maxLength={72} disabled={blocked} autoComplete="off" placeholder="Your original slogan" /><p className="shirt-show-fine">{draft.slogan.length}/72 characters · make it your own</p></Panel>}
    {(view.phase === 'draw' || view.phase === 'slogan') && <details><summary>Need a starter? Optional inspiration</summary><ul>{privateView.starters.map(starter => <li key={starter}>{starter}</li>)}</ul><p>These are starting points. Make the contribution your own.</p></details>}
    {view.phase === 'design' && <>
      <p className="shirt-show-task-hint">One doodle + one slogan from your private tray. All credits reveal together.</p>
      <Panel className="shirt-show-create-card"><h2>1. Choose a doodle</h2><div className="shirt-show-choices">{privateView.art.map((art, index) => <div key={art.id}><DrawingRenderer drawing={art.drawing} label={`Assigned doodle ${index + 1}`} /><ArcadeButton tone={draft.selection?.artId === art.id ? 'coral' : 'ghost'} aria-pressed={draft.selection?.artId === art.id} disabled={blocked} onClick={() => choose({ artId: art.id })}>Doodle {index + 1}{draft.selection?.artId === art.id ? ' · selected' : ''}</ArcadeButton></div>)}</div></Panel>
      <Panel className="shirt-show-create-card"><h2>2. Choose a slogan</h2><div className="shirt-show-stack">{privateView.slogans.map(slogan => <ArcadeButton key={slogan.id} tone={draft.selection?.sloganId === slogan.id ? 'coral' : 'ghost'} aria-pressed={draft.selection?.sloganId === slogan.id} disabled={blocked} onClick={() => choose({ sloganId: slogan.id })}>{slogan.text}{draft.selection?.sloganId === slogan.id ? ' · selected' : ''}</ArcadeButton>)}</div></Panel>
      <Panel className="shirt-show-create-card"><h2>3. Shirt color</h2><div className="shirt-show-color-choices">{colors.map(color => <ArcadeButton key={color} tone={draft.selection?.color === color ? 'coral' : 'ghost'} aria-pressed={draft.selection?.color === color} disabled={blocked} onClick={() => choose({ color })}>{color}</ArcadeButton>)}</div></Panel>
      {draft.selection && previewArt && previewSlogan && <ShirtCard credits={false} view={view} shirt={{ ...draft.selection, id: 'preview', designer: props.playerId!, automatic: false, priority: 0, art: previewArt, slogan: previewSlogan }} />}
    </>}
    {creating && <div className="shirt-show-actions">{!valid && <p className="shirt-show-submit-hint">{view.phase === 'draw' ? 'Draw a stroke to submit.' : view.phase === 'slogan' ? 'Write a slogan to submit.' : 'Choose your doodle and slogan to submit.'}</p>}<ArcadeButton tone="ghost" disabled={blocked || (view.phase === 'design' && !draft.selection)} onClick={() => save(false)}>Save draft</ArcadeButton><ArcadeButton tone={valid ? 'coral' : 'ghost'} size="lg" disabled={blocked || !valid} onClick={() => save(true)}>{busy ? 'Sending…' : locked || privateView.submitted ? 'Submitted' : 'Submit and lock'}</ArcadeButton></div>}
    {view.phase === 'vote' && <Panel className="shirt-show-phone-vote"><h2>{privateView.canVote ? 'Which would you wear?' : 'Your shirt is on the rack!'}</h2>
      {privateView.canVote ? privateView.voted ? <StatusNotice tone="success">Vote locked. Waiting for the other judges.</StatusNotice> : <div className="shirt-show-stack">{view.match?.entries.map((id, index) => { const shirt = view.shirts.find(entry => entry.id === id)!; return <div key={id}><ShirtCard shirt={shirt} view={view} credits={false} /><ArcadeButton tone="coral" disabled={busy} onClick={() => void send({ type: 'vote', turnId: view.turnId, designId: id })}>Vote for shirt {index + 1}</ArcadeButton></div>; })}</div> : <><p>Both designers sit this vote out. Cheer on the judging.</p><div className="shirt-show-spectator-rack">{view.match?.entries.map(id => { const shirt = view.shirts.find(entry => entry.id === id)!; return <div key={id}><strong className="shirt-show-rack-label">{shirt.designer === props.playerId ? 'YOUR SHIRT' : nameOf(view, shirt.designer)}</strong><ShirtCard shirt={shirt} view={view} credits={false} /></div>; })}</div><p className="shirt-show-judge-status" role="status">{view.match?.voted} / {view.match?.eligible} judges voted · {view.match?.cheers} cheers</p></>}
      <p className="shirt-show-fine">Cheers celebrate the matchup, without changing points.</p><ArcadeButton tone={privateView.cheered ? 'ghost' : 'sun'} disabled={busy || privateView.cheered} onClick={() => void send({ type: 'cheer', turnId: view.turnId })}>{privateView.cheered ? 'Cheer sent' : 'Cheer for the showdown'}</ArcadeButton>
    </Panel>}
    {(view.phase === 'reveal' || view.phase === 'match-result') && <Panel><h2>Look up at the shared screen</h2><p>{view.phase === 'reveal' ? 'Every creation and its collaborators are revealing. Your next vote appears here.' : 'A shirt advances. Eliminated designers keep voting in later matchups.'}</p><History view={view} /></Panel>}
    {view.phase === 'gallery' && <Gallery view={view} />}
  </main>;
}
function ControllerView(props: Props) {
  if (!props.privateView || !props.playerId) return <StatusNotice>Waiting for your player seat and private studio tray.</StatusNotice>;
  return <ControllerTask key={`${props.roundId}/${props.publicView.turnId}/${props.playerId}`} {...props} />;
}
function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  return <div className="shirt-show"><label htmlFor="shirt-show-pace">Studio pace</label><select id="shirt-show-pace" value={settings.pace ?? 'standard'} disabled={disabled} onChange={event => onChange({ pace: event.target.value as Settings['pace'] })}><option value="standard">Standard · about 10–15 minutes</option><option value="quick">Quick · about 5–8 minutes</option></select><p>Ready submissions move creation and voting ahead. Reveals always leave time to read.</p></div>;
}
export const client: GameClientModule<null, Action, Settings, PublicView, PrivateView> = {
  DisplayView, ControllerView, SettingsView, InstructionsView,
  ResultsView: ({ publicView }) => <main className="shirt-show"><Gallery view={publicView} /></main>,
  prepare() {}, dispose() {},
};
export default client;
