import type { Crew, SpeciesId } from '../contracts';
import { SPECIES, speciesFor } from '../definitions/presentation/species';

type CrewAppearance = Pick<Crew, 'id' | 'name' | 'species' | 'activity'>;
type FigureProps = { crew: CrewAppearance; x: number; y: number; size: number; ownerColor: string; selected?: boolean; hostile?: boolean };
const ink = '#11172a';
const cream = '#fff6e5';
const skinTones = ['#edbb93', '#9a6246', '#ce916c', '#714735', '#f4d2b0', '#b97851'];
const hairColors = ['#302528', '#e4d3bd', '#854f30', '#b96a3e', '#55483d'];

function identity(id: string) {
  let value = 2166136261;
  for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  return value;
}

/** Decorative 32-unit figure. Its ownership ring is separate from its species colors. */
export function CrewFigure({ crew, x, y, size, ownerColor, selected = false, hostile = false }: FigureProps) {
  const species = speciesFor(crew.species);
  const variant = identity(crew.id);
  const skin = skinTones[variant % skinTones.length];
  const hair = hairColors[Math.floor(variant / skinTones.length) % hairColors.length];
  const helmet = Math.floor(variant / 30) % 3 === 0;
  const walking = crew.activity === 'moving' || crew.activity === 'direct';
  const working = ['repairing', 'fighting', 'healing'].includes(crew.activity);
  const leftFoot = walking ? 28 : 26;
  return <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${size / 32})`} aria-hidden="true" pointerEvents="none" data-crew-id={crew.id} data-crew-species={species.id} data-crew-activity={crew.activity}>
    <ellipse cx="16" cy="27" rx="12.5" ry="4" fill={ink} opacity=".65" />
    {hostile ? <path d="M2.5 25.5 16 20l13.5 5.5L16 31Z" fill="none" stroke={ownerColor} strokeWidth="2" /> : <ellipse cx="16" cy="27" rx="12" ry="3.5" fill="none" stroke={ownerColor} strokeWidth="2" />}
    <g stroke={ink} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      {species.id === 'bastion' ? <>
        <path d={`M9 22h6v${leftFoot - 22}H8Zm9 0h6l1 4h-7Z`} fill="#62697b" />
        <path d="m8 12-4 4 2 8 5-1 1-8m12-3 4 4-2 8-5-1-1-8" fill="#8792a2" />
        <path d="m9 13 7-3 7 3 1 10-8 3-8-3Z" fill={species.color} />
        <path d="m10 15 6 3 6-3M16 18v6" fill="none" stroke="#d6dbe2" strokeWidth="1.2" />
        <path d="m9 5 7-3 7 3 1 8-8 4-8-4Z" fill="#a8b2bc" />
        <path d="m12 6 8-1 1 7-6 3-4-4Z" fill="#8ee3ed" />
        <path d="m12 6 3 9 2-7 3-3" fill="none" stroke="#e8ffff" strokeWidth="1" />
        <path d="m12 10 2 1m4-1 2-1" fill="none" stroke={ink} />
      </> : species.id === 'skitter' ? <>
        <path d={`m11 14-5-3-3 3m8 4-6 1-2 4m9-1-5 3-1 ${walking ? 4 : 2}m15-13 5-3 3 3m-8 4 6 1 2 4m-9-1 5 3 1 ${walking ? 1 : 3}`} fill="none" stroke="#adc486" strokeWidth="2.3" />
        <path d="m12 7-3-5-3 1m14 4 3-5 3 1" fill="none" stroke="#d0dcac" strokeWidth="1.8" />
        <ellipse cx="16" cy="22" rx="5.5" ry="6" fill={species.color} />
        <path d="M11 21h10m-9 4h8" fill="none" stroke={ink} strokeWidth="1.2" />
        <ellipse cx="16" cy="16" rx="4.5" ry="5" fill="#b5c779" />
        <path d="m10 8 6-3 6 3-1 7-5 3-5-3Z" fill={species.color} />
        <ellipse cx="12.5" cy="10.5" rx="2.3" ry="3" fill="#ecedbc" />
        <ellipse cx="19.5" cy="10.5" rx="2.3" ry="3" fill="#ecedbc" />
        <path d="M13 10v2m6-2v2m-5 3 2 1 2-1" fill="none" />
      </> : species.id === 'ember' ? <>
        <path d="M20 24q9 5 9-7-4 7-10 3" fill={species.color} />
        <path d={`m11 21-2 ${leftFoot - 21}h6l1-6m2 0 1 6h6l-3-6`} fill="#b85a42" />
        <path d="m10 13-4 4 1 6 4-3m11-7 4 4-1 6-4-3" fill={species.color} />
        <path d="m10 14 6-3 6 3-1 10-5 2-5-2Z" fill={species.color} />
        <path d="m13 17 3-2 3 2-1 6h-4Z" fill="#edc08a" strokeWidth="1" />
        <path d="M10 7 6 3l1 7m15-3 4-4-1 7" fill={cream} />
        <path d="m10 6 6-3 6 3 2 7-8 5-8-5Z" fill={species.color} />
        <path d="m11 10 3 1m4 0 3-1" stroke="#fff2b0" strokeWidth="2.2" />
        <path d="m12 14 4 1 4-1" fill="none" strokeWidth="1.2" />
        <path d="m9 26 1-2 1 2m10 0 1-2 1 2" stroke={cream} strokeWidth="1.1" />
      </> : <>
        <path d={`M11 21h5l-1 ${leftFoot - 21}h-5Zm6 0h4l1 5h-5Z`} fill="#617a94" />
        <path d="M10 26h5m3 0h5" stroke={ink} strokeWidth="2.7" />
        <path d={`M10 14 7 17l${walking ? 1 : 0} 5m14-8 3 ${working ? 0 : 3}v${working ? 4 : 5}`} fill="none" stroke="#729eb5" strokeWidth="4.5" />
        <circle cx={walking ? 8 : 7} cy="22" r="1.7" fill={skin} strokeWidth="1" />
        <circle cx="25" cy={working ? 18 : 22} r="1.7" fill={skin} strokeWidth="1" />
        <path d="M10 13h12l-1 11H11Z" fill="#82b6ca" />
        <path d="M11 20h10m-5-5v4" stroke={cream} strokeWidth="1.8" />
        <rect x="13.5" y="21.5" width="5" height="2.5" rx=".6" fill="#d6b36c" strokeWidth="1" />
        {helmet && <path d="M8 10a8 8 0 0 1 16 0v3l-4 3h-8l-4-3Z" fill="#d8e2e8" />}
        <path d="M10 7q6-5 12 0v5q-1 5-6 5t-6-5Z" fill={skin} />
        {helmet ? <>
          <path d="M10 8q6-3 12 0v4H10Z" fill="#b0e4ec" />
          <path d="m12 8 2 4" stroke="#f3ffff" strokeWidth="1.4" />
        </> : <>
          <path d={variant % 2 ? 'M10 11 9 6l5-3 7 2 2 6-3-4-4 1-3-1-1 4Z' : 'M10 11 9 7q1-5 7-4 7 0 7 5l-3 2-1-4-4 3-4-1v3Z'} fill={hair} strokeWidth="1.2" />
          <path d="M13 11v1m6-1v1" strokeWidth="1.3" />
        </>}
      </>}
    </g>
    {working && <g stroke={ink} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round">
      {crew.activity === 'repairing' ? <path d="m22 21 4-7a3 3 0 0 0 2-5l-1 3-2-1V8a3 3 0 0 0-1 6l-5 6Z" fill="#ebcd86" /> : crew.activity === 'healing' ? <>
        <rect x="21" y="16" width="9" height="8" rx="2" fill={cream} />
        <path d="M25.5 18v4m-2-2h4" stroke="#468b70" strokeWidth="2" />
      </> : <path d="M21 16h8v4h-4v4h-3v-5h-1Z" fill="#bad8df" />}
    </g>}
    {selected && <path d="M2 9V2h7m14 0h7v7M2 23v7h7m14 0h7v-7" fill="none" stroke={cream} strokeWidth="1.8" strokeLinecap="round" />}
  </g>;
}

export function CrewPortrait({ crew, size = 40, ownerColor = cream }: { crew: CrewAppearance; size?: number; ownerColor?: string }) {
  const label = `${crew.name}, ${speciesFor(crew.species).name}`;
  return <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={label} focusable="false">
    <title>{label}</title>
    <CrewFigure crew={crew} x={16} y={16} size={32} ownerColor={ownerColor} />
  </svg>;
}

/** Species is an explicit recruitment choice; specialties remain independent skills. */
export function SpeciesSelect({ value, onChange }: { value: SpeciesId; onChange(value: SpeciesId): void }) {
  const species=speciesFor(value);
  return <div className="ss-species-choice"><CrewPortrait crew={{id:`recruit-${value}`,name:species.name,species:value,activity:'idle'}} size={48}/><label>Species<select value={value} onChange={event=>onChange(event.target.value as SpeciesId)}>{SPECIES.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><small>{species.description}</small></div>;
}
