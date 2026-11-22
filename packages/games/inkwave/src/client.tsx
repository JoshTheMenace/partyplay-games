import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ArcadeButton, StatusNotice, type GameAudioProps, type GameClientModule, type GameViewProps, type LobbyViewProps, type ResultsViewProps, type SceneViewProps, type SettingsViewProps } from '../../../party-ui/src/index';
import { ARENA_NAMES, arenaCount, dealSeat } from '../public/arenas.js';
import { type Input, type Action, type Choice, type PrivateView, type PublicView, type Roster, type Settings } from './model';
import { MODES, STAGES, TEAMS } from './labels';
import './style.css';
type Props = GameViewProps<Input, Action, PublicView, PrivateView>;
const base = '/games/inkwave/', channel = 'partyplay-inkwave';
const defaultChoice: Choice = { weapon: 'shooter', sub: null, special: null, style: { hair: 0, skin: 0, outfit: 0, hat: 0 } };
const tint = (color: string) => ({ '--team': color }) as CSSProperties;
const clock = (time: number) => { const seconds = Math.max(0, Math.ceil(time)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

function OriginalScreen({ screen, data, onMessage }: { screen: string; data: unknown; onMessage?(message: Record<string, any>): void }) {
  const id = useId(), iframe = useRef<HTMLIFrameElement>(null), latest = useRef({ data, onMessage }); latest.current = { data, onMessage };
  const [error, setError] = useState('');
  useEffect(() => {
    const send = (type: string) => iframe.current?.contentWindow?.postMessage({ channel, roundId: id, type, data: latest.current.data }, location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== location.origin || event.data?.channel !== channel || event.data.roundId !== id) return;
      if (event.data.type === 'loaded') send('init');
      if (event.data.type === 'error') setError(event.data.message);
      latest.current.onMessage?.(event.data);
    };
    const unlock = () => send('unlock');
    window.addEventListener('message', receive); window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    return () => { send('stop'); window.removeEventListener('message', receive); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, [id]);
  useEffect(() => { iframe.current?.contentWindow?.postMessage({ channel, roundId: id, type: 'update', data }, location.origin); }, [id, data]);
  return <>{error && <StatusNotice tone="error">{error}</StatusNotice>}<iframe ref={iframe} className={`inkwave-original inkwave-${screen}`} title={`Inkwave ${screen}`} src={`${base}index.html?party&screen=${screen}&round=${encodeURIComponent(id)}`} allow="autoplay" hidden={screen === 'sound'}/></>;
}
function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  return <OriginalScreen screen="settings" data={{ settings, disabled }} onMessage={message => { if (message.type === 'settings' && !disabled) onChange(message.settings); }}/>;
}

/** Who plays where, before anyone has to ask: the room dealt into arenas and teams exactly as the server will deal it. */
function LineUp({ players, settings, self }: { players: LobbyViewProps<Settings>['players']; settings: Settings; self?: string | null }) {
  const boss = settings.mode === 'boss', cargo = settings.map === 'cargo', arenas = Array.from({ length: arenaCount(players.length) }, () => [[], []] as (typeof players)[]);
  players.forEach((player, index) => { const seat = dealSeat(index, players.length, settings.mode); arenas[seat.arena][seat.team].push(player); });
  return <div className={`inkwave-lineup ${arenas.length > 1 ? 'inkwave-lineup-many' : ''}`} data-arenas={arenas.length}>{arenas.map((teams, arena) => <section key={arena}>
    {arenas.length > 1 && <h3>{boss ? 'Squad' : 'Arena'} {ARENA_NAMES[arena]}</h3>}
    {(boss ? [0] : [0, 1]).map(team => { const cpus = cargo ? 0 : (boss ? 8 : 4) - teams[team].length; return <ul key={team} style={tint(TEAMS[team].color)}>
      <li className="inkwave-lineup-team">{boss ? 'One squad' : TEAMS[team].name}</li>
      {teams[team].map(player => <li key={player.id} className={`${player.ready ? 'is-ready' : ''} ${player.id === self ? 'is-self' : ''} ${player.connected ? '' : 'is-away'}`}>{player.name}</li>)}
      {cpus > 0 && <li className="inkwave-lineup-cpu">+ {cpus} CPU{cpus > 1 ? 's' : ''}</li>}
    </ul>; })}
  </section>)}</div>;
}
function Lobby({ players, playerId, settings, onChoice, onReady, connected, error }: LobbyViewProps<Settings>) {
  const index = players.findIndex(player => player.id === playerId), player = players[index], choice = (player?.lobbyChoice || defaultChoice) as Choice;
  const arenas = arenaCount(players.length), boss = settings.mode === 'boss', seat = player && dealSeat(index, players.length, settings.mode);
  const rule = settings.map === 'cargo' ? 'Cargo Terminal: human players only, at least one on each team.' : boss ? 'Squads of eight against HULLBREAKER. CPUs fill empty seats.' : 'Teams of four. CPUs fill empty seats and take over disconnected players.';
  const many = arenas > 1 ? boss ? ` ${arenas} squads fight their own boss at once; the room wins if at least half of them sink it.` : ` ${arenas} arenas play at once, and every arena scores for ${TEAMS[0].name} or ${TEAMS[1].name}.` : '';
  return <div className="inkwave inkwave-lobby">
    {player ? <><OriginalScreen screen="loadout" data={{ settings, choice, name: player.name, disabled: !connected || player.ready }} onMessage={message => { if (message.type === 'choice' && connected && !player.ready) onChoice(message.choice); }}/>
      <div className="inkwave-ready">
        <span className="inkwave-seat" style={tint(TEAMS[seat!.team].color)}>{boss ? arenas > 1 ? `Squad ${ARENA_NAMES[seat!.arena]}` : 'Boss squad' : `${TEAMS[seat!.team].name}${arenas > 1 ? ` · Arena ${ARENA_NAMES[seat!.arena]}` : ''}`}</span>
        <ArcadeButton disabled={!connected} onClick={() => { if (!player.ready && !player.lobbyChoice) onChoice(defaultChoice); onReady(!player.ready); }}>{player.ready ? 'Change loadout' : 'Ready to ink!'}</ArcadeButton>
        {player.ready && <span>Ready · waiting for the host</span>}
      </div></>
      : <><p className="inkwave-lobby-stage"><b>{MODES[settings.mode]}</b> on {STAGES[settings.map]} · {clock(settings.duration)}</p>{players.length ? <LineUp players={players} settings={settings}/> : <p>Players choose their loadouts and locker looks on their phones.</p>}</>}
    <p>{rule}{many}</p>{error && <StatusNotice tone="error">{error}</StatusNotice>}
  </div>;
}

/**
 * One screen's arena: a phone its own, the TV whichever arena the broadcast is on.
 *
 * The shell unmounts a scene whenever its socket drops and mounts a new one when it is back. Rebuilding the original
 * 3D stage for that costs a phone ten seconds or more, and on a slow one the rebuild itself stalls the page long enough
 * to drop the socket again. So the arena is not this component's to destroy: its iframe sits beside it in the shell's
 * stage element, which lasts as long as the round is on screen, and a scene mounted later for the same round takes it
 * over as it is, loaded or still loading. The iframe goes when the stage does (results, lobby) or a new round needs it.
 */
function Scene(props: SceneViewProps<Settings, PublicView, PrivateView>) {
  const slot = useRef<HTMLElement>(null), arena = useRef<HTMLIFrameElement | null>(null), latest = useRef(props), sent = useRef({ first: true, ink: null as null | { ink: string; inkSequence: number } }); latest.current = props;
  const post = (type: string, data = {}) => arena.current?.contentWindow?.postMessage({ channel, roundId: latest.current.roundId, type, ...data }, location.origin);
  const snapshot = () => {
    const { publicView: view, privateView: own } = latest.current; if (!view || !arena.current?.dataset.ready) return;
    // The paint baseline is large and rare: each retaken one arrives once (`fresh`, or with a seat's own arena) and is
    // forwarded once. A scene that has only now finished loading starts from the newest one this page has seen.
    const retaken = own ? own.ink !== undefined && { ink: own.ink, inkSequence: own.inkSequence! } : view.fresh;
    const fresh = retaken || (sent.current.first ? own ? sent.current.ink : { ink: view.ink, inkSequence: view.inkSequence } : null);
    sent.current = { first: false, ink: null };
    post('snapshot', { view: { arena: own ? own.arena : view.feature, feed: own ? own.feed : view.live, ...fresh } });
  };
  useEffect(() => {
    const stage = slot.current!.closest('.kp-scene-stage') ?? slot.current!.parentElement!; sent.current = { first: true, ink: null };
    let frame = stage.querySelector<HTMLIFrameElement>(':scope > iframe.inkwave-scene');
    if (frame && frame.dataset.round !== props.roundId) { frame.contentWindow?.postMessage({ channel, roundId: frame.dataset.round, type: 'stop' }, location.origin); frame.remove(); frame = null; }
    if (!frame) {
      frame = Object.assign(document.createElement('iframe'), { className: 'inkwave-scene', title: 'Inkwave arena', tabIndex: -1, src: `${base}index.html?party&round=${encodeURIComponent(props.roundId)}` });
      frame.dataset.round = props.roundId; stage.prepend(frame);
    }
    arena.current = frame;
    const ready = () => { frame.dataset.ready = '1'; latest.current.onReady(); snapshot(); };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== channel || event.data.roundId !== props.roundId) return;
      if (event.data.type === 'loaded') post('init', { settings: props.settings, players: props.players, playerId: props.playerId });
      if (event.data.type === 'ready') ready();
      if (event.data.type === 'input') latest.current.setInput(event.data.input);
      if (event.data.type === 'release') latest.current.releaseInput();
      if (event.data.type === 'action') void latest.current.sendAction(event.data.action).then(result => post('ack', { result }));
      if (event.data.type === 'error' && !props.signal.aborted) { frame.remove(); latest.current.onError(new Error(event.data.message)); }
    };
    const unlock = () => post('unlock');
    window.addEventListener('message', receive); window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    // Taken over already loaded (the socket came back): the room is told again that this screen is ready.
    if (frame.dataset.ready) ready();
    return () => { post('release'); arena.current = null; window.removeEventListener('message', receive); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, [props.roundId, props.signal]);
  useEffect(() => {
    const own = props.privateView; if (!arena.current?.dataset.ready && own?.ink !== undefined) sent.current.ink = { ink: own.ink, inkSequence: own.inkSequence! };
    snapshot();
  }, [props.publicView, props.privateView, props.roundId]);
  return <i ref={slot} hidden/>;
}

type Callout = { id: number; until: number; text: string; team: number };
type Splat = { id: number; until: number; by: string | null; byTeam: number; name: string; team: number };
/**
 * The TV's play-by-play, worked out from consecutive snapshots of the arena on screen: who splatted whom (from the
 * splat and splatted counters), who took the lead or the zone, and when the broadcast cut to another arena.
 */
function useCommentary(view: PublicView) {
  const memory = useRef({ t: -1, arena: -1, cutAt: 0, stats: [] as number[][], leader: -1, zone: -1, saidAt: 0, id: 0, callouts: [] as Callout[], splats: [] as Splat[] });
  const m = memory.current, feed = view.live, now = Date.now(), roster = view.roster[view.feature] ?? [];
  if (m.arena !== view.feature) { if (m.arena >= 0) m.cutAt = now; Object.assign(m, { arena: view.feature, stats: [], leader: -1, zone: -1, callouts: [], splats: [] }); }
  if (feed.t !== m.t) {
    m.t = feed.t;
    if (m.stats.length === feed.stats.length && feed.state === 'playing') {
      const gained = (column: number) => feed.stats.flatMap((row, index) => Array.from({ length: Math.max(0, Math.min(3, row[column] - m.stats[index][column])) }, () => index));
      const attackers = gained(1);
      for (const victim of gained(2)) {
        const at = attackers.findIndex(index => roster[index]?.team !== roster[victim]?.team), by = at < 0 ? null : roster[attackers.splice(at, 1)[0]];
        m.splats.push({ id: ++m.id, until: now + 5000, by: by?.name ?? null, byTeam: by?.team ?? 0, name: roster[victim]?.name ?? '', team: roster[victim]?.team ?? 0 });
      }
    }
    m.stats = feed.stats;
    const say = (text: string, team: number) => { m.saidAt = now; m.callouts = [{ id: ++m.id, until: now + 2600, text, team }]; };
    if (feed.state === 'playing' && view.settings.mode === 'turf') {
      const gap = feed.coverage[0] - feed.coverage[1], leader = Math.abs(gap) < .004 ? m.leader : gap > 0 ? 0 : 1;
      if (leader !== m.leader && m.leader >= 0 && now - m.saidAt > 6000 && feed.time > 12) say(`${view.teams[leader]} take the lead`, leader);
      m.leader = leader;
    }
    if (feed.state === 'playing' && feed.zones) {
      const owner = Number(feed.zones.owner ?? -1);
      if (owner !== m.zone && owner >= 0 && m.t > 0) say(`${view.teams[owner]} hold the zone`, owner);
      m.zone = owner;
    }
  }
  m.callouts = m.callouts.filter(item => item.until > now); m.splats = m.splats.filter(item => item.until > now).slice(-4);
  return { callouts: m.callouts, splats: m.splats, cut: now - m.cutAt < 1500 };
}
function Display({ publicView: view }: Props) {
  const { callouts, splats, cut } = useCommentary(view), feed = view.live, boss = feed.boss, many = view.arenas.length > 1, roster = view.roster[view.feature] ?? [];
  const seconds = Math.ceil(feed.time), playing = feed.state === 'playing', mode = view.settings.mode;
  const wins = [0, 1].map(team => view.arenas.filter(arena => arena.winner === team || arena.winner === undefined && (arena.count ? arena.count[team] < arena.count[1 - team] : arena.coverage[team] > arena.coverage[1 - team])).length);
  const room = [0, 1].map(team => view.arenas.reduce((sum, arena) => sum + arena.coverage[team], 0) / view.arenas.length), sunk = view.arenas.filter(arena => arena.winner === 0).length;
  const score = (team: number) => <div className="inkwave-team" style={tint(view.colors[team])}><small>{view.teams[team]}{many && <em>{mode === 'zones' ? ` · ${percent(room[team])} turf` : ` · leads ${wins[team]}`}</em>}</small><b>{many ? mode === 'zones' ? `${wins[team]} ahead` : percent(room[team]) : feed.zones ? feed.zones.count[team] : percent(feed.coverage[team])}</b></div>;
  const squad = (team: number) => <li key={team}>{roster.map((player, index) => player.team === team && <div key={player.id} className={feed.actors[index]?.[10] & 1 ? '' : 'is-out'} style={tint(view.colors[player.team])}><b>{player.name}</b><span>{boss ? `${feed.stats[index]?.[4] ?? 0} damage` : `${feed.stats[index]?.[0] ?? 0}p`} · {feed.stats[index]?.[1] ?? 0} splats</span></div>)}</li>;
  const chip = (arena: PublicView['arenas'][number], index: number) => <li key={index} className={`${index === view.feature ? 'is-live' : ''} ${arena.winner !== undefined ? 'is-done' : ''}`} style={{ '--a': view.colors[0], '--b': view.colors[1], '--share': arena.boss ? `${arena.boss[0] * 100}%` : `${arena.coverage[0] / Math.max(.0001, arena.coverage[0] + arena.coverage[1]) * 100}%` } as CSSProperties}>
    <b>{ARENA_NAMES[index]}</b><i/><span>{arena.boss ? arena.winner === 0 ? 'SUNK' : arena.winner === 1 ? 'LOST' : `${Math.ceil(arena.boss[0] * 100)}% HP` : arena.count ? `${arena.count[0]}–${arena.count[1]}` : `${Math.round(arena.coverage[0] * 100)}–${Math.round(arena.coverage[1] * 100)}`}</span>
  </li>;
  return <div className={`inkwave inkwave-display ${many ? 'inkwave-many' : ''}`}>
    <div className="inkwave-score">
      {boss ? <div className="inkwave-team" style={{ '--team': '#ff4150', '--hp': `${Number(boss[7]) / Number(boss[17]) * 100}%` } as CSSProperties}><small>HULLBREAKER · Phase {Number(boss[8])}</small><b>{Math.ceil(Number(boss[7]) / Number(boss[17]) * 100)}% HP</b><i/></div> : score(0)}
      <strong>{feed.state === 'intro' ? 'READY' : feed.zones?.overtime ? 'OVERTIME' : clock(feed.time)}<small>{boss ? many ? `${sunk} of ${view.arenas.length} sunk` : 'Sink HULLBREAKER' : feed.zones ? many ? 'Most arenas wins' : 'Hold the zones' : many ? 'Most turf, every arena' : 'Most turf wins'}</small></strong>
      {!boss && score(1)}
    </div>
    {many && <ol className="inkwave-arenas">{view.arenas.map(chip)}</ol>}
    {many && <p className="inkwave-onair">{mode === 'boss' ? 'Squad' : 'Arena'} {ARENA_NAMES[view.feature]}{!boss && <span>{feed.zones ? `${feed.zones.count[0]}–${feed.zones.count[1]}` : `${percent(feed.coverage[0])} – ${percent(feed.coverage[1])}`}</span>}</p>}
    <ul className="inkwave-feed">{splats.map(item => <li key={item.id}>{item.by ? <><b style={tint(view.colors[item.byTeam])}>{item.by}</b><i>splatted</i></> : <i>splatted:</i>}<b style={tint(view.colors[item.team])}>{item.name}</b></li>)}</ul>
    {feed.state === 'intro' && !cut && <div className="inkwave-card">
      <small>{MODES[mode]} · {STAGES[view.settings.map]}{many ? ` · ${mode === 'boss' ? 'Squad' : 'Arena'} ${ARENA_NAMES[view.feature]} of ${view.arenas.length}` : ''}</small>
      <div>{(boss ? [0] : [0, 1]).map(team => <ul key={team} style={tint(view.colors[team])}><li>{boss ? 'The squad' : view.teams[team]}</li>{roster.filter(player => player.team === team).map(player => <li key={player.id} className={player.bot ? 'is-cpu' : ''}>{player.name}</li>)}</ul>)}{!boss && <b>VS</b>}</div>
    </div>}
    {playing && callouts.map(item => <p key={item.id} className="inkwave-callout" style={tint(view.colors[item.team])}>{item.text}</p>)}
    {playing && feed.time <= 60 && feed.time > 57 && view.settings.duration > 60 && <p className="inkwave-callout">One minute left</p>}
    {playing && feed.time <= 10 && feed.time > 0 && !feed.zones?.overtime && <p key={seconds} className="inkwave-count">{seconds}</p>}
    {feed.state === 'finish' && <p className="inkwave-callout inkwave-time">{boss ? Number(boss[9]) & 2 ? 'Sunk!' : 'Time!' : feed.zones ? 'Game!' : 'Time!'}</p>}
    {feed.state === 'judge' && feed.result && many && <p className="inkwave-callout inkwave-time" style={tint(view.colors[feed.result.winner])}>{boss ? feed.result.winner ? 'Squad lost' : 'Boss sunk!' : `${view.teams[feed.result.winner]} take Arena ${ARENA_NAMES[view.feature]}`}</p>}
    {cut && <p className="inkwave-cut">{mode === 'boss' ? 'Squad' : 'Arena'} {ARENA_NAMES[view.feature]}</p>}
    <ul className="inkwave-roster">{boss ? squad(0) : [squad(0), squad(1)]}</ul>
  </div>;
}
/** Over a phone's own arena: only what the original HUD cannot know, which is how the rest of the room is doing. */
function Controller({ publicView: view, privateView: own }: Props) {
  if (!own) return null;
  const done = own.feed.result, boss = view.settings.mode === 'boss', left = view.arenas.filter(arena => arena.winner === undefined).length;
  return <div className="inkwave inkwave-phone">
    {done && !view.result && <div className="inkwave-decided" style={tint(view.colors[boss ? 0 : done.winner])}><strong>{boss ? done.winner ? 'Out of time' : 'Boss sunk!' : `${view.teams[done.winner]} take Arena ${ARENA_NAMES[own.arena]}`}</strong><span>{left} {left === 1 ? (boss ? 'squad is' : 'arena is') : boss ? 'squads are' : 'arenas are'} still playing. Watch the big screen.</span></div>}
  </div>;
}
function AudioView(props: GameAudioProps<PublicView>) { return props.isHost ? <OriginalScreen screen="sound" data={{ phase: props.phase, publicView: props.publicView && { boss: props.publicView.live.boss?.[8], time: props.publicView.live.time, result: props.publicView.result && { winner: props.publicView.result.winner } }, connected: props.connected }}/> : null; }

/** One arena of a finished round in the shape the original results screen reads (public/menus.js). */
function arenaResult(view: PublicView, arena: number) {
  const final = view.result!.arenas[arena];
  return { roundId: view.roundId, settings: view.settings, colors: view.colors, coverage: final.coverage, zones: final.zones, result: final.result, roster: view.roster[arena], stats: final.stats.map(([turf, splats, deaths, specials, bossDmg, weakHits, zoneTurf]) => ({ turf, splats, deaths, specials, bossDmg, weakHits, zoneTurf })) };
}
function Results({ publicView: view, playerId, isHost }: ResultsViewProps<PublicView>) {
  const result = view.result; if (!result) return null;
  const many = view.arenas.length > 1, boss = view.settings.mode === 'boss', seat = view.roster.flat().find(player => player.id === playerId), sunk = result.arenas.filter(arena => arena.result.winner === 0).length;
  if (!many) return <div className={playerId ? undefined : 'inkwave-watch'}><OriginalScreen screen="results" data={{ view: arenaResult(view, 0), settings: view.settings, playerId, isHost }}/></div>;
  const best = (column: number) => view.roster.flatMap((arena, index) => arena.map((player, nid) => ({ player, value: result.arenas[index].stats[nid][column] }))).filter(entry => !entry.player.bot).sort((a, b) => b.value - a.value)[0];
  const stars = boss ? [['Most damage', best(4), 'damage'], ['Most weak-point hits', best(5), 'hits']] as const : [['Most turf', best(0), 'p'], ['Most splats', best(1), 'splats']] as const;
  return <div className="inkwave inkwave-room-results">
    <header style={tint(boss ? result.winner ? '#ff4150' : view.colors[0] : view.colors[result.winner])}>
      <h2>{boss ? `${sunk} of ${result.arenas.length} bosses sunk` : result.tie ? 'Dead heat!' : `${view.teams[result.winner]} win the room!`}</h2>
      {!boss && <p>{view.teams[0]} <b>{percent(result.coverage[0])}</b> turf, {result.wins[0]} {result.wins[0] === 1 ? 'arena' : 'arenas'} · {view.teams[1]} <b>{percent(result.coverage[1])}</b> turf, {result.wins[1]} {result.wins[1] === 1 ? 'arena' : 'arenas'}</p>}
      <p className="inkwave-stars">{stars.map(([label, entry, unit]) => entry && <span key={label}>{label}: <b style={tint(view.colors[entry.player.team])}>{entry.player.name}</b> {entry.value}{unit === 'p' ? 'p' : ` ${unit}`}</span>)}</p>
    </header>
    <div className="inkwave-room-arenas">{result.arenas.map((arena, index) => <section key={index} className={seat?.arena === index ? 'is-mine' : ''}>
      <h3 style={tint(boss ? arena.result.winner ? '#ff4150' : view.colors[0] : view.colors[arena.result.winner])}>{boss ? 'Squad' : 'Arena'} {ARENA_NAMES[index]}<span>{boss ? arena.result.winner ? 'Out of time' : 'Boss sunk' : arena.zones ? `${arena.zones.count[0]} – ${arena.zones.count[1]}` : `${percent(arena.coverage[0])} – ${percent(arena.coverage[1])}`}</span></h3>
      <div>{(boss ? [0] : [0, 1]).map(team => <ul key={team}>{view.roster[index].map((player: Roster, nid: number) => player.team === team && <li key={player.id} className={`${player.bot ? 'is-cpu' : ''} ${player.id === playerId ? 'is-self' : ''}`} style={tint(view.colors[player.team])}><b>{player.name}</b><span>{boss ? `${arena.stats[nid][4]} dmg` : `${arena.stats[nid][0]}p`}</span></li>)}</ul>)}</div>
    </section>)}</div>
    {seat && <OriginalScreen screen="results" data={{ view: arenaResult(view, seat.arena), settings: view.settings, playerId, isHost }}/>}
  </div>;
}
export const client: GameClientModule<Input, Action, Settings, PublicView, PrivateView> = {
  immersivePhone: true, sceneRoles: ['display', 'controller'], SceneView: Scene, LobbyView: Lobby, AudioView,
  DisplayView: Display, ControllerView: Controller, PersonalView: Controller, SettingsView, settingsWide: true,
  InstructionsView: () => <div className="inkwave"><h2>Make a splash.</h2><p>Move with your left thumb. Drag the right side to aim; hold the large fire button and drag it to aim while shooting. Hold SQUID in your own ink to refill and swim. JUMP, SUB and SP use your other abilities. MAP lets you Super Jump to a teammate. On a computer: WASD, mouse, click to fire, Shift to swim, Space to jump, E for sub, F for special.</p><p>Paint floors to score in Turf War, hold zones in Zone Control, or team up against HULLBREAKER in Boss Battle. CPUs fill empty seats except on Cargo Terminal. More than eight players split into 4v4 arenas that play at once and score for the same two teams.</p></div>,
  ResultsView: Results,
  prepare: () => {}, dispose: () => {},
};
export default client;
