import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SkinnedMesh, Vector3 } from 'three';
import { Actor, makeCache } from '../src/rig';
import { rules } from '../src/server';
import { getMove, ROSTER, type Move } from '../src/model';
const moves: Move[] = ['jab','side','upper','sweep','smash','upsmash','downsmash','aerial','forwardair','backair','upair','downair','dash','rise','laser','reflect'];
for (const kind of ROSTER) test(`${kind} production actor animates real skin in every move; clones and disposal stay independent`, async () => {
  const bytes = await readFile(new URL(`../assets/${kind}-replacement.glb`, import.meta.url));
  const model = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
  const owned: { dispose(): void }[] = [], cache = makeCache(resource => { owned.push(resource); return resource; });
  const actor = new Actor(kind, '#fff', model, cache), sibling = new Actor(kind, '#000', model, cache);
  assert.deepEqual(actor.rig.missing, []); assert.equal(actor.rig.bones.size, 20);
  const p = rules.create({ roomId: 'r', roundId: 'r', nowMs: 0, seed: 1, players: [{ id: 'p', name: 'P', color: '#fff' }] }, { seconds: 60, stocks: 3 }).players[0];
  p.kind = kind; p.mode = 'attack';
  const world = new Vector3(), rest = sibling.rig.bones.get('hand.R')!.bone.position.clone();
  for (const facing of [-1, 1]) for (const move of moves) {
    p.facing = facing; p.move = move;
    for (const frame of [0, getMove(kind, move).startup, getMove(kind, move).end - 1]) {
      p.moveFrame = frame; actor.update(p, 0, 0, frame / 60, 1 / 60, false, 'fight'); actor.group.updateMatrixWorld(true);
      for (const bone of actor.rig.bones.values()) { bone.bone.getWorldPosition(world); assert.ok(world.toArray().every(Number.isFinite)); }
    }
  }
  assert.deepEqual(sibling.rig.bones.get('hand.R')!.bone.position, rest);
  const skeletons = new Set<SkinnedMesh['skeleton']>(); actor.group.traverse(o => { if (o instanceof SkinnedMesh) skeletons.add(o.skeleton); });
  let disposed = 0; for (const skeleton of skeletons) { const original = skeleton.dispose.bind(skeleton); skeleton.dispose = () => { disposed++; original(); }; }
  actor.dispose(); assert.equal(disposed, skeletons.size);
  sibling.update(p, 0, 0, 1, 1 / 60, true, 'fight'); assert.equal(sibling.group.visible, true); sibling.dispose();
  for (const resource of owned) resource.dispose();
});
