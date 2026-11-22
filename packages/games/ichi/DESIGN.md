# Ichi design notes

Rules are in [README.md](README.md). This file explains why the game is shaped the way it is above ten players, and what travels on the wire.

## The problem with one big table

A shedding game is turn-based: one person acts, everyone else watches. `tools/sim.ts` plays whole matches against the rules with seats that think 2.5–7 seconds a turn:

| Players at one table | Turns in a hand (median) | Wait between your turns (median / 90th) |
| --- | --- | --- |
| 4 | 37 | 15 s / 23 s |
| 6 | 52 | 26 s / 37 s |
| 10 | 75 | 46 s / 73 s |

Ten is already slow. Thirty at one table would be over two minutes between turns, and a hand would outlast the party. Raising the number alone was never an option.

## The parlor

Above ten players (or in a smaller room, when the host picks a table size it does not fit) the room becomes a card parlor: tables of four, all playing at once.

- **Tables of four.** Three opponents is where this game is quickest and still has a table to read: the turn comes back in about fifteen seconds. Sizes are balanced; with a remainder the first tables get the spare seat, so a table is never more than one short (11 players sit 4, 4, 3).
- **Timed rounds, not synchronized hands.** Hand length varies a lot (a four-player hand runs 24 to 70 turns between the 10th and 90th percentile). If every table had to finish the same hand, fast tables would sit idle for minutes. Instead a round is six minutes on a shared clock and a table deals again as soon as it finishes, so everybody is playing nearly all the time and brisk tables are rewarded with more hands.
- **The bell and the final lap.** A hard stop would let the player holding the fewest cards simply stall. So the bell gives every seat exactly one more turn on a 12-second clock, and a timed-out turn still draws a card. The lap is a list of the players still owed a turn, not a count of turns: a Skip costs the skipped player their last turn, a Reverse turns the order round and play passes anyone who has already had theirs, and Jump in is off, so the TV's "one last turn each" is always true. A +2 or +4 played with the lap's last turn lands on the next player, as a going-out +2 does: nobody is left to answer it. The whole room hits its last turn at the same moment, which is the big-room moment the TV and every phone announce together.
- **Half a pot at the bell.** A hand dealt late in the round can end after two turns each. Paying it in full would make that a lottery worth as much as a real win, so a hand the bell cuts short pays half to whoever holds the fewest cards. No table deals in the last 30 seconds for the same reason.
- **Reseat by standing.** Between rounds the room is sorted by score and dealt out again, leaders to table 1. Everybody keeps playing to the end, a lower table's winner climbs, and the TV has a table worth watching. The first round is seated by lot so friends who joined together get mixed.
- **Scores stay comparable.** Scoring is unchanged (the winner takes the points left at their table), every table is nearly the same size, and every table gets the same clock.

With the same simulated seats a parlor of 11 to 64 players gives a median wait of 13–15 seconds between turns (21–24 s at the 90th percentile, about a minute at worst, around the bell), and a three-round match lasts just under 20 minutes at every size. Roughly half the hands end by going out and half at the bell.

**Why six minutes.** A table's last hand of a round nearly always ends at the bell, whatever the round's length. What the length buys is the hands finished before that. With five-minute rounds a live 64-player match ended 31 hands by going out and 42 at the bell. With six, three live 64-player matches ended 38 to 47 by going out and 37 to 45 at the bell (two 32-player matches: 12 and 19 against 22 and 20), so a table typically gets one full hand and then the bell hand, and three rounds still fit in twenty minutes. Longer rounds would shift the balance further and make the match longer; the length is one constant (`ROUND_MS`). A host who wants more finished hands can deal five-card hands: in the simulator that moves a 64-player match from 42 against 40 to 61 against 38.

### What gives out first beyond 64

The rules have no limit of their own: `tableCount` and the round structure work for any roster, and server cost per player is flat (each seat is one small private view). Three things stop at 64:

1. The platform seats 64 (`MAX_ROOM_PLAYERS`), and the manifest declares exactly that.
2. The TV. Sixteen table tiles two abreast is what the floor rail fits at 720p with a readable count per seat; the seating chart is a 4×4 grid of tables. More tables would need paging.
3. The shared view. The roster rides in every changed snapshot (about 150 bytes a player), so a phone's traffic grows with the roster even though its own table does not.

## The TV's director

`direct()` in `server.ts` chooses the featured table once a tick, on the server, so every display agrees and the shared view carries one table instead of sixteen.

- Each table has a heat: an open Ichi race (+80), a hand on one card (+40) or two (+15), a pending stack (10 plus 3 a card), the final lap (+20), and a small bonus for table 1.
- A cut needs the current shot to have run six seconds and the other table to be 40 hotter; nothing holds the shot past 14 seconds, when the table that has waited longest (heat plus a second-per-second bonus up to 60) is next.
- A table that just finished a hand keeps the shot for 4.5 seconds, so the winning card and the tally are seen, and is then left at once. An idle table is never chosen while another plays.

The client remounts the table on a cut (keyed by round and table), so a table's earlier events are history and never replay. A lacquer card names the new table as it sweeps across.

## Wire format

Legacy turn-based games are snapshotted ten times a second to every socket. Three decisions keep that cheap.

1. **Everything shared is cached.** The manifest's `snapshotCache` lists every public field under one revision, `rev`. `sync()` runs at the end of every entry point into the rules (`create`, `applyAction`, `tick`, `onPresenceChange`) and bumps `rev` exactly when the JSON of the shared view changed, so an idle snapshot carries only `{"rev":n}`. Comparing the JSON instead of counting mutations means no path can forget to bump it.
2. **Phones get their own table privately.** The shared view holds one table (the featured one), a floor rail of one small tile a table, and the roster. A seated player's private view adds their own table: five recent events and no leftover cards. Hands were always private; nothing about another table's hands is sent to anyone until a hand ends, when the featured table's leftovers are shown on the TV.
3. **Seats are numbers.** Tables, events and results refer to players by roster index (`p`, `by`, `to`), not by 36-character ids. The roster carries each id once.

The floor rail refreshes at most every two seconds (immediately when a hand or round changes), because each refresh resends the roster to the whole room.

Measured sizes (16-character names, real ids): the shared view is 14.2 kB at 64 players and 7.9 kB at 32 when it changes, a parlor phone's private view is about 1.7 kB every snapshot (0.7 kB at one table), and the largest possible snapshot (ten 30-card hands laid out at a hand's end) is 20.6 kB, under the 32 KiB message cap. See [QA.md](QA.md) for traffic per phone and server cost measured on a live room.

Private views are sent whole every snapshot; the platform has no cache for them. That is the larger half of a phone's traffic in the parlor, and the first thing to change in the platform if it ever needs to shrink.

## Pacing constants

| Constant | Value | Why |
| --- | --- | --- |
| `ROUND_MS` | 6 min | See above: at five minutes the bell ended more hands than going out did. Three rounds make a match of just under 20 minutes. |
| `LAP_SECONDS` | 12 s | The final lap is at most seats × 12 s; typical laps take about 25 s. |
| `DEAL_MS` | 30 s | No new hand this close to the bell: a hand needs time to be more than a draw. |
| `TABLE_BREAK_MS` | 8 s (3 s when all tap Next hand) | Long enough to read the tally on the phone. |
| `SHOW_MS` | 4.5 s | The last hands stay up before the room reseats or the match ends. |
| `SEAT_MS` | 14 s (5 s when all tap Ready) | Time to find a name on the seating chart. |
| `FINALE_MS` | 6 s | The final table stays on the TV before the platform's results replace it. |
| `FLOOR_MS` | 2 s | Floor rail cadence; see above. |

## Originality

The Gift card, the bell with its final lap and half pot, the parlor's reseating and the TV director are Ichi's own designs. Nothing was taken from another game's cards, wording or screens. The base deck and the Seven-O, Jump in, stacking and +4 challenge rules predate this pass and were left as they were.
