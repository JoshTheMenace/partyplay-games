import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGeometry, waterGeometry } from '../src/meshes';
import { W, H, index } from '../src/model';

test('a glass window does not hide the opaque face behind it',()=>{
  const grid=new Uint8Array(W*W*H);grid[index(4,6,4)]=11;grid[index(5,6,4)]=3;
  const glass=chunkGeometry(grid,0,0);assert.equal(glass.index!.count,66);glass.dispose();
  grid[index(4,6,4)]=3;const opaque=chunkGeometry(grid,0,0);assert.equal(opaque.index!.count,60);opaque.dispose();
});
test('water surfaces follow actual top water cells after filling and removing blocks',()=>{
  const grid=new Uint8Array(W*W*H);grid[index(4,5,4)]=grid[index(4,6,4)]=6;
  const water=waterGeometry(grid);assert.equal(water.getAttribute('position').count,6);assert.ok(Math.abs(water.getAttribute('position').getY(0)-6.82)<.00001);water.dispose();
  grid[index(4,6,4)]=3;const filled=waterGeometry(grid);assert.equal(filled.getAttribute('position').count,0);filled.dispose();
  grid[index(4,6,4)]=11;const glassCover=waterGeometry(grid);assert.equal(glassCover.getAttribute('position').count,6);glassCover.dispose();
  grid[index(4,6,4)]=0;const lowered=waterGeometry(grid);assert.equal(lowered.getAttribute('position').count,6);assert.ok(Math.abs(lowered.getAttribute('position').getY(0)-5.82)<.00001);lowered.dispose();
  grid[index(4,5,4)]=0;const empty=waterGeometry(grid);assert.equal(empty.getAttribute('position').count,0);empty.dispose();
});
