/* QA driver hook (tools/qa-driver.ts only; never imported by client code): plays the phone's bot moves through its real UI. */
type Box = { x: number; y: number; width: number; height: number };
type Locator = { click(o?: object): Promise<void>; fill(text: string, o?: object): Promise<void>; first(): Locator; boundingBox(o?: object): Promise<Box | null>; scrollIntoViewIfNeeded(o?: object): Promise<void> };
type Page = { locator(selector: string): Locator; getByRole(role: string, o?: object): Locator; mouse: { move(x: number, y: number): Promise<void>; down(): Promise<void>; up(): Promise<void> } };
type Stroke = { color: string; points: { x: number; y: number }[] };
const wait = { timeout: 4000 };

/** Returns true when the move was made by tapping the phone; false lets the driver fall back to its socket. */
export async function ui(page: Page, a: Record<string, unknown>): Promise<boolean> {
  try {
    if (a.k === 'draw') {
      // Trace the bot's strokes on the real pad (the pad applies its own ink limits), then hang it.
      const pad = page.locator('.sb-pad .kp-drawing-surface').first();
      for (const stroke of (a.drawing as { strokes: Stroke[] }).strokes) {
        await page.locator(`.kp-swatch[aria-label="Ink ${stroke.color}"]`).click(wait);
        await pad.scrollIntoViewIfNeeded(wait);
        const box = await pad.boundingBox(wait), [first, ...rest] = stroke.points;
        if (!box) return false;
        await page.mouse.move(box.x + first!.x * box.width, box.y + first!.y * box.height); await page.mouse.down();
        for (const p of rest) await page.mouse.move(box.x + p.x * box.width, box.y + p.y * box.height);
        await page.mouse.up();
      }
      await page.getByRole('button', { name: /hang it in the gallery/i }).click(wait);
    } else if (a.k === 'title') {
      await page.locator('.hj-entry textarea, .hj-entry input').first().fill(String(a.text), wait);
      await page.locator('.hj-entry button[type=submit]').click(wait);
    } else if (a.k === 'guess') await page.locator(`.sb-option[data-id="${String(a.option)}"] .sb-pick`).click(wait);
    else if (a.k === 'like') await page.locator(`.sb-option[data-id="${String(a.option)}"] .sb-like`).click(wait);
    else return false;
    return true;
  } catch { return false; }
}
