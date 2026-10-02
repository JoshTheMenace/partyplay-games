# Hijinks

A whole party night in one registered game (`id: hijinks`, 2–10 players, watching TV + portrait phones). The TV shows a
game wall; phones vote, the VIP locks a pick, a minigame plays, the podium hands out a trophy, and the VIP ends the night
for the results screen. Design, file map and minigame rules: [DESIGN.md](DESIGN.md). Contract: `src/core/contract.ts`.
UI kit: `src/core/ui/README.md`. Music: `music/README.md`.

## Platform integration

- Server registry: `apps/party-server/src/registry.ts` with `actionLimits: { perPlayer: 256, maxBytes: 32768, history: 'window' }`
  (a night can send far more than 256 actions; the window retires acknowledged ones, and the shared client session numbers
  actions for it automatically).
- Client registry: `apps/party-client/src/registry.ts`; launcher art and verb in `apps/party-client/src/art.tsx`; library
  metadata in `apps/party-client/src/catalog.ts` and `catalog/sources.json`.
- Minigames register only inside the pack: `src/minis/catalog.ts`, `registry.server.ts`, `registry.client.ts`.
- Night memory: `api.used` remembers each minigame's dealt content for the whole night. `src/core/server/deck.ts` wraps
  it: `freshDeck(api, items, key?)` orders a bank unused-first (each group shuffled; mark cards with `api.used.add` as you
  deal them) and `dealFresh(api, items, count, key?)` deals and marks in one step. All six shipped minigames use it.
- The Vite guard rejects any `server.ts(x)`, `*.server.ts(x)`, `content*.ts(x)` or `bot.ts` under `src/` from browser chunks.

## Tests

```sh
node --import tsx --test packages/games/hijinks/tests/*.test.ts   # pack + minigame rules (in-process harness)
node --import tsx --test tests/platform.test.ts                  # includes a ten-player Hijinks night over real sockets
```

## Live QA driver

`tools/qa-driver.ts` plays a night against a running server: a headless TV page (1920×1080) creates the room through the
library, one headless phone page (390×844) joins through the real form and is the VIP, and the other seats are WebSocket
bots. Bots play minigames with `src/minis/<id>/bot.ts`. The phone uses the same bot policy, injected into its own socket
(a generic action-to-UI mapping is not possible); a minigame can opt into real UI driving with `src/minis/<id>/qa.ts`
exporting `ui(page, action): Promise<boolean>`. All pack steps on the phone (vote, Lock it in, Skip intro, Continue,
End the night) use its real UI.

```sh
flock /tmp/hijinks-heavy.lock npm run build:isolated -- hijinks-run-1
npm run serve:isolated -- hijinks-run-1 4421 &                    # note the PID; stop it when done
flock /tmp/hijinks-heavy.lock node --import tsx packages/games/hijinks/tools/qa-driver.ts --port 4421 --players 4 \
  [--game quip-clash] [--shots output/playwright/hijinks/run-1] [--phone-viewports] [--tv-viewports] [--settled] [--stress-podium] [--keep-open] [--max-minutes 30]
```

Without `--game` it goes menu → End the night → results. Screenshots (TV + phone, 320×568 / 667×375 with
`--phone-viewports`, the TV at 1280×720 with `--tv-viewports`) are taken at every pack and minigame phase change, plus a TV shot 4.5 s later with `--settled`. Every shot is queued behind
the previous one and waits for layout to settle after a resize (two animation frames, and a TV stage scaled to the
viewport), so shots are never cropped mid-rescale. Each phone shot also checks for sideways overflow and page zoom.
`--stress-podium` rewrites only the TV's podium snapshots to a worst case (16-character names, three-way ties, six long
awards, a long headline). `log.json` records the phase timeline, per-seat accepted/rejected actions, page errors and
`overflow` findings. It closes its browser and sockets on exit or Ctrl+C. Playwright is loaded from
`$HIJINKS_PLAYWRIGHT` (a `node_modules` directory) or the cached npx install.
