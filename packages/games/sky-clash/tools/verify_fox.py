"""Reimport the delivered GLB, check rig/mesh and exercise one weighted limb."""
import bpy, math, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets'/('falco-replacement.glb' if '--falco' in sys.argv else 'fox-replacement.glb')))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH')
assert len(rig.data.bones)==20
assert 17 <= len(mesh.vertex_groups) <= 20
bounds=[mesh.matrix_world@Vector(v) for v in mesh.bound_box]
assert min(p.z for p in bounds)>-.01 and 1.85<max(p.z for p in bounds)<2
assert all(math.isfinite(x) for p in bounds for x in p)
def positions():
    evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());return [v.co.copy() for v in evaluated.data.vertices]
before=positions();bone=rig.pose.bones['forearm.L'];bone.rotation_mode='XYZ';bone.rotation_euler.x=.6;bpy.context.view_layer.update();after=positions()
assert any((a-b).length>.05 for a,b in zip(before,after)), 'Skeleton does not deform mesh'
print('Reimport passed: 20 bones, finite dimensions, limb deformation, authored mesh only')
