/**
 * Barrel for the theme layer (PLAN.md task 3): logical asset IDs, color roles, sprite contracts,
 * the string table, the validator, placeholder visuals and the packs. Gameplay and presentation
 * code import from "shared/theme" and use logical IDs only. The only place an `rbxassetid://`
 * may appear (scripts/check-asset-ids.js enforces it).
 */
export * from "./types";
export * from "./contract";
export {
	channelToByte,
	colorDifference,
	contrastRatio,
	dimHex,
	isHexColor,
	labChroma,
	mixChannel,
	mixRgb,
	parseHex,
	relativeLuminance,
	toHex,
	toLab,
	type Lab,
	type Rgb,
} from "./color";
export { interpolate, placeholderMismatch, placeholders, templateProblem, type StringVars } from "./strings";
export {
	CASED_SCRIPTS,
	LOWERCASE_RANGES,
	breaksAllCaps,
	hasLowercase,
	isAllCaps,
	isLowercaseCodepoint,
	isValidUtf8,
	localeTextProblems,
	validateLocaleTable,
	type LocaleTableProblem,
} from "./localeCheck";
export { LOCALE_TABLES } from "./locales";
export {
	ASSET_ID_PATTERN,
	boonRarityReport,
	boostColorReport,
	breakableContrastReport,
	comboReport,
	contrastReport,
	decorFxReport,
	enemyOutlineReport,
	fxColorReport,
	isAssetId,
	isGameplayKey,
	isStringKey,
	juiceContrastReport,
	minimapReport,
	nearMissReport,
	playerOutlineReport,
	roomEdgeReport,
	validateManifest,
	type BoonRarityEntry,
	type BoostColorEntry,
	type BreakableContrastEntry,
	type ComboEntry,
	type ContrastEntry,
	type DecorFxEntry,
	type EnemyOutlineEntry,
	type FxColorEntry,
	type JuiceContrastEntry,
	type MinimapEntry,
	type NearMissEntry,
	type PlayerOutlineEntry,
	type RoomEdgeEntry,
	type ValidateOptions,
} from "./validate";
export * from "./variants";
export { BOON_ICON_PREFIX, boonIconId } from "./boonIcons";
export { DUO_ICON_PREFIX, duoIconId } from "./duoIcons";
export { CURSE_ICON_PREFIX, RELIC_ICON_PREFIX, curseIconId, relicIconId } from "./itemIcons";
export { BOOST_ICON_PREFIX, boostIconId } from "./boostIcons";
export { PIP_ICON_IDS, PIP_ICON_PREFIX } from "./pipIcons";
export {
	CURSOR_IMAGE_IDS,
	CURSOR_STATES,
	cursorArt,
	cursorArtProblems,
	cursorOptionalIds,
	type CursorArt,
	type CursorArtProblem,
	type CursorImageSource,
	type CursorState,
	type CursorStateArt,
} from "./cursorArt";
export {
	CHARACTER_ICON_PREFIX,
	CHARACTER_OVERRIDE_KEYS,
	CHARACTER_SCREEN_STRINGS,
	CHARACTER_SUMMARY_LINES,
	THEME_CHARACTER_IDS,
	characterIconId,
	characterLineKey,
	characterOverrideKey,
	characterStringKeys,
} from "./characters";
export {
	AFFIX_COLOR_RULES,
	AURA_COLOR_RULES,
	GOO_COLOR_RULES,
	GUARD_COLOR_RULES,
	affixReport,
	auraReport,
	gooReport,
	guardReport,
	variantColorProblems,
	type AffixEntry,
	type AuraEntry,
	type GooEntry,
	type GuardEntry,
	type VariantColorEntry,
	type VariantColorProblem,
	type VariantColorRules,
} from "./variantColors";
export * from "./daily";
export * from "./newBest";
export * from "./roster";
export * from "./dailyRank";
export {
	NEW_BEST_COLOR_RULES,
	newBestColorProblems,
	newBestReport,
	type NewBestColorProblem,
	type NewBestColorRules,
	type NewBestEntry,
} from "./newBestColors";
export {
	VOID_COLORS,
	VOID_CONTRAST,
	voidColorProblems,
	voidLedgeColor,
	voidReport,
	type VoidColorProblem,
	type VoidContrastRules,
	type VoidEntry,
} from "./voidColors";
export * from "./builds";
export {
	BUILD_COLOR_RULES,
	buildReport,
	floorAndDifferenceReport,
	type BuildColorEntry,
	type BuildColorRules,
} from "./buildColors";
// Roblox port (docs/PELLETS.md PL6): the pellet kinds, roles, sounds and strings, and their colour rules.
export * from "./pellets";
export {
	MIN_PELLET_BOOST_DIFFERENCE,
	PELLET_BOOST_COLOR_RULES,
	PELLET_COLOR_RULES,
	pelletReport,
	type PelletColorEntry,
	type PelletColorRules,
} from "./pelletColors";
// Roblox port (docs/GAMEPAD_MENUS.md GM7 / GM9): the gamepad menus' hint bar and vibration row strings.
export * from "./padHints";
// Roblox port (docs/RUN_RECAP.md RR3 / CM3 / CM4): the run-over recap's and the co-op moments' strings and sounds.
export * from "./runRecap";
// Roblox port (docs/TREASURE.md TR6): the vault's chest IDs, tier roles, sounds and strings, and their colour rules.
export * from "./treasure";
export {
	TREASURE_COLOR_RULES,
	treasureReport,
	type TreasureColorEntry,
	type TreasureColorRules,
} from "./treasureColors";
// Roblox port (docs/FORTUNE.md FO6): Fortune's altar, roles, sounds, strings and coin effect, and their colour rules.
export * from "./fortune";
export {
	FORTUNE_COIN_PELLET_RULES,
	FORTUNE_COLOR_RULES,
	GOLDEN_ENEMY_COLOR_RULES,
	MIN_GOLDEN_COIN_PELLET_DIFFERENCE,
	fortuneReport,
	type FortuneColorEntry,
	type FortuneColorRules,
} from "./fortuneColors";
// Roblox port (docs/FLOOR_MODIFIERS.md FM7): the floor modifiers' strings, roles, stings and icon ids, and their colour
// rules.
export * from "./floorModifiers";
export {
	FLOOR_MODIFIER_COLOR_RULES,
	MIN_FLOOR_MODIFIER_TWIST_DIFFERENCE,
	floorModifierReport,
	type FloorModifierColorEntry,
	type FloorModifierColorRules,
} from "./floorModifierColors";
// Roblox port (claude/codex-plan.md CX5): the Codex's strings, key helpers and its one sound.
export * from "./codex";
// Roblox port (docs/SECRET_ROOMS.md SR10): the secret rooms' strings, sounds, dust role and optional art ids, their
// colour report and the art's facing rule.
export * from "./secrets";
export * from "./newEnemies2";
export { SECRET_COLOR_RULES, secretReport, type SecretColorEntry, type SecretColorRules } from "./secretColors";
export { secretArtProblems, type SecretArtProblem } from "./secretArt";
// Roblox port (docs/PROJECTILE_ART.md PA3): the bullet sprite rules.
export { bulletArtProblems, bulletArtReport, type BulletArtEntry, type BulletArtProblem } from "./bulletArt";
export { GOO_ART_RULES, gooArtProblems, gooArtReport, type GooArtEntry, type GooArtProblem } from "./gooArt";
export {
	HAZARD_EMBER_ID,
	HAZARD_STRIKE_ID,
	hazardArtProblems,
	hazardArtReport,
	isGreyHex,
	type HazardArtEntry,
	type HazardArtProblem,
} from "./hazardArt";
export {
	BOOST_AURA_ART,
	boostAuraArtProblems,
	boostAuraKindOf,
	boostAuraRankAnimation,
	boostAuraRanksOf,
	boostAuraShapeProblems,
	type BoostAuraArtProblem,
	type BoostAuraRank,
} from "./boostAuraArt";
export * from "./placeholders";
export {
	DEFAULT_PACK_ID,
	MISSING_COLOR,
	ThemeCore,
	frameIndex,
	frameRect,
	frameUV,
	spriteSheetCell,
	spriteSheetOutline,
	uvToPixelRect,
	type AmbientParticleArt,
	type BiomeTheme,
	type BoostTheme,
	type BreakableTheme,
	type BulletArt,
	type FloorSpriteArt,
	type HazardSpriteArt,
	type PelletTheme,
	type TreasurePieceTheme,
	type PactAltarTheme,
	type DecorArt,
	type FrameUV,
	type FxArt,
	type FxRankArt,
	type ImageRef,
	type LocaleReport,
	type PixelRect,
	type SheetLayout,
	type SoundRef,
	type SpriteCell,
	type SpriteFrameRect,
	type SpriteSetLayout,
	type ThemeCoreOptions,
	type WorldArt,
	type WorldImageArt,
	type WorldSpriteArt,
} from "./core";
export {
	ThemePack,
	getActiveThemePack,
	hexToColor3,
	listThemePacks,
	loadThemePack,
	setActiveThemePack,
	type AmbientParticles,
	type BiomeColors,
	type Boost,
	type Breakable,
	type BulletSprite,
	type FloorSprite,
	type HazardSprite,
	type Pellet,
	type TreasurePiece,
	type PactAltar,
	type DecorPiece,
	type FrameRect,
	type FxSprite,
	type FxSpriteRank,
	type LoadOptions,
	type SpriteFrame,
	type SpriteSet,
	type SpriteSheet,
	type ThemePackOptions,
	type WorldImage,
	type WorldSprites,
	type WorldVisual,
} from "./pack";
export { THEME_PACKS } from "./packs";
export { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
export * from "./inputKeys";
// Roblox port (docs/PROJECTILE_ART.md PA0): engine textures for the sprite-bullet spike while the pack has no art.
export { SPIKE_ENGINE_TEXTURES } from "./spikeTextures";
