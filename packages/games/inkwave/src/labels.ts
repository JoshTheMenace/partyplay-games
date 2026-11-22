// Names the shell shows before a match exists (the lobby line-up, the intro card). The engine's own tables are too large
// to ship in the lobby bundle; tests/rules.test.ts keeps these in step with them.
export const TEAMS = [{ name: 'Tangerine', color: '#ff8a14' }, { name: 'Cobalt', color: '#2f5bff' }];
export const STAGES: Record<string, string> = { tidewater: 'Tidewater Plaza', kelpline: 'Kelpline Terminal', halyard: 'Halyard Marina', saltpan: 'Saltpan Basin', crossmarket: 'Crossroads Market', lockgate: 'Lockgate Canals', terraces: 'Terrace Heights', cargo: 'Cargo Terminal' };
export const MODES = { turf: 'Turf War', zones: 'Zone Control', boss: 'Boss Battle' };
