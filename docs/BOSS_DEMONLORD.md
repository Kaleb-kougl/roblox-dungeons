# Demon Lord boss variant: plan

A second endless boss, **`boss.demonlord`**, drawn with the Lords of Pain **Demonlord** set. On each endless boss floor
(5, 10, 15, ...) a seeded pick puts either Mother Bramble (`boss.act1`) or the Demon Lord in the boss room. Work it task
by task, like `PLAN.md` and `docs/OUTLINE.md`; each task ends with a **Verify**.

Unlike the art, outline and spectate plans, this one **touches the sim and the dungeon**: a new archetype and a new
per-floor pick. M1 (`KALEB_VALE_MVP_PARAMS`), every golden fixture and the tutorial must replay exactly as before;
endless layouts stay put, but endless replays and scores change on every floor where the Demon Lord is picked (log it
in `CLAUDE.md`).

## Status (2026-10-26)

D1-D6 built (art pipeline, theme, sim, dungeon, views / fx / audio / analytics / bots). D7 (upload and Studio) and D8
(docs) are open. Owner decisions are under "Decisions".

## As built (D3-D5)

**D3, the shared skeleton.** `sim/combat/actors/archetypes/boss/shared.ts` holds what act1 had that is not an attack:
`BossFightState` (= act1's `BossState`, same values), `BossFightData` (phases, roars, recover, engage inset, home radius,
debug damage), `BossFightSpec` (the phase-first table and the roar attack id), `BossFightHooks` (`startNext`,
`runAttack`, `recoverAfter`, `stepOwnState`), `stepBossFight` (debug J, wake, seal, TRANSITION / RECOVER / REPOSITION /
TELEGRAPH / ACTIVE, own states), `filterBossDamage`, `onBossHit`, `onBossDeath` (adds wither), `pickBossAttack` /
`noteBossAttack` (never 3 in a row), `summonAdds` / `summonedAlive` (`BossSummonSpec`; optional `arenaMargin`, unused by
act1), `bossArena`, `phaseFloor`, `sealArena`. It is a pure move (extraction, not the fallback): act1 keeps its attacks
and every exported constant (constants.json parity), and run-boss-1337, run-full-1337, `bossAct1*.spec`, validate,
segments, enemies.determinism and the recording specs match bit for bit. Slots the skeleton owns: `cooldown` (forced
next attack), `v[4]` (zeroed on a transition), `v[5]` / `v[6]` (repeat rule).

**D4, `boss.demonlord`** (`archetypes/boss/demonlord.ts`; band `PORT_BAND_BOSSES` = 2, index 8). Mother Bramble's
budget: 540 hp, cap 6/s (hp / cap = 90 s, the flawless floor; the plan's "TTK 120 s" is not hp / cap), phases 66 / 33 %,
contact HIT_HEAVY, radius 1.2, corpse 1.5 s, intro 1 s, transition 1.5 s, recover 1 / 0.9 / 0.8 s, homeRadius 7 (he
hunts). States: the skeleton's plus `CHASE` (= `BOSS_CUSTOM_STATE`, 7). All bullets `BulletKind.BOSS`, HIT_NORMAL.

| Attack (id) | Phases | Telegraph | What fires | Speed / life |
|---|---|---|---|---|
| CLEAVE (1) | 1, 2 | 36 (0.6 s) | CHASE first (4.2 u/s, <= 72 ticks, until <= 3 u) unless already in range; one 7-bullet arc over 2.4 rad on ACTIVE tick 0, spawn radius 0.5; 15-tick hold | 11 u/s, 0.36 s (reach ~4.5 u) |
| HELLFIRE (2) | 1, 2 | 42 (0.7 s) | 3 arcs of 8 over (2 PI / 3 - 1.0) rad, centred 60 / 180 / 300 deg off v[DIR]: gaps of 1.0 rad on v[DIR] (toward the player, turned up to 1 TURN) and +-120 deg; 20-tick hold | 3.4 u/s, 5 s |
| DOUBLE_CLEAVE (3) | 3 | 36 (0.6 s) | CHASE first; arc on tick 0, a 1.2 u lunge along v[DIR] over ticks 1..14, second arc on tick 14 along v[AUX] (v[DIR] turned half a lane, side v[SIGN]) | as CLEAVE |
| CHARGE (4) | 2, 3 (first of 2) | 54 (0.9 s) | charges to v[AUX] (the player's spot, kept in the arena) at 14 u/s, <= 45 ticks, plain mover; impact: 26-bullet shockwave (FULL_RING - 1.0, Bramble's shape), gap pointing back, slamBreakables; 18-tick hold, then 1.2 s recover | 5 u/s, 3.2 s |
| SUMMON (5) | 3 (first of 3) | 48 (0.8 s) | 3 swarmers (cap 3 alive in the arena grown by 2.2 u); at the cap, without swarmers or with a full pool: a HELLFIRE ring along v[DIR]; 30-tick hold | - |
| ROAR (6) | intro, transitions | - | immune; own bullets cleared on transitions | - |

v[] slots: 0/1 DIR (locked heading), 2/3 AUX (charge target point; double cleave's second heading), 4 MARK (charge
impact ACTIVE tick + 1; 0 until the impact tick, the fx cue's key), 5/6 the skeleton's, 7 SIGN (double cleave side;
summon 1 / ring fallback 0). The view tells the intro from a taunt by `phase` (1 = intro). New burst shapes (cleave 7 x
2.4, hellfire 8 x (2 PI / 3 - 1)) are port shapes in `combat/arcTablePort.ts`: `fixtures/arc-table.json` is the web
build's golden V8 table and cannot list a shape the web build never fires, so port shapes take their sin / cos from the
Forge's deterministic `dsin` / `dcos` (identical on every Roblox machine), merged into the lookup (`arcTablePort.spec`).

Time to kill (god mode, the real-weapon bots of `bossAct1.ttk.spec`, seeds 1337 / 42 / 7, `demonlord.ttk.spec`):
bow 60 % 199 / 197 / 201 s (Bramble 203 / 193 / 192), bow 75 % 154 / 154 / 152 (148 / 151 / 148), sword 60 % 136 /
136 / 136 (136 / 136 / 139), sword 75 % 133 / 133 / 133 (136 / 136 / 139). Hits landed per minute, same bots: bow 60 %
8.2 (Bramble 19.9), bow 75 % 11.0 (20.1), sword 60 % 9.5 (11.8), sword 75 % 10.2 (10.8): he is not harder than she is
for these bots; tune in D7 with real players. Score: `KILL_POINTS` 5000 and `BOSS_FINAL_PHASE` 3, as hers.

**D5, the pick.** `shared/dungeon` endlessData.ts `ENDLESS_BOSSES` (boss.act1 1, boss.demonlord 1) and `BOSS_PICK`
(salt `0x27d4eb2f`); endless.ts `bossPickSeed`, `bossKindFor(floorSeed)` (one `EncounterRng` draw),
`EndlessFloorLayout.bossKind` (the tutorial sets Mother Bramble). Split over run seeds 1-1000 x floors 5..50: 50.32 /
49.68 %. Floors before / after the pick: every field of 120 floors (run seeds 1-6 x floors 1-10 x party 1 / 3) hashed
identical with the boss kind masked (one-off check), and `dungeon/endless.spec` rebuilds floors piece by piece against
a Mother Bramble encounter. Seeds: `node scripts/find-boss-seed.js [--floor N --from --to --top]`; floor 5: Mother
Bramble on 3, 4, 5, 6, 7, 10, ...; the Demon Lord on 1, 2, 8, 9, 13, 14, ... and on 1337 (the recorded endless run, so
its floors 5+ replay differently now and still validate on the server path).

## What the code and the art give us (checked against `main` @ `4834215`, with the uncommitted sword retune)

| Fact | Where | Consequence |
|---|---|---|
| One boss exists: `boss.act1` (Mother Bramble), 540 hp, damage cap 6/s (TTK 120 s), phases at 66 % / 33 %, states DORMANT / TRANSITION (roar) / TELEGRAPH / ACTIVE / RECOVER / REPOSITION, attacks FAN, RING, DOUBLE_RING, SPIRAL, SLAM (charge + shockwave + summons), FAST_FAN | `sim/combat/actors/archetypes/boss/act1.ts` (718 lines) | The Demon Lord can reuse the whole fight skeleton (engage, seal, phases, damage floor, transitions, recover, adds wither on death) and only bring its own attacks |
| Kinds are numbered by (band, id). Band 0 is the web table (0..6, pinned by hashed golden runs), band 1 the dummy (7) | `combat/actors/registry.ts` | `boss.demonlord` takes **band 2** (`PORT_BAND_BOSSES`), index 8. No existing index moves |
| Every endless boss floor places `BOSS_ACT1_KIND` | `dungeon/endless.ts` `placeEncounter(d, { boss: bossFloor ? BOSS_ACT1_KIND : undefined })` | The pick goes here. The tutorial and M1 pass their boss explicitly and are not touched |
| Breakables use their own stream: `mulberry32(floorSeed ^ BREAKABLE.salt)` | `dungeon/breakables.ts` | The boss pick copies this pattern with its own salt, so the Forge, the props, the room spawns and the breakables are unchanged |
| Boss-specific code outside the sim keys on `BOSS_ACT1_ID` | `TelegraphController` + `render/bossAct1.ts` (previews), `view/fx/fxCues.ts` (`bossKind`, slam cue), `run/testing/endlessBot.ts` / `partyBot.ts` (`bossOf`) | Each needs a per-boss dispatch, or a `data.boss === true` test where the logic is generic |
| The HUD boss bar and the run-over panel show `<boss id>.name`; telemetry uses the archetype id | `BossBar.tsx`, `RunOverPanel.tsx`, `run/telemetry` | These work for a new id once the theme has `boss.demonlord.name` |
| Sprite actors: `ACTOR_SPRITE_INPUTS` maps an archetype to a sprite input builder (the swarmer only); `chooseActorAnim` picks death > attack > hit > move > idle | `shared/view/sprites.ts` | Bosses need a builder and two more choices: a named attack (`attack.2`) and one-shot specials (intro, taunt) |
| The boss slot's required `sprites` animations are idle, move, attack, hit, death | `theme/contract.ts` `requiredBaseAnimations` | `attack.2`, `intro` and `taunt` become **optional** boss animations (like the class's `attack.1..3`) |
| Sprite sets have no downscale; world-art images do (box filter, premultiplied) | `scripts/art/build-atlases.js` `downscale()` | Reuse it for sprite sets (`"downscale": 2`) |
| `art/vendor.lock.json` does not list the Demonlord files | grep: 0 entries | `npm run art:lock` before `art:build` can read them |

### The art (measured 2026-10-26)

`art/vendor/lords-of-pain/boss/demonlord/`: **896 PNGs, 39 MB**. 7 animations x 16 facings x 8 frames, one
256x256 frame per file, the same naming and facing order as the skeleton (`<anim>/<facing>/<anim>_<facing>_<deg>_<n>.png`,
E = 0, counter-clockwise). Licence: the full Lords of Pain pack's (free and commercial use, may modify, may not
redistribute or resell), already in `THIRD_PARTY_NOTICES.md`.

| Animation | Union box, alpha > 2 | alpha > 8 | alpha > 24 | Body only, alpha > 160 |
|---|---|---|---|---|
| `demonlord_default_idle` | 239x170 | 142x108 | 134x105 | 102x82 |
| `demonlord_default_walk` | 243x179 | 148x110 | 138x108 | 102x90 |
| `demonlord_default_attack1` | 252x181 | 177x136 | 166x133 | 136x126 |
| `demonlord_default_attack2` | 256x207 | 184x137 | 173x132 | 116x108 |
| `demonlord_special_intro` | 255x189 | 186x138 | 168x127 | 116x120 |
| `demonlord_special_laugh` | 230x177 | 149x109 | 139x104 | 82x90 |
| `demonlord_special_death` | 240x187 | 161x119 | 154x116 | 104x94 |
| **all** | **256x207** | 196x146 | **183x143** | 136x138 |

A faint shadow halo reaches the cell edge at alpha > 2 (the skeleton's `noiseAlpha`), so the demon needs a higher cut.
By eye (S frames): a horned red demon with a spiked mace; `attack1` an overhead swing, `attack2` a forward jab, `intro`
the mace raised, `laugh` a taunt, `death` a fall. The body is about 2x the skeleton's.

**Texture budget.** A 1024x1024 RGBA atlas is ~4 MB on the GPU; the slice already uses ~9 (~36 MB).

| Option | Cell (pad 3) | Cells per 1024 atlas | Atlases (+ outline sheets) | GPU |
|---|---|---|---|---|
| Full res, 16 facings, `noiseAlpha` 8 | 202x152 | 30 | 35 + 35 | ~280 MB: ruled out |
| **Half res (`downscale` 2), 16 facings, `noiseAlpha` 24** | 98x78 | 10 x 13 = 130 >= 128 | **7 + 7** | **~56 MB** |
| Half res, 8 facings (two animations per atlas) | 98x78 | 130 >= 2 x 64 | 4 + 4 | ~32 MB |

The recommended row is tight: one more pixel of cell height (79) gives 10 x 12 = 120 cells and breaks it. If the box
filter's whole-block crop adds a pixel, use pad 2 with `outline.widthPx` 1 (pad >= widthPx + 1), or `noiseAlpha` 32.
The atlases load only on a Demon Lord floor (preload on the floor change, like the audio).

## The fight (first draft, tuned in D4)

The Demon Lord is the **hunter** to Mother Bramble's turret: she holds the room's centre and fills it with patterns,
he walks at the player and punishes standing still, with ring attacks at range. Same budget as Bramble so scoring and
Depth stay fair: 540 hp, `damageCapPerSecond` 6 (TTK 120 s), phases at 66 % / 33 %, every telegraph >= 0.5 s
(30 ticks), bullets `BulletKind.BOSS`, bosses scale by Depth only (`endlessActorHp`).

| Attack | Phases | What happens | Animation |
|---|---|---|---|
| CLEAVE | 1, 2 | Walks toward the nearest living player for up to ~1.2 s or until within ~3 units, then a short wide arc: 7 bullets over ~140 deg, fast and short-lived (~4 units of reach) | walk, then `attack` (attack1) stretched over telegraph + active |
| HELLFIRE | 1, 2 | Slow ring with 3 gaps, aimed so a gap faces the player | `attack.2` (attack2) |
| DOUBLE CLEAVE | 3 | Two arcs, the second offset by half a lane, then a step forward | `attack` |
| BRIMSTONE CHARGE | 2, 3 | Locks the player's position, charges (plain mover, as Bramble's slam), shockwave ring with a gap on impact | walk, then `attack.2` at impact |
| SUMMON | 3 | Raises 3 skeletons (`swarmer`, act1's `summon` with its alive cap); fallback when the pool is full: a HELLFIRE ring | `intro` |
| (roar) | engage | The intro: immune, `introTicks` | `intro` |
| (taunt) | 2, 3 | The phase transition: immune, own bullets cleared, `transitionTicks` | `taunt` (laugh) |

New burst shapes (the cleave arcs, the 3-gap ring) need `combat/arcTable.ts` entries from `scripts/gen-arc-table.js`.
RECOVER plays `idle` (the melee opening), REPOSITION and the chase play `move`, death plays `death` stretched over
`corpseTicks`, hits blink (`hit` = idle frame 0, a 1-frame stand-in, like the skeleton).

## Tasks

- [ ] **D0. Confirm the assumptions.** Labelled contact sheet of all 7 animations (S, E, N facings) to confirm the
  animation-to-attack mapping above by eye. Check the facing order against the skeleton's (`facingDirs`). Find how a
  Studio test reaches a chosen boss: a debug seed option if one exists, else a seed finder (D5) or a local-only
  `KV_ForceBoss` (refused by the server, never submitted, like the tutorial world). Read `toPlayer` for how act1 picks
  its target in co-op.
  → Verify: notes added to this file; mapping confirmed or changed.

- [x] **D1. Art pipeline.** `npm run art:lock` (adds the 896 files). `build-atlases.js`: an optional sprite-set
  `downscale` (reuse the world-art box filter, premultiplied; pivots and `pixelsPerTile` divided by k). `art/atlases.json`:
  a `boss.demonlord` set (source `lords-of-pain/boss/demonlord`, 16 facings, `noiseAlpha` 24, `downscale` 2, pad 3,
  `outline.widthPx` 2, pivot measured on idle S frame 0, `bodyTiles` from a first guess of ~3, animations `idle`,
  `move`, `attack`, `attack.2`, `intro`, `taunt`, `death`, `hit` = idle frame 0), one sheet per animation.
  → Verify: `npm run test:art` (new cases: downscale keeps the feet pivot, cells fit 128 per atlas); `art:build` is
  deterministic; 7 sheets + 7 outline sheets, all <= 1024; the contact sheets look right; the knight and skeleton
  outputs are byte-identical.

  As built (2026-10-26): `downscale` is an optional integer on any sprite set (`spriteDownscale`, `scaledRegion` in
  `build-atlases.js`): each kept frame is noise-cut at full resolution, then box-filtered (the world-art `downscale`,
  premultiplied); the union box (measured at full resolution) grows to whole k-blocks and is divided by k; pad, cells and
  the outline (and its `pad >= widthPx + 1` rule) are in atlas pixels; the pivot and body height are measured at full
  resolution and divided by k (x rounded, y = the bottom edge of the downscaled row holding the lowest body row, ceil).
  Absent or 1 is the old code path: every pre-existing output (knight, skeleton, images, world art, fx, ambient,
  layout.ts / fxLayout.ts) is byte-identical (compared file by file against a build before the change).
  `art:lock` added exactly the 896 Demonlord files (no other entry changed). Measured:
  - union box (alpha > 24, all 7 animations x 16 facings x 8 frames) 183x143 at source (59..241, 33..175) -> 92x72 at
    half res, + pad 3 = **98x78 cells**, so the planned pad 3 / `outline.widthPx` 2 fit (no fallback needed); each
    animation is one **980x1014** atlas of 10 x 13 = 130 cells (128 used): **7 atlases + 7 outline sheets**, 14 files,
    ~3.97 MB each uncompressed RGBA -> **~56 MB** of GPU texture while all are loaded (~74 MB if the engine adds mips).
  - pivot (feet) on idle S frame 0: **(39, 56)** in the cell = source (130, 138), near the frame centre (the skeleton's
    feet are at source (125, 138) too). The body cut is the skeleton's (lit pixels, alpha > 64, max RGB > 8: the baked
    shadow is pure black at alpha up to ~224, the robe's hem 9-16); `footBand` 8 full-res rows, because in S the left
    foot stands 6 rows below the right one (a 3-row band would centre the pivot on one foot).
  - body height 63 px at source (31.5 at half res), `bodyTiles` **3** -> **pixelsPerTile 10.5**. bodyTiles reasoning
    (a first guess, D7 tunes it): the swarmer draws 1.25 tiles over a 0.6-wide hitbox (~2x); 2x the demon's 2.4-wide
    hitbox would be 5 tiles and hide the arena; at 3 tiles the robe (~1.7 tiles wide) and the mace's reach (~2.7) sit
    inside the hitbox circle and the demon still stands 2.4x the skeleton's drawn height.
  - animations (sheet name, fps, loop): idle `demonlord-idle` 8 loop; move `demonlord-move` 10 loop; attack
    `demonlord-attack` 12 one-shot; attack.2 `demonlord-attack2` 12 one-shot; intro `demonlord-intro` 8 one-shot;
    taunt `demonlord-taunt` 10 one-shot; death `demonlord-death` 10 one-shot; hit = idle frame 0 held (stride 8, fps 1,
    one-shot). One-shots hold their last frame (`frameIndex`).
  - facing order: the skeleton's `facingDirs` (E = 0, counter-clockwise, 22.5 apart); the build rebuilds every file
    name from d * 22.5 and found all 896, so the folder angles match. Contact sheet `art/build/contact/boss.demonlord.png`
    by eye: S faces the camera (horns and chest), N shows the back, E / W stride right / left (mace leading).
  - by eye, for D0 / D6 (the plan's guesses differ): `attack` (attack1) raises the mace overhead and brings it down in
    front; `attack.2` (attack2) swings it out level, forward; `intro` starts crouched low and rises into the idle
    stance (not "the mace raised"); `death` does NOT fall: the demon darkens from red to near-black while lifting the
    mace and holds that pose (a fade-out after the last frame may read better than holding it).
  - determinism: two clean builds (art/build and art/upload deleted in between) are byte-identical, layout.ts too.
  - `npm run test:art`: 34 tests pass (new: the downscale cases incl. the feet pivot and the premultiplied filter,
    and `chooseGrid` 128 cells of 98x78 fit / 98x79 refuse).

- [x] **D2. Theme.** Contract: optional boss animations `attack.2`, `intro`, `taunt`. Placeholder pack:
  `boss.demonlord` (the boss block; maybe other proportions so it reads as a different boss) and
  `boss.demonlord.name`. Vale pack: `boss.demonlord` -> `sprites` once every required sheet has an id (optional ones
  join when uploaded, outlines never hold it back), same rule as the swarmer.
  → Verify: `contract.spec` / `validate.spec` / `vale.spec` / `requested-ids.spec` cases; every pack validates with zero
  problems; the outline report covers the new set.

  As built (2026-10-26): `contract.ts` gained `SlotContract.optionalAnimations` and `optionalBaseAnimations(slot)`:
  BOSS = `BOSS_OPTIONAL_ANIMATIONS` (`attack.2`, `intro`, `taunt`), CHARACTER = `CLASS_OPTIONAL_ANIMATIONS`
  (`attack.1..3`, documenting what was already allowed). The required five are unchanged. The validator already
  accepted any extra animation name on a `sprites` set (it never rejected unknown names, see the README's "extras
  allowed"), so it is unchanged: the optional ones are validated like any other animation once present, and never
  stand in for a required one (validate.spec). `ENDLESS_BOSS_IDS` = `boss.act1`, `boss.demonlord` (not in
  REQUIRED_ASSET_IDS, like `boss.act1` before; requested-ids.spec checks both assets and names in every bundled pack).
  Placeholder pack: `boss.demonlord` (the boss block, `PLACEHOLDER_PROPORTIONS.demonlord` [0.75, 1, 0.75]: 9 x 12 x 9
  studs, tall and narrow, against Mother Bramble's 12 x 9 x 12; outline `enemyOutline`) and
  `boss.demonlord.name` = "The Demon Lord". Vale pack: no code change was needed (`spriteAsset` already gates on the
  slot's required animations and leaves optional ones out until their sheet has an ID; outline files never gate);
  with no ids it draws the placeholder (vale.spec checks the gating and the hand-computed cells). Both bundled packs
  validate with zero problems.

- [x] **D3. Shared boss module (sim, parity-guarded).** Move act1's fight skeleton into
  `archetypes/boss/shared.ts` as a pure move: `inRoom`, `bossArena`, `phaseFloor`, `engaged`, `sealArena` /
  `sealPlayer`, `playerEngages`, `beginTransition` / `checkPhase` (taking the boss's own phase-first table), `recover`,
  `summon`, `debugHit`, the damage filter and the adds-wither `onDeath`. Act1 keeps its attack code and its exports.
  → Verify: `run-boss-1337`, `run-full-1337`, `bossAct1.ttk.spec`, validate / segments specs match bit for bit (under
  `WEB_SWORD_TIMINGS`); `PROVENANCE.md` row for `shared.ts` (source `src/sim/actors/archetypes/boss/act1.ts`).

- [x] **D4. `boss.demonlord` archetype.** `archetypes/boss/demonlord.ts`, band `PORT_BAND_BOSSES` = 2, its own
  `DemonlordState` / `DemonlordAttack` / `DEMONLORD_ATTACK_NAMES` / telegraph and phase tables, data in the module
  (no magic numbers), registered in the archetypes index; arc-table entries.
  → Verify: new specs: index 8 and every web / dummy index unchanged; determinism (two runs, same hash); every
  telegraph >= 30 ticks; phases never skipped; summons respect the alive cap and a full pool; a TTK spec like act1's
  (hp / cap = 120 s, and the real weapons' kill times within the act1 band); `npm test` passes with no fixture change.

- [x] **D5. Seeded boss pick (dungeon).** `dungeon/endlessData.ts`: `ENDLESS_BOSSES` (kind, weight) and
  `BOSS_PICK.salt`; `dungeon/endless.ts`: `bossKindFor(floorSeed)` from `mulberry32(floorSeed ^ BOSS_PICK.salt)`, one
  draw; `EndlessFloorLayout.bossKind`; `placeEncounter` gets it. The tutorial keeps `BOSS_ACT1_KIND`. A spec-side seed
  finder lists run seeds whose floor 5 is each boss.
  → Verify: specs: over run seeds 1-1000 x boss floors 5-50 the split is within 3 points of the weights; layouts,
  digests, props, room spawns and breakables identical to before for every floor (only the boss spawn's kind changes);
  the tutorial lock spec and M1 config spec unchanged; the server replays a Demon Lord floor (`run/validate`).

- [x] **D6. Views, audio, bots.**
  - `shared/view/sprites.ts`: `ActorAttack.anim` (named attack, falls back to `attack`) and an optional `special`
    (one-shot `intro` / `taunt`, stretched over the gameplay timer); priority death > special > attack > hit > move >
    idle; `demonlordSpriteInput`; `ACTOR_SPRITE_INPUTS` gets the demon (Bramble had no art yet; main's BRAMBLE_ART
    gave her a set).
  - Telegraph previews: `TelegraphController.drawBoss` dispatches by id; `render/demonlord.ts` (consts imported by
    name, like `bossAct1.ts`) and demon markings in `shared/view/markings.ts` showing exactly where the bullets go.
  - FX: `fxCues` treats any `data.boss` as the boss for death / phase; `fx.boss.slam` on the charge's impact.
  - Audio: `bossEngaged` already plays the roar; optional `sfx.boss.taunt` (PORT_AUDIO_EVENTS, SILENT in the
    placeholder) on phases 2-3, from the Ninja Adventure `Voice/` folder if a clip fits (audition).
  - Bots and analytics: `bossOf` / `fightBoss` and `partyBot` find any `data.boss` (done with D5); the analytics boss
    level carries the boss id.
  → Verify: specs for the animation choice (each state -> animation, one-shots stretched), the markings (preview equals
  the bullets fired, as for act1), the fx cues and the bots on a Demon Lord seed; `npm run verify`.

  As built (2026-10-26). Presentation only: no file under `src/shared/sim` or `src/shared/dungeon` changed, no hash,
  replay or fixture moved.
  - **Animation choice** (`shared/view/sprites.ts`). `ActorAttack.anim` (a named attack; a set without it plays
    `attack`), `ActorSpecial` (a one-shot that is no attack, stretched over its timer; a set without it plays what
    plays without it, never a swing) and `ActorSpriteInput.special` / `deathTicks`; `chooseActorAnim` is death >
    special > attack > hit > move > idle. The swarmer's input is unchanged (no `anim`, no special: byte-for-byte the
    old choice). `demonlordSpriteInput` (in `ACTOR_SPRITE_INPUTS` with the swarmer; Mother Bramble stays a
    placeholder), names in `SPRITE_VIEW.demonlordAnims`:

    | State (attack) | Animation | Stretched over |
    |---|---|---|
    | DORMANT, RECOVER | `idle` | (loop) |
    | CHASE, REPOSITION | `move`, rate = speed / `SPRITE_VIEW.demonlordMoveRefSpeed` (his chase speed 4.2) | (loop) |
    | TRANSITION, phase 1 | `intro` (special) | `introTicks` |
    | TRANSITION, phase 2-3 | `taunt` (special) | `transitionTicks` |
    | TELEGRAPH + ACTIVE, CLEAVE / DOUBLE_CLEAVE | `attack` | telegraph + 15 (cleave) / 14 + 15 (double cleave) |
    | TELEGRAPH + ACTIVE, HELLFIRE | `attack.2` (-> `attack`) | 42 + 20 |
    | TELEGRAPH + ACTIVE, SUMMON | `intro` (special; -> idle) | 48 + 30 |
    | TELEGRAPH, CHARGE | `idle` | |
    | ACTIVE, CHARGE, before the impact | `move` (14 u/s: `loopRateMax`) | (loop) |
    | ACTIVE, CHARGE, from the impact (v[MARK] > 0) | `attack.2` (-> `attack`) | `CHARGE_IMPACT_HOLD_TICKS` |
    | dead | `death` | `bossDeathCorpseFraction` (0.6) of `corpseTicks`, then held |

    The swing reaches its last frame exactly on the attack's last ACTIVE tick (alpha 1), and the telegraph's last tick
    meets ACTIVE tick 0 (no jump); the cleave's strike lands at 36 / 51 of the swing, the hellfire's at 42 / 62.
    `ActorRenderController`: a boss sprite gets `bossSpriteLayout` (at least `bossMinDrawPx` wide, the placeholder
    bosses' rule; the demon's 98 px cell at 10.5 px / tile is 149 web px, so it is unchanged) and its corpse holds
    until `SPRITE_VIEW.bossCorpseFadeFrom` (0.6) of the corpse time, then fades (the death darkens and holds, so a fade
    from the first frame would hide it); the baked rim is the generic enemy path (the placeholder's `enemyOutline`).
  - **Merged with main's demon art (docs/BRAMBLE_ART.md BR2 / BR4, BD7; 2026-10-26).** Main built the same boss
    machinery for Mother Bramble; the merge keeps one of each: `BOSS_OPTIONAL_ANIMATIONS` is the union (`attack.2`,
    `attack.3`, `attack.4`, `intro`, `taunt`); `ActorAttack` has `anim` plus main's `segment` / `loop`;
    `ActorSpriteInput` has `special`, `deathTicks` and main's `flinch`; `chooseActorAnim` is death > special > attack >
    hit > move > idle for both. A special the set lacks plays its `ActorSpecial.fallback` (Mother Bramble's intro:
    `taunt`; the Demon Lord's specials name none), else is skipped as here. The corpse fade-from moved from "any boss
    sprite" in `ActorRenderController` to the input (`ActorSpriteInput.corpseFadeFrom`: the Demon Lord's
    `bossCorpseFadeFrom`; Mother Bramble fades over the whole corpse, as main built her). `bossSpriteLayout` applies to
    both bosses; both built sets are already wider than `bossMinDrawPx`, so neither changes. `ACTOR_SPRITE_INPUTS` holds
    the swarmer, sniper, turret.sniper, bruiser, Mother Bramble and the Demon Lord. Sprite-set `downscale` and main's
    per-sheet cells compose in `build-atlases.js` (each sheet's box is grown to k-blocks and / k).
  - **Previews** (`shared/view/markings.ts`, `render/demonlord.ts`, `TelegraphController`). `drawBoss` draws the seal
    and the roar rings for ANY boss (`BossFightState.TRANSITION`), then dispatches by id: Mother Bramble's previews
    as before, the Demon Lord's (`DemonlordConsts`, every constant imported by name), else a generic ring. Shapes:
    CLEAVE = one lane per bullet from his body to the bullets' reach (`burstReach`: spawn radius + speed x the floor's
    enemy bullet speed scale x life) and the reach's arc; DOUBLE_CLEAVE = that, plus the second arc (dim) along v[AUX]
    from the lunge's end (v[DIR] x 1.2 ahead), kept on that spot during the lunge; HELLFIRE = the three arcs at
    `ringOffset` with ticked gap edges, gaps on v[DIR] and +-120; CHARGE = Bramble's slam lane (`chargeLaneMarkings`,
    shared): body-wide lane to v[AUX], impact circle, shockwave arc with its gap pointing back, also while he runs;
    SUMMON = a ring on each add's landing spot (`summonSpots`, 120 degrees apart from v[DIR]) with a ray to it, or the
    hellfire ring when v[SIGN] = 0. CHASE draws nothing (nothing is locked yet). `view/demonlord.spec.ts` checks it
    against the real sim on forced attacks (seeds 1337 / 42 / 7): drawn lane / gap-edge headings equal the fired
    bullets' headings (1e-6), the cleave lanes end at the bullets' reach (within one tick of flight), the second arc
    sits where the lunge stopped, the shockwave on the impact point, the summon rings on the adds; a deliberately
    wrong arc centre, reach or spot fails it.
  - **FX** (`shared/view/fx/fxCues.ts`). Boss death / phase cues were already generic (the tracker's `data.boss`).
    `fx.boss.slam` follows `BOSS_IMPACTS` (Bramble's SLAM, the demon's CHARGE: attack, ACTIVE state, mark slot, target
    slots); the telegraph-clear spot covers either boss's charge target. `fxCues.spec`: "the slam" no longer steps the
    seed-1337 recording for a `boss.act1` (run 1337's floor 5 is the demon now); it and the new Demon Lord charge case
    spawn the boss into a fresh state (seed-independent). The census counts both impacts (none land in the recorded
    run: its bot ends floor 5 with debug presses before the phase-2 charge lands).
  - **Audio** (`shared/view/audio/cues.ts`). The engage roar was already generic (`bossEngaged`). New port ID
    `sfx.boss.taunt` (theme `PORT_AUDIO_EVENTS`, SILENT in the placeholder pack, `"silent": true` in `art/audio.json`):
    a phase change (phase >= 2) of a boss in `BOSS_TAUNT_IDS` (the Demon Lord) plays it instead of the roar, at the
    roar's priority (80); a silent taunt falls back to the roar (`SFX_FALLBACK`), so today his phase change sounds
    exactly as before. Mother Bramble keeps the roar. **D7 picks the clip** from the Ninja Adventure `Voice/` folder
    (a laugh; not in the D6 sandbox), audition with `npm run audio:audition`.
  - **Analytics** (`shared/run/telemetry.ts`, `analytics.ts`). `RunTelemetryRecord.bossId`: the boss engaged at
    `bossEngagedTick` (the run's first fight; read from the engage tick's actors, `engagedBossId`). The progression
    event keeps path `ActI`; the level is per boss (`BOSS_PROGRESSION_LEVELS`): Mother Bramble stays level 1
    `MotherBramble` (M1's history and dashboards keep their key), the Demon Lord is level 2 `DemonLord` (a name, not an
    order). No boss id (fixture event streams) or an unlisted one logs Bramble's level, as before. The funnel steps,
    custom events and field values are unchanged.

- [ ] **D7. Upload and Studio.** Upload the 14 sheets (`art/upload`), paste ids into `assetIds.ts`, `npm run verify`.
  Pick the `sfx.boss.taunt` clip (`Voice/`, a laugh) in `art/audio.json`, `audio:lock` / `audio:build`, upload.
  Studio: a solo and a 2-player run to a Demon Lord floor and a Bramble floor; check facing in all 16 directions,
  intro / taunt / death timing, telegraph readability (the cleave arc and the large sprite must not hide bullets), the
  drawn size against the hitbox debug view (tune `bodyTiles`), half-res sharpness at 1080p, and fps plus
  GraphicsTexture memory on PC and the phone emulator.
  → Verify: numbers written here; if the phone budget fails, fall back to 8 facings (4 + 4 sheets).

- [ ] **D8. Docs.** `CLAUDE.md` documents table and decision log (band 2, the seeded pick and its salt, endless
  replays / scores changed, the optional boss animations, sprite-set downscale); `docs/ART.md` (the Demonlord row,
  budget); `docs/CLIENT.md` (boss sprites, smoke steps); `src/shared/theme/README.md`.

## Decisions (2026-10-26, Kaleb)

- **A new boss archetype**, not a reskin of Mother Bramble or a visual-only variant: `boss.demonlord` with its own
  attacks on the shared fight skeleton.
- **Seeded pick** per boss floor from the floor seed's own stream.
- **Defaults taken when building (2026-10-26, change any of them in data):** weights 50 / 50; floor 5 is NOT special
  (any boss floor can be either); no no-repeat rule (each boss floor is an independent draw); display name
  "The Demon Lord". Still open: whether Mother Bramble ever gets art (out of scope here).

## Risks

- **Fairness.** A melee cleave against sword players who must stand close. Keep the telegraph >= 0.6 s, the arc's reach
  short and its gaps readable; tune with the bots' kill times next to act1's.
- **Readability.** A sprite ~2x the skeleton over a busy arena: check that bullets and markings draw above it and the
  outline stays on.
- **Texture memory** on phones (~56 MB more on a Demon Lord floor): measure in D7; 8 facings is the fallback.
- **Half-res softness.** Pre-rendered art with `Default` resampling should hold up; judge in Studio.
- **Engine extraction.** D3 is a move, but any reordered rng draw or state write breaks the boss fixture; that is what
  the fixture is for. If it fights back, `demonlord.ts` can import act1's helpers instead (export them).
- **Style mix.** A fully animated Demon Lord next to a placeholder-block Mother Bramble on alternating floors.

## Out of scope

Art for Mother Bramble; a third boss; boss variants in M1 or the tutorial; changing boss hp, Depth scaling or scoring.
