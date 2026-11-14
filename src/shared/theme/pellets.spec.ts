// Roblox port (docs/PELLETS.md PL6): the pellet keys (the PELLET slot and its two IDs, the colour roles, the three
// sounds, the room clear / results / first-sighting / tutorial strings) are in the contract's lists, every bundled pack
// fills them, the placeholder draws two Block cubes, and pelletReport holds the pellet colours to the plan's bars (every
// check printed). contract.ts names the IDs inline (its compiled Luau sits near the 200-locals limit), so these specs
// are what keeps pellets.ts and contract.ts in step.
import { describe, expect, it } from "@rbxts/jest-globals";
import { SILVER_AUDIO_IDS, SILVER_ROLES, SILVER_STRING_KEYS } from "./silver";
import { colorDifference, contrastRatio } from "./color";
import {
	BIOMES,
	BOOST_ROLES,
	ENEMY_BULLET_ROLES,
	PELLET,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	ROOM_CLEAR_STRING_KEYS,
	SLOTS,
	WORLD_ART_SLOTS,
	requiredBaseAnimations,
	slotFor,
} from "./contract";
import { BUILD_EFFECT_ROLES } from "./builds";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_FLOOR_HEX, buildValeManifest } from "./packs/vale";
import { PLACEHOLDER_PROPORTIONS, PLACEHOLDER_VISUALS, pxToStuds } from "./placeholders";
import {
	MIN_PELLET_BOOST_DIFFERENCE,
	PELLET_BOOST_COLOR_RULES,
	PELLET_COLOR_RULES,
	pelletReport,
} from "./pelletColors";
import {
	PELLET_AUDIO_IDS,
	PELLET_BESTIARY_KEY,
	PELLET_IDS,
	PELLET_KINDS,
	PELLET_ROLES,
	PELLET_ROOM_CLEAR_KEYS,
	PELLET_SCORE_SOURCE_KEYS,
	PELLET_TUTORIAL_PROMPTS,
	isPelletId,
	pelletId,
} from "./pellets";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";
import { BESTIARY_STRING_KEYS } from "./variants";

const has = (list: ReadonlyArray<string>, id: string) => list.includes(id);
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);
const DEVICES = ["keyboard", "gamepad", "touch"];

function packsToCheck(): Array<[string, Obj]> {
	const out = new Array<[string, Obj]>();
	for (const id of sortedKeys(THEME_PACKS)) out.push([id, THEME_PACKS[id] as unknown as Obj]);
	const textured = buildValeManifest() as unknown as Obj;
	const biomes = textured.biomes as Obj;
	for (const b of sortedKeys(biomes)) (biomes[b] as Obj).floor = VALE_FLOOR_HEX;
	out.push(["vale (textured floors)", textured]);
	return out;
}

/** The last `n` entries of `list` before its last `skip` (later features' entries), in order. */
function tail(list: ReadonlyArray<string>, n: number, skip = 0): string[] {
	const out = new Array<string>();
	const last = list.size() - skip;
	for (let i = last - n; i < last; i++) out.push(list[i]);
	return out;
}

/**
 * Entries appended after the pellets': docs/TREASURE.md TR6's 3 asset IDs and 5 colour roles, then docs/FORTUNE.md
 * FO6's 1 asset ID, 4 colour roles and 1 tally segment, then docs/FLOOR_MODIFIERS.md FM7's 5 colour roles, then
 * docs/SECRET_ROOMS.md SR10's 1 colour role (treasure.spec.ts / fortune.spec.ts / floorModifiers.spec.ts /
 * secrets.spec.ts check them).
 */
const AFTER = { assets: 3 + 1, roles: 5 + 4 + 5 + 1 + SILVER_ROLES.size(), roomClear: 1 } as const;

describe("pellets: contract", () => {
	it("two kinds, normal and power; their asset and colour role IDs are `pellet.<kind>`", () => {
		expect([...PELLET_KINDS]).toEqual(["normal", "power"]);
		expect(PELLET_KINDS.map((k) => pelletId(k))).toEqual(["pellet.normal", "pellet.power"]);
		expect([...PELLET_IDS]).toEqual(PELLET_KINDS.map((k) => pelletId(k)));
		expect([...PELLET_ROLES]).toEqual([...PELLET_IDS]);
		for (const id of PELLET_IDS) expect(isPelletId(id)).toBe(true);
		for (const id of ["pellet", "pellet.big", "sfx.pellet.eat", "boost.fury", ""])
			expect(isPelletId(id)).toBe(false);
	});

	it("the PELLET slot: required free-size world art (image / sprites with idle / placeholder), both IDs", () => {
		expect([PELLET.slot, PELLET.prefix, PELLET.kinds, PELLET.cell, PELLET.facings]).toEqual([
			"pellet",
			"pellet.",
			["image", "sprites", "placeholder"],
			undefined,
			[],
		]);
		expect(SLOTS.includes(PELLET)).toBe(true);
		expect(WORLD_ART_SLOTS.includes(PELLET)).toBe(true);
		expect(requiredBaseAnimations(PELLET)).toEqual(["idle"]);
		expect(tail(REQUIRED_ASSET_IDS, PELLET_IDS.size(), AFTER.assets)).toEqual([...PELLET_IDS]);
		for (const id of PELLET_IDS) expect([id, slotFor(id)]).toEqual([id, PELLET]);
		// the pellet sounds stay in the sfx slot
		for (const id of PELLET_AUDIO_IDS) expect([id, slotFor(id)?.slot]).toEqual([id, "sfx"]);
	});

	it("the colour roles are COLOR_ROLES' last two before the treasure rooms' and Fortune's", () => {
		expect(tail(COLOR_ROLES as unknown as ReadonlyArray<string>, PELLET_ROLES.size(), AFTER.roles)).toEqual([
			...PELLET_ROLES,
		]);
	});

	it("appends the three sounds to PORT_AUDIO_EVENTS: required, sfx; SILENT in the placeholder, on in vale", () => {
		expect([...PELLET_AUDIO_IDS]).toEqual(["sfx.pellet.eat", "sfx.pellet.sweep", "sfx.pellet.power"]);
		// the pellets' block ends at sfx.pellet.power (docs/RUN_RECAP.md CM4's two, docs/TREASURE.md TR6's four and
		// docs/FORTUNE.md FO6's eight come after it)
		const blockEnd = (PORT_AUDIO_EVENTS as ReadonlyArray<string>).indexOf("sfx.pellet.power") + 1;
		const block = new Array<string>();
		for (let i = blockEnd - PELLET_AUDIO_IDS.size(); i < blockEnd; i++) block.push(PORT_AUDIO_EVENTS[i]);
		expect(block).toEqual([...PELLET_AUDIO_IDS]);
		// vale (owner, 2026-11-03): the Pixabay chomp, swoosh and power-up are uploaded
		const valeOn = new Set<string>(["sfx.pellet.eat", "sfx.pellet.sweep", "sfx.pellet.power"]);
		for (const id of PELLET_AUDIO_IDS) {
			expect([id, has(REQUIRED_ASSET_IDS, id), slotFor(id)?.soundGroup]).toEqual([id, true, "sfx"]);
			for (const p of sortedKeys(THEME_PACKS)) {
				const kind = p === "vale" && valeOn.has(id) ? "sound" : "silent";
				expect([p, id, THEME_PACKS[p].assets[id].kind]).toEqual([p, id, kind]);
			}
		}
	});

	it("the strings: tally segments (required), results rows, the power pellet's sighting line, the lesson prompts", () => {
		expect([...PELLET_ROOM_CLEAR_KEYS]).toEqual(["room.clear.line.pellets", "room.clear.line.sweep"]);
		expect(tail(ROOM_CLEAR_STRING_KEYS, PELLET_ROOM_CLEAR_KEYS.size(), AFTER.roomClear)).toEqual([
			...PELLET_ROOM_CLEAR_KEYS,
		]);
		expect([...PELLET_SCORE_SOURCE_KEYS]).toEqual(["score.source.pellets", "score.source.sweep"]);
		expect(PELLET_BESTIARY_KEY).toBe("bestiary.pellet.power");
		// docs/GOLDLING_RUMOURS.md GR7's card (bestiary.golden.rumour), then docs/SECRET_ROOMS.md SR10's
		// (bestiary.secret.crack) come after it
		expect(tail(BESTIARY_STRING_KEYS, 1, 2)).toEqual([PELLET_BESTIARY_KEY]);
		for (const k of [...PELLET_ROOM_CLEAR_KEYS, PELLET_BESTIARY_KEY]) {
			expect([k, has(REQUIRED_STRING_KEYS, k)]).toEqual([k, true]);
		}
		// like score.source.jackpot, the source rows are checked by the view (SCORE_SOURCE_KEYS), not required here
		for (const k of PELLET_SCORE_SOURCE_KEYS) expect([k, has(REQUIRED_STRING_KEYS, k)]).toEqual([k, false]);
		const prompts = new Array<string>();
		for (const p of PELLET_TUTORIAL_PROMPTS) for (const d of DEVICES) prompts.push(`tutorial.prompt.${p}.${d}`);
		for (const id of sortedKeys(THEME_PACKS)) {
			const strings = THEME_PACKS[id].strings;
			for (const k of [...PELLET_ROOM_CLEAR_KEYS, ...PELLET_SCORE_SOURCE_KEYS, PELLET_BESTIARY_KEY, ...prompts]) {
				expect([id, k, typeIs(strings[k], "string")]).toEqual([id, k, true]);
			}
			for (const k of PELLET_ROOM_CLEAR_KEYS) {
				expect([id, k, (strings[k] as string).find("{points}", 1, true)[0] !== undefined]).toEqual([
					id,
					k,
					true,
				]);
			}
		}
		const s = PLACEHOLDER_MANIFEST.strings;
		expect([s["room.clear.line.pellets"], s["room.clear.line.sweep"]]).toEqual([
			"Pellets {points}",
			"Sweep +{points}",
		]);
		expect([s["score.source.pellets"], s["score.source.sweep"]]).toEqual(["Pellets", "Sweeps"]);
	});
});

describe("pellets: placeholder", () => {
	it("draws a small Block cube per kind in its colour role (the power pellet bigger), standing on the floor", () => {
		const normal = PLACEHOLDER_VISUALS["pellet.normal"];
		const power = PLACEHOLDER_VISUALS["pellet.power"];
		for (const [kind, v] of [
			["normal", normal],
			["power", power],
		] as const) {
			expect([kind, v.shape, v.color, v.anchor, v.faces, v.material]).toEqual([
				kind,
				"Block",
				{ kind: "role", role: `pellet.${kind}` },
				"base",
				false,
				"SmoothPlastic",
			]);
			// a cube
			expect([kind, v.size[0] === v.size[1] && v.size[1] === v.size[2]]).toEqual([kind, true]);
		}
		expect(normal.size[0]).toBe(pxToStuds(16 * PLACEHOLDER_PROPORTIONS.pellet[0]));
		expect(power.size[0] > normal.size[0]).toBe(true);
		// every bundled pack draws the placeholder cube, but vale, whose pellet PNGs are uploaded (2026-11-03, PL8)
		for (const id of sortedKeys(THEME_PACKS)) {
			for (const pid of PELLET_IDS)
				expect([id, pid, THEME_PACKS[id].assets[pid].kind]).toEqual([
					id,
					pid,
					id === "vale" ? "image" : "placeholder",
				]);
		}
	});
});

describe("pellets: pelletReport", () => {
	it("holds both pellet colours to the plan's bars", () => {
		expect([...PELLET_COLOR_RULES.roles]).toEqual([...PELLET_ROLES]);
		expect([...PELLET_COLOR_RULES.against]).toEqual([
			...ENEMY_BULLET_ROLES,
			"telegraph",
			...BUILD_EFFECT_ROLES,
			"playerOutline",
		]);
		expect([PELLET_COLOR_RULES.minFloorContrast, PELLET_COLOR_RULES.minDifference]).toEqual([3, 40]);
		// The boosts: a lower bar (owner, 2026-11-03: yellow pellets; a cube never reads as a coin or gem).
		expect([...PELLET_BOOST_COLOR_RULES.roles]).toEqual([...PELLET_ROLES]);
		expect([...PELLET_BOOST_COLOR_RULES.against]).toEqual([...BOOST_ROLES]);
		expect([PELLET_BOOST_COLOR_RULES.minDifference, MIN_PELLET_BOOST_DIFFERENCE]).toEqual([30, 30]);
	});

	it("passes for every bundled pack (and vale's textured floor), every check in the report (numbers printed)", () => {
		const rules = PELLET_COLOR_RULES;
		for (const [id, manifest] of packsToCheck()) {
			const report = pelletReport(manifest);
			const count = (check: string) => report.filter((e) => e.check === check).size();
			expect([id, count("floor"), count("difference")]).toEqual([
				id,
				rules.roles.size() * BIOMES.size(),
				rules.roles.size() * (rules.against.size() + PELLET_BOOST_COLOR_RULES.against.size()),
			]);
			for (const e of report) {
				expect([id, e.role, e.check, e.against, e.ok]).toEqual([id, e.role, e.check, e.against, true]);
				const value =
					e.check === "floor"
						? contrastRatio(e.color, e.againstColor)
						: colorDifference(e.color, e.againstColor);
				expect(e.value).toBe(value);
				print(
					`[pellet] ${id} ${e.role} ${e.check} vs ${e.against}: ${
						e.check === "floor" ? `${fixed2(e.value)}:1` : fixed1(e.value)
					}`,
				);
			}
			if (id !== "vale (textured floors)")
				expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
		}
	});

	it("a pellet colour that reads as danger, a boost or the player outline, or vanishes on a floor, fails validation", () => {
		for (const against of ["enemyBullet", "telegraph", "boost.frenzy", "build.spark", "playerOutline"]) {
			const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
			const colors = m.colors as Obj;
			colors["pellet.normal"] = colors[against];
			const errors = validateManifest(m);
			expect([against, errors.size() > 0]).toEqual([against, true]);
			for (const e of errors)
				expect([against, e.find("pellet.normal", 1, true)[0] !== undefined]).toEqual([against, true]);
			expect([against, errors.some((e) => e.find(`vs ${against}`, 1, true)[0] !== undefined)]).toEqual([
				against,
				true,
			]);
		}
		const dark = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(dark.colors as Obj)["pellet.power"] = "#202020";
		expect(
			validateManifest(dark).some((e) => e.find("a pellet must read on the floor", 1, true)[0] !== undefined),
		).toBe(true);
	});
});

describe("pellets: validator", () => {
	it("a pack missing a pellet asset or its role fails; an unknown pellet ID fails", () => {
		const missing = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(missing.assets as Obj)["pellet.power"] = undefined;
		expect(
			validateManifest(missing).some(
				(e) => e.find('missing required asset "pellet.power"', 1, true)[0] !== undefined,
			),
		).toBe(true);
		const noRole = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(noRole.colors as Obj)["pellet.normal"] = undefined;
		expect(validateManifest(noRole).some((e) => e.find("pellet.normal", 1, true)[0] !== undefined)).toBe(true);
		const unknown = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(unknown.assets as Obj)["pellet.big"] = { kind: "placeholder" };
		expect(validateManifest(unknown)).toEqual([
			'assets["pellet.big"]: unknown pellet ID (known: pellet.normal, pellet.power)',
		]);
	});

	it("accepts pellet world art: an image with pixelsPerTile, or an idle sprite set", () => {
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(m.assets as Obj)["pellet.normal"] = {
			kind: "image",
			assetId: "rbxassetid://1",
			w: 32,
			h: 12,
			rect: { x: 0, y: 0, w: 9, h: 10 },
			pivot: { x: 4, y: 7 },
			pixelsPerTile: 29.6,
		};
		expect(validateManifest(m)).toEqual([]);
	});
});
