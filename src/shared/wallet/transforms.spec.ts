import { describe, expect, it } from "@rbxts/jest-globals";
import { SILVER, emptySilverRunInput, runSilver, type RunSilver, type SilverRunInput } from "shared/silver";
import {
	WALLET,
	applyBuy,
	applyEquip,
	applyGrant,
	decodeWalletDoc,
	emptyWalletDoc,
	encodeWalletDoc,
	armoryItem,
	nextGoals,
	prospectorBonus,
	walletBalance,
	walletDocsEqual,
	walletTransaction,
	type ArmoryItem,
	type WalletDoc,
	type WalletGrant,
} from "shared/wallet";

const DAY = 316;

function run(patch: Partial<SilverRunInput>): RunSilver {
	return runSilver({ ...emptySilverRunInput(), ...patch });
}

function grant(runId: string, r: RunSilver, daily = false): WalletGrant {
	return { runId, run: r, daily };
}

function wallet(earned: number, own: ReadonlyArray<readonly [string, number]> = []): WalletDoc {
	const d = emptyWalletDoc();
	d.earned = earned;
	for (const [id, level] of own) d.own.set(id, level);
	return d;
}

function granted(doc: WalletDoc, g: WalletGrant, day = DAY, dailyDay?: number): WalletDoc {
	const r = applyGrant(doc, g, { day, dailyDay });
	if (!r.ok) error(`grant refused: ${r.reason}`, 0);
	return r.doc;
}

// A run that pays 46 before bonuses: 3 rooms (6), floor 1 -> 3 (13), 3 vault... (rooms 3, floor 3, kills 270)
const RUN_46 = run({ roomsCleared: 3, floor: 3, kills: 270 });

describe("applyGrant", () => {
	it("a first grant: the run amount, the first-run bonus, the run id, runDay", () => {
		expect(RUN_46.sum).toBe(46);
		const r = applyGrant(emptyWalletDoc(), grant("a", RUN_46), { day: DAY });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.breakdown.sum).toBe(46);
		expect(r.breakdown.firstRunBonus).toBe(SILVER.firstRunBonus);
		expect([r.breakdown.prospector, r.breakdown.topUp, r.breakdown.dailyBonus]).toEqual([0, 0, 0]);
		expect(r.breakdown.total).toBe(96);
		expect(r.breakdown.balance).toBe(96);
		expect(walletBalance(r.doc)).toBe(96);
		expect([...r.doc.runs]).toEqual(["a"]);
		expect(r.doc.runDay).toBe(DAY);
	});

	it("is idempotent per run id", () => {
		const once = granted(emptyWalletDoc(), grant("a", RUN_46));
		const again = applyGrant(once, grant("a", RUN_46), { day: DAY + 1 });
		expect(again.ok).toBe(false);
		if (!again.ok) expect(again.reason).toBe("duplicate");
		expect(walletBalance(once)).toBe(96);
	});

	it("refuses a bad run id", () => {
		const r = applyGrant(emptyWalletDoc(), grant("", RUN_46), { day: DAY });
		expect(r.ok).toBe(false);
	});

	it("the minimum: a 2-room run is topped up to 20, a 1-room run is not", () => {
		const claimed = wallet(0);
		claimed.runDay = DAY;
		const two = applyGrant(claimed, grant("a", run({ roomsCleared: 2 })), { day: DAY });
		const one = applyGrant(claimed, grant("b", run({ roomsCleared: 1, kills: 9 })), { day: DAY });
		expect(two.ok && one.ok).toBe(true);
		if (!two.ok || !one.ok) return;
		expect([two.breakdown.sum, two.breakdown.topUp, two.breakdown.total]).toEqual([4, 16, SILVER.runMinimum]);
		expect([one.breakdown.sum, one.breakdown.topUp, one.breakdown.total]).toEqual([2, 0, 2]);
	});

	it("an idle run pays nothing but the day's first-run bonus", () => {
		const r = applyGrant(emptyWalletDoc(), grant("idle", run({})), { day: DAY });
		expect(r.ok).toBe(true);
		if (r.ok) expect([r.breakdown.sum, r.breakdown.total]).toEqual([0, SILVER.firstRunBonus]);
	});

	it("Prospector: +5 % a level on the run amount only, from the STORED level", () => {
		expect(prospectorBonus(46, 2)).toBe(4); // floor(46 x 10 / 100)
		const d = wallet(0, [["prospector", 4]]);
		d.runDay = DAY;
		const big = run({ roomsCleared: 10, floor: 6, depth: 2, kills: 100 });
		const r = applyGrant(d, grant("a", big, true), { day: DAY, dailyDay: DAY });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.breakdown.prospectorLevel).toBe(4);
		expect(r.breakdown.prospector).toBe(math.floor((big.sum * 20) / 100));
		// the Daily bonus is flat: Prospector never touches it
		expect(r.breakdown.dailyBonus).toBe(SILVER.dailyBonus);
		expect(r.breakdown.total).toBe(big.sum + r.breakdown.prospector + SILVER.dailyBonus);
	});

	it("Prospector never multiplies the top-up: the minimum includes it", () => {
		const d = wallet(0, [["prospector", 4]]);
		d.runDay = DAY;
		const r = applyGrant(d, grant("a", run({ roomsCleared: 5 })), { day: DAY });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		// sum 10, Prospector 2, top-up to 20: 8
		expect([r.breakdown.sum, r.breakdown.prospector, r.breakdown.topUp, r.breakdown.total]).toEqual([10, 2, 8, 20]);
	});

	it("each day bonus once per day, again the next day", () => {
		let d = granted(emptyWalletDoc(), grant("a", RUN_46, true), DAY, DAY);
		expect(walletBalance(d)).toBe(46 + 50 + 50);
		d = granted(d, grant("b", RUN_46, true), DAY, DAY);
		expect(walletBalance(d)).toBe(146 + 46);
		d = granted(d, grant("c", RUN_46), DAY + 1);
		expect(walletBalance(d)).toBe(192 + 46 + 50);
		expect([d.runDay, d.dailyDay]).toEqual([DAY + 1, DAY]);
		d = granted(d, grant("d", RUN_46, true), DAY + 1, DAY + 1);
		expect(walletBalance(d)).toBe(288 + 46 + 50);
		expect(d.dailyDay).toBe(DAY + 1);
	});

	it("a Daily started before midnight pays its start day's bonus after midnight (SVD30)", () => {
		const d = wallet(0);
		d.runDay = DAY;
		d.dailyDay = DAY - 1;
		// granted on DAY + 1, the run started on DAY: first-run bonus for DAY + 1, Daily bonus for DAY
		const r = applyGrant(d, grant("a", RUN_46, true), { day: DAY + 1, dailyDay: DAY });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect([r.breakdown.firstRunBonus, r.breakdown.dailyBonus]).toEqual([50, 50]);
		expect([r.doc.runDay, r.doc.dailyDay]).toEqual([DAY + 1, DAY]);
	});

	it("a day number that goes backwards pays no bonus and keeps the stored day", () => {
		const d = wallet(0);
		d.runDay = DAY;
		d.dailyDay = DAY;
		const r = applyGrant(d, grant("a", RUN_46, true), { day: DAY - 1, dailyDay: DAY - 1 });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect([r.breakdown.firstRunBonus, r.breakdown.dailyBonus]).toEqual([0, 0]);
		expect([r.doc.runDay, r.doc.dailyDay]).toEqual([DAY, DAY]);
	});

	it("a non-Daily run never pays the Daily bonus", () => {
		const r = applyGrant(emptyWalletDoc(), grant("a", RUN_46, false), { day: DAY, dailyDay: DAY });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.breakdown.dailyBonus).toBe(0);
	});

	it("two grants on the same day in either order give the same total", () => {
		const other = run({ roomsCleared: 1 });
		const ab = granted(granted(emptyWalletDoc(), grant("a", RUN_46, true), DAY, DAY), grant("b", other), DAY);
		const ba = granted(granted(emptyWalletDoc(), grant("b", other), DAY), grant("a", RUN_46, true), DAY, DAY);
		expect(walletBalance(ab)).toBe(walletBalance(ba));
		expect(walletBalance(ab)).toBe(46 + 2 + 50 + 50);
	});

	it("the run ring drops the oldest id past WALLET.runRing", () => {
		let d = emptyWalletDoc();
		for (let i = 0; i < WALLET.runRing + 1; i++) d = granted(d, grant(`r${i}`, run({})));
		expect(d.runs.size()).toBe(WALLET.runRing);
		expect(d.runs.includes("r0")).toBe(false);
	});
});

describe("applyBuy", () => {
	it("buys the next level at the catalogue's price", () => {
		const r = applyBuy(wallet(200), "vigor");
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.purchase).toEqual({ itemId: "vigor", level: 1, tier: 1, price: 40, balance: 160 });
		const r2 = applyBuy(r.doc, "vigor");
		expect(r2.ok).toBe(true);
		if (r2.ok) expect([r2.purchase.level, r2.purchase.price, walletBalance(r2.doc)]).toEqual([2, 150, 10]);
	});

	it("refuses poor / maxed / unknown", () => {
		const poor = applyBuy(wallet(39), "vigor");
		expect(!poor.ok && poor.reason).toBe("poor");
		const maxed = applyBuy(wallet(9999, [["vigor", 2]]), "vigor");
		expect(!maxed.ok && maxed.reason).toBe("maxed");
		const unknown = applyBuy(wallet(9999), "might");
		expect(!unknown.ok && unknown.reason).toBe("unknown");
		expect(walletBalance(poor.doc)).toBe(39);
	});

	it("refuses a missing prerequisite", () => {
		const catalog: ReadonlyArray<ArmoryItem> = [
			{ id: "outline.gold", kind: "cosmetic", tiers: [2], simLever: false, slot: "outline" },
			{
				id: "outline.prism",
				kind: "cosmetic",
				tiers: [6],
				simLever: false,
				slot: "outline",
				requires: { itemId: "outline.gold", level: 1 },
			},
		];
		const rich = wallet(9999);
		const refused = applyBuy(rich, "outline.prism", catalog);
		expect(!refused.ok && refused.reason).toBe("prerequisite");
		const first = applyBuy(rich, "outline.gold", catalog);
		expect(first.ok).toBe(true);
		if (first.ok) expect(applyBuy(first.doc, "outline.prism", catalog).ok).toBe(true);
	});

	it("never mutates its input", () => {
		const d = wallet(200);
		applyBuy(d, "vigor");
		expect([d.spent, d.own.size()]).toEqual([0, 0]);
	});
});

describe("applyEquip", () => {
	const catalog: ReadonlyArray<ArmoryItem> = [
		{ id: "outline.gold", kind: "cosmetic", tiers: [2], simLever: false, slot: "outline" },
		{ id: "trail.blue", kind: "cosmetic", tiers: [3], simLever: false, slot: "trail" },
	];

	it("equips an owned item into its slot and empties it", () => {
		const d = wallet(0, [["outline.gold", 1]]);
		const r = applyEquip(d, "outline", "outline.gold", catalog);
		expect(r.ok && r.changed).toBe(true);
		if (!r.ok) return;
		expect(r.doc.eq?.get("outline")).toBe("outline.gold");
		const same = applyEquip(r.doc, "outline", "outline.gold", catalog);
		expect(same.ok && !same.changed).toBe(true);
		const off = applyEquip(r.doc, "outline", WALLET.noItem, catalog);
		expect(off.ok && off.changed).toBe(true);
		if (off.ok) expect(off.doc.eq).toBe(undefined);
	});

	it("refuses unowned, wrong-slot, unknown items and unknown slots", () => {
		const d = wallet(0, [["outline.gold", 1]]);
		const notOwned = applyEquip(d, "trail", "trail.blue", catalog);
		expect(!notOwned.ok && notOwned.reason).toBe("notOwned");
		const wrong = applyEquip(d, "trail", "outline.gold", catalog);
		expect(!wrong.ok && wrong.reason).toBe("wrongSlot");
		const unknown = applyEquip(d, "outline", "outline.nope", catalog);
		expect(!unknown.ok && unknown.reason).toBe("unknown");
		const slot = applyEquip(d, "hat", WALLET.noItem, catalog);
		expect(!slot.ok && slot.reason).toBe("badSlot");
		// v1 has no cosmetic slots at all
		expect(applyEquip(d, "outline", "outline.gold").ok).toBe(false);
	});
});

describe("nextGoals (SVD24)", () => {
	it("an empty wallet: Vigor I, then Prospector I", () => {
		expect(nextGoals(emptyWalletDoc())).toEqual([
			{ itemId: "vigor", level: 1, tier: 1, price: 40, toGo: 40 },
			{ itemId: "prospector", level: 1, tier: 2, price: 80, toGo: 80 },
		]);
		expect(nextGoals(undefined).size()).toBe(2);
	});

	it("cheapest first, ties in catalogue order, `toGo` from the balance", () => {
		const d = wallet(84, [
			["vigor", 1],
			["prospector", 1],
		]);
		expect(nextGoals(d, 3)).toEqual([
			{ itemId: "vigor", level: 2, tier: 3, price: 150, toGo: 66 },
			{ itemId: "deepFlask", level: 1, tier: 3, price: 150, toGo: 66 },
			{ itemId: "prospector", level: 2, tier: 3, price: 150, toGo: 66 },
		]);
	});

	it("everything owned: no goals", () => {
		const d = wallet(0, [
			["vigor", 2],
			["deepFlask", 2],
			["plating", 1],
			["prospector", 4],
			["character.archer", 1],
		]);
		expect(nextGoals(d).size()).toBe(0);
	});

	it("cosmetics are never goals (docs/COSMETICS.md CS4), even when they are the cheapest thing left", () => {
		const d = wallet(5000, [
			["vigor", 2],
			["deepFlask", 1],
			["prospector", 4],
		]);
		expect(nextGoals(d, 10).map((g) => g.itemId)).toEqual(["character.archer", "deepFlask", "plating"]);
		for (const g of nextGoals(emptyWalletDoc(), 99)) expect(armoryItem(g.itemId)?.kind).never.toBe("cosmetic");
	});
});

describe("transforms compose in any order", () => {
	it("grant then buy equals buy then grant when both are affordable", () => {
		const base = wallet(300);
		base.runDay = DAY;
		const g = grant("a", RUN_46);
		const buy = (d: WalletDoc) => {
			const r = applyBuy(d, "character.archer");
			if (!r.ok) error(r.reason, 0);
			return r.doc;
		};
		const gb = buy(granted(base, g));
		const bg = granted(buy(base), g);
		expect(walletDocsEqual(gb, bg)).toBe(true);
		expect(walletBalance(gb)).toBe(46);
	});

	it("Prospector bought between two grants applies to the later grant only, in both orders of the others", () => {
		const base = wallet(200);
		base.runDay = DAY;
		const a = grant("a", RUN_46);
		const b = grant("b", run({ roomsCleared: 4 }));
		const prospect = (d: WalletDoc) => {
			const r = applyBuy(d, "prospector");
			if (!r.ok) error(r.reason, 0);
			return r.doc;
		};
		const one = granted(prospect(granted(base, a)), b);
		const two = granted(granted(prospect(base), a), b);
		// a then Prospector then b: only b is multiplied; Prospector first: both
		expect(walletBalance(one)).toBe(200 + 46 - 80 + 20);
		expect(walletBalance(two)).toBe(200 - 80 + 46 + 2 + 20);
	});
});

describe("walletTransaction (the store transform)", () => {
	it("a grant on a missing value writes the encoded doc", () => {
		const out = walletTransaction(undefined, { kind: "grant", grant: grant("a", RUN_46), ctx: { day: DAY } });
		expect(out.ok).toBe(true);
		expect(out.breakdown?.total).toBe(96);
		expect(walletDocsEqual(decodeWalletDoc(out.write), out.doc)).toBe(true);
	});

	it("a refusal writes nothing", () => {
		const stored = encodeWalletDoc(wallet(10));
		const out = walletTransaction(stored, { kind: "buy", itemId: "vigor" });
		expect([out.ok, out.reason, out.write]).toEqual([false, "poor", undefined]);
	});

	it("a newer stored version is never written over", () => {
		const out = walletTransaction({ v: 2, earned: 999 }, { kind: "buy", itemId: "vigor" });
		expect([out.ok, out.reason, out.write]).toEqual([false, "newerVersion", undefined]);
	});

	it("two servers' interleaved grants pay the day bonus once (each transform re-reads the stored doc)", () => {
		let stored: unknown = undefined;
		const tx = (runId: string) => {
			const out = walletTransaction(stored, { kind: "grant", grant: grant(runId, RUN_46), ctx: { day: DAY } });
			if (out.write !== undefined) stored = out.write;
			return out;
		};
		const first = tx("server-1-run");
		const second = tx("server-2-run");
		expect(first.breakdown?.firstRunBonus).toBe(50);
		expect(second.breakdown?.firstRunBonus).toBe(0);
		expect(walletBalance(decodeWalletDoc(stored))).toBe(46 + 46 + 50);
		// a retried transform of the first run (UpdateAsync conflict, or a second conclude) grants nothing
		expect(tx("server-1-run").reason).toBe("duplicate");
	});
});
