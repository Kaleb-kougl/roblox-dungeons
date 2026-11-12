// Roblox port (docs/FORTUNE.md FO6): Fortune's theme keys (the PACT slot and its altar, the four colour roles, the eight
// sounds, the optional coin effect, the strings) are in the contract's lists, every bundled pack fills them, the
// placeholder draws the altar as a stone plinth, and fortuneReport holds the Fortune colours (and the Goldling's body) to
// the plan's bars, every check printed. contract.ts names the IDs inline (its compiled Luau sits near the 200-locals
// limit), so these specs are what keeps fortune.ts and contract.ts in step.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PACT_DIM_NAMES, PactDim } from "shared/sim";
import { colorDifference, contrastRatio } from "./color";
import {
	BIOMES,
	ENEMY_ARCHETYPES,
	ENEMY_BULLET_ROLES,
	FX,
	FX_IDS,
	MIN_DECOR_FX_BULLET_DIFFERENCE,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	ROOM_CLEAR_STRING_KEYS,
	SLOTS,
	WORLD_ART_SLOTS,
	isFxId,
	requiredBaseAnimations,
	slotFor,
} from "./contract";
import {
	FORTUNE_AUDIO_IDS,
	FORTUNE_ROLES,
	FORTUNE_SCORE_SOURCE_KEYS,
	FORTUNE_STRING_KEYS,
	GOLDEN_BESTIARY_KEY,
	GOLDEN_COIN_FX_ID,
	GOLDEN_COIN_ROLE,
	HORDE_ROOM_CLEAR_KEY,
	PACT,
	PACT_ALTAR_ID,
	PACT_DIM_STRING_KEYS,
	PACT_ROLES,
	ROOM_EDGE_HORDE_ROLE,
	isPactId,
	pactDimStringKey,
} from "./fortune";
import {
	FORTUNE_COIN_PELLET_RULES,
	FORTUNE_COLOR_RULES,
	GOLDEN_ENEMY_COLOR_RULES,
	MIN_GOLDEN_COIN_PELLET_DIFFERENCE,
	fortuneReport,
} from "./fortuneColors";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_FLOOR_HEX, buildValeManifest } from "./packs/vale";
import { PLACEHOLDER_PROPORTIONS, PLACEHOLDER_VISUALS, pxToStuds } from "./placeholders";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";
import { BESTIARY_ARCHETYPES, BESTIARY_STRING_KEYS } from "./variants";

const has = (list: ReadonlyArray<string>, id: string) => list.includes(id);
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);
const quiet = () => {};

function packsToCheck(): Array<[string, Obj]> {
	const out = new Array<[string, Obj]>();
	for (const id of sortedKeys(THEME_PACKS)) out.push([id, THEME_PACKS[id] as unknown as Obj]);
	const textured = buildValeManifest() as unknown as Obj;
	const biomes = textured.biomes as Obj;
	for (const b of sortedKeys(biomes)) (biomes[b] as Obj).floor = VALE_FLOOR_HEX;
	out.push(["vale (textured floors)", textured]);
	return out;
}

/** The last `n` entries of `list`, in order. */
function tail(list: ReadonlyArray<string>, n: number): string[] {
	const out = new Array<string>();
	for (let i = list.size() - n; i < list.size(); i++) out.push(list[i]);
	return out;
}

const clone = () => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;

describe("fortune: contract", () => {
	it("the PACT slot: required free-size world art (image / sprites with idle / placeholder), one ID, pact.altar", () => {
		expect([PACT.slot, PACT.prefix, PACT.kinds, PACT.cell, PACT.facings]).toEqual([
			"pact",
			"pact.",
			["image", "sprites", "placeholder"],
			undefined,
			[],
		]);
		expect(SLOTS[SLOTS.size() - 1]).toBe(PACT);
		expect(WORLD_ART_SLOTS[WORLD_ART_SLOTS.size() - 1]).toBe(PACT);
		expect(requiredBaseAnimations(PACT)).toEqual(["idle"]);
		expect(PACT_ALTAR_ID).toBe("pact.altar");
		expect(tail(REQUIRED_ASSET_IDS, 1)).toEqual([PACT_ALTAR_ID]);
		expect(slotFor(PACT_ALTAR_ID)).toBe(PACT);
		expect([isPactId("pact.altar"), isPactId("pact.greed"), isPactId("pact"), isPactId("")]).toEqual([
			true,
			false,
			false,
			false,
		]);
		// the pact strings and colour roles are not assets: `pact.greed` the role and `pact.greed.title` the string
		// share the prefix only
		expect(has(REQUIRED_ASSET_IDS, "pact.greed")).toBe(false);
	});

	it("the colour roles are COLOR_ROLES' last four: the Horde edge, the two pacts (PactKind order), the coins", () => {
		expect([...FORTUNE_ROLES]).toEqual(["roomEdge.horde", "pact.greed", "pact.horde", "golden.coin"]);
		expect([...FORTUNE_ROLES]).toEqual([ROOM_EDGE_HORDE_ROLE, ...PACT_ROLES, GOLDEN_COIN_ROLE]);
		expect(tail(COLOR_ROLES as unknown as ReadonlyArray<string>, FORTUNE_ROLES.size())).toEqual([...FORTUNE_ROLES]);
		// the Goldling's own role and asset are the enemy slot's
		expect(ENEMY_ARCHETYPES[ENEMY_ARCHETYPES.size() - 1]).toBe("golden");
		expect(has(COLOR_ROLES as unknown as ReadonlyArray<string>, "enemy.golden")).toBe(true);
	});

	it("appends the eight sounds to PORT_AUDIO_EVENTS: required, sfx; SILENT in the placeholder, a sound in vale", () => {
		expect([...FORTUNE_AUDIO_IDS]).toEqual([
			"sfx.pact.take",
			"sfx.horde.horn",
			"sfx.horde.wave",
			"sfx.horde.double",
			"sfx.golden.appear",
			"sfx.golden.hit",
			"sfx.golden.jackpot",
			"sfx.golden.escape",
		]);
		expect(tail(PORT_AUDIO_EVENTS, FORTUNE_AUDIO_IDS.size())).toEqual([...FORTUNE_AUDIO_IDS]);
		for (const id of FORTUNE_AUDIO_IDS) {
			expect([id, has(REQUIRED_ASSET_IDS, id), slotFor(id)?.soundGroup]).toEqual([id, true, "sfx"]);
			// the vale pack plays them: picked on the audition checklist and uploaded 2026-11-11 (docs/FX_AUDIO.md
			// "Sourcing the remaining silent IDs")
			for (const p of sortedKeys(THEME_PACKS))
				expect([p, id, THEME_PACKS[p].assets[id].kind]).toEqual([p, id, p === "vale" ? "sound" : "silent"]);
		}
	});

	it("the coin burst is an optional fx ID (only vale has it, FO10), tinted by golden.coin under the fx rule", () => {
		expect(GOLDEN_COIN_FX_ID).toBe("fx.golden.coin");
		expect([isFxId(GOLDEN_COIN_FX_ID), slotFor(GOLDEN_COIN_FX_ID), has(FX_IDS, GOLDEN_COIN_FX_ID)]).toEqual([
			true,
			FX,
			true,
		]);
		expect(has(REQUIRED_ASSET_IDS, GOLDEN_COIN_FX_ID)).toBe(false);
		// vale's art (docs/FORTUNE.md FO10, uploaded 2026-11-06): a one-facing sprite set; every other pack has none
		for (const p of sortedKeys(THEME_PACKS)) {
			const kind = (THEME_PACKS[p].assets[GOLDEN_COIN_FX_ID] as { kind: string } | undefined)?.kind;
			expect([p, kind]).toEqual([p, p === "vale" ? "sprites" : undefined]);
		}
		const m = clone();
		(m.assets as Obj)[GOLDEN_COIN_FX_ID] = {
			kind: "sprites",
			frameW: 32,
			frameH: 32,
			pivot: { x: 16, y: 16 },
			pixelsPerTile: 32,
			resample: "Pixelated",
			facings: { count: 1, zeroDeg: 0, ccw: true },
			sheets: [{ assetId: "rbxassetid://7001", w: 128, h: 32 }],
			animations: { play: { sheet: 0, start: 0, frames: 4, fps: 12, loop: false } },
			sizeTiles: 1,
			tint: GOLDEN_COIN_ROLE,
			additive: true,
		};
		expect(validateManifest(m)).toEqual([]);
	});

	it("the strings: cards, dim lines (PACT_DIM_NAMES but none), titles, chips, shouts (required); rows; sighting", () => {
		expect(tail(REQUIRED_STRING_KEYS, FORTUNE_STRING_KEYS.size())).toEqual([...FORTUNE_STRING_KEYS]);
		const dims = new Array<string>();
		for (let d = 0; d < PACT_DIM_NAMES.size(); d++)
			if (d !== PactDim.NONE) dims.push(pactDimStringKey(PACT_DIM_NAMES[d]));
		expect(dims).toEqual([...PACT_DIM_STRING_KEYS]);
		for (const k of PACT_DIM_STRING_KEYS) expect([k, has(FORTUNE_STRING_KEYS, k)]).toEqual([k, true]);
		expect(HORDE_ROOM_CLEAR_KEY).toBe("room.clear.line.horde");
		expect(tail(ROOM_CLEAR_STRING_KEYS, 1)).toEqual([HORDE_ROOM_CLEAR_KEY]);
		// the Goldling's sighting is an archetype's: after the Reaper, before the affixes
		expect(BESTIARY_ARCHETYPES[BESTIARY_ARCHETYPES.size() - 1]).toBe("golden");
		const i = BESTIARY_STRING_KEYS.indexOf(GOLDEN_BESTIARY_KEY);
		expect([BESTIARY_STRING_KEYS[i - 1], BESTIARY_STRING_KEYS[i + 1]]).toEqual([
			"bestiary.reaper",
			"bestiary.affix.hulking",
		]);
		for (const k of [HORDE_ROOM_CLEAR_KEY, GOLDEN_BESTIARY_KEY])
			expect([k, has(REQUIRED_STRING_KEYS, k)]).toEqual([k, true]);
		// like the pellets' rows, the source rows are checked by the view (SCORE_SOURCE_KEYS), not required here
		expect([...FORTUNE_SCORE_SOURCE_KEYS]).toEqual(["score.source.horde", "score.source.golden"]);
		for (const k of FORTUNE_SCORE_SOURCE_KEYS) expect([k, has(REQUIRED_STRING_KEYS, k)]).toEqual([k, false]);
		for (const id of sortedKeys(THEME_PACKS)) {
			const strings = THEME_PACKS[id].strings;
			for (const k of [
				...FORTUNE_STRING_KEYS,
				HORDE_ROOM_CLEAR_KEY,
				...FORTUNE_SCORE_SOURCE_KEYS,
				GOLDEN_BESTIARY_KEY,
			])
				expect([id, k, typeIs(strings[k], "string")]).toEqual([id, k, true]);
		}
		const s = PLACEHOLDER_MANIFEST.strings;
		const english = (keys: ReadonlyArray<string>) => keys.map((k) => s[k]);
		expect(english(FORTUNE_STRING_KEYS)).toEqual([
			"PACT OF GREED",
			"Take: {curse}",
			"Gain: choose a LEGENDARY now",
			"PACT OF THE HORDE",
			"Next room: twice the enemies",
			"Pays: twice the score",
			"{key} Accept",
			"Already taken",
			"No curses left",
			"No legendary to draw",
			"No room left to rouse",
			"Not available",
			"PACT OF GREED",
			"HORDE · next room x2",
			"HORDE x2",
			"WAVE 2",
			"GOLDLING!",
			"It got away!  +{points} banked",
			"+{points} x2",
		]);
		expect(english([HORDE_ROOM_CLEAR_KEY, ...FORTUNE_SCORE_SOURCE_KEYS, GOLDEN_BESTIARY_KEY])).toEqual([
			"Horde x2 +{points}",
			"Horde",
			"Goldling",
			"A Goldling! Catch it before it escapes!",
		]);
		// the placeholders fill through the pack's template syntax
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(pack.str("pact.greed.take", { curse: "Frailty" })).toBe("Take: Frailty");
		expect(pack.str("pact.accept", { key: "1" })).toBe("1 Accept");
		expect(pack.str("fx.golden.escaped", { points: "350" })).toBe("It got away!  +350 banked");
		expect(pack.str(HORDE_ROOM_CLEAR_KEY, { points: "420" })).toBe("Horde x2 +420");
	});
});

describe("fortune: placeholder", () => {
	it("draws the altar as a low stone plinth (a square Block, under a barrel's height), standing on its cell", () => {
		const v = PLACEHOLDER_VISUALS[PACT_ALTAR_ID];
		expect([v.shape, v.color, v.anchor, v.faces, v.material]).toEqual([
			"Block",
			{ kind: "role", role: "uiTextDim" },
			"base",
			false,
			"SmoothPlastic",
		]);
		expect(v.size[0]).toBe(v.size[2]);
		expect(v.size[0]).toBe(pxToStuds(16 * PLACEHOLDER_PROPORTIONS.pactAltar[0]));
		expect(v.size[1]).toBe(pxToStuds(16 * PLACEHOLDER_PROPORTIONS.pactAltar[1]));
		expect(v.size[1] < PLACEHOLDER_VISUALS["breakable.barrel"].size[1]).toBe(true);
		// every pack but vale draws the plinth; vale has its art (docs/FORTUNE.md FO10, uploaded 2026-11-06)
		for (const id of sortedKeys(THEME_PACKS)) {
			const kind = (THEME_PACKS[id].assets[PACT_ALTAR_ID] as { kind: string }).kind;
			expect([id, kind]).toEqual([id, id === "vale" ? "sprites" : "placeholder"]);
		}
		// the stone reads on every floor
		for (const [id, manifest] of packsToCheck()) {
			const stone = (manifest.colors as Obj).uiTextDim as string;
			for (const b of sortedKeys(manifest.biomes as Obj)) {
				const floor = ((manifest.biomes as Obj)[b] as Obj).floor as string;
				expect([id, b, contrastRatio(stone, floor) >= 3]).toEqual([id, b, true]);
			}
		}
	});
});

describe("fortune: fortuneReport", () => {
	it("holds the Fortune colours to the plan's bars, the coins off the pellets, the Goldling off every threat cue", () => {
		expect([...FORTUNE_COLOR_RULES.roles]).toEqual([...FORTUNE_ROLES]);
		expect([...FORTUNE_COLOR_RULES.against]).toEqual([...ENEMY_BULLET_ROLES, "telegraph"]);
		expect([FORTUNE_COLOR_RULES.minFloorContrast, FORTUNE_COLOR_RULES.minDifference]).toEqual([3, 40]);
		expect(FORTUNE_COLOR_RULES.minDifference).toBe(MIN_DECOR_FX_BULLET_DIFFERENCE);
		expect([...FORTUNE_COIN_PELLET_RULES.roles]).toEqual([GOLDEN_COIN_ROLE]);
		expect([...FORTUNE_COIN_PELLET_RULES.against]).toEqual(["pellet.normal"]);
		expect([FORTUNE_COIN_PELLET_RULES.minDifference, MIN_GOLDEN_COIN_PELLET_DIFFERENCE]).toEqual([30, 30]);
		// every other enemy colour keeps this by hand (docs/ENEMY_VARIANTS.md EV1, docs/NEW_ENEMIES.md NE1)
		expect([...GOLDEN_ENEMY_COLOR_RULES.roles]).toEqual(["enemy.golden"]);
		expect([...GOLDEN_ENEMY_COLOR_RULES.against]).toEqual([...ENEMY_BULLET_ROLES, "telegraph", "enemyOutline"]);
		expect(GOLDEN_ENEMY_COLOR_RULES.minDifference).toBe(40);
		const colors = PLACEHOLDER_MANIFEST.colors as unknown as Obj;
		for (const a of ENEMY_ARCHETYPES) {
			for (const against of GOLDEN_ENEMY_COLOR_RULES.against) {
				const d = colorDifference(colors[`enemy.${a}`] as string, colors[against] as string);
				expect([a, against, d >= 40]).toEqual([a, against, true]);
			}
		}
	});

	it("passes for every bundled pack (and vale's textured floor), every check in the report (numbers printed)", () => {
		const rules = FORTUNE_COLOR_RULES;
		for (const [id, manifest] of packsToCheck()) {
			const report = fortuneReport(manifest);
			const count = (check: string) => report.filter((e) => e.check === check).size();
			expect([id, count("floor"), count("difference")]).toEqual([
				id,
				rules.roles.size() * BIOMES.size(),
				rules.roles.size() * rules.against.size() +
					FORTUNE_COIN_PELLET_RULES.against.size() +
					GOLDEN_ENEMY_COLOR_RULES.against.size(),
			]);
			for (const e of report) {
				expect([id, e.role, e.check, e.against, e.ok]).toEqual([id, e.role, e.check, e.against, true]);
				const value =
					e.check === "floor"
						? contrastRatio(e.color, e.againstColor)
						: colorDifference(e.color, e.againstColor);
				expect(e.value).toBe(value);
				print(
					`[fortune] ${id} ${e.role} ${e.color} ${e.check} vs ${e.against}: ${
						e.check === "floor" ? `${fixed2(e.value)}:1` : fixed1(e.value)
					}`,
				);
			}
			if (id !== "vale (textured floors)")
				expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
		}
	});

	it("a Fortune colour that reads as danger, a coin that reads as a pellet, or one that vanishes, fails validation", () => {
		for (const role of FORTUNE_ROLES) {
			for (const against of ["enemyBullet", "telegraph"]) {
				const m = clone();
				const colors = m.colors as Obj;
				colors[role] = colors[against];
				const errors = validateManifest(m);
				expect([role, against, errors.size() > 0]).toEqual([role, against, true]);
				for (const e of errors)
					expect([role, against, e.find(role, 1, true)[0] !== undefined]).toEqual([role, against, true]);
				expect([role, against, errors.some((e) => e.find(`vs ${against}`, 1, true)[0] !== undefined)]).toEqual([
					role,
					against,
					true,
				]);
			}
			const dark = clone();
			(dark.colors as Obj)[role] = "#202020";
			expect([
				role,
				validateManifest(dark).some(
					(e) =>
						e.find("a Horde edge, a pact card or a Goldling coin must read on the floor", 1, true)[0] !==
						undefined,
				),
			]).toEqual([role, true]);
		}
		const pellet = clone();
		(pellet.colors as Obj)[GOLDEN_COIN_ROLE] = (pellet.colors as Obj)["pellet.normal"];
		expect(validateManifest(pellet)).toEqual([
			'colors["golden.coin"]: colour difference: golden.coin #ffff00 vs pellet.normal #ffff00 is 0.0 (CIE76), needs >= 30.0: ' +
				"a Fortune colour must never read as an enemy bullet or a telegraph, a coin never as a pellet, the Goldling never as a threat cue",
		]);
		// FD9's provisional deep gold sat 25.5 from the telegraph orange
		const oldGold = clone();
		(oldGold.colors as Obj)["enemy.golden"] = "#c08000";
		const errors = validateManifest(oldGold);
		expect(errors.size()).toBe(1);
		expect(errors[0].find("enemy.golden #c08000 vs telegraph #ff8a3d is 25.5", 1, true)[0] !== undefined).toBe(
			true,
		);
	});
});

describe("fortune: validator", () => {
	it("a pack missing the altar or a Fortune role fails; an unknown pact ID fails", () => {
		const missing = clone();
		(missing.assets as Obj)[PACT_ALTAR_ID] = undefined;
		expect(
			validateManifest(missing).some(
				(e) => e.find('missing required asset "pact.altar"', 1, true)[0] !== undefined,
			),
		).toBe(true);
		for (const role of FORTUNE_ROLES) {
			const noRole = clone();
			(noRole.colors as Obj)[role] = undefined;
			expect([
				role,
				validateManifest(noRole).some((e) => e.find(`missing color role "${role}"`, 1, true)[0] !== undefined),
			]).toEqual([role, true]);
		}
		const unknown = clone();
		(unknown.assets as Obj)["pact.greed"] = { kind: "placeholder" };
		expect(validateManifest(unknown)).toEqual(['assets["pact.greed"]: unknown pact ID (known: pact.altar)']);
		const noString = clone();
		(noString.strings as Obj)["pact.dim.noRoom"] = undefined;
		expect(validateManifest(noString)).toEqual(['strings: missing required string "pact.dim.noRoom"']);
	});

	it("accepts altar world art: an image with pixelsPerTile and a pivot, or an idle sprite set", () => {
		const m = clone();
		(m.assets as Obj)[PACT_ALTAR_ID] = {
			kind: "image",
			assetId: "rbxassetid://1",
			w: 48,
			h: 48,
			pivot: { x: 24, y: 40 },
			pixelsPerTile: 32,
		};
		expect(validateManifest(m)).toEqual([]);
	});
});
