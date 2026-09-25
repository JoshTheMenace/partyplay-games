/** Cities & Knights sample: commodities, walls, a metropolis, knights, barbarians, progress cards. */
import { COMMODITIES, TRACKS, type Badge, type Cards, type Command, type Prompt, type Track } from '../../src/model';
import { hands, midGame } from './base';
import { T0, clock, finish, fixture, openSpots } from './build';
import { Log } from './events';
import { me } from './private';
import { chip } from './prompts';

const LEVELS: Record<string, Record<Track, number>> = {
  p0: { science: 4, trade: 1, politics: 0 }, p1: { science: 1, trade: 2, politics: 1 },
  p2: { science: 0, trade: 0, politics: 2 }, p3: { science: 2, trade: 0, politics: 0 },
};

const improve: Command = {
  id: 'cities-knights/improve', module: 'cities-knights', group: 'city', label: 'Improve a city',
  detail: 'Spend commodities to climb a track.', cost: null, hint: 0.7,
  fields: [{
    kind: 'pick', key: 'track', label: 'Track', target: 'track',
    options: TRACKS.map(t => ({ value: t, label: t, detail: `Level ${LEVELS.p0[t] + 1}` })),
  }],
};

export function citiesKnights4() {
  const now = T0 + 7_000_000, pub = midGame(4, { cpu: [3], round: 7 });
  pub.settings.citiesKnights = true;
  pub.settings.targetPoints = 13;
  pub.modules = ['cities-knights'];
  Object.assign(pub.turn, { active: 'p0', next: 'p1' });
  pub.now = { seats: ['p0'], title: 'Ana builds', detail: 'Rolled 9 · science event' };
  const city = Object.values(pub.pieces.buildings).find(b => b.seat === 'p0' && b.kind === 'city')!;
  Object.assign(city, { wall: true, metropolis: 'science' });
  const [k1, k2] = openSpots(pub);
  pub.pieces.units = {
    u1: { id: 'u1', kind: 'knight', seat: 'p0', at: k1, level: 2, active: true, cargo: [] },
    u2: { id: 'u2', kind: 'knight', seat: 'p1', at: k2, level: 1, active: false, cargo: [] },
  };
  const path = pub.board.tiles.filter(t => t.terrain === 'sea').slice(0, 8).map(t => t.id);
  pub.board.features = [{ kind: 'barbarian-path', id: 'bp', tiles: path }];
  const log = new Log(now - 9000);
  const h: Record<string, Cards> = { ...hands(pub), p0: { ore: 2, grain: 1, paper: 2, cloth: 1 } };
  const roll = log.roll(pub, 'p0', [4, 5], 0);
  roll.eventDie = 'science';
  clock(pub, 'main', ['p0'], now - 6000, 'acting');
  log.into(finish(pub, h));
  for (const g of COMMODITIES) pub.bank[g] = 12 - (h.p0[g] ?? 0);
  pub.seats[0].discardLimit = 9;
  pub.seats[0].vp += 2;
  pub.seats[0].parts.push({ key: 'metropolis', label: 'Science metropolis', points: 2, count: 1 });
  pub.seats[0].knights = 1;
  pub.ext['cities-knights'] = {
    barbarian: { position: 5, length: 7, attacks: 1 }, lastEvent: 'science', metropolises: { science: city.vertex },
    seats: Object.fromEntries(pub.seats.map((s, i) => [s.id, {
      improvements: LEVELS[s.id], progress: [2, 1, 5, 0][i], defender: i === 2 ? 1 : 0, strength: [2, 0, 0, 0][i],
    }])),
  };
  const cities = Object.values(pub.pieces.buildings).filter(b => b.kind === 'city').length;
  pub.hud = [
    { kind: 'track', key: 'barbarians', label: 'Barbarian ship', value: 5, max: 7, alert: false, icon: 'barbarian' },
    { kind: 'versus', key: 'defense', label: 'If they land now',
      left: { label: 'Barbarians', value: cities }, right: { label: 'Knights', value: 2 } },
  ];
  for (const s of pub.seats) {
    s.badges = TRACKS.filter(t => LEVELS[s.id][t] > 0)
      .map((t): Badge => ({ key: t, icon: t, value: LEVELS[s.id][t], label: `${t} ${LEVELS[s.id][t]}` }));
  }
  const keep: Prompt = {
    id: 'q7', kind: 'cities-knights/keep', scope: 'self', deadline: now + 30_000, auto: 'Discards the weakest card',
    command: {
      id: 'prompt:q7', module: 'cities-knights', group: 'progress', label: 'Discard a progress card',
      detail: 'You may hold 4 progress cards.', cost: null, hint: 1,
      fields: [{ kind: 'pick', key: 'card', label: 'Discard', options: [
        { value: 'c1', label: 'Spy' }, { value: 'c2', label: 'Irrigation' }, { value: 'c3', label: 'Merchant' },
        { value: 'c4', label: 'Warlord' }, { value: 'c5', label: 'Crane' },
      ] }],
    },
  };
  pub.prompts = [chip(keep, 'p2', 'Discarding a progress card', 1)];
  Object.assign(pub.seats[2], { status: 'choosing', deadline: keep.deadline });
  const progress = [
    { id: 'c10', kind: 'alchemist' as const, track: 'science' as const, playable: false,
      why: { code: 'stage' as const, text: 'Play before you roll' } },
    { id: 'c11', kind: 'crane' as const, track: 'science' as const, playable: true, why: null },
  ];
  return fixture({
    name: 'ck-4', description: 'Cities & Knights: metropolis, wall, knights, barbarians, progress cards', now,
    seat: 'p0', pub,
    views: [
      me(pub, 'p0', h.p0, { ext: { 'cities-knights': { progress } }, commands: [improve] }),
      me(pub, 'p2', h.p2, { prompts: [keep] }),
    ],
  });
}
