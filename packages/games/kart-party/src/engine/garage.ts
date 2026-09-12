export const KARTS=[
  {id:'standard',name:'Roadster',description:'Balanced for every course.',speed:1,acceleration:1,handling:1,color:'#ff5748'},
  {id:'sprint',name:'Arrow',description:'Faster straights. Brake earlier for bends.',speed:1.05,acceleration:.92,handling:.95,color:'#28c6e7'},
  {id:'trail',name:'Rover',description:'Quick starts and tighter turns. Less top speed.',speed:.96,acceleration:1.07,handling:1.07,color:'#78d955'},
] as const;
export type KartId=typeof KARTS[number]['id'];
export const kartStats=(id?:KartId)=>KARTS.find(kart=>kart.id===id)??KARTS[0];
export const isKartId=(id:unknown):id is KartId=>KARTS.some(kart=>kart.id===id);
