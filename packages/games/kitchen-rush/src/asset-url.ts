let base = '/games/kitchen-rush/';
export function setAssetBase(value: string) { base = value.endsWith('/') ? value : `${value}/`; }
export function assetUrl(path: string) { return `${base}${path}`; }
