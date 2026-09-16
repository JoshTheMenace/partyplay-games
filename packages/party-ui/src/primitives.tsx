import { useEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
export function ArcadeButton({ tone = 'sun', size = 'md', children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'sun' | 'coral' | 'sky' | 'lime' | 'grape' | 'ghost'; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return <button {...props} className={`kp-btn kp-btn-${tone} kp-btn-${size} ${className}`}><span>{children}</span></button>;
}
export function Panel({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={`kp-panel ${className}`} />; }
export function Eyebrow(props: HTMLAttributes<HTMLParagraphElement>) { return <p {...props} className={`kp-eyebrow ${props.className ?? ''}`} />; }
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`kp-input ${props.className ?? ''}`} />; }
export function StatusNotice({ children, tone = 'info' }: { children: ReactNode; tone?: 'error' | 'info' | 'success' }) { return <p className={`kp-notice kp-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>; }
export function ToggleRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange(value: boolean): void; disabled?: boolean }) { return <label className="kp-toggle"><span>{label}</span><button className="kp-switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button></label>; }
export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const dialog = ref.current!; dialog.showModal(); dialog.focus({ preventScroll: true }); dialog.scrollTop = 0; return () => { dialog.close(); if (previous?.isConnected) previous.focus(); }; }, []);
  return <dialog ref={ref} className={`kp-dialog ${wide ? 'kp-dialog-wide' : ''}`} aria-label={title} tabIndex={-1} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget;
    const tabbable = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex], [contenteditable="true"]')]
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
    const first = tabbable[0], last = tabbable.at(-1), active = document.activeElement;
    if (!first) { event.preventDefault(); dialog.focus(); }
    else if (event.shiftKey && (active === first || !tabbable.includes(active as HTMLElement))) { event.preventDefault(); last!.focus(); }
    else if (!event.shiftKey && (active === last || !tabbable.includes(active as HTMLElement))) { event.preventDefault(); first.focus(); }
  }} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}><Panel><h2>{title}</h2>{children}<ArcadeButton tone="ghost" onClick={onClose}>Close</ArcadeButton></Panel></dialog>;
}
export function Countdown({ deadline, serverNowMs }: { deadline: number; serverNowMs(): number }) {
  const [, render] = useState(0);
  useEffect(() => { const timer = setInterval(() => render(value => value + 1), 200); return () => clearInterval(timer); }, []);
  return <output className="kp-numeral" aria-label="Seconds remaining">{Math.max(0, Math.ceil((deadline - serverNowMs()) / 1000))}</output>;
}
