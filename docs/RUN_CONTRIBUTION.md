# Co-op contribution on the run-over screen (plan)

Status (2026-11-08): **plan**, nothing built. Checked against the code at `fb765ae5`. Owner answers (2026-11-08):
CTD1 (open on **You**) and CTD4 (the Party tab stays) confirmed; the rest are proposed. Builds on docs/RUN_RECAP.md
(the recap, its highlights, Details and `RecapTally`) and fills its "Later" line *co-op MVP rows*, without the MVP.

Goal: after a party run, each player can see **what they did for the team** (their share of the damage, kills and
boss damage, their parries, grazes, pickups and how long they stood) and, one press further, **the whole party's
lines**, each player with one positive title. In a party run the run-over screen **opens on You**; a `You | Team | Party`
tab strip switches to today's team highlights or the whole party. Solo runs are unchanged (the run is already yours).

**Sim impact: one unhashed feed, otherwise presentation only** (the GRAZE_PARRY.md GP1 pattern). `ScoreEvents`
(per tick, never hashed, cleared by `clearScoreEvents` at the start of every tick) gains per-player attribution for
what it does not carry today: the killer of each score pop, damage dealt (all / boss) and landed hits taken. No hash
group, replay, fixture, rng, score, leaderboard or lockstep change. Every number is derived by view collectors on the
same merged log, so **every client shows the same numbers and the same titles** without a server message.

## What the code says (checked 2026-11-08)

| Fact | Where | Consequence |
|---|---|---|
| Score is a team pool: one `ScoreState` (`total`, `points` / `counts` per source, `combo`, `hitsTaken` summed over the party) | sim/score/score.ts `ScoreState` | No per-player score exists; "your points" would need a split the sim never makes (CTD3: we do not show one) |
| The sim already credits each kill: `killActor` -> `scoreKill(state, a, ctx.playerIndex)` (Bounty, Vampire Fang, Gold Rush, Happy Hour read the killer) | combat/actors/actors.ts 262, score.ts 749 | Kill credit is a fact the sim already uses; we only report it: push the killer beside `popX` |
| `damageActor` adds `ev.damageDealt += dmg` (after filters, shields, caps and Executioner; overkill not counted) with `ctx.playerIndex` bound to the hitter: the bullet's owner, the swinging player, and in builds `ctx.actingPlayer(owner)` (procs.ts, duos.ts, riposte.ts, overcap) | actors.ts 199-228, combat/ctx.ts header, builds/*.ts | Per-player damage = the same `dmg`, keyed by `ctx.playerIndex`. 19 call sites to audit (CT0) |
| `damagePlayer(state, halfHearts, p, playerIndex)` counts `events.playerHits` (a sum); an Aegis / armor absorb is a hit (as PERFECT counts it) | sim/player.ts 273 | Per-player hits = one push of `playerIndex` where a hit lands |
| `ScoreEvents.grazePlayer` / `guardPlayer` per graze / erased bullet; `RecapTally` already tallies **parries and grazes per player** for the whole run | score.ts 205-216, shared/view/fx/recapTally.ts | The tally is the home for every new per-player counter |
| Pellets: `events.eaten` entries carry `player`; boost pickups: `DropsEvents` pickups carry the player | pellets/stepPellets.ts 119, drops/drops.ts 197 | Pellets and boosts per player need no sim change |
| Death / leave: `PlayerState.dead` per player, `hasLeft(state, i)` | sim/state.ts, sim/party.ts | Time alive, floor of death, "last standing", "left on floor N" from a collector watching the flags |
| **`You` rows use the view player.** `RecapController` passes `viewIndex: getViewPlayerIndex()`; at a wipe the spectate rule keeps **the last watched teammate** (spectate.ts: "wipe: the last watched player stays") | RecapController.ts 560-585, recap.ts 360-368, shared/view/spectate.ts 18 | **Latent bug:** a player who died first sees the teammate's parries / grazes / duos labelled `You`. Fixed in CT1 with `getLocalPlayerIndex()` |
| Names: `RunContext.memberNames` (index -> display name, set at the party start) | client SimController.ts 121 / 1031 | The Party view's names; nothing new from the server |
| Parties go up to `MAX_PARTY_SIZE` 8 (lobby `maxSize`) | sim/partyData.ts, shared/lobby/config.ts | The Party view is rows (one per player), not columns, and scrolls on a phone |
| Run-over pad surface: X toggles Details, B held exits; tabs (LB / RB) are already a menu primitive | shared/view/menu padActions.ts `runOver`, docs/GAMEPAD_MENUS.md | LB / RB switch `You / Team / Party`; X keeps Details |
| Party runs end on Back to lobby (no Again) and wait for the verdict | RunOverPanel `runOverExits` | Players sit on the panel for a few seconds anyway: the natural moment to look at the You tab |

### CT0 findings (2026-11-08)

Every `damageActor` deals a player's damage with that player bound as `ctx.playerIndex`, so **no `creditPlayer` was
needed** (CTD6 holds as written). Solo runs bind 0 throughout (`bind()`; `targetNearest` can only pick 0).

| Call site | What hits | `ctx.playerIndex` is |
|---|---|---|
| combat/combat.ts 505 `piercingBulletHit`, 581 `playerBulletHit` | Player bullets (arrows, test gun, every build bolt / shard / ember / reflected bullet: all carry the owner's emitter) | The bullet's owner: `playerBulletHitParty` -> `actingPlayer(playerBulletOwner(emitter))` |
| weapons/defs/sword.ts 160 / 166 (`hitSwing`, `hitFinisher`), testMelee.ts 29 | Swings through `sweepArc` | The swinging player (`stepPartyWeapons` -> `bindPlayer(i)`) |
| builds/fullHeart.ts 61 | Full Heart's beam (sword finisher via `buildsOnFinisher`, bow release in bow.ts) | The swinging / releasing player (weapons phase); `owner = ctx.playerIndex` |
| builds/siege.ts 251 / 263 | Siege Bolt slam + shockwave (`siegeArrowEnd` from `buildsOnHeavyEnd`) | The arrow's owner (the bullet walk's binding; `pin.owner` is that arrow's owner) |
| builds/onKill.ts 124 / 141 (Chain Spark, fork), 217 (Overkill streak); builds/smash.ts 63 (Demolition) | Proc drain | `resolveProc` -> `actingPlayer(q.owner)`; Storm Blade's pseudo proc via `releaseSparks` -> `actingPlayer(owner)`; smash procs are only queued for `owner >= 0` (breakables.ts 240) |
| builds/duos.ts 270 (Conductor), 295 (Thunder Guard) | Duo sparks | `releaseSparks` -> `actingPlayer(owner)` (queued by the arrow's owner / the guarding player) |
| builds/riposte.ts 314 | Counter-waves | `stepWave` -> `actingPlayer(w.owner)` |
| combat/ctx.ts 211 | `SimCtx.damageActor`, the wrapper all of the above but combat.ts use | Whatever the caller bound |

Kills without damage: a summoner's withering summons and a boss's withering adds die in `onDeath` inside the killing
hit, so their pops go to that hit's player; the debug boss key (J, `debugHit`, actor phase) credits the nearest living
player and is no `damageActor` (debug only). The Bomber's own blast is a quiet death (no pop). Builds v2 overcap points
(`buildsOnOvercap`) already read the same `ctx.playerIndex`.

`damagePlayer(state, n, p, playerIndex)`: every caller passes `p` and its own index: `ctx.hurtPlayer` (solo enemy
bullets, combat.ts 406: player 0), `ctx.hurtPlayerAt(k, ...)` for co-op enemy bullets (combat.ts 456: strikes,
Vengeful rings and the Bomber's blast are enemy bullets on this path), contact damage (actors.ts 357) and the Charger
(charger.ts 303); the debug hit K in `stepPlayer` (step.ts 316 solo default 0, 409 index `i`). `playerHits` is
incremented only in `damagePlayer` (twice: the tutorial's harmless path and the normal path) and `stepScore` adds it to
`hitsTaken` on every stepped tick, so hurt entries sum to `hitsTaken`.

Pops: `scoreKill` pushes one pop per scored kill (`events.kills` = pops). Per tick, pops = Δ`counts[KILLS]` + boss
kills (a `BOSS` award; the no-hit bonus is a second `BOSS` count with no pop) + Goldling jackpots (`GOLDEN`, whose count
also takes per-hit awards). With no boss or Goldling dying that tick, pops = Δ`counts[KILLS]` exactly (Horde's x2 adds a
`HORDE` count, never a pop; revived turrets pop once). So "kills" in the recap = pops, as Rules says. Checked per tick
in `sim/score/contributionFeed.spec.ts`.

## The views

A tab strip above the highlight grid (the near-miss line stays above the tabs on every tab), **party runs only** (`partySize >= 2`), in every world that has a recap
(endless, daily; dev runs highlights only, as today):

| Tab | Shows |
|---|---|
| **You** (opens here, CTD1) | Your contribution card (below), in the highlights' slot |
| **Team** | Today's 2 x 2 highlights (TEAM PERFECT rooms, best team streak, sync parries, ...) |
| **Party** | One row per player in index order: name, title, damage share, kills, parries, hits taken; your row outlined |
| Details (X, unchanged) | The score breakdown and the Build list (RRD5) |

### You

```
 YOU · Guardian                               (your title, CT3)
 [■■■■■■■■■■■■□□□□□□□□□□□□]  41% of the team's damage
 Damage      12,480  41%     Kills        86  38%
 Boss dmg     1,120  52%     Parries      14
 Grazes          63          Hits taken    5
 Pickups   4 boosts · 22 pellets
 Last to fall · floor 9 · 14:20   (or: Fell on floor 7 · 12:40)
```

- **Share bar:** one bar split into every player's damage share, yours bright (`playerOutline`), the others dim in
  index order; no names on it (the Party tab has them).
- **Cells:** the highlight grid's cell (`HighlightGrid`, 2 columns), so the layouts and fit rules carry over. A cell
  whose team total is 0 is dropped (no boss: no Boss dmg; no pellets world: pellets dropped from the pickups line).
  Shares are whole percent, largest-remainder rounded so the party's shares sum to 100.
- **Standing line:** `Last to fall · floor {n} · {time}` (the wipe's final death), `Stood to the end` (alive at run
  over: a run that ended without a wipe), else `Fell on floor {n} · {time}`; a leaver `Left on floor {n}`.
- Count-up: You plays on the run-over timeline where the highlights did (from 0.7 s, or after NB's rows on a record
  run): cells count on `RecapTimeline` rows (0.15 s apart, the tally's tick / land sounds, at most one sound a frame).
  Team's highlights count up the first time Team opens; later opens of any tab show final values. A skip press settles
  whichever tab is showing. Reduced motion: final values,
  one land.

### Party

- Rows in **index order, never sorted** (CTD4). Columns: name (the `name` font), title chip, damage share, kills,
  parries, hits taken. Your row carries the focus-corner outline. A leaver's row is dim with `Left on floor {n}`.
- 2-4 players: all rows fit; 5-8: the list scrolls (right stick, wheel, drag) inside the highlights' box.
- No crown, no "MVP", no colour for a low number.

### Titles (one positive title per player)

Every player gets exactly one title, the same on every screen. A title names where a player **led** the party, never
where they trailed.

| Title | Leads in | Needs |
|---|---|---|
| Heavy Hitter | damage dealt | share >= 1.2 x even share |
| Boss Breaker | boss damage | a boss was damaged |
| Finisher | kills | >= 10 kills |
| Guardian | parries | >= 5 |
| Daredevil | grazes | >= 30 |
| Untouchable | fewest hits taken | the party took >= 3 hits; ties: none |
| Last Stand | fell last (the wipe's final death) | always one |
| Collector | pellets + boosts picked | >= 10 |
| Teammate (fallback) | - | anyone left without a title |

Assignment (pure, deterministic): score each (player, title) by the player's lead over the next player in that stat
(relative, so a big lead wins), then greedy: the largest lead takes its title, that player and title leave the pool,
repeat; ties break by title order, then lower index. Names avoid boon / enemy names (no Bastion, Bulwark, Reaper,
Executioner). Thresholds are `CONTRIB_TITLES` tunables (CT10).

## Rules

- Party runs only; the local player is `getLocalPlayerIndex()`, never the view player (CT1).
- Numbers are whole-run (every floor), from tick 0 to the wipe tick; a leaver's numbers stay in the team totals.
- Kills here are **scored kills** (score pops), so the shares sum to the team's pops; revived turrets count once, as
  the score does.
- Damage is what the sim removed (after caps, shields, Executioner, never overkill), so a boss's damage cap is the same
  ceiling for everyone.
- Tabs never retry: switching tabs is not a press for `RunOverRetryGate`; Back to lobby is unchanged.
- Every party run over opens on You (CTD1); the tab is not remembered between runs.
- Verdict pending: drawn at once from the client's final state; an accepted verdict changes nothing here (the server
  holds no per-player numbers).
- Strings: every label a theme string with variables, sized for translation.

## Design

| Piece | Where | Step |
|---|---|---|
| Feed: `ScoreEvents.popPlayer` (killer per pop, beside `popX`), `dealtPlayer` / `dealtAmount` / `dealtBoss` (one entry per damaging `damageActor` with `dmg > 0`), `hurtPlayer` (one per landed hit); cleared in `clearScoreEvents`; scored runs only; parallel arrays, no allocation per tick | shared/sim score.ts, combat/actors/actors.ts, player.ts | CT2 |
| `RecapTally` grows: kills, damage, boss damage, hits, pellets, boosts per player; `deathTick` / `deathFloor` / `leftFloor` per player, the last death's index | shared/view/fx/recapTally.ts | CT2 |
| `RunContribution` (pure): `contributionOf(tally, partySize, local, names)` -> rows, shares (largest remainder), dropped cells, standing line; `assignTitles` | shared/view/hud contribution.ts, contributionConfig.ts (`CONTRIB`, `CONTRIB_TITLES`) | CT3 |
| Strings `CONTRIB_STRING_KEYS` (`run.recap.tab.*`, `run.recap.you.*`, `run.recap.title.*`, `.titleDesc.*`), built inside `REQUIRED_STRING_KEYS` (contract.luau / validate.luau near Luau's 200 locals), `l10n/context.json` entries | shared/theme runRecap.ts, packs, l10n | CT4 |
| `RecapTabs`, `ContributionCard`, `PartyRows` in three layouts (wide, compact, narrow); store slice `recap.tab`; `actions.setRecapTab` | client/ui/hud RecapBlocks.tsx (+ new file), store/recap.ts | CT5 |
| Pad: LB / RB cycle tabs on `runOver` (row `when: "party"`), hint bar; keyboard Q / E and Tab; touch taps | shared/view/menu padActions.ts / padHints.ts, RunOverPanel | CT6 |
| RecapController: builds the contribution once at run over (party runs), its own count-up timeline per first open | client/controllers/fx RecapController.ts | CT7 |
| Telemetry: `RunRecap` close rows gain one row kind `views` (value = seconds on You + Party, field02 the last tab) | shared/run recapAnalytics.ts, analyticsCatalog.spec | CT8 |

## Tasks

Each step is a commit; `npm run verify` before each.

- [x] **CT0. Findings.** List all 19 `damageActor` call sites and what `ctx.playerIndex` is bound to at each (player
  hits, swings, builds procs, duos, riposte, siege, smash, full heart, ctx wrappers); any site whose damage is not a
  player's gets a transient `SimCtx.creditPlayer` (-1 = nobody), reset in `bind()`, set beside `procGen`, never hashed.
  Confirm `damagePlayer`'s `playerIndex` at every caller (`hurtPlayerAt`, contact, strikes, Vengeful, bomber blast).
  Confirm the pop count equals `counts[KILLS]` in scored runs. -> Verify: each written here.
- [ ] **CT1. `You` is the local player.** `RunRecapInput.localIndex` from `SimController.getLocalPlayerIndex()`;
  `pickHighlights`' `You` rows (parries, grazes, duos / evolutions via `buildsOf`) read it. Spec: a party where player 0
  died first and spectates player 1 at the wipe shows player 0's parries. Ship this alone first (a bug fix today).
- [ ] **CT2. Feed + tally.** The four parallel arrays, the collector's new counters and death / leave watch. Specs:
  per-player sums equal the team totals (`damageDealt`, pops, `hitsTaken`) over a scripted 2-player run; solo runs
  unchanged; **every golden / replay / hash / determinism spec unchanged** (nothing new is hashed); bench.spec within
  noise.
- [ ] **CT3. Contribution core.** Shares (largest remainder, sum 100, a zero team total drops the cell), standing
  line, leaver, titles: greedy by lead, one per player, distinct, fallback, ties, thresholds, identical output for
  identical tallies (two "clients").
- [ ] **CT4. Strings** (contract, placeholder, vale, l10n context); Luau locals counted on out/.
- [ ] **CT5. Panel.** Tabs, You card, Party rows; fit.spec: 2, 4 and 8 players, record daily party run (the worst
  case), phone landscape / portrait, HUD 70 %; `npm run build:place`.
- [ ] **CT6. Input.** LB / RB, Q / E / Tab, taps; hint bar; tab presses never reach `RunOverRetryGate`; focus memory
  keeps Back to lobby reachable.
- [ ] **CT7. Controller.** Builds once, opens on You, count-up per first open, re-derive on a new final state only.
- [ ] **CT8. Telemetry.** The `views` row; catalog spec (still 37 names; field combinations under 8,000).
- [ ] **CT9. Docs.** As-built here, RUN_RECAP.md cross-link (its "co-op MVP rows" Later line points here),
  docs/CLIENT.md, the CLAUDE.md decision log entry.
- [ ] **CT10. [owner] Studio check and tuning** (below): title thresholds and wording from three co-op runs.

## Studio check

1. Two clients, die on floor 3: both open on You with the same team totals on both screens and each client's own
   numbers; LB / RB (or Q / E) shows Team; Party shows the same titles on both.
2. Die first and spectate: your You tab is yours (CT1), not the teammate's.
3. A boss floor wipe: Boss dmg shares sum to 100 %; no boss: the cell is gone.
4. Four players, one leaves on floor 2: dim row `Left on floor 2`, its damage still in the bar.
5. Eight players (`KV_Debug` fake party if available): the Party list scrolls on a phone.
6. Tabs never retry or exit; Back to lobby still one press; reduced motion; `en-XA`.
7. Feel: does any line read as blame? (Risk 1.)

## Decisions

CTD1 and CTD4 are the owner's (2026-11-08); the rest are proposed, recommendation first.

- **CTD1. Open on You** (owner, 2026-11-08), Team and Party one press away; not remembered between runs.
- **CTD2. Damage share is the headline**, with kills and boss damage beside it; it is the one number that reflects
  everything a player did to enemies (swings, arrows, procs).
- **CTD3. No per-player points.** The score is a shared pool with team multipliers (combo, Depth, curses, rooms,
  PERFECT, floors); a split would be partial and invite blame. The You tab shows no points at all.
- **CTD4. Party rows in index order, never sorted**, no MVP, no low-number colouring; everyone gets one positive
  title. The Party tab stays (owner, 2026-11-08).
- **CTD5. One unhashed feed** (GP1's pattern), not hashed per-player stats: nothing gameplay reads them, so they stay
  out of the hash and every replay.
- **CTD6. Credit follows `ctx.playerIndex`**, the same credit Bounty and Vampire Fang already use, so the recap never
  disagrees with the sim about who killed what.
- **CTD7. Client-derived, no server message:** lockstep makes every client's numbers equal; the server validates the
  run as today and stores nothing new.

## Risks

- **Blame.** Co-op stat screens can sour a party. Mitigations: no points, no sorting, titles only for leads, a
  fallback title for everyone; the Party tab is one press away, not the first thing shown. If playtests still read it
  as blame, revisit with the owner (the tab is the owner's call, CTD4).
- **Attribution gaps.** A damage source bound to the wrong player (CT0); the audit and `creditPlayer` cover it.
- **Panel height** on a record daily party run with 8 rows; the Party list scrolls inside the highlights' box.
- **Hot path.** `damageActor` gains a push per damaging hit (scored runs); CT2's bench check.

## Later

- The last run's contribution card in the lobby (a "last run" chip on each member).
- Stat bests per player in `KV_Records_v1` (most damage in a party run).
- Revives (docs/RUN_RECAP.md CMD7) as a contribution row once they exist.
