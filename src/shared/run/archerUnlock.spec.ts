// docs/SILVER.md SV17: the Archer unlock at run starts. In a world that plays characters (endless, the Daily) a solo
// start as an unowned Archer is `locked_character`, a buyer passes, an account with old records and no purchase is
// refused like a new one (ownership is the wallet's alone), an unknown wallet owns the Knight only, an old client that
// sends no `characterId` starts as the Knight, a party start re-checks every member's pick, and M1's worlds (no
// characters) never check.
import { describe, expect, it } from "@rbxts/jest-globals";
import { STARTER_CHARACTERS, isStarterCharacter, type CharacterId } from "shared/characters";
import { bytesOfHex } from "shared/crypto";
import { DAILY_WORLD_KIND, dailySeedFrom } from "shared/daily";
import {
	RunSessionRegistry,
	accessOwnsCharacter,
	charactersApply,
	lockedCharacterReason,
	runWorldKinds,
	type SilverAccess,
	type StartContext,
	type StartRunRequest,
	type StartRunResult,
} from "shared/run";

const OWNER = 101;
const FRIEND = 202;
const VETERAN = 505;
const OCT_31_NOON = 1793404800 + 43200;
const TEST_KEY = bytesOfHex("000102030405060708090a0b0c0d0e0f");

function registry() {
	let ids = 0;
	return new RunSessionRegistry({
		newRunId: () => `run-${++ids}`,
		pickSeed: () => 1337,
		dailySeed: (day) => dailySeedFrom(day, TEST_KEY),
	});
}

/** A wallet seam: `owners` own the Archer; `unknown` players' wallets are not loaded (the Knight only). */
function access(owners: number[], unknown: number[] = []): SilverAccess {
	return {
		upgradesFor: () => undefined,
		ownsCharacter: (id, c) => {
			if (unknown.includes(id)) return isStarterCharacter(c);
			return c === "knight" || owners.includes(id);
		},
	};
}

function ctx(a: SilverAccess, over: Partial<StartContext> = {}): StartContext {
	return {
		now: 0,
		unixNow: OCT_31_NOON,
		isInServer: (id) => id === OWNER || id === FRIEND || id === VETERAN,
		allowBossDoorSpawn: false,
		allowDebugInput: false,
		ownsCharacter: (id, c) => accessOwnsCharacter(a, id, c),
		...over,
	};
}

function codeOf(r: StartRunResult): string {
	return r.ok ? "ok" : r.code;
}

describe("solo starts and the Archer unlock (SV17)", () => {
	for (const world of ["endless", DAILY_WORLD_KIND]) {
		const as = (c?: CharacterId): StartRunRequest => ({ requestId: 1, worldKind: world, characterId: c });

		it(`${world}: an unowned Archer is locked_character; the Knight passes; a buyer passes`, () => {
			const reg = registry();
			const a = access([FRIEND]);
			const locked = reg.start(OWNER, as("archer"), ctx(a));
			expect(codeOf(locked)).toBe("locked_character");
			expect(locked.ok ? "" : locked.reason).toBe(`locked: player ${OWNER} has not unlocked archer`);
			expect(reg.size()).toBe(0);
			expect(codeOf(reg.start(OWNER, as("knight"), ctx(a)))).toBe("ok");
			const bought = reg.start(FRIEND, as("archer"), ctx(a));
			expect(codeOf(bought)).toBe("ok");
			expect(bought.ok ? bought.session.characters : undefined).toEqual(["archer"]);
		});

		it(`${world}: an old client that sends no characterId starts as the Knight, whatever it owns`, () => {
			const r = registry().start(OWNER, as(undefined), ctx(access([])));
			expect(r.ok ? r.session.characters : r.code).toEqual(["knight"]);
		});

		it(`${world}: an unknown wallet owns the Knight only`, () => {
			const reg = registry();
			const a = access([OWNER], [OWNER]);
			expect(codeOf(reg.start(OWNER, as("archer"), ctx(a)))).toBe("locked_character");
			expect(codeOf(reg.start(OWNER, as("knight"), ctx(a)))).toBe("ok");
		});
	}

	it("an account with old records and no purchase is refused like a new one (the wallet alone decides)", () => {
		// VETERAN played the Archer before the update (leaderboard entries, records): nothing in the registry reads
		// them, and their wallet is empty like a new account's (no grandfathering, OC10).
		const a = access([]);
		for (const id of [VETERAN, OWNER]) {
			expect(
				codeOf(registry().start(id, { requestId: 1, worldKind: "endless", characterId: "archer" }, ctx(a))),
			).toBe("locked_character");
		}
	});

	it("worlds without characters never check (M1 plays both weapons)", () => {
		expect(runWorldKinds().filter((k) => charactersApply(k))).toEqual(["endless", DAILY_WORLD_KIND, "dev"]);
		const r = registry().start(OWNER, { requestId: 1, worldKind: "game", characterId: "archer" }, ctx(access([])));
		expect(codeOf(r)).toBe("ok");
		expect(r.ok ? r.session.characters : "").toBe(undefined);
	});

	it("no predicate: every character is owned (tests and tools, today's behaviour)", () => {
		const r = registry().start(
			OWNER,
			{ requestId: 1, worldKind: "endless", characterId: "archer" },
			{
				now: 0,
				unixNow: OCT_31_NOON,
				isInServer: () => true,
				allowBossDoorSpawn: false,
				allowDebugInput: false,
			},
		);
		expect(codeOf(r)).toBe("ok");
	});
});

describe("party starts re-check every member (SV17)", () => {
	const PARTY: StartRunRequest = { requestId: 0, worldKind: "endless", party: [FRIEND] };
	const partyCtx = (a: SilverAccess, picks: ReadonlyArray<string>) =>
		ctx(a, { partyConsent: [OWNER, FRIEND], partyCharacters: picks });

	it("a member who does not own their lobby pick refuses the start (a wallet can turn unknown after the Ready)", () => {
		const reg = registry();
		const r = reg.start(OWNER, PARTY, partyCtx(access([OWNER]), ["archer", "archer"]));
		expect(codeOf(r)).toBe("locked_character");
		expect(r.ok ? "" : r.reason).toBe(`locked: player ${FRIEND} has not unlocked archer`);
		expect(codeOf(reg.start(OWNER, PARTY, partyCtx(access([OWNER]), ["archer", "knight"])))).toBe("ok");
	});

	it("lockedCharacterReason: the first unowned pick in member order; starters are never asked", () => {
		const asked: number[] = [];
		const owns = (id: number, c: CharacterId) => {
			asked.push(id);
			return c !== "archer";
		};
		expect(lockedCharacterReason([1, 2, 3], ["knight", "archer", "archer"], owns)).toBe(
			"player 2 has not unlocked archer",
		);
		expect(asked).toEqual([2]);
		expect(lockedCharacterReason([1, 2], ["knight"], owns)).toBe(undefined);
		expect(lockedCharacterReason([1], ["archer"], undefined)).toBe(undefined);
		expect([...STARTER_CHARACTERS]).toEqual(["knight"]);
	});
});
