/**
 * Hand-rolled runtime validator for theme pack manifests. Returns readable errors; an empty list
 * means the pack is good. Checks: shape, required slots/IDs/strings, the sprite contract,
 * no gameplay values, string references, and contrast (enemy bullets on every biome floor and
 * wall, juice colours).
 *
 * Ported from the web build's `src/theme/validate.ts` @ 42897e2. Every check and message is kept;
 * file checks (`src`, extensions, files shipped with the pack) become Roblox asset-ID checks
 * (`assetId` must be "rbxassetid://<digits>"), and the `generated` kind's shape/colour/facing
 * checks are gone with the kind (`placeholder` carries no data). Keys are visited in sorted order,
 * so messages come out in a stable order.
 *
 * Roblox port (docs/DECOR.md R2, D4): the decor slot (`decor.*`: ID grammar, layers per kind, world-art fields,
 * ambient particle caps), the breakable slot (`breakable.*`), decor fx colour roles kept away from the enemy-bullet
 * roles (CIE76 colour difference) and enemy bullets readable on breakables (WCAG contrast).
 *
 * Roblox port (enemy outline plan O1): the `enemyOutline` rim readable on every biome floor and wall (WCAG contrast)
 * and kept away from the enemy-bullet roles (CIE76), `enemyOutlineReport`.
 *
 * Roblox port (player outline, step 1): the `playerOutline` rim readable on every biome floor and wall (WCAG contrast)
 * and kept away from the threat and boost colours (PLAYER_OUTLINE_DIFFERENCE_ROLES, CIE76), `playerOutlineReport`.
 *
 * Roblox port (docs/FX_AUDIO.md A2, F1): sound `variants` / `pitch` / `minInterval`, the ambience slot (`amb.b<n>`),
 * the fx slot (`fx.*`: one-facing sprite sets, `sizeTiles` cap, `tint` roles) and effect colours (FX_ROLES, tints and
 * untinted `meanColor`s) kept away from the enemy-bullet roles (`fxColorReport`).
 *
 * Roblox port (docs/BOOSTS.md B5): the boost slot (`boost.<kind>`, free-size world art; any other `boost.` ID is an
 * error) and the boost colour roles readable on every biome floor and wall and kept away from the enemy-bullet roles,
 * `boostColorReport` (the enemy outline's rules, per BOOST_ROLES colour). docs/BOOST_ART.md BA-P2: a pack whose
 * `boost.<kind>` is art (image / sprites) must also have `decor.fx.glow` art, the drop's halo (BOOST_HALO_FX).
 *
 * Roblox port (docs/ROOM_EDGES.md RE4): the room-edge colour roles, waiting and live readable on every biome floor
 * (WCAG contrast) and all three kept away from the enemy-bullet roles and telegraph (CIE76), `roomEdgeReport`.
 *
 * Roblox port (docs/MINIMAP.md M6): the minimap colour roles, the markers readable on `minimap.floor` and `uiPanel`
 * (WCAG contrast) and `minimap.enemy` kept away from `minimap.self`, `minimap.boost` and every `class.*` role (CIE76),
 * `minimapReport`.
 *
 * Roblox port (docs/COMBO.md CB3): the combo colour roles, every tier (ember and the four named tiers) readable on
 * `uiPanel` and apart from the tier below it, the named tiers kept away from the enemy-bullet roles and telegraph (the
 * floor shout lies under bullets) and `combo.broken` a low-chroma grey apart from every tier (COMBO_COLOR_RULES),
 * `comboReport`.
 *
 * Roblox port (docs/GRAZE_PARRY.md GP3): the near-miss colour roles (graze spark, parry sparks and PARRY! text) readable
 * on every biome floor (WCAG contrast) and kept away from the enemy-bullet roles and telegraph (CIE76)
 * (NEAR_MISS_COLOR_RULES), `nearMissReport`.
 * Roblox port (docs/DRAFT_REVEAL.md DR3): the boon rarity colour roles readable on `uiPanel` and apart from the rarity
 * below them (BOON_RARITY_COLOR_RULES), `boonRarityReport`; ui images may carry a 9-slice `slice` inside the image.
 * Roblox port (docs/UI_ART.md UA4): ui images may carry a `rect` (an icon atlas cut) inside the image, the pivot then
 * inside the rect; a sliced ui image takes no rect.
 *
 * Roblox port (docs/ENEMY_VARIANTS.md EV1): the affix rings / shield segment and the goo puddles (variantColors.ts
 * `affixReport` / `gooReport`, through `variantColorProblems`). That module holds the rules and the reports because
 * this one's compiled Luau sits at Luau's 200-locals-per-function limit: one import here, offset by dropping the old
 * MAX_FPS alias of MAX_ANIMATION_FPS.
 *
 * Roblox port (docs/NEW_BEST.md NB4): the new-best gold (newBestColors.ts `newBestReport`, through
 * `newBestColorProblems`), in its own module for the same reason (offset by moving minimapReport's two role constants
 * inside it).
 *
 * Roblox port (docs/VOID_DECOR.md VD1, VD7): every biome's required `shoulder` / `abyss` colours (voidColors.ts
 * `voidReport`, through `voidColorProblems`; offset by inlining the boost ID list and reading a decor piece's layers
 * from `parseDecorId` instead of importing DECOR_KIND_LAYERS) and the optional `decor.void.b<n>.<kind>[.<v>]` pieces.
 *
 * Roblox port (docs/PROJECTILE_ART.md PA3): bullets may be one-facing `sprites` sets with a `meanColor`; their rules
 * (bulletArt.ts `bulletArtReport`) run through `variantColorProblems`, so this module takes no new name.
 *
 * @module
 */
export {
	ASSET_ID_PATTERN,
	isAssetId,
	isStringKey,
	isGameplayKey,
	type ValidateOptions,
	type ContrastEntry,
} from "./helpers";
export {
	contrastReport,
	juiceContrastReport,
	decorFxReport,
	fxColorReport,
	breakableContrastReport,
	enemyOutlineReport,
	playerOutlineReport,
	boostColorReport,
	roomEdgeReport,
	minimapReport,
	comboReport,
	nearMissReport,
	boonRarityReport,
	type JuiceContrastEntry,
	type DecorFxEntry,
	type FxColorEntry,
	type BreakableContrastEntry,
	type EnemyOutlineEntry,
	type PlayerOutlineEntry,
	type BoostColorEntry,
	type RoomEdgeEntry,
	type MinimapEntry,
	type ComboEntry,
	type NearMissEntry,
	type BoonRarityEntry,
} from "./reports";
export { validateManifest } from "./manifest";
