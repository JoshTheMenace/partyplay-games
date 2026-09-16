"""Author short, deterministic game cues. Music and Kenney samples are supplied separately."""
import math
import random
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4] / 'public/games/sky-clash/audio'
RATE = 24000
DURATIONS = {'jump': .16, 'laser': .18, 'block': .2, 'break': .42, 'ko': .75, 'count': .12, 'start': .5, 'end': .95, 'select': .18, 'warning': .4}

def tone(frequency, t):
    return math.sin(2 * math.pi * frequency * t)

for name, duration in DURATIONS.items():
    randomizer = random.Random(name)
    samples = []
    for i in range(round(duration * RATE)):
        t = i / RATE
        u = t / duration
        noise = randomizer.uniform(-1, 1)
        attack = min(1, t / .006)
        envelope = attack * (1 - u) ** 2
        if name == 'jump': value = .6 * tone(350 + 500 * u, t) + .1 * noise
        elif name == 'laser': value = .6 * tone(1100 - 900 * u, t) + .15 * tone(2200 - 1800 * u, t)
        elif name == 'block': value = sum(tone(f, t) for f in [930, 1567, 2441]) * .2
        elif name == 'break': value = noise * .65 + tone(140, t) * .25
        elif name == 'ko': value = tone(95 - 60 * u, t) * .7 + noise * .32 * (1 - u)
        elif name == 'count': value = tone(660, t) * .5
        elif name == 'warning': value = tone(440 if t < .2 else 330, t) * .5 * min(1, (t % .2) / .008)
        elif name in ['start', 'end']:
            notes = [523.25, 659.25, 783.99, 1046.5]
            note = notes[min(3, int(u * 4))]
            value = (tone(note, t) * .5 + tone(note * 2, t) * .1) * min(1, (t % (duration / 4)) / .005)
        else: value = tone(880, t) * .4 + tone(1320, t) * .2
        samples.append(struct.pack('<h', round(max(-1, min(1, value * envelope)) * 26000)))
    with wave.open(str(ROOT / (name + '.wav')), 'wb') as output:
        output.setparams((1, 2, RATE, len(samples), 'NONE', 'not compressed'))
        output.writeframes(b''.join(samples))
