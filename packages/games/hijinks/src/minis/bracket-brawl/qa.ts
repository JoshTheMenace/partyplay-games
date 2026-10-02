/* QA driver hook (tools/qa-driver.ts only; never imported by client code): plays the phone's bot moves through its real UI. */
import { seedOf } from './types';

type Locator = { click(o?: object): Promise<void>; fill(text: string, o?: object): Promise<void>; nth(i: number): Locator };
type Page = { locator(selector: string): Locator };
const wait = { timeout: 4000 };

/** Returns true when the move was made by tapping the phone; false lets the driver fall back to its socket. */
export async function ui(page: Page, a: Record<string, unknown>): Promise<boolean> {
  try {
    if (a.k === 'answer') {
      await page.locator('.hj-entry textarea').fill(String(a.text), wait);
      await page.locator('.hj-entry button[type=submit]').click(wait);
    } else if (a.k === 'predict') await page.locator('.bb-picks [role=radio]').nth(seedOf(String(a.entry)) - 1).click(wait); // listed in seed order
    else if (a.k === 'vote') await page.locator('.bb-vote [role=radio]').nth(Number(a.side)).click(wait);
    else return false;
    return true;
  } catch { return false; }
}
