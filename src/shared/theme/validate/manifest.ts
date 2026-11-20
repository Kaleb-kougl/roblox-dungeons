/** validateManifest (docs/CODEBASE_SCALE.md DX8: a pure move out of validate.ts): the manifest's top level, biomes, colours, strings and every asset entry. */
import {
	AMBIENCE,
	AMBIENCE_IDS,
	BIOMES,
	BOOST,
	BOOST_KINDS,
	DECOR,
	DECOR_ID_FORMS,
	FX,
	FX_IDS,
	MIN_ENEMY_BULLET_CONTRAST,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	SOUND_PRESENTATION_KEYS,
	boostId,
	isAmbienceId,
	isBoostId,
	isFxId,
	parseDecorId,
	slotFor,
} from "../contract";
import {
	append,
	describeValue,
	hasKey,
	isArrayLike,
	isObj,
	matches,
	quote as q,
	sortedEntries,
	startsWith,
	type Obj,
} from "../util";
import { BIOME_TILE_KEYS, COLOR_ROLES, MANIFEST_FORMAT } from "../types";
import { isHexColor } from "../color";
import { variantColorProblems } from "../variantColors";
import { newBestColorProblems } from "../newBestColors";
import { voidColorProblems } from "../voidColors";
import { boostAuraArtProblems } from "../boostAuraArt";
import * as Strings from "../strings";
import {
	COLOR_ROLE_SET,
	PACK_ID_PATTERN,
	fixed1,
	fixed2,
	fmtPath,
	isAssetId,
	isGameplayKey,
	isLocale,
	isStringKey,
	keysAreIds,
	type Err,
	type UnknownKeys,
	type ValidateOptions,
} from "./helpers";
import { validateAsset, validateBiomeMaterials } from "./assets";
import {
	SURFACES,
	boonRarityReport,
	boostColorReport,
	boostHaloProblems,
	breakableContrastReport,
	comboReport,
	contrastReport,
	decorFxReport,
	enemyOutlineReport,
	fxColorReport,
	juiceContrastReport,
	minimapReport,
	nearMissReport,
	playerOutlineReport,
	roomEdgeReport,
} from "./reports";

const TOP_LEVEL_KEYS = ["format", "id", "name", "version", "colors", "biomes", "assets", "strings", "locales"];
const SLOT_PREFIXES =
	"class., enemy., boss., bullet., tile., item., ui., sfx., music., decor., breakable., amb., fx., boost., pellet., treasure., pact., secret.";
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
			const problem = Strings.templateProblem(text);
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
						// Braces, then the English placeholder multiset (a translation that drops {score} is broken).
						const problem =
							Strings.templateProblem(text) ?? Strings.placeholderMismatch(strings[key], text);
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
			err(
				path,
				`unknown decor ID (use ${DECOR_ID_FORMS}; kinds: contract.ts DECOR_KINDS, lowercase; VOID_DECOR.kinds)`,
			);
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
		if (slot === BOOST && !isBoostId(assetId)) {
			err(path, `unknown boost ID (known: ${BOOST_KINDS.map((k) => boostId(k)).join(", ")})`);
			continue;
		}
		// docs/PELLETS.md PL6: the two pellet IDs (pellets.ts PELLET_IDS), written out: no new top-level local here
		if (slot.slot === "pellet" && assetId !== "pellet.normal" && assetId !== "pellet.power") {
			err(path, "unknown pellet ID (known: pellet.normal, pellet.power)");
			continue;
		}
		// docs/TREASURE.md TR6: the three treasure IDs (treasure.ts TREASURE_IDS), written out: no new top-level local
		if (
			slot.slot === "treasure" &&
			assetId !== "treasure.chest" &&
			assetId !== "treasure.chestopen" &&
			assetId !== "treasure.cage"
		) {
			err(path, "unknown treasure ID (known: treasure.chest, treasure.chestopen, treasure.cage)");
			continue;
		}
		// docs/FORTUNE.md FO6: the one pact ID (fortune.ts PACT_ALTAR_ID), written out likewise
		if (slot.slot === "pact" && assetId !== "pact.altar") {
			err(path, "unknown pact ID (known: pact.altar)");
			continue;
		}
		// docs/SECRET_ROOMS.md SR10: the two optional secret IDs (secrets.ts SECRET_ART_IDS), written out likewise
		if (slot.slot === "secret" && assetId !== "secret.crack" && assetId !== "secret.rubble") {
			err(path, "unknown secret ID (known: secret.crack, secret.rubble)");
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
		unknownKeys(def, path, ["name", "floor", "wall", "shoulder", "abyss", "tiles", "materials"]);
		if (!typeIs(def.name, "string")) {
			err(append(path, "name"), "must be a string-table key");
		} else if (!hasKey(strings, def.name)) {
			err(append(path, "name"), `string key ${q(def.name)} is not in strings`);
		}
		// floor and wall, then the void's shoulder and abyss (docs/VOID_DECOR.md VD1), all required
		for (const s of [...SURFACES, "shoulder", "abyss"]) {
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

	// --- the enemy outline reads on every biome and never as an enemy bullet -----------------------
	for (const c of enemyOutlineReport(manifest)) {
		if (c.ok) {
			continue;
		}
		if (c.check === "surface") {
			err(
				["colors", "enemyOutline"],
				`contrast: enemyOutline ${c.color} on ${c.against}${forgeSuffix(c.against)} ${tostring(c.surface)} ${
					c.againstColor
				} is ${fixed2(c.value)}:1, needs >= ${fixed1(c.min)}:1`,
			);
		} else {
			err(
				["colors", "enemyOutline"],
				`colour difference: enemyOutline ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(
					c.value,
				)} (CIE76), needs >= ${fixed1(c.min)}: an enemy outline must never read as an enemy bullet`,
			);
		}
	}

	// --- the player outline reads on every biome and never as a threat or a boost ------------------
	for (const c of playerOutlineReport(manifest)) {
		if (c.ok) {
			continue;
		}
		if (c.check === "surface") {
			err(
				["colors", "playerOutline"],
				`contrast: playerOutline ${c.color} on ${c.against}${forgeSuffix(c.against)} ${tostring(c.surface)} ${
					c.againstColor
				} is ${fixed2(c.value)}:1, needs >= ${fixed1(c.min)}:1`,
			);
		} else {
			err(
				["colors", "playerOutline"],
				`colour difference: playerOutline ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(
					c.value,
				)} (CIE76), needs >= ${fixed1(c.min)}: the player's outline must never read as a threat or a boost`,
			);
		}
	}

	// --- boost drops read on every biome and never as an enemy bullet ------------------------------
	for (const c of boostColorReport(manifest)) {
		if (c.ok) {
			continue;
		}
		if (c.check === "surface") {
			err(
				["colors", c.role],
				`contrast: ${c.role} ${c.color} on ${c.against}${forgeSuffix(c.against)} ${tostring(c.surface)} ${
					c.againstColor
				} is ${fixed2(c.value)}:1, needs >= ${fixed1(c.min)}:1`,
			);
		} else {
			err(
				["colors", c.role],
				`colour difference: ${c.role} ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(
					c.value,
				)} (CIE76), needs >= ${fixed1(c.min)}: a boost drop must never read as an enemy bullet`,
			);
		}
	}

	// --- room edges read on every biome floor and never as an enemy bullet or a telegraph ----------
	for (const c of roomEdgeReport(manifest)) {
		if (c.ok) {
			continue;
		}
		if (c.check === "floor") {
			err(
				["colors", c.role],
				`contrast: ${c.role} ${c.color} on ${c.against}${forgeSuffix(c.against)} floor ${c.againstColor} is ` +
					`${fixed2(c.value)}:1, needs >= ${fixed1(c.min)}:1`,
			);
		} else {
			err(
				["colors", c.role],
				`colour difference: ${c.role} ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(
					c.value,
				)} (CIE76), needs >= ${fixed1(c.min)}: a room edge must never read as an enemy bullet or a telegraph`,
			);
		}
	}

	// --- minimap markers read on the map and an enemy dot never as a friend or a pickup -----------
	for (const c of minimapReport(manifest)) {
		if (c.ok) {
			continue;
		}
		if (c.check === "background") {
			err(
				["colors", c.role],
				`contrast: ${c.role} ${c.color} on ${c.against} ${c.againstColor} is ${fixed2(
					c.value,
				)}:1, needs >= ${fixed1(c.min)}:1`,
			);
		} else {
			err(
				["colors", c.role],
				`colour difference: ${c.role} ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(
					c.value,
				)} (CIE76), needs >= ${fixed1(c.min)}: an enemy dot must never read as a teammate or a pickup`,
			);
		}
	}

	// --- combo tiers read on the panel and apart, the shout never as a bullet, the break as grey ----
	for (const c of comboReport(manifest)) {
		if (c.ok) {
			continue;
		}
		if (c.check === "panel") {
			err(
				["colors", c.role],
				`contrast: ${c.role} ${c.color} on ${c.against} ${tostring(c.againstColor)} is ${fixed2(
					c.value,
				)}:1, needs >= ${fixed1(c.limit)}:1: a combo tier must read on the score panel`,
			);
		} else if (c.check === "chroma") {
			err(
				["colors", c.role],
				`chroma: ${c.role} ${c.color} has C* ${fixed1(c.value)} (CIE LCh), needs <= ${fixed1(
					c.limit,
				)}: a broken combo must read as grey`,
			);
		} else {
			let why = "a broken combo must never read as a live tier";
			if (c.check === "step") {
				why = "each combo tier must read as a new colour after the one below it";
			} else if (c.check === "shout") {
				why =
					"a combo tier must never read as an enemy bullet or a telegraph (the floor shout lies under bullets)";
			}
			err(
				["colors", c.role],
				`colour difference: ${c.role} ${c.color} vs ${c.against} ${tostring(c.againstColor)} is ${fixed1(
					c.value,
				)} (CIE76), needs >= ${fixed1(c.limit)}: ${why}`,
			);
		}
	}

	// --- near-miss sparks and the PARRY! text read on every floor and never as a bullet --------------
	for (const c of nearMissReport(manifest)) {
		if (c.ok) {
			continue;
		}
		if (c.check === "floor") {
			err(
				["colors", c.role],
				`contrast: ${c.role} ${c.color} on ${c.against}${forgeSuffix(c.against)} floor ${c.againstColor} is ` +
					`${fixed2(c.value)}:1, needs >= ${fixed1(c.min)}:1: a near miss must read on the floor`,
			);
		} else {
			err(
				["colors", c.role],
				`colour difference: ${c.role} ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(
					c.value,
				)} (CIE76), needs >= ${fixed1(c.min)}: a near miss must never read as an enemy bullet or a telegraph ` +
					"(its sparks fly among bullets, the PARRY! text lies under them)",
			);
		}
	}

	// --- boon rarities read on the panel and apart step to step (docs/DRAFT_REVEAL.md DR3) ------------
	for (const c of boonRarityReport(manifest)) {
		if (c.ok) {
			continue;
		}
		if (c.check === "panel") {
			err(
				["colors", c.role],
				`contrast: ${c.role} ${c.color} on ${c.against} ${c.againstColor} is ${fixed2(
					c.value,
				)}:1, needs >= ${fixed1(c.limit)}:1: a boon rarity must read on the draft card`,
			);
		} else {
			err(
				["colors", c.role],
				`colour difference: ${c.role} ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(
					c.value,
				)} (CIE76), needs >= ${fixed1(
					c.limit,
				)}: each boon rarity must read as a new colour after the one below it`,
			);
		}
	}

	// --- affix rings read on every floor, apart and never as a threat; goo reads as danger (docs/ENEMY_VARIANTS.md EV1)
	for (const problem of variantColorProblems(manifest, forgeSuffix)) {
		err(problem.path, problem.msg);
	}

	// --- the new-best gold reads on the panel, apart from the combo ladder, never as a threat (docs/NEW_BEST.md NB4)
	for (const problem of newBestColorProblems(manifest)) {
		err(problem.path, problem.msg);
	}

	// --- the void's shoulder reads as wall, darkens into the abyss, never hides a bullet (docs/VOID_DECOR.md VD1)
	for (const problem of voidColorProblems(manifest)) {
		err(problem.path, problem.msg);
	}

	// --- boost art needs its halo (docs/BOOST_ART.md BA-P2) ---------------------------------------
	for (const message of boostHaloProblems(assets)) {
		err(message.path, message.msg);
	}

	// --- a boost aura's per-rank rings (docs/BOOST_ART.md BAD3; boostAuraArt.ts) -----------------
	for (const problem of boostAuraArtProblems(manifest)) {
		err(problem.path, problem.msg);
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
