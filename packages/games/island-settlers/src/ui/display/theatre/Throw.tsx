/**
 * The roll, centre stage: big dice drop onto the middle of the board, the total pops beside them, then
 * they shrink into the dice chip while the cards start to fly. The chip keeps the result afterwards.
 * Also the horn's banner. Both are driven by the theatre's beat clock, like every other overlay.
 */
import type { CSSProperties } from 'react';
import type { PublicView, RollEvent } from '../../../model';
import type { Rect } from '../../shared/layout';
import { Icon } from '../../shared/icons';
import { ROLL_MS } from '../../shared/timeline';
import { EventFace, Face, type Tone } from './Dice';
import { clamp01, EASE, hash } from './motion';
import { rollTone } from './payout';
import { HORN_MS, lastRollBeat, type Beat } from './plan';

/** ms after the roll: the dice land at ROLL_MS.land, rest until `leave`, and are in the chip by `gone`. */
const THROW = { leave: 800, gone: 1120, swap: 55 } as const;

type Props = { pub: PublicView; beats: Beat[]; now: number; reduced: boolean; u: number; board: Rect; chip: Rect };
const centre = (r: Rect, u: number) => ({ x: (r.left + r.width / 2) * u, y: (r.top + r.height / 2) * u });

export function DiceThrow({ pub, beats, now, reduced, u, board, chip }: Props) {
  const beat = lastRollBeat(beats), t = beat ? now - beat.start : -1;
  if (!beat || reduced || t < 0 || t >= THROW.gone) return null;
  const roll = beat.event as RollEvent, ck = pub.settings.citiesKnights || roll.eventDie !== null;
  const tones: Tone[] = ck ? ['red', 'yellow'] : ['cream', 'cream'];
  const from = centre(board, u), to = centre(chip, u), fly = EASE.inOut(clamp01((t - THROW.leave) / (THROW.gone - THROW.leave)));
  const drop = clamp01(t / ROLL_MS.land), fall = (1 - EASE.back(drop, 1.2)) * -300 * u;
  const squash = t < ROLL_MS.land ? 1 : 0.86 + 0.14 * EASE.out(clamp01((t - ROLL_MS.land) / 140));
  const x = from.x + (to.x - from.x) * fly, y = from.y + (to.y - from.y) * fly + fall;
  const scale = 1 - 0.62 * fly, pop = clamp01((t - ROLL_MS.land) / 260);
  const face = (value: number, i: number) =>
    (t < ROLL_MS.land ? 1 + Math.floor(hash(roll.id * 13 + i, Math.floor(t / THROW.swap)) * 6) : value);
  const spin = (i: number) => (1 - EASE.out(drop)) * (i % 2 ? -420 : 520);
  return <div className="island-settlers-throw" aria-hidden="true" style={{
    transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`, opacity: 1 - fly * fly,
  }}>
    {roll.dice.map((value, i) => <span key={i} className="island-settlers-throw-die"
      style={{ transform: `rotate(${spin(i)}deg) scaleY(${squash})` }}><Face value={face(value, i)} tone={tones[i]}/></span>)}
    {ck && roll.eventDie && <span className="island-settlers-throw-die"
      style={{ transform: `rotate(${spin(2)}deg) scaleY(${squash})` }}><EventFace face={roll.eventDie}/></span>}
    <b className="island-settlers-throw-total kp-numeral" data-tone={rollTone(roll.total)}
      style={{ transform: `scale(${t < ROLL_MS.land ? 0 : 0.5 + 0.5 * EASE.back(pop, 2.8)})` }}>
      {roll.total}{roll.total === 7 && <Icon name="robber" className="island-settlers-total-robber"/>}</b>
  </div>;
}

/** "The horn!" sweeps across the top of the board when most of the table is done. */
export function HornBanner({ beats, now, reduced, u, board }: Omit<Props, 'pub' | 'chip'>) {
  const beat = beats.filter(b => b.event.kind === 'horn').sort((a, b) => b.event.id - a.event.id)[0];
  const t = beat ? now - beat.start : -1;
  if (!beat || beat.event.kind !== 'horn' || t < 0 || t >= HORN_MS) return null;
  const enter = reduced ? 1 : EASE.back(clamp01(t / 360), 1.4), leave = reduced ? 0 : clamp01((t - HORN_MS + 300) / 300);
  const style: CSSProperties = {
    left: (board.left + board.width / 2) * u, top: (board.top + 96) * u, opacity: 1 - leave,
    transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * enter})`,
  };
  return <p className="island-settlers-horn" role="status" style={style}>
    <b>The horn!</b><span>{beat.event.seconds} seconds to finish</span></p>;
}
