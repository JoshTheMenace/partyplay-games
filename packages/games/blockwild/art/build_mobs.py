"""Original Blockwild voxel mobs. Run with Blender 5.2 --background --python.
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

def zombie():
    def head():
        cube((0,1.64,0),(.5,.5,.5),'#668451')
        pixels(1.8,-.256,['.ss...ss','ss......','.ee..ee.','.dd..dd.','...n....','..mmm...','...mm...'],{'s':'#80945b','e':'#242e22','d':'#889770','n':'#49643d','m':'#35442c'},.057)
        cube((.25,1.6,.08),(.04,.15,.13),'#46633e')
    part('head',(0,1.4,0),head)
    part('body',(0,1.25,0),lambda:(cube((0,1.07,0),(.53,.65,.29),'#427e7b'),cube((-.12,.78,-.15),(.18,.13,.02),'#596957'),cube((.18,.98,-.151),(.1,.16,.015),'#325b59')))
    for sign,side in [(-1,'left'),(1,'right')]:
        part('arm_'+side,(sign*.36,1.3,0),lambda sign=sign:(cube((sign*.36,1.26,-.19),(.2,.21,.42),'#427e7b'),cube((sign*.36,1.25,-.48),(.18,.18,.24),'#68814d'),cube((sign*.36,1.27,-.61),(.18,.1,.025),'#4a5e39')))
        part('leg_'+side,(sign*.14,.75,0),lambda sign=sign:(cube((sign*.14,.43,0),(.235,.65,.27),'#494766'),cube((sign*.14,.12,-.05),(.24,.24,.36),'#3b3e41')))

def skeleton():
    def head():
        cube((0,1.67,0),(.49,.47,.43),'#d2ceb6')
        pixels(1.79,-.224,['.ee..ee.','.ee..ee.','...nn...','...nn...','.mmmmmm.','..m.mm..'],{'e':'#303638','n':'#656959','m':'#464b46'},.056)
        cube((0,1.43,-.005),(.34,.1,.37),'#aaa994')
    part('head',(0,1.43,0),head)
    def ribs():
        cube((0,1.09,.06),(.12,.64,.13),'#a5a48f')
        for y in [1.32,1.18,1.04]:
            cube((0,y,0),(.48,.065,.27),'#c9c7b1');cube((0,y-.055,-.1),(.1,.05,.065),'#dbd7c1')
        cube((0,.8,0),(.37,.14,.23),'#afaf9a')
    part('body',(0,1.3,0),ribs)
    for sign,side in [(-1,'left'),(1,'right')]:
        def arm(sign=sign):
            cube((sign*.32,1.12,-.12),(.1,.47,.11),'#cfccb5');cube((sign*.32,.89,-.25),(.115,.115,.31),'#b4b39d')
            if sign==1:
                for y,z in [(.6,-.35),(.7,-.46),(.85,-.51),(1,-.46),(1.1,-.35)]:cube((.34,y,z),(.075,.15,.07),'#795b3e')
                cube((.34,.85,-.34),(.013,.56,.013),'#d5c4a1')
        part('arm_'+side,(sign*.32,1.35,0),arm)
        part('leg_'+side,(sign*.12,.75,0),lambda sign=sign:(cube((sign*.12,.43,0),(.11,.62,.12),'#c3c2ac'),cube((sign*.12,.1,-.07),(.15,.13,.28),'#aaa997')))

def creeper():
    def head():
        cube((0,1.4,0),(.56,.55,.52),'#65854a')
        pixels(1.62,-.269,['pp...pp.','.ee..ee.','.ee..ee.','...nn...','..mmmm..','..mmmm..','..m..m..','.p....p.'],{'p':'#8fa75b','e':'#233329','n':'#263a29','m':'#203327'},.063)
        for x,y,z in [(-.29,1.43,.12),(.29,1.58,-.1),(.16,1.69,.1)]:cube((x,y,z),(.025,.14,.16),'#3e6240')
    part('head',(0,1.14,0),head)
    part('body',(0,1.1,0),lambda:(cube((0,.83,.01),(.39,.65,.31),'#77934f'),cube((-.11,.91,-.15),(.12,.21,.025),'#4d7143'),cube((.12,.68,-.15),(.12,.18,.025),'#a1af68')))
    for i,(x,z) in enumerate([(-.21,-.19),(.21,-.19),(-.21,.19),(.21,.19)]):
        part('leg_'+str(i),(x,.51,z),lambda x=x,z=z:(cube((x,.29,z),(.26,.43,.28),'#617c47'),cube((x,.09,z-.025),(.28,.13,.34),'#364d37')))

def spider():
    part('body',(0,.52,.22),lambda:(cube((0,.53,.34),(.66,.44,.75),'#3a2d2a'),cube((0,.6,.52),(.46,.15,.3),'#4e3730'),cube((0,.46,-.14),(.43,.3,.35),'#45352c')))
    def head():
        cube((0,.46,-.43),(.56,.36,.35),'#382b29')
        for x,y in [(-.18,.51),(-.07,.54),(.07,.54),(.18,.51),(-.2,.39),(.2,.39)]:cube((x,y,-.613),(.065,.065,.018),'#e5674c')
        for x in [-.14,.14]:cube((x,.28,-.55),(.07,.13,.085),'#b39b77')
    part('head',(0,.47,-.22),head)
    for side in [-1,1]:
        for i in range(4):
            z=-.35+i*.23; dz=(i-1.5)*.15
            def leg(side=side,z=z,dz=dz):
                a=cube((side*.57,.51,z+dz),(.64,.09,.1),'#43332d'); a.rotation_euler.y=side*-.23
                b=cube((side*.88,.28,z+dz*1.4),(.1,.49,.1),'#2b2423'); b.rotation_euler.y=side*-.25
            part(f'leg_{"left" if side<0 else "right"}_{i}',(side*.22,.49,z),leg)

roots=[]; report={}
for j,(name,fn) in enumerate([('zombie',zombie),('skeleton',skeleton),('spider',spider),('creeper',creeper)]):
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
(ART/'mob-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
# Preview studio, saved in the authored blend but excluded from GLBs.
bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.name='Preview floor';floor.location.z=-.015
fm=bpy.data.materials.new('Studio slate');fm.diffuse_color=(.035,.05,.055,1);floor.data.materials.append(fm)
bpy.ops.object.camera_add(location=(5.7,10.5,5.1));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.9))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=11.5;bpy.context.scene.camera=cam
for loc,power,size in [((0,4,7),1500,8),((-5,-3,5),1000,6)]:
    bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24
scene.render.resolution_x=1400;scene.render.resolution_y=600;scene.render.resolution_percentage=100
scene.world.color=(.2,.2,.2);scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ART/'mob-lineup.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'blockwild-mobs.blend'));bpy.ops.render.render(write_still=True)
print(json.dumps(report))
