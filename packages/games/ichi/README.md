# Ichi

A fast color-matching shedding game for 2–64 players, set in a late-night card parlor. The TV shows the table; each phone holds a private hand. Get down to one card, shout **Ichi!** before someone catches you, and win hands to take the match. Up to ten players share one table. Bigger rooms play at several tables at once, in timed rounds, while the TV cuts between them. The shared PartyPlay room owns joining, readiness, reconnects, results and replay.

[DESIGN.md](DESIGN.md) explains the big-room structure and the wire format. [QA.md](QA.md) is the current acceptance report.

## Rules

**Deck.** Each color (coral blossom, sky wave, lime bamboo, sun disk) has one 0, two each of 1–9, two Skip, two Reverse and two +2. There are four Wild and four Wild +4 cards: 108 in total. With *Gift cards* on (the default) each color adds one Gift, for 112. Tables with seven or more players shuffle two decks together. The first discard is always a number card.

**Your turn.** Play a card matching the active color or the top card's number/symbol, or any Wild. Otherwise draw one card. If the drawn card can be played, you may play it immediately or keep it (ending your turn). Any other draw ends your turn. With *Draw till you can*, you keep drawing until you find a playable card. An empty draw pile reshuffles the discard pile except for its top card. If there is nothing left to draw, the draw simply ends the turn. Hands are capped at 30 cards.

**Card effects.** Skip skips the next player. Reverse flips the direction (in a two-player game it acts as Skip). +2 makes the next player draw two and lose their turn. A Wild chooses the next color. A Wild +4 chooses the color, and the next player draws four and loses their turn.

**Gift** (on by default; Ichi's own card). A Gift matches by color or on another Gift. Play it, then hand any other card from your hand, face down, to a player of your choice at your table. Only the two of you ever know which card moved. A gift makes the receiver's hand grow, so it knocks a player off one card and closes any race over them. Giving away your last card goes out. A Gift played as your last card needs nothing more. A player holding 30 cards cannot be given one. A Gift cannot answer a +2 or +4. A Gift left in hand scores 20.

**Stacking** (on by default). A +2 may be answered with a +2 or a +4. A +4 may be answered only with a +4. The penalty grows with every card, and the first player who does not stack draws the total and loses their turn.

**+4 challenge** (on by default). A Wild +4 is always playable, but it's a bluff if you still held a card of the color it replaced. Your phone tags such a +4 **Bluff**. The victim of a fresh +4 may challenge instead of drawing or stacking; their phone shows the color in question and the stakes. A +4 laid on a stack can't be a bluff (only +2/+4 were legal), so it can't be challenged. If the bluff is real, it's caught: that player draws the whole pending penalty, and the challenger takes a normal turn. Otherwise the challenger draws the penalty plus two and loses the turn.

**Ichi!** Every time a player plays down to one card, a five-second race opens: their phone shows **Ichi!**, every other phone at the table shows **Catch!**, and the server accepts the first press. There is no early call. A catch makes the offender draw two. An Ichi! press makes them safe. When the window closes, the offender is safe. Play continues during the window. A player whose hand reaches one card through a swap or rotation is automatically safe.

**Seven-O** (off). Playing a 7 swaps your hand with a player you choose. Playing a 0 passes every hand one seat in the direction of play.

**Jump in** (off). Out of turn, you can play a card with exactly the same color and value as the top card, but not a Wild, while no penalty is pending, no drawn-card decision is open and the bell has not rung. Play continues from the jumper. If the current player acts first, the jump is rejected as too slow.

**Hands and scoring.** A hand ends when a player empties it. The last card's effect still resolves, so a final +2 makes the next player draw. The winner scores every card left in the other hands at the table: numbers score their face value, Skip, Reverse, +2 and Gift score 20, and Wilds score 50. If a hand passes 400 turns, the fewest cards wins it.

**One table (up to ten players).** The match ends when a player reaches the target (200 by default, 500 for a long game, or *One hand*). The highest score wins, and ties share the win. After each hand there is a 10-second intermission showing the tally. It ends early after 3 seconds once every connected player taps *Next hand*. After 12 hands, the match ends. When the match is decided the final table stays on the TV for six seconds before the results.

**The parlor (eleven or more players, or a smaller room when the host picks a table size it does not fit).** Players are dealt by lot to tables of four (or the size the host picks: four, five or six; spare seats go to the first tables, so a table can run one short). Every table plays its own hands at the same time, with its own deck. A match is one, three or five six-minute rounds (for *One hand*, 200 and 500).

- A table that finishes a hand takes an eight-second break (three once everyone taps *Next hand*) and deals again, unless the bell is less than 30 seconds away. Then it waits.
- **The bell.** When the round clock runs out no table deals again, and every hand still in play gets a **final lap**: each player gets one more turn on a 12-second clock, starting with the turn in progress. A skipped player loses that last turn, a Reverse turns the order round without giving anyone a second turn, and nobody can jump in. A +2 or +4 played with the lap's last turn still lands on the next player. Going out during the lap pays in full. Otherwise the fewest cards (then fewest points) wins the hand and takes **half** the pot; a tie pays nobody.
- When every table is done the room **reseats by standing** for the next round: table 1 seats the leaders. The seating chart stays up for 14 seconds, or five once everyone taps *Ready*.
- After the last round the highest total wins. Ties share the win.
- With the default seven-card hands a table usually finishes one hand in a round and has a second cut short by the bell. Five-card hands fit about one more finished hand into every other round.

**Timers.** Each turn lasts 15, 25 or 40 seconds (default 25; 12 after the bell). On timeout, a pending penalty is accepted, a drawn card is kept, or else one card is drawn and the turn passes. A disconnected player's turn times out after 5 seconds. Reconnecting keeps the seat, hand and score.

## Screens

- **TV, one table:** the table with every hand lying face down on the felt (one back per card up to twelve), the discard pile, whose turn it is and the clock on that player's plate. Cards fly from a hand to the pile and from the deck to a hand. An Ichi race darkens the table around the player on one card.
- **TV, parlor:** the featured table on the left and a floor rail on the right with the round clock, every table at a glance and the leaders. The server's director picks the featured table: a race, a hand about to end or a growing stack pulls the camera, a finished hand lets it go after 4.5 seconds, and nothing holds it past 14. Between rounds the whole screen is the seating chart.
- **Phone:** your hand, your table's top card and players, the prompt and the actions. In the parlor a line above shows your table, the round and the bell. Between rounds it shows your next table and your place in the room.

## Code

- `src/types.ts`: the transport contract (settings, actions, public and private views, events) and the table plan (`tableCount`, `roundCount`). The browser must never import server rules or the hidden deck.
- `src/server.ts`: seeded decks, validation before mutation, card effects, stacking, challenges, Gifts, the Ichi window, scoring, tables, rounds, the bell, reseating, the TV director and deadlines. `turnId = handId:revision` rejects stale moves; in the parlor a hand id also names its round and table. Physical card ids are unique across the room and survive transfers.
- `src/manifest.ts`: 2–`MAX_ROOM_PLAYERS` players and the snapshot cache policy.
- `src/client.tsx` (settings, instructions, results, asset preparation), `src/table.tsx` (TV), `src/phone.tsx` (hand), `src/cards.tsx`, `src/sfx.ts` and `src/styles.css`.
- `src/music.tsx`: TV-only background music (Lantern Lounge), a gapless Web Audio loop that follows the shared Sound toggle.
- `music/`: the original offline synthesizer and compositions that render the soundtrack (`node --import tsx packages/games/ichi/music/render.ts output/ichi-music lantern-lounge`, then copy the MP3 into `public/games/ichi/music/`). Four alternate tracks remain in `tracks.ts`.
- `public/games/ichi/`: Blender-rendered table and card-back art, and the rendered music.
- `tests/rules.test.ts`: rules edge cases, privacy at 11, 32 and 64 players, the bell and reseating, the director, the snapshot cache, and seeded full matches from 2 to 64 players.
- `tools/sim.ts`: plays whole matches against the rules in simulated time and prints match length, the wait between turns, how hands end and what the snapshots cost.
- `tools/room-bot.mjs`: the policy for the platform's socket bots (`scripts/qa/room-bots.ts --hook`): legal play at a human pace, with a pacing record.
- `tools/qa-driver.mjs`: a real TV page, real phone pages that tap the DOM and optional socket bots through a whole match, with screenshots and layout metrics. `tools/qa-watch.mjs` joins a running room as a second display (1080p by default) and captures each phase.

## Validate from the platform root

```sh
node --import tsx --test packages/games/ichi/tests/*.test.ts tests/ichi-contract.test.ts tests/registry-contract.test.ts
node --import tsx packages/games/ichi/tools/sim.ts 2 10 11 32 64
npm run typecheck
npm run lint
npm run build:isolated -- ichi-your-run
HOST=127.0.0.1 npm run serve:isolated -- ichi-your-run 4431
node packages/games/ichi/tools/qa-driver.mjs --base http://127.0.0.1:4431 --out output/ichi-pass/run --players 2 --bots 30
```
