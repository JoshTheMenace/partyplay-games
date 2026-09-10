export function readQuality():'low'|'balanced'{try{return localStorage.getItem('party.sceneQuality')==='low'?'low':'balanced';}catch{return'balanced';}}
export function writeQuality(value:'low'|'balanced'){try{localStorage.setItem('party.sceneQuality',value);return true;}catch{return false;}}
