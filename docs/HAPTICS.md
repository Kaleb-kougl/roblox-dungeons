# Haptics in play: kill tick, parry thump, boss stagger, hurt (plan)

Status: built on branch `haptics` (2026-11-13) without a Studio or device run: HP1-HP7 done; HP0 (spike on real
phones and pads) and HP8 (device check + tune) pending. Tasks HP0-HP8, decisions HPD1-HPD12. Owner answers 2026-11-13:
the stagger is the phase break (HPD4), the boss death rumble is in (HPD5), **getting hurt vibrates** (HPD9, reversed
from the draft), a separate Touch toggle (HPD6). The other decisions stand as recommended. Follows GMD14 in
docs/GAMEPAD_MENUS.md ("in-run haptics are a separate follow-up, not this plan"). What was built, and where it differs
from the plan below, is in "As built (2026-11-13)".

**Goal.** The moments that should land in the player's hands do: a **kill** gives a tiny, crisp tick; a **parry**
gives a short, solid thump; a **boss stagger** (a phase break) gives a heavy two-stage hit; the **boss death** rumbles
through the slow-mo; **getting hit** gives a rough double buzz you cannot mistake for a reward. On a gamepad and on a
phone. Haptics stay rare and small enough that they never turn into a constant buzz.

**Scope.** Presentation only: no sim, dungeon, lockstep, hash, replay, fixture or score change (as FEEL JD1 and
GPD1's view side). One new setting (`touchVibration`), one new string, one debug attribute. No new theme asset.

## What already exists (and is reused)

| Piece | Today | Where |
|---|---|---|
| Pad haptics | (Before this plan; folded into `HapticsController`, client/controllers/fx, by HP2.) `PadHapticsController` played `hapticTimeline` (a cue's pulses as on / off motor events) on the navigation pad with `HapticService:SetMotor`, only on motors `IsVibrationSupported` / `IsMotorSupported` report, behind pcall. `HapticGenerations`: a newer cue on a pad + motor drops an older one's later events. Motors to 0 on cleanup, vibration Off and leaving the gamepad. **Menus only** (`confirm`, `disabled`, `listEnd`, `holdComplete`) | client HapticsController (was PadHapticsController), shared/view/menu `padFeedback.ts`, `config.ts` `MENU_HAPTICS` |
| Setting | `DisplaySettings.padVibration` (default On, only Off stored), Options > Controls > Gamepad, `options.controls.vibration`; kept by the Display reset | shared/settings |
| Phones | **No haptics at all.** `SetMotor` is a gamepad API in practice; the engine's phone path is `HapticEffect` | - |
| Kill moment | Kill freeze 50 ms (80 heavy / elite), kill hold, kill ladder pitch, tracker `killed` events | freezeRules.ts, hitReact.ts, audio cues |
| Parry moment | `NearMissController` steps one `NearMissDirector` and calls `onFrame` subscribers; `NearMissFrame.parryCues` = one per guard start, local vs teammate, +3 st from 3 first-frame erases; solo 30 ms freeze | client NearMissController, shared/view/fx nearMiss* |
| Boss stagger | No stagger mechanic. The closest moment is the **phase break** (66 % / 33 %): TRANSITION (roar, immune, 1.5 s on the Demon Lord), 120 ms freeze, `phase` nudge. Boss death: 250 ms freeze + 0.5 s slow-mo, `death` nudge, `bossDefeated` | boss/shared.ts, freezeRules.ts `nudgeFor` / `freezeMsFor` |
| Hurt moment | `StateWatch.hurtKind[i]` per player: `harmless` (the tutorial), `armor` (armor / the Aegis pip only), `heart`, `lethal` (with the death edge). `HurtFlash` never restarts within `HURT_INVULN_SECONDS` (0.75 s) of the last start, only upgrades the kind. Solo 40 ms hurt freeze on `heart` / `lethal`, the 2 px `hurt` nudge in every mode | shared/view/watch.ts, HurtFlashController, freezeRules.ts |
| Quiet gates | `comboQuiet` (stage cover, run over), `selectMenuShown`, pause, spectating via `getViewPlayerIndex` | ComboController, client/store selectors |

Facts that shape the design:

1. **Kills come in bursts** (a ring clears a pack, a build cascade kills 6 in 0.3 s). One tick per kill would be a
   buzz. Kills inside one frame merge; a minimum gap and a per-second cap hold the rest.
2. **Phones need `HapticEffect`.** Roblox's `HapticEffect` (fully released 2025-09-16) supports iPhone, Pixel /
   Galaxy-class Android, Xbox and PlayStation pads. `HapticService` is documented as superseded by it. Today's menu
   code uses `SetMotor` only, and GM0 never answered whether `HapticEffect` works on our pads.
3. **Pads on phones are not supported** by `HapticEffect` (release post) and controllers on macOS 15+ neither. Those
   players get nothing, silently.
4. **Weak pulses vanish.** The engine says strengths under 0.1 may not trigger on some clients; the kill tick's
   floor is 0.15.
5. **Haptic hierarchy, not the reward hierarchy.** The audio / visual ladder is graze < parry < kill < tier-up < room
   clear (graze-parry fact 4). Haptics are scaled by **frequency and physicality**: kills are the most frequent, so
   they are the lightest; a parry is a body-level block; a stagger is the biggest blow in the game. Grazes, tier-ups
   and room clears get no haptic in this plan (HPD3).
6. **Hurt is information, not a reward.** It must feel different from a parry in the hand (a rough double buzz on the
   large motor, not one clean thump), and it is never dropped by the caps. It is already rate-limited by the
   invulnerability window: at most one per 0.75 s.

## Player experience (target)

| Moment | Pad (Xbox / PlayStation) | Phone | Rules |
|---|---|---|---|
| **Kill tick** (view player's kill) | small motor 0.25, 35 ms | Custom 0.35, 25 ms | One per frame; at least 0.07 s apart; at most 6 per second (the rest drop) |
| Kill tick, heavy / elite kill | small 0.4, 55 ms | 0.5, 35 ms | Same gap and cap; a heavy kill in a merged frame wins |
| **Parry thump** (view player's guard, first erase) | large 0.6, 80 ms + small 0.3, 50 ms | 0.8, 70 ms | One per guard (the `parryCues` grouping); `x3+`: large 0.8, 110 ms / phone 1.0, 90 ms |
| **Boss stagger** (phase break, everyone in the fight) | large 1.0, 120 ms, then large 0.45 -> 0 over 260 ms; small 0.5, 60 ms | 1.0, 110 ms, gap 40 ms, 0.5, 140 ms | Once per phase break, on the frame the 120 ms freeze starts |
| **Boss death** (HPD5) | large 0.9 -> 0 over 600 ms (rides the slow-mo), small 0.4, 80 ms | 1.0, 100 ms, then 0.6 -> 0 over 400 ms | Once |
| **Hurt**, `armor` / `harmless` | large 0.4, 90 ms | 0.6, 70 ms | View player's hurt edge (`hurtKind`); the tutorial's harmless hits teach it (FEEL JD8) |
| **Hurt**, `heart` | large 0.75, 90 ms, gap 50 ms, large 0.5, 90 ms; small 0.4, 60 ms | 1.0, 80 ms, gap 50 ms, 0.6, 80 ms | The double buzz: never shaped like the parry thump |
| **Hurt**, `lethal` | large 1.0 -> 0 over 500 ms; small 0.6, 120 ms | 1.0, 120 ms, then 0.7 -> 0 over 350 ms | Replaces anything playing; the run-over gate then stops play cues |

Rules for all of them:

- **Your hands, your events.** Kills, parries and hurts are the view player's own. A teammate's kill, parry or hit
  never buzzes you. The boss's phase break and death reach everyone (the arena is sealed, everyone is in the fight).
- **No low-health haptic.** The 1 Hz low-health edge pulse (FEEL J11) stays visual only: a repeating buzz is the
  constant buzz this plan rules out.
- **Spectating is silent** (you are not holding anything that hit).
- **Quiet** under the stage cover, after run over, while paused, while any menu owns the pad (pause, Options, the
  party overlay), and during a boon draft. Opening a menu drops pending play pulses and sets the motors to 0.
- **Priority per motor:** lethal hurt > boss death > stagger > hurt (`heart`, then `armor`) > parry > kill. A weaker cue never cuts a stronger one short (dropped, not
  queued); a stronger one replaces a weaker one at once (`HapticGenerations`, with a priority added).
- **Real time.** Pulses run on the real clock, never the hitstop clock, so a freeze never stretches a buzz. Each cue
  starts on the same frame as its freeze, which is what makes it read as an impact.
- **Duty cap.** In any 1 s window the motors (or the phone actuator) are on at most 40 % of the time; kill ticks are
  dropped first. Hurt, parry, stagger and death always play.
- **Settings.** Pad: the existing `padVibration` (now "menus and play"). Phone: new `touchVibration` (default On,
  Options > Controls > Touch). Reduced motion does not change haptics (they are not motion, HPD8).
- Solo and co-op behave the same (haptics are local; no freeze-like co-op exception is needed).

## Design

### 1. Pure core (shared/view/fx)

- `hapticsConfig.ts`: `PLAY_HAPTICS` (cue -> per-device pulses: motor, strength, seconds, start offset; the table
  above), `PLAY_HAPTICS_RULES` (kill gap 0.07 s, kill cap 6/s, duty 0.4 per 1 s, strength floor 0.15, priorities).
  `MENU_HAPTICS` stays where it is; both tables share the pulse type.
- `playHaptics.ts`: `PlayHapticsDirector.frame(input, clockSec) -> HapticCue[]` (0-3 cues), where `input` is
  `{ viewKills, viewHeavyKill, parry?: { count }, hurt?: HurtKind, bossPhaseBreak, bossDeath, quiet, spectating,
device }`. Owns the
  merge, the gap, the per-second cap, the duty window and the priority choice. No Roblox API; allocation-free per
  frame like `NearMissDirector`.
- `hapticTimeline` (padFeedback.ts) moves to a shared `haptics.ts` so play and menu cues build timelines the same
  way; `HapticGenerations` gains a priority per pad + motor (an older stronger cue's remaining events block a weaker
  one until they end).
- `touchWaveform(pulses) -> { t: ms, v: 0..1 }[]`: a cue's pulses as `FloatCurveKey`-ready points (Constant
  interpolation at edges, Linear for the decays), for the phone backend.
- Specs: merge (6 kills in a frame = 1 tick), gap, cap, duty (a 30 s fight with a kill every 0.05 s stays under 40 %),
  priority (a kill during a stagger drops; a stagger during a kill replaces; a lethal hurt replaces a boss death),
  hurt (each kind; never dropped by the cap or duty; a kind upgrade inside 0.75 s replaces the weaker buzz, as
  `HurtFlash` upgrades; a teammate's hurt and spectating silent), the parry and heart-hurt shapes differ, quiet gates,
  the 0.15 floor, `touchWaveform` shape.

### 2. One haptics controller, two backends (client)

`PadHapticsController` becomes `HapticsController` (client/controllers/fx), the only code that touches the engine:

- **Motor backend** (today's code): pads through `HapticService:SetMotor`, `IsVibrationSupported` /
  `IsMotorSupported`, pcall. Menu cues keep going to the navigation pad; play cues go to the pad that drives the view
  player (`InputController`'s active pad; the first connected one as fallback).
- **Effect backend** (new): phones (device = touch) through `HapticEffect`, `Type = Custom`. One preallocated
  `HapticEffect` per play cue kind, waveform set once with
  `SetWaveformKeys` at start, then `Play()`. A newer cue calls `Stop()` on a weaker one first. The effects are kill,
  kill heavy, parry, parry big, stagger, death, hurt armor, hurt heart and hurt lethal (nine). Never `Looped`; no
  `Position` / `Radius` (non-spatial; HP0 checks where it must be parented for that). Everything behind pcall; a
  failed create disables the backend for the session and logs once under `KV_HapticDebug`.
- If HP0 shows `HapticEffect` is equal or better on pads too, pads may switch backend later (one flag); not in this
  plan's critical path (HPD2).
- Inputs: `NearMissController.onFrame` (parry cues, local only), the actor tracker's `killed` events filtered to the
  view player (source chosen in HP0, see below), the boss phase / death edges the freeze and nudge already use, and
  the view player's `hurtKind` edge from the controller's own `StateWatch` instance (as the feel controllers do; no
  `getViewPlayerIndex` change: while spectating the director is silent anyway).
  The controller builds `input` once a frame and runs the director, after FxTracker's dispatch so it sees the same
  frame as the freeze.
- Kill attribution: solo every kill is the player's. Co-op needs the killer: HP0 picks the feed (the tracker `killed`
  event if it carries the hitter; else the per-player score pops / combo feed, which already credit the hitter in
  scored runs; unscored co-op M1 then gets no kill tick, acceptable). No new sim field (HPD1).

### 3. Setting and strings

- `DisplaySettings.touchVibration` (default On, only Off stored, settings doc stays v2), on Options > Controls >
  Touch, string `options.controls.vibration` reused (same words). Kept by the Display reset, as `padVibration`
  (`DISPLAY_RESET_KEEPS`).
- The Gamepad row's meaning widens to menus and play; the label is unchanged. No separate "in-run haptics" toggle
  (HPD6).

### 4. Debug

`KV_HapticDebug` (Workspace attribute, off by default): prints every cue played or dropped (reason: gap, cap, duty,
priority, quiet) with its backend; an integer value `n` fires test cue `n` on the current device (1 kill, 2 parry, 3 stagger, 4 death, 5 hurt armor, 6 hurt heart, 7 hurt lethal), drawn nowhere.

### Not changed

How anything scores or freezes, the menu haptics and their table, `padVibration`'s storage, the sim, any hash,
fixture or replay, the hurt flash and freeze. No haptic on hits landed, grazes, rolls, pickups, tier-ups, room clears
or low health (HPD3).

## As built (2026-11-13)

Built by parallel agents on worktree branches merged into `haptics` (HP1 pure core, HP5 setting, then HP4's input
builder and HP2-HP4 / HP6's controller), then a review pass. No Studio or device run: every engine call is behind
pcall, and the facts the code assumes are listed under "HP0 must confirm" below. Presentation only, as planned: nothing
under shared/sim, shared/dungeon, shared/lockstep or fixtures changed; no hash, replay, score or wire change. Changes
from the plan are marked **Change**.

| Task | As built |
|---|---|
| HP1 | shared/view/fx `haptics.ts`: the pulse types (`HapticShape` with `atSec` and an optional linear ramp `toStrength`, `HapticPulse` = a shape on a `HapticMotor`, `TouchPulse` = a motor-free shape), `hapticTimeline(pulses, rampStepSec)` (moved from padFeedback.ts; a ramp is stepped every `rampStepSec`, ties offs first; pulses without a ramp give exactly the menu's old timeline) and `HapticGenerations` with an optional priority (`begin(pad, motor, priority, nowSec, untilSec)` returns undefined while a higher-priority cue there still runs; the priority-free `begin` of menu cues always takes over and releases the hold). `hapticsConfig.ts`: `PLAY_HAPTICS` (the "Player experience" table exactly, per cue `pad` / `touch` pulses; `parryBig` keeps the parry's small-motor edge 0.3 / 50 ms), `PLAY_HAPTIC_KINDS` (nine), `PLAY_HAPTICS_PRIORITY` (kill / killHeavy 0, parry / parryBig 1, hurtArmor 2, hurtHeart 3, stagger 4, bossDeath 5, hurtLethal 6), `PLAY_HAPTICS_RULES` (kill gap 0.07 s, cap 6 in a rolling 1 s, duty 0.4 per 1 s, floor 0.15, `rampStepSec` 0.05, `hurtUpgradeWindowSec` = `FEEL_HURT.minIntervalSec` 0.75, `parryBigFrom` = `NEAR_MISS_VIEW.parry.bigFrom`), `playCueSeconds`, `HAPTIC_DEBUG`. `playHaptics.ts`: `PlayHapticsDirector.frame(input, nowSec)` -> one reused `{ cue, stopAll, drops }` (**Change:** at most ONE cue a frame, the strongest candidate, not "0-3 cues"; pooled drop records, allocation-free), `hurtHapticOf`, `touchWaveform` (integer ms, step edges Constant, ramps Linear, ending at 0). **Change:** `MENU_HAPTICS` keeps its `delaySec` (`MenuHapticPulse`; `menuHapticPulse` maps it to `atSec`, `MenuHapticMotor` = `HapticMotor`); shared/view/menu `padFeedback.ts` re-exports `HapticGenerations` / `HapticEvent` and keeps `hapticTimeline(cue)` as an overload, so the menu specs are unchanged. Specs `haptics.spec.ts`, `playHaptics.spec.ts` |
| HP2 | `HapticsController` (client/controllers/fx; `PadHapticsController` and its ui barrel export are gone, FocusController injects the new one). Motor backend: menu cues (`play(cue)`) as before on the navigation pad; play cues on `InputController.getActivePad()` (**new**: Gamepad1 when connected, else the first connected pad), else the navigation pad, else the first connected; per pad + motor priority holds until that motor's last event; one `task.delay` closure per event of a played cue (cues are rare), skipped when stale (generation) or after cleanup (`stopped`). `stopPlay` (the director's `stopAll`, a new run, a run exit, the tracker's `reset`) zeroes only the motors a play cue still holds (a menu cue that took a motor over keeps it) and stops the phone effect; `stopPads` (cleanup, Gamepad vibration Off, the device leaving the gamepad) zeroes every motor set and drops every pending event, menu and play |
| HP3 | **Change:** the nine `HapticEffect`s are created lazily, on the first play cue (or test cue) on touch, not preallocated at start: a Folder `KV_Haptics` under **Workspace**, one effect per `PlayHaptic` named by kind, `Type = Custom`, `Looped = false`, no `Position` / `Radius`, `SetWaveformKeys` once from `touchWaveform` (`FloatCurveKey(tMs, value, Enum.KeyInterpolationMode)`: time in ms, an HP0 fact). A newer cue `Stop()`s the running one first (a weaker one while a stronger runs is `held`); `Stop()` only while the running cue has time left. Any failed create or call disables the backend for the session, destroys the effects and warns once under `KV_HapticDebug` |
| HP4 | shared/view/fx `playHapticsInput.ts`: `PlayHapticsFacts` (filled once a frame by the controller, one reused object) -> `PlayHapticsInputBuilder.build` -> the director's input (allocation-free). Device: `hapticDeviceOf` = `menuHapticsOn` (gamepad + `padVibration`) -> `pad`, `touchHapticsOn` (touch + `touchVibration`) -> `touch`, else none. Quiet (`playHapticsQuiet`): no run, `selectMenuShown`, paused, the local player's draft open, the stage cover up or a held run start, run over (`isRunOver()` or the frozen finished tutorial). Spectating: view index != local index. The kill feed per mode (row 4, answered in code): **scored runs** (solo and co-op) count the view player's credited kills this frame as the deltas of the run view's `RecapTally.kills` (`ScoreEvents.popPlayer`, docs/RUN_CONTRIBUTION.md), so kills over a multi-tick frame merge and count once; **unscored solo** (M1 without `KV_Scoring`) counts every non-boss tracker `killed` of the frame; **unscored co-op M1 gets no kill tick** (no feed names the killer; HPD1: no sim field). Heavy: a tracker kill of the frame that froze as heavy / elite (`freezeMsFor` = `HEAVY_KILL_FREEZE_MS`); **Change:** in co-op only while every credited kill of the frame is the view player's (the tracker does not name killers). Parry: `NearMissController.onFrame`'s `local` parry cue (`localParryCount`: the new flash's count, or `bigFrom` by the cue's pitch when there is no flash). Hurt: the controller's own `StateWatch` on the view index through `hurtKindLanded` (a forfeit's death is not a lethal hit). Boss: a tracker `bossPhase` the freeze rules freeze for (phase >= 2) and `bossDefeated`. **Change:** the play frame is `FX_FRAME_PHASE.haptics` (1), a new phase after `normal`, so the frame's parry cue, freeze and hurt edge are in. Spec `playHapticsInput.spec.ts` |
| HP5 | `DisplaySettings.touchVibration` (`DEFAULT_TOUCH_VIBRATION` true, only Off stored, settings doc v2; in `DISPLAY_RESET_KEEPS` with `padVibration` and `character`); shared/settings `vibration.ts` `touchHapticsOn` (imported by file from shared/view: the settings barrel reaches shared/play, whose run views import the fx barrel, a require cycle). **Change:** a **Touch sub-tab** on Options > Controls (`OptionsControlsDevice` = `BindingDevice` or `touch`; shown only on a `TouchEnabled` device: `optionsDevices(touch)` / `shownControlsDevice` / `controlsBindingDevice`) with the one Vibration row (`options.controls.vibration` reused) and **one new string `options.device.touch`** ("Touch", context in `l10n/context.json`; the plan said no new string); no bindings, test strip (RebindController) or device reset there. Review fixes: no pad X Reset and no X hint there (a new `PadCondition` `canReset` on the options surface), no right-stick scroll hint, and Options opens Controls on Touch when the last-used device is touch (`openingControlsDevice`, SettingsController). Specs `settings.spec.ts`, `hud.spec.ts`, `padActions.spec.ts` |
| HP6 | `KV_HapticDebug` (Workspace attribute, `HAPTIC_DEBUG`, `hapticDebugOf`): any value but absent / `false` / `0` / `""` prints `[Haptics] play <kind> on <device> (<backend>)` (backend `motor` / `effect`, or `no pad` / `no motor` / `held` / `effect off` / `no device`), `drop <kind> (<reason>)` (`gap` / `cap` / `duty` / `priority` / `quiet`), `stopAll`, and the phone backend's failure once; an integer 1-7 fires that test cue once per change on the current device, even outside a run (1 kill, 2 parry, 3 stagger, 4 boss death, 5 hurt armor, 6 hurt heart, 7 hurt lethal; the device and its setting still apply; test cues bypass the director). **Change:** no `KV_HapticSpike` controller: docs/SPIKES.md "Spike HP0" runs the rows on the real cues through these test cues |
| HP7 | This section; CLIENT.md (Juice "Haptics", the Options Controls row, the controller map, Workspace attributes); GAMEPAD_MENUS.md (GMD14 pointer, `PadHapticsController` -> `HapticsController`); the CLAUDE.md docs row and decision-log entry |

Rules as built (director, per device):

- **One cue a frame**: the strongest candidate; the others drop `priority`. A cue weaker than a played cue still running
  drops `priority`; an equal or stronger one replaces it (the replaced cue's on-time ends there). A hurt within 0.75 s
  of the last played hurt plays only as a stronger kind (the HurtFlash upgrade).
- **Kills only** drop for the rules: `gap` (0.07 s since the last played tick's start), `cap` (6 tick starts in the
  rolling 1 s), `duty`: the device's played on-time (cue lengths, gaps inside a cue included, cut at a replacement) in
  the 1 s window that ends with the candidate tick's end, plus the tick, must stay <= 0.4 s. Hurt, parry, stagger and
  death never drop for these. So a kill right after a long cue can drop for `duty` (after a 0.6 s boss death or a
  0.5 s lethal on the pad, ticks drop for up to about a second; after a stagger's 0.38 s, a few ticks), as HPD10 means.
- **Gates**: the first quiet / spectating / no-device frame after an open one sets `stopAll` once; a device change
  (pad <-> touch) stops the old one once and forgets the kill / hurt / duty history. The client also stops the pads on
  Gamepad vibration Off or leaving the gamepad, and the phone on Touch vibration Off or leaving touch.
- **Change (review): the run's end.** `PlayHapticsInput.ending` (`playHapticsEnding`: quiet only because the run is
  over; the run-over panel's own menu ignored): on the edge frame (open on the same device the frame before) that
  frame's lethal hit or boss death still plays, with no `stopAll`, and rings out; later run-over frames are quiet
  without a stopAll, and the run's exit or restart stops the motors. Without it the solo death's lethal hit and an M1
  victory's boss death were dropped as `quiet` on their own frame (`isRunOver` turns true on that tick). A co-op death
  while teammates live is unaffected (the view holds 1.5 s on the corpse before spectating).

Known gaps, left as built: unscored co-op M1 has no kill tick; in co-op a heavy kill only ticks heavy when every kill
of the frame is the view player's; a play cue on a motor where a menu cue is running takes it over (menu cues hold no
priority; menus are quiet for play cues, so at most a confirm right before a draft closes is cut short); the first
frame of a new run view takes its tally as the baseline (a kill on that frame is not ticked).

**HP0 must confirm** (docs/SPIKES.md "Spike HP0", rows 1a-1f, 2a / 2b, 3, 5; row 4 is answered in code above):
`HapticEffect` Custom plays on iPhone and Android phones parented under a Workspace Folder with no `Position` /
`Radius` (row 1e; else move `KV_Haptics`); `SetWaveformKeys`' key time is milliseconds (values 0..1) and
`Enum.KeyInterpolationMode` Constant / Linear give steps and ramps; `Stop()` then `Play()` on one effect replays it at
once; the latency from `Play()`; the shortest felt pulse (the 25 ms kill tick at 0.35); the iPhone voice-chat issue; a
pad on a phone stays silent with no error (`no motor` expected); the pad motors' feel at `PLAY_HAPTICS`' strengths
against `HapticEffect` on pads (HPD2); the heart hurt's 50 ms gap keeps two buzzes. Then HP8 tunes `PLAY_HAPTICS` on
the hardware.

## Tasks

- [ ] **HP0. Spike.** Extend `KV_PadSpike` (or a new `KV_HapticSpike`, docs/SPIKES.md, off by
  default) and record: `HapticEffect` Custom on an iPhone and an Android phone (shortest pulse that is felt, whether
  25 ms reads as a tick, latency from `Play()`, parenting needed for a non-spatial effect, the iPhone voice-chat
  issue in a VC place); `HapticEffect` vs `SetMotor` on Xbox and PlayStation pads (feel of small / large at the table's
  strengths); a pad on a phone (expected: nothing); which feed names the killer in co-op; whether a 50 ms gap keeps the heart hurt's double buzz distinct on each device.
  → Verify: SPIKES.md table filled; every "HP0 picks" branch decided here.
- [x] **HP1. Pure core.** `hapticsConfig.ts`, `playHaptics.ts`, shared `haptics.ts` (moved `hapticTimeline`,
  priority in `HapticGenerations`), `touchWaveform`; specs as in Design 1. → Verify: `npm run test:only -- view/fx`
  and `view/menu` (the menu haptics specs unchanged).
- [x] **HP2. HapticsController.** Rename / fold `PadHapticsController`, the motor backend for play cues on the active
  pad, the quiet / menu hand-over (menu opens: play pulses dropped, motors 0). → Verify: `npm run verify`; Studio with
  a pad: menu haptics as before.
- [x] **HP3. Effect backend (phones).** Preallocated `HapticEffect`s, `SetWaveformKeys` once, Stop / Play by priority,
  failure disables. → Verify: on a real iPhone and Android phone (Studio cannot vibrate a phone), the seven test cues
  through `KV_HapticDebug`.
- [x] **HP4. Wire the moments.** Kills (HP0's feed, view player only), parries (`NearMissController.onFrame`), boss
  phase break and death (the freeze / nudge edges), hurt (`StateWatch.hurtKind` of the view player). → Verify: specs for the input builder; Studio check below.
- [x] **HP5. Setting.** `touchVibration` in the Display schema, sanitize / overrides / reset keeps, the Touch row.
  → Verify: settings spec (round trip, old docs, reset keeps it); `npm run verify` (`l10n:check`).
- [x] **HP6. Debug.** `KV_HapticDebug` prints and test cues. → Verify: in Studio, each drop reason prints once.
- [x] **HP7. Docs.** CLIENT.md (an FX "Haptics" block and the Controls tables), GAMEPAD_MENUS.md GMD14 points here,
  CLAUDE.md decision-log line, this doc's "As built".
- [ ] **HP8. Device check + tune.** The Studio / device check below; tune `PLAY_HAPTICS` on the real hardware.

Critical path: HP0 -> HP1 -> HP2 -> HP4 (pads ship first) -> HP3 (phones) -> HP8. HP5 / HP6 any time after HP1.

## Studio / device check

1. Pad, endless floor 1: each kill ticks; a ring clearing a pack gives one tick, not a rattle; a heavy finisher kill
   ticks harder.
2. Pad: guard one bullet = one thump; guard into a ring = one bigger thump, never a thump plus ticks.
3. Boss floor (Mother Bramble and the Demon Lord): each phase break thuds on the freeze frame; the death rumbles
   through the slow-mo and stops cleanly; kills of summons during the rumble do not cut it.
4. A 60 s fight with a fast weapon: the pad never feels like it is buzzing all the time (duty cap).
5. Pause mid-rumble: the motors stop at once; menu haptics work; resume: nothing replays.
6. Co-op (2 clients): a teammate's kills, parries and hits are silent on your pad; the phase break reaches both; spectating
   is silent.
7. Settings: Vibration Off on Controls > Gamepad silences menus and play; Touch Off silences the phone; reduced
   motion changes nothing.
8. Phone (iPhone and Android, published place): kill tick, parry, stagger, death and the three hurts all felt and
   distinct; a VC-enabled
   place on iPhone (the known issue); frame time unchanged.
9. A pad connected to a phone and a pad on macOS 15+: silent, no errors.
10. Hurt, solo: an armor hit, a heart hit and the lethal hit each buzz on the frame the hurt flash starts; with eyes closed, a
    heart hit and a parry are never confused; taking a hit mid kill-streak always buzzes; the last half heart's edge
    pulse never vibrates; the tutorial's harmless hits give the light buzz.

## Decisions (owner answers 2026-11-13; the rest as recommended)

- **HPD1. Presentation only.** No sim field for kill attribution; HP0 finds an existing feed.
- **HPD2. Two backends.** `SetMotor` stays for pads (it works and is built); `HapticEffect` for phones. Moving pads
  to `HapticEffect` is a later one-flag switch if HP0 shows it is better.
- **HPD3. Five moments:** kill, parry, phase break, boss death, hurt. No haptic on hits landed, grazes, rolls,
  tier-ups, room clears or low health: they are too frequent or already loud, and the console guidelines warn against
  overuse.
- **HPD4 (owner, 2026-11-13). "Boss stagger" = the phase break** (66 % / 33 %). No stagger mechanic: a poise bar
  would be a sim and balance change for its own plan.
- **HPD5 (owner, 2026-11-13). Boss death gets a rumble** riding the slow-mo.
- **HPD6 (owner, 2026-11-13). One toggle per device, no strength slider.** `padVibration` covers menus and play; a
  separate `touchVibration` for phones. A slider (or an in-run-only toggle) only if players ask.
- **HPD7. View player only, spectating silent.** Kills, parries and hurts are yours; the boss's phase break and death
  reach everyone.
- **HPD8. Not tied to reduced motion, Freeze frame or Screen shake.** Haptics have their own toggles.
- **HPD9 (owner, 2026-11-13). Getting hurt vibrates**, per `hurtKind`: a light buzz for armor / harmless, a rough
  double buzz for a heart, a long decaying rumble for the lethal hit. Shaped unlike the parry, never dropped by the
  caps; the lethal hit has the top priority of every cue. It follows the view player like the hurt flash,
  but a spectator feels nothing (HPD7), unlike the half-strength spectate flash.
- **HPD10. Duty cap 40 % per second**, kill ticks dropped first; hurt, parry, stagger and death always play.
- **HPD11. Pads on phones and on macOS 15+ stay silent** (engine limit); no fallback to the phone's actuator, which
  may be on a stand.
- **HPD12. Phone menus stay without haptics.** Menu haptics on touch (button `ClickHaptic`) would be its own small
  follow-up.

## Owner answers (2026-11-13)

1. Boss stagger: the phase break -> HPD4.
2. Boss death rumble: in, as recommended -> HPD5. Hurt: vibrates -> HPD9 (reversed from the draft).
3. Phones: a separate Touch toggle -> HPD6.

## Sources

- HapticEffect (platforms, `Type`, `SetWaveformKeys`, `Play` / `Stop`, the 0.1 strength note):
  https://create.roblox.com/docs/reference/engine/classes/HapticEffect
- HapticService (superseded by HapticEffect; `SetMotor`):
  https://create.roblox.com/docs/reference/engine/classes/HapticService
- Full release of haptic effects (2025-09-16; unsupported: controllers on mobile and macOS 15+; iPhone voice-chat
  issue): https://devforum.roblox.com/t/full-release-you-can-now-publish-haptic-effects-in-your-experience/3660577
- Roblox console guidelines (haptics sparingly):
  https://create.roblox.com/docs/production/publishing/console-guidelines
