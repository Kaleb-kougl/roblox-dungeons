# First-run tutorial ("Practice Descent"): plan

Status: **plan only, nothing built.** Written 2026-10-25 against the `slice` vertical slice (M1-M5 code-complete
headless). Work it task by task, like `PLAN.md`.

## Goal

The first time a player joins, they play a short, guided **Practice Descent** instead of a ranked run. It is the real
game: the same sim, Dungeon Forge collision, renderers, HUD, juice, boon draft, relics, shrine, stairwell and Mother
Bramble. The one difference is that **enemies can hit you but never take hearts**. Prompts teach every verb in the
room where it matters, and the last screen spells out the objective: go as deep as you can, because death ends the run
and your score goes on the leaderboard.

Target length: **4-6 minutes**. You can skip it at any time from the pause overlay, and replay it from there later.

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
join -> server loads onboarding doc --(tutorialDone = false)--> Practice Descent (floor 1 -> draft -> floor 2 boss)
                                   \-(true / load failed / timeout)-> normal ranked run (Tutorial in pause menu)
Practice Descent end (stairwell on floor 2) or Skip -> server marks done -> outro card -> "Start my first run" (startRun)
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
| 6 | Combat D | 1 bruiser | "Hold **Right click** / LT with the sword to **guard**: it deletes bullets, and shockwaves too." | >= 1 guard cancel (score `guard` source) and room cleared |
| 7 | Combat E | 1 turretSniper behind cover | "Swap to the bow: **E** / Y. Hold Right click / LT to charge a heavy arrow, then release." (pulse on WeaponPanel) | Weapon swapped, a heavy arrow fired, room cleared |
| 8 | Combat F | turretSprayer x2 (a bullet storm) | "Too many bullets? **Q** / RB burns an Ember and clears every enemy bullet. 2 per floor." | `emberUsed`, room cleared |
| 9 | Treasure | pedestal (existing M2 logic) | "Relics are permanent for the run. Walk onto the pedestal." | Pedestal taken |
| 10 | Shrine | curse shrine | "Curses make the run harder and your **score multiplier** bigger. **1** / A to accept, or walk away." | Accepted, or left the zone after seeing it |
| 11 | (any time, first kill) | | Callout on ScorePanel: "Kills, grazes and guard cancels score. Chain them for combo." | Shown once |
| 12 | Boss room (stairwell, open) | none | "The **stairwell** takes you down. Every floor raises the Depth and the danger." (marker on the stairwell) | Floor changes |

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
- R (restart) is off during the tutorial. The pause overlay gains **Restart tutorial** and **Skip tutorial** (with
  confirm). Skip counts as done.

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

### 2. World: `buildTutorialRunConfig()` (`shared/run/tutorial.ts`)

```ts
registerRunWorld("tutorial", () => buildTutorialRunConfig()); // seed is fixed; partySize must be 1
```

- `config = { endless: { runSeed: TUTORIAL.seed, worldForFloor }, scoring: ENDLESS_SCORING, tutorial: { harmless: true, startHalfHearts: 4 } }`.
- **Floor 1**: one fixed Forge layout (`TUTORIAL.floor1Seed`, small `roomCount`), chosen by a one-off search script
  (`scripts/find-tutorial-seed.js`). Criteria: a mostly linear path from the entrance with >= 6 combat rooms, then a
  treasure room, a shrine, then the boss room (stairwell, empty), with short corridors and low branching. Its
  `roomSpawns` come from a **room-order table** (`TUTORIAL_ROOMS`: lesson index -> room id + spawn list), not the
  encounter budget. `bossFloor: false`, so the stairwell is open from the start (the existing non-boss rule).
- **Floor 2**: a small Forge boss floor with Mother Bramble as its only initial spawn (`bossFloor: true`), scaled as
  endless floor 1 / Depth 1.
- **Lock spec**: `tutorial.spec.ts` asserts the layout digest, room order and room types, so a Forge change that moves
  rooms fails loudly instead of quietly breaking the lessons.
- Fallback if no good seed exists: hand-author a `Dungeon` (tile grid + rooms). `WorldController` builds from the
  `Dungeon` structure either way.

### 3. Tutorial script: `shared/tutorial/` (pure, headless-tested)

- `TutorialStep` data: id, room lesson index (or `floor`), prompt string keys per device, HUD highlight target,
  marker target (room door / pedestal / shrine / stairwell / boss), and `isDone(view, progress)`.
- `TutorialDirector`: a pure state machine fed once per rendered frame with the frame's sim events + `GameSnapshot`
  (`roomEntered`, `flaskUsed`, `rollStarted`, `weaponSwapped`, `emberUsed`, kills, score sources, `floorChanged`,
  `bossPhase`, draft confirm). It outputs `{ step, promptKey, highlight, marker, finished }`. It never writes the sim.
- Lessons can finish out of order (each one is tied to its room). The marker always points at the lowest unfinished one.
- The objective card's "Continue" is the FIRE edge, read from input the same way the draft's confirm is (no new input bit).

### 4. Client (`src/client`)

| Piece | Job |
|---|---|
| `TutorialController` (new, `controllers/game/`) | Waits for `onboardingStatus` (timeout `TUTORIAL.statusTimeoutSeconds`). If not done, or `KV_Tutorial` is true, asks `SimController` to start world `tutorial` **locally** (unranked, never submitted). Runs the `TutorialDirector` each frame after `KV_FxTracker` and pushes `tutorial` state to Reflex. Ends the run on the floor 2 -> 3 change, fires `tutorialFinished`, shows the outro |
| `SimController` | New entry point `startTutorialRun()`. The first run start is gated on the onboarding answer. `submitPolicy` gets the `tutorial` reason (never sent). R is off while the tutorial is running |
| `store/tutorial.ts` (Reflex slice) | `active`, `step`, `stepCount`, `promptKey`, `highlight`, `outroOpen` |
| `ui/hud/TutorialPanel.tsx`, `ObjectiveCard.tsx`, `TutorialOutro.tsx` | Prompt card, objective card, outro. Theme strings and roles only, scaled by `useHudScale` |
| Highlight ring | A `highlight` prop on `StatusPanel` (flask pips), `WeaponPanel`, `ScorePanel`, `BossBar` |
| `TutorialMarkerController` (`controllers/render/`) | One beam/arrow on the next target, built like `RunMarkerController`. Uses theme ID `ui.marker.tutorial` (placeholder: a `uiAccent` cylinder). Its pulse follows `motionScale` |
| `PauseOverlay` | During the tutorial: Resume / Restart tutorial / Skip tutorial (confirm) / Juice settings. Otherwise it gains a **Tutorial** button for replays |

### 5. Server: onboarding persistence (`OnboardingService`)

- Doc in a new DataStore `KV_Onboarding_v1`, key `playerDataKey(userId)`:
  `{ tutorialVersion: number, outcome: "completed" | "skipped", at: number }`. The codec lives in
  `shared/onboarding` (decode/encode/equals/empty + spec), so it reuses `PlayerDocCache` as it is.
- `tutorialDone = doc.tutorialVersion >= TUTORIAL.version`. Bump `TUTORIAL.version` after a major rewrite to re-offer
  the tutorial (it is offered, not forced: the outro has a Skip).
- Remotes (`shared/network.ts`): server -> client `onboardingStatus({ loaded, tutorialDone })`, sent after the join
  load. Client -> server `tutorialFinished({ outcome })` and `tutorialStep({ step })`, both rate-limited.
- **A failed load does not force the tutorial.** The client gets `loaded: false`, plays normally, and the Tutorial
  button stays in the pause menu. A veteran never gets dragged through it because of a DataStore outage.
- Trust: completion only skips a practice mode, so the server just records what the client says. There is nothing to
  replay or validate.
- Party (`KV_Party`): a player whose tutorial is running is treated as busy and isn't invited (the same "busy" path
  as a party run still being decided).

### 6. Telemetry

`tutorialStep` -> `TelemetryService` -> `AnalyticsService.LogFunnelStepEvent(player, "tutorial", sessionId, step, stepName)`.
It logs only increasing steps per session, plus `completed` / `skipped` as the last step. This gives the drop-off per
lesson in the Creator Dashboard funnel view.

## Tasks

- [ ] **T1. Sim harmless mode.** `SimConfig.tutorial`, `TutorialState`, the `damagePlayer` branch, `startHalfHearts`,
  the appended hash group, the README. → Verify: `npm run verify` passes with every golden fixture unchanged. New
  specs: with `harmless`, bullets, contact hits and DEBUG_HIT leave hearts and armor alone, `playerHits` / `hurtTicks`
  / combo cut behave as in a real hit, the player never dies, and a replay hashes the same.
- [ ] **T2. Tutorial world.** Seed search script, `buildTutorialRunConfig`, `TUTORIAL_ROOMS`, the floor 2 boss,
  `registerRunWorld("tutorial")`, `TUTORIAL` tunables in `shared/config`. → Verify: the lock spec (layout digest,
  room order and types). Both floors build on client and server alike. Not in `LEADERBOARD_ELIGIBLE_WORLDS`.
- [ ] **T3. (Optional) Training dummy archetype.** `dummy`: immobile, no attack, `hpMax` ~6, theme ID `enemy.dummy`
  (placeholder: a post). → Verify: an archetype spec, and that the registry and theme validation pass.
- [ ] **T4. Tutorial director.** `shared/tutorial` steps + director + `tutorial.*` strings in the placeholder pack
  (`hud.spec.ts` checks the keys). → Verify: a **tutorial bot** (`run/testing/tutorialBot.ts`, like `endlessBot`)
  plays the tutorial world headlessly. Every step completes in order, hearts never drop below the start (until the
  flask raises them), the floor 2 -> 3 change finishes it, and an out-of-order room visit still completes.
- [ ] **T5. Onboarding persistence.** `shared/onboarding` codec, `OnboardingService`, the remotes, the
  failed-load rule, KV_Party busy. → Verify: codec specs headless. In Studio (API access on): a new player gets
  `tutorialDone: false`, and after finishing or skipping, rejoining gives `true`. `KV_ResetOnboarding` clears it.
- [ ] **T6. Client.** `TutorialController`, the SimController changes, the Reflex slice, `TutorialPanel` /
  `ObjectiveCard` / `TutorialOutro`, HUD highlights, `TutorialMarkerController`, the pause overlay changes. →
  Verify: the Studio smoke test below.
- [ ] **T7. Telemetry.** The funnel steps. → Verify: a spec on the step filter (only increasing, no repeats after Restart tutorial); in Studio, no
  `ANALYTICS_FAILED` warnings while playing it through.
- [ ] **T8. Playtest pass.** Time the run (target 4-6 min), tune `bossHpPercent`, prompt wording and dummy hp. Check
  the phone emulator layout and a gamepad.

Critical path: T1 -> T2 -> T4 -> T6. T5 can run alongside T2-T4.

## Studio smoke test (for T6)

1. A fresh player (or `KV_ResetOnboarding`): F5 shows the objective card on a wounded player (2 of 3 hearts). No
   ranked `startRun` goes out (Output).
2. Walk each room: every prompt appears on entry with the right glyphs (repeat on a gamepad), the marker leads on,
   and harmless hits blink and play the hurt sound but hearts stay put.
3. Flask: F fills the hearts. Ember, guard, bow charge, roll: each one ticks its step.
4. Pedestal and shrine work as in a real run. The stairwell leads to the draft, then the floor 2 boss with
   previews and phase callouts.
5. Boss dies, step into the stairwell: the outro shows and the verdict line reads `Practice: not submitted
   (tutorial)`. "Start my first run" begins a ranked run.
6. Rejoin: the tutorial doesn't start. Pause -> Tutorial replays it. Pause -> Skip during a replay goes straight to a
   ranked run.
7. Studio without API access: no forced tutorial, the Tutorial button still works.

## Edge cases

- **Leaves mid-tutorial**: not marked done, so it starts over next join. (A floor 2 checkpoint is out of scope.)
- **R / D-pad down**: off during the tutorial. Restart lives in the pause overlay.
- **Debug keys** (K, J, N) still work under KV_Debug. K is harmless here, and N skips a floor (that is how you test
  floor 2 quickly).
- **Reduced motion**: the marker pulse and highlight ring scale by `motionScale`. Juice settings work as normal.
- **Co-op**: the tutorial is solo only (the builder throws for partySize > 1).
- **Touch**: the game has no touch controls yet (CLIENT.md lists keyboard/mouse and gamepad only). The prompts
  carry a touch variant key, to be filled in once touch controls exist.

## Open questions

1. **Flask lesson**: is starting the player wounded (2 of 3 hearts) acceptable, or would you rather drop the flask
   lesson and just mention it?
2. **Training dummy** (T3) or low-hp swarmers for the first attack room? The dummy is nicer for learning the
   3-hit combo, but it's one more archetype and theme ID.
3. **Boss in the tutorial**: keep the floor 2 Mother Bramble (it shows the full loop, adds ~1-2 min), or end at the
   floor 1 stairwell + draft?
4. **Curse shrine**: teach it, or leave it for players to discover? It's the most complex M2 system.
5. **Forced vs offered**: the plan forces the tutorial on the first join, with Skip in pause. Should Skip be hidden
   until the first room is done?
