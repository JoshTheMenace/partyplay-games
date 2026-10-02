/* Airlock art: the Icon Test pictures, the giant red button, Earth, the ship and alien antennae. All original SVG. */
import type { ReactElement } from 'react';
import type { IconId } from './types';

const C = { ink: '#05071a', red: '#ff5748', sun: '#ffd24a', sky: '#28c6e7', lime: '#78d955', grape: '#b58aff', cream: '#fff6e5', orange: '#ff9f43', pink: '#ff8fc8', brown: '#b9773e', steel: '#c9d2f0' };
const Eye = ({ x, y, r = 3 }: { x: number; y: number; r?: number }) => <circle className="al-ink" cx={x} cy={y} r={r} />;

/** 64×64 pictures: flat colour, ink outline (see .al-icon in styles.css). */
const ART: Record<IconId, ReactElement> = {
  rocket: <g><path fill={C.sun} d="M26 47h12l-6 13z" /><path fill={C.red} d="M24 33 13 47l11-3zM40 33l11 14-11-3z" /><path fill={C.steel} d="M32 4c10 10 12 24 8 41H24c-4-17-2-31 8-41z" /><circle fill={C.sky} cx="32" cy="24" r="6" /></g>,
  planet: <g><circle fill={C.grape} cx="32" cy="32" r="17" /><path fill="none" d="M20 26q8-5 20 0" /><ellipse fill="none" strokeWidth="7" cx="32" cy="34" rx="29" ry="8" transform="rotate(-16 32 34)" /><ellipse className="al-flat" fill="none" stroke={C.sun} strokeWidth="3" cx="32" cy="34" rx="29" ry="8" transform="rotate(-16 32 34)" /></g>,
  robot: <g><path fill="none" d="M32 8v10" /><circle fill={C.red} cx="32" cy="7" r="4" /><rect fill={C.steel} x="12" y="18" width="40" height="32" rx="8" /><circle fill={C.sky} cx="23" cy="31" r="5" /><circle fill={C.sky} cx="41" cy="31" r="5" /><path fill="none" d="M22 42h20M27 42v4M32 42v4M37 42v4" /><path fill={C.steel} d="M6 30h6v10H6zM52 30h6v10h-6z" /></g>,
  cat: <g><path fill={C.orange} d="M12 26 16 7l12 11h8l12-11 4 19q3 26-20 28-23-2-20-28z" /><Eye x={24} y={32} /><Eye x={40} y={32} /><path fill={C.pink} d="m29 39 3 3 3-3z" /><path fill="none" d="M32 42v4m-4 1q4 3 8 0M6 38l14 2M6 46l14-3M58 38l-14 2m14 6-14-3" /></g>,
  dog: <g><ellipse fill={C.brown} cx="13" cy="30" rx="7" ry="15" /><ellipse fill={C.brown} cx="51" cy="30" rx="7" ry="15" /><ellipse fill="#e3b77e" cx="32" cy="34" rx="18" ry="20" /><Eye x={25} y={30} /><Eye x={39} y={30} /><ellipse className="al-ink" cx="32" cy="40" rx="5" ry="3.5" /><path fill={C.pink} d="M28 47h8v4a4 4 0 0 1-8 0z" /></g>,
  fish: <g><path fill={C.sky} d="M46 32 60 20v24z" /><ellipse fill={C.sky} cx="28" cy="32" rx="22" ry="15" /><path fill="none" d="M36 21q-5 11 0 22" /><circle fill={C.cream} cx="17" cy="28" r="4" /><Eye x={17} y={28} r={2} /></g>,
  pizza: <g><path fill={C.sun} d="M32 60 7 14q25-10 50 0z" /><path fill={C.orange} d="M7 14q25-10 50 0l-3 6q-22-8-44 0z" /><circle fill={C.red} cx="25" cy="27" r="5" /><circle fill={C.red} cx="39" cy="30" r="4.5" /><circle fill={C.red} cx="32" cy="44" r="4" /></g>,
  cake: <g><path fill="none" d="M32 8v8" /><path fill={C.sun} d="M32 2q4 4 0 7-4-3 0-7z" /><rect fill={C.cream} x="10" y="30" width="44" height="26" rx="4" /><path fill={C.pink} d="M10 34q0-8 8-8h28q8 0 8 8v4q-5 4-11 0-5 4-11 0-5 4-11 0-6 4-11 0z" /><rect fill={C.sky} x="28" y="16" width="8" height="10" rx="2" /><path fill="none" d="M10 48h44" /></g>,
  coffee: <g><path fill="none" d="M22 6q-4 5 0 10t0 10M32 6q-4 5 0 10t0 10M42 6q-4 5 0 10t0 10" /><path fill="none" strokeWidth="6" d="M48 34h4a7 7 0 0 1 0 14h-4" /><path fill={C.red} d="M12 30h38v18q0 10-10 10H22q-10 0-10-10z" /><path fill={C.cream} d="M12 30h38v6H12z" /></g>,
  icecream: <g><path fill={C.orange} d="M18 32h28L32 61z" /><path fill="none" d="M22 38l16 12M42 38 28 50" /><circle fill={C.pink} cx="24" cy="26" r="10" /><circle fill={C.cream} cx="40" cy="26" r="10" /><circle fill={C.lime} cx="32" cy="14" r="10" /></g>,
  donut: <g><circle fill={C.brown} cx="32" cy="32" r="26" /><path fill={C.pink} d="M10 30q2-20 22-20t22 20q-2 8-8 6-4 6-10 2-6 6-12 0-6 4-10-2-4 2-4-6z" /><circle fill="#2a1a3a" cx="32" cy="32" r="8" /><path className="al-flat" stroke={C.sun} strokeWidth="3" d="M20 20l3 2M42 18l-2 3M46 28l3 1M18 30l2-3M30 16h3" /></g>,
  guitar: <g><rect fill={C.brown} x="29" y="4" width="6" height="30" rx="2" /><path fill={C.sun} d="M32 26q11 0 11 9 0 5-4 7 8 3 8 10 0 9-15 9t-15-9q0-7 8-10-4-2-4-7 0-9 11-9z" /><circle className="al-ink" cx="32" cy="44" r="4.5" /><path fill="none" d="M27 54h10" /></g>,
  book: <g><path fill={C.cream} d="M32 16Q20 8 6 12v38q14-4 26 4z" /><path fill={C.cream} d="M32 16q12-8 26-4v38q-14-4-26 4z" /><path fill="none" d="M12 20q8-1 14 2M12 28q8-1 14 2M12 36q8-1 14 2M38 22q6-3 14-2M38 30q6-3 14-2M38 38q6-3 14-2" /><path fill={C.red} d="M6 50q14-4 26 4 12-8 26-4v6q-14-4-26 4-12-8-26-4z" /></g>,
  crown: <g><path fill={C.sun} d="M8 50 4 18l16 14 12-22 12 22 16-14-4 32z" /><rect fill={C.sun} x="8" y="48" width="48" height="9" rx="2" /><circle fill={C.red} cx="32" cy="38" r="5" /><circle fill={C.sky} cx="18" cy="42" r="3.5" /><circle fill={C.lime} cx="46" cy="42" r="3.5" /></g>,
  umbrella: <g><path fill="none" strokeWidth="5" d="M32 30v20q0 8 7 8t7-7" /><path fill={C.grape} d="M4 32Q6 6 32 6t28 26q-5-5-9.3 0-4.7-5-9.3 0-4.7-5-9.4 0-4.7-5-9.3 0-4.7-5-9.4 0Q9 27 4 32z" /><path fill="none" d="M32 6q-10 10-9.4 26M32 6q10 10 9.4 26" /></g>,
  sun: <g><path fill={C.orange} d="M32 2l5 10H27zm0 60-5-10h10zM2 32l10-5v10zm60 0-10 5V27zM10.8 10.8l10.6 3.5-7 7zm42.4 42.4-10.6-3.5 7-7zM10.8 53.2l3.5-10.6 7 7zm42.4-42.4-3.5 10.6-7-7z" /><circle fill={C.sun} cx="32" cy="32" r="15" /><Eye x={27} y={30} r={2} /><Eye x={37} y={30} r={2} /><path fill="none" d="M26 37q6 5 12 0" /></g>,
  moon: <g><path fill={C.sun} d="M40 6a26 26 0 1 0 18 40A22 22 0 1 1 40 6z" /><circle fill="none" cx="22" cy="26" r="3" /><circle fill="none" cx="28" cy="44" r="4" /><Eye x={20} y={36} r={2} /></g>,
  tree: <g><path fill={C.brown} d="M27 40h10v20H27z" /><circle fill={C.lime} cx="22" cy="30" r="13" /><circle fill={C.lime} cx="42" cy="30" r="13" /><circle fill={C.lime} cx="32" cy="18" r="14" /><circle fill={C.red} cx="25" cy="24" r="3" /><circle fill={C.red} cx="40" cy="33" r="3" /></g>,
  cactus: <g><path fill={C.orange} d="M16 48h32l-4 13H20z" /><path fill={C.lime} d="M26 48V14a6 6 0 0 1 12 0v34z" /><path fill={C.lime} d="M26 36h-8a6 6 0 0 1-6-6v-8a3 3 0 0 1 6 0v8h8zm12-6h8v-10a3 3 0 0 1 6 0v10a6 6 0 0 1-6 6h-8z" /><path fill="none" d="M30 18v4M34 28v4M30 38v4" /></g>,
  flower: <g><path fill="none" strokeWidth="4" d="M32 36v24" /><path fill={C.lime} d="M32 52q-12-2-14-12 10 0 14 12z" />{[0, 72, 144, 216, 288].map(a => <circle key={a} fill={C.pink} cx={32 + 12 * Math.sin(a * Math.PI / 180)} cy={22 - 12 * Math.cos(a * Math.PI / 180)} r="8" />)}<circle fill={C.sun} cx="32" cy="22" r="7" /></g>,
  car: <g><path fill={C.red} d="M4 44V34q0-4 4-5l8-2 7-10q2-3 6-3h12q4 0 6 3l7 10q6 1 6 7v10z" /><path fill={C.sky} d="M24 20h7v8H18zm11 0h7q2 0 3 2l4 6H35z" /><circle fill={C.steel} cx="17" cy="46" r="7" /><circle fill={C.steel} cx="47" cy="46" r="7" /></g>,
  boat: <g><path fill="none" strokeWidth="4" d="M32 6v36" /><path fill={C.cream} d="M34 8q16 14 16 30H34z" /><path fill={C.red} d="M30 14 14 38h16z" /><path fill={C.brown} d="M4 42h56l-8 14H12z" /><path fill="none" stroke={C.sky} d="M2 60q5-3 10 0t10 0 10 0 10 0 10 0 10 0" className="al-flat" /></g>,
  tent: <g><path fill={C.lime} d="M32 8 4 56h56z" /><path fill="#2a1a3a" d="M32 26 22 56h20z" /><path fill="none" d="M32 8v-4M2 56h60" /><path fill={C.sun} d="M32 4l8 3-8 3z" /></g>,
  house: <g><path fill={C.cream} d="M10 30h44v28H10z" /><path fill={C.red} d="M4 32 32 8l28 24z" /><path fill={C.brown} d="M27 40h10v18H27z" /><path fill={C.sky} d="M14 36h9v9h-9zm27 0h9v9h-9z" /><path fill={C.steel} d="M42 12h7v10l-7-6z" /></g>,
  ghost: <g><path fill={C.cream} d="M12 58V28a20 20 0 0 1 40 0v30l-6-6-7 6-7-6-7 6-7-6z" /><ellipse className="al-ink" cx="25" cy="28" rx="4" ry="6" /><ellipse className="al-ink" cx="39" cy="28" rx="4" ry="6" /><ellipse className="al-ink" cx="32" cy="42" rx="5" ry="4" /></g>,
  gift: <g><path fill={C.grape} d="M8 26h48v10H8z" /><path fill={C.grape} d="M12 36h40v22H12z" /><path fill={C.sun} d="M28 26h8v32h-8z" /><path fill={C.sun} d="M32 26q-16-16-16-6t16 6q16-16 16-6t-16 6z" /></g>,
  heart: <g><path fill={C.red} d="M32 58 8 34Q0 24 6 14q10-12 26 2 16-14 26-2 6 10-2 20z" /><path className="al-flat" fill="none" stroke={C.cream} strokeWidth="4" d="M14 20q2-4 7-4" /></g>,
  ball: <g><circle fill={C.cream} cx="32" cy="32" r="26" /><path fill={C.red} d="M32 6q-12 12-12 26t12 26q-26-2-26-26T32 6z" /><path fill={C.sky} d="M32 6q12 12 12 26T32 58q26-2 26-26T32 6z" /><circle fill={C.sun} cx="32" cy="32" r="5" /></g>,
  sock: <g><path fill={C.cream} d="M20 4h20v30l14 10q6 6 0 12-5 5-11 1L22 44q-4-3-3-9z" /><path fill={C.red} d="M20 4h20v8H20zm0 14h20v6H20z" /><path fill={C.sky} d="M46 46q4 2 7 6" className="al-flat" stroke={C.sky} strokeWidth="5" /></g>,
  snowman: <g><circle fill={C.cream} cx="32" cy="44" r="16" /><circle fill={C.cream} cx="32" cy="20" r="11" /><path fill={C.ink} d="M22 12h20v3H22zm4-10h12v11H26z" /><Eye x={28} y={19} r={2} /><Eye x={36} y={19} r={2} /><path fill={C.orange} d="m32 22 10 3-10 2z" /><Eye x={32} y={40} r={2} /><Eye x={32} y={48} r={2} /><path fill="none" stroke={C.red} strokeWidth="5" className="al-flat" d="M23 30q9 4 18 0" /></g>,
  phone: <g><rect fill={C.ink} x="16" y="4" width="32" height="56" rx="7" /><rect className="al-flat" fill={C.sky} x="20" y="10" width="24" height="40" rx="3" /><circle className="al-flat" fill={C.cream} cx="32" cy="55" r="2.5" /><path className="al-flat" fill={C.sun} d="M26 22h12v4H26zm0 8h8v4h-8z" /></g>,
  music: <g><path fill="none" strokeWidth="5" d="M22 46V14l28-6v32" /><path fill={C.grape} d="M22 14l28-6v8l-28 6z" /><ellipse fill={C.grape} cx="16" cy="47" rx="8" ry="6" /><ellipse fill={C.grape} cx="44" cy="41" rx="8" ry="6" /></g>,
};

export function Icon({ id, className = '' }: { id: IconId; className?: string }) {
  return <svg className={`al-icon ${className}`} viewBox="0 0 64 64" aria-hidden="true">{ART[id] ?? ART.planet}</svg>;
}

/** The giant red AIRLOCK button in its hazard-striped housing. `pressed` sinks the cap. */
export function BigButton({ pressed = false, className = '' }: { pressed?: boolean; className?: string }) {
  return <svg className={`al-button ${className}`} data-pressed={pressed || undefined} viewBox="0 0 240 200" aria-hidden="true">
    <defs><pattern id="al-hazard" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="22" height="22" fill={C.sun} /><rect width="11" height="22" fill={C.ink} /></pattern></defs>
    <ellipse cx="120" cy="150" rx="114" ry="44" fill={C.ink} />
    <ellipse cx="120" cy="138" rx="112" ry="44" fill="url(#al-hazard)" stroke={C.ink} strokeWidth="6" />
    <ellipse cx="120" cy="134" rx="84" ry="30" fill="#3a0a10" stroke={C.ink} strokeWidth="6" />
    <g className="al-button-cap">
      <path d="M44 132V96a76 30 0 0 1 152 0v36a76 30 0 0 1-152 0z" fill="#b01f1f" stroke={C.ink} strokeWidth="6" />
      <ellipse cx="120" cy="96" rx="76" ry="30" fill={C.red} stroke={C.ink} strokeWidth="6" />
      <ellipse cx="96" cy="86" rx="30" ry="9" fill="#ffd0c9" opacity=".75" />
    </g>
  </svg>;
}

/** Earth with clouds, sized by its container. */
export function Earth({ className = '' }: { className?: string }) {
  return <svg className={`al-earth ${className}`} viewBox="0 0 100 100" aria-hidden="true">
    <defs><radialGradient id="al-earth-sea" cx=".35" cy=".3" r=".8"><stop offset="0" stopColor="#6fd3ff" /><stop offset=".6" stopColor="#1f6fd1" /><stop offset="1" stopColor="#0b2a6b" /></radialGradient></defs>
    <circle cx="50" cy="50" r="48" fill="url(#al-earth-sea)" />
    <path fill="#5fcf6a" d="M22 26q10-8 18-2t2 14q-6 4-4 12t-8 10q-8-6-10-16t2-18zM58 18q14 2 20 12-6 2-10-2-6 0-8 6 8 4 6 12-4 10 4 16-6 10-16 8 2-12-6-18-4-10 4-16-6-8 6-18z" />
    <path fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="3.5" strokeLinecap="round" d="M14 46q10-4 16 0M54 70q10-6 22-2M60 34q8-3 14 0" />
    <circle cx="50" cy="50" r="48" fill="none" stroke="#9fe4ff" strokeOpacity=".6" strokeWidth="2" />
  </svg>;
}

/** The crew's retro rocket ship (route marker). */
export function Ship({ className = '' }: { className?: string }) {
  return <svg className={`al-ship ${className}`} viewBox="0 0 80 40" aria-hidden="true">
    <path className="al-ship-flame" d="M14 14 0 20l14 6z" fill={C.sun} />
    <path d="M12 10h8l8 4h36q14 2 16 6-2 4-16 6H28l-8 4h-8l4-10z" fill={C.steel} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
    <circle cx="50" cy="20" r="5" fill={C.sky} stroke={C.ink} strokeWidth="3" /><path d="M24 14 18 4h8l8 10zM24 26l-6 10h8l8-10z" fill={C.red} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
  </svg>;
}

/** Wobbly antennae that sprout from an unmasked alien's head. */
export function Antennae({ className = '' }: { className?: string }) {
  return <svg className={`al-antennae ${className}`} viewBox="0 0 100 50" aria-hidden="true">
    <path d="M38 50Q30 26 18 14M62 50q8-24 20-36" fill="none" stroke={C.ink} strokeWidth="6" strokeLinecap="round" />
    <path d="M38 50Q30 26 18 14M62 50q8-24 20-36" fill="none" stroke="#7dff8a" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="16" cy="12" r="9" fill="#7dff8a" stroke={C.ink} strokeWidth="4" /><circle cx="84" cy="12" r="9" fill="#7dff8a" stroke={C.ink} strokeWidth="4" />
  </svg>;
}
