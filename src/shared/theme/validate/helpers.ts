/**
 * The validator's shared predicates, patterns and path formatting (docs/CODEBASE_SCALE.md DX8: a pure move out of validate.ts). Import the validator from "shared/theme" or "./validate", never from this file.
 *
 * @module
 */
import { contains, isInteger, matches, quote as q, type Obj } from "../util";
import { BIOME_MATERIALS, GAMEPLAY_KEY_WORDS, MAX_IMAGE_SIDE } from "../contract";
import { COLOR_ROLES } from "../types";

/**
 * Options of `validateManifest`. `loadThemePack` and the pack specs pass the pack's folder name so a manifest whose
 * `id` differs is reported.
 */
export interface ValidateOptions {
	/** Expected manifest id (the pack's folder name). */
	packId?: string;
}

/** Roblox content IDs a manifest may use: uploaded assets only. */
export const ASSET_ID_PATTERN = "^rbxassetid://%d+$";
const ASSET_SEGMENT = "^[a-z0-9]+$";
const STRING_KEY_FIRST = "^[a-z0-9]+$";
const STRING_KEY_SEGMENT = "^[a-zA-Z0-9]+$";
/**
 * Lua pattern a manifest's `id` must match: lowercase letters and digits, with hyphens allowed after the first
 * character ("placeholder", "my-pack").
 */
export const PACK_ID_PATTERN = "^[a-z0-9][a-z0-9%-]*$";
const LOCALE_PATTERNS = ["^[a-z][a-z][a-z]?$", "^[a-z][a-z][a-z]?%-[A-Z][A-Z]$"];
const IDENT_PATTERN = "^[%a_][%w_]*$";
const INDEX_PATTERN = "^%d+$";

/** Asset IDs: lowercase dot-separated segments, at least two (`enemy.sniper`, `bullet.enemy.small`). */
export function isAssetId(id: string): boolean {
	const segs = id.split(".");
	return segs.size() >= 2 && segs.every((s) => matches(s, ASSET_SEGMENT));
}

/** String keys: dot-separated, segments may be camelCase (`hud.health`, `act.endgame.name`). */
export function isStringKey(key: string): boolean {
	const segs = key.split(".");
	return segs.every((s, i) => matches(s, i === 0 ? STRING_KEY_FIRST : STRING_KEY_SEGMENT));
}

/**
 * True for a locale code the manifest's `locales` table may be keyed by: two or three lowercase letters, optionally
 * followed by a hyphen and two uppercase letters ("fr", "pt-BR").
 */
export function isLocale(code: string): boolean {
	return LOCALE_PATTERNS.some((p) => matches(code, p));
}

/** True for an integer >= 1 (frame counts, cell sizes). */
export const isPosInt = (v: unknown): v is number => isInteger(v) && v > 0;
/** True for an integer >= 0 (cell indices, 9-slice insets). */
export const isNonNegInt = (v: unknown): v is number => isInteger(v) && v >= 0;
/** True for any number but NaN and the infinities (fractions allowed). */
export const isFiniteNumber = (v: unknown): v is number =>
	typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
/** A pixel size Roblox can store: an integer in [1, MAX_IMAGE_SIDE]. */
export const isImageSide = (v: unknown): v is number => isPosInt(v) && v <= MAX_IMAGE_SIDE;
/**
 * The validator's message for a pixel size that fails `isImageSide`, shared so every image and cell field words it the
 * same way.
 */
export const IMAGE_SIDE_MSG = `must be an integer in [1, ${MAX_IMAGE_SIDE}]`;
/** COLOR_ROLES as a set, for testing whether a manifest's colour key or an asset's `tint` names a known role. */
export const COLOR_ROLE_SET: ReadonlySet<string> = new Set<string>(COLOR_ROLES);
/** A number with one decimal, for the bars in validator messages ("needs >= 4.5:1"). */
export const fixed1 = (n: number) => "%.1f".format(n);
/** A number with two decimals, for the measured ratios and sizes in validator messages. */
export const fixed2 = (n: number) => "%.2f".format(n);
/** BIOME_MATERIALS as a set, for testing a biome's material names. */
export const BIOME_MATERIAL_SET: ReadonlySet<string> = new Set<string>(BIOME_MATERIALS);
/** BIOME_MATERIALS joined with commas: the "allowed" list in the unknown-material message. */
export const BIOME_MATERIAL_LIST = BIOME_MATERIALS.join(", ");

/** Split a key into lowercase words: "bulletSpeed" -> ["bullet", "speed"], "hit_box" -> ["hit", "box"]. */
function words(key: string): Array<string> {
	const [spaced] = key.gsub("([a-z0-9])([A-Z])", "%1 %2");
	const out = new Array<string>();
	for (const [w] of spaced.gmatch("[%w]+")) {
		out.push((w as string).lower());
	}
	return out;
}

const GAMEPLAY_WORDS: ReadonlySet<string> = new Set<string>(GAMEPLAY_KEY_WORDS);
/** Words caught even when glued into a longer key ("bulletspeed", "hitboxes"). */
const GAMEPLAY_SUBSTRINGS = ["hitbox", "hurtbox", "damage", "cooldown", "velocity", "radius", "speed", "knockback"];

/** True if a manifest key looks like gameplay data (hitbox, speed, damage, radius, cooldown, ...). */
export function isGameplayKey(key: string): boolean {
	const lower = key.lower();
	return words(key).some((w) => GAMEPLAY_WORDS.has(w)) || GAMEPLAY_SUBSTRINGS.some((s) => contains(lower, s));
}

/** Object paths whose keys are logical IDs/names rather than data fields (exempt from the gameplay-key scan). */
export function keysAreIds(path: ReadonlyArray<string>): boolean {
	const top = path[0];
	if (path.size() === 1) {
		return ["colors", "biomes", "assets", "strings", "locales"].includes(top);
	}
	if (top === "locales" && path.size() === 2) {
		return true;
	}
	if (top === "assets" && path.size() === 3 && path[2] === "animations") {
		return true;
	}
	return false;
}

/**
 * A manifest path as the validator prints it before each message: identifier segments joined with dots, all-digit
 * segments as `[3]`, anything else quoted (`assets["enemy.sniper"].frameW`). The empty path is "(root)".
 */
export function fmtPath(path: ReadonlyArray<string>): string {
	if (path.size() === 0) {
		return "(root)";
	}
	return path
		.map((p, i) => {
			if (matches(p, IDENT_PATTERN)) {
				return i > 0 ? `.${p}` : p;
			}
			return matches(p, INDEX_PATTERN) ? `[${p}]` : `[${q(p)}]`;
		})
		.join("");
}

/** WCAG contrast of enemyBullet against each biome's floor and wall. */
export interface ContrastEntry {
	biome: string;
	surface: "floor" | "wall";
	color: string;
	ratio: number;
	ok: boolean;
}

/**
 * The validator's error sink, handed to every check: records one problem at a manifest path (object keys from the root,
 * array indices as digit strings). `validateManifest` formats it as "<path>: <msg>".
 */
export type Err = (path: ReadonlyArray<string>, msg: string) => void;
/**
 * The validator's unknown-key check, handed to every check: reports each key of `obj` (found at `path`) that is not in
 * `allowed`, in sorted key order. Keys that look like gameplay data are skipped here, because the gameplay scan reports
 * them with its own message.
 */
export type UnknownKeys = (obj: Obj, path: ReadonlyArray<string>, allowed: ReadonlyArray<string>) => void;
