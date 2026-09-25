/** Module setups the CPU must play to target: every module alone plus the main combinations. */
import type { Settings } from '../../src/model';

type S = Partial<Settings>;
const ck: S = { citiesKnights: true };
const sea = (seafarers: Settings['seafarers'], extra: S = {}): S => ({ map: 'seafarers', seafarers, ...extra });
const ep = (extra: S = {}): S => ({ map: 'explorers', ...extra });

export const ALONE: Record<string, S> = {
  'new-shores': sea('new-shores'), 'four-islands': sea('four-islands'), 'fog-islands': sea('fog-islands'),
  base: {}, explorers: ep(), 'cities-knights': ck,
  fishing: { scenarios: ['fishing'] }, rivers: { scenarios: ['rivers'] }, caravans: { scenarios: ['caravans'] },
  'barbarian-attack': { scenarios: ['barbarian-attack'] }, deliveries: { scenarios: ['deliveries'] },
  'friendly-robber': { variants: ['friendly-robber'] }, harbormaster: { variants: ['harbormaster'] },
};

export const COMBOS: Record<string, S> = {
  'ck+seafarers': sea('new-shores', ck), 'ck+fog-islands': sea('fog-islands', ck),
  'ck+fishing': { ...ck, scenarios: ['fishing'] }, 'ck+rivers': { ...ck, scenarios: ['rivers'] },
  'ck+caravans': { ...ck, scenarios: ['caravans'] },
  'ck+barbarian-attack': { ...ck, scenarios: ['barbarian-attack'] },
  'ck+deliveries': { ...ck, scenarios: ['deliveries'] },
  'ep+fishing': ep({ scenarios: ['fishing'] }), 'ep+ck': ep(ck),
};

export const CONFIGS: Record<string, S> = { ...ALONE, ...COMBOS };
