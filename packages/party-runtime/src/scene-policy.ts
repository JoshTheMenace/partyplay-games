/** Heavy controller scenes are opt-in; late players stay spectators until the next round. */
export function usesScene(module: { SceneView?: unknown; sceneRoles?: readonly ('display' | 'controller')[] }, role: 'display' | 'controller', active: boolean) {
  return !!module.SceneView && active && (module.sceneRoles ?? ['display']).includes(role);
}
