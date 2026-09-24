/**
 * Sky Clash integration smoke test on an isolated build: a host display and two landscape touch phones play a real
 * room from lobby to results and replay. Phones fight with real CDP touches (pad, Attack, Smash, Special) steered from
 * the live snapshots, plus the keyboard for up-special recoveries.
 * Usage: PLAYWRIGHT=<playwright/index.mjs> [PARTY_CHROMIUM=<browser binary>] node smoke.mjs <base-url> <out-dir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
const [base, out] = process.argv.slice(2), { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.PARTY_CHROMIUM ? { executablePath: process.env.PARTY_CHROMIUM } : {}), contexts = [], report = { assertions: [], errors: [], phones: {} };
const check = (ok, message) => { if (!ok) throw new Error(`FAILED: ${message}`); report.assertions.push(message); };
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const watch = (page, label) => {
  const data = { view: null, events: new Map(), sent: [], views: 0, heavy: [] };
  page.on('request', r => { if (/three\.module|GLTFLoader|\.glb(\?|$)/.test(r.url())) data.heavy.push(r.url()); });
  page.on('pageerror', e => report.errors.push(`${label}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /sky|model|glb/i.test(m.text()))) report.errors.push(`${label} ${m.type()}: ${m.text()}`); });
  page.on('websocket', ws => {
    ws.on('framereceived', f => { try { const p = JSON.parse(String(f.payload)); if (p.type === 'game.snapshot' && p.publicView) { data.view = p.publicView; data.views++; for (const e of p.publicView.events ?? []) data.events.set(e.id, e); } } catch { /* not JSON */ } });
    ws.on('framesent', f => { try { const p = JSON.parse(String(f.payload)); if (p.type?.startsWith('input.')) data.sent.push({ type: p.type, payload: p.payload }); } catch { /* not JSON */ } });
  });
  return data;
};
const names = ['Ada Lovelace', 'Bram'], picks = [{ fighter: 'Marth', costume: 2, stage: 'Battlefield' }, { fighter: 'Link', costume: 1, stage: 'Battlefield' }];
try {
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); contexts.push(hostCtx);
  const host = await hostCtx.newPage(), hostData = watch(host, 'host');
  await host.goto(`${base}/?game=sky-clash`); await host.waitForTimeout(800);
  for (const name of ['Add to library', 'Play on this screen']) { const b = host.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) { await b.click(); await host.waitForTimeout(600); } }
  await host.locator('.kp-code').waitFor({ timeout: 10000 }); const code = (await host.locator('.kp-code').textContent()).trim();
  const phones = [];
  for (const [i, name] of names.entries()) {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }); contexts.push(ctx);
    const page = await ctx.newPage(), data = watch(page, `phone${i + 1}`);
    await page.goto(`${base}/?join=${code}`); await page.getByRole('textbox', { name: 'Your name' }).fill(name);
    await page.getByRole('button', { name: 'Join the room' }).click();
    phones.push({ page, data, ctx, name, cdp: await ctx.newCDPSession(page), stats: { taps: 0, recoveries: 0 } });
  }
  const play = host.getByRole('button', { name: 'Play Sky Clash', exact: true }); if (await play.isVisible().catch(() => false)) await play.click();
  await host.getByRole('button', { name: 'Settings', exact: true }).click();
  await host.getByRole('group', { name: 'Stocks' }).getByRole('button', { name: '1', exact: true }).click();
  await host.getByRole('group', { name: 'Time limit (minutes)' }).getByRole('button', { name: '2', exact: true }).click();
  await host.getByRole('group', { name: 'CPU fighters' }).getByRole('button', { name: '2', exact: true }).click();
  await host.getByRole('group', { name: 'CPU level' }).getByRole('button', { name: 'Hard', exact: true }).click();
  await shot(host, 'host-settings-1280x720');
  await host.getByRole('button', { name: 'Apply settings' }).click(); await host.waitForTimeout(500);
  for (const [i, { page }] of phones.entries()) {
    const p = picks[i];
    await page.getByRole('button', { name: p.fighter, exact: true }).click();
    await page.getByRole('group', { name: 'Costume' }).first().getByRole('button').nth(p.costume).click();
    await page.waitForTimeout(300); await shot(page, `phone${i + 1}-fighter-844x390`);
    await page.getByRole('button', { name: 'Next: stage vote' }).click();
    await page.getByRole('button', { name: new RegExp(`^${p.stage},`) }).click();
    await page.waitForTimeout(300); await shot(page, `phone${i + 1}-stage-844x390`);
    await page.getByRole('button', { name: 'Ready!' }).click();
  }
  await phones[1].page.getByText(/Locked in/).waitFor(); await shot(phones[1].page, 'phone2-ready-844x390');
  await host.waitForTimeout(600); await shot(host, 'host-lobby-ready-1280x720');
  await host.getByRole('button', { name: 'Start game', exact: true }).click();
  await phones[0].page.getByRole('button', { name: 'Attack', exact: true }).waitFor({ timeout: 45000 });
  check((await Promise.all(phones.map(p => p.page.locator('canvas').count()))).every(n => n === 0), 'phones never mount a 3D canvas');
  check(phones.every(p => !p.data.heavy.length) && hostData.heavy.some(u => u.includes('.glb')), 'only the display downloads three.js and fighter GLBs');
  await host.locator('.sc-banner-count').waitFor({ timeout: 20000 }).catch(() => {}); await shot(host, 'host-countdown-1280x720');
  await host.waitForFunction(() => document.querySelector('.sky-clash-hud')?.className.includes('sc-phase-fight'), null, { timeout: 20000 });
  const view0 = hostData.view;
  report.match = { stage: view0.stageId, fighters: view0.fighters.map(f => ({ id: f.id, name: f.name, fighter: f.fighter, costume: f.costume, cpu: !!f.cpu })) };
  for (const [i, p] of phones.entries()) { const me = view0.fighters.find(f => f.name === p.name); check(me && me.fighter === picks[i].fighter.toLowerCase() && me.costume === picks[i].costume, `${p.name} fights as ${picks[i].fighter} in costume ${picks[i].costume}`); p.id = me.id; }
  check(view0.stageId === 'battlefield', 'the unanimous stage vote wins');
  // Bot: approach the nearest rival with the pad, then attack; recover with Up + Special (keyboard) when offstage.
  for (const p of phones) {
    const box = n => p.page.getByRole('button', { name: n, exact: true }).boundingBox();
    p.btn = { Attack: await box('Attack'), Smash: await box('Smash'), Special: await box('Special'), Jump: await box('Jump'), Grab: await box('Grab') };
    const pad = await p.page.getByRole('button', { name: /^Move/ }).boundingBox(); p.pad = { x: pad.x + pad.width / 2, y: pad.y + pad.height / 2, w: pad.width };
  }
  const centre = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const act = async (p, t) => {
    const v = p.data.view; if (!v) return;
    const me = v.fighters.find(f => f.id === p.id); if (!me || me.state === 'out' || me.stocks <= 0) return;
    const foes = v.fighters.filter(f => f.id !== me.id && f.stocks > 0 && f.state !== 'out').sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
    const offstage = Math.abs(me.x) > 5.3 || me.y < -0.4;
    if (offstage) { // Up + Special toward the stage.
      p.stats.recoveries++; const side = me.x > 0 ? 'a' : 'd';
      await p.page.keyboard.down(side); await p.page.keyboard.down('w'); await p.page.keyboard.press('k'); await sleep(120); await p.page.keyboard.press('l'); await sleep(250);
      await p.page.keyboard.up('w'); await p.page.keyboard.up(side); return;
    }
    const foe = foes[0]; if (!foe) return;
    const dx = foe.x - me.x, dir = Math.sign(dx) || 1, edge = Math.abs(me.x + dir * .8) > 4.8;
    if (Math.abs(dx) > 1.3 && !edge) { // Walk or run toward the rival with a held thumb.
      await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p.pad, id: 1 }] });
      await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.pad.x + dir * p.pad.w * .38, y: p.pad.y, id: 1 }] });
      await sleep(260); await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); return;
    }
    const which = t % 5 === 0 ? 'Smash' : t % 7 === 0 ? 'Special' : foe.y - me.y > 1 ? 'Jump' : t % 2 === 0 && me.grounded && Math.abs(dx) < 1 ? 'Grab' : 'Attack', c = centre(p.btn[which]);
    await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...c, id: 7 }] }); await sleep(which === 'Smash' ? 160 : 70);
    await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); p.stats.taps++;
  };
  const started = Date.now(); let t = 0, shots = 0, ended = false;
  while (Date.now() - started < 230000) {
    t++; await Promise.all(phones.map(p => act(p, t)));
    if (Date.now() - started > shots * 9000) { await shot(host, `host-fight-${String(shots).padStart(2, '0')}-1280x720`); if (shots === 1) await shot(phones[0].page, 'phone1-controller-844x390'); shots++; }
    if (await host.locator('.sc-banner-end').isVisible().catch(() => false)) { ended = true; await shot(host, 'host-game-banner-1280x720'); break; }
    if (await host.getByRole('button', { name: 'Play again' }).isVisible().catch(() => false)) break;
    await sleep(40);
  }
  report.fightSeconds = Math.round((Date.now() - started) / 1000);
  check(ended, 'the GAME!/TIME! banner shows on the display before results');
  const events = [...hostData.events.values()];
  report.events = Object.fromEntries(['hit', 'ko', 'shield', 'grab', 'throw', 'projectile', 'land', 'jump'].map(k => [k, events.filter(e => e.kind === k).length]));
  for (const p of phones) report.phones[p.name] = { ...p.stats, hitsLanded: events.filter(e => e.kind === 'hit' && e.source === p.id).length, states: p.data.sent.filter(s => s.type === 'input.state').length, grabs: events.filter(e => e.kind === 'grab' && e.source === p.id).length, grabPresses: Math.max(0, ...p.data.sent.map(s => s.payload?.presses?.grab ?? 0)), releases: p.data.sent.filter(s => s.type === 'input.release').length };
  check(phones.some(p => report.phones[p.name].hitsLanded > 0), 'a phone player lands hits with real touch input');
  check(report.events.ko > 0, 'at least one KO happens');
  check(events.some(e => e.kind === 'grab' && phones.some(p => p.id === e.source)), 'a phone player grabs with the dedicated Grab button');
  for (const p of phones) { const a = p.data.sent.filter(s => s.type === 'input.state').map(s => s.payload.presses.attack); check(a.every((v, i) => !i || v >= a[i - 1]), `${p.name}'s attack counter never decreases`); }
  check(phones.every(p => !p.data.heavy.length), 'phones still loaded no three.js or GLBs after the fight');
  await host.getByRole('button', { name: 'Play again' }).waitFor({ timeout: 90000 });
  await host.waitForTimeout(1500); await shot(host, 'host-results-1280x720');
  for (const [i, { page }] of phones.entries()) await shot(page, `phone${i + 1}-results-844x390`);
  report.results = await host.locator('.sc-res-list li').allTextContents();
  check(report.results.length === 4, 'results list both players and both CPUs');
  await host.getByRole('button', { name: 'Play again' }).click();
  for (const { page } of phones) await page.getByRole('heading', { name: 'Choose your fighter' }).waitFor({ timeout: 20000 });
  check(true, 'replay returns both phones to fighter selection');
  await host.waitForTimeout(800); await shot(host, 'host-replay-lobby-1280x720'); await shot(phones[0].page, 'phone1-replay-lobby-844x390');
} catch (error) { report.failure = String(error?.stack ?? error); for (const [i, c] of contexts.entries()) for (const page of c.pages()) await page.screenshot({ path: `${out}/failure-${i}.png` }).catch(() => {}); } finally {
  report.errors = [...new Set(report.errors)];
  writeFileSync(`${out}/smoke.json`, JSON.stringify(report, null, 1)); console.log(JSON.stringify(report, null, 1));
  for (const c of contexts) await c.close(); await browser.close();
}
