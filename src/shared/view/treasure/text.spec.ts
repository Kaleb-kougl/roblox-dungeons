// Every vault text (docs/TREASURE.md TR7): the arm toast, the plate, the unlock's kept line, the open's kept /
// near-miss line, the reward cards for the view player, and the KV_TreasureLabel text; through the placeholder pack's
// real strings (TR6), and every key the helpers read is in TREASURE_STRING_KEYS.
import { describe, expect, it } from "@rbxts/jest-globals";
import { VaultLock, VaultTier } from "shared/dungeon";
import { ENDLESS_TREASURE_CONFIG, RELICS, SIM_HZ, TREASURE_UNSET, VaultStatus, createTreasureState } from "shared/sim";
import { PLACEHOLDER_MANIFEST, REQUIRED_STRING_KEYS, TREASURE_STRING_KEYS, ThemePack } from "shared/theme";
import {
	TREASURE_TEXT_KEYS,
	grantOf,
	keptText,
	lockPlateText,
	lockToastText,
	nearMissText,
	openLineText,
	platePips,
	relicNameKey,
	rewardCardTexts,
	ticksToTenths,
	tierNameText,
	treasureDebugText,
	unlockLineText,
	vaultClock,
	type TreasureOpenedEvent,
} from ".";

const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => {} });
const s = (k: string, vars?: Readonly<Record<string, string | number>>) => pack.str(k, vars);

function opened(over: Partial<TreasureOpenedEvent>): TreasureOpenedEvent {
	return {
		room: 3,
		slot: 9,
		tick: 100,
		x: 10.5,
		z: 4.5,
		lock: VaultLock.UNTOUCHED,
		tier: VaultTier.RARE,
		opener: 0,
		startTier: VaultTier.RARE,
		kept: 1,
		missBy: TREASURE_UNSET,
		spare: 0,
		points: 800,
		grants: [],
		...over,
	};
}

describe("the vault's strings", () => {
	it("are TR6's required TREASURE_STRING_KEYS, every one in the placeholder pack", () => {
		const K = TREASURE_TEXT_KEYS;
		const keys = [
			K.toastUntouched,
			K.toastUntouchedParty,
			K.toastSwift,
			K.unlocked,
			K.spareTime,
			K.spareHits,
			K.kept,
			K.nearMissTime,
			K.nearMissHits,
			K.relic,
			K.draft,
			K.boosts,
			K.points,
		];
		for (const key of keys) {
			expect([key, TREASURE_STRING_KEYS.includes(key)]).toEqual([key, true]);
			expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
			expect([key, pack.hasString(key)]).toEqual([key, true]);
		}
	});
});

describe("numbers", () => {
	it("prints the SWIFT clock as m:ss, rounded up", () => {
		expect(vaultClock(42 * SIM_HZ)).toBe("0:42");
		expect(vaultClock(42 * SIM_HZ - 1)).toBe("0:42");
		expect(vaultClock(42 * SIM_HZ + 1)).toBe("0:43");
		expect(vaultClock(65 * SIM_HZ)).toBe("1:05");
		expect(vaultClock(0)).toBe("0:00");
		expect(vaultClock(-5)).toBe("0:00");
	});

	it("rounds ticks to tenths half up, in integers", () => {
		expect(ticksToTenths(0)).toBe(0);
		expect(ticksToTenths(3)).toBe(1); // 0.05 s
		expect(ticksToTenths(2)).toBe(0);
		expect(ticksToTenths(126)).toBe(21); // 2.1 s
		expect(ticksToTenths(252)).toBe(42);
	});
});

describe("the lock", () => {
	it("toasts UNTOUCHED solo, UNTOUCHED with a party's allowance, and SWIFT with the par", () => {
		expect(lockToastText(s, VaultLock.UNTOUCHED, 0, TREASURE_UNSET)).toBe(
			"VAULT · UNTOUCHED: clear the room without a hit",
		);
		expect(lockToastText(s, VaultLock.UNTOUCHED, 2, TREASURE_UNSET)).toBe(
			"VAULT · UNTOUCHED: clear the room · party hits allowed: 2",
		);
		expect(lockToastText(s, VaultLock.SWIFT, TREASURE_UNSET, 42 * SIM_HZ)).toBe(
			"VAULT · SWIFT: clear the room in 0:42",
		);
	});

	it("labels the plate with the lock's name, plus the countdown for SWIFT", () => {
		expect(lockPlateText(s, VaultLock.UNTOUCHED, TREASURE_UNSET)).toEqual({ label: "UNTOUCHED", clock: undefined });
		expect(lockPlateText(s, VaultLock.SWIFT, 9 * SIM_HZ + 1)).toEqual({ label: "SWIFT", clock: "0:10" });
	});

	it("shows allowance + 1 pips, the spent ones counted (solo: one outlined pip)", () => {
		expect(platePips(0, 0)).toEqual({ total: 1, spent: 0 });
		expect(platePips(2, 1)).toEqual({ total: 3, spent: 1 });
		expect(platePips(2, 9)).toEqual({ total: 3, spent: 3 });
		expect(platePips(TREASURE_UNSET, 0)).toEqual({ total: 1, spent: 0 });
	});
});

describe("the lines", () => {
	it("names the tier after a crack", () => {
		expect(tierNameText(s, VaultTier.COMMON)).toBe("Common");
		expect(tierNameText(s, VaultTier.LEGENDARY)).toBe("Legendary");
	});

	it("says what a kept lock had to spare at the unlock", () => {
		expect(unlockLineText(s, VaultLock.UNTOUCHED, 0)).toBe("UNTOUCHED kept");
		expect(unlockLineText(s, VaultLock.UNTOUCHED, 2)).toBe("UNTOUCHED kept · spare hits: 2");
		expect(unlockLineText(s, VaultLock.SWIFT, 252)).toBe("SWIFT kept · 4.2 s to spare");
		expect(unlockLineText(s, VaultLock.SWIFT, 0)).toBe("SWIFT kept");
	});

	it("says how close a cracked lock was at the open, and what a kept one kept", () => {
		expect(nearMissText(s, VaultLock.SWIFT, 126)).toBe("So close: 2.1 s over");
		expect(nearMissText(s, VaultLock.SWIFT, 0)).toBe("So close: 0.1 s over");
		expect(nearMissText(s, VaultLock.UNTOUCHED, 1)).toBe("So close: 1 too many hits");
		expect(nearMissText(s, VaultLock.UNTOUCHED, TREASURE_UNSET)).toBe(undefined);
		expect(keptText(s, VaultTier.LEGENDARY)).toBe("Kept Legendary");
		expect(openLineText(s, opened({ kept: 1, tier: VaultTier.LEGENDARY }))).toBe("Kept Legendary");
		expect(openLineText(s, opened({ kept: 0, lock: VaultLock.UNTOUCHED, missBy: 1 }))).toBe(
			"So close: 1 too many hits",
		);
	});
});

describe("the reward cards", () => {
	const relic = 2;
	const name = pack.str(relicNameKey(relic)!);
	const o = opened({
		points: 1200,
		grants: [
			{ player: 0, relic, bonusDeal: 0, boosts: [], slots: [] },
			{ player: 1, relic: TREASURE_UNSET, bonusDeal: 1, boosts: [3], slots: [0] },
			{ player: 3, relic: TREASURE_UNSET, bonusDeal: 0, boosts: [1, 2], slots: [1, -1] },
		],
	});

	it("names every relic", () => {
		for (let i = 0; i < RELICS.size(); i++) expect(pack.hasString(relicNameKey(i)!)).toBe(true);
		expect(relicNameKey(RELICS.size())).toBe(undefined);
	});

	it("shows the view player's own grant, then the party's points", () => {
		expect(rewardCardTexts(s, o, 0)).toEqual([
			{ kind: "relic", text: `RELIC · ${name}` },
			{ kind: "points", text: "+1,200" },
		]);
		expect(rewardCardTexts(s, o, 1)).toEqual([
			{ kind: "draft", text: "BONUS DRAFT next floor" },
			{ kind: "boosts", text: "BOOSTS +1" },
			{ kind: "points", text: "+1,200" },
		]);
		expect(rewardCardTexts(s, o, 3)).toEqual([
			{ kind: "boosts", text: "BOOSTS +2" },
			{ kind: "points", text: "+1,200" },
		]);
	});

	it("shows the points alone to a player without a grant (dead), and nothing without points", () => {
		expect(grantOf(o, 2)).toBe(undefined);
		expect(rewardCardTexts(s, o, 2)).toEqual([{ kind: "points", text: "+1,200" }]);
		expect(rewardCardTexts(s, opened({ points: 0 }), 0)).toEqual([]);
	});
});

describe("KV_TreasureLabel", () => {
	it("prints lock, tier, status and the lock's live number", () => {
		const t = createTreasureState(ENDLESS_TREASURE_CONFIG, 1, 1);
		expect(treasureDebugText(t, 0)).toBe("- - none");
		t.status = VaultStatus.ARMED;
		t.lock = VaultLock.UNTOUCHED;
		t.tier = VaultTier.LEGENDARY;
		t.allowance = 0;
		expect(treasureDebugText(t, 0)).toBe("untouched legendary armed hits 0/0");
		t.lock = VaultLock.SWIFT;
		t.ticksLeft = 1234;
		expect(treasureDebugText(t, 0)).toBe("swift legendary armed t=1234");
		t.status = VaultStatus.OPENED;
		expect(treasureDebugText(t, 0)).toBe("swift legendary opened");
	});
});
