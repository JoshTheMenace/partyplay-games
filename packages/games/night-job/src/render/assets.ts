/* Asset base for the scene. Kept free of three.js so controllers can call it from client.prepare cheaply. */
let base = '/games/night-job/';
export function setAssetBase(value: string) { base = value.endsWith('/') ? value : `${value}/`; }
export const assetUrl = (path: string) => `${base}${path}`;
