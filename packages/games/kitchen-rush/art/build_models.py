"""Original Kitchen Rush assets. Blender 5.2; metres, +Y up / +Z forward in GLB.
Run: blender -b --factory-startup --python-exit-code 1 --python build_models.py
Rigid chef joint nodes are animated from authoritative movement/work in Three.js.
"""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector
random.seed(24)
ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / 'public/games/kitchen-rush/models'
ART = Path(__file__).resolve().parent
PREVIEW = ROOT.parent / 'output/kitchen-rush/blender'
for path in (OUT, PREVIEW): path.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
WHITE='#fff1d5'; STEEL='#aebfbc'; DARK='#273b40'; WOOD='#c58c50'; GOLD='#dca345'
assets = []
def linear(h):
    values=[int(h[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4 for v in values)+(1,)
def mat(name, metal=0, rough=.65):
    m=bpy.data.materials.new(name); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    c=m.node_tree.nodes.new('ShaderNodeVertexColor'); c.layer_name='Color'; m.node_tree.links.new(c.outputs['Color'],bs.inputs['Base Color']); return m
PAINT=mat('KitchenPalette'); METAL=mat('BrushedMetal',.65,.32); TEAM=mat('TeamColor'); TEAM.diffuse_color=(1,1,1,1)
def empty(name, parent=None, pos=(0,0,0)):
    o=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(o); o.parent=parent; o.location=(pos[0],-pos[2],pos[1]); return o
def asset(name):
    o=empty(name); assets.append(o); return o
def finish(o,parent,pos,color,material=PAINT):
    o.location=(pos[0],-pos[2],pos[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.clear(); o.data.materials.append(material)
    c=o.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    for v in c.data: v.color=linear(color)
    o.parent=parent
    for p in o.data.polygons:p.use_smooth=True
    return o
def box(p,loc,scale,col,bevel=.055,material=PAINT):
    bpy.ops.mesh.primitive_cube_add();o=bpy.context.object;o.scale=(scale[0]/2,scale[2]/2,scale[1]/2)
    o=finish(o,p,loc,col,material)
    if bevel:
        b=o.modifiers.new('Soft manufactured edges','BEVEL');b.width=bevel;b.segments=2
        bpy.ops.object.modifier_apply(modifier=b.name)
        n=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');n.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=n.name)
    return o
def ball(p,loc,scale,col,segments=16,rings=10,material=PAINT):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings);o=bpy.context.object;o.scale=(scale[0],scale[2],scale[1]);return finish(o,p,loc,col,material)
def cyl(p,loc,r,h,col,vertices=20,material=PAINT):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=h);return finish(bpy.context.object,p,loc,col,material)
def lathe(p,profile,col,segments=24,material=PAINT):
    verts=[];faces=[]
    for r,y in profile:
        for i in range(segments):
            a=i*math.tau/segments;verts.append((r*math.cos(a),r*math.sin(a),y))
    for j in range(len(profile)-1):
        for i in range(segments):a=j*segments+i;b=j*segments+(i+1)%segments;faces.append((a,b,b+segments,a+segments))
    m=bpy.data.meshes.new('Turned profile');m.from_pydata(verts,[],faces);m.update();o=bpy.data.objects.new('Profile',m);bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active=o;o.select_set(True);return finish(o,p,(0,0,0),col,material)
def pipe(p,points,r,col,material=PAINT):
    curve=bpy.data.curves.new('Bent tube','CURVE');curve.dimensions='3D';curve.resolution_u=1;curve.bevel_depth=r;curve.bevel_resolution=1
    poly=curve.splines.new('POLY');poly.points.add(len(points)-1)
    for v,(x,y,z) in zip(poly.points,points):v.co=(x,-z,y,1)
    o=bpy.data.objects.new('Tube',curve);bpy.context.collection.objects.link(o);bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');return finish(o,p,(0,0,0),col,material)
def leaf(p,loc,length,width,col,angle=0):
    verts=[];faces=[]
    for i in range(7):
        t=i/6;w=math.sin(math.pi*t)*width
        for side in (-1,0,1):
            x=side*w;z=t*length; y=.045*math.sin(t*math.pi)+(abs(side)*.035*math.sin(i*2))
            verts.append((x*math.cos(angle)+z*math.sin(angle),-(z*math.cos(angle)-x*math.sin(angle)),y))
    for i in range(6):
        for j in range(2):a=i*3+j;faces.append((a,a+1,a+4,a+3))
    m=bpy.data.meshes.new('Ruffled leaf');m.from_pydata(verts,[],faces);m.update();o=bpy.data.objects.new('Leaf',m);bpy.context.collection.objects.link(o);bpy.context.view_layer.objects.active=o;o.select_set(True);return finish(o,p,loc,col)
def merge_children(p):
    # Merge each rigid part by material: one primitive per surface, shared by every clone.
    for material in (PAINT,METAL,TEAM):
        group=[o for o in p.children if o.type=='MESH' and o.data.materials[0]==material]
        if not group:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in group:o.select_set(True)
        bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join();o=group[0];o.name=p.name+'_'+material.name
        # Join keeps redundant slots. One slot avoids hundreds of exported draw primitives.
        o.data.materials.clear();o.data.materials.append(material)
        for poly in o.data.polygons:poly.material_index=0
    for child in list(p.children):
        if child.type=='EMPTY':merge_children(child)

def chef(skin,index):
    root=asset('chef'+str(index));body=empty('Torso',root)
    box(body,(0,.63,0),(.62,.64,.42),WHITE,.13)
    box(body,(0,.60,.226),(.42,.47,.05),WHITE,.045)
    for x in (-.115,.115):
        for y in (.49,.62,.75):ball(body,(x,y,.257),(.025,.026,.015),DARK,12,6)
    box(body,(0,.34,.08),(.5,.12,.44),'#ffffff',.04,TEAM)
    box(body,(0,.47,.26),(.25,.12,.02),'#dbc9a9',.015)
    pipe(body,[(-.16,.89,.09),(0,.78,.25),(.16,.89,.09)],.045,'#ffffff',TEAM)
    head=empty('Head',root,(0,1.04,0))
    ball(head,(0,.02,0),(.29,.31,.25),skin,24,16)
    for x in (-.29,.29):ball(head,(x,.015,0),(.06,.09,.055),skin,12,8)
    for x in (-.105,.105):
        ball(head,(x,.065,.225),(.041,.05,.025),'#fffaf0',12,8)
        ball(head,(x,.062,.247),(.021,.027,.012),DARK,12,8)
        pipe(head,[(x-.045,.136,.226),(x,.15,.232),(x+.04,.14,.226)],.012,'#51382c')
    ball(head,(0,-.005,.254),(.06,.056,.052),skin)
    pipe(head,[(-.07,-.085,.224),(0,-.102,.244),(.07,-.085,.224)],.012,'#6d3b31')
    cyl(head,(0,.28,0),.295,.15,WHITE,28)
    cyl(head,(0,.215,0),.299,.065,'#ffffff',28,TEAM)
    for i in range(7):
        a=i*math.tau/7;ball(head,(math.cos(a)*.16,.43+(i%2)*.025,math.sin(a)*.14),(.17,.19,.16),WHITE)
    ball(head,(0,.48,0),(.2,.17,.2),WHITE)
    for side,x in [('L',-.36),('R',.36)]:
        arm=empty('Arm'+side,root,(x,.82,0))
        box(arm,(0,-.12,0),(.22,.35,.25),WHITE,.085)
        cyl(arm,(0,-.30,0),.115,.09,'#ffffff',16,TEAM)
        ball(arm,(0,-.4,.015),(.115,.13,.11),skin)
        ball(arm,(-.075 if x<0 else .075,-.37,.09),(.045,.07,.05),skin,12,8)
        leg=empty('Leg'+side,root,(x*.46,.35,0))
        box(leg,(0,-.10,0),(.21,.28,.24),DARK,.05)
        box(leg,(0,-.25,.075),(.26,.17,.42),'#263236',.065)
        box(leg,(0,-.31,.075),(.27,.04,.43),'#9b8070',.012)
    merge_children(root)
for i,skin in enumerate(['#f0c49b','#d6986d','#935f45','#c98257']):chef(skin,i)

FOOD={'lettuce':'#76b840','tomato':'#e94e30','onion':'#d5bde0','patty':'#ba6053','bun':'#dda148','dough':'#eed3a1','cheese':'#f1c443'}
for kind,color in FOOD.items():
    for stage in ['raw','chopped','cooked','burnt']:
        p=asset(kind+'_'+stage)
        c='#493b30' if stage=='burnt' else {'patty':'#80452a','dough':'#d79743','tomato':'#b43e27','onion':'#a87940'}.get(kind,color) if stage=='cooked' else color
        if stage=='chopped':
            for i in range(7):
                x=math.sin(i*2.4)*.23;z=math.cos(i*2.4)*.21
                if kind=='lettuce':leaf(p,(x,.06,z),.23,.11,['#68a83b','#a3cd5a'][i%2],i)
                else:box(p,(x,.075,z),(.14,.12,.13),c,.022)
        elif kind=='lettuce':
            ball(p,(0,.18,0),(.25,.21,.25),c)
            for i in range(11):
                a=i*2.4;leaf(p,(math.sin(a)*.15,.14+(i%3)*.06,math.cos(a)*.15),.33,.18,['#4b913c',c,'#a3ce5c'][i%3],a)
        elif kind=='tomato':
            ball(p,(0,.25,0),(.31,.25,.3),c,24,14)
            for i in range(5):leaf(p,(0,.49,0),.18,.055,'#477139',i*math.tau/5)
            pipe(p,[(0,.48,0),(.02,.59,-.025)],.025,'#4d713a')
        elif kind=='onion':
            lathe(p,[(0,0),(.17,.02),(.28,.12),(.29,.23),(.22,.34),(.10,.42),(.065,.51),(0,.54)],c)
            for i in range(8):
                a=i*math.tau/8;pipe(p,[(math.cos(a)*r,y,math.sin(a)*r) for r,y in [(.17,.025),(.281,.13),(.291,.23),(.221,.34),(.07,.49)]],.006,'#ac86ac')
            for i in range(4):pipe(p,[(0,.02,0),((i-1.5)*.05,.005,.12)],.008,'#bc985c')
        elif kind=='patty':
            lathe(p,[(0,0),(.27,0),(.34,.05),(.34,.13),(.27,.18),(0,.19)],c)
            for z in (-.16,-.055,.055,.16):box(p,(0,.19,z),(.45,.012,.025),'#3f3026' if stage!='raw' else '#e68c70',.006)
        elif kind=='bun':
            lathe(p,[(0,0),(.25,0),(.34,.06),(.35,.14),(.30,.27),(.17,.35),(0,.37)],c)
            for i in range(15):
                a=i*2.4;r=.26*math.sqrt((i+1)/16);ball(p,(math.cos(a)*r,.36-r*r*.95,math.sin(a)*r),(.016,.008,.035),WHITE,8,4)
        elif kind=='dough':
            lathe(p,[(0,0),(.32,0),(.37,.04),(.36,.09),(.30,.12),(0,.10)],c)
            for i in range(5):pipe(p,[(-.18,.118,-.15+i*.065),(.15,.118,-.15+i*.065)],.006,'#d0ae79')
        else:
            # Wedge with inset dark pores and raised pale rim; readable Swiss-cheese silhouette.
            bpy.ops.mesh.primitive_cylinder_add(vertices=3,radius=.42,depth=.29);o=finish(bpy.context.object,p,(0,.16,0),c)
            for x,z,r in [(-.08,.03,.067),(.09,.08,.048),(0,-.16,.04)]:
                cyl(p,(x,.308,z),r,.005,'#bb812a',16);cyl(p,(x+.01,.312,z),r*.68,.004,'#d99c30',16)
        merge_children(p)
for dirty in (False,True):
    p=asset('plate_dirty' if dirty else 'plate');lathe(p,[(0,.015),(.32,.015),(.45,.04),(.49,.09),(.48,.12),(.43,.12),(.35,.065),(0,.065)],'#c6b799' if dirty else WHITE,32)
    if dirty:
        for x,z,r in [(.12,.03,.12),(-.13,.11,.075)]:cyl(p,(x,.073,z),r,.009,'#927249')
    merge_children(p)

for dish in ('salad','soup','burger','pizza'):
    p=asset('dish_'+dish)
    if dish=='salad':
        for i in range(12):
            a=i*2.4;leaf(p,(math.sin(a)*.17,.09+(i%3)*.035,math.cos(a)*.17),.25,.13,['#74ad42','#b3d66c'][i%2],a)
        for i in range(5):
            a=i*math.tau/5;cyl(p,(math.sin(a)*.22,.17,math.cos(a)*.22),.085,.045,'#df5437',12)
    elif dish=='soup':
        lathe(p,[(0,.075),(.25,.075),(.35,.14),(.39,.31),(.38,.34),(.35,.34),(.31,.16),(0,.14)],WHITE,28)
        cyl(p,(0,.285,0),.34,.015,'#c75328',28)
        for i in range(6):
            a=i*2.4;ball(p,(math.sin(a)*.20,.302,math.cos(a)*.20),(.035,.012,.025),'#eaba69',8,4)
            leaf(p,(math.sin(a)*.14,.30,math.cos(a)*.14),.06,.024,'#5b8e3d',a)
    elif dish=='burger':
        lathe(p,[(0,.08),(.29,.08),(.34,.13),(.33,.20),(0,.20)],'#dca254')
        lathe(p,[(0,.20),(.32,.20),(.34,.26),(.30,.31),(0,.31)],'#74412b')
        for i in range(7):
            a=i*math.tau/7;leaf(p,(math.sin(a)*.16,.30,math.cos(a)*.16),.22,.10,'#8abf4c',a)
        cyl(p,(0,.355,0),.29,.06,'#d74c30')
        lathe(p,[(0,.39),(.32,.39),(.35,.46),(.29,.58),(.16,.65),(0,.67)],'#dca254')
        for i in range(14):
            a=i*2.4;r=.27*math.sqrt((i+1)/15);ball(p,(math.cos(a)*r,.664-r*r*.9,math.sin(a)*r),(.012,.008,.027),WHITE,8,4)
    else:
        lathe(p,[(0,.08),(.40,.08),(.44,.12),(.43,.18),(.37,.20),(.32,.15),(0,.15)],'#cd8b3e',32)
        cyl(p,(0,.164,0),.35,.024,'#c94c2a',32);cyl(p,(0,.182,0),.32,.012,'#efd077',32)
        for i in range(7):
            a=i*2.4;r=.24 if i else 0;cyl(p,(math.sin(a)*r,.197,math.cos(a)*r),.058,.015,'#d65432',12)
            leaf(p,(math.sin(a+.5)*r,.21,math.cos(a+.5)*r),.10,.035,'#638e40',a)
    merge_children(p)

def cabinet(p,col):
    for x in (-.66,.66):
        for z in (-.66,.66):cyl(p,(x,.13,z),.08,.24,DARK,12,METAL)
    box(p,(0,.59,0),(1.64,.88,1.62),col,.065)
    box(p,(0,1.04,0),(1.82,.14,1.82),WHITE,.055)
    for x in (-.40,.40):
        box(p,(x,.62,.822),(.73,.63,.04),col,.035)
        pipe(p,[(x-.17,.80,.85),(x-.17,.80,.93),(x+.17,.80,.93),(x+.17,.80,.85)],.026,STEEL,METAL)
    box(p,(0,.2,.825),(1.48,.055,.025),DARK,.005)
for kind,col in [('counter','#63a99b'),('board','#bf8751'),('stove','#cc654c'),('oven','#b7794b'),('sink','#6cabb4'),('plates','#6aaa99'),('return','#7b9cac'),('serve','#d27050'),('crate',WOOD),('belt','#629187'),('bin','#658979')]:
    p=asset('station_'+kind)
    if kind not in ('bin','crate','belt'):cabinet(p,col)
    if kind=='crate':
        box(p,(0,.56,0),(1.6,.9,1.6),'#735335',.04)
        box(p,(0,1.035,0),(1.44,.08,1.44),'#573f2c',.01)
        for y in (.36,.62,.88,1.15):
            for z in (-.81,.81):box(p,(0,y,z),(1.74,.15,.10),'#d2a168',.018)
            for x in (-.81,.81):box(p,(x,y,0),(.10,.15,1.7),'#d2a168',.018)
        for x in (-.71,.71):
            for z in (-.87,.87):
                for y in (.37,.88):ball(p,(x,y,z),(.025,.025,.008),DARK,8,4)
        box(p,(0,.63,.875),(.66,.34,.024),'#334e42',.015)
    elif kind=='board':
        box(p,(-.08,1.17,0),(1.40,.18,1.30),'#bc884d',.07)
        for i in range(7):box(p,(-.66+i*.19,1.268,0),(.175,.012,1.16),['#e4bd80','#d8ae6e','#ebca8e'][i%3],.008)
        for i in range(4):
            o=box(p,(-.15+i*.08,1.278,-.1),(.012,.006,.46),'#bf9357',.002);o.rotation_euler.z=.6
        knife=empty('Knife',p,(.58,1.3,0))
        box(knife,(0,.02,-.1),(.20,.035,.54),STEEL,.012,METAL);box(knife,(0,.04,.31),(.13,.09,.29),DARK,.025)
        for z in (.23,.37):ball(knife,(0,.09,z),(.018,.009,.018),STEEL,8,4,METAL)
    elif kind=='stove':
        box(p,(0,1.10,0),(1.7,.08,1.70),DARK,.04,METAL)
        lathe(p,[(.40,1.12),(.64,1.12),(.64,1.18),(.40,1.18)],'#131f24',24)
        for i in range(4):
            a=i*math.pi/2;o=box(p,(math.cos(a)*.47,1.21,math.sin(a)*.47),(.44,.09,.10),'#101c22',.02,METAL);o.rotation_euler.z=-a
        lathe(p,[(0,1.23),(.39,1.23),(.51,1.30),(.53,1.35),(.49,1.37),(.43,1.29),(0,1.29)],'#435459',28,METAL)
        box(p,(.64,1.33,0),(.57,.11,.15),DARK,.05)
        box(p,(0,.57,.858),(1.16,.38,.035),'#152b32',.035)
        box(p,(0,.72,.90),(.9,.04,.045),STEEL,.012,METAL)
        for x in (-.53,0,.53):
            o=cyl(p,(x,.91,.88),.09,.07,STEEL,16,METAL);o.rotation_euler.x=math.pi/2
            box(p,(x,.94,.925),(.02,.035,.015),'#eab558',.004)
    elif kind=='oven':
        box(p,(0,1.15,0),(1.65,.15,1.66),'#bf6f42',.06)
        # Open barrel vault built from wedge bricks; no opaque mesh over the pizza.
        for row,z in enumerate((-.50,-.12,.26)):
            for i in range(9):
                a=(i+.5)*math.pi/9;o=box(p,(math.cos(a)*.66,1.26+math.sin(a)*.60,z),(.22,.28,.36),['#c88951','#d89962','#b67545'][(i+row)%3],.025);o.rotation_euler.y=a-math.pi/2
        box(p,(0,1.49,-.72),(1.23,.66,.08),'#4a3026',.05)
        box(p,(0,1.235,.35),(1.03,.045,1.03),'#e1b475',.025)
        for x in (-.38,-.12,.16,.38):ball(p,(x,1.28,-.56),(.11,.055,.10),'#f39934',12,8)
        cyl(p,(.42,2.02,-.48),.16,.46,'#9e6347');cyl(p,(.42,2.27,-.48),.24,.08,'#cc9a68')
    elif kind=='sink':
        # Four separate rim sections expose the recessed basin instead of a painted rectangle.
        for x in (-.76,.66):box(p,(x,1.15,0),(.20,.17,1.48),STEEL,.06,METAL)
        for z in (-.65,.65):box(p,(-.05,1.15,z),(1.35,.17,.18),STEEL,.045,METAL)
        box(p,(-.05,1.115,0),(1.18,.04,1.14),'#426a74',.09,METAL)
        box(p,(-.05,1.142,0),(1.02,.012,.98),'#76bec8',.07)
        cyl(p,(-.05,1.151,.05),.12,.012,STEEL,16,METAL)
        pipe(p,[(.56,1.2,-.5),(.56,1.63,-.5),(.48,1.79,-.5),(.24,1.83,-.5),(0,1.74,-.5),(0,1.61,-.5)],.055,STEEL,METAL)
        for x,c in [(.68,'#d66c51'),(.38,'#529ec0')]:cyl(p,(x,1.27,-.54),.067,.11,c,12)
        for x,z in [(-.40,-.31),(-.29,-.39),(-.44,-.44)]:ball(p,(x,1.17,z),(.055,.045,.055),'#ebfbf4',12,8)
    elif kind=='plates':
        for x in (-.6,.6):pipe(p,[(x,1.12,-.40),(x,1.65,-.40)],.035,STEEL,METAL)
        pipe(p,[(-.6,1.65,-.4),(.6,1.65,-.4)],.035,STEEL,METAL)
    elif kind=='return':
        box(p,(0,1.15,0),(1.45,.08,1.37),'#466474',.045)
        for x in (-.7,.7):box(p,(x,1.28,0),(.11,.25,1.39),'#739ab0',.02)
        for z in (-.65,.65):box(p,(0,1.28,z),(1.44,.25,.11),'#739ab0',.02)
        for i in range(8):box(p,(-.58+i*.165,1.20,0),(.055,.045,1.15),'#9cbdc7',.01)
    elif kind=='serve':
        box(p,(0,1.145,0),(1.7,.07,1.55),'#ebc579',.03)
        for x in (-.74,.74):pipe(p,[(x,1.15,-.68),(x,1.95,-.68)],.04,STEEL,METAL)
        for i in range(6):box(p,(-.75+i*.3,1.95,-.64),(.3,.10,.48),WHITE if i%2 else '#db7054',.028)
        for z in (-.1,.2):box(p,(-.52,1.19,z),(.25,.025,.32),WHITE,.01)
    elif kind=='belt':
        box(p,(0,.56,0),(1.64,.95,1.72),col,.07)
        box(p,(0,1.07,0),(1.4,.12,1.8),DARK,.05)
        for z in [-.78+i*.17 for i in range(10)]:
            o=cyl(p,(0,1.16,z),.082,1.4,'#607b79',12,METAL);o.rotation_euler.y=math.pi/2
        for x in (-.78,.78):box(p,(x,1.18,0),(.12,.18,1.8),STEEL,.03,METAL)
        for z in (-.52,0,.52):
            for x in (-.10,.10):o=box(p,(x,1.25,z),(.055,.015,.29),'#efc455',.01);o.rotation_euler.z=.65 if x<0 else -.65
    elif kind=='bin':
        lathe(p,[(.45,.06),(.61,.12),(.69,.94),(.69,1.05),(.61,1.05),(.57,.3),(0,.3)],col)
        for i in range(12):
            a=i*math.tau/12;pipe(p,[(math.cos(a)*.60,.18,math.sin(a)*.60),(math.cos(a)*.68,.96,math.sin(a)*.68)],.018,'#8fac9a')
        lid=empty('Lid',p,(0,1.1,-.55));o=cyl(lid,(0,0,.55),.71,.09,'#87a394',28);lid.rotation_euler.x=-.50
        box(p,(0,.12,.65),(.35,.10,.23),DARK,.03)
    merge_children(p)
p=asset('bell');lathe(p,[(0,0),(.26,0),(.27,.055),(.24,.08),(.23,.18),(.15,.26),(0,.27)],GOLD,24,METAL);cyl(p,(0,.3,0),.045,.10,GOLD,12,METAL);merge_children(p)
p=asset('planter');lathe(p,[(.29,0),(.39,.05),(.45,.56),(.47,.60),(.39,.63),(.36,.56),(0,.56)],'#c18059')
for i in range(13):
    a=i*2.4;leaf(p,(math.sin(a)*.12,.61+(i%3)*.11,math.cos(a)*.12),.65,.22,['#43805b','#6ca064','#95b36b'][i%3],a)
merge_children(p)
p=asset('fan');cyl(p,(0,0,0),.48,.18,DARK,24,METAL)
for i in range(4):
    blade=leaf(p,(0,.12,0),.64,.22,STEEL,i*math.pi/2);blade.data.materials[0]=METAL
cyl(p,(0,.17,0),.12,.13,GOLD,16,METAL);merge_children(p)

# Keep each asset rooted at zero in the export; presentation copies live only in the .blend.
bpy.ops.object.select_all(action='DESELECT')
for a in assets:
    a.select_set(True)
    for o in a.children_recursive:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'kitchen-kit.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True,export_attributes=False)
report={a.name:{'triangles':sum(len(o.data.loop_triangles) for o in a.children_recursive if o.type=='MESH'),'meshes':sum(o.type=='MESH' for o in a.children_recursive)} for a in assets}
# Calculate triangles after evaluating the exported meshes.
for a in assets:
    total=0
    for o in a.children_recursive:
        if o.type=='MESH':o.data.calc_loop_triangles();total+=len(o.data.loop_triangles)
    report[a.name]['triangles']=total
(ART/'asset-manifest.json').write_text(json.dumps({'source':'Original Blender-authored Kitchen Rush kit','units':'metres','up':'Y','forward':'Z','rig':'Rigid pivots: ArmL/ArmR, LegL/LegR, Head; runtime walk, carry and work poses','assets':report},indent=2)+'\n')

# Contact sheet includes every station, representative foods, and the four chefs.
selected=[a for a in assets if a.name.startswith('chef') or a.name.startswith('station_') or a.name.endswith('_raw') or a.name in ('plate','plate_dirty','bell','planter','fan') or a.name.startswith('dish_')]
for a in assets:
    for o in [a]+list(a.children_recursive):o.hide_render=True;o.hide_viewport=True
for i,a in enumerate(selected):
    c=a.copy();c.name='Preview_'+a.name;bpy.context.collection.objects.link(c);c.hide_render=False;c.hide_viewport=False
    def copy_tree(src,dst):
        for o in src.children:
            n=o.copy();n.data=o.data;n.parent=dst;bpy.context.collection.objects.link(n);n.hide_render=False;n.hide_viewport=False;copy_tree(o,n)
    copy_tree(a,c)
    x=(i%6-2.5)*2.8;y=(i//6-2)*3.0;c.location=(x,y,0)
    bpy.ops.object.text_add(location=(x,y-1.22,.04));t=bpy.context.object;t.data.body=a.name.replace('station_','').replace('_raw','');t.data.align_x='CENTER';t.data.size=.23;t.data.extrude=.001
    m=bpy.data.materials.get('Label') or bpy.data.materials.new('Label');m.diffuse_color=(.05,.085,.085,1);t.data.materials.append(m)
bpy.ops.mesh.primitive_plane_add(size=200);ground=bpy.context.object;ground.location.z=-.04;m=bpy.data.materials.new('Backdrop');m.diffuse_color=(.18,.25,.25,1);ground.data.materials.append(m)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24
scene.world.color=(.35,.35,.35)
for pos,power,size in [((-8,-6,15),2100,10),((8,3,10),1600,8)]:
    bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(8,-18,25));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,.2))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=21;scene.camera=camera
scene.view_settings.view_transform='AgX';scene.render.resolution_x=1400;scene.render.resolution_y=1200;scene.render.resolution_percentage=85;scene.render.filepath=str(PREVIEW/'kitchen-kit-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'kitchen-kit.blend'))
bpy.ops.render.render(write_still=True)
camera.location=(-5.4,-10.1,3.8);camera.rotation_euler=(Vector((-7,-6,.85))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=3.5;scene.render.resolution_x=900;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.render.filepath=str(PREVIEW/'chef-detail.png');bpy.ops.render.render(write_still=True)
print('KITCHEN_EXPORT',OUT/'kitchen-kit.glb')
