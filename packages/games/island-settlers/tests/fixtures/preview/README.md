# Island Settlers UI preview

A standalone Vite page that mounts the real `src/client.tsx` views on the hand-built fixtures in
`tests/fixtures/`, with a fake room around them. No room server, engine or phones needed. Views
that have not landed yet show the client's placeholders.

## Start

From the platform repo root:

```sh
npx vite --config packages/games/island-settlers/tests/fixtures/preview/vite.config.ts
```

It serves <http://127.0.0.1:5390/> (strict port). It uses the platform's `public/` directory, so
the kp fonts (`/fonts`) and game assets (`/games/island-settlers/`) load as in production, plus the
shared `party-ui/src/style.css`. Stop it with Ctrl-C (or `kill` the PID you started).

## URL parameters

| Param | Values | Default |
| --- | --- | --- |
| `view` | `display`, `controller`, `personal`, `results`, `settings`, `instructions` | `display` |
| `fixture` | a name from `tests/fixtures/index.ts` (`FIXTURE_NAMES`) | `mid-4` |
| `seat` | seat id (`p0`…); controller/personal show that seat's `PrivateView`; results pass it as `playerId` | the fixture's `seat` |
| `t` | ms offset from the fixture's `now` for the start of the clock (negative is fine) | `0` |
| `paused` | `1` freezes the clock at start | running |
| `replay` | `1` replays the recent events once on load | off |
| `chrome` | `0` hides the toolbar; the scene stage then fills the viewport | shown |
| `role` | `display`, `controller`, `personal` (only for `view=instructions`) | `controller` |
| `reject` | a reason string; every `sendAction` resolves `{ accepted: false, reason }` | accepted |

Examples:

```
http://127.0.0.1:5390/?view=display&fixture=max-10
http://127.0.0.1:5390/?view=display&fixture=mid-4&replay=1
http://127.0.0.1:5390/?view=controller&fixture=seven-discard-4&seat=p2
http://127.0.0.1:5390/?view=controller&fixture=offers-12&seat=p0&t=-20000&paused=1
http://127.0.0.1:5390/?view=personal&fixture=paired-6&seat=p3
http://127.0.0.1:5390/?view=results&fixture=ended-6&seat=p2
http://127.0.0.1:5390/?view=settings&fixture=explorers-4
http://127.0.0.1:5390/?view=display&fixture=finale-6&chrome=0
```

## What it fakes

- **Mounting** mirrors `apps/party-client/src/round-runtime.tsx`: `prepare()` first, then for a scene
  role (`usesScene`) a `.kp-scene-stage` with `SceneView` in `.kp-scene-surface` and the view in
  `.kp-scene-overlay`; otherwise a `.kp-game-viewport` fieldset. The whole page sits in
  `.kp-shell.kp-shell-playing` with the toolbar in the header slot, so the stage size matches the
  platform (`100dvh - 100px`). `personal` is the seated host: `isHost: true`, `viewRole:
  'controller'`, `PersonalView` if exported, else `ControllerView`; its scene uses the display role.
  Unlike production, the view renders before the scene reports ready, so a broken scene never
  hides the HUD. The toolbar shows the scene status.
- **Context**: `roomId 'PREVIEW'`, `roundId` = fixture name, `connected: true`, `setInput`,
  `releaseInput` and `assetsReady` are no-ops. `sendAction` logs to the console and the toolbar,
  appends to `window.islandPreview.actions`, and resolves accepted (see `reject`).
- **Clock**: `serverNowMs()` starts at `fixture.now + t` and advances in real time. The toolbar can
  pause, play and jump ±5 s. Deadlines in fixtures are absolute, so countdowns and timer rings move.
- **Events replay** (toolbar button or `replay=1`): events within 15 s of the fixture's `now` are
  removed, then re-published one snapshot at a time with fresh ids and `at` = the preview clock,
  keeping their spacing (gaps capped at 2.5 s). `lastRoll` follows the replayed roll. Pieces already
  show the end state, so drops and fly-outs animate onto pieces that are already there.
- **Results**: `outcome` comes from `outcomeOf(pub)` in `tests/fixtures/index.ts`.
- **Settings**: `SettingsView` edits a local copy of the fixture's settings (changes are logged).

## Automation

`window.islandPreview` exposes `{ clock, actions, fixture, pub, replay }`: `clock.jump(ms)`,
`clock.toggle()`, the list of sent actions, the currently published `PublicView`, and a replay
trigger. For headless screenshots with the server running:

```sh
PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs CHROME=/path/to/chrome-headless-shell \
  node packages/games/island-settlers/tests/fixtures/preview/shoot.mjs output/settlers-v2/preview-shots \
  "view=display&fixture=max-10@1920x1080" "view=controller&fixture=mid-4&seat=p0@390x844"
```

Each argument is `<query>[@WxH]` (default 1280×720). `WAIT` sets the delay before each shot
(default 1500 ms). The script exits 1 if a page logs an error. `PLAYWRIGHT` and `CHROME` are only
needed when Playwright or its browser is not installed where Node can find it.

## Fixtures

`tests/fixtures/index.ts` lists them (`FIXTURES`, `loadFixture(name)` returns a fresh copy). Each
has `name`, `description`, `now`, a default `seat`, the `pub` view and private `views` by seat.
The toolbar's seat menu shows which seats have a private view and its task kind.
