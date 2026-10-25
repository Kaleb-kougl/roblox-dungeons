# theme

The theme layer (PLAN.md task 3). Every sprite, tile, sound, colour and name reaches the game through
**logical IDs** resolved by the active theme pack. Today every visual ID resolves to a **placeholder primitive**
and every sound is **silent**; replacing art and audio later means editing the pack manifest only.

Ported from project-kaleb-vale `src/theme/` @ `42897e2`. The contract (IDs, sprite cell sizes, frame counts,
pivots, facings, colour roles, string keys, contrast thresholds, gameplay key words) is unchanged, so art made
for the web build fits here. Contract v2 only adds to it: the `sprites` kind for actors and `tilesPerImage` for
tile images (docs/ART.md task S2).

## Rules

1. **Logical IDs only.** Code asks for `enemy.sniper` or `bullet.enemy.small`; the manifest maps each ID to an
   asset. **No `rbxassetid://` anywhere outside `src/shared/theme/`**: `scripts/check-asset-ids.js` fails the
   build on an asset URL, an all-digits asset id string, or a 7+ digit number next to an asset-ish name.
2. **Gameplay data never lives in art.** Hitboxes, bullet radii, speeds, damage and timings live in gameplay
   data. The validator rejects gameplay-looking keys (`hitbox`, `speed`, `damage`, `radius`, `cooldown`, `rate`,
   ... `GAMEPLAY_KEY_WORDS` in `contract.ts`) anywhere in a manifest. Placeholder sizes are presentation only;
   renderers scale bullets and actors to the gameplay radius.
3. **Fixed sprite contracts.** Cell sizes, frames per animation, pivots and facings are set once in `contract.ts`
   for the 16 px `spritesheet` kind. The class / enemy / boss slots also take the v2 `sprites` kind (pre-rendered
   art in large cells, [below](#sprite-sets-the-sprites-kind-contract-v2)), which carries its own layout but must
   still define the slot's animation names.
4. **Colour roles, not colours.** Packs fill role tokens. The validator checks WCAG contrast of `enemyBullet`
   against every biome's floor **and** wall (>= 3.0:1), `enemyHealth` / `enemyHealthElite` against
   `enemyHealthBack` (>= 3.0:1), and `damageNumber` / `damageHeavy` / `damageCapped` against every biome floor
   (>= 4.5:1), each per biome.
5. **Names come from the string table** (with `{var}` interpolation and optional `locales`).
6. **One pack at a time.** Switching packs is a restart.

## Using it

```ts
import { loadThemePack, setActiveThemePack, getActiveThemePack } from "shared/theme";

const pack = loadThemePack("placeholder");           // validates; problems are warned once, kept on pack.problems
setActiveThemePack(pack);                            // renderers / audio read getActiveThemePack()

pack.str("game.title");                              // "Project Kaleb-Vale"
pack.str("hud.gold", { amount: 120 });               // "120 gold"
pack.color("enemyBullet");                           // Color3 (cached; Color3 is immutable)
pack.hex("enemyBullet");                             // "#ff3fa4"
pack.biome("biome.3");                               // { forgeTheme: "frost", floor, wall, floorColor, wallColor, tiles, materials, nameKey }
pack.sound("sfx.ember");                             // { assetId: undefined, volume: 0, group: "sfx" } while silent

const set = pack.sprites("class.vanguard");          // a `sprites` asset (contract v2), or undefined
const sheet = pack.spriteSheet("class.vanguard");
if (set !== undefined) {
	const f = set.frame("run", facing, frameNumber);  // { image, offset: Vector2, size: Vector2 }
	label.Image = f.image;                            // the frame's sheet (a set spans several atlases)
	label.ImageRectOffset = f.offset;
	label.ImageRectSize = f.size;
	label.ResampleMode = Enum.ResamplerMode[set.resample];
} else if (sheet.assetId !== undefined) {
	const f = sheet.frame("run.left", frameNumber);  // { offset: Vector2, size: Vector2 }, pixels, TOP-left origin
	label.Image = sheet.assetId;
	label.ImageRectOffset = f.offset;
	label.ImageRectSize = f.size;
	label.ResampleMode = Enum.ResamplerMode.Pixelated;
} else {
	const v = pack.placeholder("class.vanguard");    // PlaceholderVisual: build a primitive instead
	// v.shape: "Ball" | "Block" | "Cylinder" | "Wedge" (Enum.PartType names) | "Capsule" (Cylinder + 2 Balls)
	part.Size = new Vector3(v.size[0], v.size[1], v.size[2]);
	part.Material = Enum.Material[v.material];
	part.Color = pack.visualColor(v.color);
}
```

### ThemePack API (`pack.ts`, Roblox layer)

| Member | Returns | Missing ID / role / key |
| --- | --- | --- |
| `color(role)` | `Color3` (cached) | warns once, magenta (`MISSING_COLOR` = `#ff00ff`) |
| `hex(role)` | `"#rrggbb"` | warns once, `#ff00ff` |
| `str(key, vars?)` | text with `{name}` filled (active locale, then default table) | warns once, returns the key |
| `has(id)` / `hasString(key)` | boolean | |
| `biome(id)` | `{ id, forgeTheme, nameKey, floor, wall, floorColor, wallColor, tiles, materials }` (`materials`: `{ floor, wall, pool }` material names, every surface filled) | warns once, magenta floor/wall, SmoothPlastic materials; a bad material name warns once and uses SmoothPlastic |
| `sound(id)` | `{ assetId \| undefined, volume, group: "sfx" \| "music" }` | warns once, silent |
| `texture(id)` | uploaded image `assetId`, or `undefined` while a placeholder (and for a `sprites` asset) | warns once, `undefined` |
| `image(id)` | `{ assetId, w, h, tilesPerImage, pivot }` of an uploaded `image` asset (floor textures, the co-op ring, the pedestal beam) | `undefined` for any other kind or a missing ID, no warning (optional art) |
| `spriteSheet(id)` | `{ assetId \| undefined, frameW, frameH, pivot, animations, animationNames, frame(anim, i) }`; a `sprites` asset gets the placeholder layout | placeholder layout; unknown animation warns once and uses the first |
| `sprites(id)` | `SpriteSet` for a `sprites` asset (cached), `undefined` for any other kind (no warning) | warns once, `undefined` |
| `placeholder(id)` | `PlaceholderVisual` | warns once, a magenta block the size of the slot's cell |
| `visualColor(ref)` / `visualHex(ref)` | colour of a placeholder's `color` (a role, a biome surface, or missing) | |
| `problems` | validator errors found at load | |
| `core` | the pure `ThemeCore` underneath | |

`frame(anim, i)` returns `ImageRectOffset` / `ImageRectSize` in pixels with a **top-left** origin. The web build
returned UVs with a **bottom-left** origin (`frameUV`, kept for parity); `uvToPixelRect` converts one to the other
and the tests check they agree. Looping animations wrap, one-shots hold their last frame (`frameIndex`).

Placeholder sheets keep the contract layout: a placeholder in a directional slot has every `<anim>.<facing>`
animation, one frame each, one row per facing, so code written against placeholders lines up with real sheets.

Loading: `loadThemePack(id = "placeholder", { locale?, packs?, warn? })`. An unknown id warns and falls back to
`placeholder`; a pack that fails validation still loads (bad entries fall back one by one). `listThemePacks()`
lists `THEME_PACKS` (`packs/index.ts`).

### Pure core (headless)

Everything that does not need a Roblox datatype is plain Luau-safe TS, tested under Lune: `color.ts` (hex, WCAG
contrast), `strings.ts` (`interpolate`, `placeholders`, `templateProblem`), `validate.ts` (`validateManifest`,
`contrastReport`, `juiceContrastReport`, `isGameplayKey`), `core.ts` (`ThemeCore` lookups and fallbacks, `sprites` ->
`SpriteSetLayout`, `frameRect`,
`frameUV`, `uvToPixelRect`, `frameIndex`), `placeholders.ts`, `contract.ts`. `pack.ts` only converts to `Color3` /
`Vector2`. Warnings go to Roblox `warn` unless a `warn` sink is passed (the specs pass one to assert warn-once).

## Placeholder visuals (`placeholders.ts`)

`PLACEHOLDER_VISUALS[id]` describes the primitive a renderer builds for an ID with no art. Pure data; the task 8
renderers create the Instances. Sizes derive from the contract cell: the camera shows 16 px per world unit and a
world unit is `STUDS_PER_TILE` (4) studs (`shared/config/view.ts`), so **1 px = 0.25 studs**; each archetype scales
its cell by `PLACEHOLDER_PROPORTIONS`. Size is `[x width, y height, z depth along the facing]` in studs.

| ID | Shape | Size (studs) | Colour | Material / outline | Notes |
| --- | --- | --- | --- | --- | --- |
| `class.*` | Capsule | 3 x 6 x 3 | `class.<id>` (vanguard = tan `#c9b37e`) | SmoothPlastic | faces, base on floor |
| `enemy.swarmer` | Ball | 2 x 2 x 2 | `enemy.swarmer` | SmoothPlastic | small ball |
| `enemy.sniper` | Wedge | 3 x 3 x 4 | `enemy.sniper` | SmoothPlastic | points along its facing |
| `enemy.bruiser` | Block | 4 x 4 x 4 | `enemy.bruiser` | SmoothPlastic | heavy block |
| `enemy.sprayer` | Cylinder | 3 x 2.5 x 3 | `enemy.sprayer` | SmoothPlastic | squat drum |
| `enemy.caster` | Capsule | 2.5 x 4 x 2.5 | `enemy.caster` | SmoothPlastic | slim capsule |
| `enemy.summoner` | Cylinder | 3 x 4 x 3 | `enemy.summoner` | SmoothPlastic | tall drum |
| `boss.1`..`boss.5`, `boss.act1` | Block | 12 x 9 x 12 | `boss` | SmoothPlastic | large block |
| `bullet.enemy.small/medium/large` | Ball | 2 x 2 x 2 | `enemyBullet` | **Neon**, outline `enemyBulletOutline` | centred; scaled to the gameplay radius |
| `bullet.enemy.needle` | Block | 0.5 x 0.5 x 2 | `enemyBullet` | **Neon**, outline `enemyBulletOutline` | along the velocity |
| `bullet.player.basic` | Block | 0.5 x 0.5 x 2 | `playerBullet` | **Neon**, outline `playerBulletOutline` | thin bolt along the velocity |
| `bullet.player.heavy` | Block | 1 x 1 x 2 | `playerBullet` | **Neon**, outline `playerBulletOutline` | thicker bolt |
| `tile.biome.<n>.floor` | Block | 4 x 0.25 x 4 | biome `<n>` floor | SmoothPlastic | 1 px slab |
| `tile.biome.<n>.wall` | Block | 4 x 4 x 4 | biome `<n>` wall | SmoothPlastic | one tile tall |
| `item.*` | Block / Ball | 2 x 2 x 2 | `rarity.*` / `uiHealth` (web pack's roles) | SmoothPlastic | loot on the floor |
| `ui.cursor`, `ui.panel`, `ui.icon.*` | Block (flat) | cell px / 4 | `uiText`, `uiPanel` + `uiAccent`, `uiHealth`, `uiMana`, `ember` | SmoothPlastic | HUD draws Frames sized by `cellPx` |
| `ui.font.digits` | Block (flat) | 1.25 x 1.75 | `damageNumber` | SmoothPlastic | HUD draws numbers as text until a strip is uploaded |
| `TELEGRAPH_VISUAL` | Block dashes | 0.25 x 0.25 x 1 per dash, gap 0.75 | `telegraph` | SmoothPlastic | dashed line on the floor |
| missing ID | Block | the slot's cell | magenta (`{ kind: "missing" }`) | SmoothPlastic | warn once |

Extra IDs under a known prefix (`bullet.enemy.wave`, `item.weapon.axe`) use `PLACEHOLDER_PREFIX_DEFAULTS`.
"Capsule" is not a Roblox PartType: build a Cylinder (axis up) with a Ball at each end. Shapes and materials are
`Enum.PartType` / `Enum.Material` names.

## ID naming scheme and contract

Asset IDs are lowercase, dot-separated, at least two segments; the first segment picks the slot.

| Prefix | Slot | Kinds | Contract |
| --- | --- | --- | --- |
| `class.<class>` | vanguard, ranger, pyromancer, tinkerer, hexblade | spritesheet, sprites, placeholder | 16x24 cells, pivot (8, 23); idle 4, run 6, roll 4, hit 2, death 6; facings down/up/left/right (`sprites`: idle, run, roll, hit, death, >= 1 frame each) |
| `enemy.<archetype>` | swarmer, sprayer, sniper, bruiser, caster, summoner | spritesheet, sprites, placeholder | 16x16, pivot (8, 15); idle 4, move 4, attack 4, hit 2, death 4; 4 facings (`sprites`: idle, move, attack, hit, death) |
| `boss.<n>` | boss.1 .. boss.5 (+ `boss.act1`) | spritesheet, sprites, placeholder | 48x48, pivot (24, 47); idle 4, move 4, attack 6, hit 2, death 8; no facings (`sprites`: as enemies) |
| `bullet.enemy.*`, `bullet.player.*` | small, medium, large, needle / basic, heavy | spritesheet, placeholder | 8x8, pivot (4, 4); fly 2 |
| `tile.biome.<n>.<floor\|wall>` | biome tiles | image, placeholder | 16x16; with `tilesPerImage` any size up to 1024x1024 |
| `item.*` | loot icons | image, placeholder | 16x16 |
| `ui.*` | cursor, panel, icons | image, placeholder | free size |
| `ui.font.digits` | pixel digit font | image, placeholder | `DIGIT_FONT`: glyphs `0123456789+-CAP!`, 5x7 cells; strip 80x7 |
| `sfx.*`, `music.*` | audio events | sound, silent | play through SoundGroup `sfx` / `music` |

Directional animations are named `<anim>.<facing>` and take one sheet row each. Full required lists:
`REQUIRED_ASSET_IDS`, `REQUIRED_STRING_KEYS`, `AUDIO_EVENTS` in `contract.ts`.

## Manifest format (`packs/<id>/manifest.ts`)

```ts
export const MY_MANIFEST: ThemeManifest = {
	format: 1,
	id: "my-pack",                  // must match the key in THEME_PACKS
	name: "My Pack",
	version: "0.1.0",
	colors: { enemyBullet: "#ff3fa4", /* every COLOR_ROLES entry, "#rrggbb" */ },
	biomes: { "biome.1": { name: "biome.1.name", floor: "#2b2722", wall: "#36302a",
	                       tiles: { floor: "tile.biome.1.floor", wall: "tile.biome.1.wall" },
	                       materials: { wall: "Brick" } } /* optional; .. biome.5 */ },
	assets: {
		"enemy.sniper": { kind: "placeholder" },
		"class.vanguard": { kind: "spritesheet", assetId: "rbxassetid://<n>", frameW: 16, frameH: 24,
		                    pivot: { x: 8, y: 23 },
		                    animations: { "idle.down": { row: 0, frames: 4, fps: 8, loop: true } /* every anim.facing */ } },
		"tile.biome.1.floor": { kind: "image", assetId: "rbxassetid://<n>", w: 16, h: 16 },
		"sfx.ember": { kind: "sound", assetId: "rbxassetid://<n>", volume: 0.8 },
		"music.boss": { kind: "silent" },
	},
	strings: { "game.title": "Project Kaleb-Vale", "hud.level": "Lv {level}" },
	locales: { fr: { "hud.level": "Niv. {level}" } },   // optional, partial
};
```

Kinds: `image` (assetId, w, h, tile-only `tilesPerImage`, ui-only `pivot` inside the image), `spritesheet` (assetId, frameW, frameH, pivot,
animations `{ row, frames, fps, loop }`), `sprites` (below), `sound` (assetId, volume 0..1), `silent`,
`placeholder`. `assetId` must be `rbxassetid://<digits>` (local `rbxasset://` content and bare numbers are
rejected). `fps` is presentation only. Unknown keys are rejected in every kind.

### Sprite sets: the `sprites` kind (contract v2)

Pre-rendered directional art (docs/ART.md task S2) does not fit the 16 px contract: a knight in 128 px cells with 8
facings and 15 frames, spread over several 1024 px atlases. The class / enemy / boss slots accept a `sprites` asset
(`SpriteSetAsset` in `types.ts`) next to `spritesheet`; the slot's cell size, pivot, facings and exact frame counts do
not apply to it, each set carries its own. It is **additive**: `MANIFEST_FORMAT` stays 1, and every existing kind keeps
its exact checks. Atlases are normally written by the atlas pipeline (S3), not by hand.

```ts
"enemy.swarmer": {
	kind: "sprites",
	frameW: 64, frameH: 56,           // one cell, pixels (integers 1..1024)
	pivot: { x: 32, y: 48 },          // the feet, pixels from the cell's top-left; inside the cell
	pixelsPerTile: 32,                // texel density: the billboard is frameW / pixelsPerTile tiles wide
	resample: "Default",              // ImageLabel ResampleMode: "Default" (pre-rendered art) | "Pixelated"
	facings: { count: 8, zeroDeg: 0, ccw: true },
	sheets: [                         // the atlases, each <= 1024x1024 and at least one cell
		{ assetId: "rbxassetid://<n>", w: 1024, h: 448 },
		{ assetId: "rbxassetid://<n>", w: 256, h: 112 },
	],
	animations: {                     // base names; the slot's names are required, extras ("attack.1") allowed
		move:  { sheet: 0, start: 0,  frames: 8, fps: 10, loop: true },
		death: { sheet: 0, start: 64, frames: 8, fps: 10, loop: false },
		idle:  { sheet: 0, start: 0,  frames: 1, stride: 8, fps: 1, loop: true },  // move's frame 0, held
		attack: { sheet: 0, start: 0, frames: 8, fps: 12, loop: true },
		hit:   { sheet: 1, start: 0,  frames: 1, fps: 8, loop: false },
	},
},
```

**Cells.** In sheet `sheets[a.sheet]` cells are numbered row-major from the top-left, `floor(w / frameW)` per row;
the sheet holds `floor(w / frameW) * floor(h / frameH)` cells. Frame `f` of facing `d` of animation `a` is cell

    cell = a.start + d * (a.stride ?? a.frames) + f

so by default an animation is `count` runs of `frames` cells, one run per facing. `stride` (>= 1) lets a 1-frame
stand-in reuse frame 0 of every facing of a longer animation (`idle` above). The validator checks every referenced
cell, all facings and all frames, against the sheet's capacity.

**Facings** are in screen space: facing `d` points at `zeroDeg + d * 360 / count` degrees, counter-clockwise when
`ccw`, where 0 = screen right and 90 = screen up. `count` is 1 (not directional), 4, 8 or 16. The atlas pipeline
always writes `zeroDeg: 0, ccw: true`.

**Checks** (`validate.ts`): `frameW` / `frameH` integers in [1, 1024]; `pivot` inside the cell; `pixelsPerTile` > 0;
`resample` "Default" | "Pixelated"; `facings.count` 1 | 4 | 8 | 16, `zeroDeg` finite, `ccw` boolean; `sheets`
non-empty, each `rbxassetid://<digits>`, `w` / `h` integers in [1, 1024] and at least the cell; the slot's base
animations present; every animation's `sheet` a valid index, `start` >= 0, `frames` >= 1, `stride` >= 1 (optional),
`fps` in (0, 60], `loop` boolean, and every cell inside its sheet. Animation names are IDs (exempt from the
gameplay-key scan); a gameplay key anywhere else in the set (`hitbox`, `duration`, ...) is still rejected. Timings
that drive one-shots (roll, hit, death) stay in gameplay data; the renderer stretches the animation to them.

**Runtime guard.** A pack that fails validation still loads, so `ThemeCore.sprites` re-checks what the renderer
relies on: a bad cell, pivot, `pixelsPerTile`, `resample`, facings or sheet rejects the set (warned once with the
reason; the placeholder is drawn); a bad optional animation (fields, fps, `stride < frames`, cells outside the sheet)
is dropped and warned once; a bad or missing required animation rejects the set. The validator also rejects a
`stride` smaller than `frames` when there are several facings (they would share cells).

**Runtime.** `pack.sprites(id)` (cached) returns a `SpriteSet`, or `undefined` for any other kind (no warning; draw
`pack.placeholder(id)`), and warns once for a missing ID. For a `sprites` asset `texture(id)` is `undefined` and
`spriteSheet(id)` is the placeholder layout (`assetId` undefined), so code that only knows sheets keeps drawing
placeholders.

| `SpriteSet` member | What |
| --- | --- |
| `id`, `frameW`, `frameH`, `pivot`, `pixelsPerTile`, `resample`, `facings`, `sheets` | the manifest's layout (readonly) |
| `animationNames` | animation names, sorted |
| `has(anim)` / `animation(anim)` | exact-name lookup; `SpriteAnimationDef \| undefined`, no warning |
| `frame(anim, facing, index)` | `{ image, offset: Vector2, size: Vector2 }`: the sheet's asset ID and its ImageRect (pixels, top-left) |
| `layout` | the headless `SpriteSetLayout` (`pack.core.sprites(id)`), whose `frame` returns `{ sheet, assetId, x, y, w, h }` |

`facing` wraps modulo `facings.count`, negative too (`-1` is the last facing); `index` wraps when the animation loops
and holds the last frame otherwise (`frameIndex`). An unknown `anim` warns once and plays `idle`, or the first name
when the set has no `idle`.

### Repeating tile images (`tilesPerImage`)

A `tile.*` image may carry `tilesPerImage` (> 0): it is then a repeating floor / wall texture spanning that many
world tiles per side, and its size is free (integers in [1, 1024]) instead of 16x16. Without it the 16x16 check
stays. `tilesPerImage` on any other slot is an error.

### Biome materials (`materials`, docs/DECOR.md R1)

A biome may name the Roblox built-in material of its floor slabs, wall blocks and sunken pools:

```ts
"biome.2": { name: "biome.2.name", floor: "#2a1a16", wall: "#4a2a20", tiles: { /* ... */ },
             materials: { floor: "Basalt", wall: "Rock", pool: "CrackedLava" } },
```

- **Optional, per surface.** `materials` and each of `floor` / `wall` / `pool` may be left out; a missing one is
  `DEFAULT_BIOME_MATERIAL` (SmoothPlastic, what every surface was drawn in before), so a pack without the field (the
  placeholder pack) draws exactly as before. WorldController maps each name through `Enum.Material[name]`.
- **Allow-list.** Names must be in `BIOME_MATERIALS` (`contract.ts`): SmoothPlastic, Slate, Brick, Cobblestone,
  Basalt, Limestone, Granite, Rock, Pavement, Concrete, Sandstone, CrackedLava, Ice, Glacier, Snow, Grass,
  LeafyGrass, Mud, Ground, Glass. **Neon is not allowed**: it is the bullets' material, and a glowing floor, wall or
  pool would compete with them. The validator rejects an unknown surface key, an unknown name and a non-string.
- **Textured floors stay SmoothPlastic.** When the biome's floor tile is a repeating image (`tilesPerImage`), the
  floor material must be SmoothPlastic (or absent): any other material draws its own pattern under the image and
  fights it. The validator rejects it; WorldController also forces SmoothPlastic under a texture. Walls and pools are
  not textured, so they are free.
- **Contrast describes the base colour only.** `Part.Color` stays the biome hex; a material adds a texture and some
  brightness variation on top (lighter grain, darker cracks, specular highlights on Ice / Glass). The contrast checks
  (enemy bullets vs every floor and wall, damage numbers vs every floor) still run on the hex, so they describe the
  Part's base colour, not every texel. Check busy or shiny materials in Studio against bullets and damage numbers.
- **Pools** are coloured by the Dungeon Forge theme's liquid (no colour role yet); `materials.pool` only sets their
  material.

## Replacing assets later

1. **Make the art to the contract.** Sprite sheets: a grid of equal cells at the slot's cell size (16x24 classes,
   16x16 enemies, 48x48 bosses, 8x8 bullets, 16x16 tiles/items), one animation per row, frames left to right,
   with exactly the contract's frame count per animation; directional slots need every `<anim>.<facing>` row.
   Pivots are fixed per slot (feet: (8, 23), (8, 15), (24, 47); bullets centred). The digit font is one 80x7 strip.
2. **Upload** each file: with Asphalt (`asphalt sync`; point its generated ID file inside `src/shared/theme/`,
   the only folder allowed to hold asset IDs) or in Studio via the Asset Manager (Bulk Import), then copy each
   asset's `rbxassetid://<n>`.
3. **Paste into the manifest** (`packs/placeholder/manifest.ts`, or a new pack registered in `packs/index.ts`):
   change the entry from `{ kind: "placeholder" }` / `{ kind: "silent" }` to `image` / `spritesheet` / `sound`
   with the `assetId` and layout. Nothing else changes: code keeps asking for the same logical ID.
4. **Run `npm run verify`.** The validator (in `pack.spec.ts` / `validate.spec.ts`) reports every contract
   break, malformed asset ID, gameplay key and failed contrast check; `check-asset-ids` fails if an ID leaked
   into code outside this folder.
5. Sounds play through the SoundGroups named by `sound(id).group` (`SoundService.sfx` / `SoundService.music`), so
   mixing is per group, not per sound. Sprites render through BillboardGui ImageLabels with
   `ResampleMode = Pixelated` and the frame's `ImageRectOffset` / `ImageRectSize`.

Colour roles can be retuned in the same manifest; the contrast checks keep enemy bullets and damage numbers
readable on every biome.

## Files

| File | What |
| --- | --- |
| `types.ts` | manifest and asset types (incl. `SpriteSetAsset`), `COLOR_ROLES` |
| `contract.ts` | sprite contract (v2: `requiredBaseAnimations`, `MAX_IMAGE_SIDE`, `SPRITE_FACING_COUNTS`, `SPRITE_RESAMPLE_MODES`), biome materials (`BIOME_MATERIALS`, `BIOME_MATERIAL_SURFACES`, `DEFAULT_BIOME_MATERIAL`), slots, SoundGroups, required IDs/strings, contrast thresholds, gameplay key words |
| `color.ts`, `strings.ts` | WCAG contrast and hex parsing; `{name}` interpolation |
| `validate.ts` | `validateManifest`, `contrastReport`, `juiceContrastReport`, `isGameplayKey` |
| `placeholders.ts` | `PLACEHOLDER_VISUALS`, `TELEGRAPH_VISUAL`, `PLACEHOLDER_PROPORTIONS`, `missingVisual` |
| `core.ts` | `ThemeCore` (pure lookups and fallbacks), frame math, `SpriteSetLayout` |
| `pack.ts` | `ThemePack` (Color3 / Vector2, `SpriteSet`), `loadThemePack`, the active pack |
| `packs/` | `THEME_PACKS`; `placeholder/manifest.ts` (every visual a placeholder, every sound silent) |
| `util.ts` | Luau stand-ins for JSON / ordered keys (sorted iteration keeps messages deterministic) |
| `*.spec.ts` | headless specs; `requested-ids.spec.ts` lists every ID the web build's code requests |
