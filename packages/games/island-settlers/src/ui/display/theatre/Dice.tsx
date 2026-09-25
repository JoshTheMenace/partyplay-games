/**
 * The dice chip (EXPERIENCE §3.6): DOM dice that tumble for 450 ms, squash onto their true faces,
 * then the total pops. Two dice at 60u, or yellow + red + event die at 52u in Cities & Knights.
 */
import type { CSSProperties } from 'react';
import type { EventDie, PublicView, RollEvent } from '../../../model';
import { Icon } from '../../shared/icons';
import { TRACK_META } from '../../shared/labels';
import { ROLL_MS } from '../../shared/timeline';
import { clamp01, EASE, hash } from './motion';
import { lastRollBeat } from './plan';
import { rollTone } from './payout';
import { useTheatre } from './store';

const PIPS: Record<number, [number, number][]> = {
  1: [[12, 12]], 2: [[7, 7], [17, 17]], 3: [[7, 7], [12, 12], [17, 17]],
  4: [[7, 7], [17, 7], [7, 17], [17, 17]], 5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]],
  6: [[7, 6.5], [17, 6.5], [7, 12], [17, 12], [7, 17.5], [17, 17.5]],
};
const TONES = {
  cream: { fill: '#fff6e5', pip: '#05071a' }, red: { fill: '#d8352e', pip: '#fff6e5' },
  yellow: { fill: '#ffd23a', pip: '#05071a' },
} as const;
type Tone = keyof typeof TONES;
const TUMBLE_SWAP = 60, SQUASH = 120, POP = 260;

function Face({ value, tone }: { value: number; tone: Tone }) {
  const { fill, pip } = TONES[tone];
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="1.2" y="1.2" width="21.6" height="21.6" rx="5" fill={fill} stroke="#05071a" strokeWidth="1.4"/>
    {(PIPS[value] ?? []).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.2" fill={pip}/>)}
  </svg>;
}

/** C&K event die: a black ship or a gate in the track colour. */
function EventFace({ face }: { face: EventDie }) {
  const fill = face === 'ship' ? '#1b1f3b' : TRACK_META[face].color;
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="1.2" y="1.2" width="21.6" height="21.6" rx="5" fill={fill} stroke="#05071a" strokeWidth="1.4"/>
    <g transform="translate(5 5) scale(0.58)" fill={face === 'ship' ? '#fff6e5' : '#05071a'}>
      <path d={face === 'ship' ? 'M2 15h20l-3.2 6H5.2ZM11 2v11.5H3.8ZM12.6 4.5l6.8 9h-6.8Z'
        : 'M3 22V9l9-7 9 7v13h-6v-7a3 3 0 0 0-6 0v7Z'}/>
    </g>
  </svg>;
}

/** Transform of die i at t ms into the roll (null: at rest). */
function tumble(t: number, i: number): string | null {
  if (t < ROLL_MS.land) {
    const p = t / ROLL_MS.land, turn = 25 * Math.sin(p * Math.PI * 3) * (i % 2 ? -1 : 1);
    return `rotate(${turn}deg) scale(${1 + 0.12 * Math.sin(p * Math.PI)})`;
  }
  const squash = (t - ROLL_MS.land) / SQUASH;
  return squash < 1 ? `scaleY(${0.88 + 0.12 * EASE.out(squash)})` : null;
}

const describe = (roll: RollEvent) =>
  `Rolled ${roll.total}: ${roll.dice.join(' and ')}${roll.eventDie ? `, event die ${roll.eventDie}` : ''}`;

export function DiceChip({ pub, reduced }: { pub: PublicView; reduced: boolean }) {
  const { beats, now } = useTheatre();
  const beat = lastRollBeat(beats), live = beat && (!pub.lastRoll || beat.event.id >= pub.lastRoll.id);
  const roll = (live ? beat.event : pub.lastRoll) as RollEvent | null;
  if (!roll) return null;
  const t = live && !reduced ? Math.max(0, now - beat.start) : Infinity;
  const ck = pub.settings.citiesKnights || roll.eventDie !== null;
  const tones: Tone[] = ck ? ['red', 'yellow'] : ['cream', 'cream'];
  const face = (value: number, i: number) =>
    t < ROLL_MS.land ? 1 + Math.floor(hash(roll.id * 7 + i, Math.floor(t / TUMBLE_SWAP)) * 6) : value;
  const pop = reduced ? clamp01((now - (beat?.start ?? 0)) / 120) : clamp01((t - ROLL_MS.land) / POP);
  const total: CSSProperties = t < ROLL_MS.land ? { opacity: 0 }
    : reduced ? { opacity: live ? pop : 1 } : { transform: `scale(${0.6 + 0.4 * EASE.back(pop, 2.6)})` };
  return <div className="island-settlers-dice" data-ck={ck || undefined} role="img" aria-label={describe(roll)}>
    {roll.dice.map((value, i) => <span key={i} className="island-settlers-die"
      style={{ transform: tumble(t, i) ?? undefined }}><Face value={face(value, i)} tone={tones[i]}/></span>)}
    {ck && roll.eventDie && <span className="island-settlers-die"
      style={{ transform: tumble(t, 2) ?? undefined }}><EventFace face={roll.eventDie}/></span>}
    <b className="island-settlers-total kp-numeral" data-tone={rollTone(roll.total)} style={total}>
      {roll.total}{roll.total === 7 && <Icon name="robber" className="island-settlers-total-robber"/>}
    </b>
  </div>;
}
