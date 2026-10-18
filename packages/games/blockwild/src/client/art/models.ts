/**
 * GLB model contract for the expansion mobs (built by art/build_models.py into public/games/blockwild/models/).
 * All models face −Z with character left at −X; named nodes have identity rest rotation.
 * - villager*.glb: pivots head, body, leg_l, leg_r; 'arms' (crossed, child of body, not animated) and 'nose' (child of
 *   head). One GLB per profession (`VILLAGER_MODELS[p]`); 'villager' is the farmer, so it is also the safe default;
 *   `MASON_MODEL` is profession 5.
 * - zombified_piglin.glb: humanoid pivots plus 'item' (a gold sword, child of arm_r at the hand).
 * - ghast.glb: 'body' (the 4 m cube, y 0..4) with `GHAST_TENTACLES` pivots (tentacle_0..8, children of body at its
 *   underside, hanging along −Y) and 'face_shoot' (child of body: the open-eyed, open-mouthed face panel just in
 *   front of the calm face; show it only while shooting).
 * - tnt.glb: 'body' (a 0.98 m TNT cube, material 'tnt').
 * Endgame. Materials named 'eyes' and 'glow' carry an emissive texture (draw them full-bright); 'wing' and
 * 'crystal_glass' are alpha cut-outs, double-sided.
 * - blaze.glb: 'head', 'body' and `BLAZE_RINGS` (children of body on the +Y axis, top to bottom, four 'glow' rods
 *   each): spin each ring about +Y at its own speed and bob the body.
 * - enderman.glb: humanoid pivots (2.9 m tall, 30 px limbs) plus 'jaw' (child of head, hinged at its back: rotate
 *   it about −X to drop it when angry); its eye strips use material 'eyes'.
 * - silverfish.glb: `SILVERFISH_SEGMENTS` (head first), siblings along +Z, each turning about +Y at its centre.
 * - end_crystal.glb: 'base' (slab at the feet) and `CRYSTAL_PARTS` all centred 1.5 m up: two clear glass frames and
 *   the 'glow' core; spin them on different axes and bob them together.
 * - ender_dragon.glb (1/8 m per px, 25 m wingspan, sized to protocol DRAGON_PARTS): 'body' (centred 2 m up),
 *   `DRAGON_NECK` chained forward from the body → 'head' → 'jaw' (hinged under the skull), `DRAGON_TAIL` chained
 *   backwards, 'wing_l'/'wing_r' at the shoulders (roll about Z to flap) with 'wingtip_l'/'wingtip_r' at the elbows,
 *   leg_fl, leg_fr, leg_bl, leg_br; eyes in material 'eyes', wing membranes in 'wing'.
 */
export const MASON_MODEL = 'villager_mason';
export const VILLAGER_MODELS = ['villager', 'villager_librarian', 'villager_armorer', 'villager_toolsmith', 'villager_cleric', MASON_MODEL] as const;
export const GHAST_TENTACLES = Array.from({ length: 9 }, (_, i) => `tentacle_${i}`);
const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}_${i}`);
export const BLAZE_RINGS = names('rods_ring', 3), SILVERFISH_SEGMENTS = names('seg', 4);
export const DRAGON_NECK = names('neck', 5), DRAGON_TAIL = names('tail', 10);
export const CRYSTAL_PARTS = ['frame_outer', 'frame_inner', 'core'] as const;
