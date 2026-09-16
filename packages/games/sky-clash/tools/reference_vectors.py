"""Generate float32 helper probes from the pinned decompilation using native C.
This is a helper-level cross-language check, not a GameCube gameplay oracle.
"""
import hashlib,json,random,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
source=Path(sys.argv[1]).read_text()
if hashlib.sha256(source.encode()).hexdigest() != 'b402878d6b9d9f8059d4751f0af557084a4efca54939da5c3e3534b3c44c3137':
    raise SystemExit('Unexpected decompilation physics source')
NAMES=['ftCommon_CalcSelfAccel_Deaccel','ftCommon_CalcSelfAccel_AccelToVelClampedFrom','ftCommon_CalcSelfAccel_DriftFrom','ftCommon_Fall']
def function(name):
    start=source.index('void '+name+'(');a=source.index('{',start);depth=1;b=a+1
    while depth:
        depth+=(source[b]=='{')-(source[b]=='}');b+=1
    return source[start:b]
code='''#include <stdio.h>
#include <math.h>
#define ABS(x) fabsf(x)
typedef struct {float air_drift_stick_mul,aerial_drift_base,air_drift_max,aerial_friction,air_max_horizontal_velocity;} ftCo_DatAttrs;
typedef struct {float x,y,z;} Vec3;
typedef struct {Vec3 self_vel,x74_self_accel;ftCo_DatAttrs co_attrs;struct {Vec3 lstick[1];} input;} Fighter;
'''+ '\n'.join(function(n) for n in NAMES)+'''
int main(void){float vx,stick,vy;while(scanf("%f %f %f",&vx,&stick,&vy)==3){
 Fighter fp={0};fp.self_vel.x=vx;fp.self_vel.y=vy;fp.input.lstick[0].x=stick;
 fp.co_attrs=(ftCo_DatAttrs){0.06f,0.02f,0.83f,0.02f,3.0f};
 ftCommon_CalcSelfAccel_DriftFrom(&fp,vx);ftCommon_Fall(&fp,0.23f,2.8f);
 printf("%.9g %.9g\\n",fp.x74_self_accel.x,fp.self_vel.y);}}
'''
rng=random.Random(102)
vectors=[(v,s,y) for v in (-4,-3,-.84,-.83,-.02,0,.02,.83,.84,3,4) for s in (-1,-.5,0,.5,1) for y in (-3,-2.6,0,3.68)]
vectors += [(rng.uniform(-5,5),rng.uniform(-1,1),rng.uniform(-4,5)) for _ in range(100)]
with tempfile.TemporaryDirectory() as temp:
    c=Path(temp)/'reference.c';exe=Path(temp)/'reference';c.write_text(code)
    subprocess.run(['cc','-std=c11','-O0','-ffp-contract=off',str(c),'-o',str(exe)],check=True)
    lines=subprocess.check_output([str(exe)],input='\n'.join(' '.join(map(str,v)) for v in vectors).encode()).decode().splitlines()
assert len(vectors)==len(lines)
output={'sourceCommit':'d504219dba4a5c5350aecd8e2f4969adeacb8b72','sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'functions':NAMES,'oracle':'Native C, -O0 -ffp-contract=off. Not PowerPC or full simulation parity.','vectors':[{'input':v,'output':list(map(float,l.split()))} for v,l in zip(vectors,lines)]}
prefix=json.dumps({k:v for k,v in output.items() if k!='vectors'},indent=2)[:-2]
text=prefix+',\n  \"vectors\": [\n'+',\n'.join('    '+json.dumps(v,separators=(',', ':')) for v in output['vectors'])+'\n  ]\n}\n'
(ROOT/'tests'/'reference-vectors.json').write_text(text);print(f'Wrote {len(vectors)} native C comparison vectors')
