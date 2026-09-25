/** Full-screen pan-and-zoom map (opened from the mini map). Escape or Close returns focus to the opener. */
import { useEffect, useRef } from 'react';
import { BoardMap, type BoardMapProps } from './board-map';

type Props = BoardMapProps & { title?: string; onClose(): void };

export function MapScreen({ title = 'Island map', onClose, ...map }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!, previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className="island-settlers-map-screen" aria-label={title}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header>
      <h2>{title}</h2>
      <button type="button" className="kp-btn kp-btn-ghost kp-btn-sm" onClick={onClose}><span>Close</span></button>
    </header>
    <BoardMap {...map} mode="full"/>
  </dialog>;
}
