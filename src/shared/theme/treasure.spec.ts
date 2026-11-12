// Roblox port (docs/TREASURE.md TR6): the treasure keys (the TREASURE slot and its three looks, the column effect, the
// colour roles, the four sounds, the strings) are in the contract's lists, every bundled pack fills them, the
// placeholder draws a box, a lid wedge and a row of bars, and treasureReport holds the colours to the plan's bars
// (every check printed). Conflict C2's numbers: the draft's boon.* colours measured as floor colours (printed; rare
// and legendary fail the telegraph bar, which is why the floor has its own treasure.* roles). contract.ts names the
// IDs inline (its compiled Luau sits near the 200-locals limit), so these specs keep treasure.ts and contract.ts in
// step.
import { describe, expect, it } from "@rbxts/jest-globals";
import { VaultLock, VaultTier } from "shared/dungeon";
import { colorDifference, contrastRatio } from "./color";
import {
	BIOMES,
	BOON_RARITY_ROLES,
	FX_IDS,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	ROOM_EDGE_DIFFERENCE_ROLES,
	SLOTS,
	TREASURE,
	WORLD_ART_SLOTS,
	isFxId,
	requiredBaseAnimations,
	slotFor,
} from "./contract";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_FLOOR_HEX, buildValeManifest } from "./packs/vale";
import { VALE_FX_PENDING } from "./packs/vale/fx";
import { VALE_TREASURE_FX_SHEET } from "./packs/vale/treasureLayout";
import { CAGE_BAR_GAP_PX, PLACEHOLDER_PROPORTIONS, PLACEHOLDER_VISUALS, pxToStuds } from "./placeholders";
import { placeholders } from "./strings";
import {
	TREASURE_AUDIO_IDS,
	TREASURE_CAGE_ID,
	TREASURE_CHEST_ID,
	TREASURE_CHEST_OPEN_ID,
	TREASURE_COLUMN_FX_ID,
	TREASURE_FLOOR_ROLES,
	TREASURE_IDS,
	TREASURE_LOCKS,
	TREASURE_PIECE_ROLES,
	TREASURE_SCORE_SOURCE_KEY,
	TREASURE_STRING_KEYS,
	TREASURE_TIERS,
	TREASURE_UI_ROLES,
	treasureFloorRole,
	treasureLockNameKey,
	treasureTierNameKey,
	treasureUiRole,
} from "./treasure";
import { TREASURE_COLOR_RULES, treasureReport } from "./treasureColors";
import { FORTUNE_AUDIO_IDS, FORTUNE_ROLES, FORTUNE_STRING_KEYS } from "./fortune";
import { FLOOR_MODIFIER_AUDIO_IDS, FLOOR_MODIFIER_ROLES, FLOOR_MODIFIER_STRING_KEYS } from "./floorModifiers";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";

const has = (list: ReadonlyArray<string>, id: string) => list.includes(id);
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);

function packsToCheck(): Array<[string, Obj]> {
	const out = new Array<[string, Obj]>();
	for (const id of sortedKeys(THEME_PACKS)) out.push([id, THEME_PACKS[id] as unknown as Obj]);
	const textured = buildValeManifest() as unknown as Obj;
	const biomes = textured.biomes as Obj;
	for (const b of sortedKeys(biomes)) (biomes[b] as Obj).floor = VALE_FLOOR_HEX;
	out.push(["vale (textured floors)", textured]);
	return out;
}

/** The last `n` entries of `list` before its last `skip` (docs/FORTUNE.md FO6's entries come after), in order. */
function tail(list: ReadonlyArray<string>, n: number, skip = 0): string[] {
	const out = new Array<string>();
	const last = list.size() - skip;
	for (let i = last - n; i < last; i++) out.push(list[i]);
	return out;
}

/**
 * Entries docs/FORTUNE.md FO6 appended after the treasure rooms' (fortune.spec.ts checks them), then docs/FLOOR_MODIFIERS.md
 * FM7's (floorModifiers.spec.ts).
 */
const FORTUNE_AFTER = {
	assets: 1,
	roles: FORTUNE_ROLES.size() + FLOOR_MODIFIER_ROLES.size(),
	audio: FORTUNE_AUDIO_IDS.size() + FLOOR_MODIFIER_AUDIO_IDS.size(),
} as const;

function printEntry(tag: string, id: string, e: ReturnType<typeof treasureReport>[number]): void {
	const value = e.check === "difference" ? fixed1(e.value) : `${fixed2(e.value)}:1`;
	print(`[${tag}] ${id} ${e.role} ${e.color} ${e.check} vs ${e.against} ${e.againstColor}: ${value} (${e.ok})`);
}

describe("treasure: contract", () => {
	it("tiers and locks follow shared/dungeon VaultTier / VaultLock; the name keys follow them", () => {
		expect([...TREASURE_TIERS]).toEqual(["common", "rare", "legendary"]);
		expect([VaultTier.COMMON, VaultTier.RARE, VaultTier.LEGENDARY]).toEqual([0, 1, 2]);
		expect([...TREASURE_LOCKS]).toEqual(["untouched", "swift"]);
		expect([VaultLock.UNTOUCHED, VaultLock.SWIFT]).toEqual([0, 1]);
		expect([0, 1, 2].map((t) => treasureTierNameKey(t))).toEqual([
			"boon.rarity.common",
			"boon.rarity.rare",
			"boon.rarity.legendary",
		]);
		expect([VaultLock.UNTOUCHED, VaultLock.SWIFT].map((l) => treasureLockNameKey(l))).toEqual([
			"treasure.lock.untouched",
			"treasure.lock.swift",
		]);
		expect([0, 1, 2].map((t) => treasureFloorRole(t))).toEqual([...TREASURE_FLOOR_ROLES]);
		expect([0, 1, 2].map((t) => treasureUiRole(t))).toEqual([...TREASURE_UI_ROLES]);
	});

	it("the TREASURE slot: required free-size world art (image / sprites with idle / placeholder), three IDs", () => {
		expect([TREASURE.slot, TREASURE.prefix, TREASURE.kinds, TREASURE.cell, TREASURE.facings]).toEqual([
			"treasure",
			"treasure.",
			["image", "sprites", "placeholder"],
			undefined,
			[],
		]);
		expect(SLOTS.includes(TREASURE)).toBe(true);
		expect(WORLD_ART_SLOTS.includes(TREASURE)).toBe(true);
		expect(requiredBaseAnimations(TREASURE)).toEqual(["idle"]);
		expect([...TREASURE_IDS]).toEqual(["treasure.chest", "treasure.chestopen", "treasure.cage"]);
		expect([TREASURE_CHEST_ID, TREASURE_CHEST_OPEN_ID, TREASURE_CAGE_ID]).toEqual([...TREASURE_IDS]);
		expect(tail(REQUIRED_ASSET_IDS, TREASURE_IDS.size(), FORTUNE_AFTER.assets)).toEqual([...TREASURE_IDS]);
		for (const id of TREASURE_IDS) expect([id, slotFor(id)]).toEqual([id, TREASURE]);
		// the sounds stay in the sfx slot, the column in fx (optional: not required)
		for (const id of TREASURE_AUDIO_IDS) expect([id, slotFor(id)?.slot]).toEqual([id, "sfx"]);
		expect([TREASURE_COLUMN_FX_ID, slotFor(TREASURE_COLUMN_FX_ID)?.slot]).toEqual(["fx.treasure.column", "fx"]);
	});

	it("the light column is FX_IDS' last entry, optional: vale draws it (TR9) once its own sheet has an ID", () => {
		expect(tail(FX_IDS, 1)).toEqual([TREASURE_COLUMN_FX_ID]);
		expect(isFxId(TREASURE_COLUMN_FX_ID)).toBe(true);
		expect(has(REQUIRED_ASSET_IDS, TREASURE_COLUMN_FX_ID)).toBe(false);
		expect(VALE_FX_PENDING.includes(TREASURE_COLUMN_FX_ID)).toBe(false);
		expect(PLACEHOLDER_MANIFEST.assets[TREASURE_COLUMN_FX_ID]).toBe(undefined);
		const sheet = VALE_TREASURE_FX_SHEET.file;
		expect(buildValeManifest({}).assets[TREASURE_COLUMN_FX_ID]).toBe(undefined);
		expect(buildValeManifest({ [sheet]: "rbxassetid://7300" }).assets[TREASURE_COLUMN_FX_ID]?.kind).toBe("sprites");
	});

	it("the colour roles are COLOR_ROLES' last five before Fortune's; the UI tiers are the draft's boon.* roles", () => {
		const roles = [...TREASURE_PIECE_ROLES, ...TREASURE_FLOOR_ROLES];
		expect(roles).toEqual([
			"treasure.chest",
			"treasure.cage",
			"treasure.common",
			"treasure.rare",
			"treasure.legendary",
		]);
		expect(tail(COLOR_ROLES as unknown as ReadonlyArray<string>, roles.size(), FORTUNE_AFTER.roles)).toEqual(roles);
		expect([...TREASURE_UI_ROLES]).toEqual([...BOON_RARITY_ROLES]);
	});

	it("appends the four sounds to PORT_AUDIO_EVENTS: required, sfx, SILENT in every bundled pack", () => {
		expect([...TREASURE_AUDIO_IDS]).toEqual([
			"sfx.treasure.crack",
			"sfx.treasure.unlock",
			"sfx.treasure.open",
			"sfx.jingle.treasure",
		]);
		expect(tail(PORT_AUDIO_EVENTS, TREASURE_AUDIO_IDS.size(), FORTUNE_AFTER.audio)).toEqual([
			...TREASURE_AUDIO_IDS,
		]);
		for (const id of TREASURE_AUDIO_IDS) {
			expect([id, has(REQUIRED_ASSET_IDS, id), slotFor(id)?.soundGroup]).toEqual([id, true, "sfx"]);
			for (const p of sortedKeys(THEME_PACKS)) {
				expect([p, id, THEME_PACKS[p].assets[id].kind]).toEqual([p, id, "silent"]);
			}
		}
	});

	it("the strings: REQUIRED_STRING_KEYS' last sixteen before Fortune's, filled by every pack with the placeholders the view fills", () => {
		const skip = FORTUNE_STRING_KEYS.size() + FLOOR_MODIFIER_STRING_KEYS.size();
		expect(tail(REQUIRED_STRING_KEYS, TREASURE_STRING_KEYS.size(), skip)).toEqual([...TREASURE_STRING_KEYS]);
		expect(TREASURE_STRING_KEYS.size()).toBe(16);
		expect(new Set(TREASURE_STRING_KEYS).size()).toBe(TREASURE_STRING_KEYS.size());
		// like score.source.pellets, the source row is checked by the view (SCORE_SOURCE_KEYS), not required here
		expect(TREASURE_SCORE_SOURCE_KEY).toBe("score.source.treasure");
		expect(has(REQUIRED_STRING_KEYS, TREASURE_SCORE_SOURCE_KEY)).toBe(false);
		const fields: Record<string, string[]> = {
			"hud.toast.vault": [],
			"hud.toast.vaultLock.untouched": [],
			"hud.toast.vaultLock.untouchedParty": ["hits"],
			"hud.toast.vaultLock.swift": ["time"],
			"treasure.lock.untouched": [],
			"treasure.lock.swift": [],
			"treasure.unlocked": ["lock"],
			"treasure.spareTime": ["lock", "seconds"],
			"treasure.spareHits": ["hits", "lock"],
			"treasure.kept": ["tier"],
			"treasure.nearMiss.time": ["seconds"],
			"treasure.nearMiss.hits": ["hits"],
			"treasure.reward.relic": ["name"],
			"treasure.reward.draft": [],
			"treasure.reward.boosts": ["count"],
			"treasure.reward.points": ["points"],
		};
		expect(sortedKeys(fields)).toEqual([...TREASURE_STRING_KEYS].sort());
		for (const id of sortedKeys(THEME_PACKS)) {
			const strings = THEME_PACKS[id].strings;
			for (const k of [
				...TREASURE_STRING_KEYS,
				TREASURE_SCORE_SOURCE_KEY,
				...[0, 1, 2].map(treasureTierNameKey),
			]) {
				expect([id, k, typeIs(strings[k], "string")]).toEqual([id, k, true]);
			}
			for (const k of TREASURE_STRING_KEYS) {
				const names = placeholders(strings[k] as string);
				expect([id, k, [...new Set(names)].sort()]).toEqual([id, k, fields[k]]);
			}
		}
		const s = PLACEHOLDER_MANIFEST.strings;
		expect([s["hud.toast.vault"], s[TREASURE_SCORE_SOURCE_KEY], s["treasure.lock.swift"]]).toEqual([
			"A vault lies on this floor",
			"Vaults",
			"SWIFT",
		]);
	});
});

describe("treasure: placeholder", () => {
	it("draws the chest as a low box and the open chest as a lid wedge, both in treasure.chest, facing the room", () => {
		const chest = PLACEHOLDER_VISUALS[TREASURE_CHEST_ID];
		const open = PLACEHOLDER_VISUALS[TREASURE_CHEST_OPEN_ID];
		expect([chest.shape, chest.color, chest.anchor, chest.faces, chest.material, chest.dash]).toEqual([
			"Block",
			{ kind: "role", role: "treasure.chest" },
			"base",
			true,
			"SmoothPlastic",
			undefined,
		]);
		expect([open.shape, open.color, open.anchor, open.faces]).toEqual([
			"Wedge",
			{ kind: "role", role: "treasure.chest" },
			"base",
			true,
		]);
		expect(chest.size[0]).toBe(pxToStuds(16 * PLACEHOLDER_PROPORTIONS.chest[0]));
		// wider than deep, and under a barrel's height (5/8 of a tile): it never hides a bullet
		expect(chest.size[0] > chest.size[2]).toBe(true);
		expect(chest.size[1] < pxToStuds(16 * PLACEHOLDER_PROPORTIONS.barrel[1])).toBe(true);
		// the open chest has the chest's footprint
		expect([open.size[0], open.size[2]]).toEqual([chest.size[0], chest.size[2]]);
	});

	it("draws the cage as one thin bar in treasure.cage, repeated (dash) CAGE_BAR_GAP_PX apart", () => {
		const cage = PLACEHOLDER_VISUALS[TREASURE_CAGE_ID];
		expect([cage.shape, cage.color, cage.anchor, cage.faces]).toEqual([
			"Block",
			{ kind: "role", role: "treasure.cage" },
			"base",
			true,
		]);
		expect(cage.dash).toEqual({ length: cage.size[0], gap: pxToStuds(CAGE_BAR_GAP_PX) });
		// a bar: thin and square in section, taller than the chest
		expect(cage.size[0]).toBe(cage.size[2]);
		expect(cage.size[1] > PLACEHOLDER_VISUALS[TREASURE_CHEST_ID].size[1]).toBe(true);
	});

	it("the placeholder pack draws the three looks as placeholders; vale draws art for all three (TR9)", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			for (const tid of TREASURE_IDS) {
				const art = id === "vale";
				expect([id, tid, THEME_PACKS[id].assets[tid].kind]).toEqual([id, tid, art ? "sprites" : "placeholder"]);
			}
		}
	});
});

describe("treasure: treasureReport (conflict C2)", () => {
	it("the rules: floor tiers >= 3:1 on every biome floor and minimap.floor, >= 40 CIE76 from the danger set", () => {
		const r = TREASURE_COLOR_RULES;
		expect([...r.floorRoles]).toEqual([...TREASURE_FLOOR_ROLES]);
		expect([...r.uiRoles]).toEqual([...BOON_RARITY_ROLES]);
		expect([...r.against]).toEqual([...ROOM_EDGE_DIFFERENCE_ROLES]);
		expect([...r.against]).toEqual(["enemyBullet", "enemyBulletOutline", "telegraph"]);
		expect([r.mapBackground, r.minContrast, r.minDifference, r.cage, r.chest, r.minBulletContrast]).toEqual([
			"minimap.floor",
			3,
			40,
			"treasure.cage",
			"treasure.chest",
			3,
		]);
	});

	it("C2: the draft's boon.* colours as floor colours: rare and legendary fail the telegraph bar (printed)", () => {
		for (const [id, manifest] of packsToCheck()) {
			const m = deepClone(manifest);
			const colors = m.colors as Obj;
			TREASURE_FLOOR_ROLES.forEach((role, i) => (colors[role] = colors[BOON_RARITY_ROLES[i]]));
			const report = treasureReport(m).filter((e) => has(TREASURE_FLOOR_ROLES, e.role));
			for (const e of report) printEntry("treasure C2 boon.*", id, e);
			const failed = report.filter((e) => !e.ok).map((e) => `${e.role} ${e.check} ${e.against}`);
			expect([id, failed]).toEqual([
				id,
				["treasure.rare difference telegraph", "treasure.legendary difference telegraph"],
			]);
		}
		// the numbers TR0 estimated (docs/TREASURE.md C2): 36.8 and 34.2 from the telegraph
		expect(fixed1(colorDifference("#f46669", "#ff8a3d"))).toBe("36.8");
		expect(fixed1(colorDifference("#f1bd44", "#ff8a3d"))).toBe("34.2");
	});

	it("passes for every bundled pack (and vale's textured floor), every check in the report (numbers printed)", () => {
		const r = TREASURE_COLOR_RULES;
		for (const [id, manifest] of packsToCheck()) {
			const report = treasureReport(manifest);
			const count = (check: string) => report.filter((e) => e.check === check).size();
			expect([id, count("floor"), count("map"), count("difference"), count("bullet")]).toEqual([
				id,
				(r.floorRoles.size() + 1) * BIOMES.size(),
				r.floorRoles.size() + r.uiRoles.size(),
				r.floorRoles.size() * r.against.size(),
				1,
			]);
			for (const e of report) {
				expect([id, e.role, e.check, e.against, e.ok]).toEqual([id, e.role, e.check, e.against, true]);
				const value =
					e.check === "difference"
						? colorDifference(e.color, e.againstColor)
						: contrastRatio(e.color, e.againstColor);
				expect(e.value).toBe(value);
				printEntry("treasure", id, e);
			}
			if (id !== "vale (textured floors)")
				expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
		}
	});

	it("the floor tiers stay the draft's hues (each within 7 CIE76 of its boon.* colour) and climb apart", () => {
		const colors = PLACEHOLDER_MANIFEST.colors as unknown as Obj;
		TREASURE_FLOOR_ROLES.forEach((role, i) => {
			const d = colorDifference(colors[role] as string, colors[BOON_RARITY_ROLES[i]] as string);
			print(`[treasure] ${role} vs ${BOON_RARITY_ROLES[i]}: ${fixed1(d)}`);
			expect([role, d <= 7]).toEqual([role, true]);
		});
		for (let i = 1; i < TREASURE_FLOOR_ROLES.size(); i++) {
			const d = colorDifference(
				colors[TREASURE_FLOOR_ROLES[i]] as string,
				colors[TREASURE_FLOOR_ROLES[i - 1]] as string,
			);
			expect([TREASURE_FLOOR_ROLES[i], d >= 25]).toEqual([TREASURE_FLOOR_ROLES[i], true]);
		}
	});

	it("a tier colour that reads as danger or vanishes, a dark cage or a bright chest fails validation", () => {
		for (const against of ["enemyBullet", "telegraph"]) {
			const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
			const colors = m.colors as Obj;
			colors["treasure.rare"] = colors[against];
			const errors = validateManifest(m);
			expect([against, errors.size() > 0]).toEqual([against, true]);
			expect([against, errors.some((e) => e.find(`vs ${against}`, 1, true)[0] !== undefined)]).toEqual([
				against,
				true,
			]);
			for (const e of errors)
				expect([against, e.find("treasure.rare", 1, true)[0] !== undefined]).toEqual([against, true]);
		}
		const dark = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(dark.colors as Obj)["treasure.legendary"] = "#202020";
		const darkErrors = validateManifest(dark);
		expect(darkErrors.some((e) => e.find("must read on the minimap", 1, true)[0] !== undefined)).toBe(true);
		expect(darkErrors.some((e) => e.find("must read on the floor", 1, true)[0] !== undefined)).toBe(true);
		const ui = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(ui.colors as Obj)["boon.common"] = "#3a3833";
		expect(
			validateManifest(ui).some(
				(e) => e.find("contrast: boon.common #3a3833 on minimap.floor", 1, true)[0] !== undefined,
			),
		).toBe(true);
		const cage = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(cage.colors as Obj)["treasure.cage"] = "#2a2a2a";
		expect(
			validateManifest(cage).some((e) => e.find("its cage must read on the floor", 1, true)[0] !== undefined),
		).toBe(true);
		const chest = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(chest.colors as Obj)["treasure.chest"] = "#f0f0f0";
		expect(
			validateManifest(chest).some(
				(e) => e.find("contrast: enemyBullet #ff3fa4 on treasure.chest #f0f0f0", 1, true)[0] !== undefined,
			),
		).toBe(true);
	});
});

describe("treasure: validator", () => {
	it("a pack missing a treasure asset or role fails; an unknown treasure ID fails", () => {
		const missing = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(missing.assets as Obj)["treasure.cage"] = undefined;
		expect(
			validateManifest(missing).some(
				(e) => e.find('missing required asset "treasure.cage"', 1, true)[0] !== undefined,
			),
		).toBe(true);
		const noRole = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(noRole.colors as Obj)["treasure.legendary"] = undefined;
		expect(
			validateManifest(noRole).some(
				(e) => e.find('missing color role "treasure.legendary"', 1, true)[0] !== undefined,
			),
		).toBe(true);
		const unknown = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(unknown.assets as Obj)["treasure.mimic"] = { kind: "placeholder" };
		expect(validateManifest(unknown)).toEqual([
			'assets["treasure.mimic"]: unknown treasure ID (known: treasure.chest, treasure.chestopen, treasure.cage)',
		]);
		const camel = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(camel.assets as Obj)["treasure.chestOpen"] = { kind: "placeholder" };
		expect(validateManifest(camel).some((e) => e.find("bad asset ID", 1, true)[0] !== undefined)).toBe(true);
	});

	it("accepts treasure world art: an image with pixelsPerTile and a pivot, or an idle sprite set", () => {
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		(m.assets as Obj)["treasure.chest"] = {
			kind: "image",
			assetId: "rbxassetid://1",
			w: 32,
			h: 24,
			rect: { x: 0, y: 0, w: 16, h: 14 },
			pivot: { x: 8, y: 13 },
			pixelsPerTile: 16,
		};
		expect(validateManifest(m)).toEqual([]);
	});
});
