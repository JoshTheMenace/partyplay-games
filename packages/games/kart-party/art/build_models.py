"""Original Kart Party assets. Run with Blender --background --python this_file.
Game axes: +Y up, +Z forward; metres. Exported pivots retain those axes.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def coord(p): return (p[0], -p[2], p[1])
def material(name, color, metal=0, rough=.4, glow=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*[int(color[i:i+2],16)/255 for i in (1,3,5)],1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    # Convert display colors to linear for glTF and Blender to agree.
    rgb = tuple(v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4 for v in m.diffuse_color[:3])
    bs.inputs['Base Color'].default_value = (*rgb,1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Emission Color'].default_value = (*rgb,1)
    bs.inputs['Emission Strength'].default_value = glow
    return m
rubber=material('Rubber','#172233',0,.82)
metal=material('Brushed alloy','#b6d1df',.78,.26)
cream=material('Ivory enamel','#fff6e5',.15,.32)
glass=material('Deep blue glass','#183c57',.45,.2)
gold=material('Amber','#ffc24c',.35,.32)
lamp=material('Running lights','#c4fcff',.1,.28,2)
red=material('Brake lights','#ff493b',.1,.32,1.5)

# Empty pivots have identity rotation, so glTF's Y-up conversion preserves animation axes.
def group(name, parent=None):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent;return o

def finish(o, name, mat, p, scale, parent, bevel=0):
    o.name=name;o.location=coord(p);o.scale=(scale[0],scale[2],scale[1]);o.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Machined edge','BEVEL');mod.width=bevel;mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for face in o.data.polygons: face.use_smooth=True
    if bevel:
        mod=o.modifiers.new('Weighted panel normals','WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    o.parent=parent
    return o

def box(name,mat,p,size,parent,bevel=.04):
    bpy.ops.mesh.primitive_cube_add(size=1)
    return finish(bpy.context.object,name,mat,p,size,parent,bevel)

def oval(name,mat,p,size,parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=1)
    return finish(bpy.context.object,name,mat,p,size,parent)

def cyl(name,mat,p,r,depth,parent,axis='y',vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth)
    o=finish(bpy.context.object,name,mat,p,(1,1,1),parent,.015)
    if axis=='x':o.rotation_euler.y=math.pi/2
    if axis=='z':o.rotation_euler.x=math.pi/2
    return o

def torus(name,mat,p,r,tube,parent,axis='z'):
    bpy.ops.mesh.primitive_torus_add(major_radius=r,minor_radius=tube,major_segments=24,minor_segments=6)
    o=finish(bpy.context.object,name,mat,p,(1,1,1),parent)
    if axis=='x':o.rotation_euler.y=math.pi/2
    if axis=='z':o.rotation_euler.x=math.pi/2
    return o

def pivot(o,p):
    v=Vector(coord(p));o.location=v
    for child in o.children:child.location-=v

def bake(o):
    meshes=[c for c in o.children if c.type=='MESH']
    batches={}
    for c in meshes:batches.setdefault(c.data.materials[0],[]).append(c)
    for mat,batch in batches.items():
        bpy.ops.object.select_all(action='DESELECT')
        for c in batch:c.select_set(True)
        bpy.context.view_layer.objects.active=batch[0]
        bpy.ops.object.join();batch[0].name=o.name+'_'+mat.name
    for c in list(o.children):
        if c.type=='EMPTY':bake(c)

DRIVERS=[('fox','#ff5748','#ffdf64'),('penguin','#28c6e7','#e7ffff'),('frog','#78d955','#a4e870'),('cat','#b58aff','#ffbdf0'),('duck','#ffd24a','#fff3b0'),('rabbit','#ff7bb7','#ffe9f3'),('bear','#5488ff','#b8e9ff'),('raccoon','#ff974f','#f3e6da'),('fox','#d6f4ff','#80c9de'),('rabbit','#1ca993','#c8f5d5')]
roots=[]
for i,(animal,color,accent) in enumerate(DRIVERS):
    root=group('driver_'+str(i));roots.append(root)
    body=group('body_'+str(i),root)
    paint=material('Paint_'+str(i),color,.36,.28);fur=material('Fur_'+str(i),accent,0,.8)
    box('undertray',rubber,(0,.46,0),(1.7,.16,2.7),body)
    box('monocoque',paint,(0,.73,0),(1.65,.45,2.45),body,.16)
    oval('sculpted nose',paint,(0,.84,.93),(.78,.32,.76),body)
    box('nose stripe',cream,(0,1.08,1),(.19,.035,.9),body,.012)
    box('front splitter',rubber,(0,.47,1.43),(1.94,.13,.25),body)
    box('front bumper',metal,(0,.59,1.48),(1.7,.1,.12),body)
    box('bucket seat',rubber,(0,1.22,-.48),(.79,.95,.35),body,.13)
    box('seat cushion',rubber,(0,.97,-.16),(.75,.17,.66),body,.07)
    for side in [-1,1]:
        box('side pod',paint,(side*.84,.72,-.12),(.36,.4,1.57),body,.1)
        box('sill stripe',cream,(side*1.025,.79,-.1),(.02,.085,1.1),body,.008)
        for v in range(4):box('cooling louvre',rubber,(side*1.028,.67,-.5+v*.19),(.025,.15,.085),body,.006)
        box('headlamp',lamp,(side*.55,.82,1.46),(.28,.13,.035),body,.04)
        box('rear lamp',red,(side*.63,.8,-1.26),(.3,.12,.04),body,.025)
        cyl('exhaust',metal,(side*.61,.68,-1.43),.16,.44,body,'z')
        cyl('exhaust bore',rubber,(side*.61,.68,-1.665),.113,.02,body,'z')
        box('wing support',metal,(side*.67,1.24,-1.06),(.07,.76,.1),body)
        box('wing endplate',rubber,(side*1.01,1.57,-1.14),(.08,.27,.49),body)
        for z in [-.86,.87]:
            cyl('axle',metal,(side*.82,.46,z),.07,.55,body,'x',12)
            torus('spring',gold,(side*.8,.61,z),.1,.035,body,'y')
    box('rear aerofoil',paint,(0,1.57,-1.14),(2.08,.12,.47),body,.045)
    box('wing flash',cream,(0,1.64,-1.14),(.24,.025,.44),body,.008)
    oval('racing suit',paint,(0,1.53,-.2),(.43,.5,.37),body)
    for side in [-1,1]:box('harness',cream,(side*.22,1.65,-.54),(.08,.54,.04),body,.015)
    head=group('head_'+str(i),body)
    oval('head',rubber if animal=='penguin' else fur,(0,2.23,-.15),(.57,.53,.49),head)
    if animal=='penguin':oval('face mask',cream,(0,2.2,.25),(.44,.39,.2),head)
    for side in [-1,1]:
        if animal in ('fox','cat','raccoon'):
            bpy.ops.mesh.primitive_cone_add(vertices=4,radius1=.23,depth=.52)
            finish(bpy.context.object,'pointed ear',fur,(side*.4,2.7,-.15),(1,1,.8),head)
            oval('ear inset',paint,(side*.4,2.73,.01),(.095,.16,.028),head)
        elif animal in ('bear','rabbit'):
            ear=.46 if animal=='rabbit' else .22
            oval('ear',fur,(side*.38,2.68,-.15),(.17,ear,.15),head)
            oval('ear inset',paint,(side*.38,2.71,0),(.085,ear*.65,.025),head)
        eye_y=2.58 if animal=='frog' else 2.29
        if animal=='frog':oval('eye stalk',fur,(side*.34,eye_y,.07),(.23,.24,.22),head)
        if animal=='raccoon':oval('mask',rubber,(side*.23,eye_y,.29),(.23,.19,.12),head)
        oval('eye white',cream,(side*.23,eye_y,.32),(.13,.155,.09),head)
        oval('pupil',rubber,(side*.23,eye_y,.4),(.07,.095,.025),head)
        oval('eye glint',lamp,(side*.23-.026,eye_y+.04,.422),(.023,.029,.01),head)
    if animal in ('duck','penguin'):
        oval('beak',gold,(0,2.05,.4),(.31 if animal=='duck' else .19,.11,.28),head)
    elif animal=='frog':oval('smile',rubber,(0,2.06,.3),(.24,.025,.08),head)
    else:
        oval('muzzle',cream,(0,2.06,.31),(.29,.15,.2),head)
        oval('nose',rubber,(0,2.15,.49),(.09,.065,.055),head)
    # Open-face racing cap leaves eyes, muzzle and ears visible.
    oval('helmet shell',paint,(0,2.56,-.2),(.51,.23,.43),head)
    box('helmet stripe',cream,(0,2.79,-.2),(.14,.024,.52),head,.01)
    torus('goggle rim',rubber,(0,2.62,.22),.19,.028,head)
    for side in [-1,1]:
        arm=group(('arm_l_' if side<0 else 'arm_r_')+str(i),body)
        oval('sleeve',paint,(side*.42,1.62,.18),(.16,.23,.28),arm)
        oval('glove',cream,(side*.39,1.59,.48),(.16,.13,.15),arm)
        pivot(arm,(side*.42,1.8,-.01))
    steer=group('steer_'+str(i),body)
    torus('steering rim',rubber,(0,1.57,.55),.27,.042,steer)
    box('wheel spoke',metal,(0,1.57,.55),(.49,.04,.035),steer,.008)
    cyl('steering badge',paint,(0,1.57,.57),.07,.04,steer,'z')
    pivot(steer,(0,1.57,.55));pivot(head,(0,1.95,-.15))
    if animal in ('fox','raccoon'):
        for j in range(4):oval('tail',rubber if animal=='raccoon' and j%2 else fur,(.48+j*.05,1.15+j*.14,-.72-j*.065),(.18,.18,.2),body)
        oval('tail tip',cream,(.66,1.73,-.99),(.14,.17,.17),body)
    elif animal=='cat':torus('curled tail',fur,(.47,1.25,-.79),.26,.085,body)
    elif animal in ('rabbit','bear'):oval('tail',fur,(0,1.08,-.78),(.2,.19,.18),body)
    for side in [-1,1]:
        for z in [-.86,.87]:
            name=('front_' if z>0 else 'rear_')+('l_' if side<0 else 'r_')+str(i)
            steer_pivot=group(name,root)
            wheel=group('wheel_'+name,steer_pivot)
            cyl('tire',rubber,(side*1.04,.46,z),.43,.34,wheel,'x',24)
            for x in [-.13,.13]:torus('rounded sidewall',rubber,(side*1.04+x,.46,z),.345,.079,wheel,'x')
            cyl('alloy wheel',metal,(side*1.23,.46,z),.255,.026,wheel,'x')
            cyl('hub',paint,(side*1.25,.46,z),.12,.03,wheel,'x')
            for j in range(6):
                a=j*math.tau/6
                oval('rim vent',rubber,(side*1.251,.46+math.cos(a)*.177,z+math.sin(a)*.177),(.014,.041,.041),wheel)
            for j in range(16):
                a=j*math.tau/16
                tread=box('tread',rubber,(side*1.04,.46+math.cos(a)*.43,z+math.sin(a)*.43),(.24,.018,.04),wheel,.004)
                tread.rotation_euler.x=-a
            pivot(wheel,(side*1.04,.46,z));pivot(steer_pivot,(side*1.04,.46,z))
    bake(root)

# Course props use the same modelling and material pipeline as the vehicles.
buoy=group('buoy');roots.append(buoy)
cyl('base',rubber,(0,.25,0),1.65,.5,buoy)
cyl('tower',red,(0,1.15,0),1.05,1.8,buoy)
cyl('reflective band',cream,(0,1.45,0),1.075,.35,buoy)
cyl('beacon',lamp,(0,2.25,0),.4,.3,buoy)
boulder=group('boulder');roots.append(boulder)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=2)
rock=finish(bpy.context.object,'fractured copper',material('Copper rock','#b97742',.12,.86),(0,2,0),(1,1,1),boulder)
for v in rock.data.vertices:v.co*=1+.08*math.sin(v.index*13.7)
for face in rock.data.polygons:face.use_smooth=False
traffic=group('traffic');roots.append(traffic)
box('delivery body',gold,(0,1.2,0),(2.7,1.65,3.3),traffic,.25)
box('cabin',paint,(0,1.55,1.25),(2.45,1.45,1.2),traffic,.2)
box('windshield',glass,(0,1.85,1.87),(2.12,.67,.04),traffic)
for side in [-1,1]:
    box('headlight',lamp,(side*.8,.95,1.91),(.5,.22,.05),traffic)
    box('taillight',red,(side*.9,1.05,-1.68),(.22,.35,.06),traffic)
    for z in [-1.1,1.1]:cyl('truck tire',rubber,(side*1.35,.5,z),.5,.22,traffic,'x')
box('parcel stripe',cream,(0,1.45,-1.67),(2.1,.2,.025),traffic)
satellite=group('satellite');roots.append(satellite)
oval('orb',metal,(0,1.5,0),(1.5,1.5,1.5),satellite)
torus('energy equator',lamp,(0,1.5,0),1.52,.12,satellite,'y')
for side in [-1,1]:
    box('solar panel',glass,(side*2.0,1.5,0),(1.1,.15,1.5),satellite)
    for j in [-.45,0,.45]:box('panel conductor',gold,(side*2.0,1.59,j),(1,.02,.025),satellite,.002)
for root in roots[10:]:bake(root)

OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
for root in roots:
    root.select_set(True)
    for child in root.children_recursive:child.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'garage.glb'),export_format='GLB',use_selection=True,export_cameras=False,export_lights=False,export_extras=True)
# A reimport proves the actual shipped file contains all rigs and pivots.
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(OUT/'garage.glb'))
roots=[bpy.data.objects.get('driver_'+str(i)) for i in range(10)]
assert all(roots), 'Missing exported driver'
for i,root in enumerate(roots):
    assert bpy.data.objects.get('head_'+str(i)) and bpy.data.objects.get('wheel_front_l_'+str(i))
    root.location=coord(((i%5-2)*3.9,0,(i//5)*5))
for i,name in enumerate(['buoy','boulder','traffic','satellite']):bpy.data.objects[name].location=coord(((i-1.5)*5,0,11))
mesh_objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in mesh_objects)
(OUT/'manifest.json').write_text(json.dumps({'generator':'Blender '+bpy.app.version_string,'license':'Original project artwork','axes':'+Y up, +Z forward','drivers':10,'props':['buoy','boulder','traffic','satellite'],'triangles':triangles,'bytes':(OUT/'garage.glb').stat().st_size},indent=2)+'\n')
box('studio floor',material('Studio','#15263d',0,.8),(0,-.12,4),(32,.2,25),None,.05)
scene=bpy.context.scene
scene.world.color=(.18,.18,.18)
for p,energy,size in [((2,12,2),2100,10),((-10,7,6),1700,9),((6,10,14),2300,8)]:
    bpy.ops.object.light_add(type='AREA',location=coord(p));o=bpy.context.object;o.data.energy=energy;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector(coord((0,0,4)))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=coord((18,19,28)))
cam=bpy.context.object;cam.rotation_euler=(Vector(coord((0,0.7,4)))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=27;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24
scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=65
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'art/garage-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/garage.blend'))
bpy.ops.render.render(write_still=True)
print('ASSET_REPORT',triangles,(OUT/'garage.glb').stat().st_size)
