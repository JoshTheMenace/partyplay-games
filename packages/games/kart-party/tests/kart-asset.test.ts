import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type GlbNode={name?:string;children?:number[];translation?:number[]};
type GlbJson={nodes:(GlbNode&{mesh?:number})[];materials?:{name?:string}[];meshes?:{primitives:{attributes:{POSITION:number}}[]}[];accessors?:{count:number}[]};

function readAsset(name:string):{bytes:Buffer;json:GlbJson}{
  const bytes=readFileSync(new URL(`../../../../public/games/kart-party/models/${name}`,import.meta.url));
  assert.equal(bytes.toString('ascii',0,4),'glTF');const jsonLength=bytes.readUInt32LE(12);
  return {bytes,json:JSON.parse(bytes.subarray(20,20+jsonLength).toString()) as GlbJson};
}

function readGlbJson():{bytes:number;json:GlbJson}{
  const asset=readAsset('kart_chassis.glb');return {bytes:asset.bytes.length,json:asset.json};
}

test('authored kart keeps its chassis, steering, and wheel animation anchors intact',()=>{
  const {bytes,json}=readGlbJson(),byName=new Map(json.nodes.map((node,index)=>[node.name,{...node,index}]));
  const root=byName.get('KartChassis'),body=byName.get('KartBody');
  assert.ok(root&&body);
  assert.ok(root.children?.includes(body.index));
  for(const name of ['WheelFLPivot','WheelFRPivot','WheelFLSpin','WheelFRSpin','WheelRLSpin','WheelRRSpin','SteeringPivot'])assert.ok(byName.has(name),`${name} is missing`);

  const left=byName.get('WheelFLPivot')?.translation,right=byName.get('WheelFRPivot')?.translation;
  assert.ok(left&&right&&left[0]<0&&right[0]>0);
  assert.equal(left[1],right[1]);
  assert.equal(left[2],right[2]);
  assert.ok(json.materials?.some(material=>material.name==='KartPaint'));
  assert.ok(json.materials?.some(material=>material.name==='KartPaintDark'));
  assert.ok((json.meshes?.length??0)<=12);
  for(const name of ['WheelFL','WheelFR','WheelRL','WheelRR']){
    const wheel=byName.get(name),mesh=wheel?.mesh===undefined?undefined:json.meshes?.[wheel.mesh];
    assert.ok(mesh?.primitives.some(primitive=>(json.accessors?.[primitive.attributes.POSITION]?.count??0)>3_000),`${name} has no modeled tread surface`);
  }
  assert.ok(bytes<950_000,`kart GLB grew to ${bytes} bytes`);
});

test('Seabreeze reference pack keeps the reusable harbor and lighthouse kit compact',()=>{
  const {bytes,json}=readAsset('seabreeze_reference.glb'),names=new Set(json.nodes.map(node=>node.name));
  for(const name of ['SeabreezeReferenceKit','PalmA','PalmB','PalmC','CliffA','CliffB','CliffC','HarborHouseA','HarborHouseB','HarborDock','HarborCrane','ContainerCoral','ContainerTeal','Lighthouse'])assert.ok(names.has(name),`${name} is missing`);
  const triangles=json.meshes?.flatMap(mesh=>mesh.primitives).reduce((sum,primitive)=>sum+(json.accessors?.[primitive.attributes.POSITION]?.count??0),0)??0;
  assert.ok(triangles<20_000,`Seabreeze kit grew to ${triangles} stored vertices`);
  assert.ok((json.materials?.length??0)<=14,`Seabreeze kit grew to ${json.materials?.length} materials`);
  assert.ok(bytes.length<750_000,`Seabreeze kit grew to ${bytes.length} bytes`);
});

test('authored driver exposes every part needed to keep both hands on the steering wheel',()=>{
  const bytes=readFileSync(new URL('../../../../public/games/kart-party/models/kart_driver.glb',import.meta.url)),jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonLength).toString()) as GlbJson;
  const names=new Set(json.nodes.map(node=>node.name));
  for(const name of ['KartDriver','DriverBody','DriverHeadPivot','DriverUpperArmL','DriverForearmL','DriverHandL','DriverUpperArmR','DriverForearmR','DriverHandR'])assert.ok(names.has(name),`${name} is missing`);
  assert.ok(json.materials?.some(material=>material.name==='DriverSuit'));
  assert.ok(json.materials?.some(material=>material.name==='DriverFur'));
  assert.ok(bytes.length<200_000,`driver GLB grew to ${bytes.length} bytes`);
});
