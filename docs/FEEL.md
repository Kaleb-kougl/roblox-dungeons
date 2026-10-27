# Game feel: the hit pass (plan)

Status (2026-10-26): **J1-J9 and J11 code-complete, verified headlessly only** (typecheck, lint, asset check, art
tests, build, and the full Lune suite: 159 spec files, 2309 tests, all passing except `forge.spec.ts`'s NaN-bit vector,
which fails the same way on `main` under x86_64 Lune and is unrelated). **Nothing has run in Studio**: the Studio check
below and J12 are pending; J10 is optional and not started. Built on branch `game-feel` in four parallel streams (hurt,
hit reaction, motion, latency probe) plus a review pass. Drafted from an audit of `main` @ `423e82a` against the "12 principles of
game feel" reference (juice, input responsiveness, camera shake, squash & stretch, particles, hit stop, weight &
physics, anticipation, screen flash, trails, audio feedback, appeal). Nine of the twelve are already in good shape.
This plan fills the gaps: **feedback when the player is hit, a visible reaction on every hit landed, squash & stretch,
and roll afterimages**. Presentation only: no sim, dungeon, lockstep, hash, replay or fixture change, and no theme
contract change (it reuses colour roles). One optional Juice setting (`screenShake`) is added to the stored overrides.
Decisions JD1-JD9 are **proposed**. Owner answers to the first draft's questions (2026-10-26): a Screen shake row of its
own (JD10), red screen edges (JD11), solo freezes on heavy hits and on getting hurt (JD12), a low-health pulse (JD13).

## Why

What the build has today, principle by principle (evidence in the code):

| Principle | Today | Where |
|---|---|---|
| Juice | Strong: damage numbers, health bars (2-frame flash, chip drain), score pops, hit marks, boost glints | shared/view/fx, client/controllers/fx |
| Input responsiveness | Solo: input sampled per frame, 60 Hz fixed step. Co-op: input lead `INPUT_DELAY_TICKS` 3 (50 ms), raised on misses; no local prediction | shared/play LiveRun, shared/lockstep config.ts |
| Camera shake | **Thin**: one 1-render-pixel nudge on boss phase 2/3 and the boss death; nothing on player hurt or heavy hits | freezeRules.ts `nudgeFor` |
| Squash & stretch | **Missing**: `stretched()` in sprites.ts stretches animation *time* over gameplay timers; no sprite deforms | shared/view/sprites.ts |
| Particles | Strong: per-level budgets (128 / 320 / 512), death bursts, elite sparks, Ninja Adventure sprite FX | juiceRules.ts, ParticleController, FxSpriteController |
| Hit stop | Good, **kills only**: kill 50 ms, heavy / elite kill 80, boss phase 120, boss death 250 + 0.5 s slow-mo, cap 150 ms / s. Nothing on landed hits or on the player being hit. **Never in co-op** (the server paces the sim) | hitstop.ts, freezeRules.ts, lockstep/client.ts |
| Weight & physics | Partial: the slower sword (`SWORD_TEMPO_PERCENT`), flinch animations. No knockback, in the sim or the view | sim, sprites.ts |
| Anticipation | Strong: telegraph markings, wind-ups stretched over telegraphs, `sfx.enemy.telegraph`, finisher wind-up | TelegraphController, sprites.ts |
| Screen flash | **Missing**: no screen feedback on damage; enemies cannot flash white (`SpriteView.setTint`: "a tint, never a white flash", `ImageColor3` only multiplies) | SpriteView.ts |
| Trails & motion blur | Partial: the swing slash trail. No roll afterimage, no bullet trails | FX_SPRITE_VIEW `swingAheadFraction` |
| Audio feedback | Strong: ~40 sound IDs, per-player edges, biome ambience | shared/view/audio |
| Appeal & character | Strong: the knight, Lords of Pain / Demon art, two bosses, the Demon Lord's taunt | docs/ART.md, docs/BOSS_DEMONLORD.md |

The weakest moment is **being hit**. In a bullet hell that has to be impossible to miss. Today the only cues are the
knight's post-hit blink (`playerBlinkVisible`, `HURT_INVULN_TICKS` 45), a heart emptying in the top-left corner (which
the HUD layout plan just made smaller) and `sfx.player.hurt`. The second weakest is **landing a hit**: enemies flinch
where the art has a flinch, the bar flashes for 2 frames, but the body itself does nothing.

## Player experience (target)

- **Getting hit.** The screen edges flash red (`uiHealth`) and fade over ~0.3 s, the camera jolts 2 render pixels, and
  solo play freezes for 40 ms. A hit that only cost armor or the Aegis pip flashes at half strength. The lethal hit
  flashes at full strength and holds into the death. The blink stays as it is.
- **One hit from death.** On the last half heart, with no armor or Aegis pip left, the screen edges pulse a faint red
  about once a second until the player heals or dies. Under reduced motion they hold a steady faint glow instead.
- **Landing a hit.** The enemy's rim flashes white for ~70 ms, its sprite holds its frame for 40 ms and is pushed 1 px
  away from the nearest player, easing back over 100 ms. A sword finisher or heavy arrow (`heavy`) pushes 2 px and, in
  solo, adds a 40 ms freeze and a 1-pixel camera kick. Capped hits (`CAP`) get the flash only.
- **Squash & stretch.** The knight squashes at the start of a roll and when it ends, enemies pop when hit, spawn with
  a small overshoot and squash as they fall dead. Brief (<= 180 ms) and small (<= 15 %).
- **Afterimages.** A roll leaves three fading ghosts of the knight. The Demon Lord's brimstone charge leaves them too.
- **Co-op.** Everything above except the global freezes (the server paces the sim). Hits and kills instead hold the
  hit actor's sprite (the "local freeze"), which works the same on every client.
- **Settings.** Options > Juice gains **Screen shake** (On / Off, default On). Reduced motion turns off shake, freezes,
  pushes, squash and afterimages; the flashes stay (a fade is not motion, as `motionScale` already rules).

## Design

### 1. Tunables (`shared/view/fx/feelConfig.ts`, new)

One `FEEL` object owns every number below (CLAUDE.md: no magic numbers): `hurt` (flash strength per kind, fade
seconds, edge depth, spectate scale, freeze ms, nudge), `hit` (rim flash seconds, min interval, hold ms, push texels,
ease seconds, heavy freeze ms), `squash` (per-kind scale and length), `ghost` (spawn interval, life, start
transparency, pool size). All times are real (effect-clock) seconds except where they ride sim ticks.

### 2. One state watch for audio and feel (J1)

`AudioStateWatch` (shared/view/audio watch.ts) already raises the per-player edges this plan needs (`hurtEdge`,
`rollEdge`, `deathEdge`). Move it to `shared/view/watch.ts` as `StateWatch` (pure move; the audio spec keeps passing),
and add two edges: `hurtKind[i]` (`harmless` when nothing dropped (the tutorial's hits), `armor` when only armor / the
Aegis pip dropped, `heart` when hearts dropped, `lethal` with the death edge) and `rollEndEdge[i]` (`rollTicks` reached 0). The feel controllers own their own instance
(no allocation per frame; the watch is read-only), updated with `SimController.getViewPlayerIndex()` like audio.

### 3. Hurt feedback (J2)

- Pure (`shared/view/fx/hurtFlash.ts`): `hurtFlashLook(ageSec, kind, spectating) -> transparency` (peak
  `FEEL.hurt.peak[kind]`: harmless and armor 0.25, heart 0.45, lethal 0.6 opacity; linear fade over `FEEL.hurt.fadeSec` 0.3 s;
  lethal holds at peak until the death screen). Spec: each kind, fade end, the spectate scale, NaN / negative ages.
- Client (`HurtFlashController`, new): a ScreenGui under the HUD (DisplayOrder below `HUD_VIEW.hudDisplayOrder`) with four edge
  Frames in `uiHealth`, each with a `UIGradient` from the edge to clear at `FEEL.hurt.edgeFraction` (0.18) of the short
  side. No image asset, so no theme asset ID. Written only while a flash runs.
- **Photosensitivity:** a flash only starts on a hurt edge, and `hurtTicks` cannot restart within `HURT_INVULN_TICKS`
  (45 ticks = 0.75 s), so the flash rate per player is at most 1.33 Hz, well under the 3 Hz guideline. Spec pins it.
- Spectating (JD7): the watched teammate's hits flash at `FEEL.hurt.spectateScale` (0.5).

### 3b. Low-health pulse (J11, JD13)

- Pure (`shared/view/fx/lowHealth.ts`): `lowHealthOn(p, aegisUp)` is true while the player is alive, `hearts <=
  FEEL.lowHealth.halfHearts` (1) and neither `armor` nor the Aegis pip would absorb the next hit (one more hit kills).
  `lowHealthLook(ageSec, motion) -> transparency`: a sine between clear and `FEEL.lowHealth.peak` (0.18 opacity) at
  `FEEL.lowHealth.hz` (1 Hz); fades in and out over `FEEL.lowHealth.fadeSec` (0.4 s) when it turns on or off; under
  reduced motion a steady `FEEL.lowHealth.steady` (0.12). Spec: the on rule (armor, Aegis, dead, the tutorial's wounded
  start), the 1 Hz rate (under the 3 Hz guideline), the reduced-motion steady value.
- Client: drawn by `HurtFlashController` on the same four edge Frames. A hurt flash on top wins (the larger opacity of
  the two, never added), so the lethal hit's hold is not dimmed by the pulse.
- The view player's state, like the flash; spectating at `FEEL.hurt.spectateScale`. The tutorial starts wounded at
  `TUTORIAL_START_HALF_HEARTS` (4) and its hits never cost hearts, so it never shows the pulse.

### 4. More shake and freeze (J3)

- `NudgeKind` gains `hurt` (2 texels, alternating left / right for three 40 ms steps) and `heavy` (1 texel down for
  50 ms). Priority: `death` > `hurt` > `phase` > `heavy` (a weaker nudge never cuts a stronger one short, as today's
  death / phase rule). The nudge stays in whole render texels, added after `CameraController`'s texel snap, so the
  pixel grid holds (JD4).
- `freezeMsFor` gains a heavy `hit` (40 ms). A new `applyHurtFreeze(kind, clock, settings)` asks 40 ms on a `heart` /
  `lethal` hurt edge (armor: none). The clock's longest-wins rule and the 150 ms / 1 s cap still apply. Solo only:
  in co-op `simPacerFor` already ignores the clock.
- `screenShakeOn(s)` becomes `s.screenShake && !s.reducedMotion` (J8).
- freezeRules.ts is a ported module: its header gains a "port change" line; its PROVENANCE row stays.

### 5. Hit reaction: flash, hold, push (J4, J5)

- Pure (`shared/view/fx/hitReact.ts`): preallocated arrays per actor pool slot, keyed by (slot, actorId) like
  `barState`. `onHit(e, nearestPlayerX, nearestPlayerZ, now)` from each tracker `hit` event; per frame
  `look(slot, now, motion)` returns `rimFlash` (bool), `hold` (bool) and `pushX / pushY` (whole texels along the
  camera's right / up, from the world direction away from the nearest living player through the iso basis). Rules:
  rim flash at most every `FEEL.hit.minSec` (0.12 s) per actor; capped hits flash only; bosses hold and flash but
  are never pushed; a kill keeps the hold for its freeze length (the co-op "local freeze", and in solo it lines up with
  the global one). Spec: each rule, slot reuse by a new actorId, reduced motion (flash only).
- Sprite enemies (J4): `SpriteView` gains `setRimFlash(color | undefined)` (the rim label shows `uiText` instead of
  `enemyOutline` and is drawn even when the outline would be hidden), `setHold(bool)` (the sprite clock stops for that
  view) and `setPushTexels(x, y)` (added to the billboard's `StudsOffset`). Every enemy and boss set already has a
  baked rim (`outline` in art/atlases.json), so no new art (JD5).
- Placeholder enemies (J5): a second Model `KV_Actors/Flashing` with ONE `Highlight` (`FillColor` `uiText`,
  `FillTransparency` 0.4, rim as `Enemies`). A flashing actor's pieces move there for the flash and back, so the game
  draws 2 Highlights at most (the engine limit is 31). The push offsets the model's BulkMoveTo CFrame.

### 6. Squash & stretch (J6)

- Pure (`shared/view/fx/squash.ts`): `squashAt(kind, ageSec, motion) -> { sx, sy }` for `rollStart` (1.15 x 0.85, 90
  ms), `rollEnd` (1.1 x 0.9, 80 ms), `hit` (1.1 x 0.9, 70 ms), `spawn` (0.6 -> 1.08 -> 1 uniform, 180 ms, ease out
  back), `death` (1.12 x 0.88, 100 ms). `roundToArtPixels(scale, cellPx)` snaps each axis so the drawn cell is a whole
  number of art pixels (JD4). Under reduced motion every curve is 1 x 1.
- `SpriteView.setScale(sx, sy)` resizes the BillboardGui around the set's pivot (the StudsOffset is recomputed so the
  pivot pixel stays on the feet anchor; `sheetSpriteLayout` per-sheet cells included). Written only on change.
- Sources: the watch's roll edges (players), tracker `hit` / `spawned` / `killed` (actors).

### 7. Afterimages (J7)

- Pure (`shared/view/fx/afterimage.ts`): a fixed ring of ghosts per player. While `rollTicks > 0`, every
  `FEEL.ghost.everyTicks` (4) sim ticks it records a ghost (interpolated position, the frame's image / rect, size and
  pivot from a new `SpriteView.snapshot()`); each lives `FEEL.ghost.lifeSec` (0.15 s), transparency 0.5 -> 1. At most 3 per
  player alive. Off under reduced motion or particles `off`.
- Client: a pool of BillboardGui + ImageLabel on anchor Parts in `KV_Actors/Ghosts` (BulkMoveTo, like bullets). The
  Demon Lord's brimstone charge feeds the same ring from its charge state (read as demonlord.ts does).

### 8. Screen shake setting (J8)

`JuiceSettings.screenShake: boolean` (default `true`) joins `JUICE_SETTING_KEYS`; sanitize / overrides / `applyJuicePatch`
take it like `freezeFrame` (old stored docs read as before: absent = default). An Options > Juice row between Freeze
frame and Particles, string `fx.settings.screenShake` in both packs. Settings spec: round trip, old docs, reset.

### 9. Optional: player bullet streaks (J10)

Fast player bullets drawn stretched along their velocity (from `previousPositionAt` -> `positionAt`), length x 1.6.
Never enemy bullets (JD3). Risk: a `Ball` Part cannot be non-uniform, so the placeholder visual may need a
`SpecialMesh` or a capsule; decided after J12's playtest, not before.

### Not changed

- **The sim.** No knockback (JD2): it would change every replay and fixture for a feel effect the view can fake.
- Anticipation, audio and appeal: already strong; no work here.
- Co-op prediction: the 50 ms+ input lead stays. J9 only measures it; prediction would be its own plan.
- The HUD footprint (docs/HUD_LAYOUT.md): the hurt flash is an edge gradient under the HUD, not a panel, so it is
  outside `HUD_FOOTPRINT` and the occlusion fade.

## Tasks

- [x] **J1. Shared state watch.** Move `AudioStateWatch` to `shared/view/watch.ts` (`StateWatch`), add `hurtKind` and
  `rollEndEdge` with spec cases (harmless vs armor vs heart vs lethal, the Aegis pip, a co-op teammate's hit).
  -> Verify: `npm run verify`; the audio spec unchanged and passing.
- [x] **J2. Hurt flash.** `hurtFlash.ts` + spec (incl. the 1.33 Hz ceiling), `HurtFlashController`, `FEEL.hurt`.
  -> Verify: Studio, endless floor 1: each hit kind reads at 1080p and on the phone emulator; the HUD stays above it.
- [x] **J3. Shake and freeze vocabulary.** `hurt` / `heavy` nudges, `applyHurtFreeze`, heavy-hit freeze; freezeRules
  and hitstop spec cases (priority, rate cap with a finisher combo, co-op ignored). -> Verify: solo sword combo into a
  finisher feels heavier without stutter; KV_Debug stats show the cap holding.
- [x] **J4. Hit reaction, sprite enemies.** `hitReact.ts` + spec, `SpriteView` rim flash / hold / push, wired in
  ActorRenderController. -> Verify: skeleton, sniper, bruiser, both bosses; capped boss hits flash only.
- [x] **J5. Hit reaction, placeholder enemies.** The `Flashing` Model + Highlight, push on the model. -> Verify: the
  `placeholder` pack, a room of 10+ enemies under a bow stream: no Highlight flicker, Highlight count 2.
- [x] **J6. Squash & stretch.** `squash.ts` + spec (art-pixel rounding, reduced motion), `SpriteView.setScale`.
  -> Verify: feet stay planted through every curve; no pixel shimmer on the knight at 1080p.
- [x] **J7. Afterimages.** `afterimage.ts` + spec, the Ghosts pool, the Demon Lord's charge. -> Verify: frame time
  flat with 4 co-op players rolling.
- [x] **J8. Screen shake setting.** Juice schema, Options row, strings in both packs, settings spec.
- [x] **J9. Co-op latency probe.** Under `KV_Debug`: the current lead and press -> first stepped tick in ms on the
  debug line. Numbers into this doc; no behaviour change.
- [ ] **J10. (Optional) player bullet streaks.** Only if J12 asks for it.
- [x] **J11. Low-health pulse.** `lowHealth.ts` + spec, drawn by `HurtFlashController` (needs J2). -> Verify: Studio,
  drop to the last half heart: the pulse starts, stops on a flask, never shows with armor or the Aegis pip up; reduced
  motion shows the steady glow; the HUD and bullets near the edges stay readable through it.
- [ ] **J12. Playtest and docs.** Solo M1, endless (incl. both bosses), the tutorial, co-op 2-4 with spectating, reduced
  motion on / off, every particles level. Tune `FEEL`. Docs: docs/CLIENT.md's FX section, a CLAUDE.md decision-log
  line (game feel pass; presentation only; `screenShake` setting), this doc's status. No PROVENANCE rows (no web
  source; freezeRules.ts keeps its row with a port-change note).

As built (differences from the design above):

- Tunables are split by stream instead of one `FEEL` object: `hurtConfig.ts` (`FEEL_HURT`, `FEEL_LOW_HEALTH`),
  `hitReactConfig.ts` (`FEEL_HIT`), `motionFxConfig.ts` (`FEEL_SQUASH`, `FEEL_GHOST`), shared/view
  `latencyProbeConfig.ts` (`LATENCY_PROBE`); `HEAVY_HIT_FREEZE_MS` (40) and the new nudge lengths stay in freezeRules.ts.
- J1: `StateWatch` in `shared/view/watch.ts` (exported from `shared/view`, no longer from the audio barrel). No
  `rollEndEdge`: the motion stream reads roll start / end itself (`RollEdgeWatch`). `lethal` comes from the death edge
  (a lethal hit resets `hurtTicks`); a hit that dropped nothing is `harmless` only in the tutorial's harmless mode,
  else `heart` (Second Wind restored the hearts the same frame). A forfeit (death with no `playerHits`) is `none`.
- J2: the lethal flash holds 1.5 s (`SPECTATE.holdOnDeathSec`) then fades over 0.6 s, so it never sits under the
  run-over panel. `HurtFlash` never restarts within `HURT_INVULN_SECONDS` of the last start (only upgrades the kind),
  which keeps the 1.33 Hz ceiling through multi-tick frames. ScreenGui at `HUD_VIEW.hudDisplayOrder - 1`, disabled
  while clear; real-time clock.
- J3: heavy-hit freezes and kicks are solo only (in co-op the hitter may be a teammate); the hurt jolt plays in every
  mode, the hurt freeze only in solo / the tutorial. **Co-op bug fix (outside the plan):** nothing called
  `hitstop.frame()` in co-op, so the first kill's freeze left `timeScale()` at 0 and particles / sprite effects
  stopped for the rest of the run. FreezeFrameController now drains the clock every co-op frame (every frame, not
  only while active: `frame()` also moves the rate cap's time base). Sim pacing is unchanged.
- J4: the push writes `StudsOffsetWorldSpace` (squash owns `Size` / `StudsOffset`; the anchors never rotate, so the
  result is the same). The hold runs on its own real-time clock (stopped while paused, not slowed by hitstop); a hit
  hold starts only when none runs (a focused target would otherwise never animate); kill holds follow the kill
  freezes (50 / 80 ms, the boss death 250 ms on `bossDefeated`) and are off with Freeze frame off. The killing blow
  flashes the corpse. A pooled view never holds the previous actor's frame (`reset()` clears the hold).
- J5: placeholders flash and push but have no hold (no sprite clock). With `KV_EnemyOutline` off the Flashing
  Highlight's rim goes clear; the fill flash stays.
- J6: sprite views only (placeholder models are not deformed); bosses do not pop on hits (`FEEL_SQUASH.bossHits`); a
  hit restarts the pop at most every 0.12 s; capped hits do not pop; the spawn curve eases 0.6 -> 1.08 by 60 % then
  smoothsteps to 1; the death squash eases in over its first 30 %.
- J7: every party member's roll leaves ghosts; 27 views prebuilt (3 x 8 party trails + 1 boss trail) under
  `KV_Actors/Ghosts`; ghosts sit 0.03 studs behind their source; none recorded while the sprite is blinking.
- J8: only the placeholder manifest defines `fx.settings.*` strings (vale inherits), so `fx.settings.screenShake` is
  there. The server needed no change (it sanitizes through `JUICE_SETTING_KEYS`).
- J9: KV_Debug, co-op only: a second debug line `co-op lead {lead}t {ms}ms · press->step {last}ms avg max n · late miss`
  (`LatencyProbe`, the window of 16 presses). `LockstepClient.nextInputTick()` is the send target's own expression,
  now shared by `pump` (behaviour unchanged). The headless floor is (lead + 1) ticks = 66.7 ms; Studio numbers pending.
  Caveat: `startCoop` uses the KV_Debug value read at the last solo / tutorial start.

Critical path: J1 -> J2 -> J3 (the hurt package, the biggest gap; ship it first) -> J4 / J5 -> J6 / J7 -> J12. J8 can go
with J3, J11 right after J2; J9 any time.

## Studio check

1. Take each hit kind (armor, heart, lethal) in solo: flash strength, 2 px jolt, 40 ms freeze; the blink unchanged.
2. Sword combo into a finisher on a bruiser: rim flash, hold and push on every swing; the finisher adds the kick.
3. Co-op: no global freeze on any client; local holds identical on both screens; spectating flashes at half strength.
4. Roll on a pixel-perfect screen: squash at start and end, three ghosts, no shimmer.
5. Reduced motion on: flashes only, and the low-health glow steady. Screen shake off: no nudges at all, boss ones
   included.
6. Last half heart with no armor: the edge pulse at about 1 Hz, gone after a flask; a hit during it flashes normally.
7. Co-op: particles and sprite effects keep moving after kills (the drain fix); KV_Debug shows the latency line.
8. Risks to check first: Highlight reparent flicker (J5), BillboardGui resize shimmer with Pixelated resampling (J6),
   UIGradient edge banding on 21:9 (J2), the corners where two edge Frames overlap, the hurt ScreenGui never taking
   clicks or gamepad selection, the 7-row Juice tab fitting its panel, ghost z-fighting and the Demon Lord's charge
   ghosts reading as a smear (raise `FEEL_GHOST.everyTicks` for the boss if so), the spawn grow-in on summons.

## Decisions

JD1-JD9 are proposed (not yet confirmed by the owner); JD10-JD13 are the owner's answers.


- **JD1. Presentation only.** No sim, dungeon, lockstep, hash, replay or fixture change.
- **JD2. No knockback in the sim.** The view pushes sprites at most 2 texels and eases them back; the sim position (the
  hitbox) never moves.
- **JD3. Enemy bullets are never stretched or trailed.** What can hurt you is drawn at its true shape.
- **JD4. The pixel grid holds.** Shake and push in whole render texels; squash rounded to whole art pixels, <= 15 %,
  <= 180 ms.
- **JD5. Rim flash first.** Hit flash reuses the baked rims. Baked white silhouette sheets (`<sheet>-flash.png`) only if
  playtests find the rim too weak: they cost one more sheet per atlas (~+28 MB while the Demon Lord is loaded).
- **JD6. No theme contract change.** The hurt flash uses `uiHealth`, the hit flash `uiText` (the health bar's flash
  colour already).
- **JD7. Feedback follows the view player.** Spectators see the watched teammate's hurt flash at half strength.
- **JD8. The tutorial shows the feedback.** Its hits land but never cost hearts or armor (`harmless`), so they flash
  and jolt like an armor hit (half-strength flash, no freeze) and teach what being hit looks like.
- **JD9. Reduced motion keeps the flashes.** Shake, freeze, push, squash and ghosts are off; fades and colour stay.

- **JD10. Screen shake has its own row** (owner, 2026-10-26): Options > Juice > Screen shake (J8), on top of reduced
  motion, which still turns shake off.
- **JD11. The hurt flash is red screen edges** (owner, 2026-10-26), not a full-screen tint: the middle of the screen,
  where the player dodges, stays clear.
- **JD12. Solo freezes on heavy hits and on getting hurt** (owner, 2026-10-26): 40 ms each, inside the existing
  150 ms / 1 s cap (J3). Co-op still never freezes.
- **JD13. Low-health pulse** (owner, 2026-10-26): a faint 1 Hz edge pulse while one more hit kills (J11).
