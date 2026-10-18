/** Gravity projected onto screen-right: works in either landscape direction without Euler-angle jumps. */
export function tiltAngle(beta: number | null, gamma: number | null, screenAngle: number) {
  if (beta === null || gamma === null || ![beta, gamma, screenAngle].every(Number.isFinite)) return null;
  const rad = Math.PI / 180, b = beta * rad, g = gamma * rad, a = screenAngle * rad;
  return Math.asin(Math.max(-1, Math.min(1, Math.cos(b) * Math.sin(g) * Math.cos(a) + Math.sin(b) * Math.sin(a)))) / rad;
}

/** Which way the screen faces, from gravity: the top edge you look at is always the higher one. Browsers
 * disagree on (or omit) the reported angle, so it only breaks ties when the phone lies flat. */
export function screenAngle(beta: number, gamma: number, reported: number, landscape = Math.abs(reported) % 180 === 90) {
  const rad = Math.PI / 180, up = landscape ? -Math.cos(beta * rad) * Math.sin(gamma * rad) : Math.sin(beta * rad);
  if (Math.abs(up) >= .25) return landscape ? (up > 0 ? 90 : 270) : (up > 0 ? 0 : 180);
  return Math.abs(reported) % 180 === (landscape ? 90 : 0) ? reported : landscape ? 90 : 0;
}

/** Two degrees of dead zone; full lock at 30 degrees from the calibrated centre. */
export function steerFromTilt(angle: number, centre: number) {
  const delta = angle - centre;
  return Math.sign(delta) * Math.min(1, Math.max(0, (Math.abs(delta) - 2) / 28));
}
