/** Tiny test-only minigame: everyone taps a number once; highest wins. Also exercises media, cues, secrets and crashes. */
import type { MiniBot, MiniInfo, MiniServer, PackPlayer } from '../../src/core/contract';

export type TapState = { turn: string; ids: string[]; online: Record<string, boolean>; taps: Record<string, number>; secrets: Record<string, string>; deadline: number; done: boolean; boom: '' | 'tick' | 'view' };
export type TapPublic = { turn: string; tapped: string[]; deadline: number };
export type TapPrivate = { turn: string; secret: string; tapped: boolean };

export const tap: MiniServer<TapState, TapPublic, TapPrivate> = {
  id: 'tap',
  create(players: readonly PackPlayer[], api) {
    api.music('tap'); api.say('tap.intro');
    const secrets = Object.fromEntries(players.map(p => [p.id, `secret-${p.id}-${Math.floor(api.random() * 1e6)}`]));
    return { turn: `tap:${api.now}`, ids: players.map(p => p.id), online: Object.fromEntries(players.map(p => [p.id, p.connected])), taps: {}, secrets, deadline: api.now + api.seconds(20), done: false, boom: '' };
  },
  action(s, playerId, a, api) {
    if (a.turn !== s.turn) throw new Error('That turn is over.');
    if (a.boom === 'tick' || a.boom === 'view') { s.boom = a.boom; return; }
    if (a.media === 'put') return api.media.put(`doodle-${playerId}`, { by: playerId });
    if (a.media === 'remove') return api.media.remove(`doodle-${playerId}`);
    if (Object.hasOwn(s.taps, playerId)) throw new Error('Already tapped.');
    if (typeof a.n !== 'number' || !Number.isInteger(a.n) || a.n < 1 || a.n > 99) throw new Error('Pick 1–99.');
    s.taps[playerId] = a.n; api.sfx('submit');
  },
  tick(s, api) {
    if (s.boom === 'tick') throw new Error('fixture tick boom');
    if (api.now >= s.deadline || s.ids.every(id => !s.online[id] || Object.hasOwn(s.taps, id))) s.done = true;
  },
  presence(s, playerId, connected) { s.online[playerId] = connected; },
  publicView(s) {
    if (s.boom === 'view') throw new Error('fixture view boom');
    return { turn: s.turn, tapped: Object.keys(s.taps), deadline: s.deadline };
  },
  playerView: (s, playerId) => ({ turn: s.turn, secret: s.secrets[playerId]!, tapped: Object.hasOwn(s.taps, playerId) }),
  result(s) {
    if (!s.done) return null;
    const best = Math.max(0, ...Object.values(s.taps));
    return { scores: { ...s.taps }, winners: best ? s.ids.filter(id => s.taps[id] === best) : [], awards: [{ title: 'Tapper', playerId: s.ids[0]! }, { title: 'Ghost', playerId: 'nobody' }] };
  },
};

/** Taps (roster index + 1), so the last seated player wins. */
export const tapBot: MiniBot<TapPublic, TapPrivate> = ({ view, me, playerId, players }) =>
  me.tapped ? null : { turn: view.turn, n: players.findIndex(p => p.id === playerId) + 1 };

const dud: MiniServer = { ...tap, id: 'dud', create() { throw new Error('fixture create boom'); } };

const entry = (id: string, min: number, max: number): MiniInfo => ({
  id, title: id.toUpperCase(), tagline: 'Fixture', howTo: ['One', 'Two', 'Three'], players: { min, max }, minutes: '1', tags: [], accent: '#ffd24a', intro: [`${id}.intro`, `${id}.rules`],
});
/** tap 2–10, big 5–10, dud (create throws), ghost (catalog entry without a server). */
export const fixtureCatalog: MiniInfo[] = [entry('tap', 2, 10), entry('big', 5, 10), entry('dud', 2, 10), entry('ghost', 2, 10)];
export const fixtureServers: Record<string, MiniServer> = { tap, big: { ...tap, id: 'big' }, dud };
