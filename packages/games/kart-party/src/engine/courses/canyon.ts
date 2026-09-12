import type { CourseDesign } from './spec';

export const CANYON_DESIGN:CourseDesign={
  id:'canyon',title:'Eagle Ridge Cut',
  guide:'Take the narrow left ridge to skip the boulder crossing. Countersteer through gusts; the wide bridge is safer.',
  routes:[{
    id:'eagle-ridge',name:'Eagle Ridge',from:.56,to:.644,width:8,color:'#e9ae69',speed:1.03,grip:.96,
    // Lift falls through the tight apex so the shorter inside line keeps a gentle grade.
    points:[{t:0,offset:0,lift:0},{t:.27,offset:-17,lift:5},{t:.4,offset:-17,lift:3},{t:.52,offset:-17,lift:1},{t:.73,offset:-17,lift:0},{t:1,offset:0,lift:0}],
  }],
  zones:[{id:'ridge-gust',name:'Gorge Crosswind',kind:'wind',routeId:'eagle-ridge',from:.585,to:.613,offset:0,width:8,strength:-3,period:6.4,activeFor:3.4,phase:1.1}],
  gates:[],
};
