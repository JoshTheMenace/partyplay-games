/**
 * Cities & Knights: improvements race for metropolises (and the level-3 abilities); knights are
 * recruited, promoted and activated against the barbarian ship so we are never the weakest city
 * holder when it lands, and can take Defender of Catan. Everything comes from the public view.
 */
import type { CitiesKnightsPublic, Command, PickField, SeatId, Track } from '../../model';
import type { Ctx } from '../context';
import { fill } from '../prompts';
import type { Needs } from '../trade';
import { winBoost } from '../plan';
import { VP, type Advisor } from './index';

const view = (c: Ctx) => c.pub.ext['cities-knights'] as CitiesKnightsPublic;

/** Worth of `gain` more active knight strength for the coming attack. */
function defense(c: Ctx, x: CitiesKnightsPublic, gain: number) {
  const cities = Object.values(c.pub.pieces.buildings).filter(b => b.kind === 'city');
  const str = (id: SeatId) => x.seats[id]?.strength ?? 0, mine = str(c.seat);
  const total = c.pub.seats.reduce((n, s) => n + str(s.id), 0), power = cities.length;
  const plain = (id: SeatId) => cities.some(b => b.seat === id && !b.metropolis);
  const others = c.pub.seats.filter(s => s.id !== c.seat);
  const low = Math.min(Infinity, ...others.filter(s => plain(s.id)).map(s => str(s.id)));
  const top = Math.max(0, ...others.map(s => str(s.id)));
  let value = 0;
  // Losing: the weakest exposed seats each lose a city (a point and half its production).
  if (plain(c.seat) && total < power && mine <= low) {
    value += (mine + gain > low || total + gain >= power ? 1.4 : 0.5) * VP;
  }
  // Winning alone: Defender of Catan, one point (partial credit on the way to the top strength).
  const hero = Math.min(1, gain / Math.max(1, top + 1 - mine)) * (total + gain >= power ? 1 : 0.4);
  value += 0.8 * VP * winBoost(c, 1) * hero;
  const soon = (x.barbarian.position + 1) / x.barbarian.length;
  return value * (0.3 + 0.7 * soon);
}

/** Improvement worth: the metropolis (2 VP) when this level takes it, else the level's draws and ability. */
function improve(c: Ctx, x: CitiesKnightsPublic, track: Track) {
  const level = (id: SeatId) => x.seats[id]?.improvements[track] ?? 0, next = level(c.seat) + 1;
  const at = x.metropolises[track], holder = at ? c.pub.pieces.buildings[at]?.seat ?? null : null;
  const rival = Math.max(0, ...c.pub.seats.filter(s => s.id !== c.seat).map(s => level(s.id)));
  if (next >= 4 && holder !== c.seat && (!holder || level(holder) < next)) return 2 * VP * winBoost(c, 2) + 0.5;
  if (holder === c.seat) return rival >= next - 1 ? 1.8 : 0.5;
  // A level-4 holder loses the metropolis to the first level 5: level 4 is half of that capture.
  if (next === 4) return level(holder!) < 5 ? VP * winBoost(c, 2) : 0.2;
  if (next >= 4) return 0.2;
  const race = next === 3 && rival <= 3 && !holder ? 0.6 : 0;
  return 0.9 + 0.25 * next + (next === 3 ? 0.6 : 0) + race;
}

function worth(c: Ctx, cmd: Command): number | null {
  const x = view(c), [, what, arg] = cmd.id.split(':');
  if (!x) return null;
  const knight = arg ? c.pub.pieces.units[arg] : undefined;
  if (what === 'improve') return improve(c, x, arg as Track);
  if (what === 'activate' && knight) return defense(c, x, knight.level) + 0.3;
  if (what === 'promote' && knight) return defense(c, x, knight.active ? 1 : 0.5) + 0.4;
  if (what === 'recruit') return 0.6 * defense(c, x, 1) + 0.5;
  return null;
}

/** A knight whose owner is still retreating another one cannot be displaced yet (the engine refuses). */
function answer(c: Ctx, cmd: Command, n: Needs) {
  const f = cmd.fields.find((x): x is PickField => x.kind === 'pick' && x.target === 'vertex');
  if (!/^ck:(move|play):/.test(cmd.id) || !f) return undefined;
  const busy = (v: string) => Object.values(c.pub.pieces.units).some(u => u.kind === 'knight' && u.at === v
    && u.seat !== c.seat && c.pub.prompts.some(p => p.seat === u.seat && p.kind === 'cities-knights/retreat'));
  const options = f.options.filter(o => !busy(o.value));
  if (options.length === f.options.length) return undefined;
  const fields = cmd.fields.map(x => (x === f ? { ...f, options } : x));
  return options.length ? fill(c, { ...cmd, fields }, n) : null;
}

export const citiesKnights: Advisor = { worth, answer };
