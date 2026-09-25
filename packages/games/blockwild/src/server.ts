/**
 * Blockwild authoritative rules. The simulation lives in src/sim/ (server-only); this file wires it to the platform.
 * Gameplay commands ride inside held input (see src/shared/protocol.ts), so applyAction is a no-op.
 */
import type { GameRules } from '../../../party-contract/src/index';
import { neutralInput, parseAction, parseInput, validateSettings, type Action, type Input, type PrivateView, type Settings, type View } from './shared/protocol';
import { createState, saveSource, setPresence, tickState } from './sim/game';
import { exportSave, parseSave } from './sim/save';
import type { State } from './sim/state';
import { outcome, playerView, publicView } from './sim/views';

export type { State };

export const rules: GameRules<State, Input, Action, Settings, View, PrivateView> = {
  validateSettings, parseInput, parseAction, neutralInput,
  create: (ctx, settings) => createState(ctx, settings),
  applyAction() {},
  tick: (state, inputs, dt) => tickState(state, inputs, dt),
  onPresenceChange: (state, playerId, connected) => setPresence(state, playerId, connected),
  publicView: state => publicView(state),
  playerView: (state, playerId) => playerView(state, playerId),
  exportSave: state => exportSave(saveSource(state)),
  loadSave(ctx, raw) {
    const save = parseSave(raw);
    return { state: createState(ctx, save.settings, { save }), settings: save.settings };
  },
  finish(state) { state.finished = true; },
  outcome,
  dispose(state) { state.world.cache.clear(); },
};
export default rules;
