# First-run tutorial ("Practice Descent"): plan

Status (2026-10-25, branch `tutorial`): **T1-T7 code-complete and verified headlessly** (`npm run verify`; the sim,
world, director, onboarding codec and funnel filter are specced under `src/shared/**`). **Nothing has run in Studio
yet**: the client (T6), the OnboardingService DataStore and remotes (T5) and the funnel calls (T7) are untested at
runtime. **T8 (playtest) is pending.** Planned against the `slice` vertical slice (M1-M5 code-complete headless), then
ported onto `main`'s main menu / Options with rebinding / same-server lobbies / Leave run (the M4 `KV_Party` invite
flow it first hooked into is gone; §4 / §5 say how it fits the new flow); the sections below are the plan with "as
built" notes where the build differs.

## Goal

The first time a player joins, they play a short, guided **Practice Descent** instead of a ranked run. It is the real
game: the same sim, Dungeon Forge collision, renderers, HUD, juice, boon draft, relics, shrine, stairwell and Mother
Bramble. The one difference is that **enemies can hit you but never take hearts**. Prompts teach every verb in the
room where it matters, and the last screen spells out the objective: go as deep as you can, because death ends the run
and your score goes on the leaderboard.

Target length: **4-6 minutes**. You can skip it at any time from the pause overlay, and replay it later from the main
menu (**Tutorial**).

## What the codebase gives us (and the constraints it sets)

| Fact | Where | Consequence for the tutorial |
|---|---|---|
| Every hit on a player goes through `damagePlayer()` (bullets, contact, DEBUG_HIT) | `shared/sim/player.ts`, `combat/ctx.ts` `hurtPlayer*` | "No damage" is one branch in one function, not a per-enemy change |
| The sim must replay bit for bit; every state field is hashed; opt-in features add a hash group only when their config is present | `shared/sim/README.md`, `step.ts` (`endless`, `scoring`, `party`) | Add `SimConfig.tutorial` with its own appended `tutorial` hash group. Without it nothing changes, and every golden fixture still matches |
| Endless worlds are `EndlessConfig.worldForFloor(floor) -> EndlessFloorWorld` with `roomSpawns` per room id (spawned when the player first enters a room), `bossFloor`, spawn and stairwell | `shared/sim/endless.ts`, `shared/run/endless.ts` | The tutorial is an **endless config with two hand-scripted floors**. Room-by-room spawns, the stairwell, the draft, pedestals and the shrine all come for free |
| Worlds are one line in a registry; only `LEADERBOARD_ELIGIBLE_WORLDS` post | `shared/run/worlds.ts` | `registerRunWorld("tutorial", ...)`. It never posts and is never submitted |
| Per-player DataStore docs already have a cache, retries, a leave/BindToClose save and rate limiting | `SettingsService`, `shared/settings` `PlayerDocCache` | The "has played the tutorial" flag is a second small doc built on the same pattern |
| Funnel analytics already wired | `TelemetryService` (`AnalyticsService.LogFunnelStepEvent`) | Per-step drop-off for free |
| The flask only heals when hurt; START_HALF_HEARTS = 6, FLASK_HEAL_HALF_HEARTS = 2 | `shared/sim/playerData.ts` | With no damage the flask can't be taught, so the tutorial **starts the player wounded** (4 of 6 half hearts) |
| All text is theme strings, all tunables live in `shared/config`, Workspace `KV_*` attributes drive Studio testing | `CLAUDE.md`, `docs/CLIENT.md` | `tutorial.*` string keys, a `TUTORIAL` tunables block, plus `KV_Tutorial` and `KV_ResetOnboarding` |

## Player experience

### Flow

```
join -> server loads onboarding doc --(tutorialDone = false)--> Practice Descent (floor 1 -> draft -> floor 2 boss),
                                   |                             straight away: no main menu first
                                   \-(true / load failed / timeout)-> the normal join flow: the main menu (Tutorial in it)
Practice Descent end (stairwell on floor 2) -> server marks done -> outro card -> "Start my first run" (= Play solo)
Skip (pause) -> server marks done -> back to the menu, like Leave run (the main menu; the lobby room while in a lobby)
```

### Floor 1: "The Training Halls" (scripted rooms, linear)

Each lesson belongs to a room. The prompt appears when the room is entered (`events.roomEntered`), so the lessons hold
up even if the player wanders off. A world marker (beam or arrow) always points at the next lesson room's door.

| # | Room | Spawns (deferred) | Prompt (keyboard / gamepad glyphs by `game.inputDevice`) | Done when |
|---|---|---|---|---|
| 0 | Entrance | none | **Objective card** (2 lines): "Descend as deep as you can. Each floor is harder; the run ends when your hearts run out." `Continue` | Card dismissed (FIRE) |
| 1 | Entrance | none | "Move: **WASD** / left stick" | Moved >= `TUTORIAL.moveTiles` (3 tiles) |
| 2 | Entrance | none | "You're wounded. Drink your flask: **F** / D-pad up. You get 3 per floor, refilled on every new floor." (pulse on the Flask pips) | `flaskUsed` event |
| 3 | Combat A | 2 training dummies (or low-hp swarmers, see open questions) | "Aim with the mouse / right stick. Hold **Left click** / RT to attack. The third swing is a finisher." | Both killed |
| 4 | Combat B | 3 swarmers | "They rush you. Getting hit flashes you red. **In a real run that costs half a heart.**" (first harmless hit: ghost half-heart flash + toast) | Room cleared |
| 5 | Combat C | 1 sniper | "The orange line is its aim. **Roll through the shot**: Space / LB. You can't be hit mid-roll." | Room cleared and >= 1 roll (praise toast on a graze) |
| 6 | Combat D | 1 bruiser | "**Right click** / LT with the sword to **guard**: it deletes bullets, and shockwaves too." (the guard is a press, 0.3 s) | >= 1 guard cancel (score `guard` source) and room cleared; waived if the room is cleared first (nothing left to guard) |
| 7 | Combat E | 1 turretSniper behind cover | "Swap to the bow: **E** / Y. Hold Right click / LT to charge a heavy arrow, then release." (pulse on WeaponPanel) | Weapon swapped, a heavy arrow fired, room cleared |
| 8 | Combat F | turretSprayer x2 (a bullet storm) | "Too many bullets? **Q** / RB burns an Ember and clears every enemy bullet. 2 per floor." | `emberUsed`, room cleared (the Ember waived if none is left) |
| 9 | Treasure | pedestal (existing M2 logic) | "Relics are permanent for the run. Walk onto the pedestal." | Pedestal taken |
| 10 | Shrine | curse shrine | "Curses make the run harder and your **score multiplier** bigger. **1** / A to accept, or walk away." | Accepted, or left the zone after seeing it |
| 11 | (any time, first kill) | | Callout on ScorePanel: "Kills, grazes and guard cancels score. Chain them for combo." | Shown once |
| 12 | Boss room (stairwell, open) | none | "The **stairwell** takes you down. Every floor is more dangerous than the last." (shown on the way there; marker on the stairwell. Depth only grows per boss kill, so the plan's "raises the Depth" was dropped) | Floor changes |

Then the real **boon draft** opens. Prompt: "Pick a boon: **A / D** / stick, then click / RT." It is done when a boon
is confirmed.

### Floor 2: "Mother Bramble" (boss floor, harmless)

- On entry: "Every 5th floor ends with a boss. **Orange previews show exactly where her bullets will go.**"
- Boss phase callouts on `bossPhase` events: "Phase II: new patterns." The boss bar is highlighted the first time.
- Optional `TUTORIAL.bossHpPercent` (default 100; drop it to ~60 if playtests run long).
- The boss dies, the stairwell opens, and the prompt reads "Take the stairwell to finish." Stepping in (the floor 2 -> 3
  change) **ends the tutorial**. The client stops the run before the floor 3 draft is shown.

### Outro card

"That's the descent. In a real run: no respawns, the floors keep getting harder, and your score goes to the
**leaderboard** (B)." Buttons: **Start my first run** (the ranked `startRun`) and **Play the tutorial again**.

### Throughout

- **Harmless hits look real.** The hurt blink, hurt sound, post-hit invulnerability (0.75 s) and combo cut all still
  happen. Only hearts, armor and death are skipped. The first few hits also get the ghost half-heart flash.
- The HUD is the real HUD. A small `TutorialPanel` (lower centre) adds the step's prompt, progress dots and
  `P: pause / skip`. Highlights are a pulsing `uiAccent` ring around the HUD element being taught.
- The InfoPanel verdict line reads `Practice: not submitted (tutorial)`.
- R (restart) is off during the tutorial. The pause overlay shows **Resume / Restart tutorial / Skip tutorial /
  Options** (Skip asks first). Skip counts as done.

## Architecture

### 1. Sim: `SimConfig.tutorial` (deterministic, opt-in)

```ts
// shared/sim/tutorial/tutorialData.ts (tunables) + tutorial.ts
export interface TutorialSimConfig {
	/** Hits land (events, hurtTicks, combo cut, on-hit hooks) but never remove armor or hearts, and never kill. */
	readonly harmless: boolean;
	/** Hearts at run start (half hearts); START_HALF_HEARTS when absent. Lets the flask lesson work. */
	readonly startHalfHearts?: number;
}
export interface TutorialState { harmlessHits: number } // hashed as the appended "tutorial" group
```

- `createSimState`: with `config.tutorial`, create `state.tutorial` and apply `startHalfHearts` to every player.
- `damagePlayer`: after the invulnerability check, `if (state.tutorial !== undefined && harmless)`: do
  `events.playerHits += 1`, `hurtTicks = HURT_INVULN_TICKS`, `runOnPlayerHit` and `harmlessHits += 1`, then return
  true. Skip the armor, hearts, Second Wind and death steps. `isPlayerInvulnerable` is unchanged, so a bullet is
  consumed exactly as in a real run.
- Hash: `writeTutorialHash` appended after `party` in the group order (update `shared/sim/README.md`).
- Nothing else in the sim changes. The tutorial **script** (prompts, step completion) lives outside the sim (part 3),
  so it can be reworded without touching replays.

### 2. World: `buildTutorialRunConfig()` (`shared/run/tutorial.ts`) (built, T2)

```ts
registerRunWorld("tutorial", (_seed, o) => buildTutorialRunConfig(o.partySize)); // seed ignored; party > 1 throws
```

- `config = { endless: { runSeed: TUTORIAL.runSeed, worldForFloor }, scoring: ENDLESS_SCORING, tutorial: { harmless: true, startHalfHearts: TUTORIAL.startHalfHearts } }`.
  The setup is an `EndlessRunSetup` (it hands out `endlessFloor(floor)` like an endless run, so the client renders it
  the same way). Tunables: `TUTORIAL` in `shared/config/tutorial.ts` (`runSeed`, `floor1` / `floor2` Forge seed + room
  count, `lastFloor = 2`, `startHalfHearts`, `moveTiles`, `clusterSpacingTiles`).
- **Tutorial floors are endless floors.** Every floor's Forge params are `tutorialForgeParams(seed, roomCount)` =
  `{ ...endlessFloorParams(TUTORIAL.runSeed, 1), seed, roomCount }`: the M1 preset plus every endless option
  (`solidPillars`: pillars are 1-tile WALL cells, cover against bullets and sight; `roomScale` = `ENDLESS_ROOM_SCALE`
  = 2: double-size rooms). Every floor's sim world is `endlessFloorWorld(layout)` (`shared/run/endless.ts`, the same
  builder `endlessRunFloor` uses): `circleMover`, `bulletBlocker`, `actorMover` and `actorSteerMover` (room enemies
  steer round pillars) on its dungeon. Only the seed, the room count and the room spawns are the tutorial's, so the
  practice run plays like a real endless floor, and a later endless change reaches the tutorial by itself: the lock
  spec checks the params and the world's SimConfig fields against an endless floor's, and its layout digests (and the
  lesson table check) fail when a Forge or endless change moves the layout, which then needs a new seed search.
- **Floor 1**: Forge seed **7513**, 10 rooms, chosen by `node scripts/find-tutorial-seed.js --floor 1 --rooms 10
  --from 0 --to 7999` (it runs `scripts/lune/find-tutorial-seed.luau` over the compiled `analyzeTutorialLayout`,
  `shared/run/tutorialLayout.ts`, on `tutorialForgeParams`): best (score 307) of 798 qualifying layouts in seeds
  0-7999. Every room is a lesson room; the tour is 277 tiles (the entrance -> boss walk is 105; legs of 19-30 tiles
  between the combat rooms), one loop corridor; no leg of it walks through a later lesson room (which would spawn it
  early). The analysis also counts lesson E's cover tiles (`coverTiles`, 34 here) and adds
  `LAYOUT_NO_COVER_PENALTY` when there are none. `bossFloor: false`, so the stairwell is open from the start.
  Room order (`TUTORIAL_ROOMS`, lesson -> room id / type -> deferred spawns):

  | Lesson | Room | Spawns |
  |---|---|---|
  | entrance | 4 entrance | none |
  | combatA | 0 combat | 2 `dummy` (cluster at the centre) |
  | combatB | 7 combat | 3 `swarmer` (cluster) |
  | combatC | 5 combat | 1 `sniper` (far from the door) |
  | combatD | 1 elite | 1 `bruiser` (far) |
  | combatE | 6 combat | 1 `turret.sniper` (`cover`: behind a solid pillar, out of sight of the door the player comes in by; the farthest such tile) |
  | combatF | 8 combat | 2 `turret.sprayer` (far, spread) |
  | treasure | 3 treasure | the normal relic pedestal |
  | shrine | 9 shrine | the normal curse shrine |
  | stairwell | 2 boss | none (the open stairwell at its centre) |

  Placement `cover` (lesson E, "behind cover"): `coverTiles(d, room, door)` are the room's spawn tiles with no line of
  sight from the door and a solid pillar within `COVER_PILLAR_TILES` (2: spawn tiles keep 8 floor neighbours, so one
  free tile separates it from the pillar); the farthest of them from the door. With none it falls back to `far`.
  Spawns stand on the populator's spawn tiles (`roomSpawnTiles`), which are also the floor's `roomSpawnTiles` for the
  safe-spawn rule. `tutorialRooms()` / `tutorialRoom(lesson)` add each room's `center`, `door` (the last corridor tile
  of the walk from the previous lesson room: the marker's target) and `spawns`. Also exported:
  `TUTORIAL_ENTRANCE_ROOM`, `TUTORIAL_TREASURE_ROOM`, `TUTORIAL_SHRINE_ROOM`, `TUTORIAL_STAIRWELL_ROOM`,
  `TUTORIAL_WORLD_KIND`.
- **Floor 2**: Forge seed **905**, 2 rooms (the entrance and a 34x26 boss arena, a 28-tile walk; `--floor 2 --rooms
  2,3,4 --to 3000`: the shortest walk, then the larger of the two 28-tile arenas) as a boss floor:
  Mother Bramble is the only spawn. **Floor 3+** (reached only by the floor 2 -> 3 change that ends the tutorial, or a
  debug skip) reuses floor 2's layout, empty, with the stairwell open, so the sim never throws.
- **Scaling**: in a tutorial run enemy hp and bullet speed scale as endless floor 1 on every floor (sim
  `tutorialScalingFloor`), and Depth is 1 until the boss dies: the dummy has its 8 hp and Mother Bramble her base hp.
  `TUTORIAL.bossHpPercent` is **not built**: no existing hook scales one archetype's hp per config without a new hashed
  field (T8 can add one to `TutorialSimConfig` if playtests run long).
- **Lock spec** (`tutorial.spec.ts`): the Forge params and floor-world SimConfig fields are an endless floor's, both
  layout digests (floor 1 `0f6e8049`, floor 2 `c0fd5b19`), the lesson table's room ids / types / order, the analysis's
  tour equals the table with no early rooms, lesson E's turret behind a pillar out of the door's sight, every spawn on
  a floor tile of its room, pedestal / shrine / stairwell rooms, determinism, a harmless smoke run, the debug floor skip 1 -> 2 (boss, draft) -> 3, the dummy's 8 hp, the
  registry, solo only.
- Server: `tutorial` is not in `LEADERBOARD_ELIGIBLE_WORLDS`, and the server never runs it: it is in
  `SERVER_REFUSED_WORLDS` (`shared/run/worlds.ts`, `isServerRunWorld`), so `RunSessionRegistry.start` (every session
  start: the ranked `startRun` and a lobby's party / solo start, hence every segment and final) answers `unknown_world`
  for it (lobby runs are always `RANKED_WORLD_KIND` anyway). It stays
  registered so the client's local `buildWorldSetup` builds it; the client plays it locally and never submits it (the
  one-shot `submitRun` validates only in the fixed `RunLimits.world` set, which never includes it).
- `RunTelemetry` now starts from `runStartHalfHearts(config)` (the run's real start hearts) in `LiveRun`, `validateRun`,
  `SegmentedValidator` and `LockstepClient`, so the wounded start is not logged as 2 half hearts lost on tick 1.

### 3. Tutorial script: `shared/tutorial/` (pure, headless-tested) (built, T4)

- `steps.ts` `TUTORIAL_STEPS` (15 steps, funnel numbers 1..15; `TUTORIAL_STEP_COUNT`, `tutorialStepName(n)`): per step
  a stable `id` (= funnel step name), `number`, `floor`, the floor-1 `lesson` room, a `prompt` id (theme keys
  `tutorial.prompt.<prompt>.<keyboard|gamepad|touch>`, `tutorialPromptKey(step | promptId, device)`; touch holds the
  keyboard text for now), an optional `highlight` (`flask | weapons | score | bossBar | hearts`), the `marker` target
  and the completion `rule`:

  | # | id | Room / floor | Done when |
  |---|---|---|---|
  | 1 | `objective` | entrance (the objective card) | a FIRE press edge in the frame's raw buttons, the card up >= `TUTORIAL.objectiveCardMinSeconds` (0.75 s) |
  | 2 | `move` | entrance | walked >= `TUTORIAL.moveTiles` (3) tiles |
  | 3 | `flask` | entrance (highlight: flask) | `events.flaskUsed` |
  | 4 | `attack` | combatA | room cleared (both dummies) |
  | 5 | `hits` | combatB (highlight: hearts) | room cleared |
  | 6 | `roll` | combatC | room cleared and >= 1 roll since entering |
  | 7 | `guard` | combatD | room cleared and >= 1 guard cancel since entering (waived when cleared first) |
  | 8 | `bow` | combatE (highlight: weapons) | room cleared, the bow in hand and a heavy arrow released since entering |
  | 9 | `ember` | combatF | room cleared and an Ember burnt since entering (waived when cleared with none left) |
  | 10 | `relic` | treasure | a relic taken |
  | 11 | `curse` | shrine (highlight: score) | a curse accepted, or the shrine zone left after standing in it |
  | 12 | `stairwell` | stairwell room (prompt shown on the way) | floor >= 2 |
  | 13 | `draft` | floor 2 | a boon confirmed |
  | 14 | `boss` | floor 2 (highlight: boss bar; marker: the boss) | Mother Bramble dead (Depth grew) |
  | 15 | `finish` | floor 2 (marker: its stairwell) | floor >= 3: `finished` |

  Callouts (`TUTORIAL_CALLOUTS`, one-shot toasts `tutorial.callout.<id>`, not funnel steps): `score` on the first kill
  (rings the score panel for `TUTORIAL.calloutHighlightSeconds`; this is lesson 11), `harmlessHit` on the first harmless
  hit (rings the hearts), `graze` on the first graze, `bossPhase2` / `bossPhase3`. The first `TUTORIAL.ghostHeartHits`
  (3) harmless hits set `ghostHeart`.
- `director.ts` `TutorialDirector`: `new TutorialDirector()`, then `update({ state, config, events, buttons, dt })`
  once per rendered frame (state read only, `LiveRun.frameEvents`, the frame's raw InputFrame buttons, real dt) ->
  `TutorialView` (reused object: `active`, `finished`, `stepIndex` / `stepCount` / `stepId`, `promptStepIndex`,
  `prompt`, `card`, `highlight`, `marker { kind, x, z }`, `done[]` / `skipped[]` / `stepsDone`, `callouts[]`,
  `ghostHeart`, `funnelStepReached` / `newFunnelSteps[]`, `revision`). It reads facts from the state wherever the state
  keeps them (rooms entered, score room clears and source counts, relics / curses / boons, the shrine zone,
  harmlessHits, the weapon in hand and the bow's heavy-arrow tick, the boss, floor and Depth), events only for
  flask / roll / Ember. Never writes the sim; deterministic for a frame sequence.
- Lessons latch done in any order (a room lesson only once its room is entered; its skills count from then). The
  current step is the lowest unfinished one: the marker points at it (a room's door until entered, then nothing while
  inside / the room centre after wandering out; pedestal, shrine, stairwell, the live boss). The prompt is the current
  step's, except inside an entered, unfinished lesson room (that lesson's) and before a lesson room is entered
  (`follow`: "Follow the marker to the next room."). A step still open when its floor is left is marked skipped, so an
  early stairwell never strands the player; the floor 2 -> 3 change finishes the tutorial and skips anything left.
- Funnel: `funnelStepReached` = leading steps PRACTISED (done and not skipped); `newFunnelSteps` lists the numbers
  reached this frame (send each with `tutorialStep(n)`). Strictly increasing by construction. It stops for good at the
  first skipped step: a lesson left behind when its floor was left is never credited, and steps done after it (the
  stairwell, the draft, the boss) do not move the funnel past it.
- `strings.ts`: `TUTORIAL_STRINGS` (objective card, panel, outro, pause, verdict) and `tutorialStringKeys()`, checked
  against the placeholder pack by `hud.spec.ts` and `tutorial.spec.ts`.
- Bot: `shared/run/testing` `playTutorial(options)` plays the world through `LiveRun` and the director (in tour order,
  or `order` / `flaskAfter` for an out-of-order run; `bossDebugEvery` presses J, unused by the spec). It walks straight
  only along a clear line in the same room (three parallel lines of sight a player radius apart), else the tile-grid
  BFS field (round solid pillars, through corridors), and shoots the bow only with a line of sight. Bot time: about
  151 s of sim (9052 ticks: floor 1 ~50 s in the double-size rooms, a ~100 s full-uptime melee Mother Bramble; the
  out-of-order run 158 s). A human reads prompts and fights at well
  under full uptime, so 4-6 min looks right; T8 times it for real.

### 4. Client (`src/client`)

| Piece | Job |
|---|---|
| `TutorialController` (new, `controllers/game/`) | Waits for `onboardingStatus` (timeout `TUTORIAL.statusTimeoutSeconds`). If not done, or `KV_Tutorial` is true, asks `SimController` to start world `tutorial` **locally** (unranked, never submitted); otherwise tells `MenuController` to run the normal join flow (the main menu). Runs the `TutorialDirector` each frame after `KV_FxTracker` and pushes `tutorial` state to Reflex. Ends the run on the floor 2 -> 3 change, fires `tutorialFinished`, shows the outro |
| `SimController` | New entry point `startTutorial()`. `submitPolicy` gets the `tutorial` reason (never sent). R is off while the tutorial is running |
| `store/tutorial.ts` (Reflex slice) | `active`, `step`, `stepCount`, `promptKey`, `highlight`, `outroOpen` |
| `ui/hud/TutorialPanel.tsx`, `ObjectiveCard.tsx`, `TutorialOutro.tsx` | Prompt card, objective card, outro. Theme strings and roles only, scaled by `useHudScale` |
| Highlight ring | A `highlight` prop on `StatusPanel` (flask pips), `WeaponPanel`, `ScorePanel`, `BossBar` |
| `TutorialMarkerController` (`controllers/render/`) | One beam/arrow on the next target, built like `RunMarkerController`. Uses theme ID `ui.marker.tutorial` (placeholder: a `uiAccent` cylinder). Its pulse follows `motionScale` |
| `PauseOverlay` | During the tutorial: Resume / Restart tutorial / Skip tutorial (confirm) / Options. Otherwise unchanged |
| `MainMenu` | Gains a **Tutorial** entry for replays (after Lobbies) |

As built (T6; code-complete, Studio check pending; ported onto the main menu / lobbies / Leave run build of `main`):

- **Gate**: `shared/tutorial` `flow.ts` `FirstRunGate` / `firstRunChoice` (`KV_Tutorial` > the status > the timeout
  `TUTORIAL.statusTimeoutSeconds` = 6 s), answering `"tutorial"` or `"normal"`. Nothing starts and no menu shows (the
  menu shell's backdrop only: Reflex `menu.awaitingFirstRun`) until it decided. `"tutorial"`: the TutorialController
  starts it at once, **without the main menu first**. `"normal"`: MenuController (`TutorialController
  .onFirstRunDecided`) runs main's join flow unchanged: the main menu, or a solo run with `KV_SkipMenu`.
- **SimController**: `startTutorial()` (the gate, the main menu's Tutorial, Restart tutorial, Play the tutorial again;
  the old solo run is left as by Play solo), `RunContext.tutorial` (and `lobbyId` ""), `freezeTutorialRun()` (a pacer
  that freezes every frame: the finished run stays on screen with no tick and no events, the floor 3 draft is never
  shown), `shared/play` `unsubmittedReason` (`tutorial` first), R / D-pad down off in a tutorial run (`handleReset`),
  `leaveRun()` stops a tutorial run at once (unsubmitted, no forfeit), `inRunningTutorial()` (playing, not yet
  finished).
- **Render step** `RENDER_ORDER.tutorialAfterFx` (Input + 3, `KV_Tutorial`). The director is not updated while the run
  is paused (a mouse-down on a menu button must not count as Continue).
- **End**: freeze and `tutorialFinished("completed")` at once; `TUTORIAL.outroDelaySeconds` (1.5 s) later the outro
  card (only the card waits for the beat, so a leave during it still records the completion). The outro's **Start my
  first run** is exactly the main menu's **Play solo** (HudController: `MenuController.playSolo`); **Play the tutorial
  again** starts a new tutorial run.
- **Skip** (pause -> Skip tutorial -> Skip): `tutorialFinished("skipped")`, then `SimController.leaveRun()`: the run
  stops for the menu like main's Leave run, so MenuController opens the after-run menu (the lobby room while in a
  lobby, else the main menu). Any run left for the menu clears the tutorial slice (`onRunExited`).
- **Pause overlay**: `shared/view/menu` `pauseItems(coop, tutorial)`: a tutorial run shows Resume / Restart tutorial /
  Skip tutorial / Options (no Leave run: Skip is the way out; no Leaderboards); Skip uses main's confirm layout
  (`Skip the tutorial?`, Skip / Keep playing, Keep playing selected on a pad). The old pause **Tutorial** replay button
  is gone: the replay is the main menu's **Tutorial** (`tutorial.menu.open`).
- **Lobbies** (main replaced the KV_Party invites with same-server lobbies): nothing takes a running tutorial over.
  `partyRunStarted` and a one-player lobby's `lobbyRunStart` are ignored while `inRunningTutorial()` (the server
  refuses those starts anyway: §5); the in-run `Lobby invites: N` badge is hidden during a tutorial run, and invite
  toasts only show on menu screens (not on the join backdrop). A finished tutorial (on its outro) is over: a lobby
  start may take the player from there.
- **Slice** `client/store/tutorial.ts`: `active`, step index / count / done, `prompt` (id; `selectTutorialPromptKey`
  resolves it by `game.inputDevice`), `card`, `highlight`, `markerKind`, `ended`, `outroOpen`, `skipConfirmOpen`,
  `ghostHeart` (a pulse token).
- **HUD**: `TutorialPanel`, `ObjectiveCard`, `TutorialOutro`, `HighlightRing` / `GhostHeart` (`TutorialFx.tsx`), the
  `highlight` props; tunables `TUTORIAL_VIEW`. Callouts are toasts (`TUTORIAL_VIEW.calloutSeconds`, wrapped).
- **Key names follow the player's bindings** (main's Options > Controls rebinding): the prompts are templates
  (`{move}`, `{fire}`, `{alt}`, `{roll}`, `{flask}`, `{swap}`, `{ember}`, `{skill1}`, `{left}`, `{right}`) filled by
  `shared/view/hud` `tutorialPromptVars(device, selectBindings)` (each action's primary on the last-used device; the
  pad's move / draft stick is fixed), so a rebound key shows in every prompt and the objective card. The outro's
  leaderboard key is the bound one (`tutorialLeaderboardHint`; `Start` on a pad: the pause menu's Leaderboards).
  `P` / `Start` in the panel's pause hint are fixed keys.
- **Marker**: a `uiAccent` Neon Cylinder; `ui.marker.tutorial` is optional (`ThemePack.image` returns undefined in the
  placeholder pack, so no contract or pack change was needed).

### 5. Server: onboarding persistence (`OnboardingService`)

- Doc in a new DataStore `KV_Onboarding_v1`, key `playerDataKey(userId)`:
  `{ tutorialVersion: number, outcome: "completed" | "skipped", at: number }`. The codec lives in
  `shared/onboarding` (decode/encode/equals/empty + spec), so it reuses `PlayerDocCache` as it is.
- `tutorialDone = doc.tutorialVersion >= TUTORIAL.version`. Bump `TUTORIAL.version` after a major rewrite to re-offer
  the tutorial (it is offered, not forced: the outro has a Skip).
- Remotes (`shared/network.ts`, built in T5): server -> client `onboardingStatus({ loaded, tutorialDone })`, sent after
  the join load and in answer to `requestOnboarding()` / `tutorialFinished(outcome)`. Client -> server
  `requestOnboarding()`, `tutorialStarted()` (new funnel attempt, in-tutorial: busy for lobbies),
  `tutorialStep(step)` (the server names the step from the shared step list, T4) and `tutorialFinished("completed" | "skipped")`, all re-validated and rate-limited.
  The version constant is `ONBOARDING_TUTORIAL_VERSION` (`shared/onboarding`). Details: docs/SERVER.md
  "Onboarding (tutorial)".
- **A failed load does not force the tutorial.** The client gets `loaded: false`, gets the normal main menu, and its
  Tutorial entry still works. A veteran never gets dragged through it because of a DataStore outage.
- Trust: completion only skips a practice mode, so the server just records what the client says. There is nothing to
  replay or validate.
- Lobbies (main's same-server lobbies replaced the `KV_Party` invites this was first built for): a player whose
  tutorial is running is busy for lobbies, the same "busy" path as a member of a party run still being decided
  (`RunSessionService.busyReason` = the registry's reason or `tutorialBusyReason`): they cannot create or join a lobby
  or be invited, the host's Start is refused and a due countdown is cancelled while they are in the lobby, and
  `startLobbyRun` re-checks every member before the handoff. As built: when a party run does start, every member's
  open attempt is closed (`OnboardingService.leaveTutorial`, unlogged), and a `tutorialStarted` from a member of an
  unconcluded party run is ignored (a late message), so nobody stays busy for the rest of the session.
- Rate limits (as built): `ONBOARDING_REQUEST_RATE` (request / started), `TUTORIAL_FINISH_RATE` (`tutorialFinished`
  alone, so other traffic never drops it; over it, the attempt still closes) and `TUTORIAL_STEP_RATE`.

### 6. Telemetry

`tutorialStep(step)` -> `TelemetryService` -> `AnalyticsService.LogFunnelStepEvent(player, "tutorial", sessionId, step,
stepName)`, `stepName` = the step's id in `shared/tutorial` `TUTORIAL_STEPS` (1..15; `completed` is 16).
It logs only increasing steps per attempt (each `tutorialStarted` is a new funnel session), plus `completed` as the
last step. The client reports only the leading lessons practised (§3: the funnel stops at the first skipped one), so a
player who took the stairwell early drops off at the first lesson they left behind. As built (T7), a skip is the custom event `TutorialSkipped` instead of a funnel step, because Roblox counts
every lower step as reached and a skip step would credit skippers with every lesson. This gives the drop-off per
lesson in the Creator Dashboard funnel view.

## Tasks

- [x] **T1. Sim harmless mode.** (Done, headless: `shared/sim/tutorial` + spec; every golden fixture unchanged.) `SimConfig.tutorial`, `TutorialState`, the `damagePlayer` branch, `startHalfHearts`,
  the appended hash group, the README. → Verify: `npm run verify` passes with every golden fixture unchanged. New
  specs: with `harmless`, bullets, contact hits and DEBUG_HIT leave hearts and armor alone, `playerHits` / `hurtTicks`
  / combo cut behave as in a real hit, the player never dies, and a replay hashes the same.
- [x] **T2. Tutorial world.** (Done: see §2.) Seed search script, `buildTutorialRunConfig`, `TUTORIAL_ROOMS`, the floor 2 boss,
  `registerRunWorld("tutorial")`, `TUTORIAL` tunables in `shared/config`. → Verify: the lock spec (layout digest,
  room order and types). Both floors build on client and server alike. Not in `LEADERBOARD_ELIGIBLE_WORLDS`.
- [x] **T3. (Optional) Training dummy archetype.** (Done: `dummy`, band 1 / index 7, 8 hp, `enemy.dummy` in the
  theme contract and placeholder pack; specs headless. Studio check pending: the placeholder post renders.) `dummy`: immobile, no attack, `hpMax` ~6, theme ID `enemy.dummy`
  (placeholder: a post). → Verify: an archetype spec, and that the registry and theme validation pass.
- [x] **T4. Tutorial director.** (Done: see §3.) `shared/tutorial` steps + director + `tutorial.*` strings in the placeholder pack
  (`hud.spec.ts` checks the keys). → Verify: a **tutorial bot** (`run/testing/tutorialBot.ts`, like `endlessBot`)
  plays the tutorial world headlessly. Every step completes in order, hearts never drop below the start (until the
  flask raises them), the floor 2 -> 3 change finishes it, and an out-of-order room visit still completes.
- [x] **T5. Onboarding persistence.** (Server + shared contract done; the Studio check is still to do.) `shared/onboarding` codec, `OnboardingService`, the remotes, the
  failed-load rule, busy for lobbies (first built for KV_Party invites). → Verify: codec specs headless. In Studio (API access on): a new player gets
  `tutorialDone: false`, and after finishing or skipping, rejoining gives `true`. `KV_ResetOnboarding` clears it.
- [x] **T6. Client.** (Code-complete; Studio check pending: see §4 "As built" and docs/CLIENT.md "The tutorial run".)
  `TutorialController`, the SimController changes, the Reflex slice, `TutorialPanel` /
  `ObjectiveCard` / `TutorialOutro`, HUD highlights, `TutorialMarkerController`, the pause overlay changes. →
  Verify: the Studio smoke test below.
- [x] **T7. Telemetry.** (Server side done: `TutorialFunnelTracker` + spec; the Studio check is still to do.) The funnel steps. → Verify: a spec on the step filter (only increasing, no repeats after Restart tutorial); in Studio, no
  `ANALYTICS_FAILED` warnings while playing it through.
- [ ] **T8. Playtest pass.** Time the run (target 4-6 min), tune `bossHpPercent`, prompt wording and dummy hp. Check
  the phone emulator layout and a gamepad.

Critical path: T1 -> T2 -> T4 -> T6. T5 can run alongside T2-T4.

## Studio smoke test (for T6)

1. A fresh player (or `KV_ResetOnboarding`): F5 shows a dark backdrop for a moment (no main menu), then the
   objective card on a wounded player (2 of 3 hearts). No ranked `startRun` goes out (Output).
2. Walk each room: every prompt appears on entry with the right glyphs (repeat on a gamepad; rebind e.g. Flask to G
   in Options > Controls first: the flask prompt says G), the marker leads on, and harmless hits blink and play the
   hurt sound but hearts stay put.
3. Flask: F fills the hearts. Ember, guard, bow charge, roll: each one ticks its step.
4. Pedestal and shrine work as in a real run. The stairwell leads to the draft, then the floor 2 boss with
   previews and phase callouts.
5. Boss dies, step into the stairwell: the outro shows and the verdict line reads `Practice: not submitted
   (tutorial)`. "Start my first run" begins a ranked run (as the main menu's Play solo does).
6. Rejoin: the main menu shows (no tutorial). Main menu -> Tutorial replays it. Pause -> Skip tutorial -> Skip during
   a replay goes back to the main menu (the lobby room while in a lobby), as Leave run does.
7. Studio without API access: no forced tutorial, the main menu shows, its Tutorial entry still works.
8. Lobbies (Test > Clients and Servers, 2 players, Player1 fresh): while Player1 plays the tutorial, Player2's
   Invite on them answers `Finish your current run first`. Rejoin both; Player1 joins Player2's lobby, readies, goes
   back to the main menu and picks Tutorial: Player2's Start answers the same until Player1 finished or skipped, and
   no lobby run ever replaces Player1's running tutorial.

## Edge cases

- **Leaves mid-tutorial**: not marked done, so it starts over next join. (A floor 2 checkpoint is out of scope.)
- **R / D-pad down**: off during the tutorial. Restart lives in the pause overlay.
- **First join vs the main menu**: a first-time player never sees the main menu first; the join waits (backdrop only)
  for the gate, at most `TUTORIAL.statusTimeoutSeconds`. `KV_Tutorial = true` wins over `KV_SkipMenu`; with the
  tutorial done, `KV_SkipMenu` still starts its solo run at once.
- **Skip / outro destinations**: Skip goes where Leave run goes (the main menu, or the lobby room while in a lobby);
  the outro's Start my first run is Play solo (ranked unless a debug attribute says otherwise), from the frozen run.
- **Lobbies**: a player in a lobby can start the tutorial (main menu -> Tutorial); they stay a member, the lobby cannot
  start (busy) until they finish or skip, and nothing (a party start, a solo lobby start, an invite toast) takes the
  running tutorial over. Once it finished (the outro is up) the server no longer counts them busy, so a lobby start
  may take them from the outro.
- **Leave run**: not offered in a tutorial run (Skip is its stand-in); `SimController.leaveRun` on a tutorial run
  stops it unsubmitted (no forfeit: the run was never ranked).
- **Debug keys** (K, J, N) still work under KV_Debug. K is harmless here, and N skips a floor (that is how you test
  floor 2 quickly).
- **Reduced motion**: the marker pulse and highlight ring scale by `motionScale`. Juice settings work as normal.
- **Boss on the stairwell**: Mother Bramble fights around the arena centre, where her stairwell opens. A player
  standing within `STAIRWELL_RADIUS` of it when she dies descends on that tick, so the `finish` prompt ("Take the
  stairwell to finish.") may never show and the outro follows the kill at once (the T4 bot, meleeing her, always does).
  Fine for the tutorial; T6 / T8 may want a short beat before the outro.
- **Co-op**: the tutorial is solo only (the builder throws for partySize > 1).
- **Touch**: the game has no touch controls yet (CLIENT.md lists keyboard/mouse and gamepad only). The prompts
  carry a touch variant key, to be filled in once touch controls exist.

## Decisions (owner, 2026-10-25; were the open questions)

1. **Flask lesson**: yes, the tutorial starts the player wounded (2 of 3 hearts, `TUTORIAL.startHalfHearts`).
2. **Training dummy**: yes, combat A uses two training dummies (T3), not low-hp swarmers.
3. **Boss in the tutorial**: yes, floor 2 is the Mother Bramble boss floor (the full loop).
4. **Curse shrine**: yes, it is taught (lesson 10, the shrine room).
5. **Forced vs offered**: offered on the first join (before the main menu), and **Skip is available from the pause
   menu at any time** (not hidden until the first room is done).
