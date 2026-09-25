/** Held-input building and private-view bookkeeping (acks, teleports, impulses). Pure apart from the store queue calls. */
import { MAX_CMDS } from '../../shared/constants';
import { wrapAngle } from '../../shared/coords';
import type { Body } from '../../shared/physics';
import { IF, neutralInput, q2, q3, type Cmd, type Input, type PrivateView } from '../../shared/protocol';
import { acknowledge, resetQueue } from '../store';

export type InputSource = {
  body: Body | null; yaw: number; pitch: number; sprint: boolean; using: boolean; swinging: boolean; dead: boolean;
  slot: number; mine: [number, number, number] | null; tpAck: number; queue: readonly Cmd[];
};

/** The one Input sent through setInput. Without a live body (not spawned yet, dead) the position is flagged NO_POS. */
export function buildInput(s: InputSource): Input {
  const cmds = s.queue.slice(0, MAX_CMDS), body = s.body;
  if (!body || s.dead) return { ...neutralInput(), slot: s.slot, tpAck: s.tpAck, cmds };
  let f = 0;
  if (body.onGround) f |= IF.ON_GROUND;
  if (body.sneaking) f |= IF.SNEAK;
  if (s.sprint) f |= IF.SPRINT;
  if (body.flying) f |= IF.FLYING;
  if (s.using) f |= IF.USING;
  if (s.swinging) f |= IF.SWINGING;
  return {
    p: [q3(body.x), q3(body.y), q3(body.z)], v: [q2(body.vx), q2(body.vy), q2(body.vz)], yaw: q3(wrapAngle(s.yaw)), pitch: q3(s.pitch), f,
    slot: s.slot, mine: s.mine, tpAck: s.tpAck, cmds,
  };
}

export type NetEvents = { first: boolean; teleport: boolean; impulse: boolean };

/**
 * Tracks what this client has already applied from the private view. The first view (a fresh scene: new round or
 * reconnect) restarts command numbering after the server's ack and treats any existing teleport/impulse as applied.
 */
export class NetSync {
  tpAck = 0;
  private impSeen = 0;
  private started = false;

  receive(pv: PrivateView, body: Body | null): NetEvents {
    if (!this.started) {
      this.started = true;
      resetQueue(pv.ack);
      this.tpAck = pv.tp.n;
      this.impSeen = pv.imp.n;
      return { first: true, teleport: false, impulse: false };
    }
    acknowledge(pv.ack);
    const events: NetEvents = { first: false, teleport: false, impulse: false };
    if (pv.tp.n > this.tpAck) {
      this.tpAck = pv.tp.n;
      events.teleport = true;
      if (body) Object.assign(body, { x: pv.tp.x, y: pv.tp.y, z: pv.tp.z, vx: 0, vy: 0, vz: 0, onGround: false });
    }
    if (pv.imp.n > this.impSeen) {
      this.impSeen = pv.imp.n;
      events.impulse = true;
      if (body) {
        body.vx += pv.imp.vx;
        body.vy += pv.imp.vy;
        body.vz += pv.imp.vz;
        if (pv.imp.vy > 0) body.onGround = false;
      }
    }
    return events;
  }
}
