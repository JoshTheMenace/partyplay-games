import { SnapshotDecoder } from '../../party-contract/src/snapshot-cache';
import { HeldInputChannel } from './held-input';
import { CONTRACT_VERSION, MAX_MESSAGE_BYTES, MAX_SAVE_BYTES, type ActionResult, type GameManifest } from '../../party-contract/src/index';
import type { RoomView, Snapshot, Welcome, Wire } from '../../party-contract/src/protocol';
export type SessionState = { connection: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'; error: string | null; room: RoomView | null; snapshot: Snapshot | null; identity: { clientId: string; playerId: string | null } | null; games: GameManifest[] };
type Pending = { roundId: string; actionId: string; payload: unknown; resolve(result: ActionResult): void; expires: number; sentAt: number };
export class PartySession {
  state: SessionState = { connection: 'connecting', error: null, room: null, snapshot: null, identity: null, games: [] };
  private snapshotDecoder = new SnapshotDecoder();
  private syncPending = false;
  private socket: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private pending = new Map<string, Pending>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval>;
  private inputTimer: ReturnType<typeof setInterval>;
  private held = new HeldInputChannel((kind, payload) => { if (this.canInput()) this.send(kind === 'state' ? 'input.state' : 'input.release', { roundId: this.state.room!.roundId, seq: this.seq++, ...(kind === 'state' ? { payload } : {}) }); });
  private offset = 0; private bestRtt = Infinity; private seq = 0; private attempt = 0; private stopped = false; private lastMessageAt = Date.now(); private lastPingAt = 0;
  private credentials: { code: string; token: string } | null = null;
  private initial: Record<string, unknown> | null = null;
  private storageKey = 'party.collection.session.v1';
  constructor({ deferConnection = false } = {}) {
    try { const raw = sessionStorage.getItem(this.storageKey); if (raw) this.credentials = JSON.parse(raw); } catch { /* Private browsing may block storage; the live seat still works. */ }
    if (!deferConnection || this.credentials) this.connect(); else this.state.connection = 'idle';
    this.inputTimer = setInterval(() => { if (this.canInput()) this.held.flush(performance.now()); else this.held.release(false); }, 50);
    this.timer = setInterval(() => {
      const now = Date.now();
      if (this.socket?.readyState === WebSocket.OPEN && now - this.lastMessageAt > 15000) this.socket.close(4000, 'Connection silent');
      if (now - this.lastPingAt > 5000) { this.lastPingAt = now; this.send('clock.ping', { clientTime: now }); }
      for (const [id, action] of this.pending) {
        if (now >= action.expires || action.roundId !== this.state.room?.roundId) { this.pending.delete(id); action.resolve({ accepted: false, reason: 'Submission expired. Check the current round before trying again.' }); }
        else if (now - action.sentAt > 1200 && this.state.connection === 'connected') { action.sentAt = now; this.send('game.action', { roundId: action.roundId, actionId: id, payload: action.payload }); }
      }
    }, 500);
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<SessionState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private connect() {
    if (this.stopped) return;
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); this.socket = socket;
    socket.onopen = () => { if (this.socket !== socket) return; this.lastMessageAt = Date.now(); this.snapshotDecoder.reset(); this.syncPending = false; this.seq = 0; this.bestRtt = Infinity; this.update({ connection: 'connected', error: null }); this.send('clock.ping', { clientTime: Date.now() }); if (this.credentials) this.send('room.rejoin', this.credentials); else if (this.initial) this.send(String(this.initial.type), this.initial); };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      let message: Wire; try { message = JSON.parse(event.data); } catch { this.update({ error: 'The server sent an unreadable response. Reload the page.' }); return; }
      if (message.v !== CONTRACT_VERSION) { this.update({ error: 'Client version changed. Refresh this browser.' }); return; }
      if (message.type === 'clock.pong') { const rtt = Date.now() - Number(message.clientTime); if (rtt >= 0 && rtt < this.bestRtt) { this.bestRtt = rtt; this.offset = Number(message.serverTime) - (Number(message.clientTime) + rtt / 2); } }
      if (message.type === 'room.welcome') { const welcome = message as unknown as Welcome; this.credentials = { code: welcome.room.code, token: welcome.token }; try { sessionStorage.setItem(this.storageKey, JSON.stringify(this.credentials)); } catch { /* Continue without persisted reconnect. */ } this.initial = null; this.attempt = 0; this.update({ identity: { clientId: welcome.clientId, playerId: welcome.playerId }, room: welcome.room, games: welcome.games, error: null }); }
      if (message.type === 'room.state') { const room = message.room as RoomView; if (!this.state.room || room.id !== this.state.room.id || room.revision >= this.state.room.revision) { const changed = room.roundId !== this.state.room?.roundId; this.update({ room, ...(changed ? { snapshot: null } : {}) }); if (changed || room.phase !== 'playing') this.held.release(false); if (changed) { this.snapshotDecoder.reset(); this.syncPending = false; this.clearActions('The round changed.'); } } }
      if (message.type === 'game.snapshot' || message.type === 'round.results') { const snapshot = message as unknown as Snapshot; if (snapshot.roundId === this.state.room?.roundId && (!this.state.snapshot || snapshot.revision >= this.state.snapshot.revision)) { const decoded = this.snapshotDecoder.decode(snapshot, this.state.games.find(game => game.id === this.state.room?.gameId)?.snapshotCache); if (decoded) { this.syncPending = false; this.update({ snapshot: decoded }); } else if (!this.syncPending) { this.syncPending = true; this.send('snapshot.sync', { roundId: snapshot.roundId }); } } }
      if (message.type === 'action.ack') { const action = this.pending.get(String(message.actionId)); if (action && message.roundId === action.roundId) { this.pending.delete(action.actionId); action.resolve({ accepted: message.accepted === true, ...(typeof message.reason === 'string' ? { reason: message.reason } : {}) }); } }
      if (message.type === 'error') { if (message.code === 'REJOIN') { this.forget(); this.update({ identity: null, room: null, snapshot: null }); } this.initial = null; this.update({ error: String(message.reason) }); }
      if (message.type === 'room.closed') { this.forget(); this.stopped = true; this.clearActions('Room closed.'); this.update({ connection: 'closed', room: null, identity: null, snapshot: null, error: String(message.reason) }); }
    };
    socket.onerror = () => { if (this.socket === socket) this.update({ error: 'Cannot reach the game server. Check your connection and try again.' }); };
    socket.onclose = event => {
      if (this.socket !== socket || this.stopped) return;
      this.held.release(false);
      if (event.code === 4001) { this.stopped = true; this.clearActions('Seat opened in another connection.'); this.update({ connection: 'closed', error: 'Your seat was opened in another connection. Close this tab.' }); return; }
      this.update({ connection: 'reconnecting', error: 'Connection lost. Reconnecting to your seat…' });
      this.retry = setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.attempt++));
    };
  }
  serverNowMs = () => Date.now() + this.offset;
  send(type: string, payload: Record<string, unknown> = {}): boolean { if (this.socket?.readyState !== WebSocket.OPEN) return false; const wire = JSON.stringify({ ...payload, v: CONTRACT_VERSION, type }); if (new TextEncoder().encode(wire).length > MAX_MESSAGE_BYTES) { this.update({ error: 'Submission is larger than 32 KiB. Reduce the drawing and try again.' }); return false; } this.socket.send(wire); return true; }
  join(type: 'room.create' | 'room.join', payload: Record<string, unknown>) {
    if (this.state.identity) return;
    this.forget(); this.initial = { ...payload, type }; this.stopped = false;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    const previous = this.socket; this.socket = null; previous?.close();
    this.update({ connection: 'connecting', error: null }); this.connect();
  }
  async worldSave(method: 'GET' | 'PUT', roundId: string, raw?: unknown): Promise<unknown> {
    if (!this.credentials || this.state.connection !== 'connected' || this.state.room?.roundId !== roundId || this.state.identity?.clientId !== this.state.room.hostId) throw new Error('Reconnect as the host before saving or loading.');
    const body = method === 'PUT' ? JSON.stringify(raw) : undefined;
    if (body && new TextEncoder().encode(body).length > MAX_SAVE_BYTES) throw new Error('World save exceeds 256 KiB.');
    const response = await fetch('/api/round/save', { method, headers: { Authorization: `Bearer ${this.credentials.token}`, 'X-Party-Room': this.credentials.code, 'X-Party-Round': roundId, 'Content-Type': 'application/json' }, ...(body ? { body } : {}), cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'World save failed.');
    return result;
  }
  async worldRecovery(method: 'GET' | 'PUT', gameId: string, slot?: 'latest' | 'previous', download = false): Promise<unknown> {
    if (!this.credentials || this.state.connection !== 'connected' || this.state.identity?.clientId !== this.state.room?.hostId || this.state.room?.gameId !== gameId) throw new Error('Reconnect as the host before recovering a world.');
    const query = new URLSearchParams({ gameId, ...(slot ? { slot } : {}), ...(download ? { download: '1' } : {}) });
    const response = await fetch(`/api/world/recovery?${query}`, { method, headers: { Authorization: `Bearer ${this.credentials.token}`, 'X-Party-Room': this.credentials.code, 'Content-Type': 'application/json' }, ...(method === 'PUT' ? { body: JSON.stringify({ slot }) } : {}), cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'World recovery failed.');
    return result;
  }
  private canInput() { return this.state.connection === 'connected' && this.state.room?.phase === 'playing' && !!this.state.identity?.playerId && this.state.room.activePlayerIds.includes(this.state.identity.playerId); }
  setInput = (payload: unknown) => { if (this.canInput() && !document.hidden) this.held.set(payload, performance.now()); };
  releaseInput = () => this.held.release();
  sendAction = (payload: unknown): Promise<ActionResult> => {
    if (!this.state.room?.roundId || this.state.room.phase !== 'playing') return Promise.resolve({ accepted: false, reason: 'Wait for the round to begin.' });
    if (this.pending.size >= 16) return Promise.resolve({ accepted: false, reason: 'Too many pending submissions. Wait for a response.' });
    const roundId = this.state.room.roundId;
    const actionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${this.seq++}`;
    // Random ID fallback supports ordinary HTTP LAN origins, where randomUUID is unavailable.
    if (new TextEncoder().encode(JSON.stringify({ v: CONTRACT_VERSION, type: 'game.action', roundId, actionId, payload })).length > MAX_MESSAGE_BYTES) return Promise.resolve({ accepted: false, reason: 'Drawing submission exceeds 32 KiB.' });
    return new Promise(resolve => { this.pending.set(actionId, { roundId, actionId, payload, resolve, expires: Date.now() + 20000, sentAt: Date.now() }); this.send('game.action', { roundId, actionId, payload }); });
  };
  assetsReady = (roundId = this.state.room?.roundId) => { if (roundId === this.state.room?.roundId && this.state.room?.phase === 'preparing') this.send('round.ready', { roundId: this.state.room.roundId }); };
  private clearActions(reason: string) { for (const action of this.pending.values()) action.resolve({ accepted: false, reason }); this.pending.clear(); }
  private forget() { this.credentials = null; try { sessionStorage.removeItem(this.storageKey); } catch { /* Storage unavailable. */ } }
  dispose() { this.releaseInput(); clearInterval(this.inputTimer); this.stopped = true; clearInterval(this.timer); if (this.retry) clearTimeout(this.retry); this.clearActions('Connection closed.'); this.socket?.close(); }
}
