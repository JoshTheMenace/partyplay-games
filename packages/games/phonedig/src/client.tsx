import { useEffect, useRef, useState } from 'react';
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
import type { Action, NetInput, PrivateView, PublicView, Settings } from './model';
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
  /* One counter per mounted controller, sent as held state rather than as
   * reliable actions: a dig session fires far more taps than the 256-action
   * round budget, and a cumulative count survives the 20 Hz coalescing that
   * would drop a per-frame tally. */
  const pump = useRef(0);
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

function KitUp(props: Props) {
  const v = props.publicView;
  const kit = v?.kitup;
  const mine = v?.players.find(q => q.id === props.playerId);
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

  const chosen = pending ?? mine?.suit ?? null;
  const others = (v?.players ?? []).filter(q => q.id !== props.playerId);

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
      {problem && <StatusNotice tone="error">{problem}</StatusNotice>}
      <ul className="pd-suits">
        {SUITS.map(suit => {
          const takenBy = others.find(q => q.suit === suit.id);
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

function KitUpDisplay({ publicView: v }: Props) {
  const kit = v?.kitup;
  if (!v || !kit) return null;
  return (
    <div className="pd-hud">
      <div className="pd-kitup-head">
        <Eyebrow>Kit up</Eyebrow>
        <h2>{kit.everyonePicked ? 'Crew ready. Drill starting…'
          : `The crew is choosing · ${Math.ceil(kit.secondsLeft)}s`}</h2>
      </div>
      <ul className="pd-crew">
        {v.players.map(q => (
          <li key={q.id} className="pd-crew-row">
            <span className="pd-crew-dot" style={{ background: wornColour(q) }}/>
            <span className="pd-crew-name">{q.name}</span>
            <span className={q.suit ? 'pd-crew-suit' : 'pd-crew-waiting'}>
              {q.suit ?? 'choosing…'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Controller(props: Props) {
  const controls = useDigControls(props);
  const me = props.privateView;
  const v = props.publicView;
  /* A phone shows the game, not the room — so a player holding one had no way
   * to learn a teammate was on the floor except by looking at the television.
   * In a game whose whole co-op verb is going to get them, that is the one
   * thing the controller has to say out loud. Only teammates are listed: your
   * own state already has the notice below. */
  const fallen = (v?.players ?? []).filter(q => q.downed && q.id !== props.playerId);
  return (
    <div className="pd-controller">
      {!me?.downed && fallen.map(q => (
        <div key={q.id} className="pd-alert" style={{ borderColor: wornColour(q) }}>
          <span className="pd-crew-dot" style={{ background: wornColour(q) }}/>
          <strong>{q.name} is down.</strong> Harpoon them and pump. {Math.ceil(q.downT)}s
        </div>
      ))}
      <div className="pd-controller-status">
        {me?.downed ? (
          <StatusNotice tone="error">
            <strong>You are down.</strong> {me.beingRevived
              ? 'They have you on the line — hold on.'
              : `A teammate has to harpoon you and pump. ${Math.ceil(me.downT)}s`}
          </StatusNotice>
        ) : (
          <>
            <Eyebrow>{me?.playing ? `${me.hp}/${me.maxHp} HP` : 'Watching'}</Eyebrow>
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

/* Who someone is, everywhere at once.
 *
 * The scene draws a digger in their suit, so every other surface has to agree —
 * a crew rail dot in the room's colour and a body in the suit's is two
 * different people as far as a player glancing between them is concerned. */
function wornColour(q: { suit: string | null; color: string }) {
  return (q.suit && SUIT_BY_ID[q.suit]?.swatch) || q.color;
}

function Hud({ publicView: v, playerId }: Props) {
  if (!v) return null;
  const me = v.players.find(q => q.id === playerId);
  return (
    <div className="pd-hud">
      <div className="pd-hud-row">
        <span className="pd-chip">Level {v.level}</span>
        <span className="pd-chip">{Math.round(v.depth)} m</span>
        <span className="pd-chip">{v.banked} banked</span>
        <span className="pd-chip">{v.hopper} at risk</span>
        <span className="pd-chip pd-chip-lives" aria-label={`${v.lives} of ${v.livesMax} lives left`}>
          {'\u25C6'.repeat(Math.max(0, v.lives))}
          <i>{'\u25C7'.repeat(Math.max(0, v.livesMax - v.lives))}</i>
        </span>
        {v.oreHeld + v.oreBanked > 0 && <span className="pd-chip">{v.oreHeld + v.oreBanked} ore</span>}
      </div>
      {/* The crew, one row each: whose air is going and who is carrying too
          much to risk another cell is the whole of what a watching screen is
          for. A single shared meter would hide exactly that. */}
      <ul className="pd-crew">
        {v.players.map(q => {
          const qAir = Math.max(0, Math.min(1, q.airMax ? q.air / q.airMax : 0));
          const qLoad = Math.max(0, Math.min(1, q.hopperMax ? q.hopper / q.hopperMax : 0));
          if (q.downed) return (
            <li key={q.id} className={`pd-crew-row pd-crew-down${q.id === playerId ? ' pd-crew-me' : ''}`}>
              <span className="pd-crew-dot" style={{ background: wornColour(q) }}/>
              <span className="pd-crew-name">{q.name}</span>
              <span className="pd-crew-downed">
                DOWN · {Math.ceil(q.downT)}s
                {q.reviveProgress > 0 && <i className="pd-crew-pull">
                  {' '}{'\u25B2'.repeat(Math.round(q.reviveProgress * 3))}
                </i>}
              </span>
            </li>
          );
          return (
            <li key={q.id} className={`pd-crew-row${q.id === playerId ? ' pd-crew-me' : ''}`}>
              <span className="pd-crew-dot" style={{ background: wornColour(q) }}/>
              <span className="pd-crew-name">{q.name}</span>
              <span className="pd-crew-hp" aria-label={`${q.hp} of ${q.maxHp} health`}>
                {'\u25CF'.repeat(Math.max(0, q.hp))}
                <i>{'\u25CB'.repeat(Math.max(0, q.maxHp - q.hp))}</i>
              </span>
              <span className="pd-meter pd-meter-slim" role="img" aria-label={`Air ${Math.round(qAir * 100)} percent`}>
                <i style={{ width: `${qAir * 100}%` }} className="pd-meter-air"/>
              </span>
              <span className="pd-meter pd-meter-slim" role="img" aria-label={`Hopper ${Math.round(qLoad * 100)} percent`}>
                <i style={{ width: `${qLoad * 100}%` }} className={qLoad >= 1 ? 'pd-meter-full' : 'pd-meter-load'}/>
              </span>
            </li>
          );
        })}
      </ul>
      {me && me.hopper >= me.hopperMax &&
        <StatusNotice tone="error">Your hopper is full — descend to bank it.</StatusNotice>}
    </div>
  );
}

function Display(props: Props) {
  return props.publicView?.kitup ? <KitUpDisplay {...props}/> : <Hud {...props}/>;
}

function Playing(props: Props) {
  return props.publicView?.kitup ? <KitUp {...props}/> : <Controller {...props}/>;
}

function Personal(props: Props) {
  if (props.publicView?.kitup) return <KitUp {...props}/>;
  return (
    <>
      <Hud {...props}/>
      <Controller {...props}/>
    </>
  );
}

function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  const [level, setLevel] = useState(String(settings.startLevel));
  return (
    <Panel>
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
      <Eyebrow>Team lives</Eyebrow>
      <p>Spent when nobody reaches a downed digger in time — or straight away
        when there is nobody left who could. Solo, this is simply how many times
        you can be killed.</p>
      <input
        type="range" min={1} max={9} step={1} value={String(settings.lives)} disabled={disabled}
        aria-label="Team lives"
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
      <div>
        <p>You are paid for what you dig, not what you kill.</p>
        <p>Clear every monster to descend, which banks the haul. Go down and a
          teammate can harpoon you back up; nobody reaching you in time costs the
          crew a life, and whatever is still in your hopper goes with it.</p>
      </div>
    );
  }
  return (
    <div>
      <p><strong>Stick to dig</strong>, or <strong>WASD</strong> on a keyboard. It snaps to the four directions.</p>
      <p><strong>Pump to fight</strong> — the button, or <strong>space</strong>. The first tap throws the harpoon; every tap after it lands inflates.</p>
      <p><strong>Pump a fallen teammate too.</strong> Harpoon them and pump to pull
        them back onto their feet. The line stops on dirt, so you may have to cut
        your way to them first — and if nobody does, it costs the crew a life.</p>
      <p>Dirt pays, deeper pays more, and kills pay nothing — a monster is guarding ground, not carrying money.</p>
    </div>
  );
}

/* The shared results table renders `score ?? label`, and the score of a run
 * that died before banking anything is a truthful 0 — which reads as "you did
 * nothing" after twenty metres of digging. The haul going down with you IS the
 * game, so the results screen has to say that rather than imply it. */
function ResultsView({ outcome, publicView: v }: ResultsViewProps<PublicView>) {
  const lost = v ? v.hopper + v.oreHeld : 0;
  return (
    <>
      <h1>End of the shift</h1>
      <div className="pd-results">
        <p className="pd-results-lead">
          <strong>{v ? Math.round(v.deepest) : 0} m</strong> down, level {v?.level ?? 1}
          {v && v.livesMax > 0 && <span className="pd-results-lives">
            {' · '}{v.livesMax - v.lives} of {v.livesMax} lives spent
          </span>}
        </p>
        <table className="kp-results">
          <thead><tr><th>Digger</th><th>Banked</th><th>Run</th></tr></thead>
          <tbody>
            {outcome.rows.map(row => {
              // The shell gives results no roster, so the seat's name rides in
              // front of the label and is split back out here.
              const [who, ...rest] = (row.label ?? '').split(' · ');
              return (
                <tr key={row.playerId}>
                  <td>{who || 'Digger'}</td>
                  <td>{row.score ?? 0} dirt</td>
                  <td>{rest.join(' · ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {lost > 0 && (
          <StatusNotice tone="error">
            {lost} still in the hopper when the run ended. Only what you banked on the
            way down survives — that is the bet.
          </StatusNotice>
        )}
      </div>
    </>
  );
}

export const client: GameClientModule<NetInput, Action, Settings, PublicView, PrivateView> = {
  sceneRoles: ['display', 'controller'],
  SceneView: PhonedigScene,
  DisplayView: Display,
  ControllerView: Playing,
  PersonalView: Personal,
  SettingsView,
  InstructionsView,
  ResultsView,
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
