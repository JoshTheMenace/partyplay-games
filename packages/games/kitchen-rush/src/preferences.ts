export function readGraphicsQuality(storage?: Pick<Storage, 'getItem'>): 'low' | 'balanced' {
  try { return (storage ?? localStorage).getItem('party.sceneQuality') === 'low' ? 'low' : 'balanced'; }
  catch { return 'balanced'; }
}
