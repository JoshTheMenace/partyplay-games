/** Headless screenshots of lab fixtures. Usage: PLAYWRIGHT=<playwright/index.mjs> [PARTY_CHROMIUM=<browser binary>] [SCALE=2] [CLIP=x,y,w,h] [REDUCED=1] [FULL=1] node shoot.mjs <base-url> <out-dir> screen@WxH[:m][!Button name] ... */
import { mkdirSync } from 'node:fs';
const [base, out, ...shots] = process.argv.slice(2), { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.PARTY_CHROMIUM ? { executablePath: process.env.PARTY_CHROMIUM } : {}), report = [];
for (const shot of shots) {
  const [, screen, w, h, mobile, click] = shot.match(/^([\w=&-]+)@(\d+)x(\d+)(:m)?(?:!(.+))?$/) ?? [];
  const context = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: Number(process.env.SCALE ?? 1), isMobile: !!mobile, hasTouch: !!mobile, reducedMotion: process.env.REDUCED ? 'reduce' : 'no-preference' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/?screen=${screen}`); await page.waitForTimeout(700);
  for (const name of click?.split('!') ?? []) { await page.getByRole('button', { name }).first().click(); await page.waitForTimeout(400); }
  // Overflow audit: any element wider than the viewport, and small active targets.
  const audit = await page.evaluate(() => {
    const vw = innerWidth, wide = [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > vw + 1 && getComputedStyle(e).position !== 'fixed' && !(e.parentElement && ['auto', 'scroll'].includes(getComputedStyle(e.parentElement).overflowX))).slice(0, 5).map(e => e.className || e.tagName);
    const small = [...document.querySelectorAll('button:not(:disabled), input, select, [role=switch]')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44) && !e.closest('.sc-seat-costume'); }).slice(0, 5).map(e => `${e.getAttribute('aria-label') ?? e.textContent?.slice(0, 20)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    return { wide, small, scroll: document.documentElement.scrollHeight };
  });
  const file = `${out}/${screen.replace(/[&=]/g, '-')}${click ? '-' + click.replace(/\W+/g, '') : ''}-${w}x${h}${process.env.REDUCED ? '-reduced' : ''}${process.env.CLIP ? '-clip' : ''}.png`;
  const [x, y, cw, ch] = (process.env.CLIP ?? '').split(',').map(Number);
  await page.screenshot({ path: file, fullPage: !!process.env.FULL, clip: process.env.CLIP ? { x, y, width: cw, height: ch } : undefined }); report.push({ file, errors, ...audit }); await context.close();
}
await browser.close(); console.log(JSON.stringify(report, null, 1));
