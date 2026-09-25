/**
 * Local mining, attacking, placing and item use. Every world edit is applied to the optimistic overlay the moment
 * it is queued, with its sound and particles, so the world answers instantly; the server confirms or reverts it.
 */
import { B, blockOf, cellId, cellState, DOOR_OPEN, isLiquid } from '../../shared/blocks';
import type { CellReader } from '../../shared/chunk';
import { FACES, type Vec3 } from '../../shared/coords';
import { armorOf, I, itemOf } from '../../shared/items';
import { breakTime } from '../../shared/mining';
import { eyeInWater, type Body, bodyBox } from '../../shared/physics';
import { EAT_SECONDS, placementFor } from '../../shared/placement';
import type { Mode } from '../../shared/protocol';
import { raycastBlocks } from '../../shared/raycast';
import type { Target } from '../store';
import { IMPACT_PITCH, impactSound } from '../audio/sounds';
import type { Sfx } from '../audio/sfx';
import type { Controls } from './controls';
import type { Hand } from './hand';
import type { EditOverlay } from './overlay';
import type { Particles } from './particles';
import { sendCommand } from './predict';
import type { Rect } from './sprites';
import { blockUse, breakWrites, doorToggle, holdUse, useWrites, writesHitBodies } from './targeting';

export type InteractContext = {
  getCell: CellReader; overlay: EditOverlay; sfx: Sfx; particles: Particles; hand: Hand;
  tileOf(cell: number, face: number): Rect | null;
  itemRect(id: number): Rect | null;
  light(x: number, y: number, z: number): number;
  bodies(): Iterable<readonly number[]>;
  /** Remember a predicted edit so the matching server effect is not played twice. */
  predicted(x: number, y: number, z: number): void;
};
export type Frame = { dt: number; mode: Mode; body: Body; yaw: number; pitch: number; eye: Vec3; dir: Vec3; target: Target | null; held: number; slot: number; food: number; hasArrows: boolean };

const CREATIVE_BREAK = 0.22, SURVIVAL_BREAK_PAUSE = 0.15, PLACE_REPEAT = 0.22, ATTACK_REPEAT = 0.45, HIT_SOUND = 0.25;

export class Interaction {
  /** Block being mined (sent as Input.mine) and its 0..1 progress. */
  mine: [number, number, number] | null = null;
  progress = 0;
  using: 'eat' | 'bow' | null = null;
  useTime = 0;
  swinging = false;
  private mineKey = '';
  private mineHeld = -1;
  private breakWait = 0;
  private placeWait = 0;
  private attackWait = 0;
  private hitWait = 0;
  private crumbWait = 0;
  private swingTimer = 0;

  constructor(private readonly ctx: InteractContext) {}

  /** Stop mining and any held use (screen opened, death, teleport). */
  cancel() {
    this.mine = null;
    this.mineKey = '';
    this.progress = 0;
    this.using = null;
    this.useTime = 0;
  }

  update(f: Frame, input: Controls) {
    this.breakWait -= f.dt;
    this.placeWait -= f.dt;
    this.attackWait -= f.dt;
    this.hitWait -= f.dt;
    this.swingTimer -= f.dt;
    this.swinging = this.swingTimer > 0;
    if (this.using) this.updateUse(f, input);
    else if (input.use && (input.usePressed || this.placeWait <= 0)) this.use(f, input.usePressed);
    this.updateMining(f, input);
  }

  private swing() {
    this.ctx.hand.swing();
    this.swingTimer = 0.3;
    this.swinging = true;
  }

  // Mining and attacking --------------------------------------------------------------------------------------
  private updateMining(f: Frame, input: Controls) {
    const t = f.target;
    if (!input.mine || this.using) { this.stopMining(); return; }
    if (t?.kind === 'mob') {
      this.stopMining();
      if (input.minePressed || this.attackWait <= 0) {
        sendCommand({ t: 'attack', id: t.id });
        this.swing();
        this.attackWait = ATTACK_REPEAT;
        // Falling hits are critical in MC: show the sparks.
        if (!f.body.onGround && f.body.vy < -1) this.ctx.particles.sparks(f.eye[0] + f.dir[0] * t.distance, f.eye[1] + f.dir[1] * t.distance, f.eye[2] + f.dir[2] * t.distance);
      }
      return;
    }
    if (t?.kind !== 'block') {
      if (input.minePressed) { this.swing(); this.ctx.sfx.play('swish', { volume: 0.25 }); }
      this.stopMining();
      return;
    }
    const key = `${t.x},${t.y},${t.z},${t.cell}`;
    if (key !== this.mineKey || f.held !== this.mineHeld) {
      this.mineKey = key;
      this.mineHeld = f.held;
      this.progress = 0;
      this.hitWait = 0;
    }
    this.mine = [t.x, t.y, t.z];
    this.swinging = true;
    // A tap on every swing (one per hand swing), so mining answers even before the first crack shows.
    if (this.hitWait <= 0 && f.mode !== 'creative') {
      this.hitWait = HIT_SOUND;
      const block = blockOf(t.cell), at = [t.x + 0.5, t.y + 0.5, t.z + 0.5] as const;
      this.ctx.sfx.play(impactSound(block.sound, Math.random() * 3), { at, volume: 0.28, pitch: IMPACT_PITCH.hit, jitter: 0.1 });
      this.ctx.particles.mining(t.point, t.face, this.ctx.tileOf(t.cell, t.face), this.ctx.light(t.point[0], t.point[1], t.point[2]));
    }
    if (this.breakWait > 0) return;
    if (f.mode === 'creative') {
      this.breakBlock(t.x, t.y, t.z, t.cell);
      this.breakWait = CREATIVE_BREAK;
      return;
    }
    const seconds = breakTime(t.cell, f.held, f.body.onGround || f.body.flying, eyeInWater(this.ctx.getCell, f.body));
    if (!Number.isFinite(seconds)) return;
    this.progress = seconds <= 0 ? 1 : Math.min(1, this.progress + f.dt / seconds);
    if (this.progress >= 1) {
      this.breakBlock(t.x, t.y, t.z, t.cell);
      this.breakWait = SURVIVAL_BREAK_PAUSE;
    }
  }
  private stopMining() {
    this.mine = null;
    this.mineKey = '';
    this.progress = 0;
  }

  private breakBlock(x: number, y: number, z: number, cell: number) {
    const { getCell, overlay, sfx, particles } = this.ctx;
    const n = sendCommand({ t: 'break', x, y, z });
    overlay.set(breakWrites(getCell, x, y, z, cell), n);
    this.ctx.predicted(x, y, z);
    const block = blockOf(cell), light = this.ctx.light(x + 0.5, y + 0.5, z + 0.5);
    sfx.play(impactSound(block.sound, Math.random() * 3), { at: [x + 0.5, y + 0.5, z + 0.5], pitch: IMPACT_PITCH.break });
    particles.breakBlock(x, y, z, this.ctx.tileOf(cell, 4), light);
    this.progress = 0;
    this.mineKey = '';
  }

  // Placing and using -----------------------------------------------------------------------------------------
  private use(f: Frame, pressed: boolean) {
    const { getCell } = this.ctx;
    let t = f.target;
    // Empty buckets can target water and lava, which the crosshair otherwise passes through. The server fills from the
    // cell across the clicked face, so aim the command at the cell in front of the liquid, facing into it.
    if (f.held === I.bucket) {
      const hit = raycastBlocks(getCell, f.eye, f.dir, 5, cell => blockOf(cell).targetable || isLiquid(cell));
      if (hit && isLiquid(hit.cell)) {
        const [dx, dy, dz] = FACES[hit.face]!, x = hit.x + dx, y = hit.y + dy, z = hit.z + dz;
        t = { kind: 'block', x, y, z, face: hit.face ^ 1, cell: getCell(x, y, z), point: hit.point };
        if (pressed) this.useBlock(f, t, 'bucket');
        return;
      }
    }
    if (t?.kind === 'mob') {
      if (pressed) { sendCommand({ t: 'interact', id: t.id }); this.swing(); }
      this.placeWait = PLACE_REPEAT;
      return;
    }
    if (t?.kind === 'block') {
      const kind = blockUse(t.cell, getCell(t.x, t.y + 1, t.z), f.held, f.body.sneaking);
      if (kind === 'open' || kind === 'door') {
        if (!pressed) return;
        const n = sendCommand({ t: 'use', x: t.x, y: t.y, z: t.z, face: t.face });
        if (kind === 'door') {
          this.ctx.overlay.set(doorToggle(getCell, t.x, t.y, t.z, t.cell), n);
          this.ctx.sfx.play(cellState(t.cell) & DOOR_OPEN ? 'close' : 'open', { at: [t.x + 0.5, t.y + 0.5, t.z + 0.5] });
          this.ctx.predicted(t.x, t.y, t.z);
        }
        this.swing();
        this.placeWait = PLACE_REPEAT;
        return;
      }
      if (kind) {
        // Redstone controls toggle once per click, like doors.
        if ((kind === 'lever' || kind === 'button' || kind === 'repeater') && !pressed) return;
        this.useBlock(f, t, kind);
        return;
      }
      if (this.place(f, t)) return;
    }
    const armor = armorOf(f.held);
    if (armor && pressed) {
      // Right-click with armor puts it on, MC style.
      sendCommand({ t: 'useItem', slot: f.slot });
      this.ctx.sfx.play(armor.material === 'leather' ? 'step-cloth-1' : 'impact-metal-1', { volume: 0.5, pitch: 1.2 });
      this.swing();
      this.placeWait = PLACE_REPEAT;
      return;
    }
    const hold = holdUse(f.held, f.food, f.mode === 'creative', f.hasArrows);
    if (hold && pressed) {
      this.using = hold;
      this.useTime = 0;
      this.crumbWait = 0;
    }
    this.placeWait = PLACE_REPEAT;
  }

  /** A predicted 'use' on a block: its writes go into the overlay with the matching sound (the server confirms). */
  private useBlock(f: Frame, t: Extract<Target, { kind: 'block' }>, kind: NonNullable<ReturnType<typeof blockUse>>) {
    const { sfx, overlay, particles } = this.ctx, writes = useWrites(this.ctx.getCell, kind, t, f.held), at = [t.x + 0.5, t.y + 0.5, t.z + 0.5] as const;
    const n = sendCommand({ t: 'use', x: t.x, y: t.y, z: t.z, face: t.face });
    overlay.set(writes, n);
    for (const [x, y, z] of writes) this.ctx.predicted(x, y, z);
    if (kind === 'till' || kind === 'path') sfx.play('step-grass-1', { at: [t.x + 0.5, t.y + 1, t.z + 0.5] });
    else if (kind === 'lever' || kind === 'button' || kind === 'repeater') sfx.synth('click', { at, pitch: kind === 'lever' ? 0.75 : 0.95, volume: 0.9 });
    else if (kind === 'ignite' || kind === 'tnt') sfx.synth('scrape', { at, volume: 0.8 });
    else if (kind === 'bucket' && writes.length) {
      // Obsidian from water meeting lava hisses; everything else splashes.
      const [x, y, z, cell] = writes[writes.length - 1]!, fizz = writes.some(([, , , value]) => cellId(value) === B.obsidian);
      if (fizz) sfx.synth('fizz', { at: [x + 0.5, y + 0.5, z + 0.5] });
      else sfx.play('splash', { at: [x + 0.5, y + 0.5, z + 0.5], volume: cell ? 0.6 : 0.45 });
    } else if (kind === 'bonemeal') particles.sparks(t.x + 0.5, t.y + 0.8, t.z + 0.5, 6);
    this.swing();
    this.placeWait = PLACE_REPEAT * 1.5;
  }

  private place(f: Frame, t: Extract<Target, { kind: 'block' }>): boolean {
    if (!itemOf(f.held)?.places) return false;
    const hy = t.face === 2 || t.face === 3 ? undefined : t.point[1] - t.y;
    const writes = placementFor({ getCell: this.ctx.getCell }, f.held, hy === undefined ? t : { ...t, hy }, f.yaw, f.pitch);
    if (!writes) return false;
    const bodies = [bodyBox(f.body), ...this.ctx.bodies()];
    if (writesHitBodies(writes, bodies)) return false;
    const n = sendCommand(hy === undefined ? { t: 'place', x: t.x, y: t.y, z: t.z, face: t.face, slot: f.slot } : { t: 'place', x: t.x, y: t.y, z: t.z, face: t.face, slot: f.slot, hy });
    this.ctx.overlay.set(writes, n);
    const [x, y, z, cell] = writes[0]!;
    this.ctx.predicted(x, y, z);
    this.ctx.sfx.play(impactSound(blockOf(cell).sound, Math.random() * 3), { at: [x + 0.5, y + 0.5, z + 0.5], pitch: IMPACT_PITCH.place });
    this.swing();
    this.placeWait = PLACE_REPEAT;
    return true;
  }

  private updateUse(f: Frame, input: Controls) {
    const item = this.using;
    if (!input.use || (item === 'eat' && !itemOf(f.held)?.food) || (item === 'bow' && f.held !== I.bow)) {
      if (item === 'bow' && input.useReleased && f.held === I.bow && this.useTime > 0.15) sendCommand({ t: 'useItem', slot: f.slot });
      this.using = null;
      this.useTime = 0;
      return;
    }
    this.useTime += f.dt;
    if (item !== 'eat') return;
    this.crumbWait -= f.dt;
    if (this.crumbWait <= 0 && this.useTime > 0.2) {
      this.crumbWait = 0.2;
      this.ctx.sfx.synth('eat', { volume: 0.7 });
      const dx = -Math.sin(f.yaw), dz = -Math.cos(f.yaw);
      this.ctx.particles.crumbs(f.eye[0], f.eye[1], f.eye[2], dx, dz, this.ctx.itemRect(f.held), this.ctx.light(f.eye[0], f.eye[1], f.eye[2]));
    }
    if (this.useTime >= EAT_SECONDS) {
      sendCommand({ t: 'useItem', slot: f.slot });
      this.ctx.sfx.synth('burp', { volume: 0.5 });
      this.useTime = 0;
      if (f.food >= 19 && f.held !== I.golden_apple) this.using = null;
    }
  }

  /** 0..1 progress for the HUD and hand (eat duration or bow draw). */
  useProgress() { return !this.using ? 0 : this.using === 'eat' ? Math.min(1, this.useTime / EAT_SECONDS) : Math.min(1, this.useTime / 1); }
}
