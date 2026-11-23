/**
 * Two real phones trade with each other through the real UI: one composes an offer to the other by name,
 * the other accepts, and both hands and the TV show it. A third seat is a CPU. Connect rounds with quick
 * start, so both phones are in the same window seconds after the start.
 *
 *   node --import tsx packages/games/island-settlers/tools/qa-trade.mjs --base http://127.0.0.1:4421 --out output/settlers-pass/trade
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execute, observe, until } from '../tests/browser/driver.mjs';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(a => {
  const [k, ...v] = a.trim().split(' ');
  return [k, v.join(' ') || '1'];
}));
const base = args.base ?? 'http://127.0.0.1:4421', out = args.out ?? 'output/settlers-pass/trade';
const pw = `${process.env.PLAYWRIGHT_CORE ?? `${homedir()}/.local/opt/pw/node_modules`}/playwright-core/index.mjs`;
const { chromium } = await import(pw);
mkdirSync(out, { recursive: true });
const tvBrowser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const phoneBrowser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });

const hostPage = await (await tvBrowser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const host = observe(hostPage, 'host');
hostPage.setDefaultTimeout(30000);
await hostPage.goto(`${base}/?game=island-settlers`);
await hostPage.getByRole('button', { name: 'Add to library' }).first().click();
await hostPage.getByRole('button', { name: 'Play on this screen' }).click();
await hostPage.getByRole('button', { name: 'Watch only' }).click();
const code = (await hostPage.locator('.kp-code').first().textContent()).trim();
await hostPage.getByRole('button', { name: 'Settings', exact: true }).click();
await hostPage.getByRole('button', { name: 'Game rules' }).click();
await hostPage.locator('.island-settlers-settings select').first().selectOption('3');
await hostPage.locator('.island-settlers-settings').getByText('Connect rounds', { exact: true }).click();
await hostPage.locator('.island-settlers-settings').getByText('120 s', { exact: true }).first().click();
await hostPage.getByRole('switch', { name: /^Quick start/ }).click();
await hostPage.getByRole('button', { name: 'Apply settings' }).click();

const phones = [];
for (const [i, name] of ['Ana Longname1234', 'Bo Navigator5678'].entries()) {
  const viewport = i ? { width: 320, height: 568 } : { width: 390, height: 844 };
  const page = await (await phoneBrowser.newContext({ viewport, isMobile: true, hasTouch: true })).newPage();
  const data = observe(page, name);
  await page.goto(`${base}/?join=${code}`);
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.getByRole('button', { name: 'Join the room' }).click();
  await page.getByRole('button', { name: 'Ready to play' }).click();
  phones.push(data);
}
await until(() => hostPage.getByRole('button', { name: 'Start game' }).isEnabled(), 'start enabled', 30000);
await hostPage.getByRole('button', { name: 'Start game' }).click();
const [a, b] = phones;
const mine = p => p.current?.privateView, stage = p => p.current?.publicView?.turn?.stage;
// The captain rolls (either phone or the CPU), then the window is open for both.
await until(async () => {
  for (const p of phones) if (mine(p)?.can.roll) await execute(p, { type: 'roll' }).catch(() => {});
  return phones.every(p => stage(p) === 'round' && mine(p)?.can.propose);
}, 'both phones in the window', 90000, 400);
const idOf = p => mine(p).seat, hand = p => ({ ...mine(p).hand });
const give = Object.keys(hand(a)).find(g => hand(a)[g] > 0 && !(hand(b)[g] > 3));
const want = Object.keys(hand(b)).find(g => hand(b)[g] > 0 && g !== give);
if (!give || !want) throw new Error(`no trade possible: ${JSON.stringify([hand(a), hand(b)])}`);
const before = { a: hand(a), b: hand(b) };
await execute(a, { type: 'offer', give: { [give]: 1 }, want: { [want]: 1 }, to: [idOf(b)], counterTo: null });
await until(() => b.current.publicView.offers.some(o => o.from === idOf(a) && o.responses[idOf(b)] === 'pending'), 'offer on B', 10000);
await a.page.waitForTimeout(600);
await shot(a.page, 'phone-a-offer-sent');
await shot(b.page, 'phone-b-offer-received');
await shot(hostPage, 'tv-offer-open');
const offer = b.current.publicView.offers.find(o => o.from === idOf(a));
await execute(b, { type: 'respond', offer: offer.id, answer: 'accept' });
await until(() => (hand(a)[want] ?? 0) === (before.a[want] ?? 0) + 1 && (hand(b)[give] ?? 0) === (before.b[give] ?? 0) + 1, 'cards moved', 10000);
await a.page.waitForTimeout(900);
await shot(a.page, 'phone-a-traded');
await shot(b.page, 'phone-b-traded');
await shot(hostPage, 'tv-traded');
const event = host.current.publicView.events.find(e => e.kind === 'trade' && e.seat === idOf(a) && e.partner === idOf(b));
const summary = {
  code, give, want, before, after: { a: hand(a), b: hand(b) }, tvEvent: event?.text ?? null,
  acks: phones.map(p => p.acks.filter(k => k.payload?.type !== 'intent').map(k => `${k.payload?.type}:${k.accepted}`)),
  errors: [host, ...phones].flatMap(p => p.errors.map(e => `${p.name}: ${e}`)),
};
writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await tvBrowser.close();
await phoneBrowser.close();
if (!event) process.exitCode = 1;
