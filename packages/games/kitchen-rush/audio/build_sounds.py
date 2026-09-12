"""Trim licensed recordings into mono web assets. Requires ffmpeg; pass source-cache directory."""
import array
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import wave

source = Path(sys.argv[1])
out = Path(__file__).resolve().parents[4] / 'public/games/kitchen-rush/audio'
out.mkdir(parents=True, exist_ok=True)
rate = 24000
# name, source, start seconds, length seconds, crossfade loop
clips = [
    ('chop', 'chop.wav', 1.76, .32, False),
    ('chop-alt', 'chop.wav', 2.26, .32, False),
    ('simmer', 'boil.wav', 12, 4, True),
    ('ignite', 'ignite.wav', 2.2, .8, False),
    ('fire', 'fire.wav', .25, 2, True),
    ('dish', 'dishes_02.ogg', 0, .6, False),
    ('wash', 'splash_01.ogg', 0, .7, False),
    ('deliver', 'bell_01.ogg', 0, 1.3, False),
    ('ready', 'bell_02.ogg', 0, .53, False),
    ('warning', 'bell_03.ogg', 0, 1.6, False),
    ('end', 'gong_02.ogg', 0, 1.19, False),
]
manifest = []
for name, filename, start, duration, loop in clips:
    path = source / filename
    data = array.array('f', subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-ss', str(start), '-t', str(duration), '-ac', '1', '-ar', str(rate), '-f', 'f32le', '-']))
    if loop:
        # Rotate the boundary into a 100ms crossfade, avoiding a repeated fade-to-silence.
        count = int(rate * .1)
        blend = [data[-count+i] * (1-i/count) + data[i] * (i/count) for i in range(count)]
        data = array.array('f', blend) + data[count:-count]
    else:
        for i in range(min(int(.006*rate),len(data))): data[i] *= i/(.006*rate)
        for i in range(min(int(.04*rate),len(data))): data[-1-i] *= i/(.04*rate)
    scale = .8 / max(map(abs, data))
    pcm = array.array('h', [round(x*scale*32767) for x in data])
    target = out / f'{name}.wav'
    with wave.open(str(target), 'wb') as wav:
        wav.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        wav.writeframes(pcm.tobytes())
    manifest.append(dict(name=name, source=filename, sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(), start=start, seconds=round(len(data)/rate,3), loop=loop, bytes=target.stat().st_size))
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(f'{len(clips)} clips, {sum(x["bytes"] for x in manifest):,} bytes')
