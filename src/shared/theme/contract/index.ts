/**
 * The fixed sprite contract and slot list. Set once; every pack follows it.
 *
 * Ported from the web build's `src/theme/contract.ts` @ 42897e2. IDs, cell sizes, frame counts,
 * pivots, facings, the digit font, required IDs/strings, contrast thresholds and gameplay key words
 * are UNCHANGED (plus the port's `enemy.dummy`, see ENEMY_ARCHETYPES), so art made for either build
 * fits both. Roblox changes: visual slots accept `placeholder` where the web accepted `generated`, and
 * audio slots name the SoundGroup they play through (SOUND_GROUPS).
 *
 * Cell sizes, frame counts per animation, pivots and facings live here (not in packs), so code
 * can rely on them and a new pack can't change how anything lines up. The validator checks every
 * pack against this file.
 *
 * Contract v2 (docs/ART.md task S2, a deviation from the web build): the class / enemy / boss slots also accept the
 * additive `sprites` kind (`SpriteSetAsset`), which carries its own cell size, pivot, facings and frame counts and
 * only has to define the slot's base animation names (`requiredBaseAnimations`). The 16 px `spritesheet` rules
 * below are unchanged. Per-sheet cells (docs/DEMON_ART.md DD4: a sheet with its own `frameW` / `frameH` / `pivot`) are
 * accepted in those three slots only (`perSheetCells`).
 *
 * Roblox-port slots (docs/DECOR.md): DECOR (`decor.*`, optional room decoration: the web build's DECOR slot, rebuilt
 * from the plan) and BREAKABLE (`breakable.*`, required: breakable clutter is a gameplay object). Both take free-size
 * world art (`image` with `pixelsPerTile`, or `sprites`); see the Decor section at the end of this file.
 *
 * Roblox-port slots (docs/FX_AUDIO.md A2, F1): AMBIENCE (`amb.b<n>`, required biome ambience loops, sound or silent)
 * and FX (`fx.*`, optional one-shot sprite effects: one-facing `sprites` sets); the port's audio IDs
 * (PORT_AUDIO_EVENTS); sound variants, pitch jitter and per-clip minimum intervals. See the Effects and audio section
 * at the end of this file.
 *
 * Roblox-port slot (docs/BOOSTS.md B5): BOOST (`boost.<kind>`, required: a boost drop is a gameplay object), free-size
 * world art like BREAKABLE; its colour roles, strings, sounds and optional effects: the Boosts section below.
 *
 * Roblox-port slot (docs/PELLETS.md PL6): PELLET (`pellet.normal` / `pellet.power`, required: a pellet is a gameplay
 * object), free-size world art like BOOST; its roles, sounds and strings: pellets.ts (named inline here).
 *
 * Roblox-port slot (docs/TREASURE.md TR6): TREASURE (`treasure.chest` / `treasure.chestopen` / `treasure.cage`,
 * required: the vault's chest is a gameplay object), free-size world art like PELLET; its effect, roles, sounds and
 * strings: treasure.ts (named inline here).
 *
 * Roblox-port slot (docs/FORTUNE.md FO6): PACT (`pact.altar`, required: a pact altar is a gameplay object), free-size
 * world art like PELLET, inline in SLOTS; Fortune's roles, sounds, strings and optional coin effect: fortune.ts (named
 * inline here, like the pellets').
 *
 * Roblox-port slot (docs/SECRET_ROOMS.md SR10): SECRET (`secret.crack` / `secret.rubble`, OPTIONAL: the view draws its
 * fallback without them, so there is no placeholder kind), free-size world art like PACT, inline in SLOTS; the secret
 * rooms' role, sounds, strings and optional dust effect: secrets.ts (named inline here, like Fortune's).
 *
 * @module
 */
export * from "./slots";
export * from "./ids";
export * from "./strings";
export * from "./colors";
export * from "./decor";
export * from "./skins";
export * from "./fx";
