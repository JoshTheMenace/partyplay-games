import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Atom, Cpu, UserPlus, Crosshair, Eye, Gauge, Heart, HeartPulse, Hexagon, Navigation, Orbit, Rocket, Shield, Sparkles, Target, Waves, Wind, Zap, type LucideIcon } from 'lucide-react';
import type { CaptainView, Crew, Offer, PublicView, ShipView, SystemId, WeaponKind } from '../contracts';
import { AUGMENTS, ROLES, SYSTEMS, WEAPONS, speciesDef } from '../defs/catalog';
import { roomSlots, shipLayout } from '../defs/geometry';
import { hullDef } from '../defs/hulls';
import { drawShip } from '../render/ship';
import { manifest } from '../manifest';

export const ASSET = manifest.assetBase;
/** Backdrop image as a CSS variable; the stylesheet layers it over a gradient so missing files still look intentional. */
export const backdrop = (name: string) => ({ '--ss-bg': `url(${ASSET}backdrops/${name}.jpg)` }) as CSSProperties;
export const shipOf = (view: PublicView, captain: CaptainView) => view.ships.find(s => s.id === captain.shipId) ?? null;
export const tint = (color: string) => ({ '--c': color }) as CSSProperties;

export function Scrap({ n, sign }: { n: number; sign?: boolean }) {
  return <span className="ss-scrap"><Hexagon aria-hidden/><b className="kp-numeral">{sign && n > 0 ? '+' : ''}{n}</b><span className="ss-sr">scrap</span></span>;
}
export function CaptainChip({ captain, children }: { captain: CaptainView; children?: ReactNode }) {
  return <span className="ss-chip" style={tint(captain.color)}><i/>{captain.name}{children}</span>;
}
/** Voter initials in captain colors, with full names for assistive tech. */
export function Votes({ ids, captains }: { ids: readonly string[]; captains: readonly CaptainView[] }) {
  const voters = captains.filter(c => ids.includes(c.id));
  return voters.length ? <span className="ss-votes" aria-label={`Votes: ${voters.map(c => c.name).join(', ')}`}>{voters.map(c => <i key={c.id} style={tint(c.color)} title={c.name}>{[...c.name][0]?.toUpperCase()}</i>)}</span> : null;
}
/** "Waiting for captains…" count: disconnected captains are on autopilot and never block. */
export function Readiness({ captains, prompt }: { captains: readonly CaptainView[]; prompt: ReactNode }) {
  const live = captains.filter(c => c.connected), ready = live.filter(c => c.ready).length;
  return <footer className="ss-readiness"><span className="ss-readiness-prompt">{ready === live.length && live.length ? 'All captains ready' : prompt} <b className="kp-numeral">{ready}/{live.length}</b></span></footer>;
}

// ---------- items ----------
const WEAPON_ICON: Record<WeaponKind, LucideIcon> = { laser: Zap, missile: Rocket, beam: Waves, ion: Atom, flak: Sparkles, support: HeartPulse };
const SYSTEM_ICON: Record<SystemId, LucideIcon> = { helm: Navigation, engines: Gauge, shields: Shield, weapons: Crosshair, oxygen: Wind, medbay: Heart, teleporter: Orbit, cloak: Eye, defense: Target };
export type ItemInfo = { name: string; blurb: string; tag: string; icon: string | null; Glyph: LucideIcon; stats: string[] };
export function itemInfo(kind: Offer['kind'], defId: string, crew?: Offer['crew']): ItemInfo {
  if (kind === 'crew' && crew) { const sp = speciesDef(crew.species), role = ROLES.find(r => r.id === crew.role)!;
    return { name: crew.name, blurb: `${sp.blurb} ${role.blurb}`, tag: `${sp.name} ${role.name}`, icon: 'crew', Glyph: UserPlus, stats: [`${sp.maxHp} hp`] }; }
  if (kind === 'weapon') {
    const w = WEAPONS.find(d => d.id === defId);
    if (w) return { name: w.name, blurb: w.blurb, tag: `${w.kind} · tier ${w.tier}`, icon: w.kind, Glyph: WEAPON_ICON[w.kind],
      stats: [w.damage && `${w.shots > 1 ? `${w.shots}×` : ''}${w.damage} ${w.support === 'heal' ? 'heal' : w.support ? 'repair' : 'dmg'}`, w.ion && `${w.ion} ion`, `${(w.chargeMs / 1000).toFixed(w.chargeMs % 1000 ? 1 : 0)}s`, w.ammo && 'missile'].filter((s): s is string => !!s) };
  }
  if (kind === 'system') { const s = SYSTEMS.find(d => d.id === defId); if (s) return { name: s.name, blurb: s.blurb, tag: 'system', icon: null, Glyph: SYSTEM_ICON[s.id], stats: [`${s.maxTier} tiers`] }; }
  const a = AUGMENTS.find(d => d.id === defId);
  return { name: a?.name ?? defId, blurb: a?.blurb ?? '', tag: kind === 'augment' ? 'augment' : kind, icon: 'augment', Glyph: Cpu, stats: [] };
}
/** Lucide glyph, replaced by `icons/<name>.png` once that art loads (systems have no rendered icon). */
export function ItemIcon({ info }: { info: ItemInfo }) {
  return <span className="ss-item-icon"><info.Glyph aria-hidden/>{info.icon && <img src={`${ASSET}icons/${info.icon}.png`} alt="" onLoad={e => e.currentTarget.classList.add('ok')}/>}</span>;
}

// ---------- ship previews ----------
/** A pristine ShipView of a hull at its starting loadout, for hangar and results art. */
export function previewShip(hullId: string, paint: string, id = `preview-${hullId}`): ShipView {
  const hull = hullDef(hullId), rooms = hull.rooms.map(r => ({ id: r.id, system: r.system, tier: r.system ? hull.startSystems[r.system] ?? 0 : 0, damage: 0, ionMs: 0, fire: 0, breach: false, oxygen: 100, repair: 0 }));
  const levels: Partial<Record<SystemId, number>> = Object.fromEntries(rooms.filter(r => r.system && r.tier).map(r => [r.system, r.tier]));
  return { id, faction: 'ally', captainId: null, enemyId: null, hullId, name: hull.name, paint, slot: 0, hull: hull.maxHull, maxHull: hull.maxHull, shields: levels.shields ?? 0, shieldCharge: 1, tempShield: 0, tempShieldMs: 0,
    rooms, weapons: hull.startWeapons.map((defId, i) => ({ uid: `${id}-w${i}`, defId, charge: 1, target: null, auto: true, powered: i < (levels.weapons ?? 0) })), ammo: hull.startAmmo, augments: [],
    status: 'active', cloakMs: 0, cloakCooldownMs: 0, teleportCooldownMs: 0, defenseCooldownMs: 0, fleeAtMs: null, phase: 0, phases: [], ai: null, fleeBelow: 0, autopilot: false, lastHitBy: null, evasion: 0, maxShields: levels.shields ?? 0, levels };
}
/** Starting crew standing at their stations. */
export function previewCrew(ship: ShipView, ownerId: string | null): Crew[] {
  const hull = hullDef(ship.hullId), used = new Map<string, number>();
  return hull.startCrew.map((c, i) => {
    const station = ROLES.find(r => r.id === c.role)?.station, room = hull.rooms.find(r => r.system === station) ?? hull.rooms[i % hull.rooms.length];
    const n = used.get(room.id) ?? 0, slots = roomSlots(room), slot = slots[n % slots.length]; used.set(room.id, n + 1);
    return { id: `${ship.id}-c${i}`, name: c.role, species: c.species, role: c.role, faction: 'ally', ownerId, shipId: ship.id, roomId: room.id, x: slot.x, y: slot.y, hp: 100, maxHp: 100, state: 'manning', station: room.id, path: [] };
  });
}
/** A self-sizing canvas that keeps redrawing the ship (sprites load late, fires flicker). */
export function ShipCanvas({ ship, crew, colors, className = '' }: { ship: ShipView; crew: readonly Crew[]; colors: Record<string, string>; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null), props = useRef({ ship, crew, colors }); props.current = { ship, crew, colors };
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return;
    let frame = 0;
    const draw = (now: number) => {
      const dpr = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight, { ship, crew, colors } = props.current;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      if (w && h) drawShip(ctx, ship, crew, shipLayout(hullDef(ship.hullId), { x: 0, y: 0, w, h }), { nowMs: now, ownerColors: colors, detail: 'tv' });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={ref} className={`ss-ship-canvas ${className}`} aria-hidden/>;
}
