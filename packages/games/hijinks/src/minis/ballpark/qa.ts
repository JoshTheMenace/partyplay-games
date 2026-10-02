/* QA driver hook (tools/qa-driver.ts only; never imported by client code): plays the phone's bot moves through its real UI. */
type Locator = { click(o?: object): Promise<void>; evaluate<A>(fn: (el: HTMLInputElement, arg: A) => void, arg: A): Promise<void> };
type Page = { locator(selector: string): Locator };
const wait = { timeout: 4000 }, pause = (ms: number) => new Promise(done => setTimeout(done, ms));

/** Moves the dial like a finger would: React sees a real input event, and the component throttles what it sends. */
const dial = (page: Page, value: number) => page.locator('.bp-slider input').evaluate((el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

/** Returns true when the move was made by tapping the phone; false lets the driver fall back to its socket. */
export async function ui(page: Page, a: Record<string, unknown>): Promise<boolean> {
  try {
    if (a.k === 'answer') await page.locator(`.bp-yn button[data-yes="${String(a.yes)}"]`).click(wait);
    else if (a.k === 'aim') await dial(page, Number(a.value));
    else if (a.k === 'lock') { await dial(page, Number(a.value)); await pause(400); await page.locator('.bp-dial .hj-sticky button').click(wait); }
    else if (a.k === 'bet') await page.locator(`.bp-bets button[data-bet="${String(a.bet)}"]`).click(wait);
    else if ((a.k === 'ticks' || a.k === 'picks') && Array.isArray(a[a.k])) {
      // Toggle, linger (so the TV is shot mid-phase with choices highlighted), then send.
      for (const i of a[a.k] as number[]) await page.locator(`.bp-item[data-i="${i}"]`).click(wait);
      await pause(800);
      await page.locator('.bp-phone .hj-sticky button').click(wait);
    } else return false;
    return true;
  } catch { return false; }
}
