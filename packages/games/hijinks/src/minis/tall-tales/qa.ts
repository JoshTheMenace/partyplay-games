/* QA driver hook (tools/qa-driver.ts only; never imported by client code): plays the phone's bot moves through its real UI. */
type Locator = { click(o?: object): Promise<void>; fill(text: string, o?: object): Promise<void>; nth(i: number): Locator; locator(selector: string): Locator };
type Page = { locator(selector: string): Locator; getByRole(role: string, o?: object): Locator };
const wait = { timeout: 4000 }, pause = (ms: number) => new Promise(done => setTimeout(done, ms));
/** Option ids are o<display index>, and the phone lists options in display order. */
const row = (page: Page, id: unknown) => page.locator('.tt-ballot li').nth(Number(String(id).slice(1)));

/** Returns true when the move was made by tapping the phone; false lets the driver fall back to its socket. */
export async function ui(page: Page, a: Record<string, unknown>): Promise<boolean> {
  try {
    if (a.k === 'pick') await page.locator('.tt-cats .hj-choice').nth(Number(a.index)).click(wait);
    else if (a.k === 'lie') {
      // Human pace: the phone types, then reads it back, so the TV is screenshotted mid-writing and mid-choosing.
      await page.locator('.hj-entry textarea').fill(String(a.text), wait); await pause(3000);
      await page.locator('.hj-entry button[type=submit]').click(wait);
    } else if (a.k === 'help') await page.getByRole('button', { name: /lie for me/i }).click(wait);
    else if (a.k === 'house') await page.locator('.tt-offers button').nth(Number(a.index)).click(wait);
    else if (a.k === 'choose') { await pause(3000); await row(page, a.option).locator('.tt-ballot-pick').click(wait); }
    else if (a.k === 'like') await row(page, a.option).locator('.tt-heart').click(wait);
    else return false;
    return true;
  } catch { return false; }
}
