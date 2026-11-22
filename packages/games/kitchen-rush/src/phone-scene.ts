// Whether this phone can draw its own kitchen. Kept apart from the scene chunk so the controller can read it without loading three.
let failed = false;
const listeners = new Set<() => void>();
/** A phone whose kitchen view could not start plays on with the classic controller instead of stopping the round for everyone. */
export const phoneScene = {
  failed: () => failed,
  fail() { failed = true; listeners.forEach(notify => notify()); },
  subscribe(notify: () => void) { listeners.add(notify); return () => { listeners.delete(notify); }; },
};
