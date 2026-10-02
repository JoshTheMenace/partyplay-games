/* QA driver hook (tools/qa-driver.ts only; never imported by client code): plays the phone's bot moves through its real UI. */
import { SYMBOL_NAMES } from './types';

type Locator = { click(o?: object): Promise<void>; nth(i: number): Locator; locator(selector: string): Locator; textContent(o?: object): Promise<string | null>; count(): Promise<number> };
type Page = { locator(selector: string): Locator; getByRole(role: string, o?: object): Locator };
const wait = { timeout: 4000 }, pause = (ms: number) => new Promise(done => setTimeout(done, ms));

/** Returns true when the move was made by tapping the phone; false lets the driver fall back to its socket. */
export async function ui(page: Page, a: Record<string, unknown>): Promise<boolean> {
  try {
    const choice = (i: unknown) => page.locator('.hj-choice').nth(Number(i));
    // Think like a human first, so the driver's phone screenshots (all three viewports) catch every task screen.
    await pause(4000);
    if (a.k === 'answer') await choice(a.option).click(wait);
    else if (a.k === 'cup') await choice(a.cup).click(wait);
    else if (a.k === 'room') await choice(a.room).click(wait);
    else if (a.k === 'call') await choice(a.side === 'H' ? 0 : 1).click(wait);
    else if (a.k === 'items' && Array.isArray(a.picks)) {
      for (const i of a.picks) await choice(i).click(wait);
      await page.getByRole('button', { name: /lock picks/i }).click(wait);
    } else if (a.k === 'math' && Array.isArray(a.answers)) {
      for (const [i, value] of a.answers.entries()) {
        await page.locator('.qp-sums button').nth(i).click(wait);
        for (const digit of String(value)) await page.getByRole('button', { name: digit, exact: true }).click(wait);
      }
      await page.getByRole('button', { name: /lock in all three/i }).click(wait);
    } else if (a.k === 'memory' && Array.isArray(a.seq)) {
      for (const s of a.seq) await page.getByRole('button', { name: SYMBOL_NAMES[Number(s)], exact: true }).click(wait);
      await page.getByRole('button', { name: /lock it in/i }).click(wait);
    } else if (a.k === 'word' && typeof a.text === 'string') {
      // Tap each letter tile in spelling order (the first unused tile with that letter).
      const tiles = page.locator('.qp-tile-pad .qp-tile'), n = await tiles.count(), used = new Set<number>();
      for (const c of a.text) for (let i = 0; i < n; i++) if (!used.has(i) && (await tiles.nth(i).textContent()) === c) { used.add(i); await tiles.nth(i).click(wait); break; }
      await page.getByRole('button', { name: /try it/i }).click(wait);
    } else return false;
    return true;
  } catch { return false; }
}
