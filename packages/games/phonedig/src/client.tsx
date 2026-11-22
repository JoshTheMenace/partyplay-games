import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Eyebrow, Panel, SteerPad, StatusNotice,
} from '../../../party-ui/src/index';
import * as sprites from './sprites';
import { manifest } from './manifest';
import type {
  GameClientModule, GameViewProps, InstructionsViewProps, PrepareContext,
  ResultsViewProps, SettingsViewProps,
} from '../../../party-ui/src/index';
import { PhonedigScene } from './scene';
import { SUITS, SUIT_BY_ID } from './suits';
import type { Suit } from './suits';
import { THEME_BY_ID, themeOf } from './themes';
import { crewOf, ordinal } from './crews';
import { SHIFT } from './tuning';
import { CREW_STATE, CREW_STRIDE, DIGGER_STRIDE, SHIFT_AUTO, SHIFT_OPEN, TALLY_STRIDE } from './model';
import type {
  Action, NetInput, NetPlayer, PrivateView, PublicView, Settings, SiteEvent,
} from './model';
import { crewIn, recall, remember, shaftFor } from './viewstate';
import './style.css';

type Props = GameViewProps<NetInput, Action, PublicView, PrivateView>;

/* The stick resolves to the nearest of four directions, which is what the
 * original does: the shaft is a grid and a diagonal is not a move. Below the
 * threshold the stick is at rest and movement is released, rather than the
 * player creeping in whichever direction their thumb last favoured. */
const REST = 0.35;
function toDir(x: number, y: number): number | null {
  if (Math.hypot(x, y) < REST) return null;
  return Math.abs(x) >= Math.abs(y) ? (x > 0 ? 1 : 3) : (y > 0 ? 2 : 0);
}

/* WASD and the arrows, and space to pump.
 *
 * The shared pad already answers these, but only while it has focus — so a
 * player on a laptop had to find and click a joystick before the keyboard did
 * anything, which is not something anyone should have to discover. These are
 * bound on the document instead, so pressing D digs east whatever happens to
 * be focused. */
const KEY_DIR: Readonly<Record<string, number>> = Object.freeze({
  w: 0, a: 3, s: 2, d: 1,
  arrowup: 0, arrowleft: 3, arrowdown: 2, arrowright: 1,
});
/* Browsers have not always agreed on what the space bar is called: modern ones
 * send ' ', older ones 'Spacebar', and some automation sends 'Space'. All
 * three, because the cost of an extra string is nothing and the cost of a
 * pump key that silently does not work is the whole fight. */
const PUMP_KEYS = new Set([' ', 'space', 'spacebar', 'enter']);

/** Typing somewhere? Then the key was not meant for the shaft. */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return /^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable;
}

function useDigControls(props: Props) {
  /* A counter resumed from the private server acknowledgement, sent as held state rather than as
   * reliable actions: a dig session fires far more taps than the 256-action
   * round budget, and a cumulative count survives the 20 Hz coalescing that
   * would drop a per-frame tally. */
  const pump = useRef(Math.max(0, props.privateView?.pumpSeq ?? 0));
  const dir = useRef<number | null>(null);
  const held = useRef(false);
  /* The stick and the keyboard are separate sources and the keyboard wins
   * while a key is down. Keys are kept as an ordered list so that pressing D
   * while still holding S turns east immediately rather than waiting for S to
   * come up — which is how every other game with these keys behaves. */
  const stick = useRef<number | null>(null);
  const keys = useRef<string[]>([]);

  const push = () => props.setInput({
    dir: dir.current, dirHeld: held.current, pumpSeq: pump.current,
  });

  const settle = () => {
    const key = keys.current[keys.current.length - 1];
    const next = key !== undefined ? KEY_DIR[key] : stick.current;
    dir.current = next ?? null;
    held.current = next !== undefined && next !== null;
    push();
  };

  /* releaseInput is for leaving, not for standing still.
   *
   * It deliberately bypasses the 20 Hz coalescing so a disconnect stops a held
   * control immediately — which means calling it every time the stick crosses
   * back into the deadzone sends one uncoalesced message per crossing. A thumb
   * resting on the edge of the pad does that several times a second, and the
   * socket's 80-messages-per-second budget is gone in moments: the room answers
   * "Too many messages" and the controller stops working.
   *
   * So rest is published as ordinary held state, which coalesces like any other
   * value and means exactly the same thing to the server. Release is kept for
   * unmount, where the point is that nothing further will arrive. */
  useEffect(() => () => props.releaseInput?.(), []);

  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const p = live.current;
      if (!p.connected || p.privateView?.downed) return;
      const key = event.key.toLowerCase();
      if (PUMP_KEYS.has(key)) {
        event.preventDefault();
        // One tap per press. Auto-repeat would machine-gun the harpoon, which
        // the phone cannot do and the balance does not expect.
        if (event.repeat) return;
        pump.current++;
        push();
        return;
      }
      if (!(key in KEY_DIR)) return;
      event.preventDefault();                 // arrows would scroll the page
      if (event.repeat) return;
      if (!keys.current.includes(key)) keys.current.push(key);
      settle();
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!(key in KEY_DIR)) return;
      keys.current = keys.current.filter(k => k !== key);
      settle();
    };
    /* A key held when the window goes away never gets its keyup, so the digger
     * would walk into a wall until something else happened. */
    const letGo = () => { if (keys.current.length) { keys.current = []; settle(); } };

    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    window.addEventListener('blur', letGo);
    document.addEventListener('visibilitychange', letGo);
    return () => {
      document.removeEventListener('keydown', down);
      document.removeEventListener('keyup', up);
      window.removeEventListener('blur', letGo);
      document.removeEventListener('visibilitychange', letGo);
    };
  }, []);

  return {
    steer(x: number, y: number) {
      stick.current = toDir(x, y);
      settle();
    },
    tap() { pump.current++; push(); },
  };
}

/* The suit a phone wore last time.
 *
 * Per-viewer convenience only, so browser storage is the right home for it —
 * and it must survive being unavailable, because a private window, cleared
 * site data or a browser set to block storage all throw on access rather than
 * returning nothing. */
const REMEMBERED = 'phonedig.suit.v1';
function rememberedSuit(): string | null {
  try {
    const id = localStorage.getItem(REMEMBERED);
    return id && SUIT_BY_ID[id] ? id : null;
  } catch { return null; }
}
function rememberSuit(id: string) {
  try { localStorage.setItem(REMEMBERED, id); } catch { /* not worth a word */ }
}

/* One digger, standing, facing the camera.
 *
 * A colour chip said what the suit was TINTED, which is a fraction of what a
 * suit is: Pressure is a caged visor, Salvage is a whip aerial, Carbon is a red
 * eye in matte black. Picking from swatches meant picking a colour and finding
 * out what you were wearing once the drill started.
 *
 * Drawn onto a canvas rather than sliced out with CSS because the atlas is one
 * image and background-position against a 512x3070 sheet at device pixel ratios
 * that are not integers is exactly the smear the renderer's whole integer-scale
 * discipline exists to avoid. Falls back to the swatch when the sheet is
 * missing, which is a real state — see prepare() — and is still better than an
 * empty box. */
function SuitChip({ suit }: { suit: Suit }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const css = 32;
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    // The first frame of the walk cycle facing down: the one pose every suit
    // has, and the one that shows the visor.
    if (!sprites.draw(g, `player.${suit.id}.walk.D0`, 0, 0, canvas.width, canvas.height)) {
      g.fillStyle = suit.swatch;
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [suit.id]);

  return <canvas ref={ref} className="pd-suit-chip" aria-hidden="true"/>;
}

/* ── what a screen knows ──────────────────────────────────────────────────
 *
 * Every HUD below reads the same three things: who is in the room, the shaft
 * this screen is looking at, and how the crews stand against each other. The
 * first and last arrive only now and then, so they are remembered. */
type CrewLine = {
  index: number; name: string; color: string;
  level: number; depth: number; pay: number; atRisk: number; lives: number; left: number;
  state: number; size: number; place: number;
};

function standing(crews: readonly number[]): CrewLine[] {
  const lines: CrewLine[] = [];
  for (let i = 0; i * CREW_STRIDE < crews.length; i++) {
    const o = i * CREW_STRIDE, crew = crewOf(i);
    lines.push({
      index: i, name: crew.name, color: crew.color,
      level: crews[o], depth: crews[o + 1], pay: crews[o + 2], atRisk: crews[o + 3],
      lives: crews[o + 4], left: crews[o + 5], state: crews[o + 6], size: crews[o + 7], place: 0,
    });
  }
  const order = [...lines].sort((a, b) => b.pay - a.pay || b.depth - a.depth || a.index - b.index);
  // Depth breaks a tie on pay, so before anybody has banked the board is still an order.
  order.forEach((line, i) => { line.place = i > 0 && order[i - 1].pay === line.pay && order[i - 1].depth === line.depth ? order[i - 1].place : i; });
  return order;
}

function useSite(props: { roundId: string; publicView: PublicView; privateView: PrivateView | null }) {
  const v = props.publicView;
  const roster = remember(props.roundId, v.roster);
  const { wire } = shaftFor(v, props.privateView);
  return {
    roster, wire,
    /** The diggers in the shaft this screen is showing. */
    crew: crewIn(wire, roster),
    crews: standing(recall(props.roundId, v.site)?.crews ?? []),
    marks: recall(props.roundId)?.marks ?? [],
    feed: recall(props.roundId)?.feed ?? [],
  };
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const count = (n: number) => Math.round(n).toLocaleString('en-US');

/* Who someone is, everywhere at once.
 *
 * The scene draws a digger in their suit, so every other surface has to agree —
 * a crew rail dot in the room's colour and a body in the suit's is two
 * different people as far as a player glancing between them is concerned. */
function wornColour(q: { suit: string | null; color: string }) {
  return (q.suit && SUIT_BY_ID[q.suit]?.swatch) || q.color;
}

function Lives({ left, of }: { left: number; of: number }) {
  return (
    <span className="pd-lives" aria-label={`${left} of ${of} lives left`}>
      {'◆'.repeat(Math.max(0, left))}<i>{'◇'.repeat(Math.max(0, of - left))}</i>
    </span>
  );
}

/** The shift clock, turning urgent in its last half minute. Nothing when there is no clock. */
function ShiftClock({ v }: { v: PublicView }) {
  if (v.shiftLeft === null) return null;
  return (
    <span className={`pd-clock${v.shiftLeft <= 30 ? ' pd-clock-late' : ''}`} role="timer" aria-label="Time left in the shift">
      {clock(v.shiftLeft)}
    </span>
  );
}

function KitUp(props: Props) {
  const v = props.publicView;
  const kit = v?.kitup;
  const { roster } = useSite(props);
  const mine = roster.entries.find(q => q.id === props.playerId);
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const sent = useRef(false);

  const pick = (suit: string) => {
    setPending(suit);
    rememberSuit(suit);
    props.sendAction({ type: 'kit', turnId: 1, suit })
      .then(result => setProblem(result.accepted ? '' : result.reason ?? 'That did not take.'))
      .catch(() => setProblem('That did not reach the room.'));
  };

  /* Open on whatever they wore last, already sent, so a returning crew only has
   * to look up. Anyone who wants a different suit still just taps one. */
  useEffect(() => {
    if (sent.current || !props.playerId) return;
    const last = rememberedSuit();
    if (!last) return;
    sent.current = true;
    pick(last);
  }, [props.playerId]);

  const chosen = pending ?? (mine?.suit || null);
  /* Only the crew you are about to dig with can make a suit confusing: a rival
   * in the same one is in another shaft and you will never see them. */
  const mates = roster.entries.filter(q => q.id !== props.playerId && q.crew === mine?.crew);
  const crew = mine ? crewOf(mine.crew) : null;

  return (
    <div className="pd-kitup">
      <div className="pd-kitup-head">
        <Eyebrow>Kit up</Eyebrow>
        <h2>{chosen ? 'Change it, or wait for the crew.' : 'Suit up!'}</h2>
        {kit && <p className="pd-kitup-clock">
          {kit.everyonePicked ? 'Everyone is kitted. Drill starting…'
            : `${Math.ceil(kit.secondsLeft)}s`}
        </p>}
      </div>
      {/* Said here, before the drill: who you are with is the first thing a
          crew needs and the last thing a phone would otherwise tell it. */}
      {crew && v.crewCount > 1 && (
        <p className="pd-kitup-crew" style={{ '--pd-crew': crew.color } as CSSProperties}>
          You dig with the <strong>{crew.name}</strong>
          {mates.length > 0 && <> — {mates.map(q => q.name).join(', ')}</>}. {v.crewCount} crews, one site, the best haul wins.
        </p>
      )}
      {problem && <StatusNotice tone="error">{problem}</StatusNotice>}
      <ul className="pd-suits">
        {SUITS.map(suit => {
          const takenBy = mates.find(q => q.suit === suit.id);
          return (
            <li key={suit.id}>
              <button
                type="button"
                className={`pd-suit${chosen === suit.id ? ' pd-suit-on' : ''}`}
                aria-pressed={chosen === suit.id}
                disabled={!props.connected}
                onClick={() => pick(suit.id)}
              >
                <SuitChip suit={suit}/>
                <span className="pd-suit-name">{suit.id}</span>
                <span className="pd-suit-note">{suit.note}</span>
                {/* Not a lock: two diggers in one suit is legal, just confusing,
                    so it is said rather than prevented. */}
                {takenBy && <span className="pd-suit-taken">{takenBy.name}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* A digger's suit as a small figure, or their colour until they pick. */
function Figure({ who }: { who: { suit: string | null | ''; color: string } }) {
  const suit = who.suit ? SUIT_BY_ID[who.suit] : null;
  return suit ? <SuitChip suit={suit}/> : <span className="pd-suit-chip pd-figure-blank" style={{ background: who.color }}/>;
}

function KitUpDisplay(props: Props) {
  const v = props.publicView;
  const kit = v?.kitup;
  const { roster } = useSite(props);
  if (!v || !kit) return null;
  const crews = roster.byCrew;
  return (
    <div className="pd-muster" data-crews={crews.length}>
      <div className="pd-muster-head">
        <Eyebrow>Kit up</Eyebrow>
        <h2>{kit.everyonePicked ? 'Crew ready. Drill starting…'
          : `${crews.length > 1 ? 'The crews are' : 'The crew is'} choosing · ${Math.ceil(kit.secondsLeft)}s`}</h2>
        {crews.length > 1 && <p>{crews.length} crews, one site. Clear a level to bank its haul; the best share when the whistle goes takes the shift.</p>}
      </div>
      <ul className="pd-muster-crews">
        {crews.map((members, index) => {
          const crew = crewOf(index);
          return (
            <li key={index} className="pd-muster-crew" style={{ '--pd-crew': crew.color } as CSSProperties}>
              {crews.length > 1 && <h3>{crew.name}</h3>}
              <ul>
                {members.map(q => (
                  <li key={q.id} className={q.suit ? undefined : 'pd-muster-waiting'}>
                    <Figure who={q}/>
                    <span className="pd-crew-name">{q.name}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── the phone ────────────────────────────────────────────────────────── */

/* What the phone says over the shaft.
 *
 * Three questions, in the order a digger asks them: what am I doing (how many
 * are left before the haul is safe), what have I got to lose (the hopper), and
 * how are we doing (the bank, the lives, and against a clock or other crews the
 * time and the place). The goal used to be nowhere at all — "descend to bank
 * it" with no way to know that meant bursting every last monster. */
function PhoneHud(props: Props) {
  const v = props.publicView;
  const { wire, crew, crews } = useSite(props);
  const me = crew.find(q => q.id === props.playerId);
  const mates = crew.filter(q => q.id !== props.playerId);
  const mine = crews.find(line => line.index === wire.crew);
  const lead = crews[0];
  const load = me && me.hopperMax ? Math.min(1, me.hopper / me.hopperMax) : 0;
  const air = me && me.airMax ? Math.max(0, Math.min(1, me.air / me.airMax)) : 0;
  const clearing = wire.phase === 'levelclear' || wire.phase === 'descend';
  return (
    <div className="pd-phone-hud">
      <div className="pd-bar">
        <span className="pd-chip pd-level" aria-label={`Level ${wire.level}`}>L{wire.level}</span>
        <span className={`pd-chip pd-goal${wire.left <= 1 && !clearing ? ' pd-goal-near' : ''}`}>
          {clearing ? 'Banked!' : <><b>{wire.left}</b> to clear</>}
        </span>
        <span className={`pd-chip pd-load${load >= 1 ? ' pd-load-full' : ''}`} aria-label={`${me?.hopper ?? 0} in your hopper`}>
          <i style={{ width: `${load * 100}%` }}/>
          <span><b>{count(me?.hopper ?? 0)}</b> at risk</span>
        </span>
        <span className="pd-chip pd-banked"><b>{count(wire.banked + SHIFT.ORE_PAY * wire.oreBanked)}</b> banked</span>
        <span className="pd-chip"><Lives left={wire.lives} of={wire.livesMax}/></span>
        <span className="pd-bar-gap"/>
        {crews.length > 1 && mine && (
          <span className="pd-chip pd-place" style={{ '--pd-crew': mine.color } as CSSProperties}>
            <b>{ordinal(mine.place)}</b>
            {mine.place === 0 ? ' · leading' : lead && lead.pay > mine.pay ? ` · ${count(lead.pay - mine.pay)} behind` : ' · level'}
          </span>
        )}
        <ShiftClock v={v}/>
      </div>
      <div className={`pd-air${air <= 0.2 ? ' pd-air-low' : ''}`} role="img" aria-label={`Air ${Math.round(air * 100)} percent`}>
        <i style={{ width: `${air * 100}%` }}/>
      </div>
      {mates.length > 0 && (
        <ul className="pd-mates">
          {mates.map(q => (
            <li key={q.id} className={q.downed ? 'pd-mate-down' : undefined}>
              <span className="pd-crew-dot" style={{ background: wornColour(q) }}/>
              <span className="pd-crew-name">{q.name}</span>
              {q.downed ? <b>{Math.ceil(q.downT)}s</b> : <Hearts hp={q.hp} of={q.maxHp}/>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Hearts({ hp, of }: { hp: number; of: number }) {
  return (
    <span className="pd-crew-hp" aria-label={`${hp} of ${of} health`}>
      {'●'.repeat(Math.max(0, hp))}<i>{'○'.repeat(Math.max(0, of - hp))}</i>
    </span>
  );
}

function Controller(props: Props) {
  const controls = useDigControls(props);
  const me = props.privateView;
  const { crew } = useSite(props);
  /* A phone shows the game, not the room — so a player holding one had no way
   * to learn a teammate was on the floor except by looking at the television.
   * In a game whose whole co-op verb is going to get them, that is the one
   * thing the controller has to say out loud. Only teammates are listed: your
   * own state already has the notice below. */
  const fallen = crew.filter(q => q.downed && q.id !== props.playerId);
  const urgent = !!me && (me.downed || me.hp <= 1 || /roof|low|Whistle|wiped/i.test(me.message));
  return (
    <div className="pd-controller">
      <PhoneHud {...props}/>
      {!me?.downed && fallen.map(q => (
        <div key={q.id} className="pd-alert" style={{ borderColor: wornColour(q) }}>
          <span className="pd-crew-dot" style={{ background: wornColour(q) }}/>
          <strong>{q.name} is down.</strong> Harpoon them and pump. {Math.ceil(q.downT)}s
        </div>
      ))}
      <div className={`pd-controller-status${urgent ? ' pd-status-urgent' : ''}`}>
        {me?.downed ? (
          <p><strong>You are down.</strong> {me.beingRevived
            ? 'They have you on the line — hold on.'
            : `A teammate has to harpoon you and pump. ${Math.ceil(me.downT)}s`}</p>
        ) : (
          <>
            {me?.playing ? <Hearts hp={me.hp} of={me.maxHp}/> : <Eyebrow>Watching</Eyebrow>}
            <p>{me?.message ?? ''}</p>
          </>
        )}
      </div>
      <div className="pd-controller-pads">
        <SteerPad label="Dig" onChange={v => controls.steer(v.x, v.y)}
                  disabled={!props.connected || !!me?.downed}/>
        {/* The label is baked into pump.png: DOM text here gets selected by rapid
          * taps, and the selection swallows the presses that follow. */}
        <button
          className="pd-pump" type="button" aria-label="Pump"
          disabled={!props.connected || !!me?.downed}
          onPointerDown={event => { event.preventDefault(); controls.tap(); }}
          onContextMenu={event => event.preventDefault()}
        ><img src={`${manifest.assetBase}pump.png`} alt="" draggable={false}/></button>
      </div>
      {/* Shown only where there is a keyboard to use; see the media query. */}
      <p className="pd-keyhint" aria-hidden="true">WASD to dig · SPACE to pump</p>
    </div>
  );
}

/* ── the television ───────────────────────────────────────────────────── */

/* One digger on the board: who, how hurt, how much air, how much at stake. */
function DiggerRow({ q }: { q: NetPlayer }) {
  const air = Math.max(0, Math.min(1, q.airMax ? q.air / q.airMax : 0));
  const load = Math.max(0, Math.min(1, q.hopperMax ? q.hopper / q.hopperMax : 0));
  return (
    <li className={`pd-digger${q.downed ? ' pd-digger-down' : ''}`}>
      <Figure who={q}/>
      <span className="pd-crew-name">{q.name}</span>
      {q.downed
        ? <span className="pd-crew-downed">DOWN · {Math.ceil(q.downT)}s{q.reviveProgress > 0 && ` · ${Math.round(q.reviveProgress * 100)}%`}</span>
        : <Hearts hp={q.hp} of={q.maxHp}/>}
      <span className="pd-meter" role="img" aria-label={`Air ${Math.round(air * 100)} percent`}>
        <i style={{ width: `${air * 100}%` }} className={air <= 0.2 ? 'pd-meter-low' : 'pd-meter-air'}/>
      </span>
      <span className="pd-meter" role="img" aria-label={`Hopper ${Math.round(load * 100)} percent`}>
        <i style={{ width: `${load * 100}%` }} className={load >= 1 ? 'pd-meter-full' : 'pd-meter-load'}/>
      </span>
    </li>
  );
}

const FEED: Record<SiteEvent['type'], (e: SiteEvent, who: string) => string> = {
  bank: e => `banked ${count(Number(e.value) || 0)}`,
  descend: e => `down to level ${e.value}`,
  down: (_e, who) => `${who} is down`,
  revive: (_e, who) => `${who} is back up`,
  life: e => `spent a life · ${e.value} left`,
  wipe: () => 'wiped',
  relic: () => 'found a relic',
  crystal: () => 'carried out a crystal',
};

/* The board: everything about the shift that is not the picture.
 *
 * It sits beside the shaft rather than over it, because with sixteen crews it
 * is a table and a table laid over a dark tunnel is neither. With one crew it
 * is that crew's diggers; with several it is the race, and the crew the camera
 * is on opens out to show who is in it. */
function Board(props: Props) {
  const v = props.publicView;
  const { roster, wire, crew, crews, marks, feed } = useSite(props);
  const theme = THEME_BY_ID[themeOf(wire.level).id]?.name ?? '';
  const many = v.crewCount > 1;
  /* How much room a crew's row may take. Sixteen rows, four diggers and a feed
   * have to fit a 720p television with the shell's header above them. */
  const size = crews.length > 10 ? 'many' : crews.length > 5 ? 'some' : 'few';
  const spot = crewOf(wire.crew);
  const clearing = wire.phase === 'levelclear' || wire.phase === 'descend';
  const atRisk = crew.reduce((n, q) => n + q.hopper, 0);
  return (
    <aside className="pd-board" data-size={size}>
      <header className="pd-board-head">
        {many
          ? <><Eyebrow>{v.whistle ? 'Whistle — tools down' : 'The shift'}</Eyebrow><ShiftClock v={v}/></>
          : <><Eyebrow>Level {wire.level} · {theme}</Eyebrow><ShiftClock v={v}/></>}
      </header>

      {!many && (
        <div className="pd-totals">
          <p className="pd-total"><b>{count(wire.banked + SHIFT.ORE_PAY * wire.oreBanked)}</b><span>banked</span></p>
          <p className="pd-total pd-total-risk"><b>{count(atRisk)}</b><span>at risk</span></p>
          <p className={`pd-total pd-total-goal${wire.left <= 1 ? ' pd-goal-near' : ''}`}>
            <b>{clearing ? '✓' : wire.left}</b><span>{clearing ? 'cleared' : 'to clear'}</span>
          </p>
          <p className="pd-total"><Lives left={wire.lives} of={wire.livesMax}/><span>lives</span></p>
        </div>
      )}

      {many && (
        <ol className="pd-race">
          {crews.map(line => {
            const on = line.index === wire.crew;
            const members = roster.byCrew[line.index] ?? [];
            return (
              <li key={line.index} className={`pd-race-row${on ? ' pd-race-on' : ''}`} style={{ '--pd-crew': line.color } as CSSProperties}>
                <span className="pd-race-place">{line.place + 1}</span>
                <span className="pd-race-name">{line.name}</span>
                <span className="pd-race-marks" aria-hidden="true">
                  {members.map(q => {
                    const mark = marks[roster.entries.indexOf(q)] ?? 0;
                    return <i key={q.id} className={mark & 16 ? 'pd-mark-down' : (mark & 15) <= 1 ? 'pd-mark-hurt' : undefined}/>;
                  })}
                </span>
                <span className="pd-race-pay">{count(line.pay)}</span>
                <span className="pd-race-sub">
                  {line.state === CREW_STATE.out ? 'out'
                    : line.state === CREW_STATE.wiped ? 'wiped — back to the top'
                    : <>L{line.level} · {line.depth} m · {line.state === CREW_STATE.clearing ? 'banking!' : `${line.left} to clear`}
                        {line.atRisk > 0 && <em> · {count(line.atRisk)} at risk</em>}</>}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <section className="pd-onscreen" style={{ '--pd-crew': spot.color } as CSSProperties}>
        {many && <h3><span>On screen</span>{spot.name} · Level {wire.level} · {theme}</h3>}
        <ul className="pd-diggers">{crew.map(q => <DiggerRow key={q.id} q={q}/>)}</ul>
      </section>

      {/* What has just happened: across the site in a race, in this shaft otherwise. */}
      <ul className="pd-feed" aria-live="off">
        {feed.slice(-(size === 'few' ? 4 : 2)).map(e => {
          const who = e.who === undefined ? '' : roster.entries[e.who]?.name ?? 'A digger';
          const line = FEED[e.type]?.(e, who) ?? e.type;
          return (
            <li key={e.seq} style={{ '--pd-crew': crewOf(e.crew).color } as CSSProperties}>
              {many ? <><b>{crewOf(e.crew).name}</b> {line}</> : line.charAt(0).toUpperCase() + line.slice(1)}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function Display(props: Props) {
  if (!props.publicView) return null;
  return props.publicView.kitup ? <KitUpDisplay {...props}/> : <Board {...props}/>;
}

function Playing(props: Props) {
  if (!props.publicView) return null;
  return props.publicView.kitup ? <KitUp {...props}/> : <Controller {...props}/>;
}

function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  const [level, setLevel] = useState(String(settings.startLevel));
  return (
    <Panel>
      <Eyebrow>Crews</Eyebrow>
      <p>A room bigger than one crew splits into rival crews, each in a shaft of
        its own, racing for the best haul. Set this to 1 and everybody digs alone.</p>
      <input
        type="range" min={1} max={4} step={1} value={String(settings.crewSize)} disabled={disabled}
        aria-label="Diggers per crew"
        onChange={event => onChange({ ...settings, crewSize: Number(event.target.value) })}
      />
      <p className="pd-settings-value">{settings.crewSize === 1 ? 'Solo shafts' : `Up to ${settings.crewSize} to a crew`}</p>
      <Eyebrow>Shift</Eyebrow>
      <p>On a clock, the whistle ends the shift: what is banked counts in full,
        what is still in the hoppers at half. Without one, a crew digs until it is wiped.
        Automatic is no clock for one crew and {SHIFT.AUTO_MINUTES} minutes for a race.</p>
      <select
        value={String(settings.shift)} disabled={disabled} aria-label="Shift length"
        onChange={event => onChange({ ...settings, shift: Number(event.target.value) })}
      >
        <option value={SHIFT_AUTO}>Automatic</option>
        {[3, 4, 6, 8, 10, 15].map(m => <option key={m} value={m}>{m} minutes</option>)}
        <option value={SHIFT_OPEN}>No clock</option>
      </select>
      <Eyebrow>Starting level</Eyebrow>
      <p>Deeper ground pays more and fights back harder. Level 1 is the surface.</p>
      <input
        type="range" min={1} max={30} step={1} value={level} disabled={disabled}
        aria-label="Starting level"
        onChange={event => {
          setLevel(event.target.value);
          onChange({ ...settings, startLevel: Number(event.target.value) });
        }}
      />
      <p className="pd-settings-value">Level {level}</p>
      <Eyebrow>Lives per crew</Eyebrow>
      <p>Spent when nobody reaches a downed digger in time — or straight away
        when there is nobody left who could. Solo, this is simply how many times
        you can be killed.</p>
      <input
        type="range" min={1} max={9} step={1} value={String(settings.lives)} disabled={disabled}
        aria-label="Lives per crew"
        onChange={event => onChange({ ...settings, lives: Number(event.target.value) })}
      />
      <p className="pd-settings-value">{settings.lives} lives</p>
    </Panel>
  );
}

function InstructionsView({ role }: InstructionsViewProps) {
  // A host playing on this device reads the controller's instructions, not the
  // watching screen's — they are the one holding the stick.
  if (role === 'display') {
    return (
      <div className="pd-howto">
        <p>You are paid for what you dig, not what you kill.</p>
        <p><strong>Burst every monster on a level and the crew drops to the next,
          which banks the haul.</strong> Until then it rides in the hoppers, and a
          digger who goes down with nobody to pull them up takes theirs with them.</p>
        <p><strong>Five or more?</strong> The room splits into crews of up to four,
          each in a shaft of its own, on a {SHIFT.AUTO_MINUTES}-minute shift. This screen
          follows the action; the biggest share when the whistle goes takes it.</p>
      </div>
    );
  }
  return (
    <div className="pd-howto">
      <p><strong>Stick to dig</strong>, or <strong>WASD</strong> on a keyboard. It snaps to the four directions.</p>
      <p><strong>Pump to fight</strong> — the button, or <strong>space</strong>. The first tap throws the harpoon; every tap after it lands inflates.</p>
      <p><strong>Clear the level to bank.</strong> The count in the corner is how
        many monsters are left. Burst the last one and everything the crew is
        carrying is safe.</p>
      <p><strong>Pump a fallen teammate too.</strong> Harpoon them and pump to pull
        them back onto their feet. The line stops on dirt, so you may have to cut
        your way to them first — and if nobody does, it costs the crew a life.</p>
      <p>Dirt pays, deeper pays more, ore pays triple, and kills pay nothing — a monster is guarding ground, not carrying money.</p>
    </div>
  );
}

/* ── results ──────────────────────────────────────────────────────────────
 *
 * The shell hands the results an outcome and the last public view and nothing
 * else. The outcome is who placed where; the view's `cast` names them in the
 * same order, and its site summary carries each crew's and each digger's
 * shift. See `publicOf` in server.ts for why the tallies are not simply labels
 * on the outcome. */
type Tally = {
  id: string; name: string; suit: string; crew: number; cut: number; pops: number; rescues: number; downs: number;
  share: number; rank: number;
};

/** The digger who did the most of something, or nobody if nobody did any. */
function most(rows: readonly Tally[], of: (t: Tally) => number) {
  const best = rows.reduce<Tally | null>((top, t) => (of(t) > (top ? of(top) : 0) ? t : top), null);
  return best;
}

function ResultsView({ outcome, publicView: v, playerId }: ResultsViewProps<PublicView>) {
  const cast = v?.cast, site = v?.site;
  /* Crews fill in roster order, so the site's crew sizes say who dug with whom. */
  const crewAt: number[] = [];
  for (let c = 0; site && c * CREW_STRIDE < site.crews.length; c++) {
    for (let k = site.crews[c * CREW_STRIDE + 7]; k > 0; k--) crewAt.push(c);
  }
  const rows = outcome.rows.map((row, i): Tally => {
    const d = site?.diggers, o = i * DIGGER_STRIDE;
    return {
      id: row.playerId, name: cast?.names[i] ?? 'Digger', suit: SUITS[cast?.suits[i] ?? -1]?.id ?? '', crew: crewAt[i] ?? 0,
      cut: d?.[o] ?? 0, pops: d?.[o + 1] ?? 0, rescues: d?.[o + 2] ?? 0, downs: d?.[o + 3] ?? 0,
      share: row.score ?? 0, rank: row.rank ?? 1,
    };
  });
  const crews = [...new Set(rows.map(t => t.crew))].map(index => {
    const members = rows.filter(t => t.crew === index), o = index * TALLY_STRIDE, t = site?.tallies;
    return {
      index, members, ...crewOf(index), head: members[0],
      run: t && t.length >= o + TALLY_STRIDE
        ? { earned: t[o], levels: t[o + 1], wipes: t[o + 2], caught: t[o + 3], salvage: t[o + 4], depth: t[o + 5] } : null,
    };
  }).sort((a, b) => a.head.rank - b.head.rank || a.index - b.index);
  const many = crews.length > 1;
  const mine = rows.find(t => t.id === playerId);
  const winners = crews.filter(crew => crew.head.rank === 1 && crew.head.share > 0);
  const awards: [string, Tally | null, (t: Tally) => string][] = [
    ['Most ground cut', most(rows, t => t.cut), t => `${count(t.cut)} cells`],
    ['Most monsters burst', most(rows, t => t.pops), t => `${t.pops}`],
    ['Most rescues', most(rows, t => t.rescues), t => `${t.rescues}`],
  ];
  const clocked = !!v && v.shiftLeft !== null;
  const lostOpen = !clocked && site ? site.crews[3] ?? 0 : 0;
  return (
    <>
      <h1 className="pd-results-title">
        {!many ? 'End of the shift'
          : winners.length === 1 ? <><span style={{ color: winners[0].color }}>{winners[0].name}</span> take the shift</>
          : winners.length > 1 ? 'A dead heat' : 'Nobody banked a thing'}
      </h1>
      <div className={`pd-results${crews.length > 6 ? ' pd-results-dense' : ''}`}>
        {many && mine && (
          <p className="pd-results-lead">
            Your crew came <strong>{ordinal(mine.rank - 1)}</strong> of {crews.length} with <strong>{count(mine.share)}</strong> each.
          </p>
        )}
        <ol className="pd-podium">
          {crews.map(crew => {
            const t = crew.head;
            return (
              <li key={crew.index} className={`pd-podium-crew${mine?.crew === crew.index ? ' pd-podium-mine' : ''}${t.rank === 1 && t.share > 0 ? ' pd-podium-first' : ''}`}
                  style={{ '--pd-crew': crew.color } as CSSProperties}>
                <div className="pd-podium-head">
                  {many && <span className="pd-podium-place">{ordinal(t.rank - 1)}</span>}
                  {many && <h2>{crew.name}</h2>}
                  <p className="pd-podium-pay"><b>{count(many || !crew.run ? t.share : crew.run.earned)}</b>{many ? ' each' : crew.members.length > 1 && !crew.run ? ' each' : ' banked'}</p>
                </div>
                {crew.run && (
                  <p className="pd-podium-run">
                    {crew.run.depth} m down · {crew.run.levels} {crew.run.levels === 1 ? 'level' : 'levels'} cleared
                    {many && crew.members.length > 1 && ` · ${count(crew.run.earned)} in all`}
                    {crew.run.wipes > 0 && clocked && ` · wiped ${crew.run.wipes === 1 ? 'once' : `${crew.run.wipes} times`}`}
                    {crew.run.caught > 0 && ` · whistle caught ${count(crew.run.caught)}, salvaged ${count(crew.run.salvage)}`}
                  </p>
                )}
                <ul className="pd-podium-crew-list">
                  {crew.members.map(m => (
                    <li key={m.id} className={m.id === playerId ? 'pd-podium-me' : undefined}>
                      <Figure who={{ suit: m.suit, color: '#8b8378' }}/>
                      <span className="pd-crew-name">{m.name}</span>
                      <span className="pd-podium-stats">{count(m.cut)} cut · {m.pops} burst{m.rescues > 0 && <i> · {m.rescues} rescued</i>}</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
        {rows.length > 1 && awards.some(([, t]) => t) && (
          <ul className="pd-awards">
            {awards.map(([title, t, say]) => t && (
              <li key={title}><span>{title}</span><b>{t.name}</b><i>{say(t)}</i></li>
            ))}
          </ul>
        )}
        {lostOpen > 0 && (
          <StatusNotice tone="error">
            {count(lostOpen)} still in the hoppers when the run ended. Only what you banked on the
            way down survives — that is the bet.
          </StatusNotice>
        )}
        {clocked && <p className="pd-results-note">The whistle pays hoppers at half. Clear the level first and it all counts.</p>}
      </div>
    </>
  );
}

export const client: GameClientModule<NetInput, Action, Settings, PublicView, PrivateView> = {
  sceneRoles: ['display', 'controller'],
  SceneView: PhonedigScene,
  DisplayView: Display,
  ControllerView: Playing,
  /* A host playing on this device holds the stick, so they get the phone's
   * screen: the same HUD and the same controls. */
  PersonalView: Playing,
  SettingsView,
  InstructionsView,
  ResultsView,
  immersivePhone: true,
  /* The sprite atlas — 166 KB, one file, and the only asset this game has.
   *
   * Loaded here rather than on the first frame because `prepare` is what the
   * platform's readiness barrier actually waits on: a phone that starts drawing
   * before the sheet has arrived spends its first seconds in the procedural
   * silhouettes and then pops into the real art mid-dig, which reads as a bug.
   *
   * It resolves either way. A missing or stale sheet is a normal state and
   * drops the game to those silhouettes rather than failing the round — see the
   * dimension check in sprites.ts, which refuses an atlas the frame table was
   * not written against. */
  async prepare({ assetBase, signal }: PrepareContext) {
    if (signal.aborted) return;
    const pump = new Image();
    pump.src = `${assetBase}pump.png`;
    await Promise.all([sprites.load(`${assetBase}sprites.png`), pump.decode().catch(() => {})]);
  },
  dispose() { /* The scene owns its own resources through its ResourceScope. */ },
};

export default client;
