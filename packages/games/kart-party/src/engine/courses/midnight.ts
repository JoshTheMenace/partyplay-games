import type { CourseDesign } from './spec';

export const MIDNIGHT_DESIGN:CourseDesign={
  id:'midnight',title:'Neon Freight Express',
  guide:'Take the left freight road to pass delivery traffic. Moving floors build speed; the dispatch gate opens for five seconds out of eight.',
  routes:[{
    id:'freight-express',name:'Freight Express',from:.035,to:.115,width:9,color:'#57eed0',speed:1.04,grip:1,
    points:[{t:0,offset:0,lift:0},{t:.28,offset:24,lift:0},{t:.72,offset:24,lift:0},{t:1,offset:0,lift:0}],
  }],
  zones:[{id:'freight-belt',name:'Freight Conveyor',kind:'conveyor',from:.059,to:.091,offset:0,width:9,routeId:'freight-express',strength:12}],
  gates:[{id:'dispatch-gate',name:'Dispatch Gate',s:.078,offset:0,width:9,height:2.8,period:8,openFor:5,phase:0,routeId:'freight-express',color:'#ffd24a'}],
};
