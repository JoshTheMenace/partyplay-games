/** Asset-authoring entry only. Bundle separately; never import this into the game catalog. */
import { DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { createStageScene } from '../src/stage-scene';
import { getStage, STAGE_IDS, stageFrame, type StageId } from '../src/stages';
const scene = new Scene(), renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(640,360); renderer.setPixelRatio(1); document.body.style.margin='0'; document.body.append(renderer.domElement);
scene.add(new HemisphereLight('#ffe2bf','#4a3778',1.5));
const sun=new DirectionalLight('#fff1d6',2.3);sun.position.set(6,12,9);scene.add(sun);
const fill=new DirectionalLight('#7fb6ff',.6);fill.position.set(-8,4,6);scene.add(fill);
const camera=new PerspectiveCamera(36,16/9,.1,250);let art: ReturnType<typeof createStageScene> | undefined;
async function renderMap(id:StageId) {
  art?.dispose();art=createStageScene(scene,id);art.update(0,false,true);
  const surfaces=stageFrame(id,0,false).platforms, left=Math.min(...surfaces.map(p=>p.left))-2,right=Math.max(...surfaces.map(p=>p.right))+2,bottom=Math.min(...surfaces.map(p=>p.y))-4,top=Math.max(...surfaces.map(p=>p.y))+4;
  const half=Math.max((top-bottom)/2,(right-left)/2/camera.aspect)*1.06,x=(left+right)/2,y=(bottom+top)/2;
  camera.position.set(x,y,half/Math.tan(Math.PI/10));camera.lookAt(x,y,0);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
  return {id,name:getStage(id).name,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
}
Object.assign(window,{renderMap,mapIds:STAGE_IDS});
