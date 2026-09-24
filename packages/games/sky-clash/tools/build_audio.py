"""Author short, deterministic game cues. Music and Kenney samples are supplied separately.
The first ten cues are byte-identical to earlier builds; parry onward were added for the v2 mixer."""
import math
import random
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4] / 'public/games/sky-clash/audio'
RATE = 24000
DURATIONS = {'jump': .16, 'laser': .18, 'block': .2, 'break': .42, 'ko': .75, 'count': .12, 'start': .5, 'end': .95, 'select': .18, 'warning': .4,
             'parry': .45, 'clash': .38, 'heavy': .5, 'go': .7, 'fanfare': 1.7, 'coin': .5, 'zap': .26, 'burn': .34, 'star': .7}

def tone(frequency, t):
    return math.sin(2 * math.pi * frequency * t)

def square(frequency, t):
    return 1 if tone(frequency, t) >= 0 else -1

for name, duration in DURATIONS.items():
    randomizer = random.Random(name)
    samples = []
    crackle = 0.0
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
        elif name == 'parry': value = (tone(1760, t) * .45 + tone(2637, t) * .25 + tone(3520, t) * .12) * (1 + .3 * tone(9, t))
        elif name == 'clash': value = (tone(1240, t) + tone(1873, t) * .7 + tone(2911, t) * .4) * .28 + noise * .25 * (1 - u) ** 6
        elif name == 'heavy': value = tone(62 - 22 * u, t) * .85 + tone(124 - 40 * u, t) * .25 + noise * .4 * (1 - u) ** 8
        elif name == 'go':
            chord = [523.25, 659.25, 783.99, 1046.5]
            value = sum(tone(f, t) + .35 * tone(f * 2.003, t) for f in chord) * .16 * (1 - u) ** .5 + noise * .08 * (1 - u) ** 10
        elif name == 'fanfare':
            # G-C-E-G pickup, then a held C major chord with a slow swell: brass-like odd harmonics.
            steps = [(0, 392.0), (.11, 523.25), (.22, 659.25), (.33, 783.99)]
            if t < .46:
                start, note = [s for s in steps if s[0] <= t][-1]
                local = t - start
                value = sum(tone(note * k, t) / k for k in (1, 3, 5)) * .45 * min(1, local / .01) * (1 - min(1, local / .12) * .4)
            else:
                swell = min(1, (t - .46) / .08) * (1 - (t - .46) / (duration - .46)) ** 1.3
                value = sum(tone(f * k, t) / k for f in (523.25, 659.25, 783.99, 1046.5) for k in (1, 3)) * .16 * swell * (1 + .06 * tone(5.5, t))
            envelope = attack
        elif name == 'coin':
            note, local = (987.77, t) if t < .08 else (1318.51, t - .08)
            value = square(note, t) * .55 * (1 - local / (duration - (0 if t < .08 else .08))) ** 1.5
            envelope = attack
        elif name == 'zap': value = (square(60 + 40 * noise, t) * .3 + noise * .45) * (.6 + .4 * square(33, t)) + tone(2400 - 1600 * u, t) * .2
        elif name == 'burn':
            if randomizer.random() < .004: crackle = 1.0
            crackle *= .992
            value = noise * (.25 + .6 * crackle) * (.7 + .3 * tone(7, t))
        elif name == 'star':
            notes = [2093.0, 2637.0, 3136.0, 2637.0, 3520.0]
            note = notes[min(4, int(u * 5))]
            value = (tone(note, t) * .35 + tone(note * 1.5, t) * .12) * min(1, (t % (duration / 5)) / .004) * (1 + .4 * tone(18, t))
        else: value = tone(880, t) * .4 + tone(1320, t) * .2
        samples.append(struct.pack('<h', round(max(-1, min(1, value * envelope)) * 26000)))
    with wave.open(str(ROOT / (name + '.wav')), 'wb') as output:
        output.setparams((1, 2, RATE, len(samples), 'NONE', 'not compressed'))
        output.writeframes(b''.join(samples))
