/**
 * Fighter rendering API used by src/scene/index.tsx.
 *
 *   const models = await loadFighterModels(kinds, signal);   // one GLB parse per fighter per page, abortable
 *   const cache = scope.own(new FighterCache());             // shared geometry/textures for every actor in the scene
 *   const actor = new FighterActor({ view, model: models, cache }); scene.add(actor.group);
 *   actor.update(view, prev, { dt, seconds, reduced, cameraDistance, platforms });   // every rendered frame
 *   actor.dispose();                                         // when the fighter leaves or the scene unmounts
 *
 * model may be the whole loaded map (the actor picks view.fighter) or one FighterModel. platforms are the current
 * floors: stageFrame().platforms and/or blocks (anything with left/right and y or top). Actors under a scene that
 * owns createFx() feed it dust, fast-fall glints and launch trails automatically (fx.track() stays safe to call too).
 */
export { loadFighterModels, modelUrl, costumesOf, propModeOf } from './load';
export { FighterActor, type ActorContext, type Surface } from './actor';
export { FighterCache } from './cache';
export type { FighterModel, FighterModels, PropMode } from './prepare';
