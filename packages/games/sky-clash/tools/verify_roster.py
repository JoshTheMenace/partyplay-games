"""Reimport all shipped GLBs, validate rigs/geometry, render a review contact sheet."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'assets';roster=json.loads((ROOT/'fidelity/roster.json').read_text());results=[]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for index,r in enumerate(roster):
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(OUT/(r['id']+'-replacement.glb')));objects=set(bpy.data.objects)-before
 rigs=[o for o in objects if o.type=='ARMATURE'];meshes=[o for o in objects if o.type=='MESH' and o.vertex_groups];assert len(rigs)==1,r['id'];assert len(rigs[0].data.bones)==20,r['id'];assert meshes
 bpy.context.view_layer.update()
 evaluated=[o.evaluated_get(bpy.context.evaluated_depsgraph_get()) for o in meshes]
 vertices=[o.matrix_world@v.co for o in evaluated for v in o.data.vertices];assert all(all(math.isfinite(x) for x in v) for v in vertices)
 height=max(v.z for v in vertices)-min(v.z for v in vertices);assert r['height']*.75<height<r['height']*1.2,(r['id'],height)
 assert all(sum(g.weight for g in v.groups)>.99 for o in meshes for v in o.data.vertices),(r['id'],'unweighted')
 results.append({'kind':r['id'],'bones':20,'height':round(height,3),'vertices':len(vertices),'bytes':(OUT/(r['id']+'-replacement.glb')).stat().st_size})
 # Arrange normalized models in six columns; presentation only, not exported assets.
 root=bpy.data.objects.new(r['id']+'ReviewRoot',None);bpy.context.collection.objects.link(root)
 for o in objects:
  if not o.parent:o.parent=root
 root.scale=(1.65/r['height'],)*3;root.location=((index%6-2.5)*2.15,0,(5-index//6)*2.25)
 bpy.ops.object.text_add(location=(root.location.x,-.45,root.location.z-.20));label=bpy.context.object;label.data.body=r['name'];label.data.align_x='CENTER';label.data.size=.13;label.rotation_euler=(math.pi/2,0,0)
scene=bpy.context.scene;scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.035,.045,.075,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
for name,pos,power in [('Key',(-4,-7,12),1800),('Fill',(5,-4,7),1200)]:
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.size=8;o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,6))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(.5,-26,7.5));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,6.1))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=14;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16;scene.render.resolution_x=1500;scene.render.resolution_y=1500;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'roster-review.png');bpy.ops.render.render(write_still=True)
(OUT/'roster-verification.json').write_text(json.dumps({'models':results,'totalBytes':sum(r['bytes'] for r in results),'originalAssets':False},indent=2)+'\n')
print('VERIFIED',len(results),'models',sum(r['bytes'] for r in results),'bytes')
