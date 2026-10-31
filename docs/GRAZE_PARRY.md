# Grazes and parries (plan)

Status (2026-10-30): **GP1-GP7 and GP9 built** (branch `graze-parry`, fast-forwarded into `main` on 2026-10-30),
headless checks in "As built" below. The owner accepted every recommendation (GPD1-GPD10) as written. **GP0 / GP10
audio done 2026-10-30:** the first candidates kept (graze `Magic & Skill/Magic5.wav` 0.648 s, parry `Bonus/Bonus.wav`
1.461 s), locked, built and uploaded, ids in `packs/vale/assetIds.ts`, so the vale pack plays both. **GP8 (optional)
not done; the Studio check pending (owner).**

Goal: make the two skill moves the game already scores feel good the moment they happen. A **graze** (an enemy bullet
skims past inside the graze ring and leaves without touching you) gets a small white spark where it skimmed and a
quick shimmer tick that **climbs in pitch** while you keep grazing. A **guard cancel** (the sword's guard erases a
bullet) becomes a **parry**: a gold spark burst at each erased bullet, a bright ring-out sound, a short **PARRY!**
flash at the player's feet and, solo, a 30 ms freeze. Near misses should feel like a reward, not like luck.

**Sim impact:** one unhashed feed (GP1): `ScoreEvents` (already per tick and NOT hashed, like the kill score pops'
`popX` / `popZ`) gains the position and player of every graze and every guard-erased bullet. No hash, replay,
fixture, rng, score or lockstep change; every golden run, `score.replay.spec` and every hashed group stay bit for bit.
Everything else is presentation. Theme additions: two colour roles, two strings, two port audio IDs. No new setting.

## What already exists (and is reused)

| Piece | Today | Where |
|---|---|---|
| Graze | An enemy bullet that came within `GRAZE_MARGIN` (0.5 tile; Daredevil 0.75) of the hit distance and LEFT the ring without entering the hit circle: +5 (`GRAZE_POINTS`), combo +0.1, once per bullet (payload bits `GRAZE_NEAR_BIT` / `GRAZE_DONE_BIT`). Never for a dead player; co-op: the nearest living player grazes. Scored runs only (`state.score`) | shared/sim/score/score.ts `scoreBulletVisit`, combat.ts `enemyBulletHit` / `enemyBulletHitParty` |
| Graze feedback | `ScoreEvents.grazes` (a count). The combo meter pops on a feed and the kill ladder's pitch climbs silently. The tutorial's `tutorial.callout.graze` once. **No spark, no sound, nothing at the player** | shared/view/hud/combo.ts, tutorial |
| Guard | Alt press, off cooldown: 18 ticks (0.3 s) of `sweepArc` with `deleteEnemyBullets`, reach 1.9, ~203 degrees, cooldown 60 ticks. Mirror Cloak reflects each erased bullet | shared/sim/combat/weapons/defs/sword.ts, melee.ts `sweepArc` / `bulletInArc` |
| Guard cancel | +10 per erased bullet (`GUARD_CANCEL_POINTS`, `scoreGuardCancels(state, n)`), `ScoreEvents.guardCancels` (a count, no positions, no player) | score.ts |
| Guard feedback | `sfx.player.deflect` (Impact.wav, 0.6, 0.08 s min interval; also plays for swing deletes) and the `fx.guard.shield` re-flash (every `guardMinSec` 0.15 s). Co-op attribution is a guess (`mayDeflect`): the sim keeps no per-player delete count. **The bullet just vanishes** | shared/view/audio/cues.ts, shared/view/fx/fxCues.ts, watch.ts |
| Per-tick collection | LiveRun / LockstepClient collect `score.events` per tick (pops, `BoostFrameEvents`, `RoomClearEvents`, `ComboEvents`) | shared/play/liveRun.ts `observeTick`, shared/lockstep/client.ts |
| Bullet velocity | `BulletSimulation.velocityAt(i)` | shared/sim/combat/bullets.ts |
| Particles | `ParticlePool` / `RingPool`, `particleBudget(settings)`, level scale off / low / normal / high, reduced motion | shared/view/fx/particles.ts, juiceRules.ts |
| Floor text that never hides a bullet | The combo's floor shout: SurfaceGui under every bullet, <= 55 % opaque, ducks to 0.15 near enemy bullets (docs/COMBO.md CD9) | client ComboController |
| Freeze | Hitstop clock (solo only, rate cap, `freezeFrameOn`); FEEL's heavy hit = 40 ms | shared/view/fx/hitstop.ts, freezeRules.ts |

Facts that shape the design:

1. **Grazes come in bursts.** A ring or a sprayer stream can graze 5-10 bullets inside half a second. One sound per
   graze would be noise; one sound per frame with a climbing pitch is a ladder you want to keep climbing.
2. **A guard erases 0, 1 or many bullets** (a full ring at point blank can be 10+). The reward is per guard, not per
   bullet: one PARRY!, one sound, sparks capped per frame.
3. **Bullets must stay readable.** Sparks are tiny, short-lived and in colours the validator keeps away from every
   enemy-bullet role; the PARRY! text sits on the floor under every bullet (the combo shout's construction).
4. **Reward hierarchy** (smallest and most frequent first): graze < parry < kill < combo tier-up < room clear. Each
   step is louder and rarer than the last, so nothing new drowns what exists.

## Player experience (target)

### Graze (frequent, small)

- **Spark:** 3 tiny sparks (1-2 px) and a 1 px streak at the point where the bullet passed closest to the player (the
  closest point of its path, computed view-side from position and velocity), spraying along the bullet's direction,
  0.18 s, colour `nearMiss.graze` (white-cyan). No hop, no ring: it must never read as a bullet or a pickup.
- **Sound:** `sfx.player.graze`, a short airy shimmer, quiet (about 0.35). One cue per frame at most, 0.05 s minimum
  interval. **Chain ladder:** grazes by the view player less than 0.5 s apart form a chain; each graze in the chain
  plays +1 semitone, capped at +7; the chain resets after the gap. A frame with several grazes plays one cue at the
  chain's final pitch.
- Only the view player's grazes sound (GPD4); a teammate's grazes spark but stay silent.

### Parry (a guard that erased at least one bullet)

- **Sparks:** at each erased bullet, a burst of 6 sparks thrown away from the guarding player plus a 1 px ring, colour
  `nearMiss.parry` (gold-white), 0.25 s. At most 8 bursts per frame; the rest merge into the nearest burst.
- **Sound:** `sfx.player.parry`, a bright metallic ring-out, once per guard (the first erase). It replaces that
  frame's `sfx.player.deflect` (which keeps playing for swing deletes, and is the fallback while the parry ID is
  silent). A guard that erases 3 or more plays it +3 semitones.
- **PARRY! flash:** floor text in `nearMiss.parry` centred 1.2 tiles screen-down from the guarding player (the combo
  shout slides screen-up, so the two never overlap): pops in at 1.4x over 80 ms, holds, fades over the last 150 ms of
  0.45 s. A guard that erases 3 or more reads `PARRY! x5`; the count updates if more land inside the same guard.
  Under every bullet, <= 55 % opaque, ducks near enemy bullets (CD9's rule and numbers, shared code).
- **Freeze (solo):** 30 ms on the guard's first erase, through the hitstop clock (rate cap, `freezeFrameOn`). No
  camera nudge. Co-op: no freeze (lockstep, as FEEL).
- A teammate's parry: sparks, the text at 70 %, the sound at `AUDIO_VIEW.teammateVolume` (GPD6).

### Rules

- Scored runs only (endless, the tutorial, `KV_Scoring` M1): grazes do not exist elsewhere. Unscored M1 keeps today's
  deflect sound and shield flash (GPD2).
- Quiet under the stage cover and after run over (the combo's `comboQuiet` gates).
- Particles off: no sparks; sound and text stay. Reduced motion: no pop-in scale, no freeze, sparks at the reduced
  speed / life; text holds and fades.
- Spectating: the "view player" is the watched teammate (`getViewPlayerIndex`), as everywhere else.
- Touch: the text scales with the HUD's touch floor; nothing else changes.

## Design (summary)

**GP1 sim feed (unhashed).** `ScoreEvents` gains `grazeX` / `grazeZ` / `grazeVX` / `grazeVZ` / `grazePlayer` and
`guardX` / `guardZ` / `guardPlayer` (parallel arrays, cleared in `clearScoreEvents`, deep-copied in
`cloneScoreState`, never hashed: the existing `popX` pattern). `scoreBulletVisit` gets a trailing `grazer` (default
`SOLO_PLAYER`; co-op passes `ti`) and pushes the bullet's `positionAt(i)` / `velocityAt(i)` when it awards.
`sweepArc` gets a trailing optional erase sink (two arrays); `bulletInArc` pushes the erased bullet's position into it
when set. The sword passes the score events' guard arrays (and pushes `ctx.playerIndex` per erase) only while
guarding and only when `state.score` is set. No new rng, no iteration order change, no hashed field.

**GP2 collection.** `NearMissEvents` (shared/view/fx/nearMiss.ts): `reset` per frame, `collect(state)` per tick from
`score.events` (with the tick), like `ComboEvents`. LiveRun and LockstepClient collect it; `RunView.nearMiss`.

**GP4 rules (pure).** `NearMissRules`: the graze chain per player (gap, step, cap -> playback speed), parry grouping
per player (one guard = erases within `guardTicks` of the group's first), the per-frame burst caps and merge, the
quiet gates, the freeze request. Tunables `NEAR_MISS_VIEW` in shared/view/fx/nearMissConfig.ts.

**GP5-GP7 drawing and sound.** Sparks through the particle system (two new kinds sharing the pool and budget). Cues in
`cues.ts` (graze ladder with a per-cue speed like the kill ladder; parry replaces deflect; priorities below the
telegraph and the hurt, above enemy shots). `ParryFlashController` draws the floor text by reusing the combo shout's
SurfaceGui pool and duck rule (factored out of ComboController if needed).

### Not changed

How anything scores (5 / 10 points, combo +0.1), the graze ring, the guard's arc, timing or cooldown, the combo meter,
score pops (no "+5" per graze, GPD9), the tutorial's callouts, any hash group, fixture or replay.

## Tasks

| Task | Work | Done when |
|---|---|---|
| GP0 | Owner: answer GPD1-GPD10; audition graze / parry clips (`npm run audio:audition`; unused Ninja Adventure candidates first, else an owner clip in gitignored `art/vendor/`) | Answers recorded here |
| GP1 | Sim feed: `ScoreEvents` arrays, `scoreBulletVisit` `grazer`, `sweepArc` erase sink, sword wiring, clear / clone. Specs: graze positions / velocity / player match the bullet and the grazer (solo and co-op nearest-living), guard sink positions equal the erased bullets, cloned arrays are copies, Mirror Cloak unchanged | `npm run verify` green with every golden run, `score.replay.spec` and hash spec unchanged |
| GP2 | `NearMissEvents` + LiveRun / LockstepClient collection + `RunView.nearMiss`; multi-tick frames lose nothing | Specs green |
| GP3 | Theme: roles `nearMiss.graze` / `nearMiss.parry` (`NEAR_MISS_ROLES`, >= 40 CIE76 from enemy-bullet roles and `telegraph`, >= 3:1 on every biome floor, `nearMissReport`); strings `fx.parry.text` ("PARRY!") / `fx.parry.count` ("x{n}") in a function-built key list (contract.luau's 200-locals limit); port audio IDs `sfx.player.graze` / `sfx.player.parry` (SILENT in the placeholder) | Validator specs green, contract compiles under Lune |
| GP4 | `NearMissRules` + `NEAR_MISS_VIEW`: chain ladder, parry grouping and count, caps / merge, quiet gates, reduced motion, freeze request | Pure specs green |
| GP5 | Sparks: graze streak and parry burst / ring kinds in the particle system; ParticleController draws them | Specs (counts per level, off, reduced motion, caps); visible in Studio |
| GP6 | Audio: graze ladder cue (view player only), parry cue replacing deflect (fallback while silent), teammate volume, priorities | `audio.spec` cases green |
| GP7 | `ParryFlashController`: floor text from the shared shout pool, duck rule, `x N` count, teammate scale; solo 30 ms freeze | Studio: never hides a bullet, never overlaps the combo shout |
| GP8 | Optional: in scored runs, `fx.guard.shield` re-flash and the deflect use the exact `guardPlayer` instead of the `mayDeflect` guess | Co-op specs green |
| GP9 | Docs: as built here, CLAUDE.md decision log entry | Docs merged |
| GP10 | Owner: `audio:lock` / `audio:build` / upload the two clips (done 2026-10-30); Studio check below (pending) | Checked |

## Studio check

1. Endless floor 1: strafe through a sprayer stream. Sparks at the skim point, a rising shimmer, no sound for a
   bullet that hit. A 0.5 s pause resets the pitch.
2. Guard a single bullet: gold burst where it was, ring-out, PARRY! under you, a tiny solo freeze.
3. Guard into a ring at point blank: one sound (+3 st), `PARRY! xN`, at most 8 bursts, frame rate steady.
4. Swing through bullets (no guard): the old deflect, no PARRY!.
5. Bullets crossing the PARRY! text stay fully readable (the text ducks); a tier-up on the same frame: the two texts
   do not overlap.
6. Settings: particles off (text and sound only), reduced motion (no pop, no freeze), freeze frame off.
7. Co-op (2 clients): teammate's parry text smaller and quieter, their grazes silent on your client; no desync.
8. Tutorial combat D (the guard lock): the first block reads PARRY!.
9. Mobile: Alt-stick guard shows the same flash at the touch HUD scale.

## Decisions (recommendation first; owner to confirm in GP0)

- **GPD1 Feed.** Unhashed `ScoreEvents` arrays (the `popX` precedent), recommended. Alternative: diff bullets in the
  view (vanished inside the guard arc; graze flag edges): no sim touch, but the DONE bit is also set on a hit, so a
  graze cannot be told apart reliably, and erased bullets have no position left to read.
- **GPD2 Scope.** Scored runs only; unscored M1 keeps the deflect and shield as today.
- **GPD3 Graze spark.** At the closest point of the bullet's path, along its velocity, 3 sparks + streak, 0.18 s, no
  hop or ring.
- **GPD4 Graze sound.** View player only; +1 semitone per chained graze, cap +7, gap 0.5 s, 0.05 s min interval,
  volume ~0.35.
- **GPD5 PARRY!** One per guard per player; `x N` from 3 erases; floor text 1.2 tiles screen-down, 0.45 s, CD9 duck rule.
- **GPD6 Teammates.** Their parry: sparks + 70 % text + sound at teammate volume. Their graze: sparks only.
- **GPD7 Freeze.** Solo 30 ms on a guard's first erase; no nudge; none in co-op.
- **GPD8 Setting.** None new: follows Particles, Reduced motion, Freeze frame (Screen shake unused).
- **GPD9 Numbers.** No "+5" / "+10" pops for grazes or parries (the meter and PARRY! carry it).
- **GPD10 Audio.** Two new port IDs rather than reusing `sfx.player.deflect` with pitch: the parry must sound
  different from a swing clearing bullets.

## As built (2026-10-30)

Built by parallel agents on worktree branches merged into `graze-parry` (`gp-sim`, `gp-theme`, `gp-view`, then
`gp-particles`, `gp-audio`, `gp-flash`). Changes from the plan are marked **Change**.

| Task | As built |
|---|---|
| GP1 | `ScoreEvents` `grazeX/Z/VX/VZ/Player`, `guardX/Z/Player` (created, cleared, deep-cloned; never hashed). `scoreBulletVisit(..., grazer = SOLO_PLAYER)` pushes the bullet's position / velocity after this tick's move (the tick it leaves the ring); co-op passes the nearest living player `ti`. `sweepArc(..., eraseSink?: ArcEraseSink)` (melee.ts, 13th parameter) pushes each erased bullet's position before the Mirror reflect; the sword's guard points one module-level sink at the score events only when `state.score` is set and pushes `ctx.playerIndex` per erase. Spec `sim/score/nearMissFeed.spec.ts` (11): positions, co-op attribution, swings / unscored record nothing, Mirror Cloak unchanged, clone, hash independence |
| GP2 | `NearMissEvents` / `NearMissFrameSource` / `NO_NEAR_MISS_EVENTS` (shared/view/fx nearMissEvents.ts; pooled records `GrazeRecord`, `GuardEraseRecord`); `RunView.nearMiss` on LiveRun and LockstepClient (the only two RunViews) |
| GP3 | Port audio IDs `sfx.player.graze` / `sfx.player.parry` (SILENT in the placeholder; vale silent until uploaded; art/audio.json unconfirmed candidates: graze Magic5 (alt Heal3, Bubble) 0.35, parry Bonus (alt Alert, Alert4) 0.7, not in `art/audio.lock.json` yet). Colour roles `nearMiss.graze` `#c8f4ff`, `nearMiss.parry` `#ffe9a8` (`NEAR_MISS_ROLES`, `NEAR_MISS_COLOR_RULES` against `ROOM_EDGE_DIFFERENCE_ROLES`, `nearMissReport` in `validateManifest`; lowest floor contrast 12.4 / 12.2:1, nearest: telegraph at 88.8 / 52.9 CIE76). Strings `fx.parry.text` "PARRY!", `fx.parry.count` "x{n}" (`NEAR_MISS_STRING_KEYS`). contract.luau / validate.luau are at 193 top-level locals (limit 200) |
| GP4 | `NEAR_MISS_VIEW` (nearMissConfig.ts) and the pure `NearMissDirector.frame(source, state, viewIndex, quiet, settings, clockSec)` -> `NearMissFrame` { grazeSparks (closest point of the path), parryBursts (away from the guard, capped 8, extras add `weight`), grazeCue (view player, chain ladder), parryCues (one per guard start; +3 st from 3 first-frame erases), flashes (one per player, 0.45 s, pop / fade, count from 3, teammate 0.7), freezeMs }. A guard group = erases within `SWORD_DATA.guardTicks` of its first. `semitonesToSpeed` reused from hud/comboConfig (imported from the file: the hud barrel imports fx) |
| — | **Change:** `NearMissController` (client/controllers/fx) owns the ONE director, steps it inside FxTrackerController's frame dispatch and calls its own `onFrame` subscribers (particles, flash, audio), so no consumer depends on Flamework start order |
| GP5 | `DeathParticleSystem.graze(...)` / `.parry(...)` (kinds `KIND_GRAZE` 3, `KIND_PARRY` 4) on the death particles' pool, budget, RNG and draw path. Graze: sparks + a rigid 3-dot streak on the floor (no hop, no ring), never recycling other particles (spawns only under `graze.maxFill` of the live limit). Parry: a fan of sparks with a small hop (none under reduced motion) + one 1 px ring (RingPool, outside the budget as before). Spec `view/fx/nearMissParticles.spec.ts` (18) |
| GP6 | `SFX.playerGraze` (priority 53: above enemy sounds and the shot, below the swing, the kill ladder, telegraph, hurt; min interval 0.05 s; exact speed) and `SFX.playerParry` (priority 57; local full, teammate at `AUDIO_VIEW.teammateVolume`; one per frame). A parry replaces the deflect; while the parry ID is silent the mapper ignores parries, so a guard sounds exactly as today. **Change:** the deflect is also muted for later erases of the same guard (one ring-out per guard, not ring-out + clicks); swing deletes keep it. **Change:** AudioController's sound frame now runs as a NearMissController subscriber (ComboController's debug sound may land a frame later). Spec `view/audio/nearMiss.spec.ts` (14) |
| GP7 | `ParryFlashController` + shared/view/hud parryFlash.ts (`parryFlashCentre`, `parryFlashSize`, `parryFlashOpacity`, `parryFlashLabel`, `PARRY_FLASH_DRAW`, `PARRY_DEBUG`). The combo shout's floor SurfaceGui construction, layer and opacity cap; centre 1.2 tiles screen-down of the feet (the shout is screen-up; the boxes cannot overlap). One slot per player (MAX_PARTY_SIZE). Extracted for sharing, combo behaviour unchanged: `ShoutDuck` (comboDraw.ts) and `shoutBoxAt(..., sizeScale = 1)`. **Change:** the duck box is the drawn text's box (+ `duckMarginTiles`), not the full shout box; it still reaches ~0.2 tiles above the feet, so bullets at the guard will often duck the flash right after a parry (Studio check 5). Freeze through `sim.hitstop.request(freezeMs, settings)` (the heavy hit's path). Debug `KV_ParryDebug` (Workspace attribute, integer n: one flash of n erases on the view player; drawn only). Spec `view/hud/parryFlash.spec.ts` (14) |
| GP8 | Not done (optional): the deflect and shield re-flash still use the `mayDeflect` guess when there is no parry |
| GP9 | This section; CLAUDE.md decision log |

Not done: the PARRY! text is world-space, so it follows the camera rather than the touch HUD scale floor (Studio /
device check 9).

## Later (not in this plan)

- A "perfect parry" window (the first N ticks of the guard) with a bigger reward: a sim and scoring change.
- Run-over breakdown lines "Grazes 42 / Parries 9" (counts already in `score.counts`).
- A graze-chain counter on screen (`GRAZE x12`) if the sound ladder alone is not enough.
