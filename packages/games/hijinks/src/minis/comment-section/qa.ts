/* QA driver hook (tools/qa-driver.ts only; never imported by client code): plays the phone's bot moves through its real UI. */
type Locator = { click(o?: object): Promise<void>; fill(text: string, o?: object): Promise<void>; nth(i: number): Locator; locator(selector: string): Locator };
type Page = { locator(selector: string): Locator; getByRole(role: string, o?: object): Locator };
const wait = { timeout: 4000 }, pause = (ms: number) => new Promise(done => setTimeout(done, ms));

/** Returns true when the move was made by tapping the phone; false lets the driver fall back to its socket. */
export async function ui(page: Page, a: Record<string, unknown>): Promise<boolean> {
  try {
    if (a.k === 'answer' || a.k === 'twist') {
      // Human pace: type, read it back, then post, so the TV is screenshotted mid-phase with the live preview filled in.
      // Phase-specific forms: a lagging driver must never type an answer into the twist box (or the reverse).
      const form = a.k === 'twist' ? '.cs-entry' : '.hj-entry:not(.cs-entry)';
      await page.locator(`${form} textarea`).fill(String(a.text), wait); await pause(4000);
      await page.locator(`${form} button[type=submit]`).click(wait);
    } else if (a.k === 'auto') await page.getByRole('button', { name: /let the house write it/i }).click(wait);
    else if (a.k === 'vote' && Array.isArray(a.posts)) {
      // Post ids are f<grid index>, and the ballot lists posts in grid order. Reading the board takes a moment.
      await pause(6000);
      for (const id of a.posts) await page.locator('.cs-ballot .hj-choice').nth(Number(String(id).slice(1))).click(wait);
      // Single-vote rounds send on tap; the Final Feed's two-vote ballot needs its Report button.
      await page.getByRole('button', { name: /^Report/ }).click({ timeout: 800 }).catch(() => undefined);
    } else return false;
    return true;
  } catch { return false; }
}
