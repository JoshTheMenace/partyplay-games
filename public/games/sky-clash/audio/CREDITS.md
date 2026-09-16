# Sky Clash audio

Music supplied by the user:

- `lobby.mp3`: smashlobby (map selection, preparation and character selection)
- `adventure-forward.mp3`: Adventure Forward
- `adventures-final-frontier.mp3`: Adventure's Final Frontier
- `bouken-no-jokyoku.mp3`: 冒険の序曲
- `triumph-of-the-brave.mp3`: Triumph of the Brave (Remastered)

The four battle tracks rotate between rounds and continue to the next track when a song ends. Audio frames are preserved with FFmpeg stream copy; only embedded artwork and metadata were removed. `manifest.json` records titles, durations and file hashes.

`impact-hit-0.wav` comes from Kenney Impact Sounds; `swish.wav` comes from Kenney RPG Audio. Both are CC0, with original license files included alongside them. These samples are also used in this repository's Blockwild sound bank.

The other ten short WAV cues were authored for Sky Clash by `packages/games/sky-clash/tools/build_audio.py`: jump, laser, shield block/break, KO, countdown, start, result, selection and hazard warning. Landing reuses the impact sample at lower gain and pitch.
