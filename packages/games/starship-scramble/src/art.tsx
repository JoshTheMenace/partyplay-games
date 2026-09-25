/** Launcher art: a four-ship fleet trading fire with the Armada Flagship, captured from the game's own battle renderer (public/games/starship-scramble/cover.jpg). */
export function StarshipArt({ className = '' }: { className?: string }) {
  return <svg className={`kp-game-art ${className}`} viewBox="0 0 300 130" role="img" aria-label="Starship Scramble: a fleet of four captains' ships trades fire with the Armada Flagship">
    <defs><clipPath id="ssa-card"><rect width="300" height="130" rx="14"/></clipPath></defs>
    <g clipPath="url(#ssa-card)"><rect width="300" height="130" fill="#1c0610"/><image href="/games/starship-scramble/cover.jpg" width="300" height="130" preserveAspectRatio="xMidYMid slice"/></g>
  </svg>;
}
