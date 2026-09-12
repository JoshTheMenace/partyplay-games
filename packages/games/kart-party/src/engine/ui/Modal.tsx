import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode, SyntheticEvent } from 'react';
import { cn } from '../../lib/utils';

/** Open modals, oldest first. Browsers can deliver one Escape to several stacked dialogs; only the top one may act. */
const stack: HTMLDialogElement[] = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Native modal dialog: top layer, inert page behind it, focus trapped by the browser, Escape via the cancel event.
 * Focus returns to whatever was focused before it opened. Mount it only while open.
 */
export function Modal({
  label,
  onClose,
  children,
  className,
  initialFocus,
}: {
  label: string;
  onClose: (reason: 'escape' | 'backdrop' | 'button') => void;
  children: ReactNode;
  className?: string;
  /** Selector for the element to focus on open. Defaults to the first focusable control. */
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const restore = useRef<Element | null>(null);
  const escapedAt = useRef(0);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    restore.current = document.activeElement;
    if (!el.open) el.showModal();
    stack.push(el);
    const target = initialFocus ? el.querySelector<HTMLElement>(initialFocus) : null;
    target?.focus();
    // Clicks on the dimmed backdrop land on the dialog element itself; clicks on content land on children.
    const onBackdrop = (event: MouseEvent) => {
      if (event.target === el) close.current('backdrop');
    };
    // Escape is handled here, once, and never reaches useGame's window listener while a modal is open.
    // Chrome skips the dialog cancel event when a keyboard-focusable scroll region has focus, so keydown is primary.
    // Explicit Tab wrap so focus never visits the browser chrome or the inert page behind the dialog.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        escapedAt.current = performance.now();
        if (stack[stack.length - 1] === el) close.current('escape');
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1], active = document.activeElement;
      if (event.shiftKey && (active === first || active === el)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('click', onBackdrop);
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('click', onBackdrop);
      el.removeEventListener('keydown', onKey);
      const index = stack.indexOf(el);
      if (index >= 0) stack.splice(index, 1);
      if (el.open) el.close();
      const previous = restore.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [initialFocus]);
  // Fallback for close requests that arrive without a keydown, such as a platform back gesture.
  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (performance.now() - escapedAt.current < 250) return;
    if (stack[stack.length - 1] !== ref.current) return;
    onClose('escape');
  };
  return (
    <dialog ref={ref} className={cn('kp-dialog', className)} aria-label={label} onCancel={onCancel}>
      {children}
    </dialog>
  );
}
