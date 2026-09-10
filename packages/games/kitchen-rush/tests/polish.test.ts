import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseRecipe} from '../src/orders';
import {cookingStatus} from '../src/presentation';
import {RECIPES,itemLabel,layout,type Station,type Ticket} from '../src/model';

test('seeded orders introduce every enabled dish, vary replays and cap duplicate pressure',()=>{
 const orders=(seed:number)=>Array.from({length:40},(_,i)=>chooseRecipe(seed,i,4,[]).id);
 assert.deepEqual(orders(42).slice(0,4),RECIPES.map(r=>r.id));assert.deepEqual(orders(42),orders(42));assert.notDeepEqual(orders(42),orders(43));assert(orders(42).some((id,i)=>i>4&&id!==RECIPES[i%4].id));
 const tickets:Ticket[]=[1,2].map(id=>({id,recipe:'salad',createdAt:0,expiresAt:10}));for(let i=4;i<50;i++)assert.notEqual(chooseRecipe(42,i,4,tickets).id,'salad');for(let i=0;i<20;i++)assert.equal(chooseRecipe(42,i,1,tickets).id,'salad');
});
test('salad kitchens replace unusable stoves with prep space at each roster',()=>{for(let n=2;n<=10;n++){assert(!layout(0,n).some(s=>s.kind==='stove'));assert(layout(0,n).filter(s=>s.kind==='board').length>layout(1,n).filter(s=>s.kind==='board').length);assert(layout(1,n).some(s=>s.kind==='stove'));}});
test('cook and oven readiness, burn warnings, paused heat and practice are distinguishable',()=>{
 for(const kind of ['stove','oven'] as const){const s:Station={id:'test',kind,x:0,z:0,item:{id:1,kind:'food',food:[{kind:'patty',stage:'raw'}],dirty:false},heat:2,progress:0,fire:0,working:false,powered:true},duration=kind==='oven'?8:6;
 assert.equal(cookingStatus(s,false)?.kind,'cooking');s.heat=duration;assert.equal(cookingStatus(s,false)?.kind,'ready');s.heat=duration+7;assert.equal(cookingStatus(s,false)?.kind,'warning');assert.match(cookingStatus(s,false)!.label,/3s to burn/);s.powered=false;assert.match(cookingStatus(s,false)!.label,/power paused/);assert.equal(cookingStatus(s,true)?.kind,'ready');assert(!cookingStatus(s,true)!.label.includes('burn'));s.item!.food[0].stage='burnt';assert.equal(cookingStatus(s,false)?.kind,'burnt');s.fire=.5;assert.equal(cookingStatus(s,false)?.kind,'fire');
 }
});
test('repeated plate parts collapse without hiding their preparation state',()=>{assert.equal(itemLabel({id:1,kind:'plate',dirty:false,food:Array.from({length:3},()=>({kind:'lettuce',stage:'chopped'}))}),'Plate: 3× chopped Lettuce');});
