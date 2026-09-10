# Kart Party module

Kart Party lives in this repository and runs on the collection's HTTP server at `/kart-party/`. The original standalone checkout is preserved. No second server, browser window or absolute local source path is needed to play.

From the repository root:

```sh
npm install
npm start
npm run test:kart
```

Use the dashboard's Kart Party card. Solo races work with keyboard or touch; party races support up to ten humans with phone controllers and CPUs filling smaller grids. Four courses and the existing music, racers, speed classes and settings are preserved.

The game keeps its own race protocol and lobby. Its WebSocket endpoint is `/kart-party/party`; phone links and QR codes include `/kart-party/`. Moving from a collection room to Kart Party closes the old room after an explicit in-app confirmation. Players join the new race code. **All games** on the Kart menu returns to the dashboard.

`game/` contains simulation, renderer and UI. `server/party-server.ts` can mount on the collection server while the original standalone factory remains available for its focused tests. `app/globals.css` builds separately so its Tailwind styles cannot alter the other games. Public music/fonts live under `public/games/kart-party/` in the repository root. `vite.kart.config.ts` and `scripts/build-collection.mjs` build both clients and one server into each isolated run.

The retained 350 focused tests cover original mechanics, networking and rendering contracts. Root `tests/kart-mount.test.ts` additionally verifies both game protocols on one server and namespaced QR links. Browser acceptance of the migrated build is recorded in `output/dashboard/QA.md`; static tests do not prove physical-device behavior.

See [PROVENANCE.md](PROVENANCE.md) for imported scope and [REFERENCE.md](REFERENCE.md) for the original standalone documentation.
