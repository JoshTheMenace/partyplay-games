/* QA driver hook (tools/qa-driver.ts only; never imported by client code): plays the phone's bot moves through its real UI. */
type Box = { x: number; y: number; width: number; height: number };
type Locator = { click(o?: object): Promise<void>; fill(text: string, o?: object): Promise<void>; nth(i: number): Locator; first(): Locator; boundingBox(o?: object): Promise<Box | null>; scrollIntoViewIfNeeded(o?: object): Promise<void> };
type Page = { locator(selector: string): Locator; getByRole(role: string, o?: object): Locator; mouse: { move(x: number, y: number): Promise<void>; down(): Promise<void>; up(): Promise<void> } };
type Stroke = { color: string; points: { x: number; y: number }[] };
const wait = { timeout: 4000 };

/** Returns true when the move was made by tapping the phone; false lets the driver fall back to its socket. */
export async function ui(page: Page, a: Record<string, unknown>): Promise<boolean> {
  try {
    if (a.k === 'design') {
      // Trace the bot's strokes on the real pad (the pad applies its own ink limits), then hang it on the rack.
      const pad = page.locator('.ss-draw-shell .kp-drawing-surface').first();
      for (const stroke of (a.drawing as { strokes: Stroke[] }).strokes) {
        await page.locator(`.kp-swatch[aria-label="Ink ${stroke.color}"]`).click(wait);
        await pad.scrollIntoViewIfNeeded(wait);
        const box = await pad.boundingBox(wait), [first, ...rest] = stroke.points;
        if (!box) return false;
        await page.mouse.move(box.x + first!.x * box.width, box.y + first!.y * box.height); await page.mouse.down();
        for (const p of rest) await page.mouse.move(box.x + p.x * box.width, box.y + p.y * box.height);
        await page.mouse.up();
      }
      await page.getByRole('button', { name: /add to the rack/i }).click(wait);
    } else if (a.k === 'done') await page.getByRole('button', { name: /i’m done/i }).click(wait);
    else if (a.k === 'slogan') {
      await page.locator('.hj-entry textarea').fill(String(a.text), wait);
      await page.locator('.hj-entry button[type=submit]').click(wait);
    } else if (a.k === 'reroll') await page.locator(`.ss-reroll[data-what="${String(a.what)}"]`).click(wait);
    else if (a.k === 'shirt') {
      await page.locator(`.ss-design[data-key="${String(a.design)}"]`).click(wait);
      await page.locator(`.ss-slogan-opt[data-id="${String(a.slogan)}"]`).click(wait);
      await page.locator('.ss-swatches [role=radio]').nth(Number(a.color)).click(wait);
      await page.locator(`.ss-seg [data-pos="${String(a.pos)}"]`).click(wait);
      await page.getByRole('button', { name: /send it to the ring/i }).click(wait);
    } else if (a.k === 'vote') await page.locator('.ss-vote [role=radio]').nth(Number(a.side)).click(wait);
    else return false;
    return true;
  } catch { return false; }
}
