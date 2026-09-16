"""Extract the 18 animal-rig meshes from PR #1's self-contained Blender GLB.

Usage: python3 extract_characters.py original.glb output.glb
Preserves mesh data, materials and node transforms without re-exporting artwork.
"""
import json
import struct
import sys
from pathlib import Path

source, target = map(Path, sys.argv[1:])
data = source.read_bytes()
json_size = struct.unpack_from('<I', data, 12)[0]
gltf = json.loads(data[20:20 + json_size])
binary = data[28 + json_size:]
names = {f'{animal}_{part}' for animal in ['cat', 'dog', 'iguana', 'axolotl'] for part in ['body', 'color', 'left_hand', 'right_hand']} | {'chef_left_foot', 'chef_right_foot'}
assert not any(key in gltf for key in ['animations', 'skins', 'images', 'textures'])
assert all('children' not in node for node in gltf['nodes'])
nodes = [node for node in gltf['nodes'] if node['name'] in names]
assert {node['name'] for node in nodes} == names
mesh_ids = sorted({node['mesh'] for node in nodes})
meshes = [gltf['meshes'][i] for i in mesh_ids]
primitives = [primitive for mesh in meshes for primitive in mesh['primitives']]
accessor_ids = sorted({i for primitive in primitives for i in [*primitive['attributes'].values(), primitive['indices']]})
accessors = [gltf['accessors'][i] for i in accessor_ids]
assert all('sparse' not in accessor for accessor in accessors)
view_ids = sorted({accessor['bufferView'] for accessor in accessors})
views = [gltf['bufferViews'][i] for i in view_ids]
material_ids = sorted({primitive['material'] for primitive in primitives})
packed = bytearray()
for view in views:
    packed.extend(b'\0' * (-len(packed) % 4))
    start = view.get('byteOffset', 0)
    chunk = binary[start:start + view['byteLength']]
    assert len(chunk) == view['byteLength'] and view['buffer'] == 0
    view['byteOffset'] = len(packed)
    packed.extend(chunk)
for node in nodes:
    node['mesh'] = mesh_ids.index(node['mesh'])
for primitive in primitives:
    primitive['attributes'] = {key: accessor_ids.index(value) for key, value in primitive['attributes'].items()}
    primitive['indices'] = accessor_ids.index(primitive['indices'])
    primitive['material'] = material_ids.index(primitive['material'])
for accessor in accessors:
    accessor['bufferView'] = view_ids.index(accessor['bufferView'])
gltf.update(scene=0, scenes=[{'nodes': list(range(len(nodes)))}], nodes=nodes, meshes=meshes, accessors=accessors, bufferViews=views, materials=[gltf['materials'][i] for i in material_ids], buffers=[{'byteLength': len(packed)}])
encoded = json.dumps(gltf, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 4)
packed.extend(b'\0' * (-len(packed) % 4))
target.write_bytes(struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(packed)) + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + struct.pack('<II', len(packed), 0x004E4942) + packed)
print(f'{len(nodes)} meshes, {len(data):,} → {target.stat().st_size:,} bytes')
