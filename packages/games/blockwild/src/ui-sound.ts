export type UiSound='select'|'open'|'close'|'chest-open'|'chest-close';
export function uiSound(kind:UiSound){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('blockwild-ui-sound',{detail:kind}));}
