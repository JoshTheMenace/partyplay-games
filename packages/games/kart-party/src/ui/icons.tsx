/* Original inline SVG item art (64×64, flat fills + ink outline so it reads at 24px on a phone and on a TV). */
import type { ReactNode } from 'react';
import type { ItemId, RacerView } from '../sim/types';

export const ITEM_NAMES: Record<ItemId, string> = {
  nitro: 'Nitro', 'triple-nitro': 'Triple Nitro', peel: 'Peel', bouncer: 'Bouncer', seeker: 'Seeker', shield: 'Bubble',
  super: 'Super Star', thunder: 'Thunder', comet: 'Comet', ink: 'Ink', bomb: 'Boom Bomb',
};
/** Items the player can hold behind the kart (hold ITEM, release to deploy). */
export const HOLDABLE: readonly ItemId[] = ['peel', 'bouncer', 'seeker'];
/** Order the roulette strip cycles through. */
export const ROULETTE: readonly ItemId[] = ['nitro', 'peel', 'bouncer', 'shield', 'seeker', 'bomb', 'ink', 'super', 'comet', 'thunder'];

const O = { stroke: '#05071a', strokeWidth: 3, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
const bottle = (x: number, y: number, s: number) => <g transform={`translate(${x} ${y}) scale(${s})`}>
  <rect x="-7" y="-26" width="14" height="10" rx="3" fill="#dfe4ff" {...O}/>
  <rect x="-13" y="-18" width="26" height="42" rx="9" fill="#28c6e7" {...O}/>
  <rect x="-13" y="-4" width="26" height="15" fill="#fff6e5" {...O}/>
  <path d="M0 -2c4 3 5 6 2 10-1-3-3-3-3-6-2 2-3 4-1 6-4-2-3-7 2-10z" fill="#ff5748"/>
  <rect x="-9" y="-14" width="4" height="8" rx="2" fill="#fff" opacity=".7"/>
</g>;
const shell = (fill: string, dark: string, extra?: ReactNode) => <>
  <ellipse cx="32" cy="45" rx="23" ry="9" fill="#fff6e5" {...O}/>
  <path d="M9 44c0-17 10-30 23-30s23 13 23 30c-6 4-14 5-23 5s-17-1-23-5z" fill={fill} {...O}/>
  <path d="M24 22l8-4 8 4v9l-8 4-8-4z" fill={dark} opacity=".55"/>
  <path d="M15 34c1-7 5-13 10-16" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" fill="none" opacity=".75"/>
  {extra}
</>;
const ART: Record<ItemId, ReactNode> = {
  nitro: bottle(32, 34, 1),
  'triple-nitro': <>{bottle(17, 38, .72)}{bottle(47, 38, .72)}{bottle(32, 30, .8)}</>,
  peel: <>
    <ellipse cx="32" cy="56" rx="26" ry="4.5" fill="#05071a" opacity=".3"/>
    <path d="M27 38c-10-4-19 2-22 16 5-2 11-3 17-3 3-3 6-7 7-11z" fill="#ffd24a" {...O}/>
    <path d="M37 38c10-4 19 2 22 16-5-2-11-3-17-3-3-3-6-7-7-11z" fill="#ffd24a" {...O}/>
    <path d="M23 50c-2-13 1-27 12-38 3-2 6 0 5 3-6 10-2 23-1 35-5 3-11 3-16 0z" fill="#ffe27a" {...O}/>
    <path d="M26 45c1 6 3 10 6 13 3-3 5-7 6-13-4 2-8 2-12 0z" fill="#fff1a8" {...O}/>
    <path d="M35 12l3-6 3 2-2 6z" fill="#6b4226" {...O}/>
    <path d="M30 22c-3 7-4 14-3 21" stroke="#fff8d6" strokeWidth="3" strokeLinecap="round" fill="none"/>
    <circle cx="35" cy="30" r="1.6" fill="#8a5a3c"/><circle cx="33" cy="38" r="1.2" fill="#8a5a3c"/><circle cx="14" cy="47" r="1.3" fill="#8a5a3c"/>
  </>,
  bouncer: shell('#78d955', '#2f8f3a', <path d="M6 20l6 3M4 30l7 1M58 20l-6 3M60 30l-7 1" {...O} fill="none"/>),
  seeker: shell('#ff5748', '#9c1f22', <>
    <path d="M9 40L2 30l10 2zM55 40l7-10-10 2z" fill="#ffd24a" {...O}/>
    <circle cx="32" cy="27" r="6" fill="#fff6e5" {...O}/><circle cx="32" cy="27" r="2" fill="#05071a"/>
  </>),
  shield: <>
    <circle cx="32" cy="33" r="23" fill="#9fe8ff" fillOpacity=".4" stroke="#28c6e7" strokeWidth="5"/>
    <circle cx="32" cy="33" r="15" fill="#e8fbff" fillOpacity=".25"/>
    <circle cx="32" cy="33" r="25.5" fill="none" stroke="#05071a" strokeWidth="2.5"/>
    <path d="M17 26a17 17 0 0 1 13-11" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" fill="none"/>
    <circle cx="44" cy="44" r="3" fill="#fff" opacity=".8"/>
  </>,
  super: <>
    <path d="M32 5l7.6 16.4 17.9 2.1-13.2 12.2 3.5 17.7L32 44.6l-15.8 8.8 3.5-17.7L6.5 23.5l17.9-2.1z" fill="#ffd24a" {...O}/>
    <path d="M32 14l4.6 10 10.9 1.3-8 7.4 2.1 10.7L32 38l-9.6 5.4 2.1-10.7-8-7.4 10.9-1.3z" fill="#fff1a8"/>
    <ellipse cx="27.5" cy="29" rx="2.2" ry="3.6" fill="#05071a"/><ellipse cx="36.5" cy="29" rx="2.2" ry="3.6" fill="#05071a"/>
    <circle cx="8" cy="54" r="3" fill="#ff5748"/><circle cx="56" cy="54" r="3" fill="#28c6e7"/><circle cx="56" cy="8" r="2.5" fill="#78d955"/><circle cx="9" cy="9" r="2.5" fill="#b58aff"/>
  </>,
  thunder: <>
    <path d="M14 30a10 10 0 0 1 4-19 13 13 0 0 1 24-2 9 9 0 0 1 10 12 8 8 0 0 1-3 15H18a9 9 0 0 1-4-6z" fill="#8f97c9" {...O}/>
    <path d="M36 22L22 42h9l-5 17 17-23h-9l6-14z" fill="#ffd24a" {...O}/>
  </>,
  comet: <>
    <path d="M40 38L6 8M36 44L4 24M44 32L22 4" stroke="#b58aff" strokeWidth="7" strokeLinecap="round"/>
    <path d="M40 38L10 12M36 44L10 28M44 32L25 9" stroke="#fff6e5" strokeWidth="2.5" strokeLinecap="round"/>
    <circle cx="43" cy="42" r="15" fill="#28c6e7" {...O}/>
    <circle cx="43" cy="42" r="8" fill="#bff3ff"/><circle cx="38" cy="37" r="3" fill="#fff"/>
  </>,
  ink: <>
    <path d="M32 7c9 0 12 9 20 10 7 1 7 11 1 14 5 5 3 14-5 13-2 8-11 12-17 6-7 5-17 1-16-8-8-2-9-12-2-15-5-6 0-15 8-13 1-5 5-7 11-7z" fill="#7b4dff" {...O}/>
    <circle cx="54" cy="50" r="4" fill="#7b4dff" {...O}/><circle cx="10" cy="52" r="3" fill="#7b4dff" {...O}/>
    <ellipse cx="26" cy="22" rx="5" ry="3" fill="#fff" opacity=".6" transform="rotate(-25 26 22)"/>
  </>,
  bomb: <>
    <path d="M38 20q4-10 12-9" stroke="#8a5a3c" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
    <path d="M52 3l2 5 5-1-3 4 4 3-5 1 0 5-3-4-4 3 1-5-5-2 5-2z" fill="#ffd24a" stroke="#ff5748" strokeWidth="1.5" strokeLinejoin="round"/>
    <rect x="30" y="16" width="12" height="9" rx="2" transform="rotate(25 36 20)" fill="#5d6594" {...O}/>
    <circle cx="29" cy="39" r="19" fill="#2a2f55" {...O}/>
    <path d="M17 34a13 13 0 0 1 9-10" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" opacity=".6"/>
  </>,
};

export function ItemIcon({ item, size = '100%', title }: { item: ItemId; size?: number | string; title?: string }) {
  return <svg className="kp2-icon" viewBox="0 0 64 64" width={size} height={size} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">{ART[item]}</svg>;
}
/** Cycling item strip for the roulette; the animation is pure CSS (disabled under reduced motion). */
export function Roulette() {
  return <span className="kp2-roulette" aria-label="Rolling an item" role="img">
    <span className="kp2-roulette-strip" aria-hidden="true">{[...ROULETTE, ROULETTE[0]].map((item, i) => <ItemIcon key={i} item={item}/>)}</span>
  </span>;
}
/** What an item slot shows for a racer: roulette while rolling, the item (with a count for multi-use), or nothing. */
export function ItemFace({ racer }: { racer: Pick<RacerView, 'item' | 'itemCount' | 'rollT' | 'trailing'> }) {
  if (racer.rollT > 0) return <Roulette/>;
  if (!racer.item) return null;
  return <><ItemIcon item={racer.item} title={ITEM_NAMES[racer.item]}/>{racer.itemCount > 1 && <b className="kp2-item-count kp-numeral">×{racer.itemCount}</b>}</>;
}
