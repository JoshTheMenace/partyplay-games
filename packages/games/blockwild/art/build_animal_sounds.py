"""Original synthesized animal calls, not Minecraft samples."""
from pathlib import Path
import math, random, struct, wave
out=Path(__file__).resolve().parents[4]/"public/games/blockwild/sounds"
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
write('cow', 1.2, lambda t,n,l: (math.sin(2*math.pi*(95*t+5*math.sin(t*2)))+.25*math.sin(2*math.pi*285*t))*math.sin(math.pi*t/1.2)**1.2)
write('sheep', .85, lambda t,n,l: (math.sin(2*math.pi*(180*t+.7*math.sin(t*35)))+.3*math.sin(2*math.pi*540*t))*(.7+.3*math.sin(t*39))*math.sin(math.pi*t/.85))
write('pig', .55, lambda t,n,l: (l+math.sin(2*math.pi*(135*t+.5*math.sin(t*22)))*.25)*math.sin(math.pi*t/.55)**2)
write('chicken', .65, lambda t,n,l: math.sin(2*math.pi*(520*t+7*math.sin(t*17)))*max(0,math.sin(t*28))**4*math.exp(-t*2))
