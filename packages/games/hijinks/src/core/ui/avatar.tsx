/* The sixteen Hijinks characters: original SVG critters tinted by player colour, with five moods. */
import type { CSSProperties, ReactNode } from 'react';
import type { PackPlayer } from '../contract';

export type Mood = 'idle' | 'happy' | 'sad' | 'thinking' | 'done';
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
const SIZES = { xs: 32, sm: 48, md: 72, lg: 112, xl: 168 } as const;
export const avatarPx = (size: AvatarSize) => typeof size === 'number' ? size : SIZES[size];
type FaceSpec = { x: number; y: number; s?: number; gap?: number; mouthY?: number; mouth?: boolean; one?: boolean };

function Eye({ cx, mood, one }: { cx: number; mood: Mood; one: boolean }) {
  const r = one ? 1.8 : 1, line = (d: string) => <path className="hj-av-line" d={d} />;
  if (mood === 'happy') return line(`M${cx - 6 * r} 2Q${cx} ${-7 * r} ${cx + 6 * r} 2`);
  if (mood === 'done') return line(`M${cx - 6 * r} -1Q${cx} ${5 * r} ${cx + 6 * r} -1`);
  const look = mood === 'thinking' ? [2.5, -2.5] : mood === 'sad' ? [0, 2] : [0, 0];
  return <g>
    {one && <circle className="hj-av-white" cx={cx} cy={0} r={12} />}
    <ellipse className="hj-av-ink" cx={cx + look[0]! * r} cy={look[1]! * r} rx={5 * (one ? 1.15 : 1)} ry={(mood === 'sad' ? 5.4 : 6.5) * (one ? 1.15 : 1)} />
    <circle className="hj-av-glint" cx={cx + look[0]! * r - 1.6} cy={look[1]! * r - 2.4} r={1.8} />
    {mood === 'sad' && line(one ? 'M-12 -17Q0 -24 12 -17' : cx < 0 ? `M${cx - 6} -8L${cx + 5} -12` : `M${cx + 6} -8L${cx - 5} -12`)}
    {mood === 'thinking' && cx >= 0 && line(`M${cx - 5} ${one ? -18 : -12}L${cx + 6} ${one ? -21 : -15}`)}
  </g>;
}
const MOUTHS: Record<Mood, ReactNode> = {
  idle: <path className="hj-av-line" d="M-7 0Q0 6 7 0" />,
  happy: <g><path className="hj-av-ink" d="M-9 -2Q0 14 9 -2Z" /><ellipse className="hj-av-tongue" cx={0} cy={6} rx={4} ry={2.2} /></g>,
  sad: <path className="hj-av-line" d="M-7 6Q0 -1 7 6" />,
  thinking: <path className="hj-av-line" d="M-3 3Q2 1 6 3" />,
  done: <path className="hj-av-line" d="M-8 -1Q0 8 8 -1" />,
};
function Face({ mood, x, y, s = 1, gap = 14, mouthY = 10, mouth = true, one = false }: FaceSpec & { mood: Mood }) {
  return <g className="hj-av-face" transform={`translate(${x} ${y}) scale(${s * 1.12})`}>
    {mood !== 'sad' && mood !== 'thinking' && <g className="hj-av-cheek">{(one ? [-16, 16] : [-gap - 7, gap + 7]).map(cx => <ellipse key={cx} cx={cx} cy={mouthY - (one ? -2 : 1)} rx={5} ry={3.4} />)}</g>}
    {(one ? [0] : [-gap, gap]).map(cx => <Eye key={cx} cx={cx} mood={mood} one={one} />)}
    {mood === 'sad' && !one && <ellipse className="hj-av-tear" cx={-gap - 3} cy={9} rx={2.4} ry={3.6} />}
    {mouth && <g transform={`translate(0 ${mouthY + (one ? 8 : 0)})`}>{MOUTHS[mood]}</g>}
  </g>;
}
function star() {
  const point = (i: number, r: number) => { const a = -Math.PI / 2 + i * Math.PI / 5; return `${(60 + r * Math.cos(a)).toFixed(1)} ${(66 + r * Math.sin(a)).toFixed(1)}`; };
  let d = `M${point(-1, 30)}`;
  for (let i = 0; i < 10; i += 2) d += `Q${point(i, 66)} ${point(i + 1, 30)}`;
  return d + 'Z';
}
const mirror = (d: string) => <><path d={d} /><path d={d} transform="matrix(-1 0 0 1 120 0)" /></>;

/** Character art: name, body (drawn with hj-av-* classes) and face placement. Index = PackPlayer.avatar. */
export const CHARACTERS: { name: string; body: ReactNode; face: FaceSpec }[] = [
  { name: 'Gloop', face: { x: 60, y: 66 }, body: <><path className="hj-av-body" d="M60 16C90 16 104 52 104 80C104 100 88 108 60 108C32 108 16 100 16 80C16 52 30 16 60 16Z" /><path className="hj-av-hl" d="M36 40C40 30 48 25 56 24" /></> },
  { name: 'Bolt', face: { x: 60, y: 64, s: .85 }, body: <><path className="hj-av-line" d="M60 32V16" /><circle className="hj-av-sun" cx={60} cy={12} r={7} /><g className="hj-av-shade">{mirror('M24 54H14C12 54 10 56 10 58V76C10 78 12 80 14 80H24Z')}</g><rect className="hj-av-body" x={20} y={30} width={80} height={76} rx={16} /><rect className="hj-av-pale" x={30} y={42} width={60} height={46} rx={10} />{[[27, 37], [93, 37], [27, 99], [93, 99]].map(([cx, cy]) => <circle key={`${cx}${cy}`} className="hj-av-ink" cx={cx} cy={cy} r={2.4} />)}<path className="hj-av-line" d="M44 98H76" /></> },
  { name: 'Whisk', face: { x: 60, y: 68 }, body: <><path className="hj-av-body" d="M18 104C12 84 14 60 22 46L20 12L46 30C55 27 65 27 74 30L100 12L98 46C106 60 108 84 102 104Z" /><g className="hj-av-pale">{mirror('M27 24L28 41L40 32Z')}</g><g className="hj-av-whisker">{mirror('M12 72L32 75M12 83L32 81')}</g></> },
  { name: 'Boo', face: { x: 60, y: 54 }, body: <><path className="hj-av-body" d="M22 108V54C22 30 38 14 60 14C82 14 98 30 98 54V108L86 98L73 108L60 98L47 108L34 98Z" /><path className="hj-av-hl" d="M34 46C34 36 40 28 48 24" /></> },
  { name: 'Prickle', face: { x: 60, y: 52, s: .78, gap: 12 }, body: <><path className="hj-av-body" d="M40 66H26C20 66 16 62 16 56V38C16 32 26 32 26 38V54H40Z" /><path className="hj-av-body" d="M80 78H94C100 78 104 74 104 68V46C104 40 94 40 94 46V66H80Z" /><rect className="hj-av-body" x={36} y={18} width={48} height={90} rx={24} /><path className="hj-av-ridge" d="M49 82V102M71 82V102M60 86V104" /><circle className="hj-av-coral" cx={60} cy={15} r={7} /></> },
  { name: 'Squish', face: { x: 60, y: 54 }, body: <><path className="hj-av-body" d="M24 70C24 34 40 16 60 16C80 16 96 34 96 70C96 82 104 92 112 94C102 104 90 98 86 88C84 100 78 108 68 106C72 100 72 94 70 88C66 100 54 100 50 88C48 94 48 100 52 106C42 108 36 100 34 88C30 98 18 104 8 94C16 92 24 82 24 70Z" /><circle className="hj-av-pale" cx={42} cy={30} r={4} /><circle className="hj-av-pale" cx={80} cy={34} r={3} /></> },
  { name: 'Twinkle', face: { x: 60, y: 68, s: .82, gap: 12 }, body: <path className="hj-av-body" d={star()} /> },
  { name: 'Pip', face: { x: 60, y: 58, mouth: false }, body: <><path className="hj-av-shade" d="M20 72L4 60L8 84Z" /><path className="hj-av-body" d="M50 32C44 16 52 8 58 24C58 8 70 6 66 26C72 16 82 18 72 32Z" /><ellipse className="hj-av-body" cx={60} cy={68} rx={42} ry={40} /><ellipse className="hj-av-pale hj-av-flat" cx={62} cy={90} rx={24} ry={13} /><path className="hj-av-shade" d="M22 70C22 88 34 98 46 94C40 84 36 74 22 70Z" /><path className="hj-av-sun" d="M51 70H69L60 83Z" /></> },
  { name: 'Shroom', face: { x: 60, y: 82, s: .75, gap: 12 }, body: <><path className="hj-av-cream" d="M36 60H84V96C84 104 78 108 60 108C42 108 36 104 36 96Z" /><path className="hj-av-body" d="M8 58C8 28 32 10 60 10C88 10 112 28 112 58C112 66 104 68 96 66H24C16 68 8 66 8 58Z" /><circle className="hj-av-pale" cx={34} cy={36} r={7} /><circle className="hj-av-pale" cx={64} cy={22} r={6} /><circle className="hj-av-pale" cx={88} cy={42} r={8} /></> },
  { name: 'Puff', face: { x: 62, y: 74 }, body: <><path className="hj-av-body" d="M30 102C12 102 6 80 20 70C14 50 34 36 48 44C54 24 84 22 90 44C106 40 118 58 108 72C120 82 110 102 94 102Z" /><path className="hj-av-hl" d="M54 42C58 36 66 34 72 36" /></> },
  { name: 'Grumble', face: { x: 60, y: 58, one: true }, body: <><g className="hj-av-cream">{mirror('M30 40C18 30 16 14 24 6C28 18 36 26 46 30Z')}</g><path className="hj-av-body" d="M18 108V52C18 34 32 26 60 26C88 26 102 34 102 52V108Z" /><path className="hj-av-pale hj-av-flat" d="M38 108C38 96 48 92 60 92C72 92 82 96 82 108Z" /></> },
  { name: 'Hop', face: { x: 60, y: 76 }, body: <><g className="hj-av-body">{mirror('M38 50C28 30 28 6 38 4C48 2 52 30 50 48Z')}</g><g className="hj-av-pale hj-av-flat">{mirror('M40 40C35 28 35 14 39 12C43 12 45 28 45 40Z')}</g><ellipse className="hj-av-body" cx={60} cy={76} rx={40} ry={33} /></> },
  { name: 'Toasty', face: { x: 60, y: 64 }, body: <><path className="hj-av-body" d="M22 108V52C8 48 8 20 32 16C46 6 74 6 88 16C112 20 112 48 98 52V108Z" /><path className="hj-av-pale hj-av-flat" d="M32 100V48C20 44 22 26 38 26C50 18 70 18 82 26C98 26 100 44 88 48V100Z" /></> },
  { name: 'Zib', face: { x: 60, y: 60, gap: 18 }, body: <><path className="hj-av-line" d="M46 24L34 8M74 24L86 8" /><circle className="hj-av-sun" cx={34} cy={8} r={6} /><circle className="hj-av-sun" cx={86} cy={8} r={6} /><path className="hj-av-shade" d="M44 92H76L82 112H38Z" /><path className="hj-av-body" d="M60 20C92 20 108 40 106 60C104 84 80 100 60 100C40 100 16 84 14 60C12 40 28 20 60 20Z" /></> },
  { name: 'Ribbit', face: { x: 60, y: 44, s: .89, gap: 24, mouthY: 36 }, body: <><path className="hj-av-body" d="M10 92C10 64 30 52 60 52C90 52 110 64 110 92C110 106 92 110 60 110C28 110 10 106 10 92Z" /><ellipse className="hj-av-pale hj-av-flat" cx={60} cy={96} rx={30} ry={10} /><circle className="hj-av-body" cx={36} cy={44} r={17} /><circle className="hj-av-body" cx={84} cy={44} r={17} /></> },
  { name: 'Bao', face: { x: 60, y: 76 }, body: <><path className="hj-av-body" d="M12 94C12 62 32 38 60 22C88 38 108 62 108 94C108 106 90 110 60 110C30 110 12 106 12 94Z" /><path className="hj-av-ridge" d="M60 24C56 32 50 36 42 38M60 24C64 32 70 36 78 38M60 24V38" /></> },
];

const Crown = () => <svg className="hj-crown" viewBox="0 0 40 30" aria-hidden="true"><path d="M4 26L2 6L12 14L20 2L28 14L38 6L36 26Z" /><circle cx="20" cy="18" r="3" /></svg>;
const Check = () => <svg className="hj-av-check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" /><path d="M6.5 12.5L10.5 16.5L17.5 8" /></svg>;

/** One character. `avatar` is PackPlayer.avatar (0–15), `color` the player colour. Decorative unless `label` is given. */
export function Avatar({ avatar, color, mood = 'idle', size = 'md', crown, label, className = '' }: { avatar: number; color: string; mood?: Mood; size?: AvatarSize; crown?: boolean; label?: string; className?: string }) {
  const art = CHARACTERS[((avatar % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length]!, px = avatarPx(size);
  return <span className={`hj-avatar ${className}`} data-mood={mood} style={{ '--c': color, width: px, height: px } as CSSProperties} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <svg className="hj-av-art" viewBox="0 0 120 120"><ellipse className="hj-av-shadow" cx={60} cy={113} rx={36} ry={5} /><g className="hj-av-rig">{art.body}<Face mood={mood} {...art.face} /></g></svg>
    {crown && <Crown />}{mood === 'done' && <Check />}
  </span>;
}

type BadgePlayer = Pick<PackPlayer, 'name' | 'color' | 'avatar'> & { connected?: boolean };
/** Avatar plus full name (16-character names wrap at spaces, never truncate). `vip` adds the crown, `detail` a small line under the name. */
export function AvatarBadge({ player, mood, size = 'sm', vip, detail, layout = 'row', className = '' }: { player: BadgePlayer; mood?: Mood; size?: AvatarSize; vip?: boolean; detail?: ReactNode; layout?: 'row' | 'column'; className?: string }) {
  return <span className={`hj-badge hj-badge-${layout} ${className}`} data-offline={player.connected === false || undefined} style={{ '--c': player.color } as CSSProperties}>
    <Avatar avatar={player.avatar} color={player.color} mood={mood} size={size} crown={vip} />
    <span className="hj-badge-text"><b className="hj-name">{player.name}</b>{vip && <span className="hj-sr">, VIP</span>}{detail && <small>{detail}</small>}</span>
  </span>;
}

/** Overlapping avatars (voters, skippers…), newest last; shows +N past `max`. Labelled with every name for screen readers. */
export function AvatarStack({ players, size = 'sm', max = 8, mood = 'happy', className = '' }: { players: readonly PackPlayer[]; size?: AvatarSize; max?: number; mood?: Mood; className?: string }) {
  if (!players.length) return null;
  const shown = players.slice(0, players.length > max ? max - 1 : max);
  return <span className={`hj-stack ${className}`} role="img" aria-label={players.map(p => p.name).join(', ')} style={{ '--s': `${avatarPx(size)}px` } as CSSProperties}>
    {shown.map((p, i) => <span key={p.id} className="hj-stack-item" style={{ animationDelay: `${i * 70}ms` }}><Avatar avatar={p.avatar} color={p.color} mood={mood} size={size} /></span>)}
    {players.length > shown.length && <span className="hj-stack-more kp-numeral">+{players.length - shown.length}</span>}
  </span>;
}
