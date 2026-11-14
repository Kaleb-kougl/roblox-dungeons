// The Archer unlock on the client (docs/SILVER.md SV18): the character screen's card states (locked poor / locked
// affordable / owned / unavailable), the cards offered, Confirm only for an owned pick, a stored pick of a locked
// character reading as the Knight, and the returning-player card (OC12: once, a pre-update account only).
import { describe, expect, it } from "@rbxts/jest-globals";
import { DEFAULT_CHARACTER } from "shared/characters";
import { ARMORY_TIERS, type WalletStatus } from "shared/wallet";
import { ownedCharacterOr } from "shared/view/silver";
import {
	characterLockState,
	characterPickAllowed,
	offeredCharacters,
	silverWelcomeDecision,
	silverWelcomeShown,
} from "./characterLock";

const ARCHER_PRICE = ARMORY_TIERS[3];
const poor: WalletStatus = { loaded: true, balance: 160, earned: 160 };
const rich: WalletStatus = { loaded: true, balance: 500, earned: 500 };
const owned: WalletStatus = { loaded: true, balance: 0, earned: 300, own: [{ itemId: "character.archer", level: 1 }] };

describe("character lock: the cards", () => {
	it("locked poor: `Need N more`; locked affordable: buy in place; owned and the Knight: open", () => {
		expect(characterLockState("archer", poor)).toEqual({
			kind: "locked",
			itemId: "character.archer",
			price: ARCHER_PRICE,
			canBuy: false,
			need: ARCHER_PRICE - 160,
		});
		const r = characterLockState("archer", rich);
		expect(r.kind === "locked" && r.canBuy && r.need === 0).toBe(true);
		expect(characterLockState("archer", owned)).toEqual({ kind: "open" });
		expect(characterLockState(DEFAULT_CHARACTER, undefined)).toEqual({ kind: "open" });
	});

	it("an unknown or pending wallet: the Archer unavailable and only the Knight offered", () => {
		expect(characterLockState("archer", { loaded: false })).toEqual({ kind: "unavailable" });
		expect(characterLockState("archer", undefined)).toEqual({ kind: "unavailable" });
		expect([...offeredCharacters({ loaded: false })]).toEqual([DEFAULT_CHARACTER]);
		expect([...offeredCharacters(undefined)]).toEqual([DEFAULT_CHARACTER]);
		expect([...offeredCharacters(poor)]).toEqual(["knight", "archer"]);
	});

	it("Confirm only for an owned pick; a stored locked pick reads as the Knight; buying allows it at once", () => {
		expect(characterPickAllowed("archer", poor)).toBe(false);
		expect(characterPickAllowed("archer", owned)).toBe(true);
		expect(ownedCharacterOr(poor, "archer")).toBe(DEFAULT_CHARACTER);
		// the push after the purchase owns her: the same visit may pick her
		const bought: WalletStatus = { ...rich, own: [{ itemId: "character.archer", level: 1 }] };
		expect(characterPickAllowed("archer", bought)).toBe(true);
		expect(ownedCharacterOr(bought, "archer")).toBe("archer");
	});
});

describe("character lock: the returning-player card (OC12)", () => {
	const records = { loaded: true, solo: { score: 4800, floor: 6 } } as never;
	it("shows once for a pre-update account: records, an empty wallet that never earned", () => {
		const fresh: WalletStatus = { loaded: true, balance: 0, earned: 0 };
		expect(silverWelcomeShown({ wallet: fresh, records, seen: false })).toBe(true);
		expect(silverWelcomeShown({ wallet: fresh, records, seen: true })).toBe(false);
	});

	it("never for a new account (no records), one that already earned, or unknown docs", () => {
		const fresh: WalletStatus = { loaded: true, balance: 0, earned: 0 };
		expect(silverWelcomeShown({ wallet: fresh, records: { loaded: true }, seen: false })).toBe(false);
		expect(silverWelcomeShown({ wallet: poor, records, seen: false })).toBe(false);
		expect(silverWelcomeShown({ wallet: { loaded: false }, records, seen: false })).toBe(false);
		expect(silverWelcomeShown({ wallet: fresh, records: { loaded: false }, seen: false })).toBe(false);
		expect(silverWelcomeShown({ wallet: undefined, records, seen: false })).toBe(false);
	});

	it("the session's decision waits for both join pushes, then follows the rule (latched by the client)", () => {
		const fresh: WalletStatus = { loaded: true, balance: 0, earned: 0 };
		expect(silverWelcomeDecision(undefined, records)).toBe(undefined);
		expect(silverWelcomeDecision(fresh, undefined)).toBe(undefined);
		expect(silverWelcomeDecision(fresh, records)).toBe(true);
		expect(silverWelcomeDecision(fresh, { loaded: true })).toBe(false);
		expect(silverWelcomeDecision({ loaded: false }, records)).toBe(false);
	});
});
