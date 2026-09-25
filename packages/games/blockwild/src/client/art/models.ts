/**
 * GLB model contract for the expansion mobs (built by art/build_models.py into public/games/blockwild/models/).
 * All models face −Z with character left at −X; named nodes have identity rest rotation.
 * - villager*.glb: pivots head, body, leg_l, leg_r; 'arms' (crossed, child of body, not animated) and 'nose' (child of
 *   head). One GLB per profession (`VILLAGER_MODELS[p]`); 'villager' is the farmer, so it is also the safe default.
 * - zombified_piglin.glb: humanoid pivots plus 'item' (a gold sword, child of arm_r at the hand).
 * - ghast.glb: 'body' (the 4 m cube, y 0..4) with `GHAST_TENTACLES` pivots (tentacle_0..8, children of body at its
 *   underside, hanging along −Y) and 'face_shoot' (child of body: the open-eyed, open-mouthed face panel just in
 *   front of the calm face; show it only while shooting).
 * - tnt.glb: 'body' (a 0.98 m TNT cube, material 'tnt').
 */
export const VILLAGER_MODELS = ['villager', 'villager_librarian', 'villager_armorer', 'villager_toolsmith', 'villager_cleric'] as const;
export const GHAST_TENTACLES = Array.from({ length: 9 }, (_, i) => `tentacle_${i}`);
