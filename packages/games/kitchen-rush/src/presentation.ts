import {COOK_SECONDS,type Station} from './model';

export function cookingStatus(station:Station|undefined,practice:boolean){
  if(!station||!['stove','oven'].includes(station.kind)||!station.item)return null;
  const duration=station.kind==='oven'?8:COOK_SECONDS,paused=station.powered?'':' · power paused';
  if(station.fire)return{kind:'fire',label:'Fire · empty hands, hold Use',progress:station.fire,color:'#ed6546'};
  if(station.item.food.some(f=>f.stage==='burnt'))return{kind:'burnt',label:'Burnt · collect and bin'+paused,progress:1,color:'#ed6546'};
  if(station.heat<duration)return{kind:'cooking',label:`${station.kind==='oven'?'Baking':'Cooking'} · ${Math.ceil(duration-station.heat)}s`+paused,progress:station.heat/duration,color:'#65b9ce'};
  const remaining=Math.max(0,duration+10-station.heat),warning=!practice&&remaining<=4;
  return{kind:warning?'warning':'ready',label:practice?'Ready · collect'+paused:`Ready · ${Math.ceil(remaining)}s to burn`+paused,progress:practice?1:remaining/10,color:warning?'#f4a53d':'#80cd58'};
}
