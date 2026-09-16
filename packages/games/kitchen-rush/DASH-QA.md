# Dash repair · 13 September 2026

The previous implementation treated dash as a transient held-input flag. A press and release between two 50 ms sends erased the press; tapping while still consumed cooldown but multiplied zero movement by the dash speed. `output/kitchen-rush/dash/before.json` in the consumer workspace records both deterministic reproductions.

Dash now uses the existing bounded, acknowledged command queue alongside Use/Drop/Toss. Pointer-up or key-up cannot erase a queued press. The server acknowledges each command once, including presses during cooldown, and moves along normalized facing for the 350 ms burst. Steering can update facing during the burst. Existing 6.4 m/s speed, 1600 ms cooldown, gust slowdown and wall/counter collisions remain. Disconnect cancels the burst. The legacy held dash field remains accepted for older clients.

Four regression cases were added: stationary burst and stopping, command acknowledgement/replay/cooldown with held-food preservation, partial diagonal steering/counter collision, and disconnect. The first three failed before the fix. All 51 Kitchen tests, full consumer TypeScript, scoped oxlint and an isolated production build pass.

Real UI/network check passed in the isolated publication checkout. A solo 10 ms Shift press, solo 10 ms Dash-button click and emulated phone touch tap each produced a server-confirmed 2.24 m burst, one command acknowledgement and no movement afterward. A second press during each cooldown advanced acknowledgement without restarting the burst. Input packets contained command `dash` with the held flag already false. The phone joined through normal room UI; the second service used a host player plus one phone. No game state or clock was injected. Inspected solo1280×720 and phone844×390 screenshots; no page errors. This is a focused dash/replay check, not a new full cooking service or physical-device test. Prior complete-service evidence remains applicable to unchanged cooking rules.

The production build was made in `/private/tmp/kitchen-dash-20260913`, isolated from the user's preview. Client index SHA256: `1965e90bf1df7e29b5a773efd17fe5311b7e8ab82d4c06f519b6b8074d8db442`. Evidence in the consumer workspace: `output/kitchen-rush/dash/browser.json`, `solo.png`, `phone.png`, `red.txt`. Room NBKDAA, the phone context, named browser kitchen-dash and owned server4377 were closed after testing.

No shared platform source changes. The requested code-golf skill was unavailable; manual simplification retained the existing command queue and legacy dash-input compatibility.
