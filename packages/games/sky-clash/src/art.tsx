/** Launcher art: Mario's leaping punch meets Pikachu's Skull Bash above Battlefield, with Kirby and Link on the side platforms. Pure SVG, no Three import. */
export function SkyClashArt({ className = '' }: { className?: string }) {
  return <svg className={`kp-game-art ${className}`} viewBox="0 0 300 130" role="img" aria-label="Sky Clash: Mario and Pikachu clash above Battlefield while Kirby and Link watch from the platforms">
    <defs>
      <linearGradient id="sca-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0d0b2e"/><stop offset=".55" stopColor="#2a1f63"/><stop offset="1" stopColor="#6a4bb0"/></linearGradient>
      <radialGradient id="sca-flash"><stop offset="0" stopColor="#fffbe8"/><stop offset=".35" stopColor="#ffe68a" stopOpacity=".9"/><stop offset="1" stopColor="#ff9a2e" stopOpacity="0"/></radialGradient>
      <linearGradient id="sca-rock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7a6fb3"/><stop offset="1" stopColor="#241b52"/></linearGradient>
      <linearGradient id="sca-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e8e4ff"/><stop offset="1" stopColor="#a9a1dc"/></linearGradient>
    </defs>
    <rect width="300" height="130" rx="14" fill="url(#sca-sky)"/>
    <g fill="#fff6e5">{[[18, 40], [44, 14], [88, 30], [120, 10], [178, 18], [214, 8], [252, 30], [284, 16], [268, 52], [30, 66]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 3 ? .7 : 1.2} opacity=".85"/>)}</g>
    {/* Battlefield's ancient rings */}
    <g fill="none" stroke="#b9a8ff" opacity=".35"><circle cx="150" cy="70" r="46" strokeWidth="3"/><circle cx="150" cy="70" r="38" strokeWidth="1.2"/><ellipse cx="62" cy="76" rx="22" ry="30" strokeWidth="2"/><ellipse cx="238" cy="76" rx="22" ry="30" strokeWidth="2"/></g>
    {/* Soft platforms and the main stage */}
    <g><rect x="52" y="72" width="50" height="3.4" rx="1.7" fill="url(#sca-top)"/><rect x="198" y="72" width="50" height="3.4" rx="1.7" fill="url(#sca-top)"/><rect x="126" y="44" width="48" height="3.4" rx="1.7" fill="url(#sca-top)" opacity=".9"/></g>
    <path d="M40 98h220l-22 12-30 6-18 12h-80l-18-12-30-6z" fill="url(#sca-rock)"/>
    <path d="M118 128l32 2 32-2-32-6z" fill="#1a1440"/><path d="M84 106l12 8M204 106l-12 8M150 104v12" stroke="#c7b8ff" strokeWidth="1.2" opacity=".55"/>
    <rect x="38" y="94" width="224" height="5" rx="2" fill="url(#sca-top)"/><rect x="40" y="98.5" width="220" height="1.6" fill="#8d82c9"/>
    {/* Kirby on the left platform */}
    <g transform="translate(76 72)"><ellipse cx="-5" cy="-1.4" rx="4.2" ry="2.2" fill="#d8283e"/><ellipse cx="5" cy="-1.4" rx="4.2" ry="2.2" fill="#d8283e"/><circle cy="-8.5" r="7.5" fill="#f7a8c8"/><circle cx="-7.5" cy="-8" r="2.6" fill="#f7a8c8"/><circle cx="7.5" cy="-10" r="2.6" fill="#f7a8c8"/>
      <ellipse cx="-2" cy="-10" rx="1.1" ry="2.2" fill="#1b1340"/><ellipse cx="2" cy="-10" rx="1.1" ry="2.2" fill="#1b1340"/><ellipse cx="-4.4" cy="-7" rx="1.6" ry=".9" fill="#ff6b9a"/><ellipse cx="4.4" cy="-7" rx="1.6" ry=".9" fill="#ff6b9a"/><path d="M-1.2-6.5q1.2 1.2 2.4 0" stroke="#7a1b36" strokeWidth=".7" fill="none"/></g>
    {/* Link on the right platform, sword raised */}
    <g transform="translate(226 72)"><path d="M3-19l9-11" stroke="#dfe7ff" strokeWidth="1.8" strokeLinecap="round"/><path d="M1.5-17.5l3 2.4" stroke="#8a5cff" strokeWidth="2" strokeLinecap="round"/>
      <path d="M-3-8l-1 8M2-8l1 8" stroke="#6b4a2a" strokeWidth="2.6" strokeLinecap="round"/><path d="M-5-16h9l2 9h-13z" fill="#3fa34d"/><rect x="-7.5" y="-15" width="5" height="7" rx="1.5" fill="#3a57a8" stroke="#c9a34a" strokeWidth=".6"/>
      <circle cx="0" cy="-20" r="3.6" fill="#f5c9a0"/><path d="M-4-21q1-5 5-4.6l8 1.8-7 .6z" fill="#3fa34d"/><path d="M-3.6-20.5q2-3 6-2.4" stroke="#e8c15a" strokeWidth="1.3" fill="none"/><circle cx="-1.2" cy="-19.6" r=".6" fill="#1b1340"/></g>
    {/* Mario: leaping punch, facing right */}
    <g transform="translate(112 90)">
      <path d="M-3-17l-7 13M3-17l8 9" stroke="#2f5fd0" strokeWidth="7" strokeLinecap="round" fill="none"/>
      <ellipse cx="-11" cy="-3" rx="6" ry="3.2" fill="#6b3a1e"/><ellipse cx="13" cy="-7" rx="6" ry="3.2" fill="#6b3a1e" transform="rotate(-20 13 -7)"/>
      <path d="M-7-28l-8 7" stroke="#e23b2e" strokeWidth="6" strokeLinecap="round"/><circle cx="-16" cy="-20" r="3.6" fill="#fff" stroke="#1b1340" strokeWidth=".6"/>
      <ellipse cx="0" cy="-24" rx="9.5" ry="9" fill="#e23b2e"/><path d="M-7.5-27h15v8a7.5 7 0 0 1-15 0z" fill="#2f5fd0"/><circle cx="-4" cy="-25" r="1.5" fill="#ffd24a"/><circle cx="4" cy="-25" r="1.5" fill="#ffd24a"/>
      <path d="M6-30l14-5" stroke="#e23b2e" strokeWidth="6" strokeLinecap="round"/><circle cx="23" cy="-36" r="5" fill="#fff" stroke="#1b1340" strokeWidth=".7"/><path d="M21-39.5v7M24-39.5v7" stroke="#c9c3e6" strokeWidth=".6"/>
      <circle cx="1" cy="-40" r="9" fill="#f5c29a"/><path d="M-8-40q0 6 5 8l1-6z" fill="#5a2f14"/><ellipse cx="-4.5" cy="-39.5" rx="2" ry="2.6" fill="#f0b287"/>
      <ellipse cx="10" cy="-39" rx="3.8" ry="3" fill="#f0b287"/><path d="M2-35.5q4.5 2.6 11 .2q-2-2.6-5.4-1.9q-3.4-.8-5.6 1.7z" fill="#231a14"/><ellipse cx="5.6" cy="-43" rx="1.4" ry="2.3" fill="#1b1340"/><circle cx="6" cy="-43.8" r=".5" fill="#fff"/>
      <path d="M-8.5-43a9.6 9.2 0 0 1 18.6-1l7 1.6q-2.4 2.6-7.4 1.8l-18.2-.2z" fill="#e23b2e"/><circle cx="1.6" cy="-47.2" r="2.8" fill="#fff"/><path d="M.2-46l.4-2.4 1 1.3 1-1.3.4 2.4" stroke="#e23b2e" strokeWidth=".6" fill="none"/>
    </g>
    {/* Pikachu: Skull Bash, head first, facing left */}
    <g transform="translate(184 62)">
      <path d="M12 2l10-7-4-2 11-9-4-1.6 9-8-15 7 4 2.6-10 6 3 2z" fill="#f7d33c" stroke="#8a5a1c" strokeWidth=".8" strokeLinejoin="round"/>
      <ellipse cx="6" cy="2" rx="12" ry="8.6" fill="#f7d33c"/><path d="M8-5.5q3 1 3 4M13-4q2.6 1.6 2.4 4" stroke="#8a5a1c" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
      <ellipse cx="12" cy="9.4" rx="4.6" ry="2.4" fill="#f7d33c"/><ellipse cx="-14" cy="6.5" rx="3.6" ry="2.2" fill="#f7d33c"/>
      <path d="M-4-11q7-10 17-17q-1.6 10-9 17.6z" fill="#f7d33c"/><path d="M9.6-24.6q2-2 3.4-3.4q-.4 3.2-1.8 5.8z" fill="#1b1340"/>
      <path d="M-11-11q-2-11-2-20q6 7 7.6 18z" fill="#f7d33c"/><path d="M-13-26.5q0-3 0-4.5q2.4 2.6 3.4 5.4z" fill="#1b1340"/>
      <circle cx="-8" cy="-3" r="10" fill="#f7d33c"/><circle cx="-12" cy="-5.5" r="2.2" fill="#1b1340"/><circle cx="-12.6" cy="-6.3" r=".8" fill="#fff"/>
      <circle cx="-13.5" cy="1.5" r="3" fill="#e8413a"/><path d="M-17-2.2q1.4 1 2.6 0" stroke="#1b1340" strokeWidth=".7" fill="none"/>
      <g stroke="#fff38a" strokeWidth="1.3" fill="none" strokeLinejoin="round"><path d="M-2-16l3 3-3 1 3 3"/><path d="M20 12l3-3 1 3 3-3"/><path d="M-22-10l3 1-1 3 3 1"/></g>
    </g>
    {/* The clash */}
    <circle cx="150" cy="56" r="18" fill="url(#sca-flash)"/>
    <path d="M150 42l3.4 8.6 9.4-2.6-6.6 7 8.2 5.4-9.6.4 1.6 9.4-6.4-7-6.4 7 1.6-9.4-9.6-.4 8.2-5.4-6.6-7 9.4 2.6z" fill="#fffbe8" stroke="#ffd24a" strokeWidth="1.2"/>
    <g stroke="#ffe68a" strokeWidth="1.6" strokeLinecap="round"><path d="M131 46l-6-4M169 46l6-4M131 66l-6 3M169 66l6 3M150 36v-6"/></g>
    <text x="14" y="27" fill="#ffd24a" fontFamily="'Lilita One','Arial Black',Impact,sans-serif" fontSize="21" stroke="#05071a" strokeWidth="3.4" paintOrder="stroke" letterSpacing=".5">SKY CLASH</text>
  </svg>;
}
export default SkyClashArt;
