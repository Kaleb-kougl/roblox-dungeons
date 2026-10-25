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
 */

import { contrastRatio, isHexColor } from "./color";
import {
	BIOMES,
	BIOME_MATERIALS,
	BIOME_MATERIAL_SURFACES,
	DAMAGE_NUMBER_ROLES,
	DEFAULT_BIOME_MATERIAL,
	DIGIT_FONT,
	GAMEPLAY_KEY_WORDS,
	HEALTH_BAR_FILL_ROLES,
	MAX_ANIMATION_FPS,
	MAX_IMAGE_SIDE,
	MIN_DAMAGE_NUMBER_CONTRAST,
	MIN_ENEMY_BULLET_CONTRAST,
	MIN_HEALTH_BAR_CONTRAST,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	SPRITE_FACING_COUNTS,
	SPRITE_RESAMPLE_MODES,
	TILE,
	UI,
	requiredAnimationList,
	requiredBaseAnimations,
	slotFor,
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

type Err = (path: ReadonlyArray<string>, msg: string) => void;
type UnknownKeys = (obj: Obj, path: ReadonlyArray<string>, allowed: ReadonlyArray<string>) => void;

const TOP_LEVEL_KEYS = ["format", "id", "name", "version", "colors", "biomes", "assets", "strings", "locales"];
const SLOT_PREFIXES = "class., enemy., boss., bullet., tile., item., ui., sfx., music.";

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
		for (const [k, v] of sortedEntries(node)) {
			if (!ids && isGameplayKey(k)) {
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
			unknownKeys(def, path, ["kind", "assetId", "w", "h", "tilesPerImage", "pivot"]);
			checkAssetId();
			const imagePivot = def.pivot;
			if (imagePivot !== undefined) {
				const pp = append(path, "pivot");
				if (slot !== UI) {
					err(pp, `only ui.* images have a pivot; slot "${slot.slot}" has none`);
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
			unknownKeys(def, path, ["kind", "assetId", "volume"]);
			checkAssetId();
			const volume = def.volume;
			if (volume !== undefined && (!typeIs(volume, "number") || volume < 0 || volume > 1)) {
				err(append(path, "volume"), "must be a number in [0, 1]");
			}
			break;
		}
		case "silent": {
			unknownKeys(def, path, ["kind"]);
			break;
		}
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
const FACING_COUNT_LIST = (SPRITE_FACING_COUNTS as ReadonlyArray<number>).map((n) => tostring(n)).join(" | ");
const RESAMPLE_LIST = SPRITE_RESAMPLE_MODES.map((m) => q(m)).join(" | ");

/**
 * Sprite contract v2: a `sprites` asset (SpriteSetAsset, types.ts). Every field is checked, and every cell an
 * animation references (all facings, all frames: `start + d * (stride ?? frames) + f`) must lie inside its sheet.
 */
function validateSpriteSet(def: Obj, path: Array<string>, slot: SlotContract, err: Err, unknownKeys: UnknownKeys) {
	unknownKeys(def, path, SPRITE_SET_KEYS);

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
