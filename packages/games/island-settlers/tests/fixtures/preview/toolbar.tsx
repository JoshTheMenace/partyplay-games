/** Preview controls: fixture, view and seat pickers (reload with new query), clock and replay. */
import { useEffect, useState } from 'react';
import { FIXTURE_NAMES, type Fixture } from '../index';
import type { Clock } from './clock';

export const VIEWS = ['display', 'controller', 'personal', 'results', 'settings', 'instructions'] as const;
export type ViewName = (typeof VIEWS)[number];

type Props = {
  clock: Clock; view: ViewName; seat: string; fixture: Fixture; replay(): void; log: string[]; scene: string;
};

export function Toolbar({ clock, view, seat, fixture, replay, log, scene }: Props) {
  const [, render] = useState(0), rerender = () => render(n => n + 1);
  useEffect(() => { const timer = setInterval(rerender, 250); return () => clearInterval(timer); }, []);
  const go = (key: string, value: string) => {
    const q = new URLSearchParams(location.search);
    q.set(key, value);
    location.search = q.toString();
  };
  const offset = (clock.now() - fixture.now) / 1000;
  return <header className="kp-header isp-bar">
    <select aria-label="Fixture" value={fixture.name} title={fixture.description}
      onChange={e => go('fixture', e.target.value)}>
      {FIXTURE_NAMES.map(name => <option key={name}>{name}</option>)}
    </select>
    <select aria-label="View" value={view} onChange={e => go('view', e.target.value)}>
      {VIEWS.map(name => <option key={name}>{name}</option>)}
    </select>
    <select aria-label="Seat" value={seat} onChange={e => go('seat', e.target.value)}>
      {fixture.pub.seats.map(s => <option key={s.id} value={s.id}>
        {s.id} {s.name}{fixture.views[s.id] ? ` · ${fixture.views[s.id].task.kind}` : ' · public only'}
      </option>)}
    </select>
    <button type="button" onClick={() => { clock.toggle(); rerender(); }}>
      {clock.running() ? 'Pause' : 'Play'}
    </button>
    <button type="button" onClick={() => clock.jump(-5000)}>−5 s</button>
    <button type="button" onClick={() => clock.jump(5000)}>+5 s</button>
    <button type="button" onClick={replay}>Replay events</button>
    <output className="kp-numeral">t {offset >= 0 ? '+' : ''}{offset.toFixed(1)} s</output>
    <span>scene: {scene}</span>
    <code title={log.join('\n')}>{log.at(-1) ?? 'no actions sent'}</code>
  </header>;
}
