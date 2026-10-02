/* QA driver hook (tools/qa-driver.ts only; never imported by client code): plays the phone's bot moves through its real UI. */
type Locator = { click(o?: object): Promise<void>; fill(text: string, o?: object): Promise<void>; nth(i: number): Locator; locator(selector: string): Locator };
type Page = { locator(selector: string): Locator; getByRole(role: string, o?: object): Locator };
const wait = { timeout: 4000 };

/** Returns true when the move was made by tapping the phone; false lets the driver fall back to its socket. */
export async function ui(page: Page, a: Record<string, unknown>): Promise<boolean> {
  try {
    if (a.k === 'answer') {
      await page.locator('.hj-entry textarea').fill(String(a.text), wait);
      await page.locator('.hj-entry button[type=submit]').click(wait);
    } else if (a.k === 'safety') await page.getByRole('button', { name: /safety quip/i }).click(wait);
    else if (a.k === 'vote') await page.locator('.qc-vote [role=radio]').nth(Number(a.side)).click(wait);
    else if (a.k === 'picks' && Array.isArray(a.picks)) {
      // Entry ids are e<grid index>, and the ballot lists entries in grid order.
      for (const id of a.picks) await page.locator('.qc-ballot li').nth(Number(String(id).slice(1))).locator('.qc-ballot-add').click(wait);
      await page.getByRole('button', { name: /cast my votes/i }).click(wait);
    } else return false;
    return true;
  } catch { return false; }
}
