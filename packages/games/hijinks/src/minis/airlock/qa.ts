/* QA driver hook (tools/qa-driver.ts only; never imported by client code): plays the phone's bot moves through its real UI. */
type Box = { x: number; y: number; width: number; height: number };
type Locator = { click(o?: object): Promise<void>; fill(text: string, o?: object): Promise<void>; first(): Locator; boundingBox(o?: object): Promise<Box | null>; scrollIntoViewIfNeeded(o?: object): Promise<void> };
type Page = { locator(selector: string): Locator; getByRole(role: string, o?: object): Locator; mouse: { move(x: number, y: number): Promise<void>; down(): Promise<void>; up(): Promise<void> } };
type Stroke = { color: string; points: { x: number; y: number }[] };
const wait = { timeout: 4000 }, pause = (ms: number) => new Promise(done => setTimeout(done, ms));

/** Returns true when the move was made by tapping the phone; false lets the driver fall back to its socket. */
export async function ui(page: Page, a: Record<string, unknown>): Promise<boolean> {
  try {
    if (a.k === 'answer' && typeof a.value === 'string' && !(await page.locator('.al-opts').first().boundingBox({ timeout: 300 }).catch(() => null))) {
      await page.locator('.hj-entry input').fill(a.value, wait);
      await page.locator('.hj-entry button[type=submit]').click(wait);
    } else if (a.k === 'answer') {
      // Pick, linger (so the TV is shot mid-test with the choice highlighted), then lock in.
      await page.locator(`.al-opt[data-value="${String(a.value)}"]`).click(wait); await pause(900);
      await page.getByRole('button', { name: 'Lock it in', exact: true }).click(wait);
    } else if (a.k === 'draw') {
      const pad = page.locator('.al-pad .kp-drawing-surface').first();
      for (const stroke of (a.drawing as { strokes: Stroke[] }).strokes.slice(0, 8)) {
        await page.locator(`.kp-swatch[aria-label="Ink ${stroke.color}"]`).click(wait);
        await pad.scrollIntoViewIfNeeded(wait);
        const box = await pad.boundingBox(wait), [first, ...rest] = stroke.points;
        if (!box) return false;
        await page.mouse.move(box.x + first!.x * box.width, box.y + first!.y * box.height); await page.mouse.down();
        for (const p of rest) await page.mouse.move(box.x + p.x * box.width, box.y + p.y * box.height);
        await page.mouse.up();
      }
      await page.getByRole('button', { name: /send my doodle/i }).click(wait);
    } else if (a.k === 'scan') await page.getByRole('button', { name: /scan ship computer/i }).click(wait);
    else if (a.k === 'ready') await page.getByRole('button', { name: /ready for the next test/i }).click(wait);
    else if (a.k === 'push' && typeof a.suspect === 'string') {
      await page.locator('.al-push').click(wait); await pause(500);
      await page.locator(`.al-opt[data-value="${a.suspect}"]`).click(wait);
      await pause(700);
      await page.getByRole('button', { name: /push it/i }).click(wait);
    } else if (a.k === 'vote') await page.locator(`.al-vote[data-vote="${String(a.vote)}"]`).click(wait);
    else return false;
    return true;
  } catch { return false; }
}
