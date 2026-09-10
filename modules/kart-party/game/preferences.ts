import { DRIVERS } from './types';
export type Preferences={name:string;driver:number;muted:boolean;quality:'high'|'performance';qualityChosen:boolean};
export function readPreferences(raw:string|null,defaultQuality:Preferences['quality']='high'):Preferences {
  const defaults:Preferences={name:'Racer',driver:0,muted:false,quality:defaultQuality,qualityChosen:false};
  try {
    const value=JSON.parse(raw??'null');if(!value||typeof value!=='object'||Array.isArray(value))return defaults;
    return {name:typeof value.name==='string'?value.name.trim().slice(0,20)||defaults.name:defaults.name,driver:Number.isInteger(value.driver)&&value.driver>=0&&value.driver<DRIVERS.length?value.driver:0,muted:value.muted===true,quality:value.quality==='performance'?'performance':value.quality==='high'&&(value.qualityChosen===true||defaultQuality==='high')?'high':defaultQuality,qualityChosen:value.qualityChosen===true};
  }catch{return defaults;}
}
