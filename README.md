# PartyPlay games

Josh's game collection, versioned separately from the [Party Place platform](https://github.com/JoshTheMenace/partyplace).

## Contents

- `packages/games/`: Kart Party, Blockwild, Kitchen Rush, Quip Clash, Sketch Bluff, Tall Tales, Shirt Show, Odd One In and Quiz Panic. Scene Lab is a development-only fixture.
- `modules/kart-party/`: the original racing engine, renderer, protocol reference and tests used by the integrated Kart Party adapter.
- `packages/party-*`: the shared contracts, UI/controller components, client session, simulation and 3D helpers that these games use.
- `public/games/`: game assets, music and font license notices.

The discovery website, personal library, curator catalog, room service and deployment scripts live in `partyplace`. These are source modules consumed by that workspace, not independently deployed websites. Shared packages stay here so game imports resolve within the same versioned collection.

## Development

Clone the consumer and its pinned games revision:

```sh
git clone --recurse-submodules https://github.com/JoshTheMenace/partyplace.git
cd partyplace
npm ci
npm run typecheck
npm test
npm run test:kart
npm run build
```

The platform mounts this repository at `game-modules/`. Tracked relative directory links expose its packages, Kart module and assets at the platform's existing import paths. Edit either path; both refer to these files. Run integration builds/tests from the platform root. The games repository does not depend on the platform server implementation: transport serialization validation is part of the shared contract.

Work on a games branch before editing a submodule checkout, which is normally detached:

```sh
cd game-modules
git switch -c codex/my-game-change
```

Commit and push game changes here first. Then commit the changed `game-modules` reference in the platform repository. Consumers get exactly that games commit, not whatever happens to be latest on this branch. See the platform's [repository guide](https://github.com/JoshTheMenace/partyplace/blob/main/docs/REPOSITORIES.md).

## Contributions and assets

Never run Prettier. Use the [platform handbook](https://github.com/JoshTheMenace/partyplace/blob/main/docs/party-platform/AGENT-HANDBOOK.md) and shared UI contract when changing these games. Validate relevant rules and actual browser behavior in the consumer workspace. Preserve private player state and shared-room semantics.

This repository is private. No blanket open-source license is granted by this initial split. Existing asset/font license notices and Kart provenance are retained with their files.
