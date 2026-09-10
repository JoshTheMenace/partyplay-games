/** Own only game resources, never the room socket. Late registrations are disposed immediately. */
export class ResourceScope {
  private cleanups: (() => void)[] = [];
  readonly controller = new AbortController();
  get signal() { return this.controller.signal; }
  constructor(signal?: AbortSignal) {
    if (signal?.aborted) this.dispose();
    else if (signal) { signal.addEventListener('abort', this.dispose, { once: true }); this.defer(() => signal.removeEventListener('abort', this.dispose)); }
  }
  defer(cleanup: () => void) { if (this.signal.aborted) cleanup(); else this.cleanups.push(cleanup); return cleanup; }
  own<T extends { dispose(): void }>(resource: T): T { this.defer(() => resource.dispose()); return resource; }
  listen(target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions) { target.addEventListener(type, listener, options); this.defer(() => target.removeEventListener(type, listener, options)); }
  dispose = () => {
    if (this.signal.aborted) return;
    this.controller.abort(); const errors: unknown[] = [];
    for (const cleanup of this.cleanups.splice(0).reverse()) { try { cleanup(); } catch (error) { errors.push(error); } }
    if (errors.length) console.error('Game resource cleanup failed', errors);
  };
}
