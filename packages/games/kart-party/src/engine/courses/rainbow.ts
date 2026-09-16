import type { CourseDesign } from './spec';

export const RAINBOW_DESIGN:CourseDesign={
  id:'rainbow',title:'Starwind Orbit',
  guide:'Take the narrow left orbit above Meteor Sprint. Ride the pulsing star current for speed and steer against its outward wind.',
  routes:[{
    id:'starwind-orbit',name:'Starwind Orbit',from:.85,to:.94,width:9,color:'#ffa5eb',speed:1.08,grip:.94,
    points:[{t:0,offset:0,lift:0},{t:.28,offset:28,lift:7},{t:.72,offset:28,lift:7},{t:1,offset:0,lift:0}],
  }],
  zones:[
    {id:'star-current',name:'Star Current',kind:'conveyor',from:.876,to:.914,offset:0,width:9,routeId:'starwind-orbit',strength:8,period:7,activeFor:3.5,phase:1},
    {id:'solar-wind',name:'Solar Wind',kind:'wind',from:.878,to:.912,offset:0,width:9,routeId:'starwind-orbit',strength:2.4,period:7,activeFor:3.5,phase:1},
  ],gates:[],
};
