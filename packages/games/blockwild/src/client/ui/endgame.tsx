/** The endgame's HUD and TV pieces: the Ender Dragon's boss bar and the once-per-world victory celebration. */
import { useEffect, useState, type CSSProperties } from 'react';
import { I } from '../../shared/items';
import type { BossView, View } from '../../shared/protocol';
import { awards } from './format';
import { ItemIcon, spriteUrl } from './icons';

/** "3 crystals heal it", "1 crystal heals it", "No crystals left". */
export const crystalText = (crystals: number) => crystals > 0 ? `${crystals} crystal${crystals === 1 ? ' heals' : 's heal'} it` : 'No crystals left';

/** MC-style purple boss bar: name, notched health bar, health numbers and the crystals still healing the dragon. */
export function BossBar({ boss }: { boss: BossView }) {
  const health = Math.max(0, Math.ceil(boss.health)), fill = Math.min(1, health / Math.max(1, boss.max));
  return <div className="bw-boss" role="meter" aria-label={boss.name} aria-valuemin={0} aria-valuemax={boss.max} aria-valuenow={health}
    aria-valuetext={`${health} of ${boss.max} health, ${crystalText(boss.crystals).toLowerCase()}`}>
    <div className="bw-boss-head"><b>{boss.name}</b><span className="kp-numeral">{health} / {boss.max}</span></div>
    <div className="bw-boss-bar" style={{ '--fill': fill } as CSSProperties}><i/></div>
    <small className="bw-boss-crystals" data-none={boss.crystals === 0}><ItemIcon id={I.end_crystal}/>{crystalText(boss.crystals)}</small>
  </div>;
}

/** Celebrated world ids, newest last (one key per device; a world celebrates once). */
export const VICTORY_KEY = 'blockwild.victories';
export function parseCelebrated(raw: string | null): string[] {
  try {
    const list: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}
/** True the first time this device sees `worldId` won; records it (keeping the last 20 worlds). */
export function firstCelebration(worldId: string): boolean {
  try {
    const seen = parseCelebrated(localStorage.getItem(VICTORY_KEY));
    if (seen.includes(worldId)) return false;
    localStorage.setItem(VICTORY_KEY, JSON.stringify([...seen, worldId].slice(-20)));
  } catch { /* no storage: celebrate once per page load */ }
  return true;
}
/** Opens once when the world's victory first appears on this device; `close` dismisses it. */
export function useCelebration(view: View): { open: boolean; close(): void } {
  const [open, setOpen] = useState(false), won = !!view.victory;
  useEffect(() => { if (won && firstCelebration(view.worldId)) setOpen(true); }, [won, view.worldId]);
  return { open: open && won, close: () => setOpen(false) };
}

/** "Ann", "Ann and Bo", "Ann, Bo and Cy". */
export const nameList = (names: readonly string[]) => names.length < 2 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** The celebration's scrolling journal: world totals, then each explorer's highlights (awards once the journal is published). */
export function victoryJournal(view: View): { world: string[]; players: { id: string; name: string; color: string; titles: string[] }[] } {
  const { stats } = view, days = (view.victory?.day ?? view.day) + 1, by = view.victory?.by ?? [];
  const slayers = view.players.filter(player => by.includes(player.name)).map(player => player.id);
  const won = awards(view.journal ?? [], slayers);
  return {
    world: [`${plural(days, 'day')} from the first tree to the last blow`, `${plural(stats.mined, 'block')} mined, ${stats.placed.toLocaleString()} placed`,
      `${plural(stats.crafted, 'thing')} crafted`, `${plural(stats.mobs, 'mob')} defeated`, stats.deaths ? `${plural(stats.deaths, 'fall')} along the way` : 'Nobody fell along the way'],
    players: view.players.map(player => {
      const titles = won.filter(award => award.ids.includes(player.id)).map(award => award.title);
      return { id: player.id, name: player.name, color: player.color, titles: titles.length ? titles : [slayers.includes(player.id) ? 'Dragon slayer' : 'Explorer'] };
    }),
  };
}

/** Side view, head left: horns, a glowing eye, the raised wing and the long tail. */
const DRAGON = spriteUrl('victory-dragon', { colors: { '#': '#12071f', p: '#e08bff' }, rows: [
  '..................................#.........', '................................###.........', '..............................#####.........', '............................#######.........',
  '..........................#########.........', '........................##########..........', '......................###########...........', '..##.#..............############............',
  '.######............###.#.###.#.............', '#p######..........##........................', '#########........##.........................', '....#####.......###.........................',
  '.......####...###########...................', '........##################.....######.......', '..........##############################....', '...........#..#.......#..#............####..',
  '..........##.##......##.##..............###.',
] });
const SPARKS = Array.from({ length: 22 }, (_, i) => ({ '--x': `${(i * 37) % 100}%`, '--d': `${(i * 0.61) % 5}s`, '--s': `${4 + (i % 3) * 2}px`, '--t': `${5 + (i % 4)}s` }) as CSSProperties);

/**
 * Victory celebration for players and the TV. Not modal: it sits in the game layer (the platform's Room menu stays
 * reachable above it) and Continue closes it. Pixel sparks drift up; reduced motion keeps everything still.
 */
export function Celebration({ view, onClose }: { view: View; onClose(): void }) {
  const victory = view.victory, journal = victoryJournal(view);
  if (!victory) return null;
  return <section className="bw-victory" role="dialog" aria-labelledby="bw-victory-title">
    <div className="bw-victory-sparks" aria-hidden="true">{SPARKS.map((style, i) => <i key={i} style={style}/>)}</div>
    <div className="bw-victory-card">
      <img className="bw-victory-dragon bw-sprite" src={DRAGON} alt=""/>
      <p className="bw-victory-eyebrow">Victory · day {victory.day + 1}</p>
      <h2 id="bw-victory-title">The Ender Dragon has been defeated!</h2>
      <p className="bw-victory-by">{victory.by.length ? <>Final blows by <b>{nameList(victory.by)}</b></> : 'The whole party brought it down'}</p>
      <div className="bw-victory-journal" tabIndex={0} aria-label="World journal">
        {/* Two copies roll by half their height, so the loop is seamless and the box is never empty. */}
        <ol className="bw-victory-roll" style={{ '--n': journal.world.length + journal.players.length } as CSSProperties}>
          {[0, 1].map(copy => [
            ...journal.world.map(line => <li key={`${copy}${line}`} aria-hidden={copy === 1 || undefined}>{line}</li>),
            ...journal.players.map(player => <li key={`${copy}${player.id}`} aria-hidden={copy === 1 || undefined} className="bw-victory-player" style={{ '--player': player.color } as CSSProperties}>
              <b>{player.name}</b>{player.titles.map(title => <span key={title} className="bw-award">{title}</span>)}
            </li>),
          ])}
        </ol>
      </div>
      <button type="button" className="bw-resume" autoFocus onClick={onClose}>Continue</button>
      <small className="bw-victory-note">The world goes on. The exit portal in the middle of the island leads home.</small>
    </div>
  </section>;
}
