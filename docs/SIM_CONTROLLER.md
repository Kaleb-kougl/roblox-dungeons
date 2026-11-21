# SimController: census and split

What this is: a census of `src/client/controllers/game/SimController.ts` (the client's largest controller: 2,433 lines,
about 100 private members, no spec) by responsibility, the split it proposes, and what was built of it. Written
2026-11-21 at base commit `d4936547`. Tasks SE2 (census) and SE5 (split) of the staff presentation plan. **No behaviour
change**: a refactor only. Frame timing is delicate (docs/FRAME_PACING.md, docs/LOCAL_PREDICTION.md): nothing here may
move a clock read, the order of operations within a frame or the order of event connections.

Line counts are the base commit's.

## The file at the base commit

| Lines | What |
|---|---|
| 1-126 | Imports (about 120 names: `check:locals` counts each) and five module constants |
| 127-306 | Exported contracts: `RunContext`, `RunListener`, `StageWork`, `StageDriver`, `DraftRevealDriver`, `ToastChipSource`, `RunExitListener`; `MadeRun` |
| 307-365 | Free helpers: `claimsRecords`, `claimsDaily`, `readWorld`, `readSeed`, `floorSecretOf`, `placeKeyFor`, `floorModifierOf`, `memberName` |
| 366-437 | The class comment (the controller's whole contract) |
| 438-2433 | `SimController`: 62 fields, 86 methods |

73 files import from `SimController` (71 other controllers and UI modules, by path `../game/SimController` or
`./SimController`); the shared code only names it in comments.

## Census

One row per responsibility. "Reads / writes" are the controller's own fields. Every group also reads `ctx`.

| # | Responsibility | Fields | Methods | Lines |
|---|---|---|---|---|
| A | **Run context and listener fan-out** | `ctx`, `counter`, `listeners`, `floorListeners`, `exitListeners`, `lockedListeners` | `getContext`, `getState`, `getAlpha`, `getFrameEvents`, `getLocalPlayerIndex`, `getRunCharacters`, `getPlayerCharacter`, `getRunSpacing`, `isTutorialRun`, `isDevRun`, `isRunOver`, `onRunStarted`, `onFloorChanged`, `onRunExited`, `onLockedCharacter`, `notifyRunStarted`, `notifyFloorChanged`, `callListeners`, `stageOrNow`, `changeFloor`, `runInfo` | ~210 |
| B | **Solo frame** (sample once, gates, step, floor change, forfeit follow-up, HUD tick) | `input`, `coverGate`, `draftGate`, `pendingReset`, `pendingReplayCheck`, `hitstop` (public) | `frame`, `gateDraftConfirm`, `replayCheck`, `getFrameButtons`, `getFrameInput`; `FROZEN_PACER` | ~170 |
| C | **Co-op frame** (sample, menu gate, probe, pump at one `os.clock()`, sends, final, floor change, spectate, drawn, HUD tick) and the `lockstepFrames` receive | `coopMenuGate`, `input`, `draftGate` | `coopFrame`, the `Events.lockstepFrames` handler in `onStart` | ~150 |
| D | **Spectating** | `spectateRaw`, `spectatePrevRaw`, `spectateView` | `getViewPlayerIndex`, `getSpectateView`; inline in `coopFrame` | ~30 |
| E | **Local prediction on screen** | `smoother`, `predictResume`, `drawnBody`, `drawnState`, `drawnIndex`, `drawnActive`, `drawnAheadTicks`, `drawnX`, `drawnZ`, `drawnPlayerOf` (public) | `getDrawnPlayer`, `getPredictionAheadTicks`, `getPredictionSmoothing`, `updateDrawn` | ~90 |
| F | **Pause** (solo only) | `pausedByMenu`, `pausedByUi`, `uiPauseOpen`, `lastPaused`, `robloxMenuOpen` | `resume`, `unpause`, `pause`, `setUiPause`, the `GuiService.MenuOpened` / `MenuClosed` handlers | ~80 |
| G | **Run start** (solo: ranked request, busy retry, timeout fallback, forge; tutorial; dev; co-op) | `debug`, `awaitingStart`, `startReply`, `startRequests`, `nextRunLobbyId`, `rankedWorld`, `runCharacter`, `rankedUpgrades`, `rankedLook`, `startingTutorial`, `frozen`, `devRun`, `devSeed`, `pendingGodToggle` | `startSolo`, `startTutorial`, `startDev`, `restartAs`, `beginRun`, `beginTutorial`, `beginDev`, `pollRunStart`, `startRun`, `forgeRun`, `makeRun`, `startCoop`, `pickCharacter`, `walletStatus`, `soloLook`, `getRunCharacter`, `freezeTutorialRun`, `inRunningTutorial`, `isFrozen`, `getGodMode`, `isGodTogglePending`, `toggleGodMode`; `readWorld`, `readSeed`, `memberName`, `placeKeyFor` | ~640 |
| H | **Run end** (leave, exit, restart, stop) | `exitAfterVerdict`, `leaveAfterForfeit`, `restartAfterForfeit`, `leftPartyRun` | `leaveRun`, `exitRun`, `requestRestart`, `handleReset`, `clearExits`, `stopRun` | ~170 |
| I | **Submission and verdicts** | `submitted`, `lastSubmittedDied`, `awaiting`, `rankedRuns` | `submit`, `finishRanked`, `uploadSegments`, `onSegmentVerified`, `onRunFinished`, `onVerdict`, `claimOf`, `finishedClaim`, `pendingRunClaims`; `claimsRecords`, `claimsDaily` | ~260 |
| J | **HUD feed** (the ~10 Hz snapshot, toasts) | `hudTimer`, `toastSerial`, `toastChipSource` | `pushToasts`, `snapshot`, `coopSnapshot`, `setToastChipSource` | ~70 |
| K | **Registered drivers** (one direction: they register, never injected) | `stage`, `draftReveal` | `setStageDriver`, `setDraftRevealDriver`, `isHeldByLoader`, `isInputCovered` | ~25 |
| L | **Per-context caches** | `rumour`, `rumourCtx`, `secretCtx`, `secretPlan` | `getGoldenRumour`, `stepRumour`, `getFloorSecret`; `floorSecretOf`, `floorModifierOf` | ~60 |
| M | **Debug** (KV_Debug) | `debug` | `isDebugRun`, `publishLatencyProbe`, `logArrivals`; the timed branch of `callListeners`; the `[Stage] floor step` lines in `frame` / `coopFrame` | ~70 |

### Clock reads (none may move)

| Where | Read | Feeds |
|---|---|---|
| `lockstepFrames` handler | `os.clock()` once, before `receive` | The batch's arrival stamp (playout clock, FRAME_PACING Design 6), the input echo's trip (Design 9), `ArrivalLog.arrived` |
| `coopFrame`, before the pump (KV_Debug only) | `os.clock()` in `probe.frame` | The latency probe's press time |
| `coopFrame` | `os.clock()` once: `now`, passed to `pump` | The playout clock's frame; also `logArrivals(now)` |
| `coopFrame`, after the pump | `os.clock()` for `stepMs` (KV_Debug), `probe.stepped`, `probe.drawn` | Debug numbers only |
| `beginRun`, `pollRunStart` | `os.clock()` | The `startRun` timeout and the busy retry |
| `frame` (KV_Debug) | `os.clock()` around `run.frame` | `[Stage] floor step` |
| `callListeners` (KV_Debug) | `os.clock()` around each listener | `[Stage] listeners` |
| `pushToasts` | `os.clock()` | Toast expiry |

### Order within a frame (the contract to keep)

`BindToRenderStep(KV_Sim, Input + simAfterInput)`: `frame(dt)` then `stepRumour(dt)`.

- `frame`: `stage.frame(dt)` -> pending reset -> `pollRunStart` -> co-op? `coopFrame` : (frozen / held: `run.frame`
  with `FROZEN_PACER`) -> replay check -> sample -> cover gate -> draft gate -> god pulse -> `run.frame` -> floor change
  -> `uploadSegments` -> UI pause re-assert -> submit on the outcome -> forfeit follow-up -> toasts -> HUD tick.
- `coopFrame`: aim from last frame's drawn pose -> sample -> spectate command from the raw buttons -> menu / dead gate
  -> draft gate -> probe.frame -> `now` -> `pump(dt, sample, now)` -> probe.stepped -> `logArrivals` -> fire inputs ->
  fire hashes -> final (claim, verdict pending, fire) -> floor change -> spectate update -> `updateDrawn` -> probe.drawn
  -> toasts -> HUD tick (snapshot + debug line).

Event connections in `onStart`, in order: `onDriverAction`, `setRestartWindow`, `partyRunStarted`, `lockstepFrames`,
`runVerdict`, `runStarted`, `segmentVerdict`, `runFinished`, `MenuOpened`, `MenuClosed`, the render step.

### Coupling through shared mutable state

| State | Written by | Read by | Consequence |
|---|---|---|---|
| `ctx` | G (`forgeRun`, `startCoop`, `beginRun`, `startRun`), A (`changeFloor`), H (`stopRun`) | every group | The hub. Replaced, never mutated: `frame` re-reads `this.ctx ?? ctx` after a floor change |
| `submitted` | I (`submit`), G (`forgeRun`, `startCoop`, `freezeTutorialRun`) | B (`frame`), I | Ties B, G and I: the frame submits on the outcome, the forfeit follow-up waits on it |
| `rankedRuns` | G (starts), I, C (`coopFrame` final) | H (`exitRun`: decided?), I, A (`pendingRunClaims`) | Ties C, H and I |
| `hudTimer` | B, C, H (`leaveRun`), I (`onRunFinished`), L (`stepRumour`), G (starts) | B, C | Five groups force the next snapshot through it |
| `frozen` | G (`freezeTutorialRun`, starts), H (`stopRun`) | B, F, L, G | The tutorial's end reaches the frame, the pause rules and the rumour clock |
| `pendingReset` | `onDriverAction`, H (`requestRestart`, `clearExits`) | B (`frame`) | R is handled inside the frame, before the start poll |
| `leaveAfterForfeit` / `restartAfterForfeit` | H | B (`frame`: `afterForfeitStep`), H | The forfeit is a two-frame protocol between H and B |
| `exitAfterVerdict`, `leftPartyRun` | H | H, I (`onRunFinished` stops the run) | A verdict can end the run: I calls into H |
| `pausedByMenu` / `pausedByUi` / `uiPauseOpen` | F, G (`forgeRun`), H (`stopRun`), B (`frame` re-asserts the UI pause) | F, B | Pause state is reset by every start and stop |
| `debug` | G (every `begin*` / `startCoop`) | A, B, C, I, M | Read at run start, used everywhere a debug line or a records claim is decided |
| `drawn*`, `smoother` | E, G (`startCoop`: run-start snap) | C (`coopFrame` aim), M (debug line), views | E is self-contained but for two call sites |
| `spectateView`, `spectatePrevRaw` | C, G (`startCoop`) | D, E (`updateDrawn`: viewing self?), J (`coopSnapshot`) | D lives inside the co-op frame |
| `stage`, `draftReveal` | K | B, C, F, G, A, L | Read-only after registration |
| `awaitingStart` / `startReply` | G, H (`stopRun`), the `runStarted` handler | G (`pollRunStart`), H (`handleReset`) | The ranked start is a polled state machine inside the frame |
| `runCharacter`, `rankedUpgrades`, `rankedLook`, `devRun`, `pendingGodToggle` | G, H (`handleReset` for a dev run) | G, B (god pulse) | Start parameters carried across restarts |

**Reading.** E (prediction on screen) and the pure halves of M and J are leaves: they read a run and write only their
own state. I is nearly a leaf: it owns four fields, but `onRunFinished` reaches into H (it may stop the run) and J.
A's types are a contract with 73 importers and no logic. B, C, G and H are one state machine around `ctx`, the
forfeit flags and `submitted`: their order of operations IS the behaviour, and they cannot be pulled apart by pure
moves.

## Proposed split

The class stays where it is. **`SimController.ts` keeps its path** (not `sim/SimController.ts`): Flamework identifies a
controller by its file path (`client/controllers/game/SimController@SimController`), and `Flamework.addPaths` preloads
`src/client/controllers` in descendant order, so moving the file would change the id and could change the preload
order of every controller module. The helpers go to a new directory beside it, `src/client/controllers/game/sim/`
(plain modules, like `worldSurfaces.ts` there), and whatever is pure goes to `src/shared` with a spec.

| Step | What moves | To | Kind |
|---|---|---|---|
| 1 | The exported contracts (`RunContext`, `RunListener`, `StageWork`, `StageDriver`, `DraftRevealDriver`, `ToastChipSource`, `RunExitListener`), `floorSecretOf`, `floorModifierOf` | `sim/context.ts`, re-exported by `SimController.ts` so no importer changes | Pure move |
| 2 | E: the smoother, the resume blend and the drawn body as one class, `DrawnLocalPlayer` | `shared/view/predict/drawnLocal.ts` with a spec (pure: no clock, no Instance) | Move, `this.` fields become the class's own; `ctx` / `stage` reads become parameters |
| 3 | The co-op client's build from the A/B attributes, `publishLatencyProbe`, `logArrivals`, `memberName` | `sim/coop.ts` | Pure move, fields become parameters |
| 4 | `makeRun`, `readWorld`, `readSeed`, `runInfo`, `placeKeyFor`, `FROZEN_PACER`, `callListeners`, `snapshot`, `coopSnapshot` | `sim/solo.ts`, `sim/hud.ts`, `sim/listeners.ts` | Pure move, fields become parameters |
| 5 | I without `onRunFinished`: `submit`, `finishRanked`, `uploadSegments`, `onSegmentVerified`, `onVerdict`, the claims, the four fields | `sim/submissions.ts`, a class the controller owns | Move; `this.ctx` / `this.debug` become reads of the controller's own public getters |

**What stays in the class, and why.**

- `onStart` (every connection, in today's order), `frame`, `coopFrame`: the order of operations and every clock read.
- G and H whole (`begin*`, `pollRunStart`, `startRun`, `forgeRun`, `startCoop`, `leaveRun`, `exitRun`, `handleReset`,
  `stopRun`): one state machine over `ctx`, the forfeit flags, the start request and `submitted`. A pure decision in
  it is already in `shared` with a spec (`shouldRequestServerRun`, `afterForfeitStep`, `restartForfeits`,
  `partyExitStep`, `afterRobloxMenuClosed`, `lobbyStartAccepted`, `floorChangeStaged`, `unsubmittedReason`,
  `shouldSubmitRun`, `oversizeSubmission`); what remains is the wiring between them.
- `onRunFinished`: it ends the co-op run, forces a snapshot and may stop the run (H, J).
- F (pause), D (spectate: three fields inside `coopFrame`), K, L, `pushToasts`, `changeFloor`: small, and each reads or
  writes the hub.

**Already in shared (nothing to duplicate).** The playout clock (`lockstep/pacer.ts`), the lead (`lead.ts`), the
predictor (`predict.ts`, `predictMotion.ts`), the arrival log, the menu input gate (`menuInput.ts`), the smoother,
resume blend and drawn player (`view/predict`), the latency probe and the debug views (`view/latencyProbe.ts`), the
spectate tracker, the snapshot (`play/snapshot.ts`), the submit policy, the draft gate, `LiveRun`. The controller
holds none of that logic; what it holds is their call order.

**Not proposed.** Splitting `frame` / `coopFrame` into phases, a "RunLifecycle" class for G + H, or moving the class
file: each changes either the order of operations or the Flamework id / preload order, which cannot be checked without
Studio. A later step, once a two-client check has passed on this one, is G's ranked start (`awaitingStart`,
`startReply`, `pollRunStart`, `beginRun`) as a polled object with a spec of its transitions.
