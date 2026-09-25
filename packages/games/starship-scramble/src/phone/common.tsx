import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { StatusNotice } from '../../../../party-ui/src/index';
import type { Action, CaptainView, ClientProps, Crew, HullDef, Offer, PublicView, ShipView, SystemId } from '../contracts';
import { AUGMENTS, ROLES, WEAPONS, speciesDef, systemDef } from '../defs/catalog';
import { roomSlots } from '../defs/geometry';

type WithoutTurn<A> = A extends { turn: number } ? Omit<A, 'turn'> : never;
export type Order = WithoutTurn<Action>;
export type Act = (order: Order, key?: string) => Promise<boolean>;
export type Actions = { act: Act; busy(key: string): boolean; error: string | null; hint(text: string): void };

/** Sends actions stamped with the latest turn; tracks pending keys and shows rejections for a few seconds. */
export function useActions(props: ClientProps): Actions {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set()), [error, setError] = useState<{ text: string; at: number } | null>(null);
  const turn = useRef(props.publicView.turn); turn.current = props.publicView.turn;
  useEffect(() => { if (!error) return; const timer = setTimeout(() => setError(null), 3500); return () => clearTimeout(timer); }, [error]);
  const mark = (key: string, on: boolean) => setPending(set => { const next = new Set(set); if (on) next.add(key); else next.delete(key); return next; });
  const hint = (text: string) => setError({ text, at: Date.now() });
  const act: Act = (order, key = order.type) => { mark(key, true);
    return props.sendAction({ turn: turn.current, ...order } as Action).then(r => { if (!r.accepted) hint(r.reason || 'The ship computer refused that order.'); return r.accepted; },
      () => { hint('Signal lost. Try again.'); return false; }).finally(() => mark(key, false)); };
  return { act, busy: key => pending.has(key), error: error?.text ?? null, hint };
}

export const myCaptain = (props: ClientProps): CaptainView | null =>
  props.publicView.captains.find(c => props.playerId && c.playerId === props.playerId) ?? props.publicView.captains.find(c => c.id === props.privateView?.captainId) ?? null;
export const shipOf = (view: PublicView, captain: CaptainView | null) => captain ? view.ships.find(s => s.id === captain.shipId) ?? view.ships.find(s => s.captainId === captain.id) ?? null : null;
export const captainById = (view: PublicView, id: string | null) => view.captains.find(c => c.id === id) ?? null;
export const ownerColors = (view: PublicView) => Object.fromEntries(view.captains.map(c => [c.id, c.color]));
export const roomName = (system: SystemId | null) => system ? systemDef(system).name : 'Bay';
export const alive = (crew: readonly Crew[]) => crew.filter(c => c.state !== 'dead' && c.hp > 0);
export function itemInfo(kind: Offer['kind'], defId: string, crew?: Offer['crew']): { name: string; blurb: string; price: number; tag?: string } {
  if (kind === 'crew' && crew) { const sp = speciesDef(crew.species), role = ROLES.find(r => r.id === crew.role)!; return { name: crew.name, blurb: `${sp.blurb} ${role.blurb}`, price: 0, tag: `${sp.name} ${role.name} · ${sp.maxHp} hp` }; }
  if (kind === 'system') { const s = systemDef(defId); return { name: s.name, blurb: s.blurb, price: s.installPrice }; }
  return (kind === 'weapon' ? WEAPONS : AUGMENTS).find(d => d.id === defId) ?? { name: defId, blurb: '', price: 0 };
}

/** A display-only ShipView of a hull for the hangar, with its starting crew at their stations. */
export function previewShip(hull: HullDef, paint: string, name: string): { ship: ShipView; crew: Crew[] } {
  const rooms = hull.rooms.map(r => ({ id: r.id, system: r.system, tier: r.system ? hull.startSystems[r.system] ?? 0 : 0, damage: 0, ionMs: 0, fire: 0, breach: false, oxygen: 100, repair: 0 }));
  const levels = Object.fromEntries(rooms.filter(r => r.system && r.tier).map(r => [r.system, r.tier]));
  const ship: ShipView = { id: `preview-${hull.id}`, faction: 'ally', captainId: null, enemyId: null, hullId: hull.id, name, paint, slot: 0, hull: hull.maxHull, maxHull: hull.maxHull,
    shields: levels.shields ?? 0, shieldCharge: 0, tempShield: 0, tempShieldMs: 0, rooms, weapons: hull.startWeapons.map((defId, i) => ({ uid: `w${i}`, defId, charge: 0, target: null, auto: true, powered: i < (levels.weapons ?? 0) })),
    ammo: hull.startAmmo, augments: [], status: 'active', cloakMs: 0, cloakCooldownMs: 0, teleportCooldownMs: 0, defenseCooldownMs: 0, fleeAtMs: null, phase: 0, phases: [], ai: null, fleeBelow: 0, autopilot: false, lastHitBy: null,
    evasion: 0, maxShields: levels.shields ?? 0, levels };
  const crew = hull.startCrew.map((c, i): Crew => { const station = ROLES.find(r => r.id === c.role)?.station, room = hull.rooms.find(r => r.system === station) ?? hull.rooms[i % hull.rooms.length], slot = roomSlots(room)[i % (room.w * room.h)];
    return { id: `pc${i}`, name: c.role, species: c.species, role: c.role, faction: 'ally', ownerId: null, shipId: ship.id, roomId: room.id, x: slot.x, y: slot.y, hp: 100, maxHp: 100, state: 'manning', station: room.id, path: [] }; });
  return { ship, crew };
}

export const Spin = () => <LoaderCircle className="sp-spin" size={16} aria-hidden="true"/>;
/** Segmented meter (hull, charge) with an accessible value. */
export function Meter({ value, max, label, tone = 'hull', segments = Math.min(max, 30) }: { value: number; max: number; label: string; tone?: string; segments?: number }) {
  const f = max ? Math.max(0, Math.min(1, value / max)) : 0;
  return <span className={`sp-meter sp-meter-${tone}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)} data-low={f < .34 || undefined}
    style={{ '--f': f, '--seg': segments } as React.CSSProperties}><i/></span>;
}
export const Pips = ({ on, total, label, tone = 'shield' }: { on: number; total: number; label: string; tone?: string }) =>
  <span className={`sp-pips sp-pips-${tone}`} role="img" aria-label={label}>{Array.from({ length: Math.max(total, on) }, (_, i) => <i key={i} data-on={i < on || undefined}/>)}</span>;
export const Dot = ({ color, label }: { color: string; label?: string }) => <span className="sp-dot" style={{ background: color }} title={label} aria-label={label} role={label ? 'img' : undefined}/>;
/** Rejection / hint toast plus the offline banner. */
export function Notices({ actions, connected }: { actions: Actions; connected?: boolean }) {
  return <div className="sp-notices" aria-live="polite">{connected === false && <StatusNotice tone="error">Reconnecting to the room. Orders resume when the link returns.</StatusNotice>}
    {actions.error && <StatusNotice tone="error">{actions.error}</StatusNotice>}</div>;
}
