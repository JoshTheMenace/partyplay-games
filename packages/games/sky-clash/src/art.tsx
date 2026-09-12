/** Launcher/lobby art: tiny Fox and Falco replacements clashing over Cloudbreak. Pure SVG, no Three import. */
export function SkyClashArt({ className = '' }: { className?: string }) {
  return <svg className={`kp-game-art ${className}`} viewBox="0 0 300 130" role="img" aria-label="Sky Clash: Fox and Falco clash on the floating Cloudbreak arena at sunset">
    <defs>
      <linearGradient id="sc-art-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1d1650"/><stop offset=".45" stopColor="#6b3d8f"/><stop offset=".75" stopColor="#ff7d5c"/><stop offset="1" stopColor="#ffc27a"/></linearGradient>
      <radialGradient id="sc-art-glow"><stop offset="0" stopColor="#ffb469" stopOpacity=".7"/><stop offset="1" stopColor="#ffb469" stopOpacity="0"/></radialGradient>
    </defs>
    <rect width="300" height="130" rx="14" fill="url(#sc-art-sky)"/>
    <circle cx="232" cy="44" r="40" fill="url(#sc-art-glow)"/><circle cx="232" cy="44" r="19" fill="#fff0c4"/>
    <g fill="#f6bfa8" opacity=".85"><ellipse cx="38" cy="52" rx="26" ry="8"/><ellipse cx="58" cy="46" rx="16" ry="8"/><ellipse cx="270" cy="84" rx="24" ry="7"/><ellipse cx="200" cy="30" rx="18" ry="6"/></g>
    <g><rect x="80" y="64" width="34" height="5" rx="2" fill="#f4e6cc"/><rect x="79" y="69" width="36" height="2.5" fill="#ffb347"/><rect x="186" y="64" width="34" height="5" rx="2" fill="#f4e6cc"/><rect x="185" y="69" width="36" height="2.5" fill="#ffb347"/><rect x="134" y="42" width="32" height="5" rx="2" fill="#f4e6cc"/><rect x="133" y="47" width="34" height="2.5" fill="#ffb347"/></g>
    <polygon points="70,104 230,104 196,124 106,124" fill="#4a3a8c"/><polygon points="118,124 184,124 152,131" fill="#2d224f"/>
    <rect x="56" y="93" width="188" height="9" rx="3" fill="#f4e6cc"/><rect x="54" y="101" width="192" height="3.5" rx="1" fill="#ffb347"/>
    <g fill="#fff2e2"><ellipse cx="92" cy="112" rx="18" ry="6"/><ellipse cx="212" cy="116" rx="20" ry="6"/><ellipse cx="150" cy="128" rx="16" ry="5"/></g>
    {/* Fox: orange pilot in a teal flight suit, flying kick to the right */}
    <g transform="translate(112 93)">
      <path d="M-2 -2 L-10 -12" stroke="#2f5d5a" strokeWidth="5" strokeLinecap="round"/><path d="M-10 -12 L-13 -16" stroke="#5b7f8f" strokeWidth="5" strokeLinecap="round"/>
      <path d="M3 -10 L22 -14" stroke="#2f5d5a" strokeWidth="5" strokeLinecap="round"/><rect x="20" y="-18" width="9" height="7" rx="2" fill="#5b7f8f"/>
      <rect x="-7" y="-30" width="14" height="20" rx="5" fill="#2f5d5a" transform="rotate(-14)"/><rect x="-5" y="-28" width="10" height="10" rx="2" fill="#dfe3e8" transform="rotate(-14)"/><path d="M-2 -28 L4 -16" stroke="#ff5748" strokeWidth="3" strokeLinecap="round"/>
      <path d="M-6 -26 L-16 -20" stroke="#2f5d5a" strokeWidth="4.5" strokeLinecap="round"/><circle cx="-18" cy="-19" r="3.2" fill="#2a2a33"/><path d="M6 -26 L15 -30" stroke="#2f5d5a" strokeWidth="4.5" strokeLinecap="round"/><circle cx="17" cy="-31" r="3.2" fill="#2a2a33"/>
      <ellipse cx="-2" cy="-39" rx="7" ry="6.5" fill="#e07a33"/><ellipse cx="2" cy="-37" rx="4.5" ry="3" fill="#f6e3c8"/><polygon points="-8,-42 -10,-52 -3,-45" fill="#e07a33"/><polygon points="3,-43 7,-52 8,-44" fill="#e07a33"/><rect x="-6" y="-42" width="8" height="2.5" fill="#28c6e7"/>
      <path d="M-9 -22 C-16 -24 -20 -30 -18 -36" stroke="#e07a33" strokeWidth="4" fill="none" strokeLinecap="round"/>
    </g>
    {/* Falco: blue bird in a red-trim jacket, guarding with a wing-arm forward */}
    <g transform="translate(190 93)">
      <path d="M-5 0 L-6 -11 M5 0 L6 -11" stroke="#31405f" strokeWidth="5" strokeLinecap="round"/><path d="M-6 -11 L-6 -14 M6 -11 L6 -14" stroke="#c9463d" strokeWidth="5" strokeLinecap="round"/>
      <rect x="-9" y="-33" width="18" height="21" rx="5" fill="#c9463d"/><rect x="-7" y="-31" width="14" height="10" rx="3" fill="#e9e3d8"/><rect x="-9.5" y="-18" width="19" height="3" fill="#31405f"/>
      <path d="M-10 -29 L-22 -24" stroke="#c9463d" strokeWidth="5" strokeLinecap="round"/><path d="M-21 -25 L-30 -22" stroke="#3b6fd8" strokeWidth="5" strokeLinecap="round"/><circle cx="-33" cy="-21" r="4.5" fill="#27324f"/>
      <path d="M10 -29 L16 -21" stroke="#c9463d" strokeWidth="5" strokeLinecap="round"/><circle cx="17" cy="-19" r="4" fill="#27324f"/>
      <circle cx="0" cy="-41" r="7.5" fill="#3b6fd8"/><polygon points="-6,-40 -17,-38 -6,-36" fill="#ffb34d"/><circle cx="-2" cy="-43" r="1.6" fill="#05071a"/><polygon points="2,-47 5,-56 7,-47" fill="#3b6fd8"/><polygon points="-2,-48 -1,-57 3,-48" fill="#3b6fd8"/>
    </g>
    {/* Clash spark between the two */}
    <g transform="translate(150 70)"><polygon points="0,-13 3,-4 12,-6 6,0 12,6 3,4 0,13 -3,4 -12,6 -6,0 -12,-6 -3,-4" fill="#fff6e5" stroke="#ffd24a" strokeWidth="1.5"/><path d="M-19 -14 L-14 -10 M19 -14 L14 -10 M-20 10 L-15 8 M20 10 L15 8" stroke="#ffd24a" strokeWidth="2" strokeLinecap="round"/></g>
    <text x="14" y="26" fill="#ffd24a" fontFamily="'Lilita One','Arial Black',Impact,sans-serif" fontSize="20" stroke="#05071a" strokeWidth="3" paintOrder="stroke">SKY CLASH</text>
  </svg>;
}
export default SkyClashArt;
