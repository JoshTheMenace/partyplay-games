# Game modules

Never run Prettier. Use the fewest lines that satisfy the task. This repository is consumed as the `game-modules` submodule in Party Place. Read the consumer's `AGENTS.md`, game-building handbook and shared UI skill before changes when working in that workspace. Run integration checks from the consumer root; do not create a second room system inside a game.

Game source, tests, assets and shared runtime packages belong here. Discovery UI and curated listing metadata belong in the platform repository. Treat game and platform commits separately. Do not stage, commit, push or create PRs without the user's explicit authorization for the current task. Preserve asset licenses and provenance.
