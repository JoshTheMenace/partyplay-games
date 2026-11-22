// Canvas-drawn textures: nameplates, coin popups, signs and small repeating patterns. Created once per round.
import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Terrain } from './themes';

const FONT = '"Nunito", "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif';
function canvas(width: number, height: number) {
  const element = document.createElement('canvas'); element.width = width; element.height = height;
  return { element, context: element.getContext('2d')! };
}
function texture(element: HTMLCanvasElement, repeat = false) {
  const result = new CanvasTexture(element); result.colorSpace = SRGBColorSpace; result.anisotropy = 4;
  if (repeat) result.wrapS = result.wrapT = RepeatWrapping;
  return result;
}

/** Number badge + name in the chef's colour on a dark pill (the badge alone without a name). Returns the texture and its width/height ratio. */
export function nameplateTexture(index: number, name: string, color: string) {
  const height = 88, pad = 14, font = `900 46px ${FONT}`;
  const probe = canvas(8, 8).context; probe.font = font;
  const label = name.length > 14 ? `${name.slice(0, 13)}…` : name;
  const width = label ? Math.ceil(height + probe.measureText(label).width + pad * 2 + 6) : height;
  const { element, context: c } = canvas(width, height);
  if (label) { c.fillStyle = 'rgba(20, 24, 36, .86)'; c.beginPath(); c.roundRect(3, 6, width - 6, height - 12, (height - 12) / 2); c.fill(); c.lineWidth = 4; c.strokeStyle = color; c.stroke(); }
  c.fillStyle = color; c.beginPath(); c.arc(height / 2, height / 2, height / 2 - 4, 0, Math.PI * 2); c.fill();
  c.lineWidth = 4; c.strokeStyle = 'rgba(20, 24, 36, .9)'; c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#141824'; c.font = `1000 50px ${FONT}`;
  c.fillText(String(index + 1), height / 2, height / 2 + 3);
  c.textAlign = 'left'; c.font = font; c.fillStyle = color; c.fillText(label, height + pad - 4, height / 2 + 3);
  return { map: texture(element), aspect: width / height };
}

/** A reusable popup canvas; `draw` repaints it. Values starting with "+" get a gold coin and a warm gradient. */
export function popupCanvas() {
  const W = 480, H = 160, { element, context: c } = canvas(W, H), map = texture(element);
  const draw = (text: string, color = '#ffd24a') => {
    c.clearRect(0, 0, W, H);
    const coin = text.startsWith('+'), x = coin ? 272 : W / 2, y = 86;
    c.font = `1000 112px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    c.lineWidth = 22; c.strokeStyle = '#3b2410'; c.strokeText(text, x, y);
    const fill = c.createLinearGradient(0, y - 46, 0, y + 46); fill.addColorStop(0, '#fff6b8'); fill.addColorStop(.45, color); fill.addColorStop(1, coin ? '#f08a12' : color);
    c.fillStyle = fill; c.fillText(text, x, y);
    if (coin) {
      c.fillStyle = '#3b2410'; c.beginPath(); c.arc(62, 82, 52, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f5a623'; c.beginPath(); c.arc(62, 80, 44, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffd94a'; c.beginPath(); c.arc(62, 76, 36, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff6c4'; c.beginPath(); c.ellipse(48, 62, 12, 7, -.6, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#c0700c'; c.font = `1000 50px ${FONT}`; c.fillText('★', 62, 80);
    }
    map.needsUpdate = true;
  };
  return { map, draw, aspect: W / H };
}

/** Ring of dots marking where thrown food will land (white; tinted per thrower). */
export function dotsTexture() {
  const { element, context: c } = canvas(128, 128);
  c.fillStyle = '#ffffff';
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; c.beginPath(); c.arc(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50, 9, 0, Math.PI * 2); c.fill(); }
  c.beginPath(); c.arc(64, 64, 11, 0, Math.PI * 2); c.fill();
  return texture(element);
}

/** Painted sign board for the back wall (location name). */
export function signTexture(text: string, background: string, foreground: string) {
  const { element, context: c } = canvas(1024, 192);
  c.fillStyle = background; c.beginPath(); c.roundRect(8, 8, 1008, 176, 40); c.fill();
  c.lineWidth = 10; c.strokeStyle = foreground; c.globalAlpha = .35; c.beginPath(); c.roundRect(26, 26, 972, 140, 28); c.stroke(); c.globalAlpha = 1;
  c.fillStyle = foreground; c.font = `1000 96px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text.toUpperCase(), 512, 102, 920);
  return texture(element);
}

/** One belt tile of rubber with four bold chevrons pointing +U, so scrolling the offset moves them with the items. */
export function beltTexture() {
  const { element, context: c } = canvas(256, 192);
  c.fillStyle = '#26282e'; c.fillRect(0, 0, 256, 192);
  c.fillStyle = 'rgba(255,255,255,.05)'; for (let x = 0; x < 256; x += 32) c.fillRect(x, 0, 4, 192);
  c.strokeStyle = '#f5c04a'; c.lineWidth = 15; c.lineCap = 'round'; c.lineJoin = 'round';
  for (let x = 18; x < 256; x += 64) { c.beginPath(); c.moveTo(x, 58); c.lineTo(x + 26, 96); c.lineTo(x, 134); c.stroke(); }
  return texture(element, true);
}

/** Radial falloff used for blob shadows and soft glows (white; tint with material colour). */
export function radialTexture(inner = 0, outer = 1) {
  const { element, context: c } = canvas(128, 128), g = c.createRadialGradient(64, 64, 64 * inner, 64, 64, 64 * outer);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  return texture(element);
}

/** Spiral arms for portal swirls. */
export function swirlTexture() {
  const { element, context: c } = canvas(256, 256);
  c.translate(128, 128);
  for (let arm = 0; arm < 3; arm++) for (let i = 0; i < 90; i++) {
    const t = i / 90, angle = arm * Math.PI * 2 / 3 + t * Math.PI * 2.4, r = 10 + t * 112;
    c.fillStyle = `rgba(255,255,255,${(1 - t) * .9})`; c.beginPath(); c.arc(Math.cos(angle) * r, Math.sin(angle) * r, 3 + t * 13, 0, Math.PI * 2); c.fill();
  }
  const glow = c.createRadialGradient(0, 0, 0, 0, 0, 60); glow.addColorStop(0, 'rgba(255,255,255,.95)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = glow; c.fillRect(-128, -128, 256, 256);
  return texture(element);
}

/** Diagonal glints that slide across ice. */
export function sheenTexture() {
  const { element, context: c } = canvas(256, 256);
  const g = c.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.46, 'rgba(255,255,255,0)'); g.addColorStop(.5, 'rgba(255,255,255,.55)'); g.addColorStop(.54, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 256, 256);
  return texture(element, true);
}

/** Rounded-square target frame with bold corners (white; tinted per chef). */
export function frameTexture() {
  const { element, context: c } = canvas(128, 128);
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 14; c.beginPath(); c.roundRect(10, 10, 108, 108, 20); c.stroke();
  c.strokeStyle = '#ffffff'; c.lineWidth = 10; c.lineCap = 'round';
  for (const [x, y, dx, dy] of [[12, 12, 1, 1], [116, 12, -1, 1], [12, 116, 1, -1], [116, 116, -1, -1]]) { c.beginPath(); c.moveTo(x, y + dy * 30); c.lineTo(x, y); c.lineTo(x + dx * 30, y); c.stroke(); }
  return texture(element);
}

/** Chef floor ring: a crisp band with a soft outer glow (white; tinted per chef). */
export function ringTexture() {
  const { element, context: c } = canvas(128, 128);
  const glow = c.createRadialGradient(64, 64, 40, 64, 64, 64); glow.addColorStop(0, 'rgba(255,255,255,0)'); glow.addColorStop(.55, 'rgba(255,255,255,.55)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = glow; c.fillRect(0, 0, 128, 128);
  c.strokeStyle = '#ffffff'; c.lineWidth = 7; c.beginPath(); c.arc(64, 64, 50, 0, Math.PI * 2); c.stroke();
  return texture(element);
}

/** Shade of a colour: k < 1 darkens, k > 1 lightens toward white. */
const tone = (hex: string, k: number) => { const c = new Color(hex); if (k <= 1) c.multiplyScalar(k); else c.lerp(new Color('#ffffff'), k - 1); return `#${c.getHexString()}`; };
/**
 * A 4 m repeating ground tile in the theme's ground colour: mown stripes, wavelets, snow drifts, wind ripples, cobbles
 * or a carpet lattice. Drawn from a fixed seed so every screen and every round gets the same ground.
 */
export function groundTexture(terrain: Terrain, ground: string) {
  const size = 256, { element, context: c } = canvas(size, size);
  let seed = 7; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  c.fillStyle = ground; c.fillRect(0, 0, size, size);
  // Each mark is drawn nine times around the tile so nothing is cut at the seams.
  const tiled = (draw: (ox: number, oy: number) => void) => { for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) draw(ox, oy); };
  if (terrain === 'lawn') {
    c.fillStyle = tone(ground, 1.07); for (let x = 0; x < size; x += 128) c.fillRect(x, 0, 64, size);
    for (let i = 0; i < 260; i++) { const x = random() * size, y = random() * size, h = 4 + random() * 6; c.strokeStyle = tone(ground, random() < .5 ? .88 : 1.16); c.lineWidth = 1.6; tiled((ox, oy) => { c.beginPath(); c.moveTo(x + ox, y + oy); c.lineTo(x + ox + 1.5, y + oy - h); c.stroke(); }); }
  } else if (terrain === 'water') {
    for (let i = 0; i < 46; i++) { const x = random() * size, y = random() * size, w = 14 + random() * 22; c.strokeStyle = tone(ground, i % 3 ? 1.18 : .88); c.lineWidth = 2.4; c.lineCap = 'round'; tiled((ox, oy) => { c.beginPath(); c.moveTo(x + ox - w, y + oy); c.quadraticCurveTo(x + ox, y + oy - 7, x + ox + w, y + oy); c.stroke(); }); }
  } else if (terrain === 'snow') {
    for (let i = 0; i < 26; i++) { const x = random() * size, y = random() * size, r = 16 + random() * 30; c.fillStyle = tone(ground, i % 2 ? .955 : 1.3); tiled((ox, oy) => { c.beginPath(); c.ellipse(x + ox, y + oy, r, r * .45, 0, 0, Math.PI * 2); c.fill(); }); }
    for (let i = 0; i < 90; i++) { c.fillStyle = tone(ground, .93); c.fillRect(random() * size, random() * size, 2, 2); }
  } else if (terrain === 'sand') {
    for (let i = 0; i < 9; i++) { const y = (i + .5) * size / 9; c.strokeStyle = tone(ground, i % 2 ? .9 : 1.12); c.lineWidth = 3; c.beginPath(); for (let x = 0; x <= size; x += 8) c.lineTo(x, y + Math.sin(x / size * Math.PI * 4 + i) * 5); c.stroke(); }
    for (let i = 0; i < 160; i++) { c.fillStyle = tone(ground, random() < .5 ? .84 : 1.15); c.fillRect(random() * size, random() * size, 2, 2); }
  } else if (terrain === 'cobbles') {
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) { c.fillStyle = tone(ground, .86 + random() * .3); c.beginPath(); c.roundRect(col * 32 + (row % 2 ? 16 : 0) - 32 + 2, row * 32 + 2, 28, 28, 9); c.fill(); c.beginPath(); c.roundRect(col * 32 + (row % 2 ? 16 : 0) + 224 + 2, row * 32 + 2, 28, 28, 9); c.fill(); }
  } else {
    c.strokeStyle = tone(ground, 1.22); c.lineWidth = 5;
    for (let i = -size; i <= size * 2; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + size, size); c.moveTo(i, size); c.lineTo(i + size, 0); c.stroke(); }
    c.fillStyle = tone(ground, .8); for (let x = 0; x <= size; x += 64) for (let y = 0; y <= size; y += 64) { c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(x + 32, y + 32, 4, 0, Math.PI * 2); c.fill(); }
  }
  return texture(element, true);
}
/** Dark-to-clear ramp for the contact shadow where a counter meets the floor. */
export function rampTexture() {
  const { element, context: c } = canvas(4, 64), ramp = c.createLinearGradient(0, 0, 0, 64);
  ramp.addColorStop(0, 'rgba(255,255,255,1)'); ramp.addColorStop(.35, 'rgba(255,255,255,.45)'); ramp.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = ramp; c.fillRect(0, 0, 4, 64);
  return texture(element);
}
