// Playwright CLI flow: real UI actions; WebSocket observation only. Run in bounded batches.
import { chooseExpansionAction as chooseAction } from './expansion-bot';
export default async function (page) {
  const browser = page.context().browser(), base = page.url().split('/').slice(0,3).join('/');
  const config = browser.__settlersConfig ?? { expansion: 'seafarers', mode: 'standard', scenarios: ['fishing', 'rivers', 'caravans', 'barbarian-attack', 'traders'], prefix: 'exp' };
  const qa = browser.__settlers ??= { phones: [], host: null, accepted: 0, types: {}, errors: [], reports: [], complete: false };
  const observe = target => {
    const data = { current: null, id: null, room: null, acks: [], maxBytes: 0, errors: [] };
    target.on('pageerror', e => data.errors.push(e.message));
    target.on('websocket', socket => socket.on('framereceived', frame => {
      const p = JSON.parse(String(frame.payload));
      if (p.type === 'room.welcome') { data.id = p.playerId; data.room = p.room; }
      if (p.type === 'room.state') data.room = p.room;
      if (p.type === 'game.snapshot' || p.type === 'round.results') { data.current = { ...p, publicView: { ...(data.current?.roundId === p.roundId ? data.current.publicView : {}), ...p.publicView } }; data.maxBytes = Math.max(data.maxBytes, String(frame.payload).length); }
      if (p.type === 'action.ack') data.acks.push(p);
      if (p.type === 'error') data.errors.push(p.reason);
    })); return data;
  };
  const wait = async (condition, label, timeout = 10000) => { const until = Date.now() + timeout; while (!condition()) { if (Date.now() > until) throw new Error(label); await page.waitForTimeout(30); } };
  if (!qa.host) {
    qa.host = observe(page); await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: 'Play on this screen', exact: true }).click();
    await page.locator('.kp-code').waitFor(); const code = await page.locator('.kp-code').textContent(); qa.code = code;
    for (let i = 0; i < (config.count ?? 10); i++) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const phone = await context.newPage(), data = observe(phone); qa.phones.push({ page: phone, data });
      await phone.goto(`${base}/?join=${code}`); await phone.getByRole('textbox', { name: 'Your name' }).fill(`NavigatorName0${String(i + 1).padStart(2, '0')}`); await phone.getByRole('button', { name: 'Join the room' }).click();
    }
    await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.locator('#is-points').fill('10'); await page.locator('#is-mode').selectOption(config.mode); await page.locator(`input[name="is-expansion"][value="${config.expansion}"]`).check(); if (config.citiesKnights !== false) await page.getByRole('switch', { name: /^Cities & Knights/ }).click(); const names = { fishing: 'Fishing on Catan', rivers: 'Rivers of Catan', caravans: 'Merchant Trains', 'barbarian-attack': 'Barbarian Attack', traders: 'Traders & Barbarians: deliveries' }; for (const key of config.scenarios) await page.getByRole('switch', { name: names[key], exact: true }).click(); await page.getByRole('button', { name: 'Apply settings', exact: true }).click();
    for (const phone of qa.phones) await phone.page.getByRole('button', { name: 'Ready to play', exact: true }).click();
    await page.getByRole('button', { name: 'Start game', exact: true }).click();
    await wait(() => qa.phones.every(p => p.data.current?.publicView.phase === 'setup'), 'ten phones ready');
    qa.round = qa.host.current.roundId;
    await page.screenshot({ path: `output/playwright/island-settlers/${config.prefix}-host-setup-1280.png` });
    await qa.phones[0].page.setViewportSize({ width: 320, height: 568 }); await qa.phones[0].page.screenshot({ path: `output/playwright/island-settlers/${config.prefix}-phone-setup-320.png`, fullPage: true });
    qa.reports.push({ layout: `${qa.phones.length}-player setup`, phones: qa.phones.length, phoneCanvas: await qa.phones[0].page.locator('canvas').count(), hostCanvas: await page.locator('canvas').count() });
  }
  const labels = { wood: 'Wood', brick: 'Brick', wool: 'Wool', grain: 'Grain', ore: 'Ore', paper: 'Paper', cloth: 'Cloth', coin: 'Coin' };
  const execute = async (phone, a) => {
    const target = phone.page, pub = phone.data.current.publicView;
    const pick = async id => { const spot = target.locator(`[data-spot="${id}"]`); await spot.press('Enter'); };
    const resources = async hand => { for (const [r, n] of Object.entries(hand)) for (let i = 0; i < n; i++) await target.getByRole('button', { name: `More ${labels[r]}`, exact: true }).click(); };
    if (a.type === 'roll') await target.getByRole('button', { name: 'Roll', exact: true }).click();
    else if (a.type === 'end') await target.getByRole('button', { name: /^(End turn|Ready for next round|Skip remaining routes|Finish turn|Finish building & move)$/ }).click();
    else if (a.type === 'build') {
      if (pub.phase !== 'setup') { await target.getByRole('tab', { name: 'Build', exact: true }).click(); await target.locator('.is-build-option').filter({ has: target.locator('strong', { hasText: new RegExp(`^${a.kind[0].toUpperCase() + a.kind.slice(1)}$`) }) }).click(); }
      await pick(a.target); await target.getByRole('button', { name: a.kind === 'road' || a.kind === 'ship' ? new RegExp(`^(Confirm ${a.kind}|Build ${a.kind} here)$`) : /^(Confirm (settlement|city|harbor settlement|harbor)|Build (settlement|city|harbor settlement|harbor) here)$/ }).click();
    } else if (a.type === 'discard' || a.type === 'gold') { await resources(a.cards); await target.getByRole('button', { name: a.type === 'discard' ? /^Discard \d/ : /^Take \d/ }).click(); }
    else if (a.type === 'robber') { await pick(a.target); if (a.victim) { const name = pub.players.find(p => p.id === a.victim).name; await target.getByRole('radiogroup', { name: 'Steal from' }).getByRole('radio').filter({ hasText: name }).click(); } await target.getByRole('button', { name: /^Confirm (robber|pirate)$/ }).click(); }
    else if (a.type === 'bank') { await target.getByRole('tab', { name: 'Trade', exact: true }).click(); await target.getByRole('radiogroup', { name: 'Good to give' }).getByRole('radio', { name: labels[a.give], exact: true }).click(); await target.getByRole('radiogroup', { name: 'Good to receive' }).getByRole('radio', { name: labels[a.get], exact: true }).click(); await target.getByRole('button', { name: /^Trade \d/ }).click(); }
    else if (a.type === 'buy-development') { await target.getByRole('tab', { name: 'Build', exact: true }).click(); await target.locator('.is-build-option').filter({ has: target.locator('strong', { hasText: /^Development card$/ }) }).click(); }
    else if (a.type === 'play-development') { await target.getByRole('tab', { name: /^Cards/ }).click(); await target.locator('.is-devlist li').filter({ has: target.locator('strong', { hasText: /^Knight$/ }) }).first().getByRole('button', { name: 'Play', exact: true }).click(); }
    else if (a.type === 'expansion') {
      const c = phone.data.current.privateView.expansion.commands.find(c => c.id === a.command);
      if (!c) throw new Error('Command missing: ' + a.command);
      if (await target.getByRole('tab', { name: /^More/ }).count()) await target.getByRole('tab', { name: c.group === 'Progress' ? /^Cards/ : /^More/ }).click();
      const label = /^[a-z0-9-]+$/.test(c.label) ? c.label.replaceAll('-', ' ').replace(/\b\w/g, x => x.toUpperCase()) : c.label;
      if (await target.locator('.is-command').count() && !await target.getByRole('button', { name: 'Confirm ' + label.toLowerCase(), exact: true }).count()) await target.locator('.is-command').getByRole('button', { name: '‹ Back', exact: true }).click();
      if (!await target.locator('.is-command').count()) await target.locator('.is-build-option').filter({ has: target.getByText(label, { exact: true }) }).first().click();
      for (const f of c.fields) {
        const value = a.choices[f.key]; if (value === undefined) continue;
        if (f.map) await pick(value);
        else await target.getByRole('radiogroup', { name: f.label, exact: true }).getByRole('radio').nth(f.options.findIndex(o => o.value === value)).click();
      }
      if (c.cards) await resources(a.cards);
      await target.getByRole('button', { name: 'Confirm ' + label.toLowerCase(), exact: true }).click();
    } else throw new Error(`UI action not handled: ${a.type}`);
  };
  qa.execute = execute; qa.choose = chooseAction;
  for (let i = 0; i < 40 && !qa.complete; i++) {
    const current = qa.host.current;
    if (current?.publicView.phase === 'ended') { qa.complete = true; break; }
    let choice;
    for (const p of qa.phones) { const snap = p.data.current; if (!snap || snap.publicView.pausedPlayers.length) continue; const a = chooseAction(snap.publicView, snap.privateView, p.data.id); if (a) { choice = { p, a }; break; } }
    if (!choice) { await page.waitForTimeout(100); continue; }
    const { p, a } = choice, revision = p.data.current.publicView.revision, ackCount = p.data.acks.length;
    try { await execute(p, a); await wait(() => p.data.acks.length > ackCount, 'Action acknowledgement'); if (!p.data.acks.at(-1).accepted) throw new Error(p.data.acks.at(-1).reason); await wait(() => qa.phones.every(phone => phone.data.current.publicView.revision > revision), `No new revision: ${JSON.stringify(a)}`); }
    catch (e) { await p.page.screenshot({ path: `output/playwright/island-settlers/${config.prefix}-flow-failure.png`, fullPage: true }); throw new Error(`${e.message}; action=${JSON.stringify(a)}; state=${JSON.stringify(p.data.current.privateView)}; body=${await p.page.locator('body').innerText()}`); }
    if (!qa.movementOverlap && qa.phones.some(p => p.data.current.privateView.expansion?.movement) && qa.phones.some(p => p.data.current.privateView.canAct && !p.data.current.privateView.expansion?.movement)) qa.movementOverlap = true;
    qa.accepted++; const key = a.type === 'expansion' ? a.command.split(':').slice(0, 2).join(':') : a.type; qa.types[key] = (qa.types[key] ?? 0) + 1;
    if (qa.accepted === 40) { await page.screenshot({ path: `output/playwright/island-settlers/${config.prefix}-host-board-1280.png` }); await page.setViewportSize({ width: 1920, height: 1080 }); await page.screenshot({ path: `output/playwright/island-settlers/${config.prefix}-host-board-1920.png` }); await page.setViewportSize({ width: 1280, height: 720 }); }
  }
  if (qa.complete && !qa.replayed) {
    await page.locator('.is-results').waitFor(); await page.screenshot({ path: `output/playwright/island-settlers/${config.prefix}-results-1280.png`, fullPage: true });
    qa.outcome = qa.host.current.outcome; await page.reload(); await page.locator('.is-results').waitFor();
    await page.getByRole('button', { name: 'Play again', exact: true }).click();
    for (const p of qa.phones) await p.page.getByRole('button', { name: 'Ready to play', exact: true }).click(); await page.getByRole('button', { name: 'Start game', exact: true }).click();
    await wait(() => qa.host.current.roundId !== qa.round && qa.host.current.publicView.phase === 'setup', 'fresh replay');
    if (qa.host.current.publicView.buildings.length || qa.host.current.publicView.routes.length) throw new Error('Replay retained board pieces'); qa.replayed = true;
  }
  return { code: qa.code, accepted: qa.accepted, types: qa.types, complete: qa.complete, replayed: qa.replayed, movementOverlap: qa.movementOverlap, turn: qa.host.current?.publicView.turn, scores: qa.host.current?.publicView.players.map(p => p.score), reports: qa.reports, outcome: qa.outcome, errors: [qa.host, ...qa.phones.map(p => p.data)].flatMap(p => p.errors), maxSnapshotBytes: Math.max(...qa.phones.map(p => p.data.maxBytes)) };

}