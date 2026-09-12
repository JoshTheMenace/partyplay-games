import { BUCKET, WATER_BUCKET, SHEARS, BONE_MEAL, isHoe, ITEMS, isTool, isWorldBlock, itemColor, type Recipe } from './model';
export const CATEGORIES=['Construction','Equipment','Items','Nature'] as const;
export type Category=typeof CATEGORIES[number];
export const HIDDEN=[13,26,42], FOODS=[53,40,42,27,58,70,71,72,73,74,75,78,79,80,81,82], PICKS=[24,25,26,36,52], SWORDS=[37,60,61];
const NATURE=new Set([1,2,3,4,5,6,7,8,9,14,17,19,20,32,33,34,45,47,63,38,39,...FOODS]);
const COLORS:Record<number,string>={36:'#d6d9de',37:'#d6d9de',41:'#d6d9de',60:'#aa8153',61:'#aaaaaa',48:'#c9a48a',59:'#b5563f',49:'#2b2d30',50:'#a87947',54:'#e8e2cf',55:'#d0d0d0',56:'#f0f0f0',57:'#6e6e6e',58:'#7c5a3c',39:'#d9b85a',40:'#c58b4a',38:'#7fa350',42:'#a24a4a',62:'#3a2f28',63:'#9faab7'};
export const itemName=(id:number)=>id===0?'Empty hand':ITEMS[id]??`Item ${id}`;
export const visible=(version:number,id:number)=>version<4||!HIDDEN.includes(id);
export function category(id:number,recipes:readonly Recipe[]):Category{return recipes.find(r=>r.item===id)?.category??(isTool(id)?'Equipment':NATURE.has(id)?'Nature':isWorldBlock(id)?'Construction':'Items');}
const shade=(hex:string,f:number)=>`#${[1,3,5].map(i=>Math.round(Math.min(255,parseInt(hex.slice(i,i+2),16)*f)).toString(16).padStart(2,'0')).join('')}`;
/** Original flat iconography: bevelled cubes for blocks, silhouettes for tools and items. */
export function ItemIcon({id}:{id:number}){
 const c=COLORS[id]??itemColor(id);
 if(!id)return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" fill="none" stroke="#ffffff55" strokeWidth="2" strokeDasharray="3 3"/></svg>;
 if(id===BUCKET||id===WATER_BUCKET)return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16l-3 15H7z" fill="#acb4b8" stroke="#626c76" strokeWidth="2"/><ellipse cx="12" cy="6" rx="8" ry="3" fill={id===WATER_BUCKET?'#459bc6':'#495866'}/><path d="M5 6V4q7-5 14 0v2" fill="none" stroke="#d9dfe2" strokeWidth="2"/></svg>;
 if(id===SHEARS)return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 18 11-15-2 12L7 3l-1 12" fill="none" stroke="#ccd2d4" strokeWidth="3"/><circle cx="6" cy="18" r="3" fill="none" stroke="#89979e" strokeWidth="2"/><circle cx="17" cy="18" r="3" fill="none" stroke="#89979e" strokeWidth="2"/></svg>;
 if(id===BONE_MEAL)return <svg viewBox="0 0 24 24" aria-hidden="true">{[[5,16],[10,12],[15,17],[17,7],[8,5]].map(([x,y])=><rect key={x} x={x} y={y} width="4" height="4" fill="#eee6d2"/>)}</svg>;
 if(isHoe(id))return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21 15 7" stroke="#8b6036" strokeWidth="3"/><path d="M7 4h12v4h-5v5h-4V8H7z" fill={id===67?'#b48a52':'#aaaaaa'}/></svg>;
 if(PICKS.includes(id))return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20 16 9" stroke="#7a4f23" strokeWidth="2.6" strokeLinecap="round"/><path d="M7 3q8-1 14 6l-3 3q-4-5-9-6z" fill={c} stroke={shade(c,.6)} strokeWidth=".8"/></svg>;
 if(SWORDS.includes(id))return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2l5 5-9 9-5-5z" fill={c} stroke={shade(c,.6)} strokeWidth=".8"/><path d="M4 12l8 8" stroke="#5a3d1f" strokeWidth="3" strokeLinecap="round"/><path d="M5 17l-2 2" stroke="#3b2814" strokeWidth="3" strokeLinecap="round"/></svg>;
 if(id===43)return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="10.5" y="9" width="3" height="12" fill="#8a5a2b"/><circle cx="12" cy="7" r="4" fill="#ffb347"/><circle cx="12" cy="6" r="2" fill="#fff0a0"/></svg>;
 if(id===45)return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V10" stroke="#7a4f23" strokeWidth="2"/><path d="M12 12q-7-1-7-8 7 0 7 8zm0-2q0-8 7-8 0 7-7 8z" fill={c}/></svg>;
 if(FOODS.includes(id)||id===38||id===63)return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7.5" fill={c} stroke={shade(c,.6)} strokeWidth=".8"/><circle cx="9.5" cy="10.5" r="2" fill="#ffffff55"/>{id===53&&<path d="M12 6q1-3 4-3" stroke="#4d7a2f" strokeWidth="2" fill="none"/>}</svg>;
 if([50,54,55].includes(id))return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5" stroke={c} strokeWidth="3.2" strokeLinecap="round"/>{id===55&&<path d="M19 5l-1 6-5-5z" fill="#e8e2cf"/>}</svg>;
 if([41,48,59].includes(id))return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15l3-6h13l-3 6z" fill={c} stroke={shade(c,.6)} strokeWidth=".8"/><path d="M4 15h13v3H4z" fill={shade(c,.75)}/></svg>;
 if(id===51)return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 8-8 12-8-12z" fill={c} stroke={shade(c,.6)} strokeWidth=".8"/><path d="M12 2l8 8H4z" fill="#ffffff55"/></svg>;
 if([56,57,49,62].includes(id))return <svg viewBox="0 0 24 24" aria-hidden="true">{[[8,9],[15,8],[11,15],[17,15]].map(([x,y])=><circle key={x} cx={x} cy={y} r="3.4" fill={c} stroke={shade(c,.6)} strokeWidth=".8"/>)}</svg>;
 return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 4.5L12 12 3 7.5z" fill={shade(c,1.22)}/><path d="M3 7.5L12 12v9l-9-4.5z" fill={c}/><path d="M12 12l9-4.5v9L12 21z" fill={shade(c,.7)}/></svg>;
}
export function Meter({value,kind}:{value:number;kind:'health'|'food'}){
 const shape=kind==='health'?<path d="M12 21s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z"/>:<><circle cx="14" cy="9" r="6"/><path d="M10 13l-6 6 1.5 1.5 6-6z"/></>;
 return <span className={`bw-meter bw-${kind}`} role="img" aria-label={`${kind==='health'?'Health':'Food'} ${Number.isInteger(value)?value:value.toFixed(1)} of 10`}>{Array.from({length:10},(_,i)=><svg key={i} viewBox="0 0 24 24">{shape}{value>i&&<g className="bw-fill" style={value<i+1?{clipPath:'inset(0 50% 0 0)'}:undefined}>{shape}</g>}</svg>)}</span>;
}
