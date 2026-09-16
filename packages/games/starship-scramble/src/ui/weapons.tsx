import { weaponColor, weaponFamily, weaponMount } from '../render/weapons';
import type { CutawayFit } from '../render/cutaway';
/** Machined turrets, launch tubes and coil emitters represent the installed loadout. */
export function WeaponMounts({ fit, ids, faction, destroyed }: { fit: CutawayFit; ids: string[]; faction: 'allied' | 'enemy'; destroyed?: boolean }) {
  return <g className="ss-weapon-mounts" opacity={destroyed ? .4 : 1}>{ids.map((id, i) => {
    const mount = weaponMount(fit, i, faction), family = weaponFamily(id), color = weaponColor[family], launcher = family === 'missile' || family === 'boarding', energy = ['ion', 'plasma', 'support'].includes(family);
    return <g key={i} data-weapon-mount={id} transform={`translate(${mount.x} ${mount.y}) scale(${mount.scale * mount.direction} ${mount.scale})`} stroke="#101923" strokeWidth="1.3" strokeLinejoin="round">
      <title>{`${id.replaceAll('-', ' ')} mount`}</title>
      <path d="M-13-5H8L14 0 8 5H-13Z" fill="#263443"/>
      <circle r="6" fill="#82929e"/><circle r="4" fill="#364958"/>
      {launcher ? <>
        <path d="M-9-6H19L25-3V3L19 6H-9Z" fill="#778994"/>
        {[-3, 3].map(y => <g key={y}><path d={`M-6 ${y-1.8}H22V${y+1.8}H-6Z`} fill="#1a2834"/><path d={`M-4 ${y-1}H16L23 ${y} 16 ${y+1}H-4Z`} fill="#dce2dd"/><path d={`M15 ${y-1}L23 ${y} 15 ${y+1}`} fill={color}/></g>)}
        <path d="M-7-6V6M1-6V6M9-6V6" stroke="#b4c0c3"/>
      </> : energy ? <>
        <path d="M-6-5H19L27-3V3L19 5H-6Z" fill="#445b6b"/>
        {[0,6,12,18].map(x => <path key={x} d={`M${x}-5V5`} stroke={color} strokeWidth="2"/>)}
        <ellipse cx="26" rx="2.5" ry="4" fill={color}/><ellipse cx="27" rx="1" ry="2" fill="#f5ffff"/>
      </> : <>
        {(family === 'flak' ? [-3,3] : [0]).map(y => <g key={y}><path d={`M2 ${y-2.3}H26V${y+2.3}H2Z`} fill="#8b9da6"/><path d={`M5 ${y-1}H25`} stroke="#d8e4e6" strokeWidth=".8"/><path d={`M12 ${y-2.5}V${y+2.5}M18 ${y-2.5}V${y+2.5}`} stroke="#304554"/><path d={`M25 ${y-3}H28V${y+3}H25Z`} fill="#253744"/><path d={`M28 ${y-1.7}V${y+1.7}`} stroke={color}/></g>)}
        <path d="M-9-5H4L9-2V2L4 5H-9Z" fill="#596e7b"/><path d="M-7-3H1" stroke="#c8d2d4"/><path d="M-6 2H1" stroke={color}/>
      </>}
      <circle cx="-10" cy="0" r="1" fill="#e5ece8"/>
    </g>;
  })}</g>;
}
