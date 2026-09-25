"""Checks night-job-kit.glb against DESIGN.md "Asset kit contract". Run: python3 art/check-kit.py (exit 1 on failure)."""
import json, re, struct, sys
from pathlib import Path

GAME = Path(__file__).resolve().parents[1]
GLB = GAME.parents[2] / 'public/games/night-job/models/night-job-kit.glb'
design = (GAME / 'DESIGN.md').read_text().split('## Asset kit contract')[1]
kinds = re.findall(r"'(\w+)'", re.search(r'export type PropKind =([^;]+);', (GAME / 'src/model.ts').read_text()).group(1))
foot = {k: (int(w), int(d)) for k, w, d in re.findall(r'(\w+) (\d)×(\d)', design)}
required = [f'prop_{k}' for k in kinds] + sorted(set(re.findall(r'`((?:obj|thief|guard|civilian|dog|hat)_\w+|bird)`', design)))

data = GLB.read_bytes(); n = struct.unpack('<I', data[12:16])[0]; gltf = json.loads(data[20:20 + n])
acc, errors, total = gltf['accessors'], [], 0
nodes = {node['name']: node for node in gltf['nodes']}
top = {gltf['nodes'][i]['name'] for i in gltf['scenes'][0]['nodes']}
materials = [gltf['meshes'][nd['mesh']]['primitives'][0].get('material') for nd in gltf['nodes'] if 'mesh' in nd]
def fail(msg): errors.append(msg)

print(f'{"node":16} {"tris":>5}   x min..max      y min..max      z min..max')
for name in required:
  node = nodes.get(name)
  if not node: fail(f'missing {name}'); continue
  prims = gltf['meshes'][node['mesh']]['primitives']; p = prims[0]; pos = acc[p['attributes']['POSITION']]
  (x0, y0, z0), (x1, y1, z1) = pos['min'], pos['max']; tris = acc[p['indices']]['count'] // 3; total += tris
  print(f'{name:16} {tris:5}  {x0:6.2f}..{x1:5.2f}   {y0:6.2f}..{y1:5.2f}   {z0:6.2f}..{z1:5.2f}')
  if name not in top or any(k in node for k in ('translation', 'rotation', 'scale', 'matrix', 'children')): fail(f'{name}: not a plain top-level node')
  if len(prims) != 1 or 'COLOR_0' not in p['attributes'] or 'NORMAL' not in p['attributes'] or materials.count(p.get('material')) != 1: fail(f'{name}: needs one primitive with NORMAL, COLOR_0 and its own material')
  near = lambda a, b, tol=.02: abs(a - b) <= tol
  if name.startswith('prop_'):
    w, d = foot.get(name[5:], (1, 1))
    if name == 'prop_painting':
      if not near(z0, 0) or x1 - x0 > 1: fail(f'{name}: should start at the wall face (z=0) and fit one cell')
      continue
    if not (-.001 <= y0 <= .02): fail(f'{name}: should rest on the floor (y0={y0:.3f})')
    if not (.3 * w <= x1 - x0 <= w + .25 and .3 * d <= z1 - z0 <= d + .25): fail(f'{name}: {x1 - x0:.2f}x{z1 - z0:.2f} does not match footprint {w}x{d}')
    if abs(x0 + x1) > .25 * w or abs(z0 + z1) > .3 * d: fail(f'{name}: origin is not at the footprint centre')
    if name == 'prop_rug' and y1 > .0201: fail(f'{name}: taller than 0.02')
  elif name in ('obj_camera', 'obj_laser'):
    if not near(z0, 0) or y0 > 0 or y1 < 0: fail(f'{name}: origin should be at the wall face mount point')
  elif name == 'obj_door':
    if not (near(x0, -.5, .005) and near(x1, .5, .005) and near(y0, 0) and near(y1, 1.45, .01)): fail(f'{name}: slab must span x -0.5..0.5 and be 1.45 tall')
  elif name == 'obj_window':
    if not (near(x0, -.5, .005) and near(x1, .5, .005)): fail(f'{name}: must span x -0.5..0.5')
  elif name in ('obj_ledger', 'obj_jewel', 'obj_manifest'):
    if not near(y0, .75, .005) or max(x1 - x0, z1 - z0) > .56: fail(f'{name}: must sit on the pedestal top at y=0.75')
  elif name == 'obj_pedestal':
    if not near(y1, .75, .005): fail(f'{name}: top must be at y=0.75')
  elif name == 'obj_coin':
    if not near(x1 - x0, .22, .005): fail(f'{name}: must be 0.22 wide')
  elif name.split('_')[0] in ('thief', 'guard', 'civilian', 'hat') and name != 'thief_leg':
    if y1 > 1.05 or abs(x0 + x1) > .1: fail(f'{name}: character part should be centred and under 1.05 tall')
  elif name in ('thief_leg', 'dog_leg'):
    if not near(y1, 0, .01): fail(f'{name}: origin should be at the hip joint (top)')
  elif not (-.001 <= y0 <= .02) and name not in ('bird', 'dog_body'): fail(f'{name}: should rest on the floor')
extra = set(nodes) - set(required)
size = GLB.stat().st_size
print(f'\n{len(required)} required nodes, {len(extra)} extra {sorted(extra) if extra else ""}, {total} triangles, {size / 1024:.0f} KiB')
if total > 60000: fail(f'{total} triangles > 60k')
if size > 1_500_000: fail(f'{size} bytes > 1.5 MB')
print('\n'.join(['FAIL ' + e for e in errors]) or 'OK: kit matches the contract')
sys.exit(1 if errors else 0)
