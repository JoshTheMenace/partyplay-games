export type KartSfx={play(name:string,event?:number|{id?:string|number;delay?:number;value?:number}):unknown;setMuted(value:boolean):void;panic():void;voiceNames():string[]};
export function createKartSfx(context:AudioContext,options?:{rng?:()=>number}):KartSfx;
export function KART_VOICES(kit:unknown):Record<string,unknown>;
