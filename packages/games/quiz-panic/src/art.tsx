import type { CSSProperties } from 'react';
export const answerTones = ['sun', 'sky', 'lime', 'grape'] as const;
export const symbolTones = ['sun', 'sky', 'grape', 'lime'] as const;
export function LabSymbol({ value }: { value: number }) {
  return <svg className="quiz-panic-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {value === 0 ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></> : value === 1 ? <path d="M12 2C10 6 5 10 5 15a7 7 0 0 0 14 0c0-5-5-9-7-13ZM8 15a4 4 0 0 0 4 4"/> : value === 2 ? <path d="m13 2-9 12h7l-1 8 10-13h-8z"/> : <><path d="M20 3C10 2 3 7 4 14c1 8 15 7 16-11Z"/><path d="M3 22 15 9m-5 5h6"/></>}
  </svg>;
}
export function LabArt({ progress = 1 }: { progress?: number }) {
  return <svg className="quiz-panic-art" style={{ '--quiz-panic-needle': `${Math.max(0, Math.min(1, progress)) * 140 - 70}deg` } as CSSProperties} viewBox="0 0 600 160" aria-hidden="true">
    <path className="quiz-panic-pipe" d="M0 100H80V45H190M410 45H520V100H600"/>
    <path className="quiz-panic-pipe-highlight" d="M0 96H76V41h80m275 0h93v55h76"/>
    <path className="quiz-panic-bench" d="M102 145h150m97 0h115"/>
    <path className="quiz-panic-glass" d="M160 18h44v48l42 65q6 14-14 14h-100q-20 0-14-14l42-65z"/>
    <path className="quiz-panic-liquid" d="M148 92q17-6 34 0t34 0l26 43h-121z"/>
    <path className="quiz-panic-glass-mark" d="M169 30v34l-17 29m-14 25h12m-5-13h12"/>
    <circle className="quiz-panic-gauge-rim" cx="300" cy="75" r="66"/><circle className="quiz-panic-gauge" cx="300" cy="75" r="59"/>
    <path className="quiz-panic-dial" d="M256 76a44 44 0 0 1 88 0"/>
    {[0, 1, 2, 3, 4, 5, 6].map(i => <path key={i} className="quiz-panic-gauge-tick" d="M300 24v7" transform={`rotate(${i * 25 - 75} 300 75)`}/>)}
    <path className="quiz-panic-needle" d="M300 75V38"/><circle className="quiz-panic-hub" cx="300" cy="75" r="7"/>
    <text x="300" y="103" textAnchor="middle" className="quiz-panic-gauge-label">BUBBLE BUREAU</text>
    <path className="quiz-panic-glass" d="M390 18h40v52l25 65q4 10-10 10h-70q-14 0-10-10l25-65z"/>
    <path className="quiz-panic-liquid quiz-panic-sky" d="M383 93q13-5 27 0t27 0l17 42h-87z"/>
    <path className="quiz-panic-glass-mark" d="M399 30v36m-20 51h10m-6-12h10"/>
    <circle className="quiz-panic-bubble" cx="176" cy="116" r="8"/><circle className="quiz-panic-bubble" cx="204" cy="101" r="5"/><circle className="quiz-panic-bubble" cx="407" cy="110" r="7"/>
  </svg>;
}
