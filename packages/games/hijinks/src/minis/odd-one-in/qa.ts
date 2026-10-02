/* QA driver hook (tools/qa-driver.ts only; never imported by client code): plays the phone's bot moves through its real UI. */
type Locator = { click(o?: object): Promise<void> };
type Page = { locator(selector: string): Locator; getByRole(role: string, o?: object): Locator };
const wait = { timeout: 4000 }, pause = (ms: number) => new Promise(done => setTimeout(done, ms));

/** Returns true when the move was made by tapping the phone; false lets the driver fall back to its socket. */
export async function ui(page: Page, a: Record<string, unknown>): Promise<boolean> {
  try {
    if (a.k === 'answer') {
      // Pick, linger (so the TV is shot mid-task with the choice highlighted), then lock in.
      await page.locator(`.ooi-opt[data-value="${String(a.value)}"]`).click(wait); await pause(1200);
      await page.getByRole('button', { name: 'Lock it in', exact: true }).click(wait);
    } else if (a.k === 'ready') await page.getByRole('button', { name: /ready to vote/i }).click(wait);
    else if (a.k === 'vote') {
      await page.locator(`.ooi-opt[data-value="${String(a.suspect)}"]`).click(wait); await pause(800);
      await page.getByRole('button', { name: 'Accuse!', exact: true }).click(wait);
    } else return false;
    return true;
  } catch { return false; }
}
