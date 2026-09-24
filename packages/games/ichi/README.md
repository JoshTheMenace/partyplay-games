# Ichi

A fast color-matching shedding game for 2–10 players, set in a late-night card parlor. The TV shows the table; each phone holds a private hand. Get down to one card, shout **Ichi!** before someone catches you, and win hands to race to the match target. The shared PartyPlay room owns joining, readiness, reconnects, results and replay.

## Rules

**Deck.** Each color (coral blossom, sky wave, lime bamboo, sun disk) has one 0, two each of 1–9, two Skip, two Reverse and two +2. There are four Wild and four Wild +4 cards: 108 in total. Tables with seven or more players shuffle two decks together. The first discard is always a number card.

**Your turn.** Play a card matching the active color or the top card's number/symbol, or any Wild. Otherwise draw one card. If the drawn card can be played, you may play it immediately or keep it (ending your turn). Any other draw ends your turn. With *Draw till you can*, you keep drawing until you find a playable card. An empty draw pile reshuffles the discard pile except for its top card. If there is nothing left to draw, the draw simply ends the turn. Hands are capped at 30 cards.

**Card effects.** Skip skips the next player. Reverse flips the direction (in a two-player game it acts as Skip). +2 makes the next player draw two and lose their turn. A Wild chooses the next color. A Wild +4 chooses the color, and the next player draws four and loses their turn.

**Stacking** (on by default). A +2 may be answered with a +2 or a +4. A +4 may be answered only with a +4. The penalty grows with every card, and the first player who does not stack draws the total and loses their turn.

**+4 challenge** (on by default). A Wild +4 is always playable, but it's a bluff if you still held a card of the color it replaced. Your phone tags such a +4 **Bluff**. The victim of a fresh +4 may challenge instead of drawing or stacking; their phone shows the color in question and the stakes. A +4 laid on a stack can't be a bluff (only +2/+4 were legal), so it can't be challenged. If the bluff is real, it's caught: that player draws the whole pending penalty, and the challenger takes a normal turn. Otherwise the challenger draws the penalty plus two and loses the turn.

**Ichi!** Every time a player plays down to one card, a five-second race opens: their phone shows **Ichi!**, every other phone shows **Catch!**, and the server accepts the first press. There is no early call. A catch makes the offender draw two. An Ichi! press makes them safe. When the window closes, the offender is safe. Play continues during the window. A player whose hand reaches one card through a swap or rotation is automatically safe.

**Seven-O** (off). Playing a 7 swaps your hand with a player you choose. Playing a 0 passes every hand one seat in the direction of play.

**Jump in** (off). Out of turn, you can play a card with exactly the same color and value as the top card, but not a Wild, while no penalty is pending and no drawn-card decision is open. Play continues from the jumper. If the current player acts first, the jump is rejected as too slow.

**Hands and match.** A hand ends when a player empties it. The last card's effect still resolves, so a final +2 makes the next player draw. The winner scores every card left in the other hands: numbers score their face value, Skip, Reverse and +2 score 20, and Wilds score 50. The match ends when a player reaches the target (200 by default, 500 for a long game, or *One hand*). The highest score wins, and ties share the win. After each hand there is a 10-second intermission showing the tally. It ends early after 3 seconds once every connected player taps *Next hand*. If a hand passes 400 turns, the fewest cards wins it. After 12 hands, the match ends.

**Timers.** Each turn lasts 15, 25 or 40 seconds (default 25). On timeout, a pending penalty is accepted, a drawn card is kept, or else one card is drawn and the turn passes. A disconnected player's turn times out after 5 seconds. Reconnecting keeps the seat, hand and score.

## Code

- `src/types.ts`: the transport contract (settings, actions, public and private views, events). The browser must never import server rules or the hidden deck.
- `src/server.ts`: seeded deck, validation before mutation, card effects, stacking, challenges, the Ichi window, scoring, intermission and deadlines. `turnId = handId:revision` rejects stale moves. Physical card ids survive transfers.
- `src/client.tsx` (settings, instructions, results, asset preparation), `src/table.tsx` (TV), `src/phone.tsx` (hand), `src/cards.tsx`, `src/sfx.ts` and `src/styles.css`.
- `src/music.tsx`: TV-only background music (Lantern Lounge), a gapless Web Audio loop that follows the shared Sound toggle.
- `music/`: the original offline synthesizer and compositions that render the soundtrack (`node --import tsx packages/games/ichi/music/render.ts output/ichi-music lantern-lounge`, then copy the MP3 into `public/games/ichi/music/`). Four alternate tracks remain in `tracks.ts`.
- `public/games/ichi/`: Blender-rendered table and card-back art, and the rendered music.
- `tests/rules.test.ts`: rules edge cases and seeded full matches at 2 and 10 players across rule combinations.

## Validate from the platform root

```sh
node --import tsx --test packages/games/ichi/tests/*.test.ts tests/ichi-contract.test.ts tests/registry-contract.test.ts
npm run typecheck
npm run lint
npm run build:isolated -- ichi-your-run
npm run serve:isolated -- ichi-your-run 4347
```
