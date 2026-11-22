# Quip Clash

Hijinks minigame `quip-clash`: prompt comedy for 3–64 players in a brick-wall comedy club. Rules: `server.ts`; views,
actions and timing: `types.ts`; tests: `tests/quip-clash.test.ts`.

## Ten players or fewer

Rounds 1 and 2 (×1, ×2): everyone writes two answers; every prompt is shared by two rivals, and each matchup is shown,
voted by everyone else and scored (votes × 100 × round, a winner bonus, a bonus for taking every vote). The Last Laugh
(×3): one prompt for everyone, three stackable votes each, never your own.

## Big rooms (11–64 players)

A matchup per player would be 32 matchups a round, so rounds 1 and 2 become **heats**: up to four a round (`HEATS`), one
prompt per heat, the room dealt evenly across them (two to eight writers a heat). Everyone writes one answer, then each
heat plays on the TV as an all-play board: the whole room votes (one vote among up to four answers, two among more),
never for their own, and the board pays 100 × round per vote plus a winner bonus. Above 32 players half the room writes
in each round and everyone votes in both. The Last Laugh deals every phone eight answers it did not write (`BALLOT`) and
the TV reveals the top eight (`FINAL_SHOWN`); an answer that misses the reveal reports to its author's phone.

The narrated intro line still says two players share a prompt; in a big room it is a few more.
