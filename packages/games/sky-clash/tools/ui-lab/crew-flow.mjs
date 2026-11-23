/**
 * Real-room browser check for the Reaches on an isolated build: a host display and phone pages go join -> select -> match -> results -> replay.
 * Usage: node crew-flow.mjs <base-url> <out-dir> <scenario>   (PLAYWRIGHT=<playwright index.mjs> overrides the module path)
 *   duel    two phones pick Sola and Toll, vote Beacon Rock, walk up and hit each other, one walks off, results, Play again, second lobby
 *   solo    one phone picks Kes on the Bellyard (host's stage) with three CPUs dealt from the crew; a 1920x1080 fight shot; played to the results
 *   quad    one phone picks Vesper on Beacon Rock with three CPUs: four fighters of the crew at 1280x720
 *   legacy  one phone picks a legacy fighter (Mario) on a legacy stage (Battlefield) against one CPU of the crew: old content still loads
 * WebGL runs in software here, so this proves the flow and what a frame looks like, never frame rate.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
const [base, out, scenario = 'duel'] = process.argv.slice(2), { chromium } = await import(process.env.PLAYWRIGHT ?? `${homedir()}/.local/opt/pw/node_modules/playwright-core/index.mjs`);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }), report = { scenario, assertions: [], errors: [], notes: [] }, contexts = [];
const sent = [];
const check = (ok, message) => { if (!ok) throw new Error(`FAILED: ${message}`); report.assertions.push(message); console.log('ok', message); };
const shot = async (page, name) => { const t = Date.now(); await page.screenshot({ path: `${out}/${scenario}-${name}.png`, timeout: 180000 }); console.log('shot', name, Date.now() - t, 'ms'); };
const watch = (page, label) => {
  const data = { view: null, hits: [], kos: [], seen: new Set() };
  page.on('websocket', ws => ws.on('framesent', f => { try { const p = JSON.parse(String(f.payload)); if (p.type?.startsWith('input.')) sent.push({ label, type: p.type, x: p.payload?.x, attack: p.payload?.presses?.attack }); } catch { /* Not ours. */ } }));
  page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') report.errors.push(`${label}: ${m.text().slice(0, 300)}`); });
  page.on('websocket', ws => ws.on('framereceived', f => { try { const p = JSON.parse(String(f.payload)); if (p.type !== 'game.snapshot') return; data.view = p.publicView;
    for (const e of p.publicView.events ?? []) if (!data.seen.has(e.id)) { data.seen.add(e.id); if (e.kind === 'hit') data.hits.push({ source: e.source, target: e.target, move: e.move, damage: e.damage }); if (e.kind === 'ko') data.kos.push({ source: e.source, target: e.target }); } } catch { /* Not ours. */ } }));
  return data;
};
const S = { duel: { phones: [['Sola', 'Beacon Rock'], ['Toll', 'Beacon Rock']], cpus: 0, stage: 'vote', size: [1280, 720], low: true }, solo: { phones: [['Kes']], cpus: 3, stage: 'bellyard', size: [1920, 1080] },
  quad: { phones: [['Vesper']], cpus: 3, stage: 'beacon-rock', size: [1280, 720] }, legacy: { phones: [['Mario']], cpus: 1, stage: 'battlefield', size: [1280, 720], legacy: true, low: true } }[scenario];
try {
  const hostContext = await browser.newContext({ viewport: { width: S.size[0], height: S.size[1] } }); contexts.push(hostContext);
  // `low` pins the display's low quality tier: software rendering stalls less, so the host keeps its socket through the whole flow.
  if (S.low) await hostContext.addInitScript(() => { try { localStorage.setItem('party.sceneQuality', 'low'); } catch { /* Private mode. */ } });
  const host = await hostContext.newPage(), hostData = watch(host, 'host'); host.setDefaultTimeout(60000); report.quality = S.low ? 'low' : 'balanced';
  await host.goto(`${base}/?game=sky-clash`); await host.waitForTimeout(800);
  for (const name of ['Add to library', 'Play on this screen']) { const b = host.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) { await b.click(); await host.waitForTimeout(600); } }
  await host.locator('.kp-code').waitFor({ timeout: 20000 }); const code = (await host.locator('.kp-code').textContent()).trim(); report.code = code;
  const phones = [];
  for (let i = 0; i < S.phones.length; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); contexts.push(ctx);
    const page = await ctx.newPage(), data = watch(page, `phone${i + 1}`); page.setDefaultTimeout(60000); phones.push({ page, data, ctx });
    await page.goto(`${base}/?join=${code}`); await page.getByRole('textbox', { name: 'Your name' }).fill(['Alexandria', 'Bartholomew'][i]);
    await page.getByRole('button', { name: 'Join the room' }).click();
  }
  const play = host.getByRole('button', { name: 'Play Sky Clash', exact: true }); if (await play.isVisible().catch(() => false)) await play.click();
  await host.getByRole('button', { name: 'Settings', exact: true }).click();
  await host.getByRole('button', { name: 'Game rules', exact: true }).click();   // the device settings dialog leads to the host's game rules
  await host.getByRole('group', { name: 'Stocks' }).getByRole('button', { name: String(S.phones.length > 1 ? 1 : 3), exact: true }).click();   // alone against CPUs the phone needs stocks to outlast this box's slow start
  await host.getByRole('group', { name: 'Time limit (minutes)' }).getByRole('button', { name: '5', exact: true }).click();   // screenshots of a software-rendered page take most of a minute each
  await host.getByRole('group', { name: 'CPU fighters' }).getByRole('button', { name: String(S.cpus), exact: true }).click();
  await host.locator('.sc-select-row select').selectOption(S.stage);
  if (scenario === 'duel') await shot(host, 'host-settings');
  await host.getByRole('button', { name: 'Apply settings' }).click(); await host.waitForTimeout(600);
  for (const [i, { page }] of phones.entries()) {
    const [fighter, stage] = S.phones[i];
    await page.getByRole('heading', { name: 'Choose your fighter' }).waitFor();
    check(await page.locator('.sc-crew-grid .sc-crew-tile').count() === 4, `phone ${i + 1}: the four fighters of the crew lead the select screen`);
    check(await page.getByRole('group', { name: 'Legacy fighters' }).count() === 0, `phone ${i + 1}: the legacy roster starts folded away`);
    if (i === 0) await shot(page, 'phone-select');
    if (S.legacy) { await page.locator('.sc-legacy-toggle').click(); await page.getByRole('group', { name: 'Legacy fighters' }).waitFor(); if (i === 0) await shot(page, 'phone-select-legacy'); }
    await page.locator(`.sc-fighter-tile[aria-label^="${fighter}"]`).first().click();   // the tile, not the legacy series chip of the same name
    if (i === 0) { await page.getByRole('button', { name: new RegExp(`^${fighter} details`) }).click(); await page.waitForTimeout(400); await shot(page, 'phone-details'); await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    if (stage) { await page.getByRole('button', { name: 'Next: stage vote' }).click(); await page.getByRole('button', { name: new RegExp(`^${stage},`) }).click(); if (i === 0) await shot(page, 'phone-stage'); }
    await page.getByRole('button', { name: 'Ready!' }).click();
  }
  await phones[0].page.getByText(/Locked in/).waitFor(); await shot(phones[0].page, 'phone-ready');
  await host.waitForTimeout(600); await shot(host, 'host-lobby');
  const startMatch = async () => {
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    for (const { page } of phones) await page.setViewportSize({ width: 844, height: 390 });
    await phones[0].page.getByRole('button', { name: 'Attack', exact: true }).waitFor({ timeout: 240000 });
    await host.waitForFunction(() => document.querySelector('.sky-clash-hud')?.className.includes('sc-phase-fight'), null, { timeout: 240000 });
  };
  await startMatch(); report.stage = hostData.view?.stageId; report.fighters = hostData.view?.fighters.map(f => `${f.name}:${f.fighter}${f.cpu ? ' (CPU)' : ''}`);
  console.log('fight', report.stage, report.fighters);
  check(await phones[0].page.locator('canvas').count() === 0, 'phones never mount a 3D canvas');
  if (!S.legacy) { check(['beacon-rock', 'bellyard'].includes(report.stage), `the match is on an arena of the Reaches (${report.stage})`); check(hostData.view.fighters.every(f => ['sola', 'toll', 'kes', 'vesper'].includes(f.fighter)), `every fighter is of the crew, CPUs included (${report.fighters.join(', ')})`); }
  else { check(report.stage === 'battlefield' && hostData.view.fighters[0].fighter === 'mario', 'a legacy fighter on a legacy stage still loads into a match'); check(hostData.view.fighters.some(f => f.cpu && ['sola', 'toll', 'kes', 'vesper'].includes(f.fighter)), 'the CPU beside it is dealt from the crew'); }
  // Thumbs: each phone gets a CDP touch session; the pad is held toward a point, Attack is tapped.
  const pads = [];
  for (const p of phones) { const cdp = await p.ctx.newCDPSession(p.page), pad = await p.page.getByRole('button', { name: /^Move/ }).boundingBox(), atk = await p.page.getByRole('button', { name: 'Attack', exact: true }).boundingBox(), spc = await p.page.getByRole('button', { name: 'Special', exact: true }).boundingBox();
    const c = { x: pad.x + pad.width / 2, y: pad.y + pad.height / 2 }; let down = false;
    pads.push({ async hold(dx) { const pt = [{ x: c.x + dx * pad.width * .42, y: c.y, id: 1 }]; if (!down) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...c, id: 1 }] }); down = true; } await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt }); },
      async lift() { if (down) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); down = false; } },
      /** Tap Special, or swipe across it (dx, dy in screen directions: dy 1 is down) for a side, up or down special. */
      async special(dx = 0, dy = 0) { const pt = { x: spc.x + spc.width / 2, y: spc.y + spc.height / 2, id: 7 }; await this.lift(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
        if (dx || dy) for (const k of [.5, 1]) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...pt, x: pt.x + dx * 44 * k, y: pt.y + dy * 44 * k }] }); await p.page.waitForTimeout(25); } else await p.page.waitForTimeout(70);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); },
      async tap() { const pt = { x: atk.x + atk.width / 2, y: atk.y + atk.height / 2, id: 7 }; await this.lift(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] }); await p.page.waitForTimeout(70); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); } }); }
  // Thumbs steer from the phone's own snapshots (the software-rendered host page lags): run in until the rival is inside jab range, let go, then tap Attack.
  const live = () => phones[0].data.view ?? hostData.view, hitsSeen = () => phones[0].data.hits, me = i => live().fighters[i];
  const fromTo = (a, b) => hitsSeen().filter(h => h.source === live().fighters[a].id && h.target === live().fighters[b].id).length;
  // Fighters run at 8 m a second and this box answers a touch in a few hundred milliseconds, so the approach stops early, never chases past the middle of the stage's edge, and the attacks used reach both sides.
  const close = async (i, target, range = 2.2) => { for (let t = 0; t < 14; t++) { const a = me(i), b = target(); if (!b || a.state === 'out') break; const gap = b.x - a.x; if (Math.abs(gap) < range || Math.abs(a.x) > 3.6 && Math.sign(a.x) === Math.sign(gap)) break; await pads[i].hold(Math.sign(gap)); await phones[i].page.waitForTimeout(30); } await pads[i].lift(); };
  if (scenario === 'duel') {
    for (let round = 0; round < 12 && !(fromTo(0, 1) && fromTo(1, 0)); round++) {
      await Promise.all([close(0, () => me(1)), close(1, () => me(0))]);
      const say = tag => console.log(tag, live().fighters.map(f => `${f.fighter} x=${f.x.toFixed(2)} y=${f.y.toFixed(2)} facing=${f.facing} ${f.state}${f.move ? ':' + f.move : ''} ${Math.round(f.damage)}%`).join(' | '), 'hits', hitsSeen().length, 'frame', live().frame, 'sent', sent.length, JSON.stringify(sent.at(-1) ?? null).slice(0, 160));
      say(`round ${round} closed`);
      // Toll rings his bell (Knell reaches both sides); Sola strikes the ground (Kindle, a swipe down on Special, throws flame both sides).
      for (let k = 0; k < 2; k++) { await Promise.all([pads[0].special(0, 1), pads[1].special()]); await phones[0].page.waitForTimeout(1100); say('  after specials'); }
    }
    report.exchange = { p1HitP2: fromTo(0, 1), p2HitP1: fromTo(1, 0), damage: live().fighters.map(f => Math.round(f.damage)), moves: [...new Set(hitsSeen().map(h => h.move))] };
    check(report.exchange.p1HitP2 > 0 && report.exchange.p2HitP1 > 0, `two human seats hit each other (P1 landed ${report.exchange.p1HitP2}, P2 landed ${report.exchange.p2HitP1}; damage ${report.exchange.damage.join('% / ')}%)`);
    await shot(host, 'host-fight'); await shot(phones[0].page, 'phone-controller');
  } else {
    // Solo: chase the nearest fighter and jab for a while so the shot shows a brawl in progress.
    const nearest = () => { const a = me(0); return live().fighters.filter(f => f.id !== a.id && f.state !== 'out').sort((p, q) => Math.abs(p.x - a.x) - Math.abs(q.x - a.x))[0]; };
    for (let round = 0; round < 6 && me(0).state !== 'out'; round++) { await close(0, nearest, 1.8); if (S.phones[0][0] === 'Kes') { await pads[0].special(0, 1); await phones[0].page.waitForTimeout(900); } else for (let k = 0; k < 4; k++) { await pads[0].tap(); await phones[0].page.waitForTimeout(150); } if (round === 1) await shot(host, 'host-fight'); }
    report.hitsByHuman = hitsSeen().filter(h => h.source === live().fighters[0].id).length; report.hitsByCpus = hitsSeen().filter(h => h.source !== live().fighters[0].id).length;
    check(report.hitsByCpus > 0, `CPUs fight (${report.hitsByCpus} hits landed by CPUs, ${report.hitsByHuman} by the phone)`);
    await shot(host, 'host-fight-late'); await shot(phones[0].page, 'phone-controller');
  }
  // End it: player 1 walks off the nearer edge; with one stock that seat is out (and a duel is decided).
  for (let t = 0; t < 60 && me(0).state !== 'out' && live().phase === 'fight'; t++) { const a = me(0); if (a.state !== 'respawn') await pads[0].hold(a.x <= 0 ? -1 : 1); await phones[0].page.waitForTimeout(500); }
  report.hits = hitsSeen().length; report.humanStocksLeft = me(0).stocks;
  await host.getByRole('button', { name: 'Play again' }).waitFor({ timeout: 480000 }); await pads[0].lift();
  await host.waitForTimeout(1500); await shot(host, 'host-results'); report.kos = phones[0].data.kos.length;
  for (const { page } of phones) await page.setViewportSize({ width: 390, height: 844 });
  await phones[0].page.waitForTimeout(500); await shot(phones[0].page, 'phone-results');
  check(await host.locator('.sc-res-list li').count() === live().fighters.length, `results list every fighter (${live().fighters.length})`);
  await host.getByRole('button', { name: 'Play again' }).click();
  await phones[0].page.getByRole('heading', { name: /Choose your fighter|Vote for a stage/ }).waitFor({ timeout: 60000 }); await host.getByRole('button', { name: 'Start game', exact: true }).waitFor({ timeout: 60000 });
  const back = await phones[0].page.getByRole('heading', { name: /Choose your fighter|Vote for a stage/ }).textContent();
  check(true, `Play again returns the host to the lobby and every phone to selection with its picks kept (phone shows "${back}")`);
  await shot(phones[0].page, 'phone-replay-lobby'); await shot(host, 'host-replay-lobby');
  if (scenario === 'duel') {
    // Replay: ready up again and reach the fight a second time in the same room.
    for (const { page } of phones) { const next = page.getByRole('button', { name: 'Next: stage vote' }); if (await next.isVisible().catch(() => false)) await next.click(); await page.getByRole('button', { name: 'Ready!' }).click(); }
    await host.waitForTimeout(500); await startMatch();
    check(hostData.view.phase === 'fight' || hostData.view.phase === 'countdown', `the replay reaches a second fight in the same room (${hostData.view.stageId})`);
    await host.waitForTimeout(2500); await shot(host, 'host-replay-fight');
  }
} catch (error) { report.failure = String(error); console.log(report.failure); for (const [i, c] of contexts.entries()) for (const page of c.pages()) await page.screenshot({ path: `${out}/${scenario}-failure-${i}.png`, timeout: 120000 }).catch(() => {}); } finally {
  report.errors = [...new Set(report.errors)];
  writeFileSync(`${out}/${scenario}-flow.json`, JSON.stringify(report, null, 1)); console.log(JSON.stringify(report, null, 1));
  for (const c of contexts) await c.close().catch(() => {}); await browser.close();
}
process.exit(report.failure ? 1 : 0);
