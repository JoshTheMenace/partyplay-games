"""Build the small game sound bank from Kenney CC0 packs plus original synthesis.
Usage: python3 build_sounds.py /path/to/impact.zip /path/to/rpg.zip
Requires ffmpeg. The downloaded packs are inputs, not shipped with the game.
"""
from pathlib import Path
import math, random, struct, subprocess, sys, tempfile, wave, zipfile
out = Path(__file__).resolve().parents[4] / 'public/games/blockwild/sounds'
out.mkdir(parents=True, exist_ok=True)
packs = dict(zip(('impact', 'rpg'), map(zipfile.ZipFile, sys.argv[1:3])))
with tempfile.TemporaryDirectory() as temp:
    def sample(pack, source, name):
        src = Path(temp) / 'source.ogg'
        src.write_bytes(packs[pack].read('Audio/' + source + '.ogg'))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', str(out / (name + '.wav'))], check=True)
    for material, source in {'grass':'grass', 'stone':'concrete', 'snow':'snow', 'wood':'wood', 'cloth':'carpet'}.items():
        for n in range(3): sample('impact', f'footstep_{source}_{n:03}', f'step-{material}-{n}')
    for material, source in {'stone':'Mining', 'wood':'Wood_medium', 'soft':'Soft_medium', 'glass':'Glass_heavy', 'metal':'Metal_medium', 'hit':'Punch_medium'}.items():
        for n in range(3): sample('impact', f'impact{source}_{n:03}', f'impact-{material}-{n}')
    for name, source in {'select':'metalClick', 'open':'bookOpen', 'close':'bookClose', 'chest-open':'doorOpen_1', 'chest-close':'doorClose_1', 'craft':'chop', 'pickup':'handleSmallLeather', 'sleep':'cloth1', 'swish':'knifeSlice'}.items():
        sample('rpg', source, name)
for pack, archive in packs.items():
    (out / f'LICENSE-Kenney-{pack}.txt').write_text('\n'.join(line.rstrip() for line in archive.read('License.txt').decode().splitlines()) + '\n')

# Original, deterministic sound textures. No Minecraft recordings or melodies.
rate = 24000
rng = random.Random(8193)
def write(name, seconds, render):
    low = 0.0
    values = []
    for i in range(round(seconds * rate)):
        t = i / rate
        noise = rng.uniform(-1, 1)
        low += .07 * (noise - low)
        edge = min(1, t * 120, (seconds - t) * 100)
        values.append(render(t, noise, low) * max(0, edge))
    peak = max(max(map(abs, values)), .01)
    with wave.open(str(out / (name + '.wav')), 'wb') as wav:
        wav.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        wav.writeframes(b''.join(struct.pack('<h', round(v / peak * 23000)) for v in values))
for n in range(3):
    hz = 65 + n * 9
    write(f'zombie-{n}', 1.15, lambda t, noise, low: (math.sin(2*math.pi*(hz*t+1.5*math.sin(t*7))) * .35 + math.sin(2*math.pi*hz*t*2.03)*.13 + low*.7) * (.55+.45*math.sin(t*13)**2) * math.sin(math.pi*t/1.15)**.8)
    write(f'spider-{n}', .65, lambda t, noise, low: (noise-low)*max(0, math.sin(t*(60+n*9)))**6*math.exp(-t*3))
    write(f'skeleton-{n}', .7, lambda t, noise, low: (math.sin(t*3200)+math.sin(t*5371))*.1*math.exp(-((t*(7+n))%1)*12)*math.exp(-t*3)+noise*.04*math.exp(-t*8))
write('fuse', 2, lambda t,n,l: (n-l)*(.55+.12*math.sin(t*47)))
write('fire', 3, lambda t,n,l: l*.45 + n*(.16 if rng.random()>.998 else .003))
write('water', 3, lambda t,n,l: l*(.6+.2*math.sin(t*4)) + math.sin(t*600+math.sin(t*19)*8)*.018)
write('splash', .65, lambda t,n,l: (l*.7+n*.16)*math.exp(-t*5))
write('explode', 1.3, lambda t,n,l: (l*2+n*.22+math.sin(2*math.pi*(65*t-15*t*t))*.18)*math.exp(-t*5))
write('bow', .38, lambda t,n,l: (math.sin(2*math.pi*(170*t+35*t*t))*.3 + n*.09)*math.exp(-t*15))
print(f'{len(list(out.glob("*.wav")))} mono WAV sounds written to {out}')
