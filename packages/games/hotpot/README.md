# Hotpot

A PartyPlay port of the Palia-inspired Hotpot card game from hopehendricks.com (Express + Socket.io + in-browser React).

## Rules

Four seats; bots fill any seat without a player. Each player holds eight cards from an endless deck of 24 ingredients (IDs 1–24, three per color). On your turn, draw from the deck or from the top of any discard pile, including your own. If the nine cards split into three sets, you win immediately. Otherwise discard one card onto your own pile. A set is one of each ingredient in a color or three copies of one card. The round counter increases each time play returns to the first player.

Bots draw after 1 s and discard 0.8 s later. They preserve complete sets, build useful pairs, and take a visible discard when it improves their hand. Decisions use only their own cards and public piles. Bots avoid taking back their own discard unless it wins. After 60 seconds without a move, a bot completes the idle turn; the player can act again on their next move.

## Port notes

- The original lobby list, host/join screens and Socket.io events are replaced by the shared room: QR/code join, readiness, host controls and replay.
- `server.ts` keeps the original backtracking `detectSets` solver and rules; bot delays run from `tick` using server time.
- Behavior change: a disconnected player is covered by a bot only while they are away, and takes their seat back on reconnect. The room shell handles a departing host.
- Views: `DisplayView` is the shared table with every hand face down. `ControllerView` puts the hand first, with responsive portrait and landscape layouts. A host playing on this device gets the table with their hand at the bottom on wide screens and the phone layout on narrow ones. `ResultsView` reveals every hand and highlights the winning sets.
- Platform registration uses windowed action history so long rounds continue beyond 128 turns per player.
- Only the active player's private view contains their drawn card. Other hands are public as counts until the game is won.

## Assets

`public/games/hotpot/cards/` contains the 24 ingredient cards and `card_back`, resized to 300 px wide WebP from the [hopehendricks.com](https://hopehendricks.com/) originals (561×862 PNG). Aaron confirmed on 2026-09-15 that he has permission to redistribute these images under their public license. The original project did not record a specific license identifier, so the source attribution is preserved here rather than assigning an unverified SPDX license.

## Tests

```sh
node --import tsx --test packages/games/hotpot/tests/*.test.ts
```
