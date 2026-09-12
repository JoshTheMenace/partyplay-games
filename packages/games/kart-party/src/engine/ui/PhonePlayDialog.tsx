import { useState } from 'react';
import { Flag, QrCode, Smartphone, Wifi, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ArcadeButton, Eyebrow, Panel, Spinner } from './primitives';
import { Modal } from './Modal';
import { useQr } from './useQr';
import { usePartyAddress } from '../usePartyAddress';

/** QR that opens the game's home screen on a phone so the player can pick Solo race there. Not a room join. */
export function PhonePlayDialog({ onClose }: { onClose: () => void }) {
  const { origins, error } = usePartyAddress(true);
  // The hook owns every reachable choice and clears origins on failure so a stale code never lingers.
  const origin = origins[0] ?? '';
  const url = origin ? `${origin}/kart-party/` : '';
  const { dataUrl, failed } = useQr(url);
  const searching = (!url && !error) || (Boolean(url) && !failed);
  return (
    <Modal label="Play on your phone" onClose={onClose} initialFocus="[data-autofocus]">
      <Panel className="kp-anim-pop flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow>Open on another device</Eyebrow>
            <h2 className="kp-display mt-1 text-2xl text-kp-cream">Play on your phone</h2>
          </div>
          <button
            type="button"
            data-autofocus
            className="rounded-full p-2 text-kp-cream/80 transition hover:bg-kp-cream/10 hover:text-kp-cream"
            onClick={onClose}
            aria-label="Close play on your phone"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-2xl border-4 border-kp-ink bg-kp-cream p-2 shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
          {dataUrl ? (
            // oxlint-disable-next-line next/no-img-element -- data URL rendered client side; next/image cannot optimize it
            <img src={dataUrl} alt={`QR code for ${url}`} className="block aspect-square w-full" />
          ) : (
            <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 text-kp-ink">
              {searching ? (
                <>
                  <Spinner className="border-kp-ink/20 border-t-kp-ink" />
                  <span className="px-6 text-center text-sm font-black">{url ? 'Drawing the code' : "Finding this computer's network address"}</span>
                </>
              ) : (
                <>
                  <Smartphone className="size-8" />
                  <span className="px-6 text-center text-sm font-black">
                    {url ? 'QR could not be drawn. Type the address instead.' : (error || 'No network address found. Connect this computer to Wi-Fi and try again.')}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <p className={cn('break-all text-center font-mono text-sm', url ? 'text-kp-cream' : 'text-kp-cream/50')} aria-live="polite">
          {url || 'Address will appear here'}
        </p>
        {error && url ? <p className="text-center text-xs font-bold text-kp-coral">{error}</p> : null}

        <ol className="flex flex-col gap-2 text-sm font-bold text-kp-cream/80">
          <li className="flex items-start gap-2">
            <Wifi className="mt-0.5 size-4 shrink-0 text-kp-lime" />
            <span>Use the same site address on your phone. Local network addresses need the same Wi-Fi.</span>
          </li>
          <li className="flex items-start gap-2">
            <QrCode className="mt-0.5 size-4 shrink-0 text-kp-sky" />
            <span>Scan the code with the camera app, or type the address in the browser.</span>
          </li>
          <li className="flex items-start gap-2">
            <Flag className="mt-0.5 size-4 shrink-0 text-kp-sun" />
            <span>
              Choose <span className="text-kp-cream">Solo race</span> when the game opens. The address updates on its own if the network changes.
            </span>
          </li>
        </ol>
        <p className="text-center text-xs font-bold text-kp-cream/50">Want everyone on one TV instead? Use Host a party and scan the code in the lobby.</p>

        <ArcadeButton tone="sun" size="md" icon={<Flag />} onClick={onClose}>
          Done
        </ArcadeButton>
      </Panel>
    </Modal>
  );
}

/** Pill for the title menu's secondary actions row. The address hook only runs while the dialog is open. */
export function PhonePlayButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
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
        <QrCode className="size-4" /> Play on your phone
      </button>
      {open ? <PhonePlayDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
