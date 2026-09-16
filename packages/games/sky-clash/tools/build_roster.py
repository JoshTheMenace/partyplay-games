"""Authored stylized replacement roster. No original meshes, textures, or animation samples."""
import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'assets'
ROSTER=json.loads((ROOT/'fidelity/roster.json').read_text())
bpy.context.preferences.filepaths.save_version=0
parts=[];materials={};scale=1

def material(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*[((int(color[i:i+2],16)/255+.055)/1.055)**2.4 for i in (0,2,4)],1);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=m.diffuse_color;bs.inputs['Roughness'].default_value=.34 if name in ['gold','metal','iris'] else .72 if name in ['main','brown'] else .48;bs.inputs['Metallic'].default_value=.55 if name in ['gold','metal'] else 0
 materials[name]=m

def finish(obj,name,mat,bone):
 obj.name=name;obj.data.materials.append(materials[mat]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);parts.append((obj,bone));return obj

def orb(name,pos,size,mat='main',bone='head'):
 segments,rings=(28,16) if max(size)>.23 else (20,12) if max(size)>.12 else (12,8)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=Vector(pos)*scale);o=bpy.context.object;o.scale=Vector(size)*scale
 for p in o.data.polygons:p.use_smooth=True
 return finish(o,name,mat,bone)

def rod(name,a,b,r1=.08,r2=None,mat='main',bone='chest'):
 if name in ['Upper arm','Forearm','Thigh','Shin','Finger']:
  a,b=Vector(a),Vector(b);length=(b-a).length;r2=r1 if r2 is None else r2
  o=loft(name,[(z*length,r,r,0) for z,r in [(0,r1*.72),(.08,r1*.95),(.3,r1),(.72,r2),(.93,r2*.9),(1,r2*.7)]],mat,bone);o.location=a*scale;o.rotation_mode='QUATERNION';o.rotation_quaternion=(b-a).to_track_quat('Z','Y');return o
 a,b=Vector(a)*scale,Vector(b)*scale;bpy.ops.mesh.primitive_cone_add(vertices=16,radius1=r1*scale,radius2=(r1 if r2 is None else r2)*scale,depth=(b-a).length,location=(a+b)/2);o=bpy.context.object;o.rotation_mode='QUATERNION';o.rotation_quaternion=(b-a).to_track_quat('Z','Y')
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 return finish(o,name,mat,bone)

def cube(name,pos,size,mat='main',bone='chest'):
 bpy.ops.mesh.primitive_cube_add(size=1,location=Vector(pos)*scale);o=bpy.context.object;o.scale=Vector(size)*scale;finish(o,name,mat,bone)
 mod=o.modifiers.new('Tailored edges','BEVEL');mod.width=min(.025,min(size)*.22)*scale;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name);return o

def loft(name,profiles,mat='main',bone='chest',pleats=0):
 # Profile rings shape shoulders, waists and cloth hems without subdivision at runtime.
 n=32;verts=[(rx*math.cos(i*math.tau/n)*scale,(cy+ry*math.sin(i*math.tau/n))*scale,(z+pleats*math.cos(i*math.tau/4))*scale) for z,rx,ry,cy in profiles for i in range(n)]
 faces=[tuple(range(n-1,-1,-1))]+[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(profiles)-1) for i in range(n)]+[tuple(range((len(profiles)-1)*n,len(profiles)*n))]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o)
 for p in mesh.polygons:p.use_smooth=len(p.vertices)==4
 return finish(o,name,mat,bone)

def seam(name,points,radius=.008,mat='gold',bone='chest'):
 for a,b in zip(points,points[1:]):rod(name,a,b,radius,mat=mat,bone=bone)

def wedge(name,pts,depth,mat='main',bone='head'):
 verts=[tuple(Vector((x,y+d,z))*scale) for d in (-depth/2,depth/2) for x,y,z in pts];n=len(pts);mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);finish(o,name,mat,bone)
 bpy.context.view_layer.objects.active=o;mod=o.modifiers.new('Finished edges','BEVEL');mod.width=min(.012,depth*.2)*scale;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name);return o

def eyes(z=1.61,y=-.23,wide=.105,big=1):
 for s in [-1,1]:
  orb('Eye white',(s*wide,y,z),(.06*big,.025,.075*big),'white')
  orb('Iris',(s*wide,y-.022,z),(.034*big,.014,.052*big),'iris')
  orb('Pupil',(s*wide,y-.033,z),(.019*big,.008,.038*big),'dark')
  orb('Catchlight',(s*wide-.009,y-.033,z+.025*big),(.009*big,.006,.018*big),'white')

def detail(r,pelvis,upper,head,shoulder,elbow,wrist):
 k,style=r['id'],r['style'];humanoid=style in ['plumber','doctor','child','sword','royal','ninja','brawler'] or k=='ganondorf'
 if humanoid:
  for s in [-1,1]:
   if style not in ['ninja','brawler']:
    orb('Ear',(s*.229,-.005,head-.01),(.065,.055,.094),'skin');orb('Ear fold',(s*.26,-.045,head-.01),(.027,.016,.047),'red')
    if s==1 and style not in ['plumber','doctor']:orb('Nose',(0,-.228,head-.045),(.043,.049,.057),'skin')
    rod('Eyebrow',(s*.05,-.239,head+.129),(s*.16,-.217,head+.124),.011,mat='gold' if style=='royal' else 'brown',bone='head')
   if style not in ['brawler','ninja','plumber','doctor']:orb('Mouth',(0,-.212,head-.14),(.04,.012,.012),'red')
  if style in ['plumber','doctor']:
   for s in [-1,1]:
    for i in range(3):orb('Moustache curl',(s*(.03+i*.045),-.291,head-.105-i*.009),(.044,.028,.025),'brown')
    orb('Sideburn',(s*.213,.01,head-.02),(.035,.13,.13),'brown')
   if style=='plumber':
    # Raised cap letter, built as geometry so it stays crisp without a texture fetch.
    z=head+.215;letter=[(-.044,z-.034),(-.044,z+.035),(0,z-.008),(.044,z+.035),(.044,z-.034)] if k=='mario' else [(-.025,z+.034),(-.025,z-.034),(.032,z-.034)]
    seam('Cap letter',[(x,-.241,z) for x,z in letter],.009,'main','head')
    cube('Bib pocket',(0,-.212,1.05),(.19,.035,.14),'blue');seam('Pocket stitch',[(-.083,-.234,1.105),(-.08,-.239,1.003),(0,-.241,.985),(.08,-.239,1.003),(.083,-.234,1.105)],.005,'gold')
   else:
    for s in [-1,1]:wedge('Coat lapel',[(s*.05,-.205,1.27),(s*.23,-.185,1.26),(s*.11,-.233,1.02)],.025,'white');rod('Stethoscope',(s*.13,-.224,1.27),(s*.12,-.245,.99),.013,mat='dark')
    orb('Stethoscope chestpiece',(.12,-.263,.98),(.041,.012,.044),'metal','chest');cube('Coat pocket',(-.15,-.211,1.11),(.11,.02,.075),'white')
  if style=='child':
   cube('Backpack',(0,.205,1.04),(.43,.19,.40),'brown');
   for s in [-1,1]:rod('Backpack strap',(s*.20,-.13,1.3),(s*.20,-.15,.87),.035,mat='brown')
  if style in ['sword','royal'] or k=='ganondorf':
   hair='hair'
   for i in range(5):
    x=(i-2)*.075;wedge('Swept fringe',[(x-.065,-.14,head+.23),(x+.06,-.16,head+.22),(x+.04,-.22,head+.06-(i%2)*.04)],.045,hair)
   cube('Belt buckle',(0,-.228,.86),(.13,.042,.09),'gold');orb('Buckle jewel',(0,-.253,.86),(.035,.014,.025),'red','chest')
   if style=='sword' or k=='ganondorf':
    for s in [-1,1]:
     orb('Shoulder mantle',(s*shoulder,0,upper+.015),(.15,.21,.115),'gold' if k=='ganondorf' else 'main','upper_arm.'+('L' if s>0 else 'R'))
     seam('Cape border',[(s*.22,.211,1.29),(s*.28,.251,.88),(s*.36,.303,.40)],.013,'gold')
    cube('Belt pouch',(.26,-.04,.77),(.13,.17,.18),'brown','pelvis');cube('Pouch clasp',(.26,-.136,.78),(.043,.014,.04),'gold','pelvis')
    for z in [.68,.73,.78]:rod('Grip binding',(-.575,-.05,z),(-.485,-.05,z),.009,mat='gold',bone='hand.R')
    if k in ['link','young-link']:
     for x,z in [(.53,.90),(.484,.82),(.576,.82)]:wedge('Shield crest',[(x-.045,-.213,z-.035),(x+.045,-.213,z-.035),(x,-.213,z+.043)],.014,'gold','hand.L')
     seam('Shield border',[(.53+.15*math.cos(i*math.tau/24),-.178,.82+.252*math.sin(i*math.tau/24)) for i in range(25)],.012,'metal','hand.L')
   if style=='royal':
    for s in [-1,1]:
     orb('Long hair',(s*.20,.13,1.41),(.14,.18,.37),hair,'head');orb('Earring',(s*.26,-.024,1.48),(.033,.032,.064),'iris')
     orb('Puffed sleeve',(s*shoulder,0,upper),(.18,.20,.18),'main','upper_arm.'+('L' if s>0 else 'R'))
    loft('Gold hem',[(.225,.497,.377,0),(.26,.508,.387,0)],'gold','pelvis',.009)
    profiles=[(.275,.507,.389),(.48,.442,.342),(.72,.322,.252),(.94,.259,.213)]
    vertices=[(rx*math.sin(a)*scale,-ry*math.cos(a)*scale,z*scale) for z,rx,ry in profiles for a in [(i-4)*.11 for i in range(9)]]
    mesh=bpy.data.meshes.new('Dress embroidery');mesh.from_pydata(vertices,[],[(j*9+i,j*9+i+1,(j+1)*9+i+1,(j+1)*9+i) for j in range(3) for i in range(8)]);mesh.update();o=bpy.data.objects.new('Dress embroidery',mesh);bpy.context.collection.objects.link(o);finish(o,'Dress embroidery','white' if k=='zelda' else 'purple','pelvis')
    for p in mesh.polygons:p.use_smooth=True
    orb('Brooch setting',(0,-.213,1.21),(.071,.026,.08),'gold','chest');orb('Brooch',(0,-.24,1.21),(.048,.014,.058),'iris','chest')
   if k=='ganondorf':
    loft('Gorget',[(1.25,.23,.20,0),(1.35,.18,.16,0)],'gold');wedge('Chest armor',[(-.26,-.20,1.21),(.26,-.20,1.21),(.20,-.225,.92),(0,-.25,.88),(-.20,-.225,.92)],.07,'dark');orb('Forehead gem',(0,-.184,1.79),(.045,.027,.065),'gold')
  if style=='ninja':
   wedge('Chest eye',[(-.13,-.218,1.16),(0,-.24,1.22),(.13,-.218,1.16),(0,-.24,1.08)],.018,'white');orb('Eye sigil',(0,-.261,1.16),(.03,.012,.04),'red','chest')
  if style=='brawler':
   cube('Chest harness',(0,-.214,1.10),(.055,.022,.32),'gold');cube('Falcon belt',(0,-.04,.85),(.49,.36,.09),'brown');cube('Buckle',(0,-.238,.85),(.15,.035,.09),'gold')
   for s in [-1,1]:orb('Helmet ear cover',(s*.235,0,1.65),(.055,.10,.11),'gold');orb('Chest muscle',(s*.13,-.15,1.12),(.145,.075,.14),'main','chest')
 if style=='armored':
  for s in [-1,1]:
   seam('Shoulder channel',[(s*(shoulder-.10),-.17,upper+.06),(s*shoulder,-.202,upper+.07),(s*(shoulder+.10),-.17,upper+.06)],.012,'dark','upper_arm.'+('L' if s>0 else 'R'))
   orb('Chest power light',(s*.17,-.293,1.16),(.022,.012,.063),'green','chest')
  for z in [.64,.71,.78,.85]:rod('Cannon sleeve',(-.51,-.02,z),(-.51,-.02,z+.025),.147,mat='metal',bone='forearm.R')
  cube('Helmet ridge',(0,-.013,1.79),(.075,.30,.035),'red','head');orb('Cannon bore',(-.51,-.02,.568),(.064,.064,.013),'green','forearm.R')
 if k in ['bowser','giga-bowser']:
  for obj,_ in parts:
   if obj.name.startswith(('Eye white','Iris','Pupil','Catchlight')):obj.scale.z=.72
   if obj.name.startswith('Angry brow'):obj.rotation_euler.y=-.24 if obj.location.x>0 else .24
  for s in [-1,1]:
   orb('Nostril',(s*.14,-.586,1.47),(.035,.014,.022),'brown');rod('Jaw line',(s*.05,-.60,1.35),(s*.25,-.52,1.36),.01,mat='brown',bone='head')
   for z in [.73,1.04,1.32]:orb('Shell plate',(s*.25,.477,z),(.22,.071,.18),'green','chest')
   suffix='L' if s>0 else 'R';rod('Wrist band',(s*wrist[0],-.05,wrist[2]),(s*(wrist[0]-.035),-.035,wrist[2]+.09),.165,mat='dark',bone='forearm.'+suffix)
   for x in [-.09,0,.09]:rod('Wrist spike',(s*wrist[0]+x,-.20,wrist[2]+.035),(s*wrist[0]+x,-.28,wrist[2]+.045),.033,0,'metal','forearm.'+suffix)
  loft('Spiked collar',[(1.30,.285,.25,-.02),(1.37,.285,.25,-.02)],'dark','neck')
  rod('Shell center seam',(0,.538,.72),(0,.538,1.4),.017,mat='brown');rod('Tail',(0,.22,.57),(0,.68,.19),.19,.025,'main','tail.01')
 if k=='donkey-kong':
  for s in [-1,1]:
   orb('Brow ridge',(s*.11,-.248,1.755),(.14,.078,.047),'main');orb('Nostril',(s*.075,-.447,1.46),(.027,.014,.025),'brown')
   for i in range(3):rod('Shoulder fur',(s*(.34+i*.045),.07,1.30),(s*(.46+i*.055),.09,1.12),.068,0,'main','upper_arm.'+('L' if s>0 else 'R'))
  seam('Mouth',[(-.18,-.41,1.36),(0,-.455,1.34),(.18,-.41,1.36)],.009,'brown','head')
 if style=='rodent':
  seam('Smile',[(-.10,-.329,1.14),(-.045,-.35,1.12),(0,-.357,1.15),(.045,-.35,1.12),(.10,-.329,1.14)],.009,'brown','head')
  for z in [.69,.85]:loft('Back stripe',[(z,.26,.24,.04),(z+.045,.28,.24,.04)],'brown')
 if style=='dinosaur':
  for s in [-1,1]:orb('Nostril',(s*.14,-.704,1.47),(.028,.015,.035),'green')
 if style=='alien':
  for s in [-1,1]:orb('Eye ridge',(s*.10,-.20,1.71),(.13,.06,.045),'main')
 if style=='climber':
  for i in range(18):
   a=i*math.tau/18;orb('Soft hood fur',(.35*math.cos(a),-.232,1.4+.36*math.sin(a)),(.06,.07,.07),'white')
  for z in [.62,.79,.96]:cube('Parka toggle',(0,-.282,z),(.084,.026,.026),'brown')
  for x in [-.69,-.35]:rod('Hammer binding',(x,-.05,.96),(x,-.05,1.20),.022,mat='metal',bone='hand.R')
 if style=='bag':
  for z in [.42,.64,.86,1.08,1.30,1.51]:
   seam('Cross stitch',[(-.032,-.335,z-.018),(.032,-.337,z+.018)],.005,'brown');seam('Cross stitch',[(.032,-.335,z-.018),(-.032,-.337,z+.018)],.005,'brown')
 if style in ['round','flat','bag','hand','wire']:return
 # Rounded joint covers, thumbs and layered footwear reduce the stick-figure silhouette.
 for s,suffix in [(-1,'R'),(1,'L')]:
  heavy=style=='heavy';skin='skin' if k=='donkey-kong' or style=='child' else 'white' if style in ['plumber','doctor','climber','royal'] else 'main'
  orb('Elbow joint',(s*elbow[0],0,elbow[2]),(.145 if heavy else .105,.104,.108),'main','forearm.'+suffix)
  orb('Thumb',(s*(wrist[0]-.065),-.10,wrist[2]-.035),(.06,.065,.084),skin,'hand.'+suffix)
  for i in range(3):orb('Knuckle',(s*(wrist[0]-.065+i*.055),-.108,wrist[2]-.08),(.03,.035,.035),skin,'hand.'+suffix)
  if style not in ['rodent','alien','dinosaur'] and not (heavy and k!='ganondorf'):
   boot='brown' if style in ['plumber','doctor','sword','child'] else 'metal' if style=='armored' else 'main'
   rod('Boot shaft',(s*.205,0,.12),(s*.195,0,.37),.125,.12,boot,'shin.'+suffix);orb('Boot tongue',(s*.21,-.087,.25),(.097,.055,.105),boot,'shin.'+suffix)
   orb('Sole',(s*.22,-.12,.045),(.145,.283,.036),'dark','foot.'+suffix)
   for z in [.20,.25,.30]:cube('Boot lace',(s*.21,-.145,z),(.10,.012,.012),'gold' if style in ['sword','brawler','armored'] else 'white','shin.'+suffix)
  if style in ['ninja','brawler','sword','royal','armored'] or k=='ganondorf':
   rod('Gauntlet cuff',(s*wrist[0],-.05,wrist[2]),(s*(wrist[0]-.028),-.04,wrist[2]+.065),.116,.12,'gold' if style!='ninja' else 'white','forearm.'+suffix)

def build(r):
 global parts,materials,scale
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);parts=[];materials={};scale=r['height']/1.92
 for name,color in [('main',r['color'][1:]),('skin','F2C7A3'),('white','F5EEE1'),('dark','232638'),('gold','E7B943'),('red','C54143'),('green','408355'),('blue','30548C'),('brown','58382B'),('purple','684894'),('metal','ADBCC9'),('iris','3778A6')]:material(name,color)
 k=r['id'];style=r['style'];roundbody=style in ['round','rodent','climber'];wide=style=='heavy';wire=style=='wire'
 if style in ['sword','royal'] or k=='ganondorf':material('hair','D5A848' if k in ['link','young-link','peach','zelda'] else 'A63F2E' if k in ['roy','ganondorf'] else '294E83')
 if style=='armored':
  for name in ['main','red','green']:
   bs=materials[name].node_tree.nodes.get('Principled BSDF');bs.inputs['Metallic'].default_value=.4;bs.inputs['Roughness'].default_value=.33
 # Canonical rig, with shorter legs and broader head pivots for compact characters.
 pelvis=.5 if roundbody else .77;chest=.82 if roundbody else 1.08;head=1.24 if roundbody else 1.58
 shoulder=.39 if wide else .31;upper=1.2 if not roundbody else .85;elbow=(shoulder+.16,.0,upper-.25);wrist=(shoulder+.22,-.05,upper-.46)
 if style not in ['hand','bag']:
  if style=='round':
   orb('Round body',(0,0,.99),(.69,.49,.72),'main','chest');eyes(1.22,-.463,.16,1.55)
   if k=='jigglypuff':
    for s in [-1,1]:wedge('Pointed ear',[(s*.35,0,1.47),(s*.61,0,1.87),(s*.65,0,1.37)],.16);wedge('Ear lining',[(s*.43,-.1,1.49),(s*.59,-.1,1.78),(s*.60,-.1,1.43)],.025,'dark')
    orb('Forehead curl',(-.1,-.40,1.69),(.22,.13,.20));orb('Curl tip',(.08,-.49,1.67),(.11,.09,.10))
   else:
    for s in [-1,1]:orb('Blush',(s*.35,-.443,1.0),(.105,.035,.045),'red')
   orb('Smile',(0,-.495,.95),(.04,.015,.035),'dark')
  elif style=='dinosaur':
   orb('Body',(0,.07,.89),(.39,.29,.48),'main','chest');orb('Belly',(0,-.18,.8),(.31,.12,.35),'white','chest');orb('Head',(0,-.10,1.47),(.32,.27,.35));orb('Round muzzle',(0,-.43,1.35),(.37,.35,.27));eyes(1.69,-.3,.14,1.3)
   orb('Saddle',(0,.36,.9),(.24,.12,.24),'red','chest');rod('Tail',(0,.25,.6),(0,.7,.38),.16,0,'main','tail.01')
   for z in [1.2,1.42,1.63]:rod('Back crest',(0,.18,z),(0,.34,z+.09),.08,0,'red','head')
  elif style=='heavy' and k=='donkey-kong':
   orb('Gorilla chest',(0,0,1.1),(.5,.31,.50),'main','chest');orb('Chest patch',(0,-.25,1.05),(.33,.10,.35),'skin','chest');orb('Head',(0,-.04,1.58),(.30,.27,.29));orb('Muzzle',(0,-.29,1.43),(.31,.16,.18),'skin');eyes(1.68,-.27,.105)
   wedge('Hair peak',[(-.16,0,1.75),(0,0,1.92),(.15,0,1.74)],.18);wedge('Tie',[(-.1,-.37,1.20),(.1,-.37,1.20),(.16,-.39,.83),(0,-.41,.70),(-.16,-.39,.83)],.03,'red','chest');cube('Tie monogram',(0,-.423,.97),(.12,.01,.07),'gold')
  elif style=='heavy' and k in ['bowser','giga-bowser']:
   orb('Shell',(0,.22,1.0),(.51,.30,.56),'green','chest');orb('Shell rim',(0,.13,1.0),(.57,.18,.6),'white','chest');orb('Body',(0,-.09,.98),(.48,.31,.51),'main','chest');orb('Belly',(0,-.34,.94),(.34,.08,.37),'skin','chest')
   for z in [.75,.94,1.13]:cube('Belly plate',(0,-.416,z),(.5,.016,.024),'brown')
   for x,z in [(-.35,.80),(.35,.80),(-.30,1.18),(.30,1.18),(0,1.48)]:rod('Shell spike',(x,.42,z),(x*1.25,.75,z+.10),.1,0,'white','chest')
   orb('Head',(0,-.1,1.55),(.34,.27,.28));orb('Muzzle',(0,-.40,1.42),(.37,.21,.18),'skin');eyes(1.66,-.33,.16)
   for s in [-1,1]:rod('Horn',(s*.25,-.06,1.69),(s*.41,-.04,1.91),.105,0,'white','head');rod('Fang',(s*.22,-.48,1.47),(s*.22,-.49,1.35),.055,0,'white','head');cube('Angry brow',(s*.16,-.35,1.76),(.21,.07,.055),'red','head')
   for i in range(3):wedge('Flame hair',[(-.09,.05+i*.10,1.72),(0,.03+i*.10,1.91),(.09,.05+i*.10,1.72)],.06,'red')
  elif style=='rodent':
   orb('Body',(0,0,.78),(.35,.28,.42),'main','chest');orb('Head',(0,-.03,1.30),(.43,.32,.35));eyes(1.36,-.33,.17)
   for s in [-1,1]:
    rod('Tall ear',(s*.24,0,1.50),(s*.40,.02,1.90),.10,.055,'main','head');rod('Black ear tip',(s*.36,.015,1.80),(s*.40,.02,1.94),.069,.045,'dark','head');orb('Cheek',(s*.3,-.28,1.16),(.09,.033,.078),'red');
   orb('Nose',(0,-.357,1.23),(.038,.02,.025),'dark');wedge('Lightning tail',[(0,.35,.5),(.35,.35,.82),(.23,.35,1.01),(.55,.35,1.19),(.7,.35,1.09),(.43,.35,.91),(.54,.35,.77),(.09,.35,.38)],.1,'gold','tail.01')
   if k=='pichu':wedge('Collar',[(-.27,-.24,1.0),(0,-.31,.8),(.27,-.24,1.0)],.08,'dark','neck')
  elif style=='alien':
   orb('Torso',(0,0,1.07),(.27,.18,.36),'main','chest');orb('Haunches',(0,0,.70),(.35,.23,.25),'purple','pelvis');orb('Head',(0,-.04,1.60),(.24,.22,.24));orb('Muzzle',(0,-.23,1.48),(.19,.14,.1));eyes(1.63,-.234,.11)
   for s in [-1,1]:rod('Head horn',(s*.14,.06,1.7),(s*.21,.08,1.92),.073,.04,'main','head')
   rod('Tail base',(0,.13,.70),(0,.54,.38),.12,.14,'purple','tail.01');rod('Tail sweep',(0,.54,.38),(.20,.85,.57),.14,.09,'purple','tail.02');rod('Tail tip',(.20,.85,.57),(.32,.91,1.10),.09,.02,'purple','tail.03')
  elif style=='flat':
   orb('Flat body',(0,0,1.0),(.25,.065,.36),'dark','chest');orb('Flat head',(0,-.005,1.57),(.3,.055,.28),'dark');orb('Long nose',(.29,-.005,1.58),(.17,.055,.075),'dark');cube('Cap brim',(0,-.01,1.80),(.68,.14,.075),'dark','head');orb('Cap',(0,0,1.83),(.25,.07,.12),'dark')
  else:
   torso='white' if style=='doctor' else 'blue' if style=='plumber' else 'gold' if style=='child' else 'main'
   width=.36 if wide else .30
   loft('Tailored torso',[(pelvis-.02,.23,.16,0),(chest-.10,width*.94,.21,0),(upper-.02,width,.19,0),(upper+.08,.19,.14,0),(upper+.12,.13,.12,0)],torso);orb('Pelvis',(0,0,pelvis),(.24,.18,.19),'blue' if style=='child' else torso,'pelvis')
   if not wire:
    orb('Head',(0,-.015,head),(.235,.21,.26),'main' if style=='armored' else 'skin')
    if style not in ['armored','brawler']:eyes(head+.035,-.219)
   else:
    # A rounded triangulated cage follows a head silhouette rather than straight bucket struts.
    rings=[(1.37,.13),(1.45,.215),(1.60,.24),(1.73,.18),(1.82,.055)]
    for j,(z,rad) in enumerate(rings):
     for i in range(12):
      a=i*math.tau/12;b=(i+1)*math.tau/12
      point=(rad*math.cos(a),rad*math.sin(a),z);rod('Head cage',point,(rad*math.cos(b),rad*math.sin(b),z),.011,mat='main',bone='head')
      if j:
       pz,pr=rings[j-1];rod('Head diagonal',point,(pr*math.cos(b),pr*math.sin(b),pz),.009,mat='main',bone='head')
    # Keep internal silhouette dark so the bright cage reads clearly at game distance.
    for z in [.87,1.04,1.21]:
     for s in [-1,1]:rod('Torso cage',(s*.27,-.2,z),(-s*.27,-.2,z+.05),.017,mat='white')
   if style in ['plumber','doctor','child','climber','sword','royal','ninja','armored','brawler'] or k=='ganondorf':
    if style in ['plumber','doctor','child']:
     orb('Nose',(0,-.255,head-.04),(.092,.10,.075),'skin')
     if style!='child':
      for s in [-1,1]:orb('Moustache',(s*.075,-.269,head-.12),(.089,.035,.033),'brown')
     if style=='doctor':
      rod('Headband',(-.22,-.02,1.72),(.22,-.02,1.72),.035,mat='dark',bone='head');orb('Reflector mirror',(.08,-.235,1.78),(.105,.034,.105),'white');orb('Mirror center',(.08,-.27,1.78),(.03,.015,.03),'dark')
     else:
      orb('Cap',(0,.005,head+.18),(.26,.22,.12),'main');cube('Cap brim',(0,-.23,head+.12),(.42,.25,.04),'main','head');orb('Cap badge',(0,-.212,head+.215),(.075,.025,.068),'white')
     if style=='plumber':
      for s in [-1,1]:cube('Overall strap',(s*.16,-.17,1.18),(.075,.07,.34),'blue');orb('Overall button',(s*.16,-.214,1.13),(.032,.018,.032),'gold','chest')
     if style=='child':
      for z in [.96,1.10]:loft('Shirt stripe',[(z,.29,.212,0),(z+.065,.29,.212,0)],'blue')
    if style=='climber':
     orb('Parka',(0,0,.78),(.39,.28,.41),'main','chest');orb('Hood',(0,.02,1.40),(.44,.34,.44));orb('Hood trim',(0,-.20,1.4),(.365,.16,.37),'white');orb('Face',(0,-.31,1.4),(.255,.06,.27),'skin');eyes(1.44,-.375,.115)
     rod('Hammer handle',(-.52,-.05,.4),(-.52,-.05,1.10),.04,mat='brown',bone='hand.R');rod('Hammer head',(-.70,-.05,1.08),(-.34,-.05,1.08),.15,mat='brown',bone='hand.R');
    if style in ['sword','royal'] or k=='ganondorf':
     hair='hair'
     orb('Hair',(0,.07,head+.10),(.25,.20,.2),hair)
     for s in [-1,1]:wedge('Hair lock',[(s*.17,-.16,head+.2),(s*.24,-.16,head-.20),(s*.27,0,head+.1)],.07,hair)
     if k in ['link','young-link']:
      rod('Pointed cap',(0,.07,1.76),(0,.49,1.49),.23,0,'green','head');
      for s in [-1,1]:wedge('Elf ear',[(s*.20,0,1.65),(s*.40,0,1.73),(s*.24,0,1.53)],.06,'skin')
     if style=='royal':
      loft('Sculpted skirt',[(.22,.49,.37,0),(.28,.50,.38,0),(.48,.43,.33,0),(.72,.31,.24,0),(1.02,.23,.19,0)],'main','pelvis',.009);rod('Crown',(0,0,1.79),(0,0,1.86),.20,.19,'gold','head')
      for s in [-1,0,1]:rod('Crown point',(s*.13,-.08,1.85),(s*.13,-.08,1.94),.043,0,'gold','head');orb('Crown jewel',(0,-.197,1.84),(.04,.022,.04),'red')
     else:
      loft('Tunic hem',[(.66,.31,.22,.01),(.72,.29,.20,0),(.86,.23,.18,0)],'main','pelvis');wedge('Cape',[(-.24,.18,1.3),(.24,.18,1.3),(.37,.27,.39),(-.37,.27,.39)],.04,'purple' if k=='ganondorf' else 'main','chest');cube('Belt',(0,-.03,.85),(.49,.36,.065),'brown')
     if style=='sword':
      rod('Sword grip',(-.53,-.05,.59),(-.53,-.05,.88),.045,mat='brown',bone='hand.R');cube('Sword guard',(-.53,-.05,.85),(.28,.1,.06),'gold','hand.R');wedge('Sword blade',[(-.585,-.05,.88),(-.585,-.05,1.60),(-.53,-.05,1.79),(-.475,-.05,1.6),(-.475,-.05,.88)],.035,'white','hand.R')
      if k in ['link','young-link']:orb('Shield',(.53,-.12,.82),(.18,.08,.29),'blue','hand.L')
    if style=='ninja':
     orb('Head wrap',(0,.025,1.71),(.24,.21,.14),'white');cube('Mask',(0,-.205,1.51),(.35,.055,.17),'white','head');cube('Eye emblem',(0,-.204,1.14),(.18,.055,.19),'red')
    if style=='armored':
     cube('Visor',(0,-.208,1.62),(.32,.09,.115),'green','head');orb('Chest plate',(0,-.13,1.12),(.29,.17,.26),'red','chest');rod('Arm cannon',(-.51,-.02,.59),(-.51,-.02,1.04),.14,mat='green',bone='forearm.R');orb('Muzzle opening',(-.51,-.02,.57),(.10,.10,.025),'dark','forearm.R')
    if style=='brawler':
     orb('Helmet',(0,0,1.66),(.25,.22,.25),'red');cube('Visor',(0,-.217,1.67),(.36,.04,.12),'gold','head');wedge('Falcon crest',[(-.14,-.23,1.82),(0,-.24,1.72),(.14,-.23,1.82)],.02,'gold');cube('Scarf',(0,-.025,1.35),(.30,.25,.08),'gold','neck')
  # All ordinary bodies have independently weighted limbs, including compact characters.
  for s,suffix in [(-1,'R'),(1,'L')]:
   flat=.09 if style=='flat' else 1;limbmat='dark' if style=='flat' else 'main';armrad=.19 if wide else .115
   if style=='round':orb('Round arm',(s*.66,0,.90),(.23,.20,.23),'main','upper_arm.'+suffix)
   else:
    a=(s*shoulder,0,upper);e=(s*elbow[0],0,elbow[2]);w=(s*wrist[0],-.05,wrist[2]);rod('Upper arm',a,e,armrad,mat=limbmat,bone='upper_arm.'+suffix);rod('Forearm',e,w,armrad*.9,mat=limbmat,bone='forearm.'+suffix);orb('Hand',(w[0],w[1],w[2]-.035),(.12 if wide else .085,.08*flat,.105),'skin' if k=='donkey-kong' else 'white' if style in ['plumber','doctor','climber'] else limbmat,'hand.'+suffix)
   hip=(s*.16,0,pelvis);knee=(s*.19,-.01,pelvis*.55);ankle=(s*.21,0,.13)
   legmat='blue' if style in ['plumber','child'] else 'white' if style=='doctor' else limbmat
   rod('Thigh',hip,knee,.16 if wide else .12,mat=legmat,bone='thigh.'+suffix);rod('Shin',knee,ankle,.12 if wide else .10,mat=legmat,bone='shin.'+suffix)
   orb('Foot',(s*.22,-.12,.11),(.23 if roundbody or wide else .14,.29*flat,.105),'red' if style in ['round','dinosaur'] else 'brown' if style in ['plumber','doctor','sword','child'] else limbmat,'foot.'+suffix)
   if style=='armored':orb('Shoulder armor',(s*shoulder,0,upper),(.2,.2,.19),'main','upper_arm.'+suffix)
   if wide and k!='donkey-kong':
    for i in [-1,0,1]:rod('Toe claw',(s*.22+i*.065,-.29,.11),(s*.22+i*.065,-.43,.05),.035,0,'white','foot.'+suffix)
 else:
  if style=='bag':
   rod('Stuffed bag',(0,0,.22),(0,0,1.60),.38,.32,'white','chest');orb('Bag bottom',(0,0,.24),(.38,.34,.24),'white','pelvis');orb('Bag top',(0,0,1.61),(.32,.29,.25),'white','head');eyes(1.39,-.318,.13,1.5)
   for z in [.48,.67,.86,1.05,1.24,1.43]:cube('Stitch',(0,.322,z),(.11,.02,.025),'brown','chest')
  else:
   orb('Glove palm',(0,0,.84),(.40,.20,.47),'white','chest');rod('Cuff',(0,.015,.04),(0,.015,.43),.31,.28,'white','pelvis');rod('Cuff seam',(0,0,.10),(0,0,.15),.32,mat='purple',bone='pelvis')
   for i,length in enumerate([.58,.75,.83,.68]):
    x=(i-1.5)*.18;z=1.07;bone='forearm.R' if i<2 else 'forearm.L';rod('Finger',(x,0,z),(x+(x*.12),-.025,z+length),.09,.073,'white',bone);orb('Fingertip',(x+x*.12,-.025,z+length),(.073,.078,.085),'white',bone)
    for j in [1,2]:cube('Finger crease',(x,-.093,z+length*j/3),(.085,.008,.012),'purple',bone)
   rod('Thumb',(-.29,0,.66),(-.64,-.01,1.0),.13,.10,'white','hand.R');orb('Thumb tip',(-.64,-.01,1.0),(.1,.11,.11),'white','hand.R')
 detail(r,pelvis,upper,head,shoulder,elbow,wrist)
 # Rig is shared by name, not copied pose data. All geometry has explicit rigid bone weights.
 arm=bpy.data.armatures.new('AuthoredSkeleton');rig=bpy.data.objects.new(k+'Rig',arm);bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
 def bone(name,a,b,parent=None):
  v=arm.edit_bones.new(name);v.head=Vector(a)*scale;v.tail=Vector(b)*scale
  if parent:v.parent=arm.edit_bones[parent]
 bone('root',(0,0,0),(0,0,.18));bone('pelvis',(0,0,pelvis),(0,0,pelvis+.17),'root');bone('chest',(0,0,pelvis+.17),(0,0,upper+.07),'pelvis');bone('neck',(0,0,upper+.07),(0,0,head-.15),'chest');bone('head',(0,0,head-.15),(0,0,head+.2),'neck')
 for s,suffix in [(-1,'R'),(1,'L')]:
  bone('upper_arm.'+suffix,(s*shoulder,0,upper),(s*elbow[0],0,elbow[2]),'chest');bone('forearm.'+suffix,(s*elbow[0],0,elbow[2]),(s*wrist[0],-.05,wrist[2]),'upper_arm.'+suffix);bone('hand.'+suffix,(s*wrist[0],-.05,wrist[2]),(s*wrist[0],-.05,wrist[2]-.10),'forearm.'+suffix)
  bone('thigh.'+suffix,(s*.16,0,pelvis),(s*.19,-.01,pelvis*.55),'pelvis');bone('shin.'+suffix,(s*.19,-.01,pelvis*.55),(s*.21,0,.13),'thigh.'+suffix);bone('foot.'+suffix,(s*.21,0,.13),(s*.21,-.23,.07),'shin.'+suffix)
 bone('tail.01',(0,.1,.70),(0,.35,.46),'pelvis');bone('tail.02',(0,.35,.46),(0,.66,.55),'tail.01');bone('tail.03',(0,.66,.55),(0,.85,.93),'tail.02');bpy.ops.object.mode_set(mode='OBJECT')
 for obj,name in parts:
  group=obj.vertex_groups.new(name=name);group.add(list(range(len(obj.data.vertices))),1,'REPLACE');mod=obj.modifiers.new('Skeleton','ARMATURE');mod.object=rig;obj.parent=rig
 bpy.ops.object.select_all(action='DESELECT')
 for obj,_ in parts:obj.select_set(True)
 bpy.context.view_layer.objects.active=parts[0][0];bpy.ops.object.join();body=bpy.context.object;body.name=k+'Mesh'
 if k=='crazy-hand':rig.scale.x=-1
 rig['provenance']='Authored Blender replacement; no original model or animation assets';rig['collision']='Authored capsule, not original bone collision';bpy.ops.object.select_all(action='DESELECT');body.select_set(True);rig.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(OUT/(k+'-replacement.glb')),export_format='GLB',use_selection=True,export_animations=False,export_yup=True,export_texcoords=False)
 body.data.calc_loop_triangles();(OUT/(k+'-metadata.json')).write_text(json.dumps({'authored':True,'originalAsset':False,'bones':[b.name for b in arm.bones],'triangles':len(body.data.loop_triangles),'materials':len(body.data.materials),'height':r['height'],'glbBytes':(OUT/(k+'-replacement.glb')).stat().st_size},indent=2)+'\n')
 bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(k+'-replacement.blend')))

def portrait(r,existing=False):
 if existing:
  bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);bpy.ops.import_scene.gltf(filepath=str(OUT/(r['id']+'-replacement.glb')))
  # Imported glTF in Blender has Z-up conversion already.
 scene=bpy.context.scene;scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.10,.12,.18,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
 h=r['height']
 for name,pos,power,color in [('Key',(-3,-4,5),500,(1,.9,.8)),('Fill',(3,-2,3),300,(.7,.83,1)),('Rim',(1,3,4),600,(.9,.75,1))]:
  data=bpy.data.lights.new(name,'AREA');data.energy=power;data.size=4;data.color=color;o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,h*.5))-o.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.camera_add(location=(2.5,-6,h*1.12));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,h*.49))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=h*1.27;scene.camera=cam
 scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/(r['id']+'-portrait.png'));bpy.ops.render.render(write_still=True)

selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
for r in ROSTER:
 if selected and r['id'] not in selected:continue
 if r['id'] not in ['fox','falco']:build(r)
 portrait(r,r['id'] in ['fox','falco']);print('ROSTER_ASSET_DONE',r['id'],flush=True)
 bpy.data.orphans_purge(do_recursive=True)
