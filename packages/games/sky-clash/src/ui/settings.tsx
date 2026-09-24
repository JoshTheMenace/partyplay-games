import { ToggleRow, type InstructionsViewProps, type SettingsViewProps } from '../../../../party-ui/src/index';
import { ROSTER, type CpuLevel, type Settings } from '../model';
import { STAGE_IDS, getStage } from '../stages';
import { CPU_LEVELS } from './data';
import { TIME_OPTIONS, readSettings, timeLabel } from './lobby-choice';
function Segmented<T extends string | number>({ label, value, options, disabled, onChange, format = String }: { label: string; value: T; options: readonly T[]; disabled: boolean; onChange(v: T): void; format?(v: T): string }) {
  return <fieldset className="sc-segmented" disabled={disabled}><legend>{label}</legend><div>{options.map(o => <button key={String(o)} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>{format(o)}</button>)}</div></fieldset>;
}
export function SettingsView({ settings: raw, onChange, disabled }: SettingsViewProps<Settings>) {
  const s = readSettings(raw), set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });
  return <div className="sky-clash-settings">
    <Segmented label="Stocks" value={s.stocks} options={[1, 2, 3, 4, 5]} disabled={disabled} onChange={stocks => set({ stocks })}/>
    <Segmented label="Time limit (minutes)" value={s.seconds} options={TIME_OPTIONS} disabled={disabled} onChange={seconds => set({ seconds })} format={v => v ? `${v / 60}` : '∞'}/>
    <p className="sc-set-note">{timeLabel(s.seconds)}. At time, most stocks wins, then lowest damage; a tie goes to Sudden Death.</p>
    <Segmented label="CPU fighters" value={s.cpus} options={[0, 1, 2, 3]} disabled={disabled} onChange={cpus => set({ cpus })}/>
    <Segmented label="CPU level" value={s.cpuLevel} options={[1, 2, 3] as CpuLevel[]} disabled={disabled} onChange={cpuLevel => set({ cpuLevel })} format={v => CPU_LEVELS[v]}/>
    <p className="sc-set-note">CPUs fill empty seats up to four fighters. A lone player always gets one CPU rival.</p>
    <ToggleRow label="Teams (two teams, no friendly fire)" checked={s.teams} disabled={disabled} onChange={teams => set({ teams })}/>
    <ToggleRow label="Stage hazards" checked={s.hazards} disabled={disabled} onChange={hazards => set({ hazards })}/>
    <ToggleRow label="Melee L-cancel (tap Shield just before landing an aerial)" checked={s.lcancel === 'melee'} disabled={disabled} onChange={on => set({ lcancel: on ? 'melee' : 'auto' })}/>
    <Segmented label="Recovery" value={s.recovery ?? 'party'} options={['party', 'melee'] as const} disabled={disabled} onChange={recovery => set({ recovery })} format={v => v === 'party' ? 'Party' : 'Melee'}/>
    <p className="sc-set-note">{s.recovery === 'melee' ? 'Melee jump and up-special heights.' : 'Stronger air jumps and up-specials, an air jump back after a hit, and Jump with no jumps left does your up-special.'}</p>
    <label className="sc-select-row">Stage<select value={s.stage} disabled={disabled} onChange={e => set({ stage: e.target.value as Settings['stage'] })}>
      <option value="vote">Players vote</option><option value="random">Random</option>{STAGE_IDS.map(id => <option key={id} value={id}>{getStage(id).name}</option>)}</select></label>
  </div>;
}
export function InstructionsView({ role }: InstructionsViewProps) {
  return <div className="sky-clash-instructions">
    <h2>Launch your rivals off the stage.</h2>
    <p>Hits raise damage, and the higher it climbs the farther you fly. Knock a fighter past the edge of the screen to take a stock. The last fighter (or team) standing wins. All {ROSTER.length} Melee fighters and {STAGE_IDS.length} stages are here.</p>
    {role !== 'display' && <ul>
      <li><b>Move</b> with the left pad. Tap <b>Attack</b> with a direction for tilts and aerials.</li>
      <li><b>Swipe</b> across <b>Attack</b> for a smash in that direction (hold to charge), or flick the pad and tap Attack. Tap <b>Special</b> with the pad, or <b>swipe</b> it: swipe up to recover.</li>
      <li><b>Jump</b> again in the air. Tap Jump for a short hop. <b>Shield</b> blocks. <b>Grab</b>, or Shield + Attack, grabs. Down while falling fast-falls.</li>
      <li>Keyboard: WASD or arrows move, J attack, K or Space jump, L special, I smash, Shift shield, U grab.</li>
    </ul>}
    <p className="kp-muted">Pick your fighter, costume and stage vote in the lobby, then tap Ready. Turn your phone sideways for the fight.</p>
  </div>;
}
