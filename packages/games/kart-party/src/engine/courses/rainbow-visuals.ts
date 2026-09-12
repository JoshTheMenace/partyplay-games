import * as T from 'three';
import type { Track } from '../tracks';
import { routeSample } from '../course-routes';
import { RAINBOW_DESIGN } from './rainbow';

/** Open orbital arches frame the current without covering the track or magnetic loop. */
export function createRainbowDetails(track:Track){
  const group=new T.Group(),arch=new T.TorusGeometry(7,.18,6,32,Math.PI),star=new T.OctahedronGeometry(.65);
  const pink=new T.MeshBasicMaterial({color:'#ffa5eb'}),cyan=new T.MeshBasicMaterial({color:'#8efaff'});
  for(const s of [.879,.895,.911]){
    const p=routeSample(track,RAINBOW_DESIGN.routes[0],s),portal=new T.Group();portal.position.set(p.x,p.y,p.z);portal.rotation.y=p.heading;
    portal.add(new T.Mesh(arch,pink));
    for(const side of [-1,1]){
      const sparkle=new T.Mesh(star,cyan);sparkle.position.set(side*6.1,3.5,0);portal.add(sparkle);
    }
    group.add(portal);
  }
  return group;
}
