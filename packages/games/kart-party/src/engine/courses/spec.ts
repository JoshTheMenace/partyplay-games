import type { TrackId } from '../types';

/** Branch progress maps to the same mandatory gates as the main course. Endpoints rejoin at offset/lift zero. */
export type RouteSpec = {
  id:string; name:string; from:number; to:number; width:number; color:string;
  points:{t:number;offset:number;lift:number}[];
  speed:number; grip:number;
};
/** Zones use main-course progress, even when attached to a branch. Times are race seconds. */
export type ZoneSpec = {
  id:string; name:string; kind:'water'|'conveyor'|'wind'|'rough'; from:number; to:number;
  offset:number; width:number; routeId?:string; strength:number;
  period?:number; activeFor?:number; phase?:number;
};
export type GateSpec = {
  id:string; name:string; s:number; offset:number; width:number; height:number;
  period:number; openFor:number; phase:number; routeId?:string; color:string;
};
export type CourseDesign = { id:TrackId; title:string; guide:string; routes:RouteSpec[]; zones:ZoneSpec[]; gates:GateSpec[] };
