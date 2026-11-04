# Daily dungeon and seeded rosters: plan

Goal: more reasons to come back, and a payoff every time you do. Two parts:

1. **Seeded rosters (every endless run).** The run seed already picks the layout and the boss. It now also picks
   **which enemy kinds** the run meets: floor 1 is always **swarmers + one seeded kind**, and one more seeded kind joins
   every two floors. Each seed has its own character ("an Imp run", "a Bruiser run"), and a new kind joining is a moment
   on the stairwell card.
2. **The Daily.** One seed per day, the same for everyone, with its own **daily leaderboards** (solo and co-op). Play
   it as often as you like; your best run of the day counts. Around it: a **result card** with today's rank and
   percentile, a **Friends** tab and "you passed Alex" moments, live **rank climbing** during the run, and **yesterday's
   podium** on the main menu.

Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

**What changes where.** The roster is a **dungeon** change (`shared/dungeon`): which kinds a room may buy. It moves no
Forge draw, layout, digest, prop or boss pick, but room spawns change, and with them breakables and affixes (both are
placed from the spawns). Endless replays and scores change **from floor 1**. M1 (`KALEB_VALE_MVP_PARAMS`), every golden
fixture and the tutorial never call the endless spender (docs/ENEMY_VARIANTS.md EV0 item 1) and replay exactly as before.
The Daily is a **new world kind** (`daily`) built by the same `buildEndlessRunConfig`, so **no sim, hash or lockstep
change**; the rest is server (seed, boards, ranks) and presentation.

## Status (2026-10-31)

**Built** on branch `daily` (DS1-DS13; merged from `daily-roster`, `daily-core`, `daily-boards`, `daily-telemetry`,
`daily-menu`, `daily-rank`, then an independent review and `daily-fixes`). Decisions DSD1-DSD16 are settled (Kaleb,
2026-10-31: every proposed default except DSD16, all friends up to 200). Headless: typecheck, lint, asset ids, build and
the full suite pass (one failure, `forge.spec` `EncounterRng ... seedToState`, also fails on `main` on x86_64 Linux: a
NaN sign bit; it passes on the owner's machine). **Not done:** DS0's published-place spike (scoped OrderedDataStores,
per-key write cooldown, `GetFriendsAsync` paging, thumbnails, the DataStore budget) and DS14's Studio check: nothing
here has run in Studio or a live server. Vale's two new sounds are unconfirmed picks (not built, SILENT).

## What the code gives us (read on `main` @ `fa15bf4`)

Paths are under `src/` unless they start with `docs/`.

| Fact | Where | Consequence |
|---|---|---|
| Floor seed = `runSeed ^ imul(floor, 0x85ebca6b)`; layout, boss pick (`bossKindFor`, own salt), breakables (own salt), affixes (own salt) all derive from it | `shared/dungeon/endless.ts`, `endlessData.ts` | A roster pick from the **run** seed on its own salt moves nothing upstream. Salts in use: `0x27d4eb2f` boss, `0x5bd1e995` breakables, `0xcc9e2d51` affixes, `0x4b564452` drops. The roster takes `0x165667b1` (xxHash32 PRIME32_5) |
| `spendEncounterBudget(rng, budget, floor, cap)` walks `ENDLESS_ROOM_KINDS`; `roomKindOpen` already closes a kind (unlock floor, `maxPerRoom`) in both loops without a draw | `shared/dungeon/endless.ts` | The roster is one more condition in `roomKindOpen`. A closed kind moves no total and no draw, exactly as the unlock floors do today |
| Unlock floors imp 2 / slime 4 / summoner 6 (EVD2); summoner at most 1 per room | `endlessData.ts` `ROOM_KIND_UNLOCK_FLOOR` | The roster respects them (DSD9): floor 1's seeded kind is a sniper or a bruiser |
| `roomPool.lock.spec.ts` pins floor 1's spender output (seeds 1-200, party 1-4); census specs print per-floor tables | `shared/dungeon` | The lock is re-recorded **by design** (DSD1); the census re-runs |
| Only `buildEndlessFloor` calls `endlessRoomSpawns`; it has `runSeed` in hand | `shared/dungeon/endless.ts` | One place to compute the floor's roster and pass it down |
| The server picks every seed: `RunSessionDeps.pickSeed()` (`Random:NextInteger`), sent back in `runStarted` (`StartRunReply.seed`); the client builds its world from that seed | `shared/run/runSessions.ts`, `server/services/RunSessionService.ts` | A daily start only swaps the seed source. The client never chooses a seed, so the daily seed can stay server-side until its day |
| Worlds are a registry (`registerRunWorld(kind, builder)`); `SERVER_REFUSED_WORLDS` holds client-only worlds | `shared/run/worlds.ts` | `daily` is one line: `(seed, o) => buildEndlessRunConfig(seed, o.partySize)` |
| ~20 sites compare the world kind with the string `"endless"` (SimController 7, limits 5, run/config 4, RunValidationService 2, leaderboard 2, play/config 2, mode 2, ...) | listed by `git grep '"endless"'` | Each needs to answer "is this the endless descent?" for `daily` too. One helper, `isEndlessWorld(kind)` (endless, daily; dev keeps its own rules), audited in DS0 |
| Boards: `"solo" \| "coop"`, OrderedDataStore `LB_Solo_v1` / `LB_Coop_v1` (key `u_<id>`), details `LB_Details_v1`; ordered value packs score (27 bits), floor (10), inverted time slot (16); PB rule inside `UpdateAsync` | `shared/leaderboard` (config, orderedValue, posting), `LeaderboardService` | Daily boards reuse the PB rule and value layout on **day-scoped** ordered stores. The value already holds score and floor, so a daily entry needs no details doc |
| Posting policy: `LEADERBOARD_ELIGIBLE_WORLDS` / `LEADERBOARD_DEATH_ONLY_WORLDS` = `["endless"]`; never Studio, private servers, debug or abandoned runs | `shared/leaderboard/config.ts` | Daily posts go only to the daily boards (DSD6); same eligibility rules |
| Top 100 per board cached 60 s per server (`SharedTtlCache`), `mine` cached 60 s; `getLeaderboard(board)` / `leaderboard(view)` remotes | `LeaderboardService`, `shared/network.ts` | Keys become (board, scope). OrderedDataStore gives no rank or count beyond the rows read: percentile needs its own count (DS6) |
| New best (merged): `KV_Records_v1` per player, `RunBaseline` frozen at run start, `NewBestTracker` edges (score crossing, deepest floor), score panel target row, stage card second line, run-over ribbon / roll / confetti, `RECORDS_POLICY` = endless | `shared/records`, `shared/view/hud/newBest.ts`, `NewBestController`, docs/NEW_BEST.md | The Daily reuses all of it with a different baseline (today's daily best) and adds a rank layer on top. Daily runs never write `KV_Records_v1` (DSD6) |
| Stage card: `Floor {floor}` plus new best's second line (`Deepest: floor 9 · 2 to go` / `NEW DEEPEST`) | `StageController`, `StageCard` | The roster's "New: Imps" line competes for that slot (DSD13) |
| Floor shout slot (combo tier, new best: priority newBest > tier), toasts (`ToastPanel`), first-sighting toasts (EV12) | `ComboController`, `ToastPanel`, `SightingController` | Rank and friend moments use the same slots with priorities; no new on-floor widget |
| Analytics: pure event specs from the server's replay, Roblox limits (100 custom names, 10 funnels) | `shared/run/analytics.ts`, `TelemetryService` | Daily start / finish / retry events and a day-over-day return metric fit the existing mapper |

## Player experience

### Seeded rosters (every endless run)

1. **Run start.** The stage card reads `Floor 1` and, under it, `Swarmers · Bruisers`. Floor 1 holds only those two.
2. **Floor 3.** The card reads `New: Imps`. From here imps join the rooms.
3. **Floors 5, 7, 9.** One more kind each time (`New: Oozes`, ...), until every kind is in (floor 9 at the latest, or
   when the unlock floors allow). Each seed reaches the full roster by a different path.
4. Bosses, their adds, turrets and the tutorial are unchanged.

### The Daily

1. **Main menu.** A Daily card next to Play solo:
   `DAILY #304 · Sat Oct 31` · `Swarmers · Snipers` (floor 1's roster) · boss on floor 5: Demon Lord ·
   `Your best today 23,410 · #41 (top 9%)` (or `Not played yet`) · `New daily in 5:12:33` · **Play Daily** (solo) and
   **Daily with friends** (opens a lobby on the daily world).
2. **Yesterday's podium** under it: the top 3 of yesterday's solo board (headshots, names, scores) and
   `You finished #57 · top 12%` if you played.
3. **In the run.** The score panel's target row (new best's) aims at the next rung: first your **best today**, then the
   **next rank** (`#41 → #40 · 310 to go`). Each pass is a beat:
   - passing your best today: new best's fanfare and shout (`NEW BEST TODAY!`);
   - passing a **friend**: a toast with their headshot, `Passed Alex (21,900)`, and a short sting;
   - **rank thresholds** (entering the top 100, top 10, top 3, #1): a floor shout (`TOP 10!`) and the rank-up sound.
   Ranks during the run are a prediction from the board as it was at run start; only the server's verdict saves them.
4. **Run over.** The result card: score and floor, `#38 today` (exact in the top 100) or `Top 14%` (estimate beyond),
   `of 1,240 players`, `Best today ↑ 23,410 → 26,870`, the friends you passed, `Saved` once the server confirms,
   `New daily in 5:10:02`, and **Retry Daily** as the first button (unlimited attempts, DSD3).
5. **Leaderboard panel.** Tabs: Today / Yesterday × Solo / Co-op × Global / Friends; the all-time endless boards stay
   under their own tab, unchanged.

## Design

### 1. Seeded rosters (`shared/dungeon`)

```
endlessRoster(runSeed, floor) -> ReadonlySet<string>
```

- **Order.** One Fisher-Yates shuffle of the non-swarmer room kinds (`ENDLESS_ROOM_KINDS` minus `swarmer`, in table
  order) from `new EncounterRng(u32(runSeed) ^ ROSTER.salt)`: 4 draws for 5 kinds, once per run (cached by run seed).
- **Growth (DSD2).** Target size at floor f: `1 + floor((f - 1) / ROSTER.floorsPerKind)` other kinds (`floorsPerKind` 2:
  floors 1-2 one, 3-4 two, 5-6 three, 7-8 four, 9+ five), capped at the number of kinds.
- **Monotonic build.** roster(f) = roster(f - 1) plus, while it is below the target, the first kind in the order that
  is **not yet in** and **unlocked at f** (`fromFloor`). A kind never leaves the roster. If nothing unlocked is left, the
  roster waits for the next unlock (e.g. the summoner at 6). Swarmers are always in (`ROSTER.always`).
- **The spender.** `roomKindOpen(k, floor, bought, roster)` returns false for a kind outside the roster. Nothing else in
  the spender, placement, packs or wide-body rules changes. `endlessRoomSpawns(d, floor, partySize, roster)`;
  `buildEndlessFloor` computes the roster and stores it on `EndlessFloorLayout.roster` (the view reads it) and passes
  it down.
- **Data.** `ROSTER` in `endlessData.ts`: `always: "swarmer"`, `floorsPerKind: 2`, `salt: 0x165667b1`. No magic numbers
  in `endless.ts`.
- **What moves.** Room spawns on every endless floor, so breakables (they keep clear of spawns) and affixes (stamped per
  spawn). Not the layout, digest, props, boss pick, spawn point or stairwell. Endless replays and scores change;
  leaderboards stay `_v1` (DSD10).

Known side effect, measured in DS1: a roster of only cheap kinds (swarmer + sniper, costs 1 / 2) cannot spend a big
party budget once the 16-slot cap binds (`ENDLESS_ROOM_ACTOR_CAP` x 2 = 32), so some deep party rooms get easier until
a dearer kind joins. The census reports it; tuning is an owner call.

### 2. The day and the daily seed

- **Day index** (`shared/daily`, pure): `dailyDay(unixSeconds) = floor((t - DAILY.epochSeconds) / 86400)` with the
  leaderboard epoch (2026-01-01 UTC), so today (2026-10-31) is **Daily #304** (day 0 = Jan 1 shown as #1: `label = day +
  1`). `dailyResetsAt(day)`, `dailyLabel(day)`. Day boundary: **UTC midnight** (DSD5; 5 pm Pacific in summer time, 4 pm
  in winter).
- **Seed (server only, DSD8).** `dailySeed(day)` = the first 4 bytes (big-endian uint32) of
  HMAC-SHA256(key, `"kv-daily|" .. day`) with a 256-bit key in `src/server/config/daily.ts` (not exported; never
  under `shared/`, ESLint blocks shared / client imports of `server/*`), so a client that sees today's seed cannot
  recover the key or compute tomorrow's. The SHA-256 / HMAC code is pure and shared (`shared/crypto`, FIPS 180-2 and
  RFC 4231 vectors); `dailySeedFrom(day, key)` refuses keys under 16 bytes. (First build used an invertible 32-bit
  mixer; the review caught it.) Valid by
  `isValidRunSeed`. The seed of today is sent to clients (`dailyStatus`), so the menu can preview the roster and boss.
- **Ruleset (DSD11).** `DAILY.ruleset` (an integer, `shared/daily/config.ts`; now **8**) joins the board scope. Bump
  it with any change that alters endless play; after an update, servers still on the old build keep posting to the old
  ruleset's board and new servers to the new one, so no daily board mixes two rulesets.
  History: 1 at launch of the feature; 2 with boosts from breakables (docs/BREAKABLE_DROPS.md, 2026-11-01); 3 with
  solid decor, room themes and the new enemies (docs/DECOR.md, docs/NEW_ENEMIES.md: one bump); 4 the pellets branch
  only (never on main); 5 pellets merged onto main's 3 (docs/PELLETS.md PL5, PD10); 6 bookcases and the library
  theme on main, then its reading area on the same number (docs/BOOKSHELVES.md BKD8, "Reading area"; treasure rooms also took 6 on their own branch, never on main); 7 treasure
  rooms merged onto main's 6 (docs/TREASURE.md TR5 and "As built (merge with main)", 2026-11-04: vaults, their chest
  piece and rewards change endless floors and play; the all-time boards stay `_v1`, TRD13), kept at 7 on the second
  merge (main's reading area, still at main's 6); 8 pacts and the Goldling merged onto main's 7 (docs/FORTUNE.md FD15,
  one bump for both, 2026-11-04: endless shrines, rooms and scores change; the fortune branch's own 6 never shipped).
  The history is also the comment on `DAILY.ruleset` (`shared/daily/config.ts`).

### 3. World, sessions, remotes

- **World.** `registerRunWorld("daily", (seed, o) => buildEndlessRunConfig(seed, o.partySize))`; not in
  `SERVER_REFUSED_WORLDS`. `isEndlessWorld(kind)` replaces the `=== "endless"` checks that mean "the descent" (DS0
  lists which ones; `RANKED_WORLD_KIND` stays `endless` for Play solo).
- **Seed policy.** `RunSessionDeps.pickSeed(worldKind, now)`: `daily` -> `dailySeed(dailyDay(now))`, every other world
  as today. The session stores `day` (and `ruleset`), so a run started at 23:58 posts to that day's board whenever it
  finishes (DSD5).
- **Lobbies.** A lobby carries its world (`endless` or `daily`); a daily lobby start resolves the seed at start time,
  like solo. Party rules, busy checks and lockstep are unchanged.
- **Remotes.** `requestDaily()` -> `dailyStatus({ day, label, seed, ruleset, resetsAt, mine: { solo?, coop? },
  podium })` on join, after each daily verdict and at the day change (the server pushes it at midnight; the client also
  re-requests when its `GetServerTimeNow()` passes `resetsAt`). `getLeaderboard` takes a board ref
  `{ board, scope: "alltime" | "today" | "yesterday", friends?: boolean }`.
- **Verdict.** `RunFinishVerdict.daily?: { day, posted, improved, previous?: { score, floor }, rank?, percentile?,
  total }` (rank exact when inside the top 100 read after the post, else from the histogram).

### 4. Daily boards (server)

- **Stores (DSD12).** `GetOrderedDataStore("LB_Daily_Solo_v1", scope)` / `"LB_Daily_Coop_v1"`, `scope = "d<day>_r<ruleset>"`,
  key `u_<UserId>`, value `encodeOrderedValue` (score, floor, time: unchanged layout). **No details doc**: the value
  decodes to score and floor; names come from the existing name cache. Co-op runs post one entry per credited member,
  as the all-time co-op board does.
- **Policy.** `LEADERBOARD_ELIGIBLE_WORLDS` and `LEADERBOARD_DEATH_ONLY_WORLDS` gain `daily`; a daily run posts to its
  day's board only, never to `LB_Solo_v1` / `LB_Coop_v1` (DSD6). `RECORDS_POLICY` stays endless-only. Studio, private
  servers, debug and abandoned runs never post, as today.
- **Caches.** Top 100 and `mine` keyed by (board, scope), 60 s; `yesterday` top rows cached longer (they stop changing
  once the day is over: `DAILY.yesterdayCacheSeconds` 600).
- **Budget.** Per finished daily run: 1 `UpdateAsync` per member (the same as an endless post today). Reads are served
  from caches; DS0 confirms the scoped-store calls count against the same per-server limits.

### 5. Percentile (histogram, DS6)

OrderedDataStore cannot count entries or rank a key outside the rows read, so each daily board keeps a score
histogram:

- `DAILY_HIST` buckets on a log scale of score (`bucketOf(score)`, 64 buckets, pure). On a personal-best post the
  `UpdateAsync` transform already sees the previous value: the server records a delta (`-1` old bucket if any, `+1` new
  bucket).
- **Sharded, buffered writes.** Deltas collect per server and flush every `DAILY_HIST.flushSeconds` (60) into one of
  `DAILY_HIST.shards` (8) keys, `<board>_<scope>_s<n>` in `LB_Daily_Hist_v1` (shard = hash of `game.JobId`), with
  `UpdateAsync` adding counts. Many servers never write the same key at once, and each server writes each key at most
  once a minute (DataStore's per-key write cooldown, confirmed in DS0). BindToClose flushes.
- **Reads.** Readers sum the shards (8 `GetAsync`, cached 60 s per board and scope). `estimateRank(score, rows, hist)`
  (pure): exact from the top-100 rows when the score is inside them; otherwise `above = (sum of higher buckets) +
  interpolation inside its bucket`, rank `above + 1`, percentile `rank / total`. Shown as `Top 14%` beyond the top 100;
  `#38` inside it; nothing below `DAILY.minEntrantsForPercentile` (20) entrants (`#3 of 12` instead).
- Counts lag up to a minute and the bucket interpolation is approximate: labelled as an estimate only by wording
  ("top 14%", never "#174").

### 6. Friends (DS7)

- `Players:GetFriendsAsync(userId)` once per player per session (paged, cached). The friend entries come from (a) the
  top-100 rows already read (free) and (b) one `GetAsync` per remaining friend on the day's ordered store, queued under
  a per-server read budget (`DAILY_FRIENDS.readsPerMinute`), deduplicated in a shared cache per (scope, userId) for
  `DAILY_FRIENDS.refreshSeconds` (900, stale-while-revalidate: a friend read once stays known and is re-read in the background behind never-read friends; a leaver's queued lookups are dropped). Friends in this server first, then the rest in list order, every friend looked up (DSD16: `DAILY_FRIENDS.max` 200, the friends-list limit). The Friends tab fills in as
  the queue drains; the in-run baseline takes whatever has arrived by run start.
- Friends tab: friends with an entry today, ranked, you included. The run baseline (below) includes their scores.

### 7. In-run rank layer (DS10)

- **Baseline frozen at run start** (new best's rule NBD10): today's `mine` (best today), the top-100 rows, the friends'
  scores and the histogram, from the client's last `dailyStatus` / board answer. Unknown parts show nothing (never a
  false beat).
- **`DailyRankTracker`** (pure, `shared/view/hud/dailyRank.ts`): per frame from the **shown** score (after
  `ScoreRoller`, like `NewBestTracker`) -> the target row text and edges: `bestToday` (handed to new best's tracker as
  its baseline: same fanfare), `friendPassed(userId)`, `rankThreshold(100 | 10 | 3 | 1)`. Each edge once per run;
  deferred under the stage cover; none after run over; reduced motion keeps text and sound, drops motion.
- **Target row.** Before best today: new best's `12,340 TO BEST`. After it: `#41 → #40 · 310`, then the next rung. Fits
  the existing row (no new row: 158 of 160 px stays).
- **Where beats show.** Friend passes: a toast (`ToastPanel`, headshot via `GetUserThumbnailAsync` on the client).
  Thresholds: the floor shout slot, priority new best > rank threshold > combo tier. Sounds: `sfx.rank.up`,
  `sfx.friend.passed` (DS12).

### 8. Menu and result card (DS9, DS11)

- **Daily card** on the main menu (beside Play solo; compact layout below it): label, countdown (client clock from
  `GetServerTimeNow`), floor 1's roster (`endlessRoster(seed, 1)` names), floor 5's boss (`bossKindFor(floorSeed(seed, 5))`,
  DSD14), your best and rank today, Play Daily, Daily with friends.
- **Podium strip**: yesterday's top 3 solo, your final rank / percentile there.
- **Run over (daily)**: new best's record rows plus a daily block: rank or percentile, total entrants, friends passed
  (up to 3 headshots, `+2 more`), `Saved` / `Not saved` from `verdict.daily`, countdown, **Retry Daily** first.

### 9. Theme

Strings `DAILY_STRING_KEYS` (`daily.title`, `.label`, `.resetsIn`, `.play`, `.playParty`, `.bestToday`, `.rank`,
`.percentile`, `.entrants`, `.podium.*`, `.passed`, `.rankUp.*`, `.retry`, `.tab.*`) and `ROSTER_STRING_KEYS`
(`roster.line`, `roster.new`; enemy names come from `enemy.<x>.name`). Port audio IDs `sfx.rank.up`, `sfx.friend.passed`
(SILENT in the placeholder; Ninja Adventure audition like new best's). One colour role `daily.accent` if the card needs
one (validated on `uiPanel`). `contract.luau` / `validate.luau` sit near Luau's 200 top-level locals: new key lists go
inside functions (as `REQUIRED_STRING_KEYS` does) and DS12 compiles both under Lune.

## Tasks

- **DS0. Audit and spike.** Read-only: list every `"endless"` world-kind comparison and decide per site whether `daily`
  belongs (write the table here); confirm the tutorial, M1 and the dev world never reach the spender with a roster
  question (dev: it does, by design); new best's baseline / records paths that must branch on `daily`. Spike
  (`KV_DailySpike`, published place): scoped `GetOrderedDataStore(name, scope)` reads and writes, the per-key write
  cooldown, `GetFriendsAsync` paging, `GetUserThumbnailAsync`, and the DataStore request budget with 8 histogram shards.
  **Verify:** the table and the spike results written into this doc and docs/SPIKES.md.
- **DS1. Seeded roster (dungeon).** `ROSTER` data, `endlessRoster`, `roomKindOpen(..., roster)`, `EndlessFloorLayout.roster`.
  **Verify:** specs: swarmer always in; floor 1 = swarmer + exactly 1 kind; monotonic growth; no kind before its unlock
  floor; target sizes per floor; same seed -> same roster on every call; layouts, digests, props and boss picks
  identical with and without the roster (only spawns, breakables, affixes move); `roomPool.lock.spec` re-recorded with
  a note; census tables (solo seeds 1-60, party 4 seeds 1-15, floors 1-20: kinds per room, budget spent) recorded here,
  with the cheap-roster party rooms called out; M1, fixtures and the tutorial lock specs unchanged.
- **DS2. Roster in the view.** Stage card line (`Swarmers · Bruisers` on floor 1, `New: Imps` when a kind joins),
  priority against new best's line (DSD13). **Verify:** pure specs for the line per floor (from the layout's roster);
  Studio look.
- **DS3. Day math, daily seed, world.** `shared/daily` (`dailyDay`, `dailyResetsAt`, `dailyLabel`, `DAILY` config),
  server-only `dailySeed` with `DAILY_SECRET`, `registerRunWorld("daily", ...)`, `isEndlessWorld` and the DS0 sites.
  **Verify:** specs: day boundaries (23:59:59 / 00:00:00 UTC), labels, seed validity over 10,000 days, no `DAILY_SECRET`
  under `shared/`; endless and daily build the identical world for the same seed.
- **DS4. Sessions and remotes.** `pickSeed(worldKind, now)`, session `day` / `ruleset`, lobby world choice, `requestDaily`
  / `dailyStatus`, the midnight push, `RunFinishVerdict.daily`. **Verify:** `runSessions.spec`: two players starting
  `daily` on the same day get the same seed, the next day a different one; a run started before midnight keeps its day;
  a daily lobby start; segment validation of a daily run (replay accepted).
- **DS5. Daily boards.** Board refs with scope, day-scoped ordered stores, policy (`daily` eligible and death-only, never
  on all-time boards, never in records), caches. **Verify:** `leaderboard.spec` with the in-memory fake: PB rule per day,
  a co-op run posts per member, an abandoned daily run does not post, an endless run never touches a daily board and
  the reverse, the ruleset splits boards.
- **DS6. Histogram and percentile.** `bucketOf`, delta buffer, sharded flush, `estimateRank`. **Verify:** specs:
  bucket edges; deltas from a PB replacement (old -1, new +1) and from a first entry; flush merges counts; estimates
  against exact ranks on synthetic boards (error bound written here); below 20 entrants no percentile.
- **DS7. Friends.** Friends list cache, budgeted per-friend reads, shared cache, the Friends tab view. **Verify:** pure
  specs for the queue order (in server first) and the budget; a Studio fake (`KV_FakeFriends`) since friends calls do not
  work in Studio.
- **DS8. Yesterday's podium.** Top 3 and your final entry for `day - 1`. **Verify:** spec for the podium view (fewer than
  3 entries, you on the podium, you not ranked).
- **DS9. Menu.** Daily card, countdown, roster and boss preview, podium strip, leaderboard tabs. **Verify:** pure view
  specs (countdown formatting, roster line, best / rank line per state); `footprint` / menu fit on desktop and touch;
  gamepad focus order.
- **DS10. In-run rank layer.** Baseline, `DailyRankTracker`, the target row, friend toasts, threshold shouts, the
  `bestToday` hand-off to new best. **Verify:** tracker specs (edges once, order when several rungs pass in one frame:
  the highest wins the shout, friends each get a toast, queued; nothing under the cover, after run over, or with an
  unknown baseline).
- **DS11. Result card.** Daily block on the run-over panel, Retry Daily. **Verify:** view specs for exact / estimated /
  too-few-entrants / not saved; Studio look.
- **DS12. Theme and audio.** Strings, roles, the two port audio IDs (placeholder SILENT, vale picks after audition).
  **Verify:** the theme validator passes for placeholder and vale; `contract.luau` / `validate.luau` compile under Lune.
- **DS13. Telemetry.** Events `daily_start`, `daily_finish` (score bucket, floor), `daily_retry` (attempt number bucket),
  and a "played yesterday's daily too" flag on the first daily of a day (from a per-player `lastDailyDay` in an existing
  doc, e.g. the records doc, which needs no codec bump if optional). **Verify:** analytics specs (names within Roblox's
  limits, fixed field values).
- **DS14. Studio check and docs.** The published-place checks (boards, histogram, friends, podium), CLAUDE.md decision
  log entry (roster: endless replays changed from floor 1; daily world), docs/SERVER.md DataStore table. **Verify:**
  owner sign-off.

Order: DS0, then DS1-DS2 (roster, shippable alone), then DS3-DS5 (a playable Daily with a board), then DS6-DS11 (the
dopamine layer), DS12-DS14 alongside.

## As built (2026-10-31)

Paths under `src/`. Pure logic lives in shared modules with specs; services and controllers are thin.

- **Roster (DS1, DS2).** `shared/dungeon` `rosterOrder(runSeed)`: Fisher-Yates over `[sniper, bruiser, imp, slime,
  summoner]` from `new EncounterRng(u32(runSeed) ^ ROSTER.salt)` (for i = 4..1, j = int(0, i), swap; 4 draws, no
  cache). `endlessRoster(runSeed, floor)` grows floor by floor to `min(5, 1 + floor((f - 1) / 2))` seeded kinds, each
  join the first kind of the order not yet in and unlocked on f; join order, swarmer first, never shrinks. With today's
  unlock floors no roster waits: sniper / bruiser on 1, imp 3, ooze 5, summoner 7, full on 9. `roomKindOpen` closes
  kinds outside the roster without a draw (optional trailing `roster` on `spendEncounterBudget` / `populateEndlessRoom` /
  `endlessRoomSpawns`); `buildEndlessFloor` always passes it and stores `EndlessFloorLayout.roster` (absent on the
  tutorial's floors). `roomPool.lock.spec` keeps the no-roster digests and pins the roster ones. Census: budget spent is
  unchanged on every floor (solo floor 1: 3.66 swarmers per room, was 2.51); a cheap roster can only leave budget
  unspent for parties of 5+ on floors 3-4. Stage card: `stageRosterLine` / `stageCardLine` (NEW DEEPEST > roster > new
  best's other lines), strings `roster.line` / `roster.new`; the run start shows floor 1's roster and holds the cover at
  least `STAGE_LOADER.rosterStartSec` (1 s; 0 removes the hold).
- **Day, seed, world, sessions (DS3, DS4).** `shared/daily`: `dailyDay`, `dailyDayStart`, `dailyResetsAt`, `dailyLabel`
  (= day + 1), `dailyScope` (`d<day>_r<ruleset>`), `DAILY.ruleset` 1 (8 since pacts and the Goldling merged onto treasure rooms, bookshelves and the reading area: "Ruleset" above); the
  epoch is `shared/config` `KV_EPOCH_UNIX_SECONDS` (shared with the leaderboard's ordered value). The `daily` world is `buildEndlessRunConfig`;
  `isEndlessWorld` (endless, daily) replaced the descent checks in SimController; `RANKED_WORLD_KIND` stays endless.
  `RunSessionRegistry` seeds a daily start from `dailySeed(dailyDay(ctx.unixNow))` (`StartContext.unixNow` =
  `GetServerTimeNow`; `now` stays `os.clock`) and stores `session.daily = { day, ruleset }` (also `StartRunReply.daily`).
  Lobbies carry `worldKind` (`endless` | `daily`), set by the host while forming (`lobbySetWorld`, clears Ready).
  `requestDaily` -> `dailyStatus` from `DailyService` (rate limit; broadcast when the UTC day turns, tracked by its own
  `lastPushedDay`); client `DailyController` + Reflex slice `daily`. `SimController.startSolo(lobbyId?, worldKind)`,
  `MenuController.playDaily` / `playDailyParty`; debug attribute `KV_Daily`. A refused or timed-out daily start falls
  back to an unranked local endless run, like Play solo.
- **With Builds and Developer mode (merged on `main`).** The `daily` world is `buildEndlessRunConfig`, so it carries
  `SimConfig.builds` (`BUILDS_CONFIG`) like endless (docs/BUILDS.md BUD8 "endless only" covers every world built from
  the endless config): daily runs draft cards, proc on-kill boons and score Jackpots; the server replays them through
  the same builder. The client-only `dev` world (docs/DEV_MODE.md) builds endless floors too, so it gets the seeded
  roster; it is not `isEndlessWorld` (never submitted, its own start floor: SimController checks `DEV_WORLD_KIND`
  first), and its run start's stage line lists the whole roster of its start floor, not only the kinds joining there.
- **Boards, percentile, friends, podium (DS5-DS8).** `BoardRef { board, scope, daily? }`; the all-time boards stay
  unscoped and byte-compatible. Daily posts: `policy.dailyWorlds` (not `LEADERBOARD_ELIGIBLE_WORLDS`, which records
  reuse), death-only, never Studio / private servers / debug / abandoned, to the session's day. `getLeaderboard({ board,
  scope: "alltime" | "today" | "yesterday", friends? })`; views carry `scope`, `day`, `total`, `pending`,
  `mine.percentile`. Histogram: 64 log buckets (2^k x {1, 5/4, 8/5}), deltas from the PB transform, per-server buffer
  flushed every 60 s into 8 JobId shards; `estimateRank` is exact in the top 100, interpolated beyond (within 1
  percentile point on log-normal boards, 3 on a dense bimodal one); percentile = `ceil(100 x rank / total)` from 20
  entrants. `RunFinishVerdict.daily` waits up to 15 s for the members' writes and ranks on the cached rows with the new
  entry merged in (no extra sorted read). `dailyStatus.mine` is `{}` plus entries once both boards were read (absent =
  unknown), `podium` = yesterday's solo top 3 + the caller's final entry. Friends: `DailyFriendsService`
  (`GetFriendsAsync` once per session, Studio `KV_FakeFriends`), one per-server queue at 30 reads / min, in-server
  friends first, refresh 900 s. Tables in docs/SERVER.md.
- **Menu and result card (DS9, DS11, DS12).** `DailyCard` beside Play solo (compact: below it): label + UTC date, floor
  1's roster, floor 5's boss, best today (`#41` exact, `top 9%`, `#3 of 12`, `Not played yet`), a per-second
  countdown binding, Play Daily / Daily with friends; `DailyPodiumStrip` with headshots (one cache,
  `client/ui/hud/headshots.ts`). Lobby room world toggle (host, forming). Leaderboard tabs Today / Yesterday / All time
  x Solo / Co-op x Global / Friends. Run over (daily): `DailyResultBlock` owns the standing, entrants, countdown and the
  single Saved / Not saved chip; new best's `BestBlock` owns the record roll (`runOverBestLines`); Again reads Retry
  Daily. 63 strings `DAILY_STRING_KEYS`.
- **Rank layer (DS10).** `DailyRankBaseline` frozen at run start (today's top rows and friends view of the run's board,
  best today, total); `DailyRankTracker` from the shown score: next rung / #1 / nearer of next friend and the top-100
  cut-off in new best's target row; thresholds 100 / 10 / 3 / 1 once each, only on a real improvement and with that
  many others on the board; every friend at or above best today passed once (queued headshot toasts); held under the
  cover, none after run over. Shout priority new best > rank threshold > combo tier (`ComboController.requestShout`).
  New best on daily runs: `dailyBaselineFrom` (best today for the run's seed, score only, FIRST RUN TODAY), run-over
  record from `verdict.daily`. 22 strings `DAILY_RANK_STRING_KEYS`; port audio IDs `sfx.rank.up` / `sfx.friend.passed`
  (SILENT in the placeholder; unconfirmed vale picks `Bonus/PowerUp1` / `Bonus/Gold2` in `art/audio.json`). Debug
  `KV_DailyRankDebug`.
- **Telemetry (DS13).** `daily_start`, `daily_retry`, `daily_finish` (docs/SERVER.md); per-player
  `daily: { day, starts, lastFinishedDay?, prevFinishedDay? }` in `KV_Records_v1` (no codec bump; max-merged on whole-doc
  writes, same-day starts summed on delta writes), one UpdateAsync per credited member per accepted daily run.
  `RECORDS_POLICY` untouched (DSD6).

**Owner checks before shipping:** DS0 in a published place; DS14 in Studio (menu width 766 px and the phone fit, run-over
height at 720p, the rank text in the 158 / 160 px target row, toasts with headshots, tabs, the lobby toggle, a co-op
daily run); audition / build / upload the two sounds; histogram `DAILY_HIST.shards` (8) if more than ~80 servers write
in a minute; the 256-bit seed key sits in server source (never replicated to clients), so keep the repo private or move
it to a server-only store.

## Edge cases

- **Midnight.** A run posts to the day it started. The menu flips at `resetsAt` (client clock), and the server's push
  corrects it. A run in progress at midnight keeps its baseline.
- **Update mid-day.** Old and new servers post to different ruleset scopes (DSD11); the menu shows the board of the
  server you are on.
- **Co-op.** Solo and co-op are separate daily boards; each member's entry is their best co-op daily run. A party of
  mixed friends: each client's friends layer is its own.
- **Retries.** Unlimited (DSD3); quitting a bad run does not post (abandoned, as today). The best of the day stands.
- **Spectating after death.** The rank layer follows the team score (as new best does).
- **No DataStore (Studio, outages).** The card shows the label, countdown and preview; ranks and podium say nothing.
  Fakes: `KV_FakeDailyDay`, `KV_FakeDailyBoard`, `KV_FakeFriends` (Studio only).
- **Dev world.** Uses the roster (it builds endless floors); never posts.

## Decisions

Owner (2026-10-31, Kaleb; DSD5-DSD16 answered the same day):

- **DSD1. The seeded roster applies to every endless run**, not only the Daily. Endless replays and scores change from
  floor 1; the floor-1 lock spec is re-recorded.
- **DSD2. The roster grows by depth**: floor 1 swarmer + 1 seeded kind; one more seeded kind every 2 floors, within
  unlock floors.
- **DSD3. Unlimited daily attempts, best of the day counts.**
- **DSD4. Extras: result card with percentile, Friends on the daily board, yesterday's podium.** No streak.

- **DSD5. Day boundary at UTC midnight**, one global board per day; a run posts to its start day.
- **DSD6. Daily runs post only to daily boards** and never write `KV_Records_v1` (a known seed would otherwise farm the
  all-time boards). In a daily run, new best's baseline is your best today.
- **DSD7. Solo and co-op daily boards**, like the all-time tabs.
- **DSD8. The daily seed is server-only** (secret salt in `server/`), revealed per day through `dailyStatus`.
- **DSD9. The roster respects the unlock floors** (floor 1's seeded kind: sniper or bruiser). Alternative for more
  variety: let floor 1's pick include the imp.
- **DSD10. All-time boards stay `LB_Solo_v1` / `LB_Coop_v1`** despite the roster change (as with every earlier endless
  change, EVD11).
- **DSD11. A `ruleset` number in the daily board scope**, bumped with endless gameplay changes.
- **DSD12. Daily boards are day-scoped OrderedDataStores with no details doc** (storage stays small; old days are simply
  never read again). Alternative: MemoryStore sorted maps with expiry (no permanent storage, but not durable).
- **DSD13. Stage card: the roster line wins on a floor where a kind joins**; new best's line shows on the other floors
  and on its NEW DEEPEST floor (which outranks the roster line).
- **DSD14. The menu card previews floor 1's roster and floor 5's boss.**
- **DSD15. Percentile only from 20 entrants**; below, `#n of m`.
- **DSD16. Friends: every friend looked up (up to 200)**, in-server friends first, under the per-server read budget,
  cached 5 min per server (proposed 50; owner chose all).

## Risks

- **DataStore budget.** Friends lookups and histogram shards add reads; mitigated by shared caches, the per-server
  budget, buffered writes. DS0 measures. With all friends (DSD16) a 200-friend player costs up to 200
  reads per board per day (cached per server, shared across players); if the budget can't take it, the lever is
  `DAILY_FRIENDS.max`.
- **Percentile accuracy.** Estimated, lagging up to a minute; worded as "top N%", exact only in the top 100.
- **Cheap rosters in deep party rooms** leave budget unspent (DS1 census). Lever: let the spender spend the remainder on
  affix chance, or raise the cap with party size (an open item from docs/ENEMY_VARIANTS.md EV13 anyway).
- **Seed knowledge.** Retrying the same seed rewards memorising it; that is the point of a daily, and why daily runs
  stay off the all-time boards.
- **`contract.luau` locals.** New lists inside functions; DS12 compiles under Lune first.

## Out of scope

- Streaks, daily rewards or currencies; weekly seeds; seed sharing / custom seeds for players.
- Daily-specific modifiers (a "mutator of the day"): a natural follow-up once the Daily exists.
- Changing the unlock floors, weights or archetypes.
