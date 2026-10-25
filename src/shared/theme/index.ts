/**
 * Barrel for the theme layer (PLAN.md task 3): logical asset IDs, color roles, sprite contracts,
 * the string table, the validator, placeholder visuals and the packs. Gameplay and presentation
 * code import from "shared/theme" and use logical IDs only. The only place an `rbxassetid://`
 * may appear (scripts/check-asset-ids.js enforces it).
 */
export * from "./types";
export * from "./contract";
export { contrastRatio, isHexColor, parseHex, relativeLuminance, toHex, type Rgb } from "./color";
export { interpolate, placeholders, templateProblem, type StringVars } from "./strings";
export {
	ASSET_ID_PATTERN,
	contrastReport,
	isAssetId,
	isGameplayKey,
	isStringKey,
	juiceContrastReport,
	validateManifest,
	type ContrastEntry,
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
	type BiomeTheme,
	type FrameUV,
	type ImageRef,
	type PixelRect,
	type SheetLayout,
	type SoundRef,
	type SpriteFrameRect,
	type SpriteSetLayout,
	type ThemeCoreOptions,
} from "./core";
export {
	ThemePack,
	getActiveThemePack,
	hexToColor3,
	listThemePacks,
	loadThemePack,
	setActiveThemePack,
	type BiomeColors,
	type FrameRect,
	type LoadOptions,
	type SpriteFrame,
	type SpriteSet,
	type SpriteSheet,
	type ThemePackOptions,
} from "./pack";
export { THEME_PACKS } from "./packs";
export { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
