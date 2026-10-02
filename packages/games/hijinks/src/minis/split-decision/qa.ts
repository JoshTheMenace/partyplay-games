/* QA driver hook (tools/qa-driver.ts only; never imported by client code): plays the phone's bot moves through its real UI. */
type Locator = { click(o?: object): Promise<void>; fill(text: string, o?: object): Promise<void> };
type Page = { locator(selector: string): Locator; getByRole(role: string, o?: object): Locator };
const wait = { timeout: 4000 };

/** Returns true when the move was made by tapping the phone; false lets the driver fall back to its socket. */
export async function ui(page: Page, a: Record<string, unknown>): Promise<boolean> {
  try {
    if (a.k === 'fill') {
      await page.locator('.hj-entry textarea').fill(String(a.text), wait);
      await page.locator('.hj-entry button[type=submit]').click(wait);
    } else if (a.k === 'house') await page.getByRole('button', { name: /let the machine fill it/i }).click(wait);
    // Votes and Big Split verdicts: the phone shows the bot's next take (both follow the shared carousel order).
    else if (a.k === 'vote' || a.k === 'judge') await page.locator(`.sd-yn button[data-side="${Number(a.side)}"]`).click(wait);
    else return false;
    return true;
  } catch { return false; }
}
