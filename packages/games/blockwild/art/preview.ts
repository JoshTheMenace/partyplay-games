/**
 * Art preview: draws every atlas layer (single and 3×3 tiled to check seams) and every item icon into an HTML page,
 * plus an expansion page (new textures beside a few existing ones, animation strips, new icons and armor sheets),
 * then screenshots both with headless Chromium.
 * Run: node --import tsx packages/games/blockwild/art/preview.ts   → output/art-preview/{atlas,expansion}.{html,png}
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ANIMATIONS, ARMOR_SHEET, armorSheet, ATLAS_KEYS, frameLayers, itemIcon, texturePixels } from '../src/client/art/atlas';
import { pngDataUrl } from '../src/client/art/png';
import { BLOCK_LIST, faceTexture, makeCell } from '../src/shared/blocks';
import { ARMOR_MATERIALS, ITEM_LIST } from '../src/shared/items';

const PLAYWRIGHT = '/Users/joshthemenace/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const out = resolve('output/art-preview'); // run from the repository root
mkdirSync(out, { recursive: true });

const tiled = (px: Uint8Array) => {
  const big = new Uint8Array(48 * 48 * 4);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) big.set(px.subarray(((y % 16) * 16 + (x % 16)) * 4, ((y % 16) * 16 + (x % 16)) * 4 + 4), (y * 48 + x) * 4);
  return pngDataUrl(48, 48, big);
};
const tile = (key: string) => {
  const px = texturePixels(key);
  return `<figure><img src="${pngDataUrl(16, 16, px)}" width="64"><img src="${tiled(px)}" width="96"><figcaption>${key}</figcaption></figure>`;
};
const icon = (item: { id: number; key: string }) => `<figure class="icon"><img src="${itemIcon(item.id)}" width="48" height="48"><figcaption>${item.key}</figcaption></figure>`;
const page = (title: string, body: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title><style>
body{margin:0;padding:16px;background:#6b7a8f;font:10px/1.2 system-ui;color:#fff}
h2{margin:8px 0}
section{display:flex;flex-wrap:wrap;gap:6px}
figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:2px;background:#3a4250;padding:4px;border-radius:4px}
img{image-rendering:pixelated;background:repeating-conic-gradient(#8a93a0 0 25%,#aab2bd 0 50%) 0 0/8px 8px}
.icon img{background:#8b8b8b}
.strip img{background:#1a1a1a}
figcaption{max-width:160px;overflow:hidden;white-space:nowrap}
</style>${body}`;

writeFileSync(`${out}/atlas.html`, page('Atlas', `<h2>Atlas (${ATLAS_KEYS.length} layers)</h2><section>${ATLAS_KEYS.map(tile).join('')}</section>
<h2>Item icons (${ITEM_LIST.length})</h2><section>${ITEM_LIST.map(icon).join('')}</section>`));

// Expansion: blocks from id 78 on, items from id 322 on (plus the new block items).
const keysOf = (blocks: typeof BLOCK_LIST) => new Set(blocks.filter(b => b.render !== 'none').flatMap(b => Array.from({ length: 32 * 6 }, (_, i) => faceTexture(makeCell(b.id, i / 6 | 0), i % 6))));
const old = keysOf(BLOCK_LIST.filter(b => b.id < 78)), fresh = [...keysOf(BLOCK_LIST.filter(b => b.id >= 78))].filter(k => !old.has(k)).sort();
const reference = ['stone', 'cobblestone', 'oak_planks', 'dirt', 'grass_block_side', 'sand', 'sandstone', 'stone_bricks', 'gold_ore', 'obsidian', 'torch', 'oak_door_top'];
const strip = (key: string) => {
  const layers = frameLayers(key), px = new Uint8Array(16 * 16 * 4 * layers.length);
  layers.forEach((layer, f) => { const frame = texturePixels(ATLAS_KEYS[layer]!); for (let y = 0; y < 16; y++) px.set(frame.subarray(y * 64, y * 64 + 64), (y * layers.length + f) * 64); });
  return `<figure class="strip"><img src="${pngDataUrl(16 * layers.length, 16, px)}" width="${48 * layers.length}"><figcaption>${key} (${layers.length} frames @ ${ANIMATIONS[key]!.fps} fps)</figcaption></figure>`;
};
const sheets = ARMOR_MATERIALS.map(m => `<figure><img src="${pngDataUrl(ARMOR_SHEET.w, ARMOR_SHEET.h, armorSheet(m).data)}" width="${ARMOR_SHEET.w * 4}"><figcaption>${m} armor sheet</figcaption></figure>`).join('');
const items = ITEM_LIST.filter(item => item.id >= 322 || (item.id >= 78 && item.id < 256));
writeFileSync(`${out}/expansion.html`, page('Expansion art', `<h2>New textures (${fresh.length})</h2><section>${fresh.map(tile).join('')}</section>
<h2>Existing reference</h2><section>${reference.map(tile).join('')}</section>
<h2>Animations</h2><section style="flex-direction:column">${Object.keys(ANIMATIONS).map(strip).join('')}</section>
<h2>New item icons (${items.length})</h2><section>${items.map(icon).join('')}</section>
<h2>Armor layer sheets</h2><section>${sheets}</section>`));

type Page = { goto(url: string): Promise<unknown>; screenshot(o: { path: string; fullPage: boolean }): Promise<unknown> };
type Chromium = { launch(): Promise<{ newPage(o: { viewport: { width: number; height: number } }): Promise<Page>; close(): Promise<void> }> };
const { chromium } = await import(PLAYWRIGHT) as { chromium: Chromium };
const browser = await chromium.launch();
for (const name of ['atlas', 'expansion']) {
  const view = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  await view.goto(`file://${out}/${name}.html`);
  await view.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log(`${out}/${name}.png`);
}
await browser.close();
