/** Desktop keyboard/mouse and polled touch input merged into one per-frame sample. */
import type { ResourceScope } from '../../../../../party-runtime/src/index';
import type { MoveIntent } from '../../shared/physics';
import { store, touch, type TouchState } from '../store';
import { dropSlot, selectSlot } from './predict';

const MOUSE_RADIANS = 0.0024, TOUCH_RADIANS = 0.0065, PITCH_LIMIT = Math.PI / 2 - 0.001, DOUBLE_TAP_MS = 300;

/** Detects a second tap within the window; a detected double tap does not chain into a third. */
export class DoubleTap {
  private last = -Infinity;
  constructor(private readonly windowMs = DOUBLE_TAP_MS) {}
  tap(nowMs: number): boolean {
    const hit = nowMs - this.last <= this.windowMs;
    this.last = hit ? -Infinity : nowMs;
    return hit;
  }
}

const held = (keys: ReadonlySet<string>, ...codes: string[]) => codes.some(code => keys.has(code));
const clampUnit = (v: number) => Math.max(-1, Math.min(1, v));

/** Movement axes and held buttons from keys and the touch stick (pure; fills `out`). Sprint is decided by the caller. */
export function moveFromInput(keys: ReadonlySet<string>, t: Readonly<TouchState>, yaw: number, out: MoveIntent): MoveIntent {
  out.forward = clampUnit(+held(keys, 'KeyW', 'ArrowUp') - +held(keys, 'KeyS', 'ArrowDown') + t.move[1]);
  out.strafe = clampUnit(+held(keys, 'KeyD', 'ArrowRight') - +held(keys, 'KeyA', 'ArrowLeft') + t.move[0]);
  out.jump = held(keys, 'Space') || t.jump;
  out.sneak = held(keys, 'ShiftLeft', 'ShiftRight') || t.sneak;
  out.flyDown = t.flyDown;
  out.yaw = yaw;
  return out;
}
/** Apply a look delta in radians-per-unit, clamping pitch. */
export function applyLook(view: { yaw: number; pitch: number }, dx: number, dy: number, radians: number, invertY: boolean) {
  view.yaw -= dx * radians;
  view.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, view.pitch - dy * radians * (invertY ? -1 : 1)));
}

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
const INTERACTIVE = 'button,input,select,textarea,a,label,[role=button],[data-bw-ui]';

let lockTarget: HTMLCanvasElement | null = null;
/** The browser refused pointer lock for world clicks: kept for the page session, so a reloaded world stays playable. */
let freeCursor = false;
/** Capture the mouse for play (call from a user gesture, e.g. the pause sheet's Resume button). */
export function requestLock() {
  if (!lockTarget || document.pointerLockElement === lockTarget || matchMedia('(pointer: coarse)').matches) return;
  try { void Promise.resolve(lockTarget.requestPointerLock()).catch(() => {}); } catch { /* browsers throttle re-locking after Esc */ }
}

export type ControlEvents = { creative(): boolean };

export class Controls {
  yaw = 0;
  pitch = 0;
  readonly intent: MoveIntent = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, flyDown: false, yaw: 0 };
  /** Held action buttons and their edges this frame. */
  mine = false; use = false; minePressed = false; usePressed = false; useReleased = false;
  /** Consumed by the loop: a double-tap on jump toggles creative flight. */
  flyToggle = false;
  sprinting = false;
  private readonly keys = new Set<string>();
  private mouseMine = false;
  private mouseUse = false;
  /** Presses seen since the last sample: a click shorter than one frame (touchpad tap) still counts once. */
  private clickMine = false;
  private clickUse = false;
  private lastTouch = -Infinity;
  private touchJump = false;
  private readonly jumpTaps = new DoubleTap();
  private readonly forwardTaps = new DoubleTap();
  /**
   * The browser refused pointer lock twice in a row for world clicks (policy, embedded frame): play with a free cursor,
   * dragging with a button held to look. Temporary refusals (Esc cooldown, re-lock without a gesture) do not count,
   * and any later successful lock returns to normal play. Shared by every Controls of the page (see `freeCursor`).
   */
  private get free() { return freeCursor; }
  private set free(on: boolean) { freeCursor = on; }
  private clickLocking = false;
  private refusals = 0;

  constructor(scope: ResourceScope, canvas: HTMLCanvasElement, private readonly events: ControlEvents) {
    lockTarget = canvas;
    scope.defer(() => { if (lockTarget === canvas) lockTarget = null; });
    // A new world (a loaded save, a replay) starts from the real lock state; a free cursor carries over.
    store.set({ pointerLocked: document.pointerLockElement === canvas || freeCursor });
    const clear = () => {
      this.keys.clear();
      this.mouseMine = this.mouseUse = this.clickMine = this.clickUse = false;
      this.sprinting = false;
    };
    scope.listen(window, 'blur', clear);
    scope.listen(document, 'visibilitychange', clear);
    scope.listen(window, 'touchstart', () => { this.lastTouch = performance.now(); }, { capture: true, passive: true });
    scope.listen(window, 'keydown', event => this.keyDown(event as KeyboardEvent));
    scope.listen(window, 'keyup', event => { this.keys.delete((event as KeyboardEvent).code); });
    scope.listen(document, 'pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      // Losing the lock with nothing open shows the pause menu (ControllerView watches pointerLocked).
      store.set({ pointerLocked: locked });
      if (!locked) clear();
      else { this.free = false; this.refusals = 0; }
    });
    scope.listen(document, 'pointerlockerror', () => {
      if (this.clickLocking && ++this.refusals >= 2) {
        this.free = true;
        store.set({ pointerLocked: true });
      }
      this.clickLocking = false;
    });
    const captured = () => document.pointerLockElement === canvas || this.free;
    scope.listen(document, 'mousemove', event => {
      const e = event as MouseEvent, { sensitivity, invertY } = store.get().settings;
      // Free cursor: any held button (middle to look without acting) turns the view, like dragging on touch.
      if (document.pointerLockElement !== canvas && !(this.free && e.buttons && store.get().screen === null && e.target === canvas)) return;
      // Some browsers report one huge jump right after locking.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      applyLook(this, e.movementX, e.movementY, MOUSE_RADIANS * sensitivity, invertY);
    });
    scope.listen(window, 'mousedown', event => {
      const e = event as MouseEvent;
      if (performance.now() - this.lastTouch < 800) return;
      if (document.pointerLockElement !== canvas) {
        const target = e.target instanceof Element ? e.target : null;
        if (store.get().screen !== null || target !== canvas && target?.closest(INTERACTIVE)) return;
        if (e.button === 0) {
          this.clickLocking = true;
          requestLock();
        }
        if (!this.free) return;
      }
      if (e.button === 0) this.mouseMine = this.clickMine = true;
      if (e.button === 2) this.mouseUse = this.clickUse = true;
    });
    scope.listen(window, 'mouseup', event => {
      const e = event as MouseEvent;
      if (e.button === 0) this.mouseMine = false;
      if (e.button === 2) this.mouseUse = false;
    });
    scope.listen(canvas, 'contextmenu', event => event.preventDefault());
    scope.listen(window, 'wheel', event => {
      if (!captured() || store.get().screen) return;
      const dy = (event as WheelEvent).deltaY;
      if (dy) selectSlot(store.get().selected + Math.sign(dy));
    }, { passive: true });
  }

  private keyDown(e: KeyboardEvent) {
    if (typing(e.target) || e.metaKey) return;
    // E and Escape belong to the UI (ControllerView), which handles them in the capture phase. Number keys also pick the
    // slot the creative palette fills.
    const screen = store.get().screen;
    if (e.code.startsWith('Digit') && e.code.length === 6 && e.code[5] !== '0' && (!screen || screen === 'creative')) selectSlot(Number(e.code[5]) - 1);
    if (screen) return;
    if (e.code === 'KeyQ' && !e.repeat) dropSlot(store.get().selected, e.ctrlKey);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (!e.repeat) {
      if (e.code === 'Space' && this.jumpTaps.tap(performance.now()) && this.events.creative()) this.flyToggle = true;
      if (e.code === 'KeyW' && this.forwardTaps.tap(performance.now())) this.sprinting = true;
    }
    this.keys.add(e.code);
  }

  /** Sample this frame's intent and button edges. `canSprint` is false when hungry or sneaking. */
  sample(canSprint: boolean): MoveIntent {
    const { sensitivity, invertY } = store.get().settings;
    if (touch.lookX || touch.lookY) {
      applyLook(this, touch.lookX, touch.lookY, TOUCH_RADIANS * sensitivity, invertY);
      touch.lookX = touch.lookY = 0;
    }
    const intent = moveFromInput(this.keys, touch, this.yaw, this.intent);
    if (touch.jump && !this.touchJump && this.jumpTaps.tap(performance.now()) && this.events.creative()) this.flyToggle = true;
    this.touchJump = touch.jump;
    if (held(this.keys, 'ControlLeft', 'ControlRight') || touch.sprint) this.sprinting = true;
    if (intent.forward <= 0 || !canSprint || intent.sneak) this.sprinting = false;
    intent.sprint = this.sprinting;
    const mine = this.mouseMine || this.clickMine || touch.mine, use = this.mouseUse || this.clickUse || touch.use;
    this.clickMine = this.clickUse = false;
    this.minePressed = mine && !this.mine;
    this.usePressed = use && !this.use;
    this.useReleased = !use && this.use;
    this.mine = mine;
    this.use = use;
    return intent;
  }
}
