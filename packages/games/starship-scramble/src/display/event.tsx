import { Crosshair, Hexagon, Package, Radio, Rocket, ShieldAlert, Skull, Sparkles, UserPlus, Wrench, type LucideIcon } from 'lucide-react';
import { Countdown } from '../../../../party-ui/src/index';
import type { PublicView } from '../contracts';
import { Readiness, Votes, backdrop } from './common';

/** Effect lines are plain text from the run engine; pick an icon and tone from their wording. */
const LINE: [RegExp, LucideIcon][] = [[/scrap/i, Hexagon], [/hull|repair/i, Wrench], [/crew|joins|recruit/i, UserPlus], [/missile|ammo/i, Rocket], [/armada|ambush/i, Skull], [/weapon|augment|salvage|item/i, Package], [/fight|combat|hostile/i, Crosshair], [/damage|fire|breach|dies|lost/i, ShieldAlert]];
const lineIcon = (line: string) => LINE.find(([re]) => re.test(line))?.[1] ?? Sparkles;
const tone = (line: string) => /[−-]\d|\blos[et]\b|dies|damage|advances/i.test(line) ? 'bad' : /\+\d|joins|added|repair|delay/i.test(line) ? 'good' : '';

export function EventScreen({ view, serverNowMs }: { view: PublicView; serverNowMs(): number }) {
  const event = view.event; if (!event) return null;
  const deadline = view.voteDeadline ?? event.deadlineMs, top = Math.max(0, ...event.choices.map(c => c.votes.length)), live = view.captains.filter(c => c.connected);
  return <section className="ss-screen ss-event ss-bg" style={backdrop(view.map.sectorId)}>
    <article className={`ss-event-card ${event.result ? 'ss-event-done' : ''}`}>
      <div className="ss-event-story">
        <p className="kp-eyebrow"><Radio aria-hidden/> {view.map.name} · incoming transmission</p>
        <h1 className="kp-title">{event.title}</h1>
        <p className="ss-event-text">{event.result ?? event.text}</p>
      </div>
      {event.result ? <ul className="ss-event-lines">{event.resultLines.map((line, i) => { const Icon = lineIcon(line); return <li key={i} className={`ss-line-${tone(line)}`} style={{ animationDelay: `${.25 + i * .12}s` }}><Icon aria-hidden/>{line}</li>; })}</ul>
        : <ol className="ss-choices">{event.choices.map((c, i) => <li key={c.id} className={`ss-choice ${!c.available ? 'ss-choice-off' : ''} ${top && c.votes.length === top ? 'ss-choice-lead' : ''}`}>
          <span className="ss-choice-n kp-numeral">{i + 1}</span>
          <span className="ss-choice-body">{c.badge && <em className="ss-badge">{c.badge}</em>}<span>{c.label}</span>{!c.available && <small>Your fleet can't do this yet</small>}</span>
          <Votes ids={c.votes} captains={view.captains}/>
        </li>)}</ol>}
    </article>
    {event.result ? <Readiness captains={view.captains} prompt="Tap Continue when you're ready"/>
      : <footer className="ss-readiness"><span className="ss-readiness-prompt">{deadline ? <>Deciding in <Countdown deadline={deadline} serverNowMs={serverNowMs}/></> : 'Cast your votes'} <b className="kp-numeral">{event.choices.reduce((n, c) => n + c.votes.length, 0)}/{live.length} voted</b></span></footer>}
  </section>;
}
