/**
 * Headless browser driver for Island Settlers (port of legacy tests/browser-expansions.js).
 * It only READS WebSocket frames (each page's public and private view); every move is chosen by the CPU
 * `decide` and then EXECUTED THROUGH THE REAL UI (tap cards, buttons and map spots). Nothing is injected:
 * like a player who can see the server's answer but still has to press the buttons.
 * Run with `node --import tsx` so the TypeScript CPU module loads.
 */
import { decide } from '../../src/cpu/index.ts';

const LABEL = { wood: 'Wood', brick: 'Brick', wool: 'Wool', grain: 'Grain', ore: 'Ore',
  paper: 'Paper', cloth: 'Cloth', coin: 'Coin', gold: 'Gold' };
const PIECE = { road: 'Road', ship: 'Ship', settlement: 'Settlement', city: 'City' };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wait = ms => new Promise(r => setTimeout(r, ms));

export function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frames seen by one page: the merged current snapshot, acks by action id, sent action types, errors. */
export function observe(page, name) {
  page.setDefaultTimeout(6000);
  const data = { name, page, current: null, revision: 0, sent: new Map(), acks: [], errors: [], frames: 0 };
  page.on('pageerror', e => data.errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') data.errors.push(`console: ${m.text()}`); });
  page.on('websocket', socket => {
    socket.on('framesent', f => {
      const m = JSON.parse(String(f.payload));
      if (m.type === 'game.action') data.sent.set(m.actionId, m.payload);
    });
    socket.on('framereceived', f => {
      const m = JSON.parse(String(f.payload));
      if (m.type === 'game.snapshot' || m.type === 'round.results') {
        const prev = data.current?.roundId === m.roundId ? data.current.publicView : {};
        data.current = { ...m, publicView: { ...prev, ...m.publicView } };
        data.revision = m.revision;
        data.frames++;
      }
      if (m.type === 'action.ack') data.acks.push({ ...m, payload: data.sent.get(m.actionId) });
      if (m.type === 'error') data.errors.push(`server: ${m.reason}`);
    });
  });
  return data;
}

export async function until(check, label, timeout = 15000, step = 50) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await wait(step);
  }
}

const visible = async loc => (await loc.count()) > 0 && await loc.first().isVisible();

/** Back to the task's home screen: close sheets, leave placement, un-press the tab. */
async function home(p) {
  for (let i = 0; i < 4; i++) {
    const sheet = p.locator('.island-settlers-sheet');
    if (await visible(sheet)) {
      const back = sheet.getByRole('button', { name: /^Back$/ });
      if (await visible(back)) await back.first().click(); else await p.keyboard.press('Escape');
      continue;
    }
    const confirmBack = p.locator('.island-settlers-confirm')
      .getByRole('button', { name: 'Back', exact: true });
    if (await visible(confirmBack)) { await confirmBack.first().click(); continue; }
    const headBack = p.locator('.island-settlers-command-head').getByRole('button', { name: 'Back' });
    if (await visible(headBack)) { await headBack.first().click(); continue; }
    const close = p.locator('.island-settlers-dock-sheet-head').getByRole('button', { name: 'Close' });
    if (await visible(close)) { await close.first().click(); continue; }
    const tab = p.locator('.island-settlers-bar button[aria-pressed="true"]');
    if (await visible(tab)) { await tab.first().click(); continue; }
    return;
  }
}

async function tab(p, name) {
  const t = p.locator('.island-settlers-bar').getByRole('button', { name: new RegExp(`^${name}`) }).first();
  if ((await t.getAttribute('aria-pressed')) !== 'true') await t.click();
}

/**
 * Tap a map spot. The seated host (PersonalView) picks on the 3D board: its 2D map is a hidden source, so
 * step to the spot with ←/→ (the dock shows "Spot 3 of 12") and press Enter, as a host at a TV would.
 */
async function spot(p, id) {
  const source = p.locator('.island-settlers-pick-source');
  if (!await source.count()) return p.locator(`[data-spot="${id}"]`).first().press('Enter');
  const ids = await source.locator('[data-spot]')
    .evaluateAll(els => els.map(e => e.getAttribute('data-spot')));
  const target = ids.indexOf(id);
  if (target < 0) throw new Error(`spot ${id} is not offered`);
  await p.keyboard.press('ArrowRight');
  const text = await p.locator('.island-settlers-dock-status').innerText();
  const at = Number(text.match(/Spot (\d+) of/)?.[1] ?? 1) - 1;
  for (let i = 0; i < (target - at + ids.length) % ids.length; i++) await p.keyboard.press('ArrowRight');
  await p.keyboard.press('Enter');
}

async function place(p, piece, at) {
  const confirm = p.getByRole('button', { name: `Confirm ${PIECE[piece].toLowerCase()}`, exact: true });
  if (!await visible(confirm)) {
    await home(p);
    await tab(p, 'Build');
    await p.locator('.island-settlers-rows button.island-settlers-row')
      .filter({ has: p.locator('b', { hasText: new RegExp(`^${PIECE[piece]}$`) }) }).first().click();
  }
  await spot(p, at);
  await confirm.click();
}

async function tapCards(scope, verb, cards) {
  for (const [g, n] of Object.entries(cards ?? {})) for (let i = 0; i < n; i++) {
    await scope.getByRole('button', { name: new RegExp(`^${verb} ${g}:`, 'i') }).first().click();
  }
}

/** Generic command/prompt sheet: pick fields in order (map, radio), card fields, then the command button. */
async function commandSheet(p, command, answer, verb = 'Pick') {
  const walk = async fields => {
    for (const f of fields) {
      if (f.kind === 'cards') { await tapCards(p, verb, answer.cards?.[f.key]); continue; }
      const v = answer.picks?.[f.key];
      if (v === undefined) continue;
      if (['tile', 'vertex', 'edge', 'unit'].includes(f.target ?? '')) await spot(p, v);
      else {
        const o = f.options.find(x => x.value === v);
        await p.locator('.island-settlers-choices').filter({ has: p.locator('legend', { hasText: f.label }) })
          .locator('label').nth(f.options.indexOf(o)).click();
      }
      await walk(f.options.find(x => x.value === v)?.then ?? []);
    }
  };
  await walk(command.fields);
  await p.locator('.island-settlers-confirm')
    .getByRole('button', { name: command.label, exact: true }).click();
}

async function robber(p, pub, prompt, picks) {
  const lead = prompt.command.fields.find(f => f.kind === 'pick' && f.key === 'piece');
  if (lead && picks.piece) await p.locator('.island-settlers-choices label')
    .nth(lead.options.findIndex(o => o.value === picks.piece)).click();
  await spot(p, picks.tile);
  const sheet = p.locator('.island-settlers-sheet');
  if (picks.victim) {
    const name = pub.seats.find(s => s.id === picks.victim).name;
    await sheet.getByRole('radio').filter({ hasText: name }).first().click();
  }
  await sheet.getByRole('button', { name: /^(Rob .+|Move robber here)$/ }).first().click();
}

async function offerCard(p, pub, offer) {
  const from = pub.seats.find(s => s.id === offer.from).name;
  const cards = () => p.locator('.island-settlers-duty[data-kind="offer"] article')
    .filter({ has: p.locator('header b', { hasText: from }) });
  const more = p.locator('.island-settlers-more');
  if (!await visible(cards()) && await visible(more)) await more.click();
  if (!await visible(cards())) { await home(p); await tab(p, 'Trade'); }
  return await visible(cards()) ? cards().first()
    : p.locator('.island-settlers-trade-incoming article')
      .filter({ has: p.locator('header b', { hasText: from }) }).first();
}

/** Set one composer row to `target` using the + (card face) and − chips. */
async function setRow(p, row, verb, target, current) {
  for (const g of new Set([...Object.keys(target), ...Object.keys(current)])) {
    let n = current[g] ?? 0;
    const want = target[g] ?? 0;
    for (; n < want; n++) await row.getByRole('button', { name: new RegExp(`^${verb} ${LABEL[g]}`) }).click();
    const less = row.getByRole('button', { name: `One less ${LABEL[g].toLowerCase()}` });
    for (; n > want; n--) await less.click();
  }
}

/** Execute one CPU-chosen action through the phone UI. Returns false for actions the UI never sends. */
export async function execute(phone, a) {
  const p = phone.page, { publicView: pub, privateView: me } = phone.current;
  switch (a.type) {
    case 'roll': {
      await home(p);
      await p.locator('button.island-settlers-roll, button.island-settlers-dock-roll').first().click();
      return true;
    }
    case 'end': {
      await home(p);
      await p.locator('.island-settlers-end').click();
      return true;
    }
    case 'build': await place(p, a.piece, a.at); return true;
    case 'buy-dev': {
      await home(p); await tab(p, 'Cards');
      await p.locator('.island-settlers-buy').getByRole('button').click();
      await p.locator('.island-settlers-sheet').getByRole('button', { name: 'Buy dev card' }).click();
      return true;
    }
    case 'play-dev': {
      const kind = me.dev.find(d => d.id === a.card).kind;
      await home(p); await tab(p, 'Cards');
      await p.locator(`.island-settlers-devs li[data-kind="${kind}"]`).getByRole('button', { name: 'Play' })
        .first().click();
      if (kind === 'plenty') {
        const goods = Object.fromEntries(a.goods.map(g => [g, a.goods.filter(x => x === g).length]));
        await tapCards(p, 'Pick', goods);
        await p.getByRole('button', { name: /^Take \d from the bank$/ }).click();
      }
      if (kind === 'monopoly') await p.getByRole('button', { name: `Take everyone's ${a.goods[0]}` }).click();
      return true;
    }
    case 'bank': {
      await home(p); await tab(p, 'Trade');
      await p.getByRole('group', { name: 'Trade with' }).getByRole('button', { name: 'Bank' }).click();
      const bank = p.getByRole('region', { name: 'Trade with the bank' });
      const clear = bank.getByRole('button', { name: 'Clear' });
      if (await clear.isEnabled()) await clear.click();
      for (const [g, n] of Object.entries(a.give)) for (let i = 0; i < n / (me.rates[g] || 4); i++) {
        await bank.getByRole('button', { name: new RegExp(`^Give ${LABEL[g]}`) }).click();
      }
      for (const [g, n] of Object.entries(a.get)) for (let i = 0; i < n; i++) {
        await bank.getByRole('button', { name: new RegExp(`^Get ${LABEL[g]}`) }).click();
      }
      await bank.getByRole('button', { name: /^Trade .+ for .+/ }).click();
      return true;
    }
    case 'offer': {
      let composer;
      if (a.counterTo) {
        const parent = pub.offers.find(o => o.id === a.counterTo);
        await (await offerCard(p, pub, parent)).getByRole('button', { name: 'Counter' }).click();
        composer = p.getByRole('region', { name: 'Counter-offer' });
        const give = Object.fromEntries(Object.entries(parent.want)
          .map(([g, n]) => [g, Math.min(n, me.hand[g] ?? 0)]).filter(([, n]) => n > 0));
        await setRow(p, composer.getByRole('group', { name: 'You give' }), 'Give', a.give, give);
        await setRow(p, composer.getByRole('group', { name: 'You get' }), 'Get', a.want, parent.give);
        await composer.getByRole('button', { name: 'Send counter' }).click();
        return true;
      }
      await home(p); await tab(p, 'Trade');
      await p.getByRole('group', { name: 'Trade with' }).getByRole('button', { name: 'Players' }).click();
      composer = p.getByRole('region', { name: 'New offer' });
      const clear = composer.getByRole('button', { name: 'Clear' });
      if (await clear.isEnabled()) await clear.click();
      await setRow(p, composer.getByRole('group', { name: 'You give' }), 'Give', a.give, {});
      await setRow(p, composer.getByRole('group', { name: 'You get' }), 'Get', a.want, {});
      if (a.to.length && me.partners.length > 1) {
        for (const id of a.to) await composer.getByRole('group', { name: 'Send to' })
          .getByRole('button', { name: new RegExp(esc(pub.seats.find(s => s.id === id).name)) }).click();
      }
      await composer.getByRole('button', { name: 'Offer', exact: true }).click();
      return true;
    }
    case 'respond': {
      const card = await offerCard(p, pub, pub.offers.find(o => o.id === a.offer));
      const name = a.answer === 'accept' ? 'Accept' : /^(Decline|Cancel)$/;
      await card.getByRole('button', { name, exact: a.answer === 'accept' }).first().click();
      return true;
    }
    case 'confirm-trade': case 'withdraw': {
      await home(p); await tab(p, 'Trade');
      const mine = p.locator('article[data-mine]').first();
      const who = pub.seats.find(s => s.id === a.partner)?.name;
      const name = a.type === 'withdraw' ? 'Withdraw' : `Trade with ${who}`;
      await mine.getByRole('button', { name }).click();
      return true;
    }
    case 'answer': {
      const prompt = me.prompts.find(q => q.id === a.prompt);
      if (prompt.kind === 'robber') await robber(p, pub, prompt, a.picks);
      else if (prompt.kind === 'discard') {
        await tapCards(p, 'Discard', a.cards.cards);
        await p.getByRole('button', { name: prompt.command.label, exact: true }).click();
      } else await commandSheet(p, prompt.command, a);
      return true;
    }
    case 'skip-paired':
      await p.getByRole('checkbox', { name: 'Skip my next build turn' }).click();
      return true;
    case 'command': {
      // Module commands open from their Build (or Cards) tab row, then the generic command sheet.
      const c = me.commands.find(x => x.id === a.command);
      await home(p); await tab(p, ['cards', 'progress'].includes(c.group) ? 'Cards' : 'Build');
      const row = p.locator('button.island-settlers-row').filter({ has: p.locator('b', { hasText: c.label }) });
      await ((await visible(row)) ? row : p.getByRole('button', { name: c.label })).first().click();
      await commandSheet(p, c, a);
      return true;
    }
    case 'move-ship': {
      await home(p); await tab(p, 'Build');
      await p.locator('button.island-settlers-row').filter({ has: p.locator('b', { hasText: 'Move a ship' }) })
        .first().click();
      await spot(p, a.from); await spot(p, a.to);
      await p.locator('.island-settlers-confirm button').first().click();
      return true;
    }
    default: return false; // intent is sent by the placement screens themselves
  }
}

/**
 * True once the page paints its latest snapshot (task title and hand counts). A busy page, like the seated
 * host drawing the 3D board, can paint late; a player reads the screen before tapping, as does the driver.
 */
async function synced(ph) {
  const me = ph.current.privateView, p = ph.page;
  const shown = await p.locator('.island-settlers-hand .island-settlers-cards [data-good]').evaluateAll(els =>
    els.map(e => [e.getAttribute('data-good'),
      Number(e.querySelector('.island-settlers-count')?.textContent)]));
  return shown.every(([g, n]) => n === (me.hand[g] ?? 0))
    && await p.getByText(me.task.title, { exact: true }).first().isVisible();
}

/** Plays every observed phone with its own brain until `stop()`; returns the counters. */
export async function play(phones, { stop, level = 'normal', log = () => {}, onAction = () => {} }) {
  const stats = { accepted: 0, rejected: [], uiMisses: [], stale: 0, types: {}, skipped: 0 };
  const brains = phones.map((ph, i) => ({ level, persona: ['trader', 'roads'][i % 2], memory: null,
    random: seeded(101 + i), nextAt: 0 }));
  let idle = Date.now();
  while (!(await stop())) {
    let acted = false;
    for (const [i, ph] of phones.entries()) {
      if (!ph.current?.privateView || !ph.current.publicView?.turn || Date.now() < brains[i].nextAt) continue;
      if (!await synced(ph).catch(() => false)) continue;
      const snap = ph.current;
      const d = decide(snap.publicView, snap.privateView, brains[i]);
      // The scheduler's think delays: a brain that is asked every frame would give up on offers at once.
      const pause = d.pace === 'respond' ? 1200 : 700;
      Object.assign(brains[i], { memory: d.memory, nextAt: Date.now() + pause });
      if (!d.action || d.action.type === 'intent') continue;
      const before = ph.acks.length, rev = ph.revision;
      try {
        if (!await execute(ph, d.action)) { stats.skipped++; continue; }
        await until(() => ph.acks.slice(before).some(k => k.payload?.type === d.action.type), 'ack', 8000);
      } catch (e) {
        // The table moved on while we tapped (an offer answered, a timeout): not a UI fault; decide again.
        const view = x => JSON.stringify([x.privateView, x.publicView.offers, x.publicView.turn]);
        if (view(ph.current) !== view(snap)) {
          stats.stale++;
          await home(ph.page).catch(() => {});
          continue;
        }
        const buttons = await ph.page.locator('button:visible').allInnerTexts().catch(() => []);
        stats.uiMisses.push(`${ph.name} ${d.action.type}: ${e.message.split('\n')[0]}`);
        log(`UI miss ${ph.name} ${JSON.stringify(d.action)} task=${snap.privateView.task.kind}: `
          + `${e.message.split('\n')[0]} | buttons: ${buttons.map(b => b.replace(/\s+/g, ' ')).join(' | ')}`);
        await onAction(ph, d.action, 'miss');
        await home(ph.page).catch(() => {});
        continue;
      }
      const acks = ph.acks.slice(before).filter(k => k.payload?.type !== 'intent');
      for (const k of acks.filter(k => !k.accepted)) {
        stats.rejected.push(`${ph.name} ${k.payload?.type}: ${k.reason}`);
        log(`REJECTED ${ph.name} ${JSON.stringify(k.payload)}: ${k.reason}`);
      }
      if (acks.some(k => k.accepted)) {
        stats.accepted++;
        stats.types[d.action.type] = (stats.types[d.action.type] ?? 0) + 1;
        await onAction(ph, d.action, 'ok');
      }
      await until(() => ph.revision > rev, 'new snapshot', 5000).catch(() => {});
      acted = true;
      idle = Date.now();
    }
    if (!acted) {
      if (Date.now() - idle > 150_000) throw new Error('stuck: no phone action for 150 s');
      await wait(250);
    }
  }
  return stats;
}
