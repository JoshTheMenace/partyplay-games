/** Bottom sheet on the platform Modal (Escape, focus trap, focus restore); callers supply their own buttons. */
import type { ReactNode } from 'react';
import { Modal } from '../../../../../party-ui/src/index';

export function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return <div className="island-settlers-sheet"><Modal title={title} onClose={onClose}>{children}</Modal></div>;
}
