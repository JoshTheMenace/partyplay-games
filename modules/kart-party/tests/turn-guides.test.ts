import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from 'three';
import { createTurnGuides } from '../game/turn-guides';
import { TRACKS } from '../game/tracks';

void test('every course receives one batched backing, arrow, and post mesh for its strongest turns',()=>{
  for(const track of Object.values(TRACKS)){
    const guides=createTurnGuides(track);assert.equal(guides.name,'turn-guides');assert.equal(guides.children.length,3,track.id);
    assert.ok(guides.children.every(child=>child instanceof Mesh&&child.geometry.attributes.position.count>0),track.id);
  }
});
