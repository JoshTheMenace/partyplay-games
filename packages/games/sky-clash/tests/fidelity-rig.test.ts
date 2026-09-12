import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyPose, captureRig, poseAt, resetRig } from '../lab/animation';
test('real GLTFLoader names bind every authored limb and poses preserve the exported rest state', async () => {
  const bytes=readFileSync(new URL('../assets/fox-replacement.glb', import.meta.url));
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const rig=captureRig(scene); assert.deepEqual(rig.missing,[]); assert.equal(rig.bones.size,20);
  const hand=rig.bones.get('hand.L')!.bone, rest=hand.getWorldPosition(new Vector3());
  applyPose(rig,poseAt('run',.15,false));scene.updateMatrixWorld(true);
  assert(hand.getWorldPosition(new Vector3()).distanceTo(rest)>.05,'Run pose must move the actual loaded hand');
  resetRig(rig);scene.updateMatrixWorld(true);
  assert(hand.getWorldPosition(new Vector3()).distanceTo(rest)<1e-10);
  assert.deepEqual(poseAt('run',0,true),poseAt('run',100,true));
  assert.deepEqual(poseAt('airborne',0,true),poseAt('airborne',100,true));
});
