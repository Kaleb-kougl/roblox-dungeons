// Roblox port (docs/SILVER.md SV7): Silver's theme keys (the strings, the four sounds, the colour role, the optional
// coin effect and icon) are in the contract's lists, every bundled pack fills the required ones, the sounds fall back
// one step while silent, and silverReport holds the colour to its bars. contract.ts names the sounds and the effect
// inline (its compiled Luau sits near the 200-locals limit), so these specs keep silver.ts and contract.ts in step.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ARMORY_CATALOG } from "shared/wallet";
import { ALL_SFX, PORT_SFX, SFX, SFX_FALLBACK, SFX_PRIORITY } from "shared/view/audio";
import { colorDifference } from "./color";
import {
	ENEMY_BULLET_ROLES,
	FX_IDS,
	MIN_DECOR_FX_BULLET_DIFFERENCE,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	isFxId,
	slotFor,
} from "./contract";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import {
	ARMORY_ITEM_IDS,
	ARMORY_KEYS,
	SILVER_AUDIO_IDS,
	SILVER_COINS_FX_ID,
	SILVER_ICON_ID,
	SILVER_RECAP_KEYS,
	SILVER_ROLE,
	SILVER_ROLES,
	SILVER_STRING_KEYS,
	armoryItemDescKey,
	armoryItemNameKey,
	silverStringKeys,
} from "./silver";
import { SILVER_COLOR_RULES, silverReport } from "./silverColors";
import { runOf } from "./testing";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { validateManifest } from "./validate";

const has = (list: ReadonlyArray<string>, id: string) => list.includes(id);
const fixed1 = (n: number) => "%.1f".format(n);
const fixed2 = (n: number) => "%.2f".format(n);
const quiet = () => {};
const clone = () => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;

describe("silver: strings", () => {
	it("are REQUIRED_STRING_KEYS' last ones before the Silver shop's, distinct, sorted, in every bundled pack", () => {
		expect(SILVER_STRING_KEYS.size() > 0).toBe(true);
		expect([...silverStringKeys()]).toEqual([...SILVER_STRING_KEYS]);
		// docs/SILVER_SHOP.md SH4's keys come after them.
		expect(runOf(REQUIRED_STRING_KEYS, SILVER_STRING_KEYS)).toEqual([...SILVER_STRING_KEYS]);
		expect(new Set(REQUIRED_STRING_KEYS).size()).toBe(REQUIRED_STRING_KEYS.size());
		for (const p of sortedKeys(THEME_PACKS))
			for (const key of SILVER_STRING_KEYS)
				expect([p, key, typeIs(THEME_PACKS[p].strings[key], "string")]).toEqual([p, key, true]);
	});

	it("names and describes every Armory catalogue item but the cosmetics (named by cosmetics.ts cosmeticNameKey)", () => {
		expect([...ARMORY_ITEM_IDS]).toEqual(ARMORY_CATALOG.filter((i) => i.kind !== "cosmetic").map((i) => i.id));
		for (const id of ARMORY_ITEM_IDS) {
			expect([id, has(SILVER_STRING_KEYS, armoryItemNameKey(id))]).toEqual([id, true]);
			expect([id, has(SILVER_STRING_KEYS, armoryItemDescKey(id))]).toEqual([id, true]);
		}
	});

	it("the placeholder English: the recap rows, the item level, the effect line", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(pack.str(SILVER_RECAP_KEYS.run, { silver: 46 })).toBe("Silver +46");
		expect(pack.str(SILVER_RECAP_KEYS.firstRun, { silver: 50 })).toBe("First run today +50");
		expect(pack.str(SILVER_RECAP_KEYS.topUp, { silver: 20 })).toBe("Topped up to 20");
		expect(pack.str(SILVER_RECAP_KEYS.toGo, { item: "Vigor II", silver: 66 })).toBe("Vigor II: 66 to go");
		expect(pack.str(SILVER_RECAP_KEYS.none)).toBe("No Silver: unranked run");
		expect(pack.str(ARMORY_KEYS.itemLevel, { name: "Vigor", level: "II" })).toBe("Vigor II");
		expect(pack.str(ARMORY_KEYS.effectChange, { label: "Knight", from: "2 1/2", to: "3" })).toBe(
			"Knight 2 1/2 -> 3",
		);
		expect(pack.str(ARMORY_KEYS.firstRunOpen, { silver: 50 })).toBe("First run today: +50");
	});

	it("a pack missing a Silver string fails validation", () => {
		for (const key of [SILVER_RECAP_KEYS.run, ARMORY_KEYS.title, armoryItemNameKey("vigor")]) {
			const m = clone();
			(m.strings as Obj)[key] = undefined;
			expect([key, validateManifest(m)]).toEqual([key, [`strings: missing required string "${key}"`]]);
		}
	});
});

describe("silver: sounds", () => {
	it("are PORT_AUDIO_EVENTS' four before docs/NEW_ENEMIES_2.md's eight: required, sfx; SILENT in the placeholder, vale plays them", () => {
		expect([...SILVER_AUDIO_IDS]).toEqual(["sfx.silver.gain", "sfx.silver.crate", "sfx.shop.buy", "sfx.shop.deny"]);
		// docs/NEW_ENEMIES_2.md NX1's eight come after them (newEnemies2.spec.ts)
		expect(runOf(PORT_AUDIO_EVENTS, SILVER_AUDIO_IDS)).toEqual([...SILVER_AUDIO_IDS]);
		for (const id of SILVER_AUDIO_IDS) {
			expect([id, has(REQUIRED_ASSET_IDS, id), slotFor(id)?.soundGroup]).toEqual([id, true, "sfx"]);
			// vale plays them: picked at the audition and uploaded 2026-11-14 (docs/SILVER.md)
			for (const p of sortedKeys(THEME_PACKS))
				expect([p, id, THEME_PACKS[p].assets[id].kind]).toEqual([p, id, p === "vale" ? "sound" : "silent"]);
		}
	});

	it("the cue tables: listed, one-step fallbacks, ranked under the fight sounds", () => {
		expect([SFX.silverGain, SFX.silverCrate, SFX.shopBuy, SFX.shopDeny]).toEqual([...SILVER_AUDIO_IDS]);
		const fallback = SFX_FALLBACK as unknown as ReadonlyMap<string, string>;
		const rank = SFX_PRIORITY as unknown as ReadonlyMap<string, number>;
		for (const id of SILVER_AUDIO_IDS) {
			expect([id, ALL_SFX.includes(id as never), PORT_SFX.includes(id as never)]).toEqual([id, true, true]);
			expect([id, has(SILVER_AUDIO_IDS, fallback.get(id)!)]).toEqual([id, false]);
		}
		expect(SILVER_AUDIO_IDS.map((id) => fallback.get(id))).toEqual([
			"sfx.score.tick",
			"sfx.breakable.loot",
			"sfx.relic.take",
			"sfx.ui.back",
		]);
		const r = (id: string) => rank.get(id)!;
		expect(r(SFX.silverCrate) > r(SFX.breakableBreak)).toBe(true);
		expect(r(SFX.silverCrate) < r(SFX.enemyDeath) || r(SFX.silverCrate) < r(SFX.playerSwing)).toBe(true);
		expect(r(SFX.silverGain) < r(SFX.breakableLoot)).toBe(true);
	});
});

describe("silver: optional art", () => {
	it("the coin burst is FX_IDS' last (optional), the icon a free-form ui id no pack needs", () => {
		expect(FX_IDS[FX_IDS.size() - 1]).toBe(SILVER_COINS_FX_ID);
		expect(isFxId(SILVER_COINS_FX_ID)).toBe(true);
		expect(has(REQUIRED_ASSET_IDS, SILVER_COINS_FX_ID)).toBe(false);
		expect(has(REQUIRED_ASSET_IDS, SILVER_ICON_ID)).toBe(false);
		expect(SILVER_ICON_ID).never.toBe("ui.icon.coin");
		for (const p of sortedKeys(THEME_PACKS))
			expect([p, validateManifest(THEME_PACKS[p], { packId: p })]).toEqual([p, []]);
	});
});

describe("silver: the colour role", () => {
	it("is COLOR_ROLES' last, in every bundled pack", () => {
		expect([...SILVER_ROLES]).toEqual([SILVER_ROLE]);
		expect(runOf(COLOR_ROLES as unknown as ReadonlyArray<string>, SILVER_ROLES)).toEqual([...SILVER_ROLES]);
		for (const p of sortedKeys(THEME_PACKS))
			expect([p, typeIs(THEME_PACKS[p].colors[SILVER_ROLE], "string")]).toEqual([p, true]);
	});

	it("passes silverReport in every bundled pack: text on uiPanel, apart from danger and the golds (printed)", () => {
		expect([...SILVER_COLOR_RULES.against]).toEqual([...ENEMY_BULLET_ROLES, "telegraph"]);
		expect(SILVER_COLOR_RULES.minDifference).toBe(MIN_DECOR_FX_BULLET_DIFFERENCE);
		expect([...SILVER_COLOR_RULES.apartFrom]).toEqual(["newBest", "golden.coin", "uiAccent"]);
		for (const p of sortedKeys(THEME_PACKS)) {
			const report = silverReport(THEME_PACKS[p]);
			const n = 1 + SILVER_COLOR_RULES.against.size() + SILVER_COLOR_RULES.apartFrom.size();
			expect([p, report.size()]).toEqual([p, n]);
			for (const e of report) {
				expect([p, e.check, e.against, e.ok]).toEqual([p, e.check, e.against, true]);
				if (e.check !== "panel") expect(e.value).toBe(colorDifference(e.color, e.againstColor));
				const v = e.check === "panel" ? `${fixed2(e.value)}:1` : fixed1(e.value);
				print(`[silver] ${p} ${e.role} ${e.color} ${e.check} vs ${e.against} ${e.againstColor}: ${v}`);
			}
		}
	});

	it("a silver that reads as a bullet, the telegraph or the score's gold fails; missing fails", () => {
		for (const against of [...ENEMY_BULLET_ROLES, "telegraph", "newBest", "golden.coin", "uiAccent"]) {
			const m = clone();
			(m.colors as Obj)[SILVER_ROLE] = (m.colors as Obj)[against];
			const errors = validateManifest(m);
			expect([against, errors.some((e) => e.find(`vs ${against}`, 1, true)[0] !== undefined)]).toEqual([
				against,
				true,
			]);
		}
		const dark = clone();
		(dark.colors as Obj)[SILVER_ROLE] = (dark.colors as Obj).uiPanel;
		expect(
			validateManifest(dark).some((e) => e.find("Silver's counter and prices", 1, true)[0] !== undefined),
		).toBe(true);
		const none = clone();
		(none.colors as Obj)[SILVER_ROLE] = undefined;
		expect(
			validateManifest(none).some((e) => e.find(`missing color role "${SILVER_ROLE}"`, 1, true)[0] !== undefined),
		).toBe(true);
	});
});
