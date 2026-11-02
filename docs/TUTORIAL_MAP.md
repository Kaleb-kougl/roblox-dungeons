# Tutorial map lesson: plan

Status (2026-11-01, branch `tutorial-map`): **TM1-TM4 and TM6 built headlessly; TM5 code-complete (Studio check
pending); TM7 (playtest) pending.** Planned against `main` @ `3124288`. Adds one step to the Practice
Descent (docs/TUTORIAL.md): **open the full map**. It reverses the "no tutorial lesson about it in v1" half of
docs/MINIMAP.md MD13 (the minimap itself stays on from the first tutorial frame). Tutorial script, HUD and funnel
numbering only: no sim, dungeon, lockstep, hash, replay or fixture change. Owner answers (Kaleb, 2026-11-01): the step
goes after `ember` (TMD1), an ignored prompt is waived (TMD3), touch is taught "tap pause to see the map" (TMD2 /
TMD6). TMD4, TMD5, TMD7 and TMD8 were accepted as proposed (owner, 2026-11-01). The sections below are the plan;
"As built" says where the build differs.

## As built (2026-11-01, headless)

1. **A rule's "current" counts this frame's steps.** A rule sees its step as current when every earlier step is done,
   including steps latched earlier in the same frame (the plan, and the code before, used the previous frame's
   `stepIndex`). So an unavailable map waives on the frame combat F completes, with no one-frame flash of its prompt.
   Only `objective` read the flag before; it behaves the same.
2. **The `next` marker reports the borrowed step's own kind** (`door`, `pedestal`, `shrine`, `stairwell`), never
   `next`, so the HUD sees the marker it would for that step.
3. **Bot.** `playTutorial` option `map` (`current` / `early` / `never` / `unavailable`) feeds `mapSeen` for one frame.
   The bot also gained an `onFrame(view, run)` hook (per-frame spec checks) and `mapSeenTick` in its result.
4. **The rebind spec uses G**, not N (N is reserved).
5. **Metrics:** a waived step sends no lesson report; `TutorialMetricsView` gained `waived`.
6. **The touch pause only counts while the map prompt shows** (review fix). The latch is set on a paused frame only
   when the player is on touch at that moment, the map prompt is on screen (`tutorialMapPromptShown`, flow.ts) and the
   solo pause overlay shows its map; on resume `mapSeen` = `game.map.open` or the latch. A pause for any other reason
   before combat F (Options, the Roblox menu) no longer completes the step untaught, and a keyboard player who resumes
   with a tap is not counted. A full-map open still counts at any time on floor 1 (TMD7).
7. **Known analytics effects of TMD3** (accepted, not code bugs):
   - While `map` is open it is the current and shown step on the walks combat F -> treasure -> shrine -> stairwell room,
     so for a player who ignores it that walk time lands on `map`'s clock (never reported: waived), not on `relic` /
     `curse` / `stairwell`. Within `t1r2`, lesson times for steps 12-14 include the walk only for players who opened the
     map. Compare them with that in mind (or filter by players whose `map` lesson time exists).
   - The funnel holds at step 10 until the map is opened or floor 1 is left; steps 11-14 then go out together. A player
     who quits, restarts or skips on floor 1 with the map unopened shows as stopping at `map` (and the skip / abandon
     `stepId` reads `map`), even with relic and curse done.
8. **Glossary:** `tutorial.prompt.map.touch` joined the `floor` term in `l10n/glossary.json`.
9. **Not specced:** a stuck episode on the `map` prompt (the stuck path is generic; Studio / dashboard will show it).

The onboarding numbers (TM4) and the client (TM5) follow §5 and §7: `TUTORIAL_FUNNEL_REVISION` 2 (`t1r2`),
`maxEventsPerAttempt` 84 / `maxEventsPerSession` 252, first-attempt bound 82; TutorialController passes `mapSeen`
(`game.map.open` or the touch pause-map latch, item 6) and `mapAvailable` (`game.map.available`); MinimapPanel
rings when `highlight === "minimap"`.

## Why

- **Nothing teaches the map.** The corner minimap shows from frame 1 of the tutorial (MD13), but no prompt names it
  or the full-map toggle (`map` action: M / D-pad left). Floor 1 is a linear chain with a beam marker and a floor
  arrow (docs/TUTORIAL_ARROW.md), so a new player never *needs* the map there and can finish without knowing M exists.
- **Endless is where it pays.** 12-16 double-size rooms per floor (`roomScale` 2), a camera of about 30 x 17 tiles,
  and a stairwell that stays hidden until someone sees it (MD4). The first real run is where players get lost.
- **Touch players cannot find it at all.** On touch there is no corner minimap (docs/MOBILE.md MBD8); the full map
  lives only in the solo pause overlay (and the co-op Map item). Nothing on screen hints that it exists.

## What the code gives us (read on `main` @ `3124288`)

| Fact | Where | Consequence |
|---|---|---|
| Steps are data; every open step is evaluated every frame and latches done in any order; the current step is the lowest unfinished one | `shared/tutorial` `steps.ts`, `director.ts` | A new step is one `STEP_DEFS` row plus a rule. An early map press can latch it silently |
| The current step's `marker` drives the beam and the arrow | `director.ts` `markerFor`, `TutorialArrowController` | A step with no room of its own must not drop the guidance: it needs to point at the next lesson (new marker kind `next`) |
| A step without a `lesson` shows its own prompt while current, except inside an entered, unfinished lesson room (that lesson's prompt wins) | `director.ts` `resolve` / `lessonHere` | The map prompt pauses inside treasure / shrine / stairwell rooms and comes back on the walks between them until done |
| An open step left behind on a floor change is **skipped**, and the funnel stops for good at the first skipped step | `director.ts` `update`, `resolve` | An ignorable step that can be skipped would cut every later step (stairwell, draft, boss, finish) out of the funnel: it must be waived instead (TMD3) |
| The director reads sim state, sim events and the raw sim buttons; the `map` action is **not** a sim button | `TutorialFrame`, `shared/play` `ACTION_BUTTONS` | The client must pass "the map was seen" as a new frame field |
| The full map's state is Reflex `game.map` `{ available, open }`; `available` is false until the floor's `EditableImage` uploaded, and stays false where it cannot be created (phones) | `MinimapController`, `client/store/game.ts` | `mapAvailable` lets the step waive itself instead of asking for the impossible |
| The director is not updated while paused | `TutorialController` | A touch player's pause-map view must be latched by the client and handed over on the next update |
| Prompt key names come from bindings through templates | `shared/view/hud` `tutorialPromptVars` | Add `{map}`; a rebind shows in the prompt |
| Funnel numbers derive from `TUTORIAL_STEP_COUNT`; `TUTORIAL_FUNNEL_REVISION` exists for exactly this | `shared/onboarding` `config.ts` | Numbers move by themselves; bump the revision |
| A first attempt's worst-case event count is `firstAttemptEventBound()` = **78** of `maxEventsPerAttempt` **80** | `analyticsCatalog.ts` (+ spec) | One more lesson makes it **82**: the cap must rise (TM4) |

## Player experience

- **Where:** step `map`, funnel step **11 of 17**, right after `ember` (combat F) and before `relic` (TMD1). By then
  seven rooms of the snake are revealed, so the map has something to show.
- **When it shows:** the moment combat F is done (and the step is still open), on the walk out of combat F. The
  lower-centre panel reads:

  | Device | Prompt (`tutorial.prompt.map.<device>`) |
  |---|---|
  | keyboard | "The map in the corner fills in as you explore. Open the full map: {map}. Press it again to close." |
  | gamepad | same text, `{map}` = the pad binding (D-pad left by default) |
  | touch | "Your map fills in as you explore. Tap the pause button to see the whole floor." |

- **Highlight:** the corner minimap panel gets the pulsing `uiAccent` ring (new highlight target `minimap`). With no
  corner panel (touch, Options > Display > Minimap Off, full map open) nothing is ringed (TMD6).
- **Guidance keeps going:** the beam and the arrow keep leading to the treasure room while `map` is current (marker
  kind `next`, TMD4), so the lesson never stalls the walk.
- **Done** the first frame the full map is open (keyboard / gamepad), or the pause overlay's map has been shown (touch)
  (TMD2). The full map is see-through and play goes on; the prompt moves on to "Follow the marker to the next room."
  Upright (docs/PORTRAIT.md PT6) the pause overlay's map is a square at the top with the pause menu under it (it was
  left of the menu, ~20 pt wide on an upright phone); the rule and the text are unchanged.
- **Not blocking:** entering the treasure room shows the relic prompt as today. If the map is still unopened, its
  prompt comes back on the walks treasure -> shrine -> stairwell room.
- **Already found it:** a player who opened the full map earlier on floor 1 (a curious M in combat B) has the step
  latched silently and never sees the prompt (TMD7), like a flask drunk early.
- **Never opened:** descending without opening it **waives** the step (done, not skipped), so the funnel keeps counting
  the later steps (TMD3). Same when the map is unavailable while the step is current (no `EditableImage`).
- Added time: about 2-4 s for a player who reads and presses.

### Why after `ember` (TMD1)

| Slot | For | Against |
|---|---|---|
| After `flask` (entrance, step 4) | taught with the other basic controls | the map shows one room; the reason for it is not felt yet |
| **After `ember` (step 11)** | 7 rooms revealed; the last combat lesson is done, the calm rooms follow; the prompt reappears on three walks | renumbers 6 later steps (relic .. finish) |
| After `curse` (step 13, before `stairwell`) | ties in with "find the stairwell" | only the one ~20-tile walk before the stairwell prompt takes over; most players would descend first (waived) |
| A callout (one-shot toast, no step) | no funnel change | no completion, no tracking, no repeat; the request was a step |

## Design

### 1. Step data (`shared/tutorial/steps.ts`)

```ts
// --- Floor 1, after combat F: the map (docs/TUTORIAL_MAP.md)
{ id: "map", floor: 1, prompt: "map", highlight: "minimap", marker: { kind: "next" }, rule: { kind: "map" } },
```

inserted between `ember` and `relic`, plus:

- `TutorialHighlight` += `"minimap"` (and `TUTORIAL_HIGHLIGHTS`).
- `TutorialMarkerKind` += `"next"`: the marker of the lowest open step **after** this one whose marker is neither
  `none` nor `next` (for `map`: relic's pedestal, door first; then the shrine; then the stairwell); none when there is
  none. Resolved by recursion into `markerFor(j)`, so `door` / `pedestal` / `stairwell` behave exactly as for their
  own step.
- `TutorialRule` += `{ kind: "map" }` (comment block: done when `frame.mapSeen`; waived when the run is past the step's
  floor or, while current, `!frame.mapAvailable`).
- Header comment: the funnel renumbering note, like the `boost` one.

### 2. Director (`shared/tutorial/director.ts`)

- `TutorialFrame` gains `mapSeen: boolean` (the map was seen this frame, per §3) and `mapAvailable: boolean`
  (Reflex `game.map.available`). Client facts, so the director stays pure and deterministic for a frame sequence.
- `evaluate` case `"map"`: `true` when `frame.mapSeen`; also `true` with `waived[i] = true` when `floor > step.floor`
  or (`current` and `!frame.mapAvailable`). Evaluated before the generic skip, so a floor change waives rather than
  skips.
- `TutorialView.waived: boolean[]` (per step, like `skipped`). Only the `map` rule sets it; the `boost` fade and the
  `ember` none-left waive keep today's behaviour (no data change for them).
- `markerFor`: kind `next` as in §1.
- Prompt resolution needs no change: `map` has no `lesson`, so its prompt shows whenever it is current outside an
  entered, unfinished lesson room, and never becomes `follow`.
- `revision` signature unchanged (the new fields are covered by `prompt` / `highlight` / `marker.kind`).

### 3. "Seen" per device (`shared/tutorial/flow.ts`, pure)

`tutorialMapSeen(device, fullMapOpen, pauseMapShown): boolean`:

- keyboard / gamepad: `fullMapOpen`. The pause overlay's map does **not** count: it does not teach the key.
- touch: `fullMapOpen || pauseMapShown` (on touch there is no map key: the solo pause overlay's map is the route, and
  the full map overlay opens only from the co-op Map item, which the solo tutorial never shows).

### 4. Metrics (`shared/tutorial/metrics.ts`)

- No lesson report for a waived step: `TutorialLessonTime` with field01 `map` then counts real opens, and
  `count(TutorialLessonTime map) / funnel reach of step 11` is the open rate.
- `TutorialStuck` may fire for prompt `map` (20 s on the prompt with no progress). Room entries reset the clock, so it
  only fires for a player who stands still ignoring it: kept, it is the "ignored" signal. `TUTORIAL_PROMPT_IDS`
  picks up `map` by itself, so the server accepts it.

### 5. Client

- **TutorialController**: per update, `mapAvailable = selectMapView(store).available`; a `pauseMapLatch` set on any
  frame where the run is paused, the solo pause overlay is open and `map.available` (the overlay then shows
  `PauseMap`), handed to `tutorialMapSeen(device, map.open, latch)` on the next unpaused update and cleared.
- **MinimapPanel**: a `highlight` prop drawing `HighlightRing` (TutorialFx) like StatusPanel / WeaponPanel / ScorePanel
  / BossBar; HudController passes `tutorial.highlight === "minimap"`.
- **`tutorialPromptVars`**: `map: actionLabel(b, "kbm" | "pad", "map", s)`.
- Nothing else: the full map's open / close, the pause map and the corner panel are unchanged.

### 6. Strings and theme

- Placeholder manifest: `tutorial.prompt.map.keyboard` / `.gamepad` / `.touch` (texts above).
- `l10n/context.json`: one context entry per key (`l10n:check` in verify). Locale tables pick them up on the next cloud
  round trip; English until then (LOCALIZATION.md: a missing entry falls back).
- No theme contract change: no new role, image or sound.

### 7. Funnel and telemetry

| | Before | After |
|---|---|---|
| Lessons (`TUTORIAL_STEP_COUNT`) | 16 | 17 |
| `relic` .. `finish` | 11 .. 16 | 12 .. 17 (`map` = 11) |
| `TutorialAttempt`: lessons / `completed` | 2-17 / 18 | 2-18 / 19 |
| Onboarding funnel: lessons / `Completed` | 4-19 / 20 | 4-20 / 21 |
| `TUTORIAL_FUNNEL_REVISION` (step 1 field02) | 1 (`t1r1`) | **2** (`t1r2`) |
| `firstAttemptEventBound()` | 78 | 82 |
| `TUTORIAL_TELEMETRY.maxEventsPerAttempt` / `maxEventsPerSession` | 80 / 240 | **84 / 252** (the spec pins session = 3 x attempt) |

All step numbers derive from `TUTORIAL_STEP_COUNT`; only the revision and the cap are edits. Compare across the change
by step name or filter by `revision`. `ONBOARDING_TUTORIAL_VERSION` is unchanged: returning players are not offered the
tutorial again for one new lesson (TMD5).

### 8. Tutorial bot (`shared/run/testing` `playTutorial`)

New option `map: "current" | "early" | "never" | "unavailable"` (default `"current"`): sets `mapSeen` on the first
frame `map` is current (`early`: during combat B; `never`: not at all; `unavailable`: `mapAvailable` false throughout).
Bot ticks are unchanged (the director never drives the sim); the funnel runs report 1..17.

## Tasks

- [x] **TM1. Step and director.** (Done, headless: `steps.ts`, `director.ts`, `flow.ts` `tutorialMapSeen`, the bot's
  `map` option; see "As built" 1-3.) §1-§3. → Verify (`tutorial.spec.ts`, `flow.spec.ts`, Lune): 17 steps, `map` is
  number 11, ids unique and <= 32 chars, `tutorialStepName(12)` = `relic` and `(17)` = `finish`; the bot in tour order
  completes every step in order with `map` done on its first current frame; `early` latches it with no prompt ever
  shown; `never` waives it on the floor 1 -> 2 change (done, not skipped, `waived`), and the funnel still reaches 17;
  `unavailable` waives it the frame it becomes current; while `map` is current the marker is the relic step's (door,
  then pedestal) and inside the treasure room the prompt is `relic`; after `relic` with `map` still open the prompt is
  `map` again; `tutorialMapSeen` cases (pause map counts on touch only).
- [x] **TM2. Metrics.** (Done, headless: `metrics.ts`, "As built" 5.) §4. → Verify: a waived `map` sends no lesson report; an opened one sends one; a stuck `map`
  episode reports with prompt `map`.
- [x] **TM3. Strings and `{map}`.** (Done, headless: `{map}` in `tutorialPromptVars`, the three
  `tutorial.prompt.map.*` strings, `l10n/context.json`.) §5 (prompt vars), §6. → Verify: `tutorialHud.spec`
  (rebinding `map` to G shows G; the pad shows its binding), the string key checks in `tutorial.spec` / `hud.spec`, `npm run l10n:check`.
- [x] **TM4. Funnel numbers and the event cap.** (Done, headless: revision 2 `t1r2`, cap 84 / 252, first-attempt
  bound 82.) §7. → Verify: `analyticsCatalog.spec` (82 <= 84, session 252),
  `funnelReports.spec` / `funnel.spec` with 17 lessons, revision `t1r2`.
- [x] **TM5. Client.** (Code-complete: TutorialController `mapSeen` / `mapAvailable` and the pause-map latch,
  MinimapPanel ring; Studio check pending.) §5 (TutorialController frame fields and pause latch, MinimapPanel highlight). → Verify:
  `npm run verify`, then the Studio check below.
- [x] **TM6. Docs.** (Done, 2026-11-01: the grep is clean but for notes on past numbering.) docs/TUTORIAL.md (lesson table, §3 step table 1..17, §6), docs/TUTORIAL_FUNNEL.md (17 lessons,
  4-20 / 21, 2-18 / 19, the cap), docs/SERVER.md (`tutorialLesson` step 1..17, onboarding 4..20 / 21),
  docs/MINIMAP.md MD13 (points here), CLAUDE.md decision log entry. → Verify: grep for `16 lessons`, `1..16`,
  `4..19`, `20 Completed` comes back clean.
- [ ] **TM7. Playtest.** Does the prompt land before the treasure room; is the text read; do players close the map
  again; touch (the pause route) and gamepad. Tune the wording.

Critical path: TM1 -> TM5. TM2-TM4 and TM6 can run alongside.

## Studio check (TM5)

1. Fresh tutorial (or `KV_Tutorial`), keyboard: after combat F the panel says "Open the full map: M", the corner
   minimap rings, the beam and arrow still lead to the treasure room. M opens the map, the prompt moves on, the ring
   stops; M closes it.
2. Rebind Map to G in Options > Controls: the prompt says G.
3. Gamepad: the prompt names D-pad left; it opens the map and completes.
4. Ignore it: the relic prompt shows in the treasure room; on the walk to the shrine the map prompt is back. Descend
   without opening: the step is waived (progress text counts it), the stairwell / draft / boss / finish steps still go
   out (`KV_AnalyticsDebug` echo: steps 12-17, revision `t1r2`, no `TutorialLessonTime` for `map`).
5. Press M during combat B, then play on: the map prompt never shows.
6. Touch (emulator): the prompt says to tap pause; pausing shows the map; on Resume the step is done.
7. Options > Display > Minimap Off: the prompt still shows, no ring, M still completes it.
8. Pause with the keyboard while the prompt is up: the step stays open after Resume.

## Decisions

- **TMD1. After `ember`, funnel step 11** (owner, 2026-11-01): see "Why after `ember`".
- **TMD2. Done on opening the full map** (owner, 2026-11-01: touch is taught the pause route). Touch also counts the
  pause overlay's map (its only route); keyboard and gamepad do not (pausing does not teach the key). Closing it is not
  required.
- **TMD3. Waived, not skipped** (owner, 2026-11-01), when floor 1 is left unopened or the map is unavailable: a skip
  would stop the funnel at step 11 for everyone who ignores an optional prompt and hide every later step. Waived steps
  send no lesson report, so real opens stay measurable.
- **TMD4. Marker `next`** (owner-accepted, 2026-11-01): the step borrows the next lesson's marker so the beam and arrow
  never go dark.
- **TMD5. No re-offer** (owner-accepted, 2026-11-01): `ONBOARDING_TUTORIAL_VERSION` stays; one lesson is not worth
  sending veterans back.
- **TMD6. Ring the corner minimap; nothing on touch** (owner, 2026-11-01: no touch Map button; MBD8 stands): no new
  touch art; the touch text names the button.
- **TMD7. Early opens count** (owner-accepted, 2026-11-01): the step latches from the first frame of floor 1, like the
  flask.
- **TMD8. Presentation and telemetry only** (owner-accepted, 2026-11-01): the director and HUD change, the sim does not;
  no hash, replay or fixture moves.

## Owner answers (Kaleb, 2026-11-01)

1. **Slot:** after `ember` (TMD1).
2. **Ignored prompt:** waive it (TMD3).
3. **Touch route:** "tap pause to see the map" (TMD2 / TMD6); no touch Map button.
