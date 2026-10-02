import type { GameRules, Outcome } from '../../../party-contract/src/index';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { AVATAR_COUNT } from './core/contract';
import type { Cue, MiniApi, MiniInfo, MiniResult, MiniServer, PackAction, PackPhase, PackPlayer, PackPrivateView, PackPublicView, PackSettings, TimerPace } from './core/contract';
import { VO } from './core/vo-manifest';
import { mix, pick, random, shuffle } from './core/server/rng';
import { bool, integer, record, text } from './core/server/validate';
import { MINIS, eligible } from './minis/catalog';
import { SERVERS } from './minis/registry.server';

export const PACE: Record<TimerPace, number> = { relaxed: 1.5, standard: 1, speedy: 0.7 };
export const CUE_LIMIT = 24, LOCK_MS = 4000, PODIUM_MS = 12000, MAX_MINI_ACTION = 24 * 1024;

type Running = { server: MiniServer; state: unknown; crashed: boolean };
export type State = {
  players: PackPlayer[]; settings: PackSettings; seed: number; now: number; phase: PackPhase; ended: boolean;
  trophies: Record<string, number>; points: Record<string, number>; played: string[];
  votes: Record<string, string>; lockAt: number | null; session: number;
  current: { id: string; session: number; startedAt: number } | null;
  intro: { endsAt: number; skips: string[] } | null; mini: Running | null;
  podium: { result: MiniResult; endsAt: number } | null;
  music: string | null; cues: Cue[]; seq: number; media: Record<string, unknown>; mediaRev: number;
  /** Content keys each minigame has used this night (api.used), so replays avoid repeats. */
  used: Record<string, string[]>;
};
/** Test seam: the pack with an explicit minigame catalog and server map. */
export type PackDeps = { servers: Readonly<Record<string, MiniServer>>; catalog: readonly MiniInfo[] };
export type PackRules = GameRules<State, null, PackAction, PackSettings, PackPublicView, PackPrivateView>;

const own = <T>(rec: Record<string, T>, key: string): T | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
const duration = (line: string) => own(VO, line) ?? 0;
const zeroes = (s: State) => Object.fromEntries(s.players.map(p => [p.id, 0]));

function cue(s: State, kind: Cue['kind'], id: string) {
  s.cues.push({ seq: ++s.seq, at: s.now, kind, id });
  if (s.cues.length > CUE_LIMIT) s.cues.splice(0, s.cues.length - CUE_LIMIT);
}
function say(s: State, line: string) { cue(s, 'vo', line); return duration(line); }
const set = (s: State, patch: Partial<State>) => Object.assign(s, patch);
function clearMedia(s: State) { if (Object.keys(s.media).length) { s.media = {}; s.mediaRev++; } }

export function miniApi(s: State): MiniApi {
  return {
    get now() { return s.now; },
    random: () => random(s),
    shuffle: items => shuffle(s, items),
    pick: (items, count) => pick(s, items, count),
    seconds: base => Math.round(base * 1000 * PACE[s.settings.timers]),
    say: line => say(s, line),
    sfx: id => cue(s, 'sfx', id),
    music: track => { s.music = track; },
    speak: value => { const line = String(value).trim().slice(0, 200); if (s.settings.readAloud && line) cue(s, 'speak', line); },
    media: {
      put(key, value) { assertSerializable(value); s.media[key] = value; s.mediaRev++; },
      remove(key) { if (Object.hasOwn(s.media, key)) { delete s.media[key]; s.mediaRev++; } },
    },
    settings: { ...s.settings },
    used: {
      has: key => (own(s.used, s.current?.id ?? '') ?? []).includes(key),
      add(key) { const id = s.current?.id; if (!id) return; const list = s.used[id] ??= []; if (!list.includes(key)) list.push(key); if (list.length > 2000) list.splice(0, list.length - 2000); },
    },
  };
}

/** Keeps only well-formed result fields for seated players, so a sloppy minigame cannot corrupt the night. */
function sanitize(s: State, raw: MiniResult): MiniResult {
  const ids = new Set(s.players.map(p => p.id)), scores = raw?.scores && typeof raw.scores === 'object' ? raw.scores : {};
  const result: MiniResult = {
    scores: Object.fromEntries(s.players.map(p => { const n = own(scores, p.id); return [p.id, typeof n === 'number' && Number.isFinite(n) ? n : 0]; })),
    winners: Array.isArray(raw?.winners) ? [...new Set(raw.winners.filter(id => ids.has(id)))] : [],
  };
  const awards = Array.isArray(raw?.awards) ? raw.awards.filter(a => a && ids.has(a.playerId) && typeof a.title === 'string' && a.title.trim()).slice(0, 6) : [];
  if (awards.length) result.awards = awards.map(a => ({ title: a.title.trim().slice(0, 60), playerId: a.playerId }));
  if (typeof raw?.headline === 'string' && raw.headline.trim()) result.headline = raw.headline.trim().slice(0, 140);
  return result;
}

export function createRules({ servers, catalog }: PackDeps): PackRules {
  const info = (id: string) => catalog.find(item => item.id === id);
  const playable = (id: string, count: number) => { const item = info(id); return !!item && Object.hasOwn(servers, id) && eligible(item, count); };
  const vip = (s: State) => s.players.find(p => p.connected)?.id ?? null;

  function toMenu(s: State, line: string) {
    set(s, { phase: 'menu', votes: {}, lockAt: null, intro: null, podium: null, mini: null, music: 'menu' });
    clearMedia(s); say(s, line);
  }
  function startIntro(s: State, id: string) {
    set(s, { phase: 'intro', votes: {}, lockAt: null, music: 'menu', current: { id, session: ++s.session, startedAt: s.now } });
    cue(s, 'sfx', 'swoosh-in');
    const spoken = s.settings.tutorials ? info(id)!.intro.reduce((sum, line) => sum + say(s, line), 0) : 0;
    s.intro = { endsAt: s.now + (s.settings.tutorials ? Math.max(9000, spoken + 2000) : 3000), skips: [] };
  }
  function startMini(s: State) {
    const current = s.current!, server = servers[current.id]!, m: Running = { server, state: null, crashed: false };
    set(s, { phase: 'mini', intro: null, mini: m }); current.startedAt = s.now; clearMedia(s);
    contain(s, () => { m.state = server.create(s.players.map(p => ({ ...p })), miniApi(s)); });
  }
  /** Minigame exceptions never escape: the first one is logged and the minigame ends with zero scores on the next tick. */
  function contain<T>(s: State, run: (m: Running) => T): T | null {
    const m = s.mini;
    if (!m || m.crashed) return null;
    try { return run(m); } catch (error) {
      m.crashed = true;
      console.error(`[hijinks] ${s.current?.id} (session ${s.current?.session}) failed; ending it with zero scores.`, error);
      return null;
    }
  }
  function finish(s: State, raw: MiniResult) {
    const result = sanitize(s, raw);
    for (const id of result.winners) s.trophies[id]!++;
    for (const [id, n] of Object.entries(result.scores)) s.points[id]! += n;
    s.played.push(s.current!.id);
    set(s, { phase: 'podium', mini: null, music: 'podium', podium: { result, endsAt: s.now + PODIUM_MS } });
    cue(s, 'sfx', 'fanfare'); say(s, 'host.podium');
  }
  function lock(s: State) {
    const tally = new Map<string, number>();
    for (const game of Object.values(s.votes)) tally.set(game, (tally.get(game) ?? 0) + 1);
    const top = Math.max(...tally.values()), leaders = [...tally].filter(([, n]) => n === top).map(([game]) => game).sort();
    cue(s, 'sfx', 'lock');
    startIntro(s, leaders[Math.floor(random(s) * leaders.length)]!);
  }
  function introDone(s: State) {
    const online = s.players.filter(p => p.connected).length;
    return s.now >= s.intro!.endsAt || s.intro!.skips.length * 2 > online;
  }

  const rules: PackRules = {
    validateSettings(raw) {
      const v = record(raw ?? {}, ['family', 'timers', 'readAloud', 'tutorials', 'startWith']);
      const timers = v.timers ?? 'standard', startWith = v.startWith ?? '';
      if (typeof timers !== 'string' || !Object.hasOwn(PACE, timers)) throw new Error('Choose relaxed, standard or speedy timers.');
      if (startWith !== '' && (typeof startWith !== 'string' || !info(startWith) || !Object.hasOwn(servers, startWith))) throw new Error('Choose a minigame from the library.');
      return { family: bool(v.family ?? true, 'Family mode'), timers: timers as TimerPace, readAloud: bool(v.readAloud ?? false, 'Read aloud'),
        tutorials: bool(v.tutorials ?? true, 'Tutorials'), startWith: startWith as string };
    },
    parseInput(raw) { if (raw !== null) throw new Error('Hijinks uses actions only.'); return null; },
    neutralInput: () => null,
    parseLobbyChoice(raw, ready) {
      const v = raw == null ? {} : record(raw, ['avatar']);
      if (v.avatar === undefined && ready) throw new Error('Pick an avatar first.');
      if (v.avatar === undefined) return {};
      return { avatar: integer(v.avatar, 0, AVATAR_COUNT - 1) };
    },
    parseAction(raw) {
      const v = record(raw);
      switch (v.k) {
        case 'vote': record(v, ['k', 'game']); return { k: 'vote', game: text(v.game, 40, 'Game') };
        case 'lock': case 'end': record(v, ['k']); return { k: v.k };
        case 'skip': case 'next': record(v, ['k', 'session']); return { k: v.k, session: integer(v.session, 0, 1e6) };
        case 'mini': {
          record(v, ['k', 'session', 'a']);
          const a = record(v.a);
          if (JSON.stringify(a).length > MAX_MINI_ACTION) throw new Error('That is too much to send.');
          return { k: 'mini', session: integer(v.session, 0, 1e6), a };
        }
        default: throw new Error('Unknown action.');
      }
    },
    create(ctx, settings) {
      const ids = ctx.players.map(p => p.id);
      if (ids.length < 2 || ids.length > 10 || new Set(ids).size !== ids.length || ids.some(id => !id)) throw new Error('Hijinks needs 2–10 unique players.');
      const used = new Set<number>();
      const chosen = ctx.players.map(p => {
        const avatar = (p.lobbyChoice as { avatar?: unknown } | undefined)?.avatar;
        if (!Number.isInteger(avatar) || (avatar as number) < 0 || (avatar as number) >= AVATAR_COUNT || used.has(avatar as number)) return null;
        used.add(avatar as number); return avatar as number;
      });
      const players = ctx.players.map((p, i) => {
        let avatar = chosen[i];
        if (avatar == null) { avatar = Array.from({ length: AVATAR_COUNT }, (_, k) => k).find(k => !used.has(k)) ?? i % AVATAR_COUNT; used.add(avatar); }
        return { id: p.id, name: p.name, color: p.color, avatar, connected: true };
      });
      const s: State = {
        players, settings: rules.validateSettings(settings), seed: mix(ctx.seed), now: ctx.nowMs, phase: 'menu', ended: false,
        trophies: Object.fromEntries(ids.map(id => [id, 0])), points: Object.fromEntries(ids.map(id => [id, 0])), played: [],
        votes: {}, lockAt: null, session: 0, current: null, intro: null, mini: null, podium: null,
        music: 'menu', cues: [], seq: 0, media: {}, mediaRev: 0, used: {},
      };
      say(s, 'host.welcome');
      if (s.settings.startWith && playable(s.settings.startWith, ids.length)) startIntro(s, s.settings.startWith);
      return s;
    },
    applyAction(s, playerId, action, now) {
      s.now = now;
      if (!s.players.some(p => p.id === playerId)) throw new Error('Only seated players can play.');
      if (s.ended) throw new Error('The night is over.');
      const isVip = vip(s) === playerId;
      switch (action.k) {
        case 'vote': {
          if (s.phase !== 'menu') throw new Error('Voting is closed.');
          const item = info(action.game);
          if (!item) throw new Error('That game is not in the library.');
          if (!Object.hasOwn(servers, action.game)) throw new Error('That game is not ready yet.');
          if (!eligible(item, s.players.length)) throw new Error(`${item.title} needs ${item.players.min}–${item.players.max} players.`);
          if (own(s.votes, playerId) !== action.game) { s.votes[playerId] = action.game; cue(s, 'sfx', 'vote'); }
          return;
        }
        case 'lock':
          if (s.phase !== 'menu') throw new Error('A game is already picked.');
          if (!isVip) throw new Error('Only the VIP can lock it in.');
          if (!Object.keys(s.votes).length) throw new Error('Vote for a game first.');
          return lock(s);
        case 'end':
          if (s.phase !== 'menu') throw new Error('Finish this game first.');
          if (!isVip) throw new Error('Only the VIP can end the night.');
          s.ended = true; s.music = 'finale'; say(s, 'host.night-over');
          return;
        case 'skip':
          if (s.phase !== 'intro' || action.session !== s.current?.session) throw new Error('That intro is already over.');
          if (!s.intro!.skips.includes(playerId)) s.intro!.skips.push(playerId);
          if (isVip || introDone(s)) startMini(s);
          return;
        case 'next':
          if (s.phase !== 'podium' || action.session !== s.current?.session) throw new Error('Already moving on.');
          if (!isVip) throw new Error('Only the VIP can continue.');
          return toMenu(s, 'host.pick');
        case 'mini': {
          if (s.phase !== 'mini' || !s.mini || action.session !== s.current?.session) throw new Error('That game has already finished.');
          if (s.mini.crashed) throw new Error('That game hit a snag. Hang tight!');
          s.mini.server.action(s.mini.state, playerId, action.a, miniApi(s));
        }
      }
    },
    tick(s, _inputs, _dt, now) {
      s.now = now;
      if (s.ended) return;
      if (s.phase === 'menu') {
        const online = s.players.filter(p => p.connected);
        if (s.lockAt === null && online.length && online.every(p => own(s.votes, p.id))) { s.lockAt = now + LOCK_MS; cue(s, 'sfx', 'drumroll'); say(s, 'host.locked'); }
        if (s.lockAt !== null && now >= s.lockAt && Object.keys(s.votes).length) lock(s);
      } else if (s.phase === 'intro') {
        if (introDone(s)) startMini(s);
      } else if (s.phase === 'mini') {
        const result = contain(s, m => { m.server.tick(m.state, miniApi(s)); return m.server.result(m.state); });
        if (s.mini?.crashed) finish(s, { scores: zeroes(s), winners: [], headline: 'That game tripped over its own feet. On to the next one!' });
        else if (result) finish(s, result);
      } else if (now >= s.podium!.endsAt) toMenu(s, 'host.pick');
    },
    onPresenceChange(s, playerId, connected, now) {
      s.now = now;
      const player = s.players.find(p => p.id === playerId);
      if (!player) return;
      player.connected = connected;
      if (s.phase === 'mini') contain(s, m => m.server.presence?.(m.state, playerId, connected, miniApi(s)));
    },
    publicView(s, ctx) {
      const mini = s.phase === 'mini' ? contain(s, m => m.server.publicView(m.state, ctx.nowMs)) ?? null : null;
      return {
        phase: s.phase, players: s.players.map(p => ({ ...p })), vip: vip(s), settings: { ...s.settings },
        trophies: { ...s.trophies }, played: [...s.played],
        menu: s.phase === 'menu' ? { votes: { ...s.votes }, lockAt: s.lockAt } : null,
        current: s.current && { ...s.current }, intro: s.intro && { endsAt: s.intro.endsAt, skips: [...s.intro.skips] },
        mini, podium: s.podium && { ...s.podium }, music: s.music, cues: s.cues.map(c => ({ ...c })),
        mediaRev: s.mediaRev, media: { ...s.media },
      };
    },
    playerView(s, playerId, ctx) {
      return {
        vote: s.phase === 'menu' ? own(s.votes, playerId) ?? null : null,
        mini: s.phase === 'mini' ? contain(s, m => m.server.playerView(m.state, playerId, ctx.nowMs)) ?? null : null,
      };
    },
    outcome(s): Outcome {
      const t = (id: string) => s.trophies[id]!, pts = (id: string) => s.points[id]!;
      const best = Math.max(0, ...s.players.map(p => t(p.id)));
      // Trophies rank first; points break ties, except among the trophy leaders, who all win.
      const ahead = (o: string, p: string) => t(o) > t(p) || (t(o) === t(p) && (best === 0 || t(p) < best) && pts(o) > pts(p));
      const rows = [...s.players].sort((a, b) => t(b.id) - t(a.id) || pts(b.id) - pts(a.id)).map(p => ({
        playerId: p.id, score: t(p.id), rank: 1 + s.players.filter(o => ahead(o.id, p.id)).length,
        label: `${t(p.id)} ${t(p.id) === 1 ? 'trophy' : 'trophies'} · ${pts(p.id)} pts`,
      }));
      return { complete: s.ended, winners: s.ended && best > 0 ? s.players.filter(p => t(p.id) === best).map(p => p.id) : [], rows };
    },
    dispose(s) { s.mini = null; s.media = {}; },
  };
  return rules;
}

export const rules = createRules({ servers: SERVERS, catalog: MINIS });
export default rules;
