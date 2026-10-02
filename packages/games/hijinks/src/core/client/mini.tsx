/* Mini phase: lazily loads a minigame's client chunk and renders its Display or Controller with MiniViewProps. */
import { Component, Suspense, use, useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { ArcadeButton } from '../../../../../party-ui/src/index';
import { MINI_CLIENTS } from '../../minis/registry.client';
import { miniInfo } from '../../minis/catalog';
import type { MiniClient, MiniViewProps } from '../contract';
import { Avatar } from '../ui';
import type { PackProps } from './shared';

const chunks = new Map<string, Promise<MiniClient>>();
/** Cached chunk load; failures stay cached until retried. */
export function loadMini(id: string): Promise<MiniClient> {
  let chunk = chunks.get(id);
  if (!chunk) {
    const load = Object.hasOwn(MINI_CLIENTS, id) ? MINI_CLIENTS[id]! : null;
    chunk = load ? load().then(m => m.default) : Promise.reject(new Error(`missing:${id}`));
    chunks.set(id, chunk);
  }
  return chunk;
}
/** Warm a chunk (e.g. during the intro) without surfacing errors. */
export const preloadMini = (id: string) => { loadMini(id).catch(() => chunks.delete(id)); };
export const resetMiniChunks = () => chunks.clear();

type Role = 'display' | 'controller';
function Card({ role, title, children }: { role: Role; title: string; children: ReactNode }) {
  return <div className={`hj-mini-card hj-mini-card-${role}`} role="status"><Avatar avatar={(title.length * 7) % 16} color="#ffd24a" size={role === 'display' ? 220 : 120} mood="thinking" /><h2>{title}</h2>{children}</div>;
}
class Boundary extends Component<{ role: Role; title: string; onRetry(): void; children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error: error ?? new Error('Unknown error') }; }
  render() {
    if (!this.state.error) return this.props.children;
    const missing = this.state.error instanceof Error && this.state.error.message.startsWith('missing:');
    return <Card role={this.props.role} title={missing ? `${this.props.title} isn’t in this build yet` : `${this.props.title} hit a snag`}>
      <p>{missing ? 'The game keeps running on the server; ask the host to update Hijinks.' : 'Your seat is safe. Try loading it again.'}</p>
      <ArcadeButton tone="sun" size="lg" onClick={this.props.onRetry}>Try again</ArcadeButton>
    </Card>;
  }
}
function View({ id, role, props }: { id: string; role: Role; props: MiniViewProps }) {
  const client = use(loadMini(id)), Screen = (role === 'display' ? client.Display : client.Controller) as ComponentType<MiniViewProps>;
  return <Screen {...props} />;
}

/** Builds MiniViewProps from the pack context; `send` wraps actions as { k: 'mini', session, a }. */
export function useMiniProps(ctx: PackProps): MiniViewProps | null {
  const view = ctx.publicView, session = view.current?.session ?? 0, sendAction = ctx.sendAction;
  const send = useCallback((a: Record<string, unknown>) => sendAction({ k: 'mini', session, a }), [sendAction, session]);
  return useMemo(() => view.mini == null ? null : {
    view: view.mini, me: ctx.privateView?.mini ?? null, playerId: ctx.playerId, players: view.players, vip: view.vip, settings: view.settings,
    media: view.media, now: ctx.serverNowMs, send, sessionKey: `${ctx.roundId}:${session}`,
  }, [view, ctx.privateView, ctx.playerId, ctx.serverNowMs, ctx.roundId, session, send]);
}

/** Renders the active minigame for this screen, with a loading card while its chunk downloads and a retry card on failure. */
export function MiniHost({ ctx, role }: { ctx: PackProps; role: Role }) {
  const id = ctx.publicView.current?.id ?? '', title = miniInfo(id)?.title ?? 'This game', props = useMiniProps(ctx), [attempt, setAttempt] = useState(0);
  if (!props) return <Card role={role} title="Hang tight…"><p>Setting up {title}.</p></Card>;
  return <Boundary key={`${id}:${attempt}`} role={role} title={title} onRetry={() => { chunks.delete(id); setAttempt(n => n + 1); }}>
    <Suspense fallback={<Card role={role} title={`Loading ${title}…`}><span className="hj-dots" aria-hidden="true"><i /><i /><i /></span></Card>}>
      <View id={id} role={role} props={props} />
    </Suspense>
  </Boundary>;
}
