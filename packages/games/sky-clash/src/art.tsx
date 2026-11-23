/** Launcher art: the crew of the Reaches on Beacon Rock at dusk. Sola's lantern meets Toll's fist over the terrace while Kes and Vesper hold the slabs. Pure SVG, no Three import. */
export function SkyClashArt({ className = '' }: { className?: string }) {
  return <svg className={`kp-game-art ${className}`} viewBox="0 0 300 130" role="img" aria-label="Sky Clash: Sola and Toll clash on Beacon Rock at dusk while Kes and Vesper watch from the floating slabs">
    <defs>
      <linearGradient id="sca-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#141a52"/><stop offset=".5" stopColor="#57488f"/><stop offset=".82" stopColor="#f0a070"/><stop offset="1" stopColor="#ffd9a8"/></linearGradient>
      <radialGradient id="sca-flash"><stop offset="0" stopColor="#fffbe8"/><stop offset=".3" stopColor="#ffd27a" stopOpacity=".95"/><stop offset="1" stopColor="#ff9a3c" stopOpacity="0"/></radialGradient>
      <radialGradient id="sca-lamp"><stop offset="0" stopColor="#fff2c4"/><stop offset="1" stopColor="#ff9a3c" stopOpacity="0"/></radialGradient>
      <linearGradient id="sca-stone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d9cbb4"/><stop offset="1" stopColor="#8e8072"/></linearGradient>
      <linearGradient id="sca-rock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7a6c8a"/><stop offset="1" stopColor="#2c2748"/></linearGradient>
      <linearGradient id="sca-beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ffe9b8" stopOpacity=".7"/><stop offset="1" stopColor="#ffe9b8" stopOpacity="0"/></linearGradient>
    </defs>
    <rect width="300" height="130" rx="14" fill="url(#sca-sky)"/>
    <g fill="#fff6e5">{[[20, 14], [52, 8], [96, 20], [138, 6], [262, 12], [284, 28], [34, 34]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 3 ? .6 : 1} opacity=".8"/>)}</g>
    {/* Far islands in the haze, a band of lit cloud */}
    <path d="M0 96q30-8 62-3t58-4 70 3 60-5 50 4v39H0z" fill="#ffc9a0" opacity=".5"/>
    <path d="M14 78l14-6 12 4 4 8-10 14-12-6zM262 70l16-5 12 6-4 12-12 12-10-10z" fill="#8f7fb0" opacity=".55"/>
    {/* The beacon and its beam */}
    <path d="M226 20l-70-12v20z" fill="url(#sca-beam)"/><path d="M228 20l72-9v22z" fill="url(#sca-beam)" opacity=".7" transform="rotate(180 264 21) translate(0 0)"/>
    <path d="M219 98l3-70h14l3 70z" fill="#cfc2ac"/><path d="M220.4 66h17.2l.5 9h-18.2zM221.6 40h14.8l.4 8h-15.6z" fill="#2f5560"/><rect x="218" y="14" width="20" height="14" rx="2" fill="#ffd27a"/><path d="M216 14h24l-12-9z" fill="#2f5560"/><circle cx="228" cy="21" r="12" fill="url(#sca-lamp)" opacity=".8"/>
    {/* Three floating slabs and the terrace */}
    {[[50, 70, 52], [198, 70, 52], [124, 44, 52]].map(([x, y, w], i) => <g key={i}><path d={`M${x + 3} ${y + 3}h${w - 6}l-${w / 2 - 6} 15z`} fill="url(#sca-rock)"/><rect x={x} y={y} width={w} height="3.6" rx="1.2" fill="url(#sca-stone)"/><rect x={x + 1} y={y + 3.4} width={w - 2} height="1.2" fill="#c9963f"/></g>)}
    <path d="M44 104h212l-18 10-34 6-22 10h-64l-22-10-34-6z" fill="url(#sca-rock)"/>
    <rect x="36" y="94" width="228" height="5" rx="1.6" fill="url(#sca-stone)"/><rect x="38" y="99" width="224" height="1.6" fill="#c9963f"/><rect x="40" y="100.6" width="220" height="6" fill="#a39584"/>
    <g stroke="#7d7268" strokeWidth=".6" opacity=".7">{[58, 84, 110, 136, 162, 188, 214, 240].map(x => <path key={x} d={`M${x} 100.6v6`}/>)}</g>
    {/* Kes on the left slab: saffron jacket, the diamond kite behind him, ribbons out */}
    <g transform="translate(76 70)"><path d="M-9-27l7-11 7 11-7 12z" fill="#efe6cf" stroke="#d28a1e" strokeWidth="1"/><path d="M-2-15q-8 6-13 4M-2-15q-5 9-11 10" stroke="#2f8a80" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      <path d="M-2-9l-3 9M2-9l4 9" stroke="#2a3160" strokeWidth="3" strokeLinecap="round"/><path d="M-4.5-18h9l1 9.5h-11z" fill="#d28a1e"/><path d="M-1-18h2.4v9H-1z" fill="#e2d7bd"/><path d="M4-16l6-4M-4-16l-5 4" stroke="#c48a62" strokeWidth="1.8" strokeLinecap="round"/>
      <circle cy="-21.5" r="3.4" fill="#c48a62"/><path d="M-3.6-22.5q1-4 4.2-3.6 3 .2 3 3.4-3.6-1.6-7.2.2z" fill="#23202e"/><path d="M-3-24q-5-5-4 3" stroke="#23202e" strokeWidth="1.8" fill="none" strokeLinecap="round"/></g>
    {/* Vesper on the right slab: plum robe, rose mantle, the gather glowing on her blowpipe */}
    <g transform="translate(224 70)"><path d="M8 0v-36" stroke="#8f97a3" strokeWidth="1.2" strokeLinecap="round"/><circle cx="8" cy="-38" r="7" fill="url(#sca-lamp)" opacity=".9"/><ellipse cx="8" cy="-38" rx="2" ry="2.8" fill="#bfeaff"/>
      <path d="M-5-17h9l3 17h-15z" fill="#4a2a58"/><path d="M-1.6-15h2.6l.8 10h-4z" fill="#4d3528"/><path d="M-6.5-18.5q6-3.4 12 0l-1 4q-5-1.6-10 0z" fill="#a84a66"/><path d="M4-14l4 2" stroke="#4a2a58" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="-.4" cy="-22.5" r="3.3" fill="#e6c0a2"/><path d="M-3.8-23.5q.6-4 3.6-4t3.6 3.6l-.6 1.6q-2.6-2.6-6.6-1z" fill="#cdc9d6"/><path d="M2.4-24q3 4 1.6 9" stroke="#cdc9d6" strokeWidth="1.6" fill="none" strokeLinecap="round"/><circle cx="-1.8" cy="-22.4" r="1" fill="#1e1a2a"/><circle cx="1" cy="-22.4" r="1" fill="#1e1a2a"/></g>
    {/* The clash: Sola's lantern-pike against Toll's fist */}
    <circle cx="151" cy="72" r="24" fill="url(#sca-flash)"/>
    <g stroke="#fff6e5" strokeLinecap="round" opacity=".95"><path d="M151 46v-7M151 98v6M127 72h-7M175 72h8M134 55l-5-5M168 55l5-5M134 89l-5 5M168 89l5 5" strokeWidth="1.5"/></g>
    <g transform="translate(112 94)">
      <path d="M-3-12l-5 12M3-12l7 12" stroke="#2a2d38" strokeWidth="3.2" strokeLinecap="round"/><path d="M-8 0l-1.6-6h4zM10 0l-.6-6h3.6z" fill="#5c3521"/>
      <path d="M-6-27h11l2 9 3 9q-6 3-8-2l-2 4q-6 0-8-4z" fill="#1d5a62"/><path d="M-4.8-18.4h10.6v1.8H-4.8z" fill="#5c3521"/><path d="M-7-27.5q5.6-3 12 0l-.6 3.4q-5.4-1.8-10.8 0z" fill="#cfc5a9"/>
      <path d="M4-24l14-4" stroke="#1d5a62" strokeWidth="3.4" strokeLinecap="round"/><path d="M-12-14l52-10" stroke="#4a3226" strokeWidth="1.5" strokeLinecap="round"/><path d="M40-24l7-3.4-5.4 5.2z" fill="#dfe7ee"/>
      <circle cx="-.6" cy="-32" r="4" fill="#e3a882"/><path d="M-4.8-33q.4-4.8 4.4-4.8 4.2 0 4.4 4.2-4.4-2-8.8.6z" fill="#402b2c"/><path d="M-3.4-35.6h6.4" stroke="#c9963f" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="37" cy="-18" r="6" fill="url(#sca-lamp)"/><rect x="35.4" y="-20.4" width="3.2" height="4.6" rx=".8" fill="#ffd27a" stroke="#c9963f" strokeWidth=".5"/>
    </g>
    <g transform="translate(192 94)">
      <path d="M-6-9l-1 9M6-9l2 9" stroke="#34363f" strokeWidth="4.6" strokeLinecap="round"/><path d="M-12 0h9l-1-4h-6zM4 0h10l-2-4h-7z" fill="#4f8f80"/>
      <path d="M-13-8q-2-14 2-23 10-8 21 0 4 9 2 23-13 5-25 0z" fill="#4f8f80"/><path d="M-13.4-9.4q13 5 26.8 0" stroke="#c9963f" strokeWidth="1.5" fill="none"/><path d="M-12-24q12-4 24 0" stroke="#34363f" strokeWidth="1.3" fill="none"/>
      <circle cx="1" cy="-17" r="3.8" fill="#ffb347"/><path d="M-.6-20.4v6.8M1-20.8v7.6M2.6-20.4v6.8" stroke="#34363f" strokeWidth=".6"/>
      <path d="M-5-34q5-6 11 0v4h-11z" fill="#4f8f80"/><rect x="-4" y="-33" width="9" height="2.6" rx=".8" fill="#141218"/><circle cx="-1.6" cy="-31.7" r="1" fill="#ffd27a"/><circle cx="2.4" cy="-31.7" r="1" fill="#ffd27a"/><circle cx="1" cy="-39" r="1.6" fill="none" stroke="#c9963f" strokeWidth=".8"/>
      <circle cx="-13" cy="-28" r="6" fill="#4f8f80" stroke="#c9963f" strokeWidth=".8"/><circle cx="14" cy="-28" r="6" fill="#4f8f80" stroke="#c9963f" strokeWidth=".8"/>
      <path d="M-15-26l-17 5" stroke="#34363f" strokeWidth="4" strokeLinecap="round"/><path d="M-27-25l-10 3 1 5 10-3z" fill="#4f8f80" stroke="#c9963f" strokeWidth=".8"/><circle cx="-39" cy="-21" r="3.4" fill="#34363f"/>
      <path d="M16-26l5 10" stroke="#34363f" strokeWidth="4" strokeLinecap="round"/>
    </g>
    <text x="14" y="24" fontFamily="'Lilita One','Arial Black',sans-serif" fontSize="15" fill="#ffd27a" stroke="#141a52" strokeWidth="3" paintOrder="stroke" letterSpacing=".5">SKY CLASH</text>
  </svg>;
}
