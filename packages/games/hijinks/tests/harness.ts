/**
 * In-process Hijinks night harness for pack and minigame tests. No sockets, fake clock, seeded.
 *
 *   import { createNight, loadBot } from './harness';
 *   const night = createNight({ players: 6, settings: { timers: 'speedy' }, seed: 7 });
 *   night.startMini('quip-clash');            // everyone votes, VIP locks, VIP skips intro → phase 'mini'
 *   const { result } = await night.playMini(); // drives src/minis/<id>/bot.ts until the podium
 *   night.assertHidden('secret answer');      // string must not appear in the public view
 *
 * createNight(options) → Night
 *   options: players (2–10, default 4; ids 'p0'…'p9', 16-char names), settings (partial PackSettings), seed (default 1),
 *            now (start ms, default 1000), avatars (per-seat lobby avatar; omitted → index defaults), rules (default: real pack).
 * Night:
 *   rules, state, ids          the rules under test, live pack State, seat ids in roster order
 *   now                        current fake server time (ms)
 *   view() / me(id)            public view / private view of one seat (both checked with assertSerializable)
 *   mini() / miniMe(id)        the active minigame's public / private projection (view().mini / me(id).mini)
 *   act(id, action)            parse + apply a raw PackAction exactly like the room; throws on reject
 *   tryAct(id, action)         same, returning ActionResult instead of throwing
 *   send(id, a) / trySend      minigame action wrapped as { k: 'mini', session: <current>, a }
 *   advance(ms)                ticks every 100 ms up to ms, checking every projection after each tick
 *   until(predicate, maxMs)    advances in 100 ms steps until predicate() is true (throws after maxMs, default 30 min)
 *   connect(id, connected)     presence change
 *   startMini(id)              menu → mini via votes + VIP lock + VIP intro skip (from the podium, continues first)
 *   runMini(bot, opts)         steps every connected seat's bot once per tick until the podium; returns { result, accepted, rejected }
 *   playMini(opts)             runMini with the bot loaded from src/minis/<current id>/bot.ts (default or `bot` export)
 *   toMenu() / endNight()      VIP continues from the podium / VIP ends the night (outcome becomes complete)
 *   check()                    asserts public, every private view and outcome are transport-serializable
 *   assertHidden(text)         text is absent from the public view (privacy)
 *   assertHiddenFrom(id, text) text is absent from that seat's private view
 * runMini opts: { maxMs = 30 min, skip?: string[] (seat ids whose bots stay idle) }.
 */
import assert from 'node:assert/strict';
import { assertSerializable } from '../../../party-contract/src/serializable'; // the exact check room-server re-exports
import type { ActionResult } from '../../../party-contract/src/index';
import type { MiniBot, MiniResult, PackPrivateView, PackPublicView, PackSettings } from '../src/core/contract';
import { random } from '../src/core/server/rng';
import { rules as packRules } from '../src/server';
import type { PackRules, State } from '../src/server';

export type NightOptions = { players?: number; settings?: Partial<PackSettings>; seed?: number; now?: number; avatars?: (number | undefined)[]; rules?: PackRules };
export type MiniRun = { result: MiniResult; accepted: number; rejected: string[] };
const COLORS = ['#ffd24a', '#ff5748', '#28c6e7', '#78d955', '#b58aff', '#ff9f43', '#f368e0', '#48dbfb', '#1dd1a1', '#feca57'];

export async function loadBot(id: string): Promise<MiniBot> {
  const mod = await import(`../src/minis/${id}/bot.ts`) as { default?: MiniBot; bot?: MiniBot };
  const bot = mod.default ?? mod.bot;
  if (typeof bot !== 'function') throw new Error(`src/minis/${id}/bot.ts must export a MiniBot as default or \`bot\`.`);
  return bot;
}

export function createNight(options: NightOptions = {}) {
  const rules = options.rules ?? packRules, count = options.players ?? 4;
  let now = options.now ?? 1000;
  const ids = Array.from({ length: count }, (_, i) => `p${i}`);
  const players = ids.map((id, i) => {
    const avatar = options.avatars?.[i];
    return { id, name: `Player ${i} Longname`.slice(0, 16), color: COLORS[i % COLORS.length]!, ...(avatar === undefined ? {} : { lobbyChoice: { avatar } }) };
  });
  const state: State = rules.create({ roomId: 'room', roundId: 'night', players, seed: options.seed ?? 1, nowMs: now }, rules.validateSettings(options.settings ?? {}));
  const ctx = () => ({ nowMs: now, phase: 'playing' as const });
  const botRng = { seed: (options.seed ?? 1) ^ 0x5eed };

  const night = {
    rules, state, ids,
    get now() { return now; },
    view(): PackPublicView { const view = rules.publicView(state, ctx()); assertSerializable(view); return view; },
    me(id: string): PackPrivateView { const view = rules.playerView(state, id, ctx()); assertSerializable(view); return view; },
    mini: <T = any>() => night.view().mini as T,
    miniMe: <T = any>(id: string) => night.me(id).mini as T,
    check() {
      night.view();
      for (const id of ids) night.me(id);
      assertSerializable(rules.outcome(state));
    },
    act(id: string, action: unknown) { rules.applyAction(state, id, rules.parseAction(action), now); night.check(); },
    tryAct(id: string, action: unknown): ActionResult {
      try { night.act(id, action); return { accepted: true }; } catch (error) { return { accepted: false, reason: (error as Error).message }; }
    },
    send: (id: string, a: Record<string, unknown>) => night.act(id, { k: 'mini', session: state.current?.session ?? 0, a }),
    trySend: (id: string, a: Record<string, unknown>) => night.tryAct(id, { k: 'mini', session: state.current?.session ?? 0, a }),
    advance(ms: number) {
      for (const end = now + ms; now < end;) {
        now = Math.min(end, now + 100);
        if (!rules.outcome(state).complete) rules.tick(state, new Map(), 0.1, now);
        night.check();
      }
    },
    until(predicate: () => boolean, maxMs = 30 * 60_000) {
      for (const end = now + maxMs; !predicate();) {
        if (now >= end) assert.fail(`Timed out after ${maxMs} ms in phase ${state.phase}.`);
        night.advance(100);
      }
    },
    connect(id: string, connected: boolean) { rules.onPresenceChange(state, id, connected, now); night.check(); },
    vip: () => night.view().vip,
    startMini(id: string) {
      if (state.phase === 'podium') night.toMenu();
      assert.equal(state.phase, 'menu', 'startMini needs the menu');
      for (const seat of ids) if (state.players.find(p => p.id === seat)!.connected) night.act(seat, { k: 'vote', game: id });
      night.act(night.vip()!, { k: 'lock' });
      assert.equal(state.current?.id, id);
      night.act(night.vip()!, { k: 'skip', session: state.current!.session });
      assert.equal(state.phase, 'mini');
    },
    runMini(bot: MiniBot, { maxMs = 30 * 60_000, skip = [] as string[] } = {}): MiniRun {
      const session = state.current?.session, run = { accepted: 0, rejected: [] as string[] };
      assert.equal(state.phase, 'mini', 'runMini needs an active minigame');
      for (const end = now + maxMs; state.phase === 'mini' && state.current?.session === session;) {
        if (now >= end) assert.fail(`Minigame ${state.current?.id} did not finish within ${maxMs} ms.`);
        for (const player of state.players) {
          if (!player.connected || skip.includes(player.id) || state.phase !== 'mini') continue;
          const view = night.view(), me = night.me(player.id);
          const action = bot({ view: view.mini, me: me.mini, playerId: player.id, players: view.players, now, random: () => random(botRng) });
          if (!action) continue;
          const result = night.trySend(player.id, action);
          if (result.accepted) run.accepted++; else run.rejected.push(`${player.id}: ${result.reason}`);
        }
        night.advance(100);
      }
      assert.equal(state.phase, 'podium', `Minigame ended in phase ${state.phase}`);
      return { result: state.podium!.result, ...run };
    },
    async playMini(opts?: { maxMs?: number; skip?: string[] }) { return night.runMini(await loadBot(state.current!.id), opts); },
    toMenu() { night.act(night.vip()!, { k: 'next', session: state.current!.session }); },
    endNight() { if (state.phase === 'podium') night.toMenu(); night.act(night.vip()!, { k: 'end' }); assert.equal(rules.outcome(state).complete, true); },
    assertHidden(text: string) { assert.ok(!JSON.stringify(night.view()).includes(text), `Public view leaks ${JSON.stringify(text)}`); },
    assertHiddenFrom(id: string, text: string) { assert.ok(!JSON.stringify(night.me(id)).includes(text), `Private view of ${id} leaks ${JSON.stringify(text)}`); },
  };
  night.check();
  return night;
}
export type Night = ReturnType<typeof createNight>;
