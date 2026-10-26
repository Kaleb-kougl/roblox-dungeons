/**
 * Hand-rolled runtime validator for theme pack manifests. Returns readable errors; an empty list
 * means the pack is good. Checks: shape, required slots/IDs/strings, the sprite contract,
 * no gameplay values, string references, and contrast (enemy bullets on every biome floor and
 * wall, juice colours).
 *
 * Ported from project-kaleb-vale `src/theme/validate.ts` @ 42897e2. Every check and message is kept;
 * file checks (`src`, extensions, files shipped with the pack) become Roblox asset-ID checks
 * (`assetId` must be "rbxassetid://<digits>"), and the `generated` kind's shape/colour/facing
 * checks are gone with the kind (`placeholder` carries no data). Keys are visited in sorted order,
 * so messages come out in a stable order.
 *
 * Roblox port (docs/DECOR.md R2, D4): the decor slot (`decor.*`: ID grammar, layers per kind, world-art fields,
 * ambient particle caps), the breakable slot (`breakable.*`), decor fx colour roles kept away from the enemy-bullet
 * roles (CIE76 colour difference) and enemy bullets readable on breakables (WCAG contrast).
 *
 * Roblox port (docs/FX_AUDIO.md A2, F1): sound `variants` / `pitch` / `minInterval`, the ambience slot (`amb.b<n>`),
 * the fx slot (`fx.*`: one-facing sprite sets, `sizeTiles` cap, `tint` roles) and effect colours (FX_ROLES, tints and
 * untinted `meanColor`s) kept away from the enemy-bullet roles (`fxColorReport`).
 */

import { colorDifference, contrastRatio, isHexColor } from "./color";
import {
	AMBIENCE,
	AMBIENCE_IDS,
	BIOMES,
	BIOME_MATERIALS,
	BIOME_MATERIAL_SURFACES,
	BREAKABLE_ROLES,
	DAMAGE_NUMBER_ROLES,
	DECOR,
	DECOR_FX_ROLES,
	DECOR_ID_FORMS,
	DECOR_KIND_LAYERS,
	DECOR_LAYERS,
	DECOR_PARTICLE,
	ENEMY_BULLET_ROLES,
	DEFAULT_BIOME_MATERIAL,
	DIGIT_FONT,
	FX,
	FX_IDS,
	FX_ROLES,
	FX_SPRITE_MAX_TILES,
	GAMEPLAY_KEY_WORDS,
	HEALTH_BAR_FILL_ROLES,
	MAX_ANIMATION_FPS,
	MAX_IMAGE_SIDE,
	PARTICLE_FLIPBOOK_GRIDS,
	PARTICLE_FLIPBOOK_MODES,
	MIN_DAMAGE_NUMBER_CONTRAST,
	MIN_DECOR_FX_BULLET_DIFFERENCE,
	MIN_ENEMY_BULLET_CONTRAST,
	MIN_FX_BULLET_DIFFERENCE,
	MIN_HEALTH_BAR_CONTRAST,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	SOUND_PITCH_LIMITS,
	SOUND_PRESENTATION_KEYS,
	SPRITE_FACING_COUNTS,
	SPRITE_RESAMPLE_MODES,
	TILE,
	UI,
	WORLD_ART_SLOTS,
	isAmbienceId,
	isFxId,
	parseDecorId,
	requiredAnimationList,
	requiredBaseAnimations,
	slotFor,
	type DecorIdInfo,
	type SlotContract,
} from "./contract";
import { templateProblem } from "./strings";
import { BIOME_TILE_KEYS, COLOR_ROLES, MANIFEST_FORMAT } from "./types";
import {
	append,
	contains,
	describeValue,
	hasKey,
	isArrayLike,
	isInteger,
	isObj,
	matches,
	quote as q,
	sortedEntries,
	startsWith,
	type Obj,
} from "./util";

export interface ValidateOptions {
	/** Expected manifest id (the pack's folder name). */
	packId?: string;
}

/** Roblox content IDs a manifest may use: uploaded assets only. */
export const ASSET_ID_PATTERN = "^rbxassetid://%d+$";
const ASSET_SEGMENT = "^[a-z0-9]+$";
const STRING_KEY_FIRST = "^[a-z0-9]+$";
const STRING_KEY_SEGMENT = "^[a-zA-Z0-9]+$";
const PACK_ID_PATTERN = "^[a-z0-9][a-z0-9%-]*$";
const LOCALE_PATTERNS = ["^[a-z][a-z][a-z]?$", "^[a-z][a-z][a-z]?%-[A-Z][A-Z]$"];
const IDENT_PATTERN = "^[%a_][%w_]*$";
const INDEX_PATTERN = "^%d+$";
const MAX_FPS = MAX_ANIMATION_FPS;

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

function isLocale(code: string): boolean {
	return LOCALE_PATTERNS.some((p) => matches(code, p));
}

const isPosInt = (v: unknown): v is number => isInteger(v) && v > 0;
const isNonNegInt = (v: unknown): v is number => isInteger(v) && v >= 0;
const isFiniteNumber = (v: unknown): v is number =>
	typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
/** A pixel size Roblox can store: an integer in [1, MAX_IMAGE_SIDE]. */
const isImageSide = (v: unknown): v is number => isPosInt(v) && v <= MAX_IMAGE_SIDE;
const IMAGE_SIDE_MSG = `must be an integer in [1, ${MAX_IMAGE_SIDE}]`;
const COLOR_ROLE_SET: ReadonlySet<string> = new Set<string>(COLOR_ROLES);
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);
const BIOME_MATERIAL_SET: ReadonlySet<string> = new Set<string>(BIOME_MATERIALS);
const BIOME_MATERIAL_LIST = BIOME_MATERIALS.join(", ");

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
function keysAreIds(path: ReadonlyArray<string>): boolean {
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

function fmtPath(path: ReadonlyArray<string>): string {
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

const SURFACES = ["floor", "wall"] as const;

export function contrastReport(manifest: unknown): Array<ContrastEntry> {
	const out = new Array<ContrastEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors) || !isObj(manifest.biomes)) {
		return out;
	}
	const bullet = manifest.colors.enemyBullet;
	if (!isHexColor(bullet)) {
		return out;
	}
	for (const [biome, def] of sortedEntries(manifest.biomes)) {
		if (!isObj(def)) {
			continue;
		}
		for (const surface of SURFACES) {
			const color = def[surface];
			if (!isHexColor(color)) {
				continue;
			}
			const ratio = contrastRatio(bullet, color);
			out.push({ biome, surface, color, ratio, ok: ratio >= MIN_ENEMY_BULLET_CONTRAST });
		}
	}
	return out;
}

/**
 * Juice contrast checks: each HEALTH_BAR_FILL_ROLES role vs `enemyHealthBack` (>= MIN_HEALTH_BAR_CONTRAST),
 * and each DAMAGE_NUMBER_ROLES role vs every biome floor (>= MIN_DAMAGE_NUMBER_CONTRAST), one entry per biome.
 * `against` is the role or biome the colour was checked on.
 */
export interface JuiceContrastEntry {
	check: "healthBar" | "damageNumber";
	role: string;
	color: string;
	/** 'enemyHealthBack' for bars, the biome ID for numbers. */
	against: string;
	againstColor: string;
	ratio: number;
	min: number;
	ok: boolean;
}

export function juiceContrastReport(manifest: unknown): Array<JuiceContrastEntry> {
	const out = new Array<JuiceContrastEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const back = colors.enemyHealthBack;
	if (isHexColor(back)) {
		for (const role of HEALTH_BAR_FILL_ROLES) {
			const color = colors[role];
			if (!isHexColor(color)) {
				continue;
			}
			const ratio = contrastRatio(color, back);
			out.push({
				check: "healthBar",
				role,
				color,
				against: "enemyHealthBack",
				againstColor: back,
				ratio,
				min: MIN_HEALTH_BAR_CONTRAST,
				ok: ratio >= MIN_HEALTH_BAR_CONTRAST,
			});
		}
	}
	if (isObj(manifest.biomes)) {
		const biomes = sortedEntries(manifest.biomes);
		for (const role of DAMAGE_NUMBER_ROLES) {
			const color = colors[role];
			if (!isHexColor(color)) {
				continue;
			}
			for (const [biome, def] of biomes) {
				if (!isObj(def) || !isHexColor(def.floor)) {
					continue;
				}
				const ratio = contrastRatio(color, def.floor);
				out.push({
					check: "damageNumber",
					role,
					color,
					against: biome,
					againstColor: def.floor,
					ratio,
					min: MIN_DAMAGE_NUMBER_CONTRAST,
					ok: ratio >= MIN_DAMAGE_NUMBER_CONTRAST,
				});
			}
		}
	}
	return out;
}

/**
 * Decor fx colours vs enemy bullets (docs/DECOR.md Phase 2 part 2): the CIE76 difference (`colorDifference`) of each
 * DECOR_FX_ROLES colour from each ENEMY_BULLET_ROLES colour, >= MIN_DECOR_FX_BULLET_DIFFERENCE, so no flame, glow,
 * glint, stairwell ring or ambient particle can be mistaken for an enemy bullet.
 */
export interface DecorFxEntry {
	role: string;
	color: string;
	/** The enemy-bullet role it was compared with. */
	against: string;
	againstColor: string;
	difference: number;
	min: number;
	ok: boolean;
}

export function decorFxReport(manifest: unknown): Array<DecorFxEntry> {
	const out = new Array<DecorFxEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	for (const role of DECOR_FX_ROLES) {
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		for (const against of ENEMY_BULLET_ROLES) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const difference = colorDifference(color, againstColor);
			out.push({
				role,
				color,
				against,
				againstColor,
				difference,
				min: MIN_DECOR_FX_BULLET_DIFFERENCE,
				ok: difference >= MIN_DECOR_FX_BULLET_DIFFERENCE,
			});
		}
	}
	return out;
}

/**
 * Effect colours vs enemy bullets (docs/FX_AUDIO.md F1): the CIE76 difference from each ENEMY_BULLET_ROLES colour of
 * each FX_ROLES colour (`source` "role", `subject` the role), of each fx entry's `tint` role ("tint", the fx ID) and,
 * for an untinted entry, of its sheet's `meanColor` ("meanColor", the fx ID); >= MIN_FX_BULLET_DIFFERENCE, so no
 * effect can be mistaken for an enemy bullet. An untinted entry without a meanColor has nothing to check. A tint that
 * is not a colour role is a validator error of its own, not an entry here.
 */
export interface FxColorEntry {
	source: "role" | "tint" | "meanColor";
	/** The colour role (source "role") or the fx asset ID. */
	subject: string;
	/** The colour checked: the role's, the tint role's, or the meanColor. */
	color: string;
	/** The tint role (source "tint"), else undefined. */
	tint: string | undefined;
	/** The enemy-bullet role it was compared with. */
	against: string;
	againstColor: string;
	difference: number;
	min: number;
	ok: boolean;
}

export function fxColorReport(manifest: unknown): Array<FxColorEntry> {
	const out = new Array<FxColorEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const push = (source: FxColorEntry["source"], subject: string, color: unknown, tint: string | undefined) => {
		if (!isHexColor(color)) {
			return;
		}
		for (const against of ENEMY_BULLET_ROLES) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const difference = colorDifference(color, againstColor);
			out.push({
				source,
				subject,
				color,
				tint,
				against,
				againstColor,
				difference,
				min: MIN_FX_BULLET_DIFFERENCE,
				ok: difference >= MIN_FX_BULLET_DIFFERENCE,
			});
		}
	};
	for (const role of FX_ROLES) {
		push("role", role, colors[role], undefined);
	}
	const assets: Obj = isObj(manifest.assets) ? manifest.assets : {};
	for (const [id, def] of sortedEntries(assets)) {
		if (!isFxId(id) || !isObj(def)) {
			continue;
		}
		const tint = def.tint;
		if (tint !== undefined) {
			if (typeIs(tint, "string") && COLOR_ROLE_SET.has(tint)) {
				push("tint", id, colors[tint], tint);
			}
		} else {
			push("meanColor", id, def.meanColor, undefined);
		}
	}
	return out;
}

/** WCAG contrast of enemyBullet on each breakable colour role (BREAKABLE_ROLES), >= MIN_ENEMY_BULLET_CONTRAST. */
export interface BreakableContrastEntry {
	role: string;
	color: string;
	ratio: number;
	ok: boolean;
}

export function breakableContrastReport(manifest: unknown): Array<BreakableContrastEntry> {
	const out = new Array<BreakableContrastEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors) || !isHexColor(manifest.colors.enemyBullet)) {
		return out;
	}
	const bullet = manifest.colors.enemyBullet;
	for (const role of BREAKABLE_ROLES) {
		const color = manifest.colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		const ratio = contrastRatio(bullet, color);
		out.push({ role, color, ratio, ok: ratio >= MIN_ENEMY_BULLET_CONTRAST });
	}
	return out;
}

type Err = (path: ReadonlyArray<string>, msg: string) => void;
type UnknownKeys = (obj: Obj, path: ReadonlyArray<string>, allowed: ReadonlyArray<string>) => void;

const TOP_LEVEL_KEYS = ["format", "id", "name", "version", "colors", "biomes", "assets", "strings", "locales"];
const SLOT_PREFIXES = "class., enemy., boss., bullet., tile., item., ui., sfx., music., decor., breakable., amb., fx.";
const AMBIENCE_ID_LIST = AMBIENCE_IDS.join(", ");
const FX_ID_LIST = FX_IDS.join(", ");

function forgeSuffix(biome: string): string {
	const forge = BIOMES.find((b) => b.id === biome)?.forgeTheme;
	return forge !== undefined ? ` (${forge})` : "";
}

export function validateManifest(manifest: unknown, opts: ValidateOptions = {}): Array<string> {
	const errors = new Array<string>();
	const err: Err = (path, msg) => {
		errors.push(`${fmtPath(path)}: ${msg}`);
	};

	if (!isObj(manifest)) {
		return ["(root): manifest must be a JSON object"];
	}

	const unknownKeys: UnknownKeys = (obj, path, allowed) => {
		for (const [k] of sortedEntries(obj)) {
			// Gameplay-looking keys get their own, more specific message from the scan below.
			if (!allowed.includes(k) && !isGameplayKey(k)) {
				err(append(path, k), `unknown key (allowed: ${allowed.join(", ")})`);
			}
		}
	};

	// --- top level -----------------------------------------------------------------------------
	unknownKeys(manifest, [], TOP_LEVEL_KEYS);
	if (manifest.format !== MANIFEST_FORMAT) {
		err(["format"], `must be ${MANIFEST_FORMAT}, got ${describeValue(manifest.format)}`);
	}
	const id = manifest.id;
	if (!typeIs(id, "string") || !matches(id, PACK_ID_PATTERN)) {
		err(["id"], 'must be a lowercase pack id like "placeholder" or "my-pack"');
	} else if (opts.packId !== undefined && id !== opts.packId) {
		err(["id"], `is ${q(id)} but the pack folder is ${q(opts.packId)}`);
	}
	for (const k of ["name", "version"]) {
		const v = manifest[k];
		if (!typeIs(v, "string") || matches(v, "^%s*$")) {
			err([k], "must be a non-empty string");
		}
	}

	// --- strings (checked first: other sections reference them) --------------------------------
	const strings: Obj = isObj(manifest.strings) ? manifest.strings : {};
	if (!isObj(manifest.strings)) {
		err(["strings"], "missing string table (object of key -> text)");
	}
	for (const [key, text] of sortedEntries(strings)) {
		if (!isStringKey(key)) {
			err(["strings", key], "bad string key (use dot.separated.words)");
		}
		if (!typeIs(text, "string")) {
			err(["strings", key], "must be a string");
		} else {
			const problem = templateProblem(text);
			if (problem !== undefined) {
				err(["strings", key], problem);
			}
		}
	}
	for (const key of REQUIRED_STRING_KEYS) {
		if (!hasKey(strings, key)) {
			err(["strings"], `missing required string ${q(key)}`);
		}
	}
	if (manifest.locales !== undefined) {
		if (!isObj(manifest.locales)) {
			err(["locales"], "must be an object of locale -> string table");
		} else {
			for (const [locale, localeTable] of sortedEntries(manifest.locales)) {
				if (!isLocale(locale)) {
					err(["locales", locale], 'bad locale code (use e.g. "fr" or "pt-BR")');
				}
				if (!isObj(localeTable)) {
					err(["locales", locale], "must be an object of key -> text");
					continue;
				}
				for (const [key, text] of sortedEntries(localeTable)) {
					if (!hasKey(strings, key)) {
						err(["locales", locale, key], "not in the default string table");
					}
					if (!typeIs(text, "string")) {
						err(["locales", locale, key], "must be a string");
					} else {
						const problem = templateProblem(text);
						if (problem !== undefined) {
							err(["locales", locale, key], problem);
						}
					}
				}
			}
		}
	}

	// --- colors --------------------------------------------------------------------------------
	const colors: Obj = isObj(manifest.colors) ? manifest.colors : {};
	if (!isObj(manifest.colors)) {
		err(["colors"], 'missing color roles (object of role -> "#rrggbb")');
	}
	for (const role of COLOR_ROLES) {
		if (!hasKey(colors, role)) {
			err(["colors"], `missing color role ${q(role)}`);
		}
	}
	for (const [role, value] of sortedEntries(colors)) {
		if (!COLOR_ROLE_SET.has(role)) {
			err(["colors", role], `unknown color role (known: ${COLOR_ROLES.join(", ")})`);
		}
		if (!isHexColor(value)) {
			err(["colors", role], `must be "#rrggbb", got ${describeValue(value)}`);
		}
	}

	// --- assets --------------------------------------------------------------------------------
	const assets: Obj = isObj(manifest.assets) ? manifest.assets : {};
	if (!isObj(manifest.assets)) {
		err(["assets"], "missing asset map (object of logical ID -> asset)");
	}
	for (const required of REQUIRED_ASSET_IDS) {
		if (!hasKey(assets, required)) {
			err(["assets"], `missing required asset ${q(required)} (slot ${slotFor(required)?.slot ?? "?"})`);
		}
	}
	for (const [assetId, def] of sortedEntries(assets)) {
		const path = ["assets", assetId];
		if (!isAssetId(assetId)) {
			err(path, 'bad asset ID (use lowercase dot.separated segments, e.g. "enemy.sniper")');
		}
		const slot = slotFor(assetId);
		if (slot === undefined) {
			err(path, `ID matches no slot (prefixes: ${SLOT_PREFIXES})`);
			continue;
		}
		if (slot === DECOR && parseDecorId(assetId) === undefined) {
			err(path, `unknown decor ID (use ${DECOR_ID_FORMS}; kinds: contract.ts DECOR_KINDS, lowercase)`);
			continue;
		}
		if (slot === AMBIENCE && !isAmbienceId(assetId)) {
			err(path, `unknown ambience ID (known: ${AMBIENCE_ID_LIST})`);
			continue;
		}
		if (slot === FX && !isFxId(assetId)) {
			err(path, `unknown fx ID (known: ${FX_ID_LIST})`);
			continue;
		}
		validateAsset(def, path, slot, err, unknownKeys);
	}

	// --- biomes --------------------------------------------------------------------------------
	const biomes: Obj = isObj(manifest.biomes) ? manifest.biomes : {};
	if (!isObj(manifest.biomes)) {
		err(["biomes"], "missing biomes (object of biome ID -> biome)");
	}
	const knownBiomes = BIOMES.map((b) => b.id as string);
	for (const b of BIOMES) {
		if (!hasKey(biomes, b.id)) {
			err(["biomes"], `missing biome ${q(b.id)} (Dungeon Forge theme "${b.forgeTheme}")`);
		}
	}
	for (const [biomeId, def] of sortedEntries(biomes)) {
		const path = ["biomes", biomeId];
		if (!knownBiomes.includes(biomeId)) {
			err(path, `unknown biome (known: ${knownBiomes.join(", ")})`);
		}
		if (!isObj(def)) {
			err(path, "must be an object");
			continue;
		}
		unknownKeys(def, path, ["name", "floor", "wall", "tiles", "materials"]);
		if (!typeIs(def.name, "string")) {
			err(append(path, "name"), "must be a string-table key");
		} else if (!hasKey(strings, def.name)) {
			err(append(path, "name"), `string key ${q(def.name)} is not in strings`);
		}
		for (const s of SURFACES) {
			if (!isHexColor(def[s])) {
				err(append(path, s), `must be "#rrggbb", got ${describeValue(def[s])}`);
			}
		}
		const tiles = def.tiles;
		if (!isObj(tiles)) {
			err(append(path, "tiles"), `must map ${BIOME_TILE_KEYS.join(", ")} to tile asset IDs`);
		} else {
			unknownKeys(tiles, append(path, "tiles"), BIOME_TILE_KEYS);
			for (const t of BIOME_TILE_KEYS) {
				const ref = tiles[t];
				if (!typeIs(ref, "string")) {
					err(append(path, "tiles", t), "missing tile asset ID");
				} else if (!startsWith(ref, "tile.")) {
					err(append(path, "tiles", t), `${q(ref)} is not a tile.* asset`);
				} else if (!hasKey(assets, ref)) {
					err(append(path, "tiles", t), `asset ${q(ref)} is not in assets`);
				}
			}
		}
		validateBiomeMaterials(def, path, assets, err, unknownKeys);
	}

	// --- no gameplay data, anywhere ------------------------------------------------------------
	const scan = (node: unknown, path: Array<string>) => {
		if (isArrayLike(node)) {
			node.forEach((v, i) => scan(v, append(path, tostring(i))));
			return;
		}
		if (!isObj(node)) {
			return;
		}
		const ids = keysAreIds(path);
		// A sound asset's presentation keys (minInterval) contain a gameplay word but are exempt (contract.ts).
		const sound = path.size() === 2 && path[0] === "assets" && node.kind === "sound";
		for (const [k, v] of sortedEntries(node)) {
			if (!ids && isGameplayKey(k) && !(sound && SOUND_PRESENTATION_KEYS.includes(k))) {
				err(
					append(path, k),
					"looks like gameplay data; hitboxes, radii, speeds, damage and timings belong in gameplay data, not the theme pack",
				);
			}
			scan(v, append(path, k));
		}
	};
	scan(manifest, []);

	// --- contrast: enemy bullets must read on every biome ---------------------------------------
	for (const c of contrastReport(manifest)) {
		if (c.ok) {
			continue;
		}
		err(
			["biomes", c.biome, c.surface],
			`contrast: enemyBullet ${tostring(colors.enemyBullet)} on ${c.biome}${forgeSuffix(c.biome)} ${c.surface} ${
				c.color
			} is ${fixed2(c.ratio)}:1, needs >= ${fixed1(MIN_ENEMY_BULLET_CONTRAST)}:1`,
		);
	}

	// --- decor fx colours never read as enemy bullets; enemy bullets read on breakables ----------
	for (const c of decorFxReport(manifest)) {
		if (!c.ok) {
			err(
				["colors", c.role],
				`colour difference: ${c.role} ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(
					c.difference,
				)} (CIE76), needs >= ${fixed1(c.min)}: decor fx must never read as an enemy bullet`,
			);
		}
	}
	for (const c of fxColorReport(manifest)) {
		if (c.ok) {
			continue;
		}
		const what =
			c.source === "role"
				? `${c.subject} ${c.color}`
				: c.source === "tint"
				? `tint ${c.tint} ${c.color}`
				: `meanColor ${c.color}`;
		err(
			c.source === "role" ? ["colors", c.subject] : ["assets", c.subject, c.source],
			`colour difference: ${what} vs ${c.against} ${c.againstColor} is ${fixed1(
				c.difference,
			)} (CIE76), needs >= ${fixed1(c.min)}: effects must never read as an enemy bullet`,
		);
	}
	for (const c of breakableContrastReport(manifest)) {
		if (!c.ok) {
			err(
				["colors", c.role],
				`contrast: enemyBullet ${tostring(colors.enemyBullet)} on ${c.role} ${c.color} is ${fixed2(
					c.ratio,
				)}:1, needs >= ${fixed1(MIN_ENEMY_BULLET_CONTRAST)}:1`,
			);
		}
	}

	// --- contrast: juice (health bars on their back plate, damage numbers on every biome floor) ---
	for (const c of juiceContrastReport(manifest)) {
		if (c.ok) {
			continue;
		}
		if (c.check === "healthBar") {
			err(
				["colors", c.role],
				`contrast: ${c.role} ${c.color} on enemyHealthBack ${c.againstColor} is ${fixed2(
					c.ratio,
				)}:1, needs >= ${fixed1(c.min)}:1`,
			);
		} else {
			err(
				["colors", c.role],
				`contrast: ${c.role} ${c.color} on ${c.against}${forgeSuffix(c.against)} floor ${c.againstColor} is ` +
					`${fixed2(c.ratio)}:1, needs >= ${fixed1(c.min)}:1`,
			);
		}
	}

	return errors;
}

/**
 * A biome's optional `materials` (docs/DECOR.md R1): an object of surface (floor, wall, pool) -> a BIOME_MATERIALS
 * name. A floor whose tile is a repeating texture (an image with `tilesPerImage`) must keep DEFAULT_BIOME_MATERIAL.
 */
function validateBiomeMaterials(def: Obj, path: Array<string>, assets: Obj, err: Err, unknownKeys: UnknownKeys) {
	const materials = def.materials;
	if (materials === undefined) {
		return;
	}
	const mp = append(path, "materials");
	if (!isObj(materials)) {
		err(mp, `must map ${BIOME_MATERIAL_SURFACES.join(", ")} to material names, got ${describeValue(materials)}`);
		return;
	}
	unknownKeys(materials, mp, BIOME_MATERIAL_SURFACES);
	for (const surface of BIOME_MATERIAL_SURFACES) {
		const name = materials[surface];
		if (name === undefined) {
			continue;
		}
		if (!typeIs(name, "string")) {
			err(append(mp, surface), `must be a material name string, got ${describeValue(name)}`);
		} else if (!BIOME_MATERIAL_SET.has(name)) {
			err(append(mp, surface), `unknown material ${q(name)} (allowed: ${BIOME_MATERIAL_LIST})`);
		}
	}
	const floorName = materials.floor;
	const floorRef = isObj(def.tiles) ? def.tiles.floor : undefined;
	const floorAsset = typeIs(floorRef, "string") ? assets[floorRef] : undefined;
	if (
		typeIs(floorName, "string") &&
		typeIs(floorRef, "string") &&
		floorName !== DEFAULT_BIOME_MATERIAL &&
		BIOME_MATERIAL_SET.has(floorName) &&
		isObj(floorAsset) &&
		floorAsset.kind === "image" &&
		floorAsset.tilesPerImage !== undefined
	) {
		err(
			append(mp, "floor"),
			`floor tile ${q(floorRef)} is a repeating texture: use ${q(DEFAULT_BIOME_MATERIAL)}, ${q(
				floorName,
			)} would fight the image`,
		);
	}
}

/** `assetId` must be an uploaded Roblox asset, "rbxassetid://<digits>". */
function checkAssetIdAt(assetId: unknown, path: ReadonlyArray<string>, err: Err) {
	if (!typeIs(assetId, "string") || assetId === "") {
		err(path, 'must be an uploaded Roblox asset, "rbxassetid://<digits>"');
		return;
	}
	if (!matches(assetId, ASSET_ID_PATTERN)) {
		err(path, `${q(assetId)} must be "rbxassetid://<digits>" (upload with Asphalt or the Studio Asset Manager)`);
	}
}

function validateAsset(def: unknown, path: Array<string>, slot: SlotContract, err: Err, unknownKeys: UnknownKeys) {
	if (!isObj(def)) {
		err(path, 'must be an object with a "kind"');
		return;
	}
	const kind = def.kind;
	if (!typeIs(kind, "string") || !(slot.kinds as ReadonlyArray<string>).includes(kind)) {
		err(
			append(path, "kind"),
			`slot "${slot.slot}" accepts kind ${slot.kinds.map((k) => q(k)).join(" | ")}, got ${describeValue(kind)}`,
		);
		return;
	}

	const checkCell = (w: unknown, h: unknown, wKey: string, hKey: string) => {
		if (!isPosInt(w)) {
			err(append(path, wKey), "must be a positive integer");
		}
		if (!isPosInt(h)) {
			err(append(path, hKey), "must be a positive integer");
		}
		const cell = slot.cell;
		if (cell !== undefined && isPosInt(w) && isPosInt(h) && (w !== cell.w || h !== cell.h)) {
			err(path, `sprite contract: ${slot.slot} cells are ${cell.w}x${cell.h}, got ${w}x${h}`);
		}
	};

	const checkAssetId = () => checkAssetIdAt(def.assetId, append(path, "assetId"), err);

	switch (kind) {
		case "placeholder": {
			unknownKeys(def, path, ["kind"]);
			break;
		}
		case "image": {
			if (WORLD_ART_SLOTS.includes(slot)) {
				validateWorldImage(def, path, slot, err, unknownKeys);
				break;
			}
			unknownKeys(def, path, ["kind", "assetId", "w", "h", "tilesPerImage", "pivot"]);
			checkAssetId();
			const imagePivot = def.pivot;
			if (imagePivot !== undefined) {
				const pp = append(path, "pivot");
				if (slot !== UI) {
					err(pp, `only ui.*, decor.* and breakable.* images have a pivot; slot "${slot.slot}" has none`);
				} else if (!isObj(imagePivot) || !isFiniteNumber(imagePivot.x) || !isFiniteNumber(imagePivot.y)) {
					err(pp, 'must be { "x": number, "y": number } in pixels from the image top-left');
				} else {
					unknownKeys(imagePivot, pp, ["x", "y"]);
					if (
						isPosInt(def.w) &&
						isPosInt(def.h) &&
						(imagePivot.x < 0 || imagePivot.x > def.w || imagePivot.y < 0 || imagePivot.y > def.h)
					) {
						err(pp, `(${imagePivot.x}, ${imagePivot.y}) is outside the ${def.w}x${def.h} image`);
					}
				}
			}
			const tilesPerImage = def.tilesPerImage;
			if (tilesPerImage === undefined) {
				checkCell(def.w, def.h, "w", "h");
			} else if (slot !== TILE) {
				err(
					append(path, "tilesPerImage"),
					`only tile.* images repeat; slot "${slot.slot}" has no tilesPerImage`,
				);
				checkCell(def.w, def.h, "w", "h");
			} else {
				// A repeating texture: any size Roblox can store, spanning tilesPerImage world tiles per side.
				if (!isFiniteNumber(tilesPerImage) || !(tilesPerImage > 0)) {
					err(append(path, "tilesPerImage"), "must be a number > 0 (world tiles per image side)");
				}
				for (const k of ["w", "h"]) {
					if (!isImageSide(def[k])) {
						err(append(path, k), IMAGE_SIDE_MSG);
					}
				}
			}
			const stripW = DIGIT_FONT.cellW * DIGIT_FONT.glyphs.size();
			if (
				path[1] === DIGIT_FONT.id &&
				isPosInt(def.w) &&
				isPosInt(def.h) &&
				(def.w !== stripW || def.h !== DIGIT_FONT.cellH)
			) {
				err(
					path,
					`font contract: the digit strip is ${stripW}x${
						DIGIT_FONT.cellH
					} (${DIGIT_FONT.glyphs.size()} cells of ${DIGIT_FONT.cellW}x${DIGIT_FONT.cellH}: "${
						DIGIT_FONT.glyphs
					}"), got ${def.w}x${def.h}`,
				);
			}
			break;
		}
		case "spritesheet": {
			unknownKeys(def, path, ["kind", "assetId", "frameW", "frameH", "animations", "pivot"]);
			checkAssetId();
			checkCell(def.frameW, def.frameH, "frameW", "frameH");
			const pivot = def.pivot;
			if (!isObj(pivot) || !isNonNegInt(pivot.x) || !isNonNegInt(pivot.y)) {
				err(append(path, "pivot"), 'must be { "x": int, "y": int } in pixels from the cell top-left');
			} else {
				unknownKeys(pivot, append(path, "pivot"), ["x", "y"]);
				const want = slot.pivot;
				if (want !== undefined && (pivot.x !== want.x || pivot.y !== want.y)) {
					err(
						append(path, "pivot"),
						`sprite contract: ${slot.slot} pivot is (${want.x}, ${want.y}), got (${pivot.x}, ${pivot.y})`,
					);
				}
			}
			const anims = def.animations;
			if (!isObj(anims)) {
				err(append(path, "animations"), "must be an object of name -> { row, frames, fps, loop }");
				break;
			}
			const rows = new Map<number, string>();
			// Rows are claimed in row-then-name order so a duplicate is blamed on the same entry every run.
			const entries = sortedEntries(anims);
			const rowOf = (a: unknown) => (isObj(a) && isNonNegInt(a.row) ? a.row : math.huge);
			entries.sort((a, b) => {
				const ra = rowOf(a[1]);
				const rb = rowOf(b[1]);
				return ra !== rb ? ra < rb : a[0] < b[0];
			});
			for (const [name, a] of entries) {
				const ap = append(path, "animations", name);
				if (!isObj(a)) {
					err(ap, "must be { row, frames, fps, loop }");
					continue;
				}
				unknownKeys(a, ap, ["row", "frames", "fps", "loop"]);
				if (!isNonNegInt(a.row)) {
					err(append(ap, "row"), "must be an integer >= 0");
				} else if (rows.has(a.row)) {
					err(append(ap, "row"), `row ${a.row} is already used by ${q(rows.get(a.row) as string)}`);
				} else {
					rows.set(a.row, name);
				}
				if (!isPosInt(a.frames)) {
					err(append(ap, "frames"), "must be an integer >= 1");
				}
				if (!typeIs(a.fps, "number") || !(a.fps > 0) || a.fps > MAX_FPS) {
					err(append(ap, "fps"), `must be a number in (0, ${MAX_FPS}]`);
				}
				if (!typeIs(a.loop, "boolean")) {
					err(append(ap, "loop"), "must be true or false");
				}
			}
			for (const req of requiredAnimationList(slot)) {
				const a = anims[req.name];
				if (!isObj(a)) {
					err(
						append(path, "animations"),
						`sprite contract: missing animation ${q(req.name)} (${req.frames} frames)`,
					);
				} else if (isPosInt(a.frames) && a.frames !== req.frames) {
					err(
						append(path, "animations", req.name, "frames"),
						`sprite contract: ${q(req.name)} has ${req.frames} frames, got ${a.frames}`,
					);
				}
			}
			break;
		}
		case "sprites": {
			validateSpriteSet(def, path, slot, err, unknownKeys);
			break;
		}
		case "sound": {
			unknownKeys(def, path, ["kind", "assetId", "volume", "variants", "pitch", "minInterval"]);
			checkAssetId();
			const volume = def.volume;
			if (volume !== undefined && (!typeIs(volume, "number") || volume < 0 || volume > 1)) {
				err(append(path, "volume"), "must be a number in [0, 1]");
			}
			validateSoundExtras(def, path, err);
			break;
		}
		case "silent": {
			unknownKeys(def, path, ["kind"]);
			break;
		}
	}
}

const PITCH_MSG = `must be [min, max] with ${SOUND_PITCH_LIMITS.min} <= min <= max <= ${SOUND_PITCH_LIMITS.max} (PlaybackSpeed)`;

/**
 * A sound's optional extras (docs/FX_AUDIO.md A2): `variants` an array of uploaded asset IDs (empty is fine),
 * `pitch` a [min, max] PlaybackSpeed range inside SOUND_PITCH_LIMITS with min <= max, `minInterval` seconds >= 0.
 */
function validateSoundExtras(def: Obj, path: Array<string>, err: Err) {
	const variants = def.variants;
	if (variants !== undefined) {
		const vp = append(path, "variants");
		if (isArrayLike(variants)) {
			for (let i = 0; i < variants.size(); i++) {
				checkAssetIdAt(variants[i], append(vp, tostring(i)), err);
			}
		} else if (!isObj(variants) || sortedEntries(variants).size() > 0) {
			err(vp, `must be an array of "rbxassetid://<digits>" (extra clips), got ${describeValue(variants)}`);
		}
	}
	const pitch = def.pitch;
	if (pitch !== undefined) {
		const pp = append(path, "pitch");
		if (!isArrayLike(pitch) || pitch.size() !== 2 || !isFiniteNumber(pitch[0]) || !isFiniteNumber(pitch[1])) {
			err(pp, `${PITCH_MSG}, got ${describeValue(pitch)}`);
		} else {
			const lo = pitch[0] as number;
			const hi = pitch[1] as number;
			if (lo < SOUND_PITCH_LIMITS.min || hi > SOUND_PITCH_LIMITS.max || lo > hi) {
				err(pp, `${PITCH_MSG}, got [${lo}, ${hi}]`);
			}
		}
	}
	const minInterval = def.minInterval;
	if (minInterval !== undefined && (!isFiniteNumber(minInterval) || minInterval < 0)) {
		err(append(path, "minInterval"), `must be a number of seconds >= 0, got ${describeValue(minInterval)}`);
	}
}

// ---------------------------------------------------------------------------------------------
// World art (Roblox port, docs/DECOR.md R2 / R13): decor.* and breakable.* images and sprite sets

/** Keys of a decor.* / breakable.* image (decor pieces and effects add DECOR_ART_KEYS). */
const WORLD_IMAGE_KEYS = ["kind", "assetId", "w", "h", "rect", "pivot", "pixelsPerTile"];
/** Keys of an ambient particle texture (decor.fx.ambient.*): a ParticleEmitter texture, no placement. */
const AMBIENT_IMAGE_KEYS = ["kind", "assetId", "w", "h", "particle", "emissive"];
const DECOR_LAYER_LIST = DECOR_LAYERS.map((l) => q(l)).join(" | ");

/** The decor fields a decor asset may carry on top of its kind's keys: pieces have a layer, effects do not. */
function decorArtKeys(info: DecorIdInfo): Array<string> {
	switch (info.type) {
		case "piece":
			return ["layer", "glow", "glowAt", "emissive"];
		case "fx":
			return ["glow", "glowAt", "emissive"];
		default:
			return [];
	}
}

type Box = { readonly w: number; readonly h: number };

/** A point `{ x, y }` in pixels, inside `box` (`what`: "image", "rect" or "cell") when the box is known. */
function checkPoint(
	p: unknown,
	pp: ReadonlyArray<string>,
	box: Box | undefined,
	what: string,
	err: Err,
	unknownKeys: UnknownKeys,
) {
	if (!isObj(p) || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
		err(pp, `must be { "x": number, "y": number } in pixels from the ${what} top-left`);
		return;
	}
	unknownKeys(p, pp, ["x", "y"]);
	if (box !== undefined && (p.x < 0 || p.x > box.w || p.y < 0 || p.y > box.h)) {
		err(pp, `(${p.x}, ${p.y}) is outside the ${box.w}x${box.h} ${what}`);
	}
}

/**
 * A decor.* / breakable.* image: an uploaded image up to MAX_IMAGE_SIDE, an optional `rect` inside it (the region
 * drawn), an optional `pivot` inside the drawn region, `pixelsPerTile` > 0; decor IDs add their decor fields. An
 * ambient particle texture (decor.fx.ambient.*) is only a texture plus its `particle` look.
 */
function validateWorldImage(def: Obj, path: Array<string>, slot: SlotContract, err: Err, unknownKeys: UnknownKeys) {
	const info = slot === DECOR ? parseDecorId(path[1]) : undefined;
	const ambient = info !== undefined && info.type === "ambient";
	const keys = ambient
		? AMBIENT_IMAGE_KEYS
		: [...WORLD_IMAGE_KEYS, ...(info !== undefined ? decorArtKeys(info) : [])];
	unknownKeys(def, path, keys);
	checkAssetIdAt(def.assetId, append(path, "assetId"), err);
	for (const k of ["w", "h"]) {
		if (!isImageSide(def[k])) {
			err(append(path, k), IMAGE_SIDE_MSG);
		}
	}
	const sizeOk = isImageSide(def.w) && isImageSide(def.h);
	if (ambient) {
		validateParticle(def.particle, append(path, "particle"), err, unknownKeys);
		if (isObj(def.particle) && def.particle.flipbook !== undefined && sizeOk && def.w !== def.h) {
			err(append(path, "particle", "flipbook"), `a flipbook texture must be square, got ${def.w}x${def.h}`);
		}
		if (def.emissive !== undefined && !typeIs(def.emissive, "boolean")) {
			err(append(path, "emissive"), "must be true or false");
		}
		return;
	}
	let box: Box | undefined = sizeOk ? { w: def.w as number, h: def.h as number } : undefined;
	let what = "image";
	const rect = def.rect;
	if (rect !== undefined) {
		const rp = append(path, "rect");
		what = "rect";
		if (!isObj(rect) || !isNonNegInt(rect.x) || !isNonNegInt(rect.y) || !isPosInt(rect.w) || !isPosInt(rect.h)) {
			err(rp, 'must be { "x": int >= 0, "y": int >= 0, "w": int >= 1, "h": int >= 1 } in pixels of the image');
			box = undefined;
		} else {
			unknownKeys(rect, rp, ["x", "y", "w", "h"]);
			if (sizeOk && (rect.x + rect.w > (def.w as number) || rect.y + rect.h > (def.h as number))) {
				err(rp, `(${rect.x}, ${rect.y}) ${rect.w}x${rect.h} reaches outside the ${def.w}x${def.h} image`);
				box = undefined;
			} else {
				box = { w: rect.w, h: rect.h };
			}
		}
	}
	if (def.pivot !== undefined) {
		checkPoint(def.pivot, append(path, "pivot"), box, what, err, unknownKeys);
	}
	if (!isFiniteNumber(def.pixelsPerTile) || !(def.pixelsPerTile > 0)) {
		err(append(path, "pixelsPerTile"), "must be a number > 0 (art pixels per world tile)");
	}
	if (info !== undefined) {
		validateDecorFields(def, path, info, box, what, err, unknownKeys);
	}
}

/**
 * The decor fields of a decor piece or effect (image or sprite set): a piece's `layer` (required, one of the layers
 * its kind allows: DECOR_KIND_LAYERS), `glow` / `emissive` booleans, `glowAt` only with `glow: true` and inside the
 * drawn box.
 */
function validateDecorFields(
	def: Obj,
	path: Array<string>,
	info: DecorIdInfo,
	box: Box | undefined,
	what: string,
	err: Err,
	unknownKeys: UnknownKeys,
) {
	if (info.type === "piece") {
		const allowed = DECOR_KIND_LAYERS[info.kind] as ReadonlyArray<string>;
		const lp = append(path, "layer");
		const layer = def.layer;
		if (layer === undefined) {
			err(lp, `missing: a decor piece needs a layer (${q(info.kind)}: ${allowed.map((l) => q(l)).join(" | ")})`);
		} else if (!typeIs(layer, "string") || !(DECOR_LAYERS as ReadonlyArray<string>).includes(layer)) {
			err(lp, `must be ${DECOR_LAYER_LIST}, got ${describeValue(layer)}`);
		} else if (!allowed.includes(layer)) {
			err(lp, `${q(layer)} is not allowed for ${q(info.kind)} (allowed: ${allowed.join(", ")})`);
		}
	}
	for (const k of ["glow", "emissive"]) {
		if (def[k] !== undefined && !typeIs(def[k], "boolean")) {
			err(append(path, k), "must be true or false");
		}
	}
	if (def.glowAt !== undefined) {
		const gp = append(path, "glowAt");
		if (def.glow !== true) {
			err(gp, "only a glowing piece (glow: true) has a glowAt");
		}
		checkPoint(def.glowAt, gp, box, what, err, unknownKeys);
	}
}

/** An ambient particle's optional look: `sizeStuds` in (0, max], `transparency` in [min, 1] (DECOR_PARTICLE). */
function validateParticle(p: unknown, pp: Array<string>, err: Err, unknownKeys: UnknownKeys) {
	if (p === undefined) {
		return;
	}
	if (!isObj(p)) {
		err(pp, 'must be { "sizeStuds"?: number, "transparency"?: number, "flipbook"?: { grid, fps, mode } }');
		return;
	}
	unknownKeys(p, pp, ["sizeStuds", "transparency", "flipbook"]);
	const fb = p.flipbook;
	if (fb !== undefined) {
		const fp = append(pp, "flipbook");
		if (!isObj(fb)) {
			err(fp, 'must be { "grid": 2 | 4 | 8, "fps": number, "mode": "Loop" | "OneShot" | "PingPong" | "Random" }');
		} else {
			unknownKeys(fb, fp, ["grid", "fps", "mode"]);
			if (!PARTICLE_FLIPBOOK_GRIDS.includes(fb.grid as number)) {
				err(
					append(fp, "grid"),
					`must be one of ${PARTICLE_FLIPBOOK_GRIDS.join(", ")}, got ${describeValue(fb.grid)}`,
				);
			}
			if (!isFiniteNumber(fb.fps) || !(fb.fps > 0) || fb.fps > MAX_ANIMATION_FPS) {
				err(append(fp, "fps"), `must be a number in (0, ${MAX_ANIMATION_FPS}]`);
			}
			if (!PARTICLE_FLIPBOOK_MODES.some((m) => m === fb.mode)) {
				err(
					append(fp, "mode"),
					`must be one of ${PARTICLE_FLIPBOOK_MODES.join(", ")}, got ${describeValue(fb.mode)}`,
				);
			}
		}
	}
	const size = p.sizeStuds;
	if (size !== undefined && (!isFiniteNumber(size) || !(size > 0) || size > DECOR_PARTICLE.maxSizeStuds)) {
		err(
			append(pp, "sizeStuds"),
			`must be a number in (0, ${DECOR_PARTICLE.maxSizeStuds}] (studs: ambient particles stay smaller than bullets)`,
		);
	}
	const t = p.transparency;
	if (t !== undefined && (!isFiniteNumber(t) || t < DECOR_PARTICLE.minTransparency || t > 1)) {
		err(
			append(pp, "transparency"),
			`must be a number in [${DECOR_PARTICLE.minTransparency}, 1] (ambient particles stay fainter than bullets)`,
		);
	}
}

const SPRITE_SET_KEYS = [
	"kind",
	"frameW",
	"frameH",
	"pivot",
	"pixelsPerTile",
	"resample",
	"facings",
	"sheets",
	"animations",
];
const SPRITE_ANIMATION_KEYS = ["sheet", "start", "frames", "stride", "fps", "loop"];
/** Keys an fx.* sprite set adds (types.ts SpriteSetAsset, fx fields). */
const FX_ART_KEYS = ["sizeTiles", "tint", "additive", "meanColor"];
const FACING_COUNT_LIST = (SPRITE_FACING_COUNTS as ReadonlyArray<number>).map((n) => tostring(n)).join(" | ");
const RESAMPLE_LIST = SPRITE_RESAMPLE_MODES.map((m) => q(m)).join(" | ");

/**
 * Sprite contract v2: a `sprites` asset (SpriteSetAsset, types.ts). Every field is checked, and every cell an
 * animation references (all facings, all frames: `start + d * (stride ?? frames) + f`) must lie inside its sheet.
 */
function validateSpriteSet(def: Obj, path: Array<string>, slot: SlotContract, err: Err, unknownKeys: UnknownKeys) {
	const decor = slot === DECOR ? parseDecorId(path[1]) : undefined;
	if (decor !== undefined && decor.type === "ambient") {
		err(append(path, "kind"), 'decor.fx.ambient.* is a particle texture: kind "image", got "sprites"');
		return;
	}
	const fx = slot === FX;
	const extraKeys = decor !== undefined ? decorArtKeys(decor) : fx ? FX_ART_KEYS : [];
	unknownKeys(def, path, [...SPRITE_SET_KEYS, ...extraKeys]);

	// --- cell, pivot, density, resample -----------------------------------------------------------
	const frameW = def.frameW;
	const frameH = def.frameH;
	if (!isImageSide(frameW)) {
		err(append(path, "frameW"), IMAGE_SIDE_MSG);
	}
	if (!isImageSide(frameH)) {
		err(append(path, "frameH"), IMAGE_SIDE_MSG);
	}
	const cellOk = isImageSide(frameW) && isImageSide(frameH);
	const pivot = def.pivot;
	if (!isObj(pivot) || !isFiniteNumber(pivot.x) || !isFiniteNumber(pivot.y)) {
		err(append(path, "pivot"), 'must be { "x": number, "y": number } in pixels from the cell top-left');
	} else {
		unknownKeys(pivot, append(path, "pivot"), ["x", "y"]);
		if (cellOk && (pivot.x < 0 || pivot.x > frameW || pivot.y < 0 || pivot.y > frameH)) {
			err(append(path, "pivot"), `(${pivot.x}, ${pivot.y}) is outside the ${frameW}x${frameH} cell`);
		}
	}
	if (!isFiniteNumber(def.pixelsPerTile) || !(def.pixelsPerTile > 0)) {
		err(append(path, "pixelsPerTile"), "must be a number > 0 (cell pixels per world tile)");
	}
	if (!SPRITE_RESAMPLE_MODES.some((m) => m === def.resample)) {
		err(append(path, "resample"), `must be ${RESAMPLE_LIST}, got ${describeValue(def.resample)}`);
	}
	if (decor !== undefined) {
		const cell = cellOk ? { w: frameW as number, h: frameH as number } : undefined;
		validateDecorFields(def, path, decor, cell, "cell", err, unknownKeys);
	}

	// --- facings ----------------------------------------------------------------------------------
	let facingCount: number | undefined;
	const facings = def.facings;
	if (!isObj(facings)) {
		err(append(path, "facings"), `must be { "count": ${FACING_COUNT_LIST}, "zeroDeg": number, "ccw": boolean }`);
	} else {
		const fp = append(path, "facings");
		unknownKeys(facings, fp, ["count", "zeroDeg", "ccw"]);
		if (SPRITE_FACING_COUNTS.some((n) => n === facings.count)) {
			facingCount = facings.count as number;
		} else {
			err(append(fp, "count"), `must be ${FACING_COUNT_LIST}, got ${describeValue(facings.count)}`);
		}
		if (!isFiniteNumber(facings.zeroDeg)) {
			err(append(fp, "zeroDeg"), "must be a finite number (degrees; 0 = screen right)");
		}
		if (!typeIs(facings.ccw, "boolean")) {
			err(append(fp, "ccw"), "must be true or false");
		}
		if (fx && facingCount !== undefined && facingCount !== 1) {
			err(append(fp, "count"), `an effect is drawn in one facing: must be 1, got ${facingCount}`);
		}
	}
	if (fx) {
		validateFxFields(def, path, cellOk ? math.max(frameW as number, frameH as number) : undefined, err);
	}

	// --- sheets -----------------------------------------------------------------------------------
	/** Sheet index -> cell capacity, for sheets whose size (and the cell) are valid. */
	const capacity = new Map<number, number>();
	/** Sheet index -> "WxH", for messages. */
	const sheetSize = new Map<number, string>();
	let sheetCount: number | undefined;
	const sheets = def.sheets;
	if (!isArrayLike(sheets)) {
		err(append(path, "sheets"), "must be a non-empty array of { assetId, w, h }");
	} else {
		sheetCount = sheets.size();
		for (let i = 0; i < sheets.size(); i++) {
			const sp = append(path, "sheets", tostring(i));
			const sheet = sheets[i];
			if (!isObj(sheet)) {
				err(sp, "must be { assetId, w, h }");
				continue;
			}
			unknownKeys(sheet, sp, ["assetId", "w", "h"]);
			checkAssetIdAt(sheet.assetId, append(sp, "assetId"), err);
			const w = sheet.w;
			const h = sheet.h;
			if (!isImageSide(w)) {
				err(append(sp, "w"), IMAGE_SIDE_MSG);
			}
			if (!isImageSide(h)) {
				err(append(sp, "h"), IMAGE_SIDE_MSG);
			}
			if (!isImageSide(w) || !isImageSide(h) || !cellOk) {
				continue;
			}
			if (w < frameW || h < frameH) {
				err(sp, `sheet is ${w}x${h}, smaller than the ${frameW}x${frameH} cell`);
				continue;
			}
			capacity.set(i, math.floor(w / frameW) * math.floor(h / frameH));
			sheetSize.set(i, `${w}x${h}`);
		}
	}

	// --- animations -------------------------------------------------------------------------------
	const anims = def.animations;
	const ap0 = append(path, "animations");
	if (!isObj(anims)) {
		err(ap0, "must be an object of name -> { sheet, start, frames, stride?, fps, loop }");
		return;
	}
	for (const name of requiredBaseAnimations(slot)) {
		if (!isObj(anims[name])) {
			err(ap0, `sprite contract: missing animation ${q(name)} (>= 1 frame)`);
		}
	}
	for (const [name, a] of sortedEntries(anims)) {
		const ap = append(ap0, name);
		if (!isObj(a)) {
			err(ap, "must be { sheet, start, frames, stride?, fps, loop }");
			continue;
		}
		unknownKeys(a, ap, SPRITE_ANIMATION_KEYS);
		const sheetIndex = a.sheet;
		if (!isNonNegInt(sheetIndex) || (sheetCount !== undefined && sheetIndex >= sheetCount)) {
			err(
				append(ap, "sheet"),
				sheetCount !== undefined
					? `must be a sheet index in [0, ${sheetCount - 1}], got ${describeValue(sheetIndex)}`
					: "must be an integer >= 0 (index into sheets)",
			);
		}
		if (!isNonNegInt(a.start)) {
			err(append(ap, "start"), "must be an integer >= 0 (first cell)");
		}
		if (!isPosInt(a.frames)) {
			err(append(ap, "frames"), "must be an integer >= 1");
		}
		if (a.stride !== undefined && !isPosInt(a.stride)) {
			err(append(ap, "stride"), "must be an integer >= 1 (cells between facings)");
		} else if (
			a.stride !== undefined &&
			isPosInt(a.frames) &&
			a.stride < a.frames &&
			(facingCount === undefined || facingCount > 1)
		) {
			err(
				append(ap, "stride"),
				`is ${a.stride}, less than frames (${a.frames}): consecutive facings would share cells`,
			);
		}
		if (!typeIs(a.fps, "number") || !(a.fps > 0) || a.fps > MAX_FPS) {
			err(append(ap, "fps"), `must be a number in (0, ${MAX_FPS}]`);
		}
		if (!typeIs(a.loop, "boolean")) {
			err(append(ap, "loop"), "must be true or false");
		}

		// Every referenced cell inside the sheet. Cells grow with the facing and the frame, so the first one out of
		// range is in the first facing whose last frame is out of range.
		const stride = a.stride === undefined ? a.frames : a.stride;
		if (
			facingCount === undefined ||
			!isNonNegInt(sheetIndex) ||
			!isNonNegInt(a.start) ||
			!isPosInt(a.frames) ||
			!isPosInt(stride)
		) {
			continue;
		}
		const cap = capacity.get(sheetIndex);
		if (cap === undefined) {
			continue;
		}
		const lastFacing = facingCount - 1;
		for (let d = 0; d <= lastFacing; d++) {
			const first = a.start + d * stride;
			if (first + a.frames - 1 < cap) {
				continue;
			}
			const f = math.max(0, cap - first);
			err(
				ap,
				`facing ${d} frame ${f} is cell ${first + f}, but sheet ${sheetIndex} (${sheetSize.get(
					sheetIndex,
				)}) holds ${cap} cells of ${frameW}x${frameH}`,
			);
			break;
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Sprite effects (Roblox port, docs/FX_AUDIO.md F1): fx.* fields

/**
 * An fx.* set's fields: `sizeTiles` in (0, FX_SPRITE_MAX_TILES] (absent: the longer cell side / pixelsPerTile, held
 * to the same cap), `tint` a known colour role, `additive` a boolean, `meanColor` "#rrggbb". The colour rule
 * (tint and meanColor vs the enemy-bullet roles) is fxColorReport's.
 */
function validateFxFields(def: Obj, path: Array<string>, longSide: number | undefined, err: Err) {
	const sizeTiles = def.sizeTiles;
	if (sizeTiles !== undefined) {
		if (!isFiniteNumber(sizeTiles) || !(sizeTiles > 0) || sizeTiles > FX_SPRITE_MAX_TILES) {
			err(
				append(path, "sizeTiles"),
				`must be a number in (0, ${FX_SPRITE_MAX_TILES}] (tiles: effects stay small), got ${describeValue(
					sizeTiles,
				)}`,
			);
		}
	} else if (longSide !== undefined && isFiniteNumber(def.pixelsPerTile) && def.pixelsPerTile > 0) {
		const drawn = longSide / def.pixelsPerTile;
		if (drawn > FX_SPRITE_MAX_TILES) {
			err(
				path,
				`drawn ${fixed2(drawn)} tiles (cell ${longSide} px / pixelsPerTile ${
					def.pixelsPerTile
				}), more than ${FX_SPRITE_MAX_TILES}: set sizeTiles or raise pixelsPerTile`,
			);
		}
	}
	const tint = def.tint;
	if (tint !== undefined && (!typeIs(tint, "string") || !COLOR_ROLE_SET.has(tint))) {
		err(append(path, "tint"), `must be a colour role (COLOR_ROLES), got ${describeValue(tint)}`);
	}
	if (def.additive !== undefined && !typeIs(def.additive, "boolean")) {
		err(append(path, "additive"), "must be true or false");
	}
	if (def.meanColor !== undefined && !isHexColor(def.meanColor)) {
		err(append(path, "meanColor"), `must be "#rrggbb", got ${describeValue(def.meanColor)}`);
	}
}
