// Canvas-drawn textures: nameplates, coin popups, signs and small repeating patterns. Created once per round.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

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

/** Number badge + name in the chef's colour on a dark pill. Returns the texture and its width/height ratio. */
export function nameplateTexture(index: number, name: string, color: string) {
  const height = 88, pad = 14, font = `900 46px ${FONT}`;
  const probe = canvas(8, 8).context; probe.font = font;
  const label = name.length > 14 ? `${name.slice(0, 13)}…` : name;
  const width = Math.ceil(height + probe.measureText(label).width + pad * 2 + 6);
  const { element, context: c } = canvas(width, height);
  c.fillStyle = 'rgba(20, 24, 36, .86)'; c.beginPath(); c.roundRect(3, 6, width - 6, height - 12, (height - 12) / 2); c.fill();
  c.lineWidth = 4; c.strokeStyle = color; c.stroke();
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
