/**
 * SceneView harness: mounts the real display scene (src/scene/index.tsx) and feeds it 30 Hz snapshots from a tiny scripted
 * "server": fighters pace the main floor, one lands a smash every few seconds, the target launches offscreen, is KO'd,
 * respawns on the halo and drops back in. Exercises preparation, interpolation, events, camera kicks, tags and bubbles.
 * Query: ?stage=<id>&fighters=fox,mario,kirby,marth&pause=<seconds>&prep=<ms>&resolved=<id> (the server's stage, when it differs from the vote)
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SceneView from '../../src/scene/index';
import { DEFAULT_SETTINGS, isFighterKind, type FighterKind, type FighterView, type GameEvent, type View } from '../../src/model';
import { STAGES, STAGE_IDS, stageFrame, type StageId } from '../../src/stages';

const q = new URLSearchParams(location.search), stageId = (STAGE_IDS.includes(q.get('stage') as StageId) ? q.get('stage') : 'battlefield') as StageId, stage = STAGES[stageId];
const kinds = (q.get('fighters') ?? 'fox,mario,kirby,marth').split(',').filter(isFighterKind) as FighterKind[];
const pause = Number(q.get('pause') ?? Infinity), prep = Number(q.get('prep') ?? 1200);
const COLORS = ['#ff5748', '#28c6e7', '#78d955', '#ffd24a'], NAMES = ['Aria', 'Benedikt the Unbreakable', 'Chen', 'CPU 1'];
const players = kinds.map((fighter, i) => ({ id: `p${i}`, name: NAMES[i], color: COLORS[i], lobbyChoice: { fighter, costume: i % 4, stage: stageId } }));
const resolved = (STAGE_IDS.includes(q.get('resolved') as StageId) ? q.get('resolved') : stageId) as StageId;
const floor = stageFrame(stageId, 0, false).blocks.reduce((a, b) => b.right - b.left > a.right - a.left ? b : a);

let nextEvent = 1;
const base = (i: number): FighterView => ({ id: `p${i}`, name: NAMES[i], color: COLORS[i], fighter: kinds[i], costume: i % 4, team: null, cpu: i === 3 ? 2 : null, connected: true,
  x: stage.spawns[i][0], y: stage.spawns[i][1], vx: 0, vy: 0, facing: stage.spawns[i][0] > 0 ? -1 : 1, grounded: true, state: 'idle', stateFrame: 0, move: null, moveFrame: 0,
  charge: 0, hitlag: 0, damage: 0, stocks: 4, kos: 0, falls: 0, shield: 100, jumpsLeft: 1, intangible: false, armored: false, launch: 0, combo: 0 });
/** The scripted match at frame f (60 per second): a 6-second loop of pacing, a smash, a launch, a KO and a respawn. */
function simulate(f: number, fighters: FighterView[], events: GameEvent[]) {
  const loop = f % 360, cycle = Math.floor(f / 360), hitAt = 120;
  fighters.forEach((p, i) => {
    const s = base(i), home = s.x, t = f / 60;
    Object.assign(p, s, { damage: (cycle * 23 + i * 17) % 160, stocks: 4 - (i === 1 ? cycle % 4 : 0), stateFrame: f % 30 });
    if (i === 1 && loop >= hitAt) {
      const k = loop - hitAt, ko = Math.ceil((stage.blast.right - home) / .32), x = home + k * .32, y = floor.top + k * .2 - k * k * .0006;
      if (k < 8) Object.assign(p, { state: 'hitstun', hitlag: 8 - k, x: home, y: floor.top });
      else if (k < ko) Object.assign(p, { state: 'tumble', x, y, vx: .32, vy: .2 - k * .0012, grounded: false, launch: .3, stateFrame: k });
      else if (k < ko + 60) Object.assign(p, { state: 'out' });
      else if (loop < 340) Object.assign(p, { state: 'respawn', x: stage.respawns[i][0], y: stage.respawns[i][1], grounded: false, intangible: true });
      else Object.assign(p, { state: 'air', x: stage.respawns[i][0], y: stage.respawns[i][1] - (loop - 340) * .12, grounded: false, vy: -.12 });
      if (k === 0) events.push({ id: nextEvent++, kind: 'hit', frame: f, x: home - .3, y: floor.top + 1.1, source: 'p0', target: 'p1', effect: 'normal', power: .85, angle: 35, damage: 18, move: 'fsmash' });
      if (k === ko) events.push({ id: nextEvent++, kind: 'ko', frame: f, x: stage.blast.right, y, target: 'p1', power: 1, angle: 35 });
      return;
    }
    if (i === 0 && loop >= hitAt - 20 && loop < hitAt + 25) { Object.assign(p, { state: 'attack', move: 'fsmash', moveFrame: loop - hitAt + 20, facing: 1, x: home }); return; }
    const x = home + Math.sin(t * .9 + i * 1.7) * 1.4, vx = Math.cos(t * .9 + i * 1.7) * .9 * 1.4 / 60, jump = i === 2 && loop % 120 < 40 ? Math.sin(loop % 120 / 40 * Math.PI) * 2.2 : 0;
    Object.assign(p, { x, vx, facing: vx >= 0 ? 1 : -1, state: jump ? 'air' : Math.abs(vx) > .012 ? 'run' : 'walk', y: stage.spawns[i][1] + jump, grounded: !jump });
  });
}

function Harness() {
  const [snap, setSnap] = useState<{ view: View; time: number } | null>(null), [phase, setPhase] = useState<'preparing' | 'playing'>('preparing'), [controller] = useState(() => new AbortController());
  useEffect(() => {
    const fighters = kinds.map((_, i) => base(i)), events: GameEvent[] = [], start = performance.now() + prep;
    const timer = setInterval(() => {
      const now = performance.now(); if (now < start) return;
      setPhase('playing');
      const f = Math.floor(Math.min((now - start) / 1000, pause) * 60);
      simulate(f, fighters, events);
      while (events.length && events[0].frame < f - 60) events.shift();
      setSnap({ time: now, view: { turnId: 'lab', phase: 'fight', phaseEndsAt: 0, endsAt: 0, frame: f, stageId: resolved, stageTick: f, hazards: true, teams: false, stocks: 4, fighters: fighters.map(x => ({ ...x })), projectiles: [], events: [...events] } });
    }, 1000 / 30);
    return () => clearInterval(timer);
  }, []);
  return <SceneView roundId="lab" phase={phase} settings={{ ...DEFAULT_SETTINGS, stage: stageId }} playerId={null} viewRole="display" connected privateView={null}
    setInput={() => {}} releaseInput={() => {}} sendAction={async () => ({ accepted: true })} players={players} publicView={snap?.view ?? null} snapshotTime={snap?.time ?? null}
    signal={controller.signal} serverNowMs={() => performance.now()} onReady={() => { document.body.dataset.ready = '1'; }} onError={e => { document.body.dataset.error = String(e); console.error(e); }}/>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness/></StrictMode>);
