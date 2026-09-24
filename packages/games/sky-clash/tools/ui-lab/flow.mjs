/**
 * Real-room browser check for Sky Clash's UI on an isolated build: host display + phones through lobby → fight → results → replay.
 * Usage: PLAYWRIGHT=<playwright/index.mjs> node flow.mjs <base-url> <out-dir> [phones=2]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
const [base, out, count = '2'] = process.argv.slice(2), { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(), report = { assertions: [], errors: [], sent: [] }, contexts = [];
const check = (ok, message) => { if (!ok) throw new Error(`FAILED: ${message}`); report.assertions.push(message); };
const tracks = page => page.evaluate(() => [...document.querySelectorAll('audio[data-sky-track]')].map(a => a.dataset.skyTrack));
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
const watch = (page, label) => {
  const data = { view: null };
  page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') report.errors.push(`${label}: ${m.text()}`); });
  page.on('websocket', ws => { ws.on('framereceived', f => { try { const p = JSON.parse(String(f.payload)); if (p.type === 'game.snapshot') data.view = p.publicView; } catch { /* Binary or partial frames are not ours. */ } });
    ws.on('framesent', f => { try { const p = JSON.parse(String(f.payload)); if (p.type?.startsWith('input.')) report.sent.push({ label, type: p.type, payload: p.payload }); } catch { /* Ignore. */ } }); });
  return data;
};
try {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } }); contexts.push(hostContext);
  const host = await hostContext.newPage(), hostData = watch(host, 'host');
  await host.goto(`${base}/?game=sky-clash`); await host.waitForTimeout(800);
  for (const name of ['Add to library', 'Play on this screen']) { const b = host.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) { await b.click(); await host.waitForTimeout(600); } }
  await host.locator('.kp-code').waitFor({ timeout: 10000 }); const code = (await host.locator('.kp-code').textContent()).trim();
  const phones = [];
  for (let i = 0; i < Number(count); i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); contexts.push(ctx);
    const page = await ctx.newPage(), data = watch(page, `phone${i + 1}`); phones.push({ page, data, ctx });
    await page.goto(`${base}/?join=${code}`); await page.getByRole('textbox', { name: 'Your name' }).fill(['Alexandria Quinn', 'Bartholomew Kidd', 'Chrysanthemum Jo', 'Dominique Lefebv'][i]);
    await page.getByRole('button', { name: 'Join the room' }).click();
  }
  const play = host.getByRole('button', { name: 'Play Sky Clash', exact: true }); if (await play.isVisible().catch(() => false)) await play.click();
  // Quick rules: one stock, two minutes.
  await host.getByRole('button', { name: 'Settings', exact: true }).click();
  await host.getByRole('group', { name: 'Stocks' }).getByRole('button', { name: '1', exact: true }).click();
  await host.getByRole('group', { name: 'Time limit (minutes)' }).getByRole('button', { name: '2', exact: true }).click();
  await host.getByRole('button', { name: 'Apply settings' }).click(); await host.waitForTimeout(500);
  const picks = [['Mario', 'Battlefield'], ['Fox', 'Final Destination'], ['Kirby', 'Battlefield'], ['Random fighter', 'Random stage']];
  for (const [i, { page }] of phones.entries()) {
    await page.locator('.sc-fighter-tile').filter({ hasText: new RegExp(`^${picks[i][0] === 'Random fighter' ? 'Random' : picks[i][0]}$`) }).click();
    if (i === 0) await shot(page, 'phone-lobby-fighter-390x844');
    await page.getByRole('button', { name: 'Next: stage vote' }).click();
    await page.getByRole('button', { name: new RegExp(`^${picks[i][1]},`) }).click();
    if (i === 0) await shot(page, 'phone-lobby-stage-390x844');
  }
  await host.waitForTimeout(500); await shot(host, 'host-lobby-votes-1280x720');
  await host.mouse.click(5, 700); await host.waitForTimeout(300); report.lobbyTracks = await tracks(host);
  check(report.lobbyTracks.at(-1) === 'lobby.mp3', 'the host display streams the lobby song');
  check((await Promise.all(phones.map(p => tracks(p.page)))).every(t => !t.length), 'phones never load music');
  // Reload one phone mid-draft: its picks come back from lobbyChoice.
  await phones[1].page.reload(); await phones[1].page.getByRole('heading', { name: 'Vote for a stage' }).waitFor({ timeout: 10000 });
  check(await phones[1].page.getByRole('button', { name: /^Final Destination,/ }).getAttribute('aria-pressed') === 'true', 'a reloaded phone resumes its draft (fighter chosen, stage vote kept)');
  for (const { page } of phones) await page.getByRole('button', { name: 'Ready!' }).click();
  await phones[0].page.getByText(/Locked in/).waitFor(); await shot(phones[0].page, 'phone-lobby-ready-390x844');
  await host.waitForTimeout(400); await shot(host, 'host-lobby-ready-1280x720');
  await host.getByRole('button', { name: 'Start game', exact: true }).click();
  for (const { page } of phones) await page.setViewportSize({ width: 844, height: 390 });
  await phones[0].page.getByRole('button', { name: 'Attack', exact: true }).waitFor({ timeout: 30000 });
  check(await phones[0].page.locator('canvas').count() === 0, 'phones never mount a 3D canvas');
  await host.locator('.sc-banner-count').waitFor({ timeout: 15000 }).catch(() => {}); await shot(host, 'host-countdown-1280x720');
  await host.waitForFunction(() => document.querySelector('.sky-clash-hud')?.className.includes('sc-phase-fight'), null, { timeout: 15000 });
  await host.waitForTimeout(1500); await shot(host, 'host-fight-1280x720');
  report.fightTracks = await tracks(host); check(/^(adventure|bouken|triumph)/.test(report.fightTracks.at(-1) ?? ''), 'a battle track takes over for the fight'); await shot(phones[0].page, 'phone-controller-844x390');
  // Attack with a real touch on the Attack button; the server echoes the counter back.
  const p1 = phones[0], attack = await p1.page.getByRole('button', { name: 'Attack', exact: true }).boundingBox();
  const cdp = await p1.ctx.newCDPSession(p1.page), tap = async box => { const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 7 }; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] }); await p1.page.waitForTimeout(90); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  for (let i = 0; i < 3; i++) { await tap(attack); await p1.page.waitForTimeout(220); }
  const states = report.sent.filter(s => s.label === 'phone1' && s.type === 'input.state');
  check(states.length > 0 && Math.max(...states.map(s => s.payload.presses.attack)) >= 3, 'three Attack taps reach the server as monotonic press counters');
  check(states.every((s, i) => !i || s.payload.presses.attack >= states[i - 1].payload.presses.attack), 'attack counter never decreases');
  // A short hold then lift: the release is explicit and immediate.
  const pad = await p1.page.getByRole('button', { name: /^Move/ }).boundingBox(), c = { x: pad.x + pad.width / 2, y: pad.y + pad.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...c, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x + pad.width * .2, y: c.y, id: 1 }] }); await p1.page.waitForTimeout(200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p1.page.waitForTimeout(150);
  const last = report.sent.filter(s => s.label === 'phone1').at(-1);
  check(last.type === 'input.state' && last.payload.x === 0 && Object.values(last.payload.held).every(v => !v) && last.payload.presses.attack >= 3, 'lifting the thumb sends a neutral state that keeps the press counters');
  await p1.page.evaluate(() => window.dispatchEvent(new Event('blur'))); await p1.page.waitForTimeout(150);
  check(report.sent.filter(s => s.label === 'phone1').at(-1).type === 'input.release', 'window blur sends an explicit input.release');
  // Walk P1 off the left edge (one stock): GAME!, then results.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...c, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x - pad.width * .45, y: c.y + 4, id: 1 }] });
  await p1.page.waitForTimeout(600); await shot(p1.page, 'phone-controller-held-844x390');
  const ended = await host.locator('.sc-banner-end, .sky-clash-results').first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p1.page.waitForTimeout(150);
  report.lastAfterKo = report.sent.filter(s => s.label === 'phone1').at(-1)?.type;
  if (ended) { await shot(host, 'host-game-1280x720'); await shot(p1.page, 'phone-ko-844x390'); }
  report.walkedOff = ended;
  if (!ended) { await shot(host, 'host-no-ko-1280x720'); report.hostView = hostData.view && { phase: hostData.view.phase, fighters: hostData.view.fighters.map(f => ({ id: f.id, x: f.x, y: f.y, state: f.state, stocks: f.stocks })) }; }
  await host.getByRole('button', { name: 'Play again' }).waitFor({ timeout: 150000 });
  await host.waitForTimeout(1200); await shot(host, 'host-results-1280x720');
  for (const { page } of phones) await page.setViewportSize({ width: 390, height: 844 });
  await phones[0].page.waitForTimeout(400); await shot(phones[0].page, 'phone-results-390x844');
  check(await host.locator('.sc-res-list li').count() === Number(count), 'results list every fighter');
  await host.getByRole('button', { name: 'Play again' }).click();
  await phones[0].page.getByRole('heading', { name: 'Choose your fighter' }).waitFor({ timeout: 15000 });
  check(true, 'replay returns every phone to fighter selection');
  await shot(phones[0].page, 'phone-replay-lobby-390x844');
} catch (error) { report.failure = String(error); for (const [i, c] of contexts.entries()) for (const page of c.pages()) await page.screenshot({ path: `${out}/failure-${i}.png` }).catch(() => {}); } finally {
  report.errors = [...new Set(report.errors)]; report.sent = report.sent.length;
  writeFileSync(`${out}/flow.json`, JSON.stringify(report, null, 1)); console.log(JSON.stringify(report, null, 1));
  for (const c of contexts) await c.close(); await browser.close();
}
