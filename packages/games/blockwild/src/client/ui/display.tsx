/** DisplayView: the TV overlay above the cinematic spectator scene (day clock, world stats, player cards). */
import type { CSSProperties } from 'react';
import type { GameViewProps } from '../../../../../party-ui/src/index';
import { inNether } from '../../shared/constants';
import { B, I, itemName } from '../../shared/items';
import { PF, type Action, type Input, type PrivateView, type PubPlayer, type View } from '../../shared/protocol';
import { dayPhase, meterIcons, PHASE_LABEL, playerStatus, skyAngle, untilChange, wornArmor } from './format';
import { ItemIcon, MeterSprite } from './icons';

export function DayClock({ time, day }: { time: number; day: number }) {
  const phase = dayPhase(time), sky = skyAngle(time), next = untilChange(time);
  const radians = sky.angle * Math.PI / 180, x = 50 - Math.cos(radians) * 40, y = 50 - Math.sin(radians) * 40;
  return <div className="bw-clock" data-phase={phase}>
    <div className="bw-dial" aria-hidden="true"><span className={`bw-orb bw-${sky.body}`} style={{ left: `${x}%`, top: `${y}%` }}/></div>
    <div>
      <b className="kp-numeral">Day {day + 1}</b>
      <span>{PHASE_LABEL[phase]} · <em data-soon={next.label === 'Nightfall' && next.minutes <= 2}>{next.label} in {next.minutes} min</em></span>
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
  return <li className="bw-card" data-status={status} data-nether={inNether(player.x, player.z)} style={{ '--player': player.color, '--len': player.name.length } as CSSProperties}>
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
  const online = view.players.filter(player => !(player.flags & PF.OFFLINE));
  // Up to five players get a bottom row of cards; bigger rosters get a slim side column so the spectator shot stays clear.
  return <div className="bw-tv" data-phase={dayPhase(view.time)} data-compact={view.players.length > 5}>
    <header className="bw-tv-top">
      <DayClock time={view.time} day={view.day}/>
      <div className="bw-tv-world">
        <WorldStats view={view}/>
        <span className="bw-tv-meta">{view.mode === 'creative' ? 'Creative' : `Survival · ${view.difficulty}`} · seed {view.seed}</span>
      </div>
    </header>
    {!online.length && <p className="bw-tv-hint kp-hud-text">Everyone stepped away. Rejoin on your phone with the room code to keep building.</p>}
    {view.sleeping > 0 && <p className="bw-tv-hint kp-hud-text">{view.sleeping} of {online.length} asleep. Everyone in bed skips the night.</p>}
    <ul className="bw-cards" style={{ '--cols': Math.max(1, Math.min(5, view.players.length)) } as CSSProperties} aria-label="Explorers">{view.players.map(player => <PlayerCard key={player.id} player={player}/>)}</ul>
  </div>;
}
