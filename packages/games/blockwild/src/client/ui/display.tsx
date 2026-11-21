/** DisplayView: the TV overlay above the cinematic spectator scene (day clock, world stats, player cards). */
import { useEffect, type CSSProperties } from 'react';
import type { GameViewProps } from '../../../../../party-ui/src/index';
import { dimensionAt } from '../../shared/constants';
import { feed, readRoster, type RosterPlayer } from '../game/feed';
import { hud } from '../game/hud';
import { B, I, itemName } from '../../shared/items';
import { PF, type Action, type Input, type PrivateView, type View } from '../../shared/protocol';
import { BossBar, Celebration, useCelebration } from './endgame';
import { dayPhase, meterIcons, PHASE_LABEL, playerStatus, skyAngle, untilChange } from './format';
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

/** A full card: what the player holds, hearts, armor and what they are up to. `eyebrow` labels the spotlight card. */
function PlayerCard({ player, eyebrow }: { player: RosterPlayer; eyebrow?: string }) {
  const status = playerStatus(player), hearts = meterIcons(player.health);
  return <li className="bw-card" data-status={status} data-dim={dimensionAt(player.x, player.z)} style={{ '--player': player.color, '--len': player.name.length } as CSSProperties}>
    <span className="bw-card-held" title={player.held ? itemName(player.held) : 'Empty hand'}>{player.held ? <ItemIcon id={player.held}/> : <span className="bw-hand" aria-hidden="true"/>}</span>
    <div className="bw-card-body">
      <b className="bw-card-name" title={player.name}>{eyebrow && <small>{eyebrow}</small>}{player.name}</b>
      <span className="bw-card-hearts" role="img" aria-label={`${Math.ceil(player.health) / 2} of 10 hearts`}>{hearts.map((fill, i) => <MeterSprite key={i} kind="heart" fill={fill}/>)}</span>
      {player.armor > 0 && <span className="bw-card-armor" role="img" aria-label={`Armor ${player.armor}`}><MeterSprite kind="armor" fill="full"/>{player.armor}</span>}
    </div>
    <span className="bw-card-status">{status}</span>
  </li>;
}
/** One line of the crowd wall: seat colour, the whole name and hearts as a number, tinted by what the player is doing. */
function PlayerChip({ player, followed }: { player: RosterPlayer; followed: boolean }) {
  const status = playerStatus(player), hearts = Math.ceil(player.health / 2);
  return <li className="bw-chip-player" data-status={status} data-dim={dimensionAt(player.x, player.z)} data-followed={followed} style={{ '--player': player.color } as CSSProperties}
    aria-label={`${player.name}: ${status}, ${hearts} of 10 hearts`}>
    <i aria-hidden="true"/><b>{player.name}</b><span aria-hidden="true"><MeterSprite kind="heart" fill={hearts > 0 ? 'full' : 'empty'}/>{hearts}</span>
  </li>;
}

/** Rosters up to five get a bottom row of cards, up to twelve a slim side column, and a crowd a wall of chips. */
const density = (players: number) => players <= 5 ? 'row' : players <= 12 ? 'column' : 'crowd';

export function DisplayView({ publicView: view }: GameViewProps<Input, Action, View, PrivateView>) {
  const roster = useStore(feed, s => s.roster), online = roster.filter(player => !(player.flags & PF.OFFLINE)), party = useCelebration(view);
  // The boss bar shows while the camera follows someone in the End.
  const focus = useStore(hud, s => s.focus), subject = roster.find(player => player.id === focus);
  const inEnd = !!subject && dimensionAt(subject.x, subject.z) === 'end', boss = inEnd ? view.boss : undefined;
  // Nobody may be near the TV to press Continue, so its celebration also ends by itself.
  useEffect(() => {
    if (!party.open) return;
    const timer = setTimeout(party.close, 25_000);
    return () => clearTimeout(timer);
  }, [party.open]);
  // The scene keeps the roster fresh while it runs; this covers the moments before it mounts.
  useEffect(() => readRoster(view), [view.roster]);
  const layout = density(view.who.length), longest = Math.max(1, ...roster.map(player => player.name.length));
  return <div className="bw-tv" data-phase={dayPhase(view.time)} data-density={layout}>
    <header className="bw-tv-top">
      <DayClock time={view.time} day={view.day} end={inEnd}/>
      {boss && <BossBar boss={boss}/>}
      <div className="bw-tv-world">
        <WorldStats view={view}/>
        <span className="bw-tv-meta">{layout === 'crowd' && `${online.length}/${roster.length} exploring · `}{view.mode === 'creative' ? 'Creative' : `Survival · ${view.difficulty}`} · seed {view.seed}</span>
      </div>
    </header>
    {roster.length > 0 && !online.length && <p className="bw-tv-hint kp-hud-text">Everyone stepped away. Rejoin on your phone with the room code to keep building.</p>}
    {view.sleeping > 0 && <p className="bw-tv-hint kp-hud-text">{view.sleeping} of the {view.sleepNeed} needed are asleep. {view.sleepNeed === online.length ? 'Everyone in bed skips the night.' : 'Half the camp in bed skips the night.'}</p>}
    {layout === 'crowd'
      ? <>
        {subject && <ul className="bw-spotlight" aria-label="On camera"><PlayerCard player={subject} eyebrow="On camera"/></ul>}
        <ul className="bw-wall" style={{ '--len': longest, '--n': roster.length } as CSSProperties} aria-label="Explorers">{roster.map(player => <PlayerChip key={player.id} player={player} followed={player.id === focus}/>)}</ul>
      </>
      : <ul className="bw-cards" style={{ '--cols': Math.max(1, Math.min(5, roster.length)) } as CSSProperties} aria-label="Explorers">{roster.map(player => <PlayerCard key={player.id} player={player}/>)}</ul>}
    {party.open && <Celebration view={view} onClose={party.close}/>}
  </div>;
}
