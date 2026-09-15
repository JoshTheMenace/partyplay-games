import React, { type ReactNode, type ButtonHTMLAttributes, type CSSProperties } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { driverOf } from './format';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'sun' | 'coral' | 'sky' | 'lime' | 'grape' | 'ghost';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  icon?: ReactNode;
};

const TONE: Record<NonNullable<ButtonProps['tone']>, string> = {
  sun: 'var(--kp-sun)',
  coral: 'var(--kp-coral)',
  sky: 'var(--kp-sky)',
  lime: 'var(--kp-lime)',
  grape: 'var(--kp-grape)',
  ghost: '',
};

const SIZE: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'text-sm px-4 py-2',
  md: 'text-base px-5 py-3',
  lg: 'text-xl px-7 py-4',
  xl: 'text-2xl px-6 py-5 sm:px-9 sm:text-3xl',
};

export function ArcadeButton({ tone = 'sun', size = 'md', icon, className, children, style, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn('kp-btn', tone === 'ghost' && 'kp-btn-ghost', SIZE[size], className)}
      style={tone === 'ghost' ? style : ({ '--kp-btn-bg': TONE[tone], ...style } as CSSProperties)}
      {...rest}
    >
      {icon ? <span className="inline-flex shrink-0 items-center [&>svg]:size-[1.1em]">{icon}</span> : null}
      <span>{children}</span>
    </button>
  );
}

export function Panel({ className, children, slant }: { className?: string; children: ReactNode; slant?: 'left' | 'right' }) {
  return (
    <div className={cn('kp-panel rounded-3xl', slant === 'right' && 'kp-slant', slant === 'left' && 'kp-slant-left', className)}>
      {children}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('kp-display text-xs tracking-[0.25em] text-kp-sun/90', className)}>{children}</p>
  );
}

export function Logo({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const scale = { sm: 'text-3xl', md: 'text-5xl', lg: 'text-7xl', xl: 'text-[clamp(4rem,14vw,11rem)]' }[size];
  return (
    <h1 className={cn('kp-title select-none', scale, className)} aria-label="Kart Party">
      <span className="kp-title-kart">Kart</span>
      <span className="kp-title-party">Party</span>
    </h1>
  );
}

/** Driver avatar: a stylized helmet in the driver's colors. Purely vector, no assets. */
export function DriverAvatar({ driver, size = 56, className, dim }: { driver: number; size?: number; className?: string; dim?: boolean }) {
  const d = driverOf(driver);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn('shrink-0 drop-shadow-[0_4px_0_rgba(5,7,26,0.6)]', dim && 'opacity-40 saturate-50', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`kp-helm-${driver}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="0.35" stopColor={d.color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="34" r="27" fill="#05071a" />
      <circle cx="32" cy="32" r="26" fill={d.color} />
      <circle cx="32" cy="32" r="26" fill={`url(#kp-helm-${driver})`} />
      <path d="M8 36c0-8 10-14 24-14s24 6 24 14v6c0 4-4 8-10 8H18c-6 0-10-4-10-8z" fill="#05071a" opacity="0.85" />
      <path d="M12 36c0-6 9-10 20-10s20 4 20 10v4c0 2-2 4-6 4H18c-4 0-6-2-6-4z" fill={d.accent} opacity="0.95" />
      <path d="M14 34c4-3 10-5 18-5" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" fill="none" />
      <path d="M22 12c3-4 17-4 20 0" stroke={d.accent} strokeWidth="5" strokeLinecap="round" fill="none" />
      <circle cx="32" cy="9" r="4" fill={d.accent} />
    </svg>
  );
}

export function DriverChip({
  driver,
  selected,
  onSelect,
  taken,
  compact,
}: {
  driver: number;
  selected: boolean;
  onSelect: (driver: number) => void;
  taken?: boolean;
  compact?: boolean;
}) {
  const d = driverOf(driver);
  return (
    <button
      type="button"
      className={cn('kp-chip flex flex-col items-center gap-1 rounded-2xl', compact ? 'p-2' : 'px-3 py-3')}
      style={{ '--chip-color': d.color } as CSSProperties}
      data-selected={selected}
      aria-pressed={selected}
      onClick={() => onSelect(driver)}
      title={`${d.name} the ${d.animal}`}
    >
      <DriverAvatar driver={driver} size={compact ? 44 : 60} dim={taken && !selected} />
      <span className="kp-display max-w-full truncate text-sm" style={{ color: d.color }}>
        {d.name}
      </span>
      {!compact ? <span className="text-xs font-black uppercase tracking-widest text-kp-cream/50">{d.animal}</span> : null}
      {taken && !selected ? (
        <span className="absolute -top-2 right-1 rounded-full bg-kp-ink px-2 py-0.5 text-xs font-black uppercase tracking-wider text-kp-cream/70">
          Taken
        </span>
      ) : null}
    </button>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="kp-display w-16 text-xs tracking-[0.2em] text-kp-cream/70">{label}</span>
      <div className="inline-flex items-center rounded-2xl border-[3px] border-kp-cream/15 bg-kp-ink/60 p-1">
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-xl text-kp-cream transition hover:bg-kp-cream/10 active:scale-90 disabled:opacity-30"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Fewer ${label}`}
        >
          <Minus className="size-5" />
        </button>
        <span className="kp-numeral w-14 text-center text-2xl text-kp-sun">
          {value}
          {suffix ? <span className="ml-0.5 text-sm text-kp-cream/60">{suffix}</span> : null}
        </span>
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-xl text-kp-cream transition hover:bg-kp-cream/10 active:scale-90 disabled:opacity-30"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`More ${label}`}
        >
          <Plus className="size-5" />
        </button>
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-1.5 border-0 p-0 sm:flex-row sm:items-center sm:gap-3', className)}>
      <legend className="kp-display float-left text-xs tracking-[0.2em] text-kp-cream/70 sm:w-16">{label}</legend>
      <div className="kp-seg min-w-0 flex-1 text-sm">
        {options.map((option) => (
          <button key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)} title={option.hint}>
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  icon,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-2xl border-[3px] border-kp-cream/10 bg-kp-ink/40 px-3 py-2.5 text-left transition hover:border-kp-cream/25"
    >
      {icon ? <span className="flex size-9 items-center justify-center rounded-xl bg-kp-cream/10 text-kp-cream [&>svg]:size-5">{icon}</span> : null}
      <span className="flex-1">
        <span className="kp-display block text-sm tracking-wider text-kp-cream">{label}</span>
        {hint ? <span className="block text-xs font-bold text-kp-cream/55">{hint}</span> : null}
      </span>
      <span
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full border-[3px] border-kp-ink transition-colors',
          checked ? 'bg-kp-lime' : 'bg-kp-cream/20',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-kp-cream shadow transition-transform',
            checked ? 'translate-x-[1.35rem]' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn('kp-anim-spin inline-block size-5 rounded-full border-[3px] border-kp-cream/25 border-t-kp-sun', className)}
      aria-hidden="true"
    />
  );
}

export function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border-2 border-kp-cream/30 bg-kp-ink/70 px-1.5 py-0.5 font-mono text-xs font-black text-kp-cream shadow-[0_2px_0_rgba(255,246,229,0.3)]">
      {children}
    </kbd>
  );
}
