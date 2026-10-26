/**
 * Barrel for the theme layer (PLAN.md task 3): logical asset IDs, color roles, sprite contracts,
 * the string table, the validator, placeholder visuals and the packs. Gameplay and presentation
 * code import from "shared/theme" and use logical IDs only. The only place an `rbxassetid://`
 * may appear (scripts/check-asset-ids.js enforces it).
 */
export * from "./types";
export * from "./contract";
export {
	colorDifference,
	contrastRatio,
	isHexColor,
	parseHex,
	relativeLuminance,
	toHex,
	toLab,
	type Lab,
	type Rgb,
} from "./color";
export { interpolate, placeholders, templateProblem, type StringVars } from "./strings";
export {
	ASSET_ID_PATTERN,
	breakableContrastReport,
	contrastReport,
	decorFxReport,
	enemyOutlineReport,
	isAssetId,
	isGameplayKey,
	isStringKey,
	juiceContrastReport,
	validateManifest,
	type BreakableContrastEntry,
	type ContrastEntry,
	type DecorFxEntry,
	type EnemyOutlineEntry,
	type JuiceContrastEntry,
	type ValidateOptions,
} from "./validate";
export * from "./placeholders";
export {
	DEFAULT_PACK_ID,
	MISSING_COLOR,
	ThemeCore,
	frameIndex,
	frameRect,
	frameUV,
	uvToPixelRect,
	type AmbientParticleArt,
	type BiomeTheme,
	type BreakableTheme,
	type DecorArt,
	type FrameUV,
	type ImageRef,
	type PixelRect,
	type SheetLayout,
	type SoundRef,
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
	type Breakable,
	type DecorPiece,
	type FrameRect,
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
