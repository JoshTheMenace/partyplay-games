import { useState, type ReactNode } from 'react';
import { ArcadeButton, Modal } from '../../../party-ui/src/index';
import { BENCH, BERRIES, CHEST, FUEL, FURNACE, SAPLING, SEEDS, isTool, paletteFor, recipesFor, stackLimit, type Action, type PrivateView, type Recipe, type View } from './model';
import { CATEGORIES, FOODS, ItemIcon, category, itemName, visible, type Category } from './items';
import type { Hotbar } from './hotbar';
import { uiSound } from './ui-sound';
export type Tab='inventory'|'craft'|'chest';
type Filter='All'|Category|'Smelting';
export function Slot({id,count,pressed,label,onClick,disabled,index,dim}:{id:number;count?:ReactNode;pressed?:boolean;label:string;onClick():void;disabled?:boolean;index?:number;dim?:boolean}){
 return <button type="button" className={`bw-slot${dim?' bw-dim':''}`} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}><ItemIcon id={id}/>{index!==undefined&&<small>{index}</small>}{count!==undefined&&<b>{count}</b>}</button>;
}
/** Layout the ingredient diagram: exact modern patterns, or a compact fill for legacy cost lists, on a grid at least `min` wide. */
function layout(r:Recipe,min:2|3):{size:2|3;cells:number[]}|null{
 const rows=r.pattern??[Object.entries(r.costs).flatMap(([id,n])=>Array<number>(n).fill(Number(id)))],cols=Math.max(...rows.map(row=>row.length));
 if(r.pattern&&(rows.length>3||cols>3))return null;
 if(!r.pattern){const flat=rows[0]!;if(flat.length>9)return null;const size=flat.length<=4?min:3;return{size,cells:Array.from({length:size*size},(_,i)=>flat[i]??0)};}
 const size=rows.length<=2&&cols<=2?min:3;return{size,cells:Array.from({length:size*size},(_,i)=>rows[Math.floor(i/size)]?.[i%size]??0)};
}
type Props={v:View;pv:PrivateView|null|undefined;inv:Record<number,number>;hotbar:Hotbar;setActive(i:number):void;pick(id:number):void;pending:boolean;status:string;act(a:Action):void;onClose():void;tab:Tab;setTab(t:Tab):void;initialFilter:Filter;onHelp():void;onMap():void;onQuality():void;quality:string};
export function Workbench({v,pv,inv,hotbar,setActive,pick,pending,status,act,onClose,tab,setTab,initialFilter,onHelp,onMap,onQuality,quality}:Props){
 const [filter,setFilter]=useState<Filter>(initialFilter),[query,setQuery]=useState(''),[craftable,setCraftable]=useState(false),[selected,setSelected]=useState<string|null>(null);
 const version=v.terrainVersion,recipes=recipesFor(version),creative=v.mode==='creative',station=pv?.station,size=pv?.craftingSize??2,nearFurnace=pv?.nearFurnace??false,chest=station?.kind===CHEST;
 const have=(id:number)=>creative?Infinity:inv[id]??0,can=(r:Recipe)=>Object.entries(r.costs).every(([k,n])=>have(Number(k))>=n);
 // Everything the client can predict; fuel burn time stays a server-side rejection.
 const reason=(r:Recipe)=>creative?'':version>=3&&r.station===BENCH&&size<3?'Needs a crafting table within reach.':version>=3&&r.station===FURNACE&&!nearFurnace?'Stand beside a furnace to smelt.':!can(r)?`Missing: ${Object.entries(r.costs).filter(([k,n])=>have(Number(k))<n).map(([k,n])=>`${n-have(Number(k))} ${itemName(Number(k))}`).join(', ')}`:isTool(r.item)&&inv[r.item]?'You already carry one.':(inv[r.item]??0)+r.count>stackLimit(version,r.item)?`Make room for ${r.count} ${itemName(r.item)}.`:'';
 const list=recipes.filter(r=>(filter==='All'||(filter==='Smelting'?r.station===FURNACE:(r.category??category(r.item,recipes))===filter))&&(!query||`${r.name} ${r.hint} ${itemName(r.item)}`.toLowerCase().includes(query.toLowerCase()))&&(!craftable||!reason(r)));
 const recipe=list.find(r=>r.id===selected)??list[0],diagram=recipe?layout(recipe,size):null,left={...inv},preview=!!recipe&&recipe.station===BENCH&&size<3;
 const owned=Object.keys(inv).map(Number).filter(id=>inv[id]!>0&&visible(version,id)),pool=creative?[...new Set([...paletteFor(version),...owned])]:owned,groups=CATEGORIES.map(c=>[c,pool.filter(id=>category(id,recipes)===c)]as const).filter(([,ids])=>ids.length);
 const right:Tab=chest?'chest':'craft',pane=tab==='inventory'?'inventory':right,count=(id:number)=>creative?'∞':inv[id]??0,full=(id:number)=>!creative&&(inv[id]??0)>=stackLimit(version,id);
 const fuelCopy=version<4?'Each batch burns one coal or log.':'Coal or charcoal burns for 80 seconds, a log or plank for 15; each smelt takes 10 seconds.';
 return <Modal title={chest?'Chest':station?.kind===FURNACE?'Furnace':size===3?'Crafting Table':'Inventory'} onClose={onClose} wide><div className="bw-workbench">
  <div className="bw-segment">{(['inventory',right]as Tab[]).map(t=><button key={t} type="button" aria-pressed={pane===t} onClick={()=>{if(t===pane)return;uiSound(t==='chest'?'chest-open':pane==='chest'?'chest-close':'select');setTab(t);}}>{t==='inventory'?'Inventory':t==='chest'?'Chest':'Craft'}</button>)}</div>
  <div className="bw-bench" data-pane={pane}>
   <section className="bw-pane" data-pane="inventory" aria-label="Inventory">
    <div className="bw-menu-row"><ArcadeButton tone="ghost" size="sm" onClick={onMap}>Map</ArcadeButton><ArcadeButton tone="ghost" size="sm" onClick={onHelp}>How to play</ArcadeButton><ArcadeButton tone="ghost" size="sm" disabled={pending} onClick={onQuality}>{quality==="low"?"Low":"Balanced"} graphics</ArcadeButton></div>
    <h3>Hotbar <span>tap a slot, then an item</span></h3>
    <div className="bw-slots bw-hotbar-mirror">{hotbar.slots.map((id,i)=><Slot key={i} id={id} index={i+1} count={id?count(id):undefined} dim={!!id&&!creative&&!inv[id]} pressed={hotbar.active===i} label={`Hotbar slot ${i+1}: ${itemName(id)}`} onClick={()=>setActive(i)}/>)}</div>
    <div className="bw-slots"><Slot id={0} label={`Empty hand into slot ${hotbar.active+1}`} pressed={hotbar.slots[hotbar.active]===0} onClick={()=>pick(0)}/></div>
    {groups.map(([c,ids])=><div key={c}><h4>{c}</h4><div className="bw-slots">{ids.map(id=><Slot key={id} id={id} count={count(id)} pressed={hotbar.slots[hotbar.active]===id} dim={full(id)} label={`${itemName(id)}, ${count(id)}${full(id)?' (stack full)':''}. Put in hotbar slot ${hotbar.active+1}`} onClick={()=>pick(id)}/>)}</div></div>)}
    {!groups.length&&<p className="bw-hint">Your inventory is empty. Punch oak logs and dirt to start; stacks hold {stackLimit(version,2)}.</p>}
    <div className="bw-inv-actions"><ArcadeButton size="sm" disabled={pending||(!creative&&!FOODS.some(id=>inv[id]))} onClick={()=>act({type:'eat'})}>Eat</ArcadeButton><ArcadeButton size="sm" tone="lime" disabled={pending||(!creative&&!inv[SEEDS])} onClick={()=>act({type:'plant'})}>Plant seeds</ArcadeButton><ArcadeButton size="sm" tone="lime" disabled={pending||(!creative&&(version<4?!inv[BERRIES]||!inv[2]:!inv[SAPLING]))} onClick={()=>act({type:'grow'})}>{version<4?'Grow tree':'Plant oak sapling'}</ArcadeButton></div>
    <p className="bw-hint">{version<4?'Grow tree costs 1 berry and 1 dirt. ':'A sapling needs clear grass or dirt with open space above; it becomes an oak a little later. '}Aim at the ground before opening this screen. Seeds go on grass or dirt; Use a ripe crop to harvest wheat.</p>
   </section>
   {chest&&station?<section className="bw-pane bw-chest" data-pane="chest" aria-label="Chest"><div><h4>Your pack · store</h4><div className="bw-slots">{owned.length?owned.map(id=><Slot key={id} id={id} count={count(id)} disabled={pending} label={`Store ${itemName(id)}, ${count(id)} carried`} onClick={()=>act({type:'deposit',item:id})}/>):<p className="bw-hint">Nothing to store.</p>}</div></div><div><h4>In the chest · take</h4><div className="bw-slots">{Object.entries(station.contents).length?Object.entries(station.contents).map(([id,n])=><Slot key={id} id={Number(id)} count={n} disabled={pending} label={`Take ${itemName(Number(id))}, ${n} stored`} onClick={()=>act({type:'withdraw',item:Number(id)})}/>):<p className="bw-hint">Empty. Anyone can store supplies here.</p>}</div></div><p className="bw-hint">Moves up to 64 at a time. Shared with every explorer.</p></section>
   :<section className="bw-pane bw-craft" data-pane="craft" aria-label="Crafting">
    {station?.kind===FURNACE&&<div className="bw-station"><ItemIcon id={FURNACE}/><p>{station.readyAt>v.time?`Smelting · ${Math.ceil(station.readyAt-v.time)}s left`:station.readyAt>0?'Output ready to collect.':`Choose a smelting recipe. ${fuelCopy}`}</p>{station.readyAt>0&&<ArcadeButton size="sm" disabled={pending||station.readyAt>v.time} onClick={()=>act({type:'use'})}>Collect</ArcadeButton>}</div>}
    <div className="bw-cats">{(['All',...CATEGORIES,'Smelting']as Filter[]).map(f=><button key={f} type="button" aria-pressed={filter===f} onClick={()=>{if(f!==filter)uiSound('select');setFilter(f);}}>{f}</button>)}</div>
    <div className="bw-tools"><label>Search recipes<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="planks, torch, pickaxe"/></label><button type="button" className="bw-toggle" aria-pressed={craftable} onClick={()=>{uiSound('select');setCraftable(!craftable);}}>Craftable</button></div>
    <div className="bw-book" aria-label="Recipe book">{list.map(r=><Slot key={r.id} id={r.item} count={r.count>1?r.count:undefined} pressed={recipe?.id===r.id} dim={!!reason(r)} label={`${r.name}${r.station===FURNACE?' (smelt)':''}${reason(r)?', not craftable now':''}`} onClick={()=>{if(r.id!==recipe?.id)uiSound('select');setSelected(r.id);}}/>)}{!list.length&&<p className="bw-hint">No recipes match{query?` “${query}”`:''}{craftable?' that you can craft right now':''}.</p>}</div>
    {recipe&&<div className="bw-detail"><h4>{recipe.name}</h4><p>{recipe.hint}</p>{preview&&<p className="bw-preview">3×3 preview · no crafting table in reach</p>}<div className="bw-diagram">
     {recipe.station===FURNACE?<div className="bw-grid" data-size="1"><Cell id={Object.keys(recipe.costs).map(Number)[0]!} missing={!can(recipe)}/><span className="bw-fuel" title={version<4?'Coal or log':'Coal, charcoal, log or plank'}><ItemIcon id={FUEL}/>fuel</span></div>
     :diagram?<div className="bw-grid" data-size={diagram.size}>{diagram.cells.map((id,i)=>{const missing=!!id&&!creative&&(left[id]??0)<=0;if(id&&!missing)left[id]!--;return <Cell key={i} id={id} missing={missing}/>;})}</div>
     :<ul className="bw-costs">{Object.entries(recipe.costs).map(([k,n])=><li key={k} className={have(Number(k))<n?'bw-missing':''}><ItemIcon id={Number(k)}/>{n} {itemName(Number(k))}</li>)}</ul>}
     <span className="bw-arrow" aria-hidden="true">→</span>
     <button type="button" className="bw-output" disabled={pending||!!reason(recipe)} aria-label={`${recipe.station===FURNACE?'Smelt':'Craft'} ${recipe.name}`} onClick={()=>act({type:'craft',recipe:recipe.id})}><ItemIcon id={recipe.item}/><b>{recipe.station===FURNACE?'Smelt':'Craft'}{recipe.count>1?` ×${recipe.count}`:''}</b></button>
    </div><p className="bw-reason">{reason(recipe)||(recipe.station===BENCH?'Crafting table recipe.':recipe.station===FURNACE?`Furnace recipe. ${fuelCopy}`:size===3?'Fits the pocket 2×2 grid too.':'Fits the 2×2 pocket grid.')}</p></div>}
   </section>}
  </div>
 </div><p className="bw-workbench-status" role="status" aria-atomic="true">{pending?'Working…':status}</p></Modal>;
}
const Cell=({id,missing}:{id:number;missing:boolean})=><span className={`bw-cell${missing?' bw-missing':''}`} title={id?itemName(id):undefined}>{!!id&&<ItemIcon id={id}/>}</span>;
