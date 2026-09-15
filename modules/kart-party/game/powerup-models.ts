import * as T from 'three';
import { disposeObject } from './dispose';
import type { Item } from './types';

const POWERUP_IDS:readonly Item[]=['boost','shell','banana','shield','pulse','triple','oil','frost','magnet','star','rocket','decoy'];
type PickupId='field_coin'|'item_box';
let library:T.Object3D|null=null;
let pickupLibrary:T.Object3D|null=null;
let kartLibrary:T.Object3D|null=null;
let driverLibrary:T.Object3D|null=null;
let sceneryLibrary:T.Object3D|null=null;
let templates:Map<Item,T.Object3D>|null=null;
let pickupTemplates:Map<PickupId,T.Object3D>|null=null;
let sceneryTemplates:Map<string,T.Object3D>|null=null;
let kartTemplate:T.Object3D|null=null;
let driverTemplate:T.Object3D|null=null;
let loading:Promise<void>|null=null;
let loadingSignal:AbortSignal|null=null;
let preparation={milliseconds:0,bytes:0,files:0};

async function loadPack(assetBase:string,file:string,signal:AbortSignal){
  const response=await fetch(new URL(`models/${file}`,new URL(assetBase,window.location.href)),{signal});
  if(!response.ok)throw new Error(`Kart Party model pack ${file} failed to load (${response.status}).`);
  const data=await response.arrayBuffer();signal.throwIfAborted();
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const gltf=await new GLTFLoader().parseAsync(data,assetBase+'models/');
  if(signal.aborted){disposeObject(gltf.scene);signal.throwIfAborted();}
  gltf.scene.userData.downloadBytes=data.byteLength;
  return gltf.scene;
}

/** Load shared held-powerup and course-pickup packs before the race scene mounts. */
export function preparePowerupModels(assetBase:string,signal:AbortSignal):Promise<void>{
  if(templates&&pickupTemplates&&kartTemplate&&driverTemplate&&sceneryTemplates)return Promise.resolve();
  // A load started for a round that has since been abandoned cannot serve the next round's request.
  if(loading&&!loadingSignal?.aborted)return loading;
  loadingSignal=signal;
  const began=performance.now();
  const current:Promise<void>=(async()=>{
    // Settled rather than all, so packs that did load are released when a sibling fails or the round is abandoned.
    const files=['kart_powerups.glb','kart_pickups.glb','kart_chassis.glb','kart_driver.glb','seabreeze_reference.glb'];
    const settled=await Promise.allSettled(files.map(file=>loadPack(assetBase,file,signal)));
    const failure=settled.find((result):result is PromiseRejectedResult=>result.status==='rejected');
    if(failure){for(const result of settled)if(result.status==='fulfilled')disposeObject(result.value);throw failure.reason;}
    const [powerupScene,pickupScene,kartScene,driverScene,sceneryScene]=settled.map(result=>(result as PromiseFulfilledResult<T.Group>).value);
    const pack=powerupScene.getObjectByName('KartPowerups'),pickups=pickupScene.getObjectByName('KartPickups'),kart=kartScene.getObjectByName('KartChassis'),driver=driverScene.getObjectByName('KartDriver'),scenery=sceneryScene.getObjectByName('SeabreezeReferenceKit');
    const disposePacks=()=>{disposeObject(powerupScene);disposeObject(pickupScene);disposeObject(kartScene);disposeObject(driverScene);disposeObject(sceneryScene);};
    if(!pack||!pickups||!kart||!driver||!scenery){disposePacks();throw new Error('Kart Party model packs are missing their named roots.');}
    const next=new Map<Item,T.Object3D>();
    for(const id of POWERUP_IDS){const model=pack.getObjectByName(id);if(!model){disposePacks();throw new Error(`Kart Party powerup model pack is missing ${id}.`);}next.set(id,model);}
    const nextPickups=new Map<PickupId,T.Object3D>();
    for(const id of ['field_coin','item_box'] as const){const model=pickups.getObjectByName(id);if(!model){disposePacks();throw new Error(`Kart Party pickup model pack is missing ${id}.`);}nextPickups.set(id,model);}
    for(const name of ['KartBody','WheelFLPivot','WheelFRPivot','WheelFLSpin','WheelFRSpin','WheelRLSpin','WheelRRSpin','SteeringPivot'])if(!kart.getObjectByName(name)){disposePacks();throw new Error(`Kart Party chassis is missing ${name}.`);}
    for(const name of ['DriverBody','DriverHeadPivot','DriverUpperArmL','DriverForearmL','DriverHandL','DriverUpperArmR','DriverForearmR','DriverHandR'])if(!driver.getObjectByName(name)){disposePacks();throw new Error(`Kart Party driver is missing ${name}.`);}
    const nextScenery=new Map<string,T.Object3D>();
    for(const name of ['PalmA','PalmB','PalmC','CliffA','CliffB','CliffC','HarborHouseA','HarborHouseB','HarborDock','HarborCrane','ContainerCoral','ContainerTeal','Lighthouse']){const model=scenery.getObjectByName(name);if(!model){disposePacks();throw new Error(`Kart Party Seabreeze pack is missing ${name}.`);}nextScenery.set(name,model);}
    library=powerupScene;pickupLibrary=pickupScene;kartLibrary=kartScene;driverLibrary=driverScene;sceneryLibrary=sceneryScene;templates=next;pickupTemplates=nextPickups;sceneryTemplates=nextScenery;kartTemplate=kart;driverTemplate=driver;
    preparation={milliseconds:performance.now()-began,bytes:[powerupScene,pickupScene,kartScene,driverScene,sceneryScene].reduce((sum,scene)=>sum+(scene.userData.downloadBytes as number||0),0),files:files.length};
  })().finally(()=>{if(loading===current){loading=null;loadingSignal=null;}});
  loading=current;
  return current;
}

export function kartModelPreparationMetrics(){return {...preparation};}

export type KartChassisModel={body:T.Object3D;wheelRoots:T.Object3D[];wheels:T.Object3D[];frontWheels:T.Group[];steer:T.Group};
/** Clone the authored chassis and expose only stable animation hooks to the procedural mascot adapter. */
export function createKartChassisModel(color:string):KartChassisModel|null{
  if(!kartTemplate){console.warn('[Kart Party] The authored kart chassis was not prepared.');return null;}
  const clone=kartTemplate.clone(true),paint=new T.Color(color),dark=paint.clone().multiplyScalar(.38);
  clone.traverse(object=>{if(!(object instanceof T.Mesh))return;object.geometry=object.geometry.clone();const materials=(Array.isArray(object.material)?object.material:[object.material]).map(source=>{const material=source.clone();if(material instanceof T.MeshStandardMaterial){if(material.name==='KartPaint')material.color.copy(paint);if(material.name==='KartPaintDark')material.color.copy(dark);}return material;});object.material=Array.isArray(object.material)?materials:materials[0];object.castShadow=true;object.receiveShadow=true;});
  const body=clone.getObjectByName('KartBody')!,frontWheels=['WheelFLPivot','WheelFRPivot'].map(name=>clone.getObjectByName(name) as T.Group),rearWheels=['WheelRLSpin','WheelRRSpin'].map(name=>clone.getObjectByName(name)!),wheels=['WheelFLSpin','WheelFRSpin','WheelRLSpin','WheelRRSpin'].map(name=>clone.getObjectByName(name)!),steer=clone.getObjectByName('SteeringPivot') as T.Group;
  const wheelRoots:T.Object3D[]=[...frontWheels,...rearWheels];body.removeFromParent();for(const root of wheelRoots)root.removeFromParent();
  return {body,wheelRoots,wheels,frontWheels,steer};
}

export type KartDriverModel={
  root:T.Object3D;head:T.Group;
  arms:[{upper:T.Object3D;forearm:T.Object3D;hand:T.Object3D},{upper:T.Object3D;forearm:T.Object3D;hand:T.Object3D}];
};
/** Clone and recolor the authored Kartling while retaining its runtime articulation hooks. */
export function createKartDriverModel(color:string,accent:string,animal:string):KartDriverModel|null{
  // Splash is the reference shared-body variant for this checkpoint. The existing procedural
  // penguin keeps the same seated/steering contract while the remaining authored heads are built.
  if(animal==='penguin')return null;
  if(!driverTemplate){console.warn('[Kart Party] The authored kart driver was not prepared.');return null;}
  const clone=driverTemplate.clone(true),suit=new T.Color(color),fur=new T.Color(accent);
  clone.traverse(object=>{if(!(object instanceof T.Mesh))return;object.geometry=object.geometry.clone();const materials=(Array.isArray(object.material)?object.material:[object.material]).map(source=>{const material=source.clone();if(material instanceof T.MeshStandardMaterial){if(material.name==='DriverSuit')material.color.copy(suit);if(material.name==='DriverFur')material.color.copy(fur);}return material;});object.material=Array.isArray(object.material)?materials:materials[0];object.castShadow=true;object.receiveShadow=true;});
  const part=(name:string)=>clone.getObjectByName(name)!;
  return {root:clone,head:part('DriverHeadPivot') as T.Group,arms:[{upper:part('DriverUpperArmL'),forearm:part('DriverForearmL'),hand:part('DriverHandL')},{upper:part('DriverUpperArmR'),forearm:part('DriverForearmR'),hand:part('DriverHandR')}]};
}

/** Each kart owns its clone, including geometry and materials, so normal scene disposal stays safe. */
export function createHeldPowerupModel(item:Item):T.Object3D|null{
  const source=templates?.get(item);if(!source){console.warn(`[Kart Party] No loaded model for held powerup ${item}.`);return null;}
  const clone=source.clone(true);
  clone.traverse(object=>{if(!(object instanceof T.Mesh))return;object.geometry=object.geometry.clone();object.material=Array.isArray(object.material)?object.material.map(material=>material.clone()):object.material.clone();object.castShadow=true;object.receiveShadow=true;});
  return clone;
}

export type SceneryTransform={position:[number,number,number];rotation?:[number,number,number];scale?:[number,number,number]};
/** Build one spatially bounded batch per authored material layer, sharing it across repeated scenery. */
export function createSceneryInstances(name:string,transforms:SceneryTransform[]):T.Group|null{
  const source=sceneryTemplates?.get(name);if(!source)return null;
  source.updateWorldMatrix(true,true);const inverse=source.matrixWorld.clone().invert(),group=new T.Group(),dummy=new T.Object3D(),composed=new T.Matrix4();group.name=`${name}-instances`;
  source.traverse(object=>{if(!(object instanceof T.Mesh))return;const material=Array.isArray(object.material)?object.material.map(value=>value.clone()):object.material.clone(),mesh=new T.InstancedMesh(object.geometry.clone(),material,transforms.length),local=inverse.clone().multiply(object.matrixWorld);
    transforms.forEach((value,index)=>{dummy.position.fromArray(value.position);dummy.rotation.set(...(value.rotation??[0,0,0]));dummy.scale.fromArray(value.scale??[1,1,1]);dummy.updateMatrix();mesh.setMatrixAt(index,composed.multiplyMatrices(dummy.matrix,local));});mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);
  });return group;
}

export function createSceneryModel(name:string):T.Object3D|null{
  const source=sceneryTemplates?.get(name);if(!source)return null;const clone=source.clone(true);
  clone.traverse(object=>{if(!(object instanceof T.Mesh))return;object.geometry=object.geometry.clone();object.material=Array.isArray(object.material)?object.material.map(value=>value.clone()):object.material.clone();object.receiveShadow=true;});return clone;
}

export type PickupInstances={group:T.Group;setMatrixAt(index:number,matrix:T.Matrix4):void;commit(computeBounds?:boolean):void};

function fallbackPickup(id:PickupId):T.Object3D{
  const group=new T.Group();group.name=id;
  if(id==='field_coin'){
    const coin=new T.Mesh(new T.CylinderGeometry(.62,.62,.18,24),new T.MeshStandardMaterial({color:0xffa309,metalness:.2,roughness:.32}));
    coin.rotation.x=Math.PI/2;coin.name='field_coin_fallback';group.add(coin);
  }else{
    const box=new T.Mesh(new T.BoxGeometry(1.65,1.65,1.65),new T.MeshStandardMaterial({color:0x14b8e6,metalness:.18,roughness:.25}));
    box.name='item_box_fallback';group.add(box);
  }
  return group;
}

/** Clone each material layer once, then instance it across every course pickup. */
export function createPickupInstances(id:PickupId,count:number):PickupInstances{
  const prepared=pickupTemplates?.get(id),source=prepared??fallbackPickup(id);
  source.updateWorldMatrix(true,true);const inverse=source.matrixWorld.clone().invert(),group=new T.Group(),layers:{mesh:T.InstancedMesh;local:T.Matrix4}[]=[];group.name=`${id}-instances`;
  source.traverse(object=>{if(!(object instanceof T.Mesh))return;const material=Array.isArray(object.material)?object.material.map(value=>value.clone()):object.material.clone();
    const mesh=new T.InstancedMesh(object.geometry.clone(),material,count);mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    layers.push({mesh,local:inverse.clone().multiply(object.matrixWorld)});group.add(mesh);
  });
  if(!prepared)disposeObject(source);
  // setMatrixAt copies into the instance buffer, so one scratch matrix serves every layer and instance.
  const composed=new T.Matrix4();
  return {group,setMatrixAt(index,matrix){for(const layer of layers)layer.mesh.setMatrixAt(index,composed.multiplyMatrices(matrix,layer.local));},commit(computeBounds=false){for(const layer of layers){layer.mesh.instanceMatrix.needsUpdate=true;if(computeBounds)layer.mesh.computeBoundingSphere();}}};
}

export type CoinPose={position:T.Vector3;quaternion:T.Quaternion};
/* Coins never move along the road. Their surface poses are fixed when the world is built, the spin is
 * shared by every camera in a frame, and only which coins a viewer has taken differs per camera — so
 * the per-camera pass is a copy, not a surface-frame solve for every coin. */
export function createCoinViews(instances:PickupInstances,poses:CoinPose[],spin=.8){
  const dummy=new T.Object3D(),shown=poses.map(()=>new T.Matrix4()),hidden=poses.map(pose=>new T.Matrix4().makeScale(0,0,0).setPosition(pose.position));let spunAt=NaN;
  return (time:number,taken:(index:number)=>boolean)=>{
    if(spunAt!==time){spunAt=time;poses.forEach((pose,index)=>{dummy.position.copy(pose.position);dummy.quaternion.copy(pose.quaternion);dummy.rotateY(time*spin);dummy.scale.setScalar(1);dummy.updateMatrix();shown[index].copy(dummy.matrix);});}
    for(let index=0;index<poses.length;index++)instances.setMatrixAt(index,taken(index)?hidden[index]:shown[index]);
    instances.commit();
  };
}

export function disposePowerupModels(){
  if(library)disposeObject(library);if(pickupLibrary)disposeObject(pickupLibrary);if(kartLibrary)disposeObject(kartLibrary);if(driverLibrary)disposeObject(driverLibrary);if(sceneryLibrary)disposeObject(sceneryLibrary);
  library=null;pickupLibrary=null;kartLibrary=null;driverLibrary=null;sceneryLibrary=null;templates=null;pickupTemplates=null;sceneryTemplates=null;kartTemplate=null;driverTemplate=null;loading=null;preparation={milliseconds:0,bytes:0,files:0};
}
