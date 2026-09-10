import { useState } from 'react';
import type { ReactNode } from 'react';
import { BookOpen, Flag, Gamepad2, MoveHorizontal, QrCode, Sparkles, WifiOff, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ArcadeButton, Eyebrow, Keycap, Panel } from './primitives';
import { Modal } from './Modal';
import { DRIFT_TIERS } from './format';
import { ITEMS, ITEM_IDS } from '../items';
import { SPEED_CLASSES } from '../speed';
import { ItemIcon } from './items';

function Section({ icon, title, children, className }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-2 rounded-2xl border-[3px] border-kp-cream/10 bg-kp-ink/40 p-4', className)}>
      <h3 className="kp-display flex items-center gap-2 text-xl text-kp-sun">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-kp-sun/15 text-kp-sun [&>svg]:size-5">{icon}</span>
        {title}
      </h3>
      <div className="flex flex-col gap-2 text-sm font-bold leading-relaxed text-kp-cream/85">{children}</div>
    </section>
  );
}

const TIERS = [
  { label: 'Short hold', seconds: DRIFT_TIERS[0], color: '#28c6e7', boost: 'small boost' },
  { label: 'Medium hold', seconds: DRIFT_TIERS[1], color: '#ffb05b', boost: 'bigger boost' },
  { label: 'Long hold', seconds: DRIFT_TIERS[2], color: '#b58aff', boost: 'biggest boost' },
];

export function HowToPlayContent() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Section icon={<MoveHorizontal />} title="Driving">
        <p>Your kart speeds up on its own. You steer, and that is most of the game.</p>
        <p>
          <span className="text-kp-cream">Speed class:</span> pick one of {SPEED_CLASSES.length} in race setup. The CPUs setting is separate and only changes how sharply they drive.
        </p>
        <ul className="flex flex-col gap-1">
          {SPEED_CLASSES.map((option) => (
            <li key={option.value} className="flex gap-2">
              <span className="kp-display w-12 shrink-0 text-kp-sun">{option.label}</span>
              <span className="text-kp-cream/75">{option.description}</span>
            </li>
          ))}
        </ul>
        <p>
          <span className="text-kp-cream">Laptop:</span> <Keycap>←</Keycap> <Keycap>→</Keycap> or <Keycap>A</Keycap> <Keycap>D</Keycap> steer, <Keycap>↓</Keycap> or <Keycap>S</Keycap> brakes, <Keycap>Shift</Keycap> or <Keycap>Space</Keycap> drifts, <Keycap>E</Keycap> fires your item.
        </p>
        <p>
          <span className="text-kp-cream">Phone:</span> slide your thumb on the big pad to steer. Hold Drift, tap Item, hold Brake.
        </p>
        <p className="text-kp-cream/65">Prefer pressing to go? Turn off Auto gas in Settings to get a Gas button and the <Keycap>↑</Keycap> key.</p>
      </Section>

      <Section icon={<Sparkles />} title="Drift boost">
        <p>Hold Drift while turning to slide through a corner. Keep holding to charge up, then let go for a burst of speed.</p>
        <ul className="flex flex-col gap-1.5">
          {TIERS.map((tier) => (
            <li key={tier.label} className="flex items-center gap-2">
              <span className="size-3.5 shrink-0 rounded-full border-2 border-kp-ink" style={{ background: tier.color, boxShadow: `0 0 10px ${tier.color}` }} />
              <span className="text-kp-cream">{tier.label}</span>
              <span className="text-kp-cream/65">
                about {tier.seconds} s, sparks turn <span style={{ color: tier.color }}>{tier.color === '#28c6e7' ? 'blue' : tier.color === '#ffb05b' ? 'orange' : 'purple'}</span>, {tier.boost}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-kp-cream/65">Drifting stops if you leave the road, so keep the slide on the tarmac.</p>
      </Section>

      <Section icon={<Gamepad2 />} title="Items and coins" className="md:col-span-2">
        <p>Drive through a glowing box to grab an item. Karts near the back get the stronger ones.</p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ITEM_IDS.map((id) => (
            <li key={id} className="flex items-start gap-2 rounded-xl bg-kp-ink/50 p-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border-2 border-kp-ink" style={{ background: ITEMS[id].color, color: '#05071a' }}>
                <ItemIcon item={id} className="size-5" />
              </span>
              <span>
                <span className="kp-display block text-base" style={{ color: ITEMS[id].color }}>{ITEMS[id].name}</span>
                <span className="block text-kp-cream/75">{ITEMS[id].description}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-kp-cream/65">Coins on the road make your kart a little faster. Getting hit knocks a couple loose.</p>
      </Section>

      <Section icon={<Flag />} title="Laps and finishing">
        <p>Race the number of laps chosen in the lobby. A lap only counts when you drive the whole course the right way round.</p>
        <p>Go the wrong way and a warning flashes. Fly too far off the road, or stay stuck against a wall, and you are set back on the track at your last checkpoint.</p>
        <p>
          <span className="text-kp-cream">Rainbow Road</span> climbs high into space with banked bends and three big ramps. Rails guard the road, so commit to the jumps. Higher speed classes fly further.
        </p>
        <p className="text-kp-cream/65">The race keeps going until every human has finished. Once the leader is done, everyone else gets extra time that grows with the length of the race, and a countdown appears on screen for the last 30 seconds.</p>
      </Section>

      <Section icon={<QrCode />} title="Playing together">
        <p>
          <span className="text-kp-cream">Laptop or TV as host:</span> choose Host a party. By default the screen only hosts and shows the race; turn on Play from this device to race with the keyboard too. Phones scan the QR code, or type the room code, and become controllers. Up to ten people race on one screen, which splits into a view per racer.
        </p>
        <p>
          <span className="text-kp-cream">Phone as host:</span> choose Host a party on the phone and share the code. On the big screen, choose Join with code, enter it, and pick Watch on this screen.
        </p>
        <p className="text-kp-cream/65">Everyone opens the same site address. Local network addresses need the same Wi-Fi; public links work over the internet. Groups smaller than eight get CPU drivers in the empty seats; with nine or ten people the grid grows to fit everyone. Every racer has a different driver.</p>
      </Section>

      <Section icon={<WifiOff />} title="If a phone drops out" className="md:col-span-2">
        <p>No panic. The kart switches to autopilot and keeps racing. Reopen the page on the same phone and you are back in your seat with your kart, mid-race.</p>
      </Section>
    </div>
  );
}

export function HowToPlayDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="How to play" onClose={onClose} className="kp-dialog-wide" initialFocus="[data-autofocus]">
      <Panel className="kp-anim-pop flex max-h-[min(88vh,900px)] flex-col p-0">
        <div className="flex items-start justify-between gap-3 border-b-2 border-kp-cream/10 p-4 sm:p-5">
          <div>
            <Eyebrow>Kart Party</Eyebrow>
            <h2 className="kp-display mt-1 text-3xl text-kp-cream">How to play</h2>
          </div>
          <button
            type="button"
            data-autofocus
            className="rounded-full p-2 text-kp-cream/80 transition hover:bg-kp-cream/10 hover:text-kp-cream"
            onClick={onClose}
            aria-label="Close how to play"
          >
            <X className="size-6" />
          </button>
        </div>
        <div className="kp-scroll min-h-0 flex-1 p-4 sm:p-5">
          <HowToPlayContent />
        </div>
        <div className="border-t-2 border-kp-cream/10 p-4 sm:px-5">
          <ArcadeButton tone="sun" size="lg" icon={<Flag />} onClick={onClose} className="w-full sm:w-auto">
            Got it, let&apos;s race
          </ArcadeButton>
        </div>
      </Panel>
    </Modal>
  );
}

/** Small pill that opens the guide. Used on the title menu and the solo pause menu. */
export function HowToPlayButton({ className, tone = 'pill' }: { className?: string; tone?: 'pill' | 'arcade' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {tone === 'arcade' ? (
        <ArcadeButton tone="ghost" size="md" icon={<BookOpen />} className={className} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
          How to play
        </ArcadeButton>
      ) : (
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-2 rounded-full border-2 border-kp-cream/25 bg-kp-ink/50 px-4 py-2 text-sm font-black uppercase tracking-widest text-kp-cream/85 transition hover:border-kp-cream/60 hover:text-kp-cream',
            className,
          )}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <BookOpen className="size-4" /> How to play
        </button>
      )}
      {open ? <HowToPlayDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
