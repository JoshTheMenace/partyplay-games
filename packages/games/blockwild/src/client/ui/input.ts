/** Pure input mapping for touch and pointer gestures (tested in Node). */

/** How a gesture on a container slot maps to the MC click button (0 left, 1 right/split, 2 shift/quick move). */
export type SlotGesture = { pointer: string; button: number; shift: boolean; longPress: boolean };
export function clickButton(gesture: SlotGesture, quickMove: boolean): 0 | 1 | 2 | null {
  if (gesture.pointer === 'touch' || gesture.pointer === 'pen') return gesture.longPress ? 1 : quickMove ? 2 : 0;
  if (gesture.button === 2) return 1;
  if (gesture.button !== 0) return null;
  return gesture.shift || quickMove ? 2 : 0;
}

/** Floating joystick: CSS-pixel drag from the touch origin → move [x right, y forward] in -1..1, sprinting at the rim. */
export function stickVector(dx: number, dy: number, radius: number): { move: [number, number]; sprint: boolean; knob: [number, number] } {
  const length = Math.hypot(dx, dy), dead = radius * 0.12;
  if (length < dead) return { move: [0, 0], sprint: false, knob: [dx, dy] };
  const scale = Math.min(length, radius) / length, strength = Math.min(1, (length - dead) / (radius - dead));
  const x = dx / length * strength, y = -dy / length * strength;
  return { move: [Math.round(x * 1000) / 1000 + 0, Math.round(y * 1000) / 1000 + 0], sprint: length >= radius * 0.98 && y > 0.5, knob: [dx * scale, dy * scale] };
}
