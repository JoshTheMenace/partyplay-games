/** DisplayView: the TV overlay above the cinematic spectator scene (day clock, world stats, player cards). */
import { useEffect, type CSSProperties } from 'react';
import type { GameViewProps } from '../../../../../party-ui/src/index';
import { dimensionAt } from '../../shared/constants';
import { hud } from '../game/hud';
import { B, I, itemName } from '../../shared/items';
import { PF, type Action, type Input, type PrivateView, type PubPlayer, type View } from '../../shared/protocol';
import { BossBar, Celebration, useCelebration } from './endgame';
import { dayPhase, meterIcons, PHASE_LABEL, playerStatus, skyAngle, untilChange, wornArmor } from './format';
import { ItemIcon, MeterSprite } from './icons';
import { useStore } from './state';

/** The TV's day card; `end` (the camera's subject is in the End, which has no sun) swaps the clock for "The End". */
export function DayClock({ time, day, end = false }: { time: number; day: number; end?: boolean }) {
  const phase = dayPhase(time), sky = skyAngle(time), next = untilChange(time);
  const radians = sky.angle * Math.PI / 180, x = 50 - Math.cos(radians) * 40, y = 50 - Math.sin(radians) * 40;
  return <div className="bw-clock" data-phase={end ? 'end' : phase}>
    <div className="bw-dial" aria-hidden="true">{!end && <span className={`bw-orb bw-${sky.body}`} style={{ left: `${x}%`, top: `${y}%` }}/>}</div>
    <div>
      <b className="kp-numeral">Day {day + 1}</b>
      <span>{end ? 'The End · no day or night' : <>{PHASE_LABEL[phase]} · <em data-soon={next.label === 'Nightfall' && next.minutes <= 2}>{next.label} in {next.minutes} min</em></>}</span>
    </div>
  </div>;
}

const STATS: readonly { key: keyof View['stats']; label: string; icon: number }[] = [
  { key: 'mined', label: 'mined', icon: I.stone_pickaxe }, { key: 'placed', label: 'placed', icon: B.bricks },
  { key: 'crafted', label: 'crafted', icon: B.crafting_table }, { key: 'mobs', label: 'mobs', icon: I.iron_sword },
];
function WorldStats({ view }: { view: View }) {
  return <ul className="bw-world-stats" aria-label="World stats">
    {STATS.map(stat => <li key={stat.key}><ItemIcon id={stat.icon}/><b className="kp-numeral">{view.stats[stat.key].toLocaleString()}</b><span>{stat.label}</span></li>)}
  </ul>;
}

function PlayerCard({ player }: { player: PubPlayer }) {
  const status = playerStatus(player), hearts = meterIcons(player.health), armor = wornArmor(player);
  return <li className="bw-card" data-status={status} data-dim={dimensionAt(player.x, player.z)} style={{ '--player': player.color, '--len': player.name.length } as CSSProperties}>
    <span className="bw-card-held" title={player.held ? itemName(player.held) : 'Empty hand'}>{player.held ? <ItemIcon id={player.held}/> : <span className="bw-hand" aria-hidden="true"/>}</span>
    <div className="bw-card-body">
      <b className="bw-card-name" title={player.name}>{player.name}</b>
      <span className="bw-card-hearts" role="img" aria-label={`${Math.ceil(player.health) / 2} of 10 hearts`}>{hearts.map((fill, i) => <MeterSprite key={i} kind="heart" fill={fill}/>)}</span>
      {armor > 0 && <span className="bw-card-armor" role="img" aria-label={`Armor ${armor}`}><MeterSprite kind="armor" fill="full"/>{armor}</span>}
    </div>
    <span className="bw-card-status">{status}</span>
  </li>;
}

export function DisplayView({ publicView: view }: GameViewProps<Input, Action, View, PrivateView>) {
  const online = view.players.filter(player => !(player.flags & PF.OFFLINE)), party = useCelebration(view);
  // The boss bar shows while the camera follows someone in the End.
  const focus = useStore(hud, s => s.focus), subject = view.players.find(player => player.id === focus);
  const inEnd = !!subject && dimensionAt(subject.x, subject.z) === 'end', boss = inEnd ? view.boss : undefined;
  // Nobody may be near the TV to press Continue, so its celebration also ends by itself.
  useEffect(() => {
    if (!party.open) return;
    const timer = setTimeout(party.close, 25_000);
    return () => clearTimeout(timer);
  }, [party.open]);
  // Up to five players get a bottom row of cards; bigger rosters get a slim side column so the spectator shot stays clear.
  return <div className="bw-tv" data-phase={dayPhase(view.time)} data-compact={view.players.length > 5}>
    <header className="bw-tv-top">
      <DayClock time={view.time} day={view.day} end={inEnd}/>
      {boss && <BossBar boss={boss}/>}
      <div className="bw-tv-world">
        <WorldStats view={view}/>
        <span className="bw-tv-meta">{view.mode === 'creative' ? 'Creative' : `Survival · ${view.difficulty}`} · seed {view.seed}</span>
      </div>
    </header>
    {!online.length && <p className="bw-tv-hint kp-hud-text">Everyone stepped away. Rejoin on your phone with the room code to keep building.</p>}
    {view.sleeping > 0 && <p className="bw-tv-hint kp-hud-text">{view.sleeping} of {online.length} asleep. Everyone in bed skips the night.</p>}
    <ul className="bw-cards" style={{ '--cols': Math.max(1, Math.min(5, view.players.length)) } as CSSProperties} aria-label="Explorers">{view.players.map(player => <PlayerCard key={player.id} player={player}/>)}</ul>
    {party.open && <Celebration view={view} onClose={party.close}/>}
  </div>;
}
