"""Authored replacement mesh, not a recovered Nintendo asset. Blender 5.2 CLI."""
import bpy, json, math, sys
from pathlib import Path
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets'
BIRD = '--falco' in sys.argv
NAME = 'falco' if BIRD else 'fox'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
materials = {}
for name, color, metal in [('fur', 'C66A2C', 0), ('cream', 'F4DCB2', 0), ('jacket', '35685D', .1), ('trim', '95B9A8', .1), ('armor', 'DDE7E5', .45), ('dark', '23333F', .15), ('boots', '7C969F', .65), ('scarf', 'DA4337', 0), ('nose', '18202D', .1), ('eye', '34C6BC', .1), ('white', 'FFFFFF', 0), ('gold', 'F4BB50', .5)]:
    if BIRD: color = {'fur':'3979BC','cream':'9AC8E8','jacket':'AA3038','scarf':'E1BB50','armor':'DFE7EC','eye':'F0B72E'}.get(name,color)
    m = bpy.data.materials.new(name); m.diffuse_color = (*[((int(color[i:i+2],16)/255+.055)/1.055)**2.4 for i in (0,2,4)],1)
    m.use_nodes = True; bs = m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=m.diffuse_color; bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=.62 if not metal else .35
    materials[name]=m
parts=[]
def finish(obj, name, material, bone):
    obj.name=name; obj.data.materials.append(materials[material]); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    parts.append((obj,bone)); return obj

def ellipsoid(name, pos, scale, material, bone, segments=24, rings=14):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=pos)
    obj=bpy.context.object; obj.scale=scale
    for p in obj.data.polygons: p.use_smooth=True
    return finish(obj,name,material,bone)

def box(name, pos, scale, material, bone, bevel=.035):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos); obj=bpy.context.object; obj.scale=scale
    finish(obj,name,material,bone)
    if bevel:
        mod=obj.modifiers.new('Soft manufactured edges','BEVEL'); mod.width=bevel; mod.segments=3
        bpy.context.view_layer.objects.active=obj; bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

def limb(name, start, end, r1, r2, material, bone, vertices=16):
    a,b=Vector(start),Vector(end); bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r1,radius2=r2,depth=(b-a).length,location=(a+b)/2)
    obj=bpy.context.object; obj.rotation_mode='QUATERNION'; obj.rotation_quaternion=(b-a).to_track_quat('Z','Y')
    for p in obj.data.polygons: p.use_smooth=len(p.vertices)==4
    return finish(obj,name,material,bone)

def prism(name, points, depth, material, bone):
    verts=[(x,y+d,z) for d in (-depth/2,depth/2) for x,y,z in points]; n=len(points)
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    return finish(obj,name,material,bone)

# Blender Z up, -Y forward; export yields glTF Y up, +Z forward. Height ~1.9 m.
ellipsoid('Flight trousers',(0,0,.76),(.24,.15,.2),'dark','pelvis')
ellipsoid('Flight jacket',(0,0,1.08),(.30,.19,.33),'jacket','chest')
box('Chest armor',(0,-.174,1.13),(.43,.075,.29),'armor','chest')
box('Zipper',(0,-.211,1.15),(.026,.012,.3),'dark','chest',.006)
box('Utility belt',(0,-.025,.86),(.46,.3,.075),'dark','pelvis',.02)
box('Buckle',(0,-.185,.86),(.09,.035,.065),'gold','pelvis',.012)
box('Flight badge',(-.105,-.22,1.2),(.09,.025,.045),'gold','chest',.008)
limb('Collar',(0,0,1.31),(0,0,1.43),.16,.14,'scarf','neck',12)
prism('Scarf end',[(-.035,-.2,1.35),(.11,-.21,1.34),(.22,-.20,1.12),(.07,-.20,1.19)],.035,'scarf','chest')
ellipsoid('Head',(0,-.025,1.59),(.225,.185,.22),'fur','head')
if BIRD:
    prism('Beak', [(-.105,-.18,1.56),(0,-.43,1.52),(.105,-.18,1.56)],.09,'gold','head')
    box('Beak seam',(0,-.30,1.495),(.11,.14,.009),'dark','head',.003)
    for i in range(4):
        prism('Swept crest '+str(i),[(-.07+i*.035,.04,1.70),(-.05+i*.035,.10,1.94),(-.04+i*.035,.25,1.73)],.045,'fur','head')
else:
    ellipsoid('Cheek left',(-.15,-.14,1.52),(.13,.10,.09),'cream','head')
    ellipsoid('Cheek right',(.15,-.14,1.52),(.13,.10,.09),'cream','head')
    ellipsoid('Muzzle',(0,-.225,1.54),(.126,.15,.081),'cream','head')
    ellipsoid('Nose',(0,-.363,1.564),(.053,.029,.035),'nose','head',12,6)
    box('Mouth',(0,-.319,1.494),(.106,.017,.01),'dark','head',.004)
for side in (-1,1):
    suffix='L' if side>0 else 'R'; x=side
    if not BIRD:
        prism('Ear '+suffix,[(x*.07,-.015,1.71),(x*.22,.005,1.92),(x*.25,.0,1.68)],.08,'fur','head')
        prism('Inner ear '+suffix,[(x*.108,-.063,1.722),(x*.208,-.042,1.875),(x*.222,-.05,1.71)],.012,'dark','head')
    ellipsoid('Eye white '+suffix,(x*.126,-.188,1.625),(.078,.028,.043),'white','head')
    ellipsoid('Iris '+suffix,(x*.119,-.214,1.625),(.027,.012,.034),'eye','head',12,6)
    ellipsoid('Pupil '+suffix,(x*.119,-.225,1.625),(.013,.008,.025),'nose','head',10,6)
    ellipsoid('Eye glint '+suffix,(x*.11,-.232,1.639),(.008,.004,.009),'white','head',8,4)
    brow=box('Brow '+suffix,(x*.131,-.195,1.676),(.15,.039,.025),'fur','head',.008);brow.rotation_euler.y=side*-.12
    ellipsoid('Headset '+suffix,(x*.229,-.013,1.57),(.035,.077,.075),'dark','head')
    ellipsoid('Headset rim '+suffix,(x*.259,-.013,1.57),(.013,.044,.044),'boots','head')
    shoulder=(x*.27,0,1.26); elbow=(x*.405,-.015,1.02); wrist=(x*.49,-.04,.83)
    limb('Jacket sleeve '+suffix,shoulder,elbow,.117,.096,'jacket','upper_arm.'+suffix)
    ellipsoid('Shoulder shell '+suffix,shoulder,(.135,.16,.12),'armor','upper_arm.'+suffix)
    ellipsoid('Elbow '+suffix,elbow,(.084,.085,.08),'dark','forearm.'+suffix)
    limb('Gauntlet '+suffix,elbow,wrist,.10,.074,'armor','forearm.'+suffix)
    box('Cuff stripe '+suffix,(x*.47,-.115,.91),(.10,.04,.04),'scarf','forearm.'+suffix,.01)
    ellipsoid('Glove '+suffix,(x*.50,-.053,.775),(.079,.069,.092),'dark','hand.'+suffix)
    ellipsoid('Thumb '+suffix,(x*.447,-.107,.793),(.035,.04,.058),'dark','hand.'+suffix,12,6)
    hip=(x*.14,0,.77); knee=(x*.18,-.01,.45); ankle=(x*.20,.0,.16)
    limb('Thigh '+suffix,hip,knee,.118,.099,'jacket','thigh.'+suffix)
    ellipsoid('Knee cap '+suffix,(x*.18,-.087,.46),(.099,.056,.10),'armor','shin.'+suffix)
    limb('Boot shaft '+suffix,ankle,knee,.105,.096,'boots','shin.'+suffix)
    box('Boot toe '+suffix,(x*.20,-.09,.10),(.22,.37,.15),'boots','foot.'+suffix,.045)
    box('Boot sole '+suffix,(x*.20,-.09,.03),(.23,.38,.055),'dark','foot.'+suffix,.015)
    box('Boot latch '+suffix,(x*.20,-.105,.27),(.13,.05,.04),'gold','shin.'+suffix,.008)
limb('Microphone',( .25,-.02,1.56),(.21,-.25,1.5),.012,.012,'dark','head',8)
ellipsoid('Mic tip',(.21,-.25,1.5),(.026,.025,.018),'dark','head',10,6)
if BIRD:
    for side in (-1,0,1):
        prism('Tail feather '+str(side),[(side*.06,.18,.86),(side*.11,.60,.65),(side*.06,.39,.83)],.05,'fur','tail.01')
else:
    limb('Tail base',(0,.10,.86),(0,.35,.66),.085,.15,'fur','tail.01')
    limb('Tail plume',(0,.35,.66),(0,.66,.65),.15,.145,'fur','tail.02',12)
    limb('Tail tip',(0,.66,.65),(0,.85,.83),.145,.018,'cream','tail.03',12)

# Small raised uniform details share the existing materials and hand/chest bones.
for side,suffix in [(-1,'R'),(1,'L')]:
    box('Utility pouch '+suffix,(side*.22,-.14,.83),(.12,.08,.14),'jacket','pelvis',.015)
    box('Pouch fastener '+suffix,(side*.22,-.189,.85),(.036,.018,.022),'gold','pelvis',.004)
    for i in range(3):
        ellipsoid('Glove knuckle '+suffix,(side*(.459+i*.031),-.115,.765),(.019,.023,.024),'armor','hand.'+suffix,12,8)
        box('Shoulder vent '+suffix,(side*(.235+i*.033),-.141,1.275),(.016,.016,.042),'dark','upper_arm.'+suffix,.003)
    limb('Jacket piping '+suffix,(side*.23,-.153,.96),(side*.26,-.15,1.24),.009,.009,'trim','chest')
arm=bpy.data.armatures.new('Replacement skeleton');rig=bpy.data.objects.new(NAME.title()+'ReplacementRig',arm);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
def bone(name,head,tail,parent=None):
    b=arm.edit_bones.new(name);b.head=head;b.tail=tail
    if parent:b.parent=arm.edit_bones[parent]
bone('root',(0,0,0),(0,0,.18));bone('pelvis',(0,0,.77),(0,0,.94),'root');bone('chest',(0,0,.94),(0,0,1.30),'pelvis');bone('neck',(0,0,1.3),(0,0,1.43),'chest');bone('head',(0,0,1.43),(0,0,1.76),'neck')
for x,s in [(-1,'R'),(1,'L')]:
    bone('upper_arm.'+s,(x*.27,0,1.26),(x*.405,-.015,1.02),'chest');bone('forearm.'+s,(x*.405,-.015,1.02),(x*.49,-.04,.83),'upper_arm.'+s);bone('hand.'+s,(x*.49,-.04,.83),(x*.5,-.053,.72),'forearm.'+s)
    bone('thigh.'+s,(x*.14,0,.77),(x*.18,-.01,.45),'pelvis');bone('shin.'+s,(x*.18,-.01,.45),(x*.2,0,.16),'thigh.'+s);bone('foot.'+s,(x*.2,0,.16),(x*.2,-.23,.08),'shin.'+s)
bone('tail.01',(0,.1,.86),(0,.35,.66),'pelvis');bone('tail.02',(0,.35,.66),(0,.66,.65),'tail.01');bone('tail.03',(0,.66,.65),(0,.85,.83),'tail.02');bpy.ops.object.mode_set(mode='OBJECT')
for obj,bonename in parts:
    group=obj.vertex_groups.new(name=bonename);group.add(list(range(len(obj.data.vertices))),1,'REPLACE');mod=obj.modifiers.new('Skeleton','ARMATURE');mod.object=rig;obj.parent=rig
# Join by material to reduce draw calls while retaining bone weights.
bpy.ops.object.select_all(action='DESELECT')
for obj,_ in parts:obj.select_set(True)
bpy.context.view_layer.objects.active=parts[0][0];bpy.ops.object.join();body=bpy.context.object;body.name=NAME.title()+'ReplacementMesh'
rig['provenance']='New Blender geometry; not extracted from Melee. Visual skeleton is not a collision skeleton.'
rig['forward']='glTF +Z';rig['units']='meters';rig['animations']='Authored by Fable in lab viewer; no original game animation samples.'
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/(NAME+'-replacement.glb')),export_format='GLB',use_selection=True,export_animations=False,export_yup=True,export_texcoords=False)
# Small studio render for asset review. Excluded from the GLB.
bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.name='PreviewFloor';floor.data.materials.append(materials['dark'])
world=bpy.context.scene.world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.035,.055,.085,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35
for name,pos,power,size,color in [('Key',(-3,-4,5),550,4,(1,.84,.66)),('Fill',(3,-2,3),350,3,(.57,.79,1)),('Rim',(1,3,4),750,3,(.6,1,.91))]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color;obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.location=pos;obj.rotation_euler=(Vector((0,0,1))-obj.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(3.1,-5.6,2.65));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.96))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.7
scene=bpy.context.scene;scene.camera=cam;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.render.resolution_x=720;scene.render.resolution_y=720;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/(NAME+'-preview.png'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(NAME+'-replacement.blend')));bpy.ops.render.render(write_still=True)
body.data.calc_loop_triangles();(OUT/(NAME+'-metadata.json')).write_text(json.dumps({'authored':True,'originalAsset':False,'bones':[b.name for b in arm.bones],'triangles':len(body.data.loop_triangles),'materials':len(body.data.materials),'glbBytes':(OUT/(NAME+'-replacement.glb')).stat().st_size},indent=2)+'\n')
