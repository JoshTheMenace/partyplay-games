import type { CourseDesign } from './spec';

export const COAST_DESIGN:CourseDesign={
  id:'coast',title:'Tidal Causeway',
  guide:'Take the left causeway when the tide is low. Sea spray slows the narrow deck; the clifftop stays dry.',
  routes:[{
    id:'tidal-causeway',name:'Tidal Causeway',from:.155,to:.265,width:9.5,color:'#c5b58b',speed:1.2,grip:.9,
    // World-right is screen-left. Long merges keep the lower shelf clear of the harbor jump.
    points:[{t:0,offset:0,lift:0},{t:.3,offset:25,lift:-5},{t:.6,offset:27,lift:-5.8},{t:.75,offset:23,lift:-4},{t:1,offset:0,lift:0}],
  }],
  zones:[{id:'causeway-surge',name:'Tidal wash',kind:'water',routeId:'tidal-causeway',from:.185,to:.235,offset:0,width:9.5,strength:.85,period:22,activeFor:8,phase:2}],
  gates:[],
};
