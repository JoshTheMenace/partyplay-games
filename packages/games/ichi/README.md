# Ichi

A color-and-symbol shedding game for 2–10 players. One watching display, private phone hands, and eight independently switchable expansions. The shared PartyPlay room owns joining, readiness, reconnects, results and replay.

## Play

Match the discard's color or symbol; wilds choose the next color. You can draw even when holding a legal card, but may then play only the newly drawn card or pass. Drawing does not reset the turn timer. Skip skips one seat; Reverse also skips in a two-player game; Draw Two draws two and skips without stacking. Ichi is announced automatically at one card.

Card effects resolve before checking for an empty hand. Trade passes every hand, including an empty hand, so the recipient of an empty hand wins. After 80, 160 or 240 completed turns, fewest cards wins; equal counts share the win. Each turn lasts 15, 30 or 45 seconds, including disconnected seats. Timeout draws once (unless already drawn) and passes. Reconnecting retains the seat and hand.

Classic disables all expansions. Strategy, the default, enables missions and reveal cards. Everything enables all eight. The host can adjust individual switches and deal 5, 7 or 9 cards.

| Pack | Rule | Decision it adds |
| --- | --- | --- |
| Secret missions | One card in each starting hand is a locked wild. Play three different colors to unlock it. Progress travels with the physical card on trade; a played mission relocks if recycled. | Diversify colors before trying to go out. |
| Open secrets | Eye reveals an unexposed random card from a rival you choose. It stays public until played, even after trade, drift or flip. Revealing a decoy unmasks it for everyone. | Target a rival and use known cards to choose colors. |
| Trade winds | Trade passes every hand one seat in the current direction. | Give away a poor hand; avoid giving away the win. |
| Flip side | Flip turns the deck, discard and all hands to their other faces. Number backs differ in both color and number; special backs keep their action with another color. Wilds stay wild. | Preview your back faces before flipping. |
| Decoys | Mask creates a disguised number card in the next hand and skips that seat. Its owner may inspect it privately for free, including out of turn, before playing it. | Prepare during other turns; inspection reveals the true face without spending the turn. |
| Jump in | Out of turn, play a card with exactly the top number and color. First server-accepted action wins the race; play continues after the jumper. Specials cannot jump. | Watch the pile and change turn order. |
| Color drift | Every two completed turns, all active-side number cards in hands move coral → sky → lime → sun → coral. The discard stays put. | Plan for the shown drift countdown. |
| Wild mutation | At the start of each turn, one random number card in the incoming hand changes to a different color and number. | An optional luck-heavy modifier, with a private Mutated badge. |

Hands cap at 30. Penalties still skip at that cap; drawing voluntarily passes. The discard recycles except for its top card. If every available card is held, a draw creates a seeded number card, so a depleted deck never deadlocks. Decoys also create cards. Mission cards never mutate or drift. Revealed number cards can change; the exposed face updates publicly. Both sides of a disguised card remain hidden until inspection or reveal.

## Code

- `src/server.ts`: seeded deck, action validation, effects, turn progression, deadlines and public/private projections. All validation happens before a move changes state. Physical card IDs survive hand transfers; a revision rejects stale moves. Wall-clock reversals clamp to the last observed time.
- `src/types.ts`: transport types, pack descriptions and defaults. No rules or hidden deck enter the browser dependency graph.
- `src/client.tsx` and `styles.css`: shared table, private sorted card grid, inline color/target choice, scoped browser drafts, accessible suit glyphs and short reduced-motion-aware transitions. Legal play/jump flags come from the server.
- `tests/rules.test.ts`: focused edge cases and complete seeded games across all 256 expansion combinations at both roster limits.

Registration, catalog metadata and launcher art live in the parent platform repository. Game source stays inside `partyplay-games`.

## Validate from the platform root

```sh
node --import tsx --test packages/games/ichi/tests/*.test.ts tests/catalog.test.ts tests/registry-contract.test.ts
npm run typecheck
npm run lint
npm run build:isolated -- ichi-your-run
npm run serve:isolated -- ichi-your-run 4347
```

See [QA.md](QA.md) for the recorded build and browser acceptance, including the limits of desktop phone emulation. No music or third-party card artwork is included.
