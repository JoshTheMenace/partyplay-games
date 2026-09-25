/**
 * Barbarian Attack + Cities & Knights (official combination): guards are C&K knights. Recruit a basic
 * knight on an empty castle edge (wool + ore), activate it (grain), promote it (wool + ore; mighty
 * needs politics 3), at most two per level. Each city improvement lands one barbarian (read from the
 * C&K public projection, so this module never reaches into C&K internals).
 */
import type { CitiesKnightsPublic, Command, SeatId } from '../../../model';
import { choice, command, pickField } from '../../commands';
import { emit } from '../../events';
import { need } from '../../need';
import { updateUnit } from '../../pieces';
import { seatName, type State } from '../../state';
import { mayBuild } from '../deliveries/gold';
import { moduleById, type Answer } from '../registry';
import { ba, invade, invaded } from './coast';
import { around, guards, guardsLeft, levelCount, placeGuard } from './guards';
import { knightSpots } from './cards';

const ckPublic = (s: State) =>
  moduleById('cities-knights')?.publicView?.(s) as CitiesKnightsPublic | undefined;
const improvements = (p: CitiesKnightsPublic | undefined, seat: SeatId) =>
  Object.values(p?.seats[seat]?.improvements ?? {}).reduce((a, b) => a + b, 0);

/** One landing roll per city improvement built since the last check. */
export function landForImprovements(s: State) {
  const pub = s.modules.includes('cities-knights') ? ckPublic(s) : undefined;
  if (!pub) return;
  for (const id of s.order) {
    const now = improvements(pub, id), before = ba(s).improvements[id] ?? 0;
    if (now > before) invade(s, now - before, `${seatName(s, id)}'s improvement`);
    ba(s).improvements[id] = now;
  }
}

/** Guards next to invaded hexes are worth activating first. */
const threatened = (s: State, seat: SeatId) =>
  new Set(invaded(s).flatMap(t => around(s, guards(s, seat), t).map(g => g.id)));

export function ckCommands(s: State, seat: SeatId): Command[] {
  if (!mayBuild(s, seat)) return [];
  const mine = guards(s, seat), hot = threatened(s, seat), out: Command[] = [];
  const base = { module: 'barbarian-attack' as const, group: 'knights' as const };
  const spots = knightSpots(s, seat, false);
  if (spots.length && guardsLeft(s, seat) > 0 && levelCount(s, seat, 1) < 2) {
    out.push(command({
      ...base, id: 'ba-recruit', label: 'Recruit a castle knight', cost: { wool: 1, ore: 1 },
      detail: 'A basic knight on an empty castle edge.',
      hint: mine.length < 2 && invaded(s).length ? 0.78 : 0.4,
      fields: [pickField('edge', 'Castle edge', spots.map(e => choice(e, 'Castle edge')), 'edge')],
    }));
  }
  const idle = mine.filter(g => !g.active).sort((a, b) => Number(hot.has(b.id)) - Number(hot.has(a.id)));
  if (idle.length) {
    out.push(command({
      ...base, id: 'ba-activate', label: 'Activate a knight', cost: { grain: 1 },
      hint: hot.has(idle[0].id) ? 0.8 : 0.2,
      detail: 'Active knights fight at the end of your turn.',
      fields: [pickField('guard', 'Knight', idle.map(g => choice(g.id, `Knight ${g.level}`)), 'unit')],
    }));
  }
  const politics = ckPublic(s)?.seats[seat]?.improvements.politics ?? 0;
  const up = mine.filter(g => g.level < 3 && (g.level === 1 || politics >= 3)
    && !ba(s).promoted.includes(g.id) && levelCount(s, seat, g.level + 1) < 2);
  if (up.length) {
    out.push(command({
      ...base, id: 'ba-promote', label: 'Promote a knight', cost: { wool: 1, ore: 1 }, hint: 0.4,
      detail: 'One level stronger (mighty needs politics 3).',
      fields: [pickField('guard', 'Knight', up.map(g => choice(g.id, `Knight ${g.level}`)), 'unit')],
    }));
  }
  return out;
}

export function ckApply(s: State, seat: SeatId, id: string, a: Answer) {
  if (id === 'ba-recruit') return placeGuard(s, seat, a.picks.edge, false);
  const g = s.pieces.units[a.picks.guard];
  need(g?.seat === seat, 'That knight is not yours.');
  if (id === 'ba-activate') updateUnit(s, g.id, { active: true });
  if (id === 'ba-promote') { updateUnit(s, g.id, { level: g.level + 1 }); ba(s).promoted.push(g.id); }
  const text = `${seatName(s, seat)} ${id === 'ba-activate' ? 'activated' : 'promoted'} a knight`;
  emit(s, { kind: 'module', module: 'barbarian-attack', name: id.slice(3), seat, target: g.at, text });
}
