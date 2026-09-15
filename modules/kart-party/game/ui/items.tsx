import React, { type CSSProperties } from 'react';
import { Banana, Crosshair, Droplets, Flame, Gift, Magnet, Orbit, Radio, Rocket, Shield, Snowflake, Star } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ITEMS } from '../items';
import type { Item, Racer } from '../types';

type IconKey = (typeof ITEMS)[Item]['icon'];

/** One distinct Lucide silhouette per icon key declared in game/items.ts. Typecheck fails if a key is added without art. */
const ICONS: Record<IconKey, LucideIcon> = {
  flame: Flame,
  crosshair: Crosshair,
  banana: Banana,
  shield: Shield,
  radio: Radio,
  orbit: Orbit,
  droplets: Droplets,
  snowflake: Snowflake,
  magnet: Magnet,
  star: Star,
  rocket: Rocket,
  gift: Gift,
};

export function ItemIcon({ item, className }: { item: Item; className?: string }) {
  const Icon = ICONS[ITEMS[item].icon];
  return <Icon className={cn('size-full', className)} strokeWidth={2.5} aria-hidden="true" />;
}

/** Timed effects the simulation exposes as seconds remaining on the racer. Order is display priority. */
const STATUS = [
  { key: 'star', label: ITEMS.star.name, icon: Star, color: ITEMS.star.color },
  { key: 'shield', label: ITEMS.shield.name, icon: Shield, color: ITEMS.shield.color },
  { key: 'magnet', label: ITEMS.magnet.name, icon: Magnet, color: ITEMS.magnet.color },
  { key: 'frost', label: 'Frozen', icon: Snowflake, color: ITEMS.frost.color },
  { key: 'oil', label: 'Slippery', icon: Droplets, color: ITEMS.oil.color },
] as const satisfies readonly { key: 'star' | 'shield' | 'magnet' | 'frost' | 'oil'; label: string; icon: LucideIcon; color: string }[];

export function activeStatuses(racer: Racer) {
  return STATUS.filter((status) => racer[status.key] > 0);
}

/** Row of colored pips for the racer's active timed effects, with seconds left when there is room. */
export function StatusBadges({ racer, size = 24, showTime, className }: { racer: Racer; size?: number; showTime?: boolean; className?: string }) {
  const active = activeStatuses(racer);
  if (!active.length) return null;
  const label = active.map((status) => `${status.label} ${Math.ceil(racer[status.key])}s`).join(', ');
  return (
    <span className={cn('flex flex-wrap items-center justify-end gap-1', className)} title={label}>
      <span className="sr-only">Active: {label}</span>
      {active.map((status) => {
        const Icon = status.icon;
        const seconds = Math.ceil(racer[status.key]);
        return (
          <span
            key={status.key}
            className="kp-anim-pop flex items-center justify-center gap-0.5 rounded-full border-2 border-kp-ink px-1 text-kp-ink shadow-[0_2px_0_rgba(5,7,26,0.8)]"
            style={{ minWidth: size, height: size, background: status.color } as CSSProperties}
          >
            <Icon style={{ width: size * 0.58, height: size * 0.58 }} strokeWidth={3} aria-hidden="true" />
            {showTime ? <span className="kp-numeral pr-0.5" style={{ fontSize: size * 0.5 }}>{seconds}</span> : null}
          </span>
        );
      })}
    </span>
  );
}
