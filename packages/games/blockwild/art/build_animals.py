"""Original Blockwild farm animals. Run with Blender 5.2 --background --python.
Coordinates in this authoring API are game-space: Y up, forward -Z.
One vertex-color material; named rigid mesh pivots animate in the game.
"""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / 'public/games/blockwild/models'
ART = Path(__file__).resolve().parent
OUT.mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
mat=bpy.data.materials.new('Voxel colors'); mat.use_nodes=True
nodes=mat.node_tree.nodes; color=nodes.new('ShaderNodeVertexColor'); color.layer_name='Color'
mat.node_tree.links.new(color.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
nodes.get('Principled BSDF').inputs['Roughness'].default_value=.95
parts=[]
def rgb(h):
    a=[int(h[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4 for v in a)+(1,)
def cube(pos,size,tint):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(pos[0],-pos[2],pos[1]))
    o=bpy.context.object; o.scale=(size[0],size[2],size[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(mat); attr=o.data.color_attributes.new(name='Color',type='BYTE_COLOR',domain='CORNER')
    for poly in o.data.polygons:
        shade=random.uniform(.91,1.03)
        for n in poly.loop_indices: attr.data[n].color=tuple(min(1,c*shade) for c in rgb(tint)[:3])+(1,)
    parts.append(o); return o

def part(name,pivot,fn):
    start=len(parts); fn(); group=parts[start:]
    bpy.ops.object.select_all(action='DESELECT')
    for o in group:o.select_set(True)
    bpy.context.view_layer.objects.active=group[0]; bpy.ops.object.join(); o=bpy.context.object; o.name=name
    bpy.context.scene.cursor.location=(pivot[0],-pivot[2],pivot[1]); bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    return o

def pixels(y,z,pattern,palette,step=.065):
    for row,line in enumerate(pattern):
        for col,key in enumerate(line):
            if key!='.':cube(((col-(len(line)-1)/2)*step,y-row*step,z),(step,step,.013),palette[key])

def animal(kind):
    chicken=kind=='chicken'; body='#eee5cf' if chicken else '#a79583' if kind=='sheep' else '#da9d91' if kind=='pig' else '#614a38'
    def torso():
        cube((0,.52 if chicken else .7 if kind=='sheep' else .82,.02 if kind=='sheep' else .08),(.38,.4,.48) if chicken else (.55,.55,1.0) if kind=='sheep' else (.7,.65,1.03),body)
        if kind=='cow':
            for x,y,z in [(-.36,.93,-.12),(.36,.7,.23),(-.35,.68,.32),(.35,1.01,.28)]:cube((x,y,z),(.016,.22,.25),'#e7dfc9')
            cube((0,.48,.29),(.29,.14,.26),'#c7998e')
        if chicken:
            for x in [-.23,.23]:cube((x,.52,.08),(.09,.27,.36),'#d6cdb7')
            cube((0,.65,.36),(.25,.3,.1),'#d9d0b8')
        else:cube((0,.78,.64),(.09,.22,.09),body)
    part('body',(0,.8,0),torso)
    if kind=='sheep':
        def coat():
            cube((0,.82,.08),(.7,.65,1.03),'#ede5d4')
            for x in [-.31,.31]:
                for z in [-.26,.12,.44]:cube((x,.88,z),(.15,.54,.26),'#f4eee2')
        part('coat',(0,.8,0),coat)
    def head():
        y=.85 if chicken else 1.02; z=-.28 if chicken else -.64
        cube((0,y,z),(.3,.34,.29) if chicken else (.46,.46,.45),body if kind!='sheep' else '#918271')
        if chicken:
            cube((0,y-.02,z-.2),(.19,.11,.15),'#dca43c');cube((0,y-.16,z-.16),(.1,.11,.05),'#b94a3b');cube((0,y+.21,z),(.08,.12,.21),'#bf5344')
        else:
            cube((0,y-.08,z-.26),(.34,.2,.11),'#cba796' if kind!='pig' else '#bf827b')
            for x in [-.08,.08]:cube((x,y-.06,z-.322),(.04,.04,.015),'#534539')
            for x in [-.29,.29]:cube((x,y+.12,z+.02),(.16,.1,.19),body)
            if kind=='cow':
                for x in [-.2,.2]:cube((x,y+.31,z+.07),(.08,.21,.09),'#c9b994')
        for x in [-.105,.105] if chicken else [-.16,.16]:
            cube((x,y+.06,z-(.151 if chicken else .231)),(.06,.065,.015),'#252a25')
    part('head',(0,.85 if chicken else 1.06,-.2 if chicken else -.44),head)
    for i,(x,z) in enumerate([(-.11,.04),(.11,.04)] if chicken else [(-.24,-.3),(.24,-.3),(-.24,.4),(.24,.4)]):
        def leg(x=x,z=z):
            cube((x,.2,z),(.055,.3,.065) if chicken else (.19,.45,.2),'#d5a04b' if chicken else body)
            cube((x,.055,z-.04),(.12,.06,.18) if chicken else (.2,.12,.24),'#b18839' if chicken else '#584e43')
        part('leg_'+str(i),(x,.36 if chicken else .47,z),leg)

roots=[]; report={}
for j,(name,fn) in enumerate([(name,lambda name=name:animal(name)) for name in ['cow','sheep','pig','chicken']]):
    random.seed(180+j); before=set(bpy.data.objects);fn(); objects=[o for o in bpy.data.objects if o not in before]
    root=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(root)
    for o in objects:o.parent=root
    bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
    for o in objects:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{name}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_animations=False)
    report[name]={'triangles':sum(len(o.data.polygons)*2 for o in objects),'meshes':len(objects),'bytes':(OUT/f'{name}.glb').stat().st_size}
    root.location.x=(j-1.5)*2.45;roots.append(root)
# Reimport each standalone export and confirm named parts and grounded bounds.
for name in report:
    before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(OUT/f'{name}.glb'));loaded=set(bpy.data.objects)-before
    meshes=[o for o in loaded if o.type=='MESH'];assert len(meshes)==report[name]['meshes']
    bounds=[o.matrix_world@Vector(corner) for o in meshes for corner in o.bound_box]
    report[name]['height']=round(max(p.z for p in bounds)-min(p.z for p in bounds),3)
    for o in loaded:bpy.data.objects.remove(o,do_unlink=True)
(ART/'animal-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
# Preview studio, saved in the authored blend but excluded from GLBs.
bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.name='Preview floor';floor.location.z=-.015
fm=bpy.data.materials.new('Studio slate');fm.diffuse_color=(.035,.05,.055,1);floor.data.materials.append(fm)
bpy.ops.object.camera_add(location=(5.7,10.5,5.1));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.9))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=11.5;bpy.context.scene.camera=cam
for loc,power,size in [((0,4,7),1500,8),((-5,-3,5),1000,6)]:
    bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12
scene.render.resolution_x=1000;scene.render.resolution_y=430;scene.render.resolution_percentage=100
scene.world.color=(.2,.2,.2);scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ART/'animal-lineup.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'blockwild-animals.blend'));bpy.ops.render.render(write_still=True)
for o in bpy.data.objects:
    if o.name.startswith('coat'):o.hide_render=True
scene.render.filepath=str(ART/'animal-shorn-lineup.png');bpy.ops.render.render(write_still=True)
print(json.dumps(report))
