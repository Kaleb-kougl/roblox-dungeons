// The Armory screen's pure rules (docs/SILVER.md "The Armory", SV9): tabs by catalogue kind, rows sorted by the tier
// they would buy next (maxed last), the next-goal marks, dimmed far tiers, the tier 6+ confirm, exact per-character
// effect lines (Knight 2 1/2 -> 3), the price / to-go / state, the unavailable wallet, the main menu badge, the buy hold
// and the character screen's upgrades line; KV_FakeWallet's poor / rich / unknown shapes.
import { describe, expect, it } from "@rbxts/jest-globals";
import { COSMETIC_ITEMS } from "shared/cosmetics";
import { PLACEHOLDER_MANIFEST, ThemePack, type StringVars } from "shared/theme";
import {
	ARMORY_CATALOG,
	ARMORY_TIERS,
	CONFIRM_FROM_TIER,
	emptyWalletDoc,
	nextGoals,
	parseFakeWallet,
	walletStatusOf,
	type ArmoryItem,
	type WalletStatus,
} from "shared/wallet";
import { SILVER_SHOP } from "shared/view/silver";
import {
	ARMORY_TABS,
	BuyHold,
	affordableKeys,
	armoryBadge,
	armoryDetail,
	armoryEffectLines,
	armoryPips,
	armoryRows,
	dearestOwnedTier,
	heartsText,
	upgradesLine,
} from "./armory";

const quiet = () => {};
const PACK = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
const s = (key: string, vars?: StringVars) => PACK.str(key, vars);
const DAY = 100;

/** A loaded status from KV_FakeWallet's text (the Studio fake's own parser), on day DAY. */
function fake(text: string): WalletStatus {
	const f = parseFakeWallet(text, DAY);
	if (f === undefined || !f.loaded) return { loaded: false };
	return walletStatusOf(f.doc, true, DAY);
}

describe("armory: rows", () => {
	it("each tab holds its kind; Upgrades sort by the next tier: Vigor I (1), Prospector I (2), Deep Flask I (3), Plating (5)", () => {
		const poor = walletStatusOf(emptyWalletDoc(), true, DAY);
		expect(armoryRows("upgrades", poor).map((r) => [r.itemId, r.nextTier])).toEqual([
			["vigor", 1],
			["prospector", 2],
			["deepFlask", 3],
			["plating", 5],
		]);
		expect(armoryRows("unlocks", poor).map((r) => r.itemId)).toEqual(["character.archer"]);
		// docs/COSMETICS.md CS4: the Cosmetics tab holds every cosmetic (shared/cosmetics COSMETIC_ITEMS)
		expect(armoryRows("cosmetics", poor).size()).toBe(COSMETIC_ITEMS.size());
		expect([...ARMORY_TABS]).toEqual(["upgrades", "unlocks", "cosmetics"]);
	});

	it("marks the next goal and the one after (nextGoals), with `to go`; poor rows say how much", () => {
		const st = fake("30");
		const rows = armoryRows("upgrades", st);
		const goals = nextGoals(parseFakeWallet("30", DAY)!.doc);
		const first = rows.find((r) => r.mark === "next")!;
		const after = rows.find((r) => r.mark === "after")!;
		expect([first.itemId, first.level + 1]).toEqual([goals[0].itemId, goals[0].level]);
		expect([after.itemId, after.level + 1]).toEqual([goals[1].itemId, goals[1].level]);
		expect([first.state, first.toGo]).toEqual(["poor", ARMORY_TIERS[0] - 30]);
		expect(s("armory.toGo", { silver: first.toGo })).toBe(`${ARMORY_TIERS[0] - 30} to go`);
	});

	it("dims prices two or more tiers above the dearest thing owned", () => {
		const none = armoryRows("upgrades", fake("0"));
		expect(none.map((r) => [r.itemId, r.dim])).toEqual([
			["vigor", false],
			["prospector", true],
			["deepFlask", true],
			["plating", true],
		]);
		const st = fake("0;vigor:1,prospector:1");
		expect(dearestOwnedTier(st)).toBe(2);
		const rows = armoryRows("upgrades", st);
		const dim = new Map<string, boolean>();
		for (const r of rows) dim.set(r.itemId, r.dim);
		expect([dim.get("vigor"), dim.get("prospector"), dim.get("deepFlask"), dim.get("plating")]).toEqual([
			false,
			false,
			false,
			true,
		]);
	});

	it("maxed upgrades and owned unlocks sort last and cannot be bought; pips show the levels", () => {
		const st = fake("5000;vigor:2,character.archer:1");
		const rows = armoryRows("upgrades", st);
		const last = rows[rows.size() - 1];
		expect([last.itemId, last.state, last.price]).toEqual(["vigor", "maxed", undefined]);
		expect(armoryPips(last)).toEqual([true, true]);
		const archer = armoryRows("unlocks", st)[0];
		expect([archer.state, armoryPips(archer).size()]).toEqual(["owned", 0]);
		expect(armoryDetail(archer, s).buy).toBe("none");
		expect(armoryDetail(archer, s).price).toBe("Owned");
	});

	it("an unknown wallet: every row unavailable, nothing to buy (`Armory unavailable`)", () => {
		const rows = armoryRows("upgrades", fake("unknown"));
		for (const r of rows) expect([r.itemId, r.state]).toEqual([r.itemId, "unavailable"]);
		expect(armoryDetail(rows[0], s).buy).toBe("none");
		expect(armoryDetail(rows[0], s).price).toBe("Armory unavailable");
		expect(armoryRows("upgrades", undefined)[0].state).toBe("unavailable");
	});

	it("asks to confirm from CONFIRM_FROM_TIER (a tier 6 item), holds below it", () => {
		const cosmetic: ArmoryItem = {
			id: "test.title",
			kind: "cosmetic",
			tiers: [CONFIRM_FROM_TIER],
			simLever: false,
		};
		const below: ArmoryItem = {
			id: "test.cheap",
			kind: "cosmetic",
			tiers: [CONFIRM_FROM_TIER - 1],
			simLever: false,
		};
		const rich: WalletStatus = { loaded: true, balance: 99999, earned: 99999 };
		const rows = armoryRows("cosmetics", rich, [...ARMORY_CATALOG, cosmetic, below]);
		const by = new Map<string, (typeof rows)[number]>();
		for (const r of rows) by.set(r.itemId, r);
		expect([by.get("test.title")!.confirm, armoryDetail(by.get("test.title")!, s).buy]).toEqual([
			true,
			"holdConfirm",
		]);
		expect([by.get("test.cheap")!.confirm, armoryDetail(by.get("test.cheap")!, s).buy]).toEqual([false, "hold"]);
	});
});

describe("armory: the detail", () => {
	it("exact effect lines per character, from the traits (Knight 2 -> 2 1/2, Archer 1 1/2 -> 2), top level `now`", () => {
		expect(armoryEffectLines("vigor", 0, 2, s)).toEqual(["Knight 2 -> 2 1/2", "Archer 1 1/2 -> 2"]);
		expect(armoryEffectLines("vigor", 1, 2, s)).toEqual(["Knight 2 1/2 -> 3", "Archer 2 -> 2 1/2"]);
		expect(armoryEffectLines("vigor", 2, 2, s)).toEqual(["Knight 3", "Archer 2 1/2"]);
		expect(armoryEffectLines("deepFlask", 0, 2, s)).toEqual(["Flask 3 -> 4"]);
		expect(armoryEffectLines("plating", 0, 1, s)).toEqual(["Armor 0 -> 1"]);
		expect(armoryEffectLines("prospector", 1, 4, s)).toEqual(["Silver +5 % -> +10 %"]);
		expect(armoryEffectLines("character.archer", 0, 1, s)).toEqual([]);
	});

	it("hearts text: whole, and a half", () => {
		expect([heartsText(6, s), heartsText(5, s), heartsText(1, s)]).toEqual(["3", "2 1/2", "1/2"]);
	});

	it("names the next level, its tier, the price and to go; affordable rows hold to buy", () => {
		const row = armoryRows("upgrades", fake("200;vigor:1")).find((r) => r.itemId === "vigor")!;
		const d = armoryDetail(row, s);
		expect([d.title, d.tier, d.price, d.toGo, d.buy, d.levels]).toEqual([
			"Vigor II",
			"Tier 3",
			tostring(ARMORY_TIERS[2]),
			undefined,
			"hold",
			"Level 1/2",
		]);
		const poor = armoryDetail(armoryRows("upgrades", fake("100;vigor:1")).find((r) => r.itemId === "vigor")!, s);
		expect([poor.toGo, poor.buy]).toEqual([`${ARMORY_TIERS[2] - 100} to go`, "none"]);
		expect(armoryDetail(armoryRows("upgrades", fake("0")).find((r) => r.itemId === "prospector")!, s).desc).toBe(
			"+5 % Silver on every run's amount, per level.",
		);
	});
});

describe("armory: the main menu badge, the hold, the upgrades line", () => {
	it("the badge: an affordable next level not seen in the Armory yet", () => {
		const st = fake("90");
		// docs/COSMETICS.md CS4: tier 2 cosmetics (80) are affordable too, after the upgrades (catalogue order)
		const tier2 = COSMETIC_ITEMS.filter((c) => c.tier <= 2).map((c) => `${c.id}:1`);
		expect(affordableKeys(st)).toEqual(["vigor:1", "prospector:1", ...tier2]);
		expect(armoryBadge(st, [])).toBe(true);
		expect(armoryBadge(st, affordableKeys(st))).toBe(false);
		expect(armoryBadge(fake("10"), [])).toBe(false);
		expect(armoryBadge(fake("unknown"), [])).toBe(false);
	});

	it("BuyHold completes once per press after holdSec; releasing early never completes", () => {
		const h = new BuyHold();
		expect(h.step(0)).toBe("idle");
		h.press(10);
		expect(h.step(10 + SILVER_SHOP.holdSec / 2)).toBe("holding");
		expect(h.progress(10 + SILVER_SHOP.holdSec / 2)).toBeCloseTo(0.5, 5);
		expect(h.step(10 + SILVER_SHOP.holdSec)).toBe("complete");
		expect(h.step(11 + SILVER_SHOP.holdSec)).toBe("idle");
		h.release();
		h.press(20);
		h.release();
		expect(h.step(20 + SILVER_SHOP.holdSec)).toBe("idle");
		expect(h.progress(25)).toBe(0);
	});

	it("the character screen's line lists the upgrades the next run applies", () => {
		expect(upgradesLine(fake("0"), s, " · ")).toBe("No upgrades yet");
		expect(upgradesLine(fake("0;vigor:2,plating:1,prospector:1"), s, " · ")).toBe(
			"Upgrades: Vigor II · Plating · Prospector I",
		);
	});
});
