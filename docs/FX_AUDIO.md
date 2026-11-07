# Effects and audio: plan

How to put the two packs that just arrived, `art/FX/` (sprite effects) and `art/Audio/` (sound effects, jingles,
music), into the game. Work it task by task, like `PLAN.md`, `docs/ART.md` and `docs/DECOR.md`; each task ends with a
**Verify**. Everything here is **presentation only**: nothing touches `src/shared/sim/**` or `src/shared/dungeon/**`,
every fixture and replay hash stays the same, and every asset goes through logical IDs in `shared/theme`.

## Status (2026-10-26, branch `fx-audio`)

Every code task is **done and verified headlessly only**: X0, F1-F4, F6, A1-A3 and W1 (`npm run verify`: 1717 of 1718
tests; the one failure is the known x86 `forge.spec.ts` seedToState vector). **Nothing has run in Studio and nothing is
uploaded**, so `VALE_ASSET_IDS` has no audio or fx ids, the game is still silent and no sprite effect is drawn. The
owner accepted the recommended defaults for X1-X7. What's left is the owner's: confirm the pack's source (X0), F0
(the style go/no-go), A0 by ear (`art/audio-audition.html`), uploading (A4, F5), the mix pass (A5) and the playtest (W2).

As built, differing from the text below:

- **Theme.** Sound assets take `variants` / `pitch` / `minInterval`, resolved by `pack.sound(id)` into a `SoundRef`
  (`variants` = the extra clips). Looped slots (`music.*`, `amb.*`) reject `variants` and `pitch`. `PORT_AUDIO_EVENTS`
  (20 IDs: the 7 old `PORT_SFX` plus the 13 new ones) and `amb.b1`..`b5` are **required** and SILENT in the placeholder,
  not optional; no `MANIFEST_FORMAT` bump, so a pack from outside the repo must add them. `fx.*` is an optional
  one-facing `"sprites"` set with animation `play` (`fps` / `loop` live on it), `sizeTiles` (the longer side, capped at
  `FX_SPRITE_MAX_TILES` 3), `tint`, `additive`, `meanColor` (required when untinted). New roles `fx.heal` `#6ee08a`,
  `fx.curse` `#8a6ad8`; `fxColorReport` holds every tint and mean colour >= 40 CIE76 from the enemy-bullet roles.
  Read with `pack.fx(id)` -> `FxSprite`. Ambient particle textures may be flipbooks (`flipbook: { grid, fps, mode }`).
- **Audio pipeline** (`scripts/audio/build-audio.js`, `art/audio.json`, its own `art/audio.lock.json`): 54 OGGs,
  10.4 MiB, 43 IDs on, 4 silent (`amb.b2`: no fire bed; `music.lobby`: falls back to `music.menu`; `sfx.loot.*`: no
  caller). Every pick is the plan's first candidate, `"confirmed": false`. Sound effects mono and peak-normalised to
  -1 dBFS (a clip that decodes above -0.3 dBFS is re-encoded quieter); music and ambience two-pass loudnorm to -18 LUFS.
  Wind is trimmed to 0.917-20.273 s (listen to the loop seam); Storm is low-passed at 3 kHz; the boss roar
  (`Strange`) is mostly silence, trimmed to 0.8 s. Byte-identical rebuilds on one ffmpeg build (bytes differ between
  builds, so the Mac's output is what gets uploaded). `npm run audio:audition` writes the listening page.
- **Audio playback.** `AudioCueMapper` takes a `playable(id)` predicate (silent IDs use no cap slot), per-frame
  priority and cap (`AUDIO_VIEW.maxStartsPerFrame` 6), **one jingle per frame** (`JINGLE_SFX`; on an endless boss kill
  depth.up wins over victory), fallbacks (`finisher` -> swing, `ui.back` -> click; `ui.move` has none). Co-op split
  (`AudioStateWatch`, state diffs): the local player's hurt / death / roll / flask / swing play at 1, teammates' at
  `teammateVolume` 0.4, teammates' shots and swaps not at all; deflects are attributed to whoever could have made them.
  Solo plays the same cues as before, plus the new rows. Ducking on the music SoundGroup, an ambience channel, music
  by place (menu, lobby, tutorial, biome, boss, silence on death), preload per run and floor.
- **Effects.** One atlas, `fx-effects.png` (290x928, 17 sets); the ID / sheet / tint / size table is in
  `packs/vale/fx.ts`. The slashes are cyan and white, not yellow-orange (they are greyed anyway). Frame-grid mismatches
  against the Preview.gifs are recorded as `previewNote`s in `art/atlases.json`. **Effects are drawn flat on the floor**
  (a SurfaceGui on a thin Part at 0.06 studs, under the markings and bullets), not as billboards: a depth-tested
  billboard can't lose every overlap with floor markings. The cost: standing bodies draw over hit marks.
  `FX_SPRITE_VIEW.placement: "billboard"` keeps the billboard version for comparison in F0. The death puff and
  splinters use one grey (`uiTextDim`): per-archetype tints can't be validated, and `breakable.crate` is too close to
  the bullet outline. Tunables in `FX_SPRITE_VIEW` (not `FX_VIEW`). Check in Studio: `swingArtHeadingDeg` 270 and
  `guardArtHeadingDeg` 90 were read off the sheets by eye. Ambient: ancient Clouds (one frame), molten Fire (4x4),
  frost Snow (2x2), verdant Leaf (4x4), grim unchanged.
- **Ambient textures after the merge with main (DECOR.md R5).** main's R5 art also fills every
  `decor.fx.ambient.b<n>` with one Lords of Pain soft dot (`decor-mote.png`, tinted per biome). The R5 mote wins:
  once `decor-mote.png` has an ID it draws in all five biomes and these flipbooks are not used. Until then a biome
  whose `fx-ambient-b<n>.png` has an ID uses the flipbook (`buildValeManifest` adds an ambient entry only where
  `addWorldArt` left none). Both are built by `art:build`; neither is uploaded yet.
- **Known edge:** a relic or shrine taken in the same rendered frame as a floor change makes no sound (one sample per
  frame). A bot at 3 ticks per frame hits it; a player can't.

## What arrived (measured)

**Source.** The folder layout, names and art match **Ninja Adventure** by Pixel-boy and AAA
(https://pixel-boy.itch.io/ninja-adventure-asset-pack), released **CC0** (attribution not required, but
appreciated). This copy has 41 music tracks where the store page lists 25, so it is a newer version of the pack.
Confirm where it came from in X0 before anything ships.

### `art/FX/`: 107 files, 616 KB

Small, bright pixel art: horizontal strips of 4-14 frames with cells 24-55 px tall (most are 32 px), plus static
strips (projectiles, particles) and a `Preview.gif` per animation (frame counts and timings below come from those).

| Group | Sheets (frames, preview length) | What it is |
|---|---|---|
| `Attack/` | Cut 4, CutX 4, CutDouble 6, Claw 5, ClawDouble 5, SlashCurved 5, SlashDoubleCurved 5, CircularSlash 5 (32 px, 0.4-0.7 s) | small hit marks: slashes, claws, crosses |
| `Slash/` | Slash01-03, Arc, Circular, Multi (30-55 px, 7 frames, 0.5 s) | bigger swing trails, yellow-orange |
| `Magic/` | Circle (white / orange / spark / spark2), Shield (blue / yellow, 6), Spirit (3 colours, 6), Boost 11, Aura 5, Spark 10 | rings, bursts, a shield bubble, wisps, a power-up column |
| `Elemental/` | Explosion 10, Flam 9, Ice (3), Plant (2), Rock (2), RockSpike 10, Thunder 8, Water 11, WaterPillar 9 | chunky elemental bursts (0.5-1.1 s) |
| `Smoke/` | Smoke 6, SmokeCircular 8 | puffs and a ground ring |
| `Projectile/` | Arrow, Kunai, Shuriken (+ spinning sheets), Fireball, EnergyBall, BigEnergyBall, IceSpike, PlantSpike, CanonBall, Rock | bullets (5-24 px) |
| `Particle/` | Fire, Spark, Snow, Rain, RainOnFloor, Leaf, LeafPink, Grass, Clouds, Rock, RockGray, Wood, Vase, Bamboo | 7-16 px particle strips |
| `Environment/` | Fog (320x180), Raylight (216x102) | overlays |

### `art/Audio/`: 188 files, 96 MB

| Folder | Files | Format | Lengths |
|---|---|---|---|
| `Sounds/` (12 categories) | 133 | WAV, 16-bit, stereo, 44.1 kHz | 0.1-3.3 s; the 9 `Ambient/` loops 4.5-26 s (up to 4.6 MB each) |
| `Jingles/` | 15 | WAV, same | 0.45-2 s (GameOver x4, LevelUp x3, Secret x4, Success x4) |
| `Musics/` | 41 | OGG | 19-154 s |

Sound categories: Alert 6, Ambient 9, Bonus 10, Creature 5, Elemental 27, Hit & Impact 13, Jump & Bounce 8,
Magic & Skill 11, Menu 25, Voice 10, Whoosh & Slash 9.

## What already exists

**Audio is wired and silent.** `AudioController` plus the pure `AudioCueMapper` (`shared/view/audio/cues.ts`) already
turn each frame's summed sim events and the hit tracker's events into sound IDs, at most once per frame and per minimum
interval, and play them on pooled Sounds through the `sfx` / `music` SoundGroups at the player's Options volumes.
`musicFor` picks `music.biome.<n>`, `music.boss` during the fight, silence after a death, with a 0.75 s cross-fade.
There are 20 `sfx.*` IDs (18 played; `sfx.loot.drop` / `.rare` have no caller) and 7 `music.*` IDs, all `SILENT` in the
placeholder pack. Pasting `{ kind: "sound", assetId, volume }` into a manifest makes an ID play with no code change.
So most of the audio work is choosing clips, preparing them, uploading them and mixing them, plus a few new IDs and
variant support.

**There are no sprite effects yet.** Today's effects are placeholder geometry: `ParticleController` (1-3 px cube
bursts on kills, boss phases, breakable chips), `WeaponViewController` (dashed floor fans for swings, guard, bow charge),
`TelegraphController`, and `DecorFxController` (`decor.fx.*`: Lords of Pain flame / glow / glint / zone, biome ambient
textures). The FX pack adds a new layer: **one-shot sprite flipbooks** at a world position (a hit mark, a puff, a
ring), plus textures for the existing ambient emitters.

## Gaps between the packs and the code

1. **Style mix (the biggest risk).** The effects are 16-32 px, saturated, chibi pixel art. They would sit next to the
   256 px dark pre-rendered Lords of Pain sprites and the HD 128 px knight. Some effects (slashes, rings, sparks, smoke)
   are simple enough to fit if they're tinted and drawn small. Others (rock, water, plant, explosion) are clearly
   cartoony. Spike F0 decides this before any pipeline work.
2. **No renderer or contract slot for one-shot sprite effects.** `"sprites"` (`shared/theme/types.ts`) already has
   `resample: "Pixelated"` and one-facing sets, so the asset kind can be reused. What's missing is the slot, the cue
   mapping and the controller.
3. **Colour and readability.** The colours are baked in, and `ImageColor3` multiplies, so a sheet can only be tinted to
   a theme role if the pipeline first turns it white or grey. Enemy bullets are hot pink (`enemyBullet` `#ff3fa4`), and
   the pack has pink and red sheets. The GDD bullet-readability rule wins: no effect may look like an enemy bullet.
   Use the same >= 40 CIE76 rule the validator already applies to `decor.fx.*`.
4. **One clip per sound ID.** The pack has variations (Hit1-9, Slash-Slash5, Impact-Impact5, Water1-10). Playing the
   same hit 50 times a minute gets tiresome, so the sound asset needs `variants` and a small pitch jitter.
5. **Unprepared clips.** The clips have different loudness and some have silence before the sound starts. Every sound
   effect is stereo, and the ambient WAVs are large. They need trimming, loudness normalising, mono for sound effects,
   and conversion to OGG before upload.
6. **Events with no sound or effect ID.** These already exist as SimEvents or view state but nothing listens to them:
   room cleared, relic taken, shrine used, stairwell opened (`stairwellOpened`), new floor (`floorChanged`), depth up
   (`depthChanged`), room entered (`roomEntered`), the run-over screen, menu back and focus moves.
7. **Uploading.** Roblox audio must be under 20 MB, under 7 minutes and 48 kHz or lower, which every file here meets.
   Accounts can upload 100 free audio files per 30 days, or 2,000 if ID-verified. A new audio upload is **private**:
   only the uploader can use it until the experience is granted permission. Upload as the experience's owner (user or
   group) to avoid granting permissions one by one.
8. **Repo hygiene.** 96 MB of audio sits untracked in the repo root of `art/`, with `.DS_Store` files. The folder
   names are `Audio` / `FX` (capitalised). macOS doesn't care, but Lune and any Linux CI do, so config paths must match
   the case exactly.
9. **Co-op.** `events.playerHits` counts hits on **any** player (`shared/sim/player.ts`), so today a teammate's hit
   plays the local hurt sound. That's fine for solo but noisy in an 8-player party.

## Decisions (recommended default first; confirm before the task that needs it)

- **X1. Where the packs live:** `art/vendor/ninja-adventure/{FX,Audio}/`, gitignored like the other packs, with every
  file the pipelines read listed in `art/vendor.lock.json`. CC0 would let it be committed, but 96 MB of WAVs doesn't
  belong in git; the pipelines' outputs (`art/build/`) are what gets uploaded.
- **X2. FX style:** use the pack **selectively and tinted**. Use the shape effects (Attack, Slash, Magic Circle /
  Shield / Spark / Spirit, Smoke), turned grey in the pipeline and tinted by theme roles. Use the elemental sheets only
  where they fit the content (Plant / RockSpike for Mother Mayhem, a bramble boss in a burned forest), and only
  if F0 passes them. Fallback if F0 fails outright: keep today's geometry effects and use the pack only for ambient
  particle textures.
- **X3. Bullets keep their neon placeholders** (the GDD rule, unchanged since `docs/ART.md`). The projectile
  sprites are out of v1. A player-arrow sprite (`Projectile/Arrow`) could come later, since player bullets aren't
  threats.
- **X4. Audio stays 2D** (Sounds under SoundService, no positional audio): the camera is fixed and close, so panning
  adds little. **Co-op:** the local player's hurt / death / roll / flask / shot sounds play at full volume, and
  teammates' at `AUDIO_VIEW.teammateVolume` (0.4) or not at all for shots. That needs per-player reads from state,
  since the summed events don't say whose they are (A3).
- **X5. Ambience goes through the `sfx` SoundGroup**, so there is no new slider and the settings doc doesn't change.
  A separate `ambient` group can come later if playtests ask for it.
- **X6. Music: one track per slot for v1.** Endless runs repeat biomes, so per-floor rotation
  (`music.biome.<n>.<v>`) is Phase 2.
- **X7. Death:** the GameOver jingle plays over the music fading out, then the results screen is silent (today's
  behaviour) or plays a quiet track (`music.results`). Default: silence, with a short jingle.

## Mapping (starting picks; A0 confirms them by ear)

Clip names are file names under `Sounds/` unless noted. "A / B" means "audition both".

### Existing sound IDs

| ID | Fires on | Candidate clips | Notes |
|---|---|---|---|
| `sfx.player.shoot` | bow volley | `Whoosh & Slash/Launch` / `Whoosh` | 0.06 s min interval already; pitch jitter |
| `sfx.player.swing` | sword swing | `Whoosh & Slash/Slash`-`Slash5` (variants) | finisher could use `Sword2` (new ID below) |
| `sfx.player.roll` | roll start | `Jump & Bounce/Jump` / `Whoosh2` | soft |
| `sfx.player.flask` | flask drunk | `Magic & Skill/Heal` / `Heal2` | |
| `sfx.player.swap` | weapon swap | `Menu/Move3` / `Whoosh & Slash/Sword2` | very short |
| `sfx.player.hurt` | player hit | `Hit & Impact/Hit2` / `Hit5` | must cut through everything: loudest sound effect |
| `sfx.player.death` | player died | `Hit & Impact/Impact5` (+ `Jingles/GameOver` via the new jingle ID) | |
| `sfx.player.deflect` | guard deletes bullets | `Hit & Impact/Impact` / `Magic & Skill/Magic2` | 0.08 s min interval |
| `sfx.ember` | bullet clear | `Magic & Skill/Magic3` (2.7 s) / `Elemental/Explosion6` | rare and big: may duck the music |
| `sfx.enemy.shoot` | enemy bullets spawned | `Elemental/Fireball` / `Magic & Skill/Magic1`, at low volume | bullet-hell density: quiet, 0.08 s interval |
| `sfx.enemy.telegraph` | wind-up starts | `Alert/Alert2` / `Alert3` | a warning: distinct from every hit sound |
| `sfx.enemy.hurt` | enemy hit | `Hit & Impact/Hit1`, `Hit3`, `Hit6`-`Hit9` (variants) | |
| `sfx.enemy.death` | enemy killed | `Hit & Impact/Impact2`-`Impact4` (variants) / `Elemental/Explosion3` | |
| `sfx.boss.roar` | boss engaged, phase 2 / 3 | `Magic & Skill/Strange` / `Spirit` | **gap**: no real roar in the pack |
| `sfx.boss.taunt` | the Demon Lord's phase 2 / 3 (docs/BOSS_DEMONLORD.md D6), instead of the roar | silent; D7 picks a laugh from `Voice/` | port ID; falls back to the roar while silent |
| `sfx.boss.death` | boss killed | `Elemental/Explosion6` / `Explosion4` | |
| `sfx.victory` | boss defeated | `Jingles/Success3` / `LevelUp2` | a jingle: ducks the music |
| `sfx.breakable.hit` | crate / barrel hit | `Hit & Impact/Impact4` | **gap**: no wood sounds |
| `sfx.breakable.break` | piece broken | `Hit & Impact/Impact5` / `Elemental/Explosion2` | |
| `sfx.loot.drop` / `sfx.loot.rare` | (no caller) | `Bonus/Coin` / `Bonus/PowerUp1` | keep for when loot lands |
| `sfx.ui.click` | menu click | `Menu/Move1` / `Move2` | |
| `sfx.ui.confirm` | menu confirm | `Menu/Accept4` / `Accept6` | |

### New sound IDs (port additions, like `PORT_SFX`)

| ID | Fires on (source) | Candidate clips |
|---|---|---|
| `sfx.ui.back` | menu back / cancel | `Menu/Cancel2` |
| `sfx.ui.move` | focus moves (gamepad) | `Menu/Move4` (very quiet) |
| `sfx.player.finisher` | the sword's 3rd swing (`combat.weapons.swing*`) | `Whoosh & Slash/Sword2` + `Slash4` |
| `sfx.player.charged` | bow charge reaches full | `Magic & Skill/Magic4` |
| `sfx.room.clear` | combat room cleared (score room records, as the decor director reads them) | `Jingles/Success1` (0.45 s) |
| `sfx.relic.take` | relic pedestal taken (`state.run`) | `Bonus/PowerUp2` / `Bonus/Gold1` |
| `sfx.shrine.use` | curse shrine used (`state.run`) | `Jingles/Secret2` / `Magic & Skill/Spirit` |
| `sfx.stairwell.open` | `stairwellOpened` | `Magic & Skill/Fx` |
| `sfx.floor.enter` | `floorChanged` | `Jump & Bounce/Bounce2` / `Jingles/Secret1` |
| `sfx.depth.up` | `depthChanged` (a boss kill) | `Jingles/LevelUp1` |
| `sfx.jingle.gameover` | run over (all players dead) | `Jingles/GameOver` / `GameOver3` |

### Music

| ID | Candidate tracks (`Musics/`) | Notes |
|---|---|---|
| `music.menu` | `38 - Intro` / `1 - Adventure Begin` | |
| `music.biome.1` (ancient) | `21 - Dungeon` / `30 - Ruins` | |
| `music.biome.2` (molten) | `24 - Final Area` / `10 - Dark Castle` | Dark Castle is 33 s: check it doesn't get repetitive |
| `music.biome.3` (frost) | `13 - Mystical` / `12 - Temple` | |
| `music.biome.4` (grim) | `40 - Crypt` / `14 - Curse` | |
| `music.biome.5` (verdant) | `37 - Dark Forest` | |
| `music.boss` | `34 - Fight` / `17 - Fight` | |
| new `music.tutorial` | `27 - Chill` / `5 - Peaceful` | the tutorial plays the biome.1 track today |
| new `music.lobby` (optional) | `33 - Calm Village` | if the lobby shouldn't share the menu track |

Leave out the bright village / sunny / boat tracks; they don't fit a dungeon.

### Ambience (new `amb.b<n>`, looped under the music, quiet)

| Biome | Candidate | Gap |
|---|---|---|
| ancient | `Ambient/Wind2`, very low | |
| molten | none suitable (`Elemental/Fire*` are short one-shots) | **gap**: a fire crackle bed |
| frost | `Ambient/Wind` | |
| grim | `Ambient/Storm`, low-passed / quiet | |
| verdant | `Ambient/River` / `Rain` | |

### Sprite effects (new optional `fx.*` slot)

| ID | Fires on | Sheet | Tint role |
|---|---|---|---|
| `fx.hit.light` | enemy `hit` (normal) | `Attack/Cut` / `CutX` | `damageNumber` |
| `fx.hit.heavy` | `hit` with `heavy` (finisher, heavy arrow) | `Attack/CutDouble` / `SlashDoubleCurved` | `uiAccent` |
| `fx.swing.1` / `.2` / `.3` | sword swings 1, 2 and finisher, on the existing fan | `Slash/SpriteSheetSlash01-03` / `Arc` | `playerBullet` / `uiAccent` |
| `fx.death.puff` | enemy `killed` (on top of the cube burst) | `Smoke/Smoke` | the archetype's role, desaturated |
| `fx.roll.dust` | roll start | `Smoke/SmokeCircular` | floor-dust grey |
| `fx.guard.shield` | guard up / deflect | `Magic/Shield` (blue) | `uiMana` |
| `fx.ember.ring` | Ember | `Magic/Circle` (white) + `Magic/Spark` | `uiAccent` |
| `fx.flask` | flask | `Magic/Boost` / `Aura` | a heal green (new role) |
| `fx.boss.phase` | `bossPhase` >= 2 | `Magic/Aura` | `boss` |
| `fx.boss.slam` | Mother Mayhem's slam lands (after its telegraph, never over it) | `Elemental/RockSpike` / `Plant` | own sheet colours, if F0 passes them |
| `fx.boss.death` | `bossDefeated` | `Elemental/Explosion`, 3 staggered | |
| `fx.relic.take` / `fx.shrine.use` | pedestal / shrine | `Magic/Spark` / `Magic/Spirit` | `uiAccent` / a curse role |
| `fx.stairwell` | stairwell opens | `Magic/Circle` spark loop | `decor.fx.zone` |
| `fx.breakable.splinter` | piece broken (with the chips) | `Particle/Wood` frames as a burst | `breakable.<kind>` |
| `fx.bullet.hit` (docs/PROJECTILE_ART.md PA7) | a player bullet that ended with life left (`BulletImpacts`; lowest rank, 3 a frame, half the budget) | 16Bit Bullets `P1_Bullet_Hit.png`, 5 frames, packed in `bullets.png` (not `fx-effects.png`) | untinted, additive |

Ambient textures for the existing `decor.fx.ambient.b<n>` emitters: frost `Particle/Snow`, molten `Particle/Spark` /
`Fire`, verdant `Particle/Leaf`, ancient `Particle/Clouds` (dust), grim no match (keep the current wisp). Skip the
`Environment/` fog and ray overlays for v1; they would sit over the bullets.

## Architecture

### Audio

- **Contract** (`shared/theme`): `SoundAsset` gains optional `variants` (more `rbxassetid://` ids, chosen round-robin
  so specs are deterministic), `pitch` (`[min, max]` PlaybackSpeed jitter, default none) and `minInterval` (overrides
  `SFX_MIN_INTERVAL`, tuned per clip). It's additive, so `MANIFEST_FORMAT` and existing packs stay valid. New IDs go in a
  port list next to `BREAKABLE_AUDIO_EVENTS` (`PORT_AUDIO_EVENTS`), so `AUDIO_EVENTS` stays the web build's list.
  `amb.b<n>` is a new slot (prefix `amb.`, sound group `sfx`, optional).
- **Mapper** (`AudioCueMapper`): the new event rows (`stairwellOpened`, `floorChanged`, `depthChanged`, room clear,
  relic, shrine, finisher, full charge). It also gets a **priority + voice cap** per frame (`AUDIO_VIEW.maxStartsPerFrame`)
  so a busy frame keeps the player's hurt and the telegraph over the enemy-shot and hit sounds, plus the co-op split
  (X4). Stays pure, with specs.
- **Controller** (`AudioController`): play a variant with pitch jitter; **duck** the music for jingles and the Ember
  (`AUDIO_VIEW.duck`: dip music to 40 % for the clip's length, tweened); an **ambience bed** that follows the floor's
  biome like music (its own cross-fade, `AUDIO_VIEW.ambientVolume`); the death jingle (X7). Preload the floor's sounds
  with `ContentProvider:PreloadAsync` on `onFloorChanged` so the first hit of a floor isn't late.
- **Pipeline** `scripts/audio/build-audio.js` (`npm run audio:build`), driven by a committed `art/audio.json` (logical
  ID -> source clips, gain, trim): check sources against `art/vendor.lock.json`; then ffmpeg (on the Mac already) trims
  leading and trailing silence, normalises loudness per category (sound effects peak-normalised, music and ambience to
  a common LUFS target set in the config), downmixes sound effects to mono, and encodes OGG to `art/build/audio/`, plus
  a generated `packs/vale/audioLayout.ts` (file -> ID, base volume). Deterministic like `art:build`.
- **IDs**: audio ids are pasted into `packs/vale/assetIds.ts` keyed by built file name, the same as images. The manifest
  turns a sound ID on once all of its variants have ids.

### Effects

- **Contract**: an optional `fx.*` slot (like `decor.*`: no ID means nothing is drawn). Each entry is a one-facing
  `"sprites"` set plus `fps`, `resample: "Pixelated"`, `sizeTiles` (drawn size), `tint` (a colour role, optional) and
  `additive` (LightInfluence 0, a brighter blend). The validator checks every `fx.*` tint role, and the mean colour of
  untinted sheets, at >= 40 CIE76 from the enemy-bullet roles; it rejects a `sizeTiles` above `FX_VIEW.maxSpriteTiles`.
- **Pipeline**: `art/atlases.json` gains strip sources (frame width, frame count, no facings) and a `grey` option
  (desaturate to luminance and stretch to white, so `ImageColor3` tinting works). The whole FX selection fits **one
  1024 atlas**, so texture memory barely changes. No scaling: `Pixelated` upscales on screen.
- **Pure cue mapper** (`shared/view/fx/fxCues.ts`, `FxCueMapper`): tracker events + sim events + state -> one-shot cues
  `{ id, x, z, heading?, scale }`. Positions come from the FxEvent (hits, kills), the player or the boss in state, the
  stairwell or pedestal cell, or a breakable cell (passed in by `BreakableRenderController`). It's budgeted like the
  particles: `FX_VIEW.maxSprites` (24 / 48 / 64 by the Juice level, one level lower under Reduced motion); a hit mark at
  most every `FX_VIEW.hitMarkMinSec` per actor. Headless specs over recorded runs.
- **Controller** (`FxSpriteController`, client/fx): pooled BillboardGuis with an ImageLabel each (reusing SpriteView's
  billboard and floor-clearance code), flipbook through `ImageRectOffset`, frame time from the hitstop clock (freezes
  with hitstop, stops when paused), `ImageLabel.Rotation` for slash headings, parked when done. Drawn **under** bullets
  and telegraphs (render order and depth bias), never on top of the sniper's aim line. Janitor cleanup; `reset` drops
  everything.

## Tasks

### Setup

- [x] **X0. Repo hygiene and licence.** *(source still to confirm)* Move `art/FX` and `art/Audio` to `art/vendor/ninja-adventure/` (keep the
  pack's layout and casing, drop `.DS_Store`). Confirm the source and CC0 licence, add a `THIRD_PARTY_NOTICES.md`
  entry (Ninja Adventure, Pixel-boy and AAA, CC0, credit appreciated), add a row to `art/README.md`'s pack table, and
  regenerate `art/vendor.lock.json` (`art:lock`).
  → Verify: `git status` shows no WAV / OGG / PNG; `npm run art:build` still produces byte-identical atlases;
  `npm run verify`.

### Effects

- [ ] **F0. Spike D: does the FX style fit? (go/no-go, Studio).** Hand-upload 4 sheets as they are and greyed:
  `Attack/Cut`, `Slash/SpriteSheetSlash02`, `Smoke/Smoke`, `Magic/Circle`, plus `Elemental/RockSpike`. Play them at
  the game camera (FOV 7, yaw 45, pitch 55) on the knight, a skeleton pack and Mother Mayhem, during a bullet ring. Try
  sizes 0.5 / 1 / 1.5 tiles, Pixelated vs Default, tinted vs own colours, additive vs not. Record in `docs/SPIKES.md`:
  which groups fit (X2), the drawn sizes, and whether any effect is ever mistaken for a bullet. Also note the fps cost of
  48 live effects on the phone emulator.
  → Verify: the owner signs off on a group list; if none fits, take the X2 fallback and skip F1-F5.
- [x] **F1. FX contract slot.** `fx.*` (optional), its fields, the validator's colour and size rules, the placeholder
  pack untouched, and `vale` mapping the F0-approved IDs.
  → Verify: new `contract.spec` / `validate.spec` cases; placeholder and `vale` validate clean.
- [x] **F2. Pipeline: strips and grey.** Strip sources and `grey` in `scripts/art/build-atlases.js`, the FX atlas,
  contact sheets with each strip's frames labelled, frame counts and timings checked against each `Preview.gif`.
  → Verify: deterministic (byte-identical rebuild); existing atlases unchanged; contact sheets by eye.
- [x] **F3. `FxCueMapper`.** The cue table above, budgets, Juice / Reduced motion scaling, positions.
  → Verify: headless specs over a recorded endless run and a boss floor (cues per event, caps hold, nothing on a
  telegraph tick at the telegraph's position, reset clears).
- [x] **F4. `FxSpriteController`.** *(code done; the Studio half of its Verify is open)* Pool, flipbook, hitstop clock, rotation, render order, cleanup.
  → Verify: in Studio a full endless floor and a boss floor, solo and 2-player, Juice low / high, Reduced motion on:
  no effect hides a bullet or a telegraph; fps and live-sprite counts written down on PC and the phone emulator.
- [ ] **F5. Upload and fill `vale`.** Upload the FX atlas, paste its id, and turn the `fx.*` IDs on.
  → Verify: `npm run verify` (validator, `check-asset-ids`); in Studio every cue fires once where it should.
- [x] **F6. Ambient particle textures (optional).** The `Particle/*` strips above for `decor.fx.ambient.b<n>`
  (ParticleEmitter flipbooks need a square 2x2 / 4x4 / 8x8 grid: pad the strips or use one frame), sized and faded
  under the existing `DECOR_FX` caps.
  → Verify: the validator's decor.fx rules pass; in Studio every biome at every depth band.

### Audio

- [ ] **A0. Audition and pick (owner, by ear).** *(starting picks and the listening page done; listening open)* Listen to every candidate in the tables above (a quick listening
  page with each ID's options next to each other helps) and fill `art/audio.json`: clip per ID, variants, gain, trim. Also
  list the gaps that need another source (boss roar, wood break, a molten fire bed) or a stand-in.
  → Verify: every ID in `allAudioIds()` plus the new ones has a pick or an explicit "silent for now".
- [x] **A1. Audio pipeline.** `npm run audio:build`: trim, normalise, mono, OGG, `audioLayout.ts`, sources locked.
  → Verify: deterministic rebuild; a spec that every built file is under 20 MB, under 7 minutes and <= 48 kHz; loudness
  of each category within its target window (an ffmpeg `ebur128` report in the build log).
- [x] **A2. Contract.** `variants`, `pitch`, `minInterval`, `PORT_AUDIO_EVENTS`, the `amb.` slot, `music.tutorial`
  (and `music.lobby` if wanted); placeholder pack fills each new ID with `SILENT`.
  → Verify: validator and contract specs; `allAudioIds()` spec updated; placeholder validates clean.
- [x] **A3. Mapper and controller.** New cue rows, priorities and voice cap, co-op split (X4), variants and pitch,
  ducking, ambience bed, death jingle, preload on floor change; `sfx.ui.back` / `sfx.ui.move` from the menu and HUD
  actions.
  → Verify: headless mapper specs (each new event, priority under a busy frame, co-op: a teammate's hit is quiet or
  silent, round-robin variants); in Studio every sound fires, nothing stacks into noise in a bullet ring.
- [ ] **A4. Upload and permissions.** Upload `art/build/audio/*.ogg` as the experience's owner (about 60 files: under
  even the unverified 100-per-30-days limit, but do it in one session), wait for moderation, check the experience can
  play each one (private assets), and paste the ids into `assetIds.ts`.
  → Verify: `npm run verify`; in a published test place (not just Studio), every ID plays.
- [ ] **A5. Mix pass.** In Studio at default Options volumes: hurt and telegraph always audible over a full room; enemy
  shots and hits never tiring; music under the sound effects; jingles duck cleanly; music loops have no click at the seam.
  Tune `volume`, `minInterval`, `AUDIO_VIEW.groupVolume`, the duck amount, ambience level.
  → Verify: settings written back to `art/audio.json` / the manifest; a 10-minute run on PC and the phone emulator
  without fatigue (owner's call).

### Wrap-up

- [x] **W1. Docs.** `docs/CLIENT.md` (FxSpriteController, AudioController changes), `src/shared/theme/README.md`
  (`fx.*`, `amb.*`, sound variants), the `CLAUDE.md` decision log (the new slots and port IDs, X2 / X3), `art/README.md`
  (`audio:build`, uploading audio).
- [ ] **W2. Playtest.** Every biome, solo and co-op, with effects and audio together: readability under fire, effect
  and sound fatigue over long runs, phone performance.

Order: X0 first. Audio (A0 -> A1 -> A2 -> A3 -> A4 -> A5) can start right away; it has the least risk and the
biggest payoff, since the game is silent today. Effects wait on F0. F1 -> F2 -> F3 -> F4 -> F5 follow, F6 any time
after F2. W1 lands with each part; W2 last.

## Risks

- **Style mix** (gap 1). The pack is cheerful pixel art and the game is a dark dungeon. F0 is a real go/no-go, and
  tinting plus small sizes are the main tools. Same lesson as `docs/ART.md` R1.
- **Readability.** Effects compete with bullets, telegraphs and the aim line. Keep them below bullets, small, short
  (< 0.6 s in combat), tinted away from the enemy-bullet pink, and capped by the Juice budget.
- **Audio fatigue.** A bullet hell fires a lot of events. Variants, pitch jitter, minimum intervals, the voice cap and
  quiet enemy shots are the answer; judge it over a long run, not a single room.
- **Gaps in the pack.** No boss roar, no wood or crate sounds, no fire bed, no footsteps. Either use a stand-in from
  the pack, a second CC0 source, or leave the ID silent. A0 lists them.
- **Upload friction.** Moderation delays, the private-asset permission step, and the monthly limit if the picks are
  redone many times. Pick carefully in A0 before uploading.
- **Co-op noise.** Eight players' rolls, shots and hurts in one mix. X4's local / teammate split is required for party
  runs, not a nice-to-have.
