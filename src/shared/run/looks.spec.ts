// docs/COSMETICS.md CS4: looks on the run session. At every start (every world, CSD12) the server reads each member's
// equipped cosmetics (StartContext.equipped, the wallet seam), turns them into a look for the character they play
// (sessionLooks -> shared/cosmetics cosmeticLookOf) and stores them on the RunSession for the start reply and
// PartyRunStart. Presentation only: the setup, and so every hash, is the same whatever anyone wears; an unknown wallet,
// a broken provider or no lookup is the default look and never refuses a start.
import { describe, expect, it } from "@rbxts/jest-globals";
import { createSimState, hashState } from "shared/sim";
import { bytesOfHex } from "shared/crypto";
import { dailySeedFrom } from "shared/daily";
import {
	LOCKED_SILVER_ACCESS,
	OPEN_SILVER_ACCESS,
	RunSessionRegistry,
	accessEquipped,
	sessionLooks,
	type RunSession,
	type RunSetup,
	type SilverAccess,
	type StartContext,
	type StartRunRequest,
} from "shared/run";

const OWNER = 101;
const FRIEND = 202;
/** 2026-10-31T12:00:00Z. */
const OCT_31_NOON = 1793404800 + 43200;
const TEST_KEY = bytesOfHex("000102030405060708090a0b0c0d0e0f");

const MINE = new Map([
	["dye.knight", "dye.knight.teal"],
	["dye.archer", "dye.archer.frost"],
	["outline", "outline.azure"],
	["trail", "trail.jade"],
]);
const THEIRS = new Map([
	["spark", "spark.rose"],
	["dye.knight", "dye.knight.prismatic"],
]);

function registry() {
	let ids = 0;
	return new RunSessionRegistry({
		newRunId: () => `run-${++ids}`,
		pickSeed: () => 1337,
		dailySeed: (day) => dailySeedFrom(day, TEST_KEY),
	});
}

function ctx(equipped: StartContext["equipped"], over: Partial<StartContext> = {}): StartContext {
	return {
		now: 0,
		unixNow: OCT_31_NOON,
		isInServer: (id) => id === OWNER || id === FRIEND,
		allowBossDoorSpawn: false,
		allowDebugInput: false,
		equipped,
		...over,
	};
}

function started(reg: RunSessionRegistry, req: StartRunRequest, c: StartContext): RunSession {
	const r = reg.start(OWNER, req, c);
	if (!r.ok) error(`start refused: ${r.code} ${r.reason}`);
	return r.session;
}

function firstHash(seed: number, setup: RunSetup): string {
	const spawn = setup.spawn!;
	return hashState(createSimState(seed, spawn.x, spawn.z, setup.config));
}

const lookup = (id: number) => (id === OWNER ? MINE : id === FRIEND ? THEIRS : undefined);

describe("looks on the run session (CS4)", () => {
	it("solo: the owner's look for the character they play", () => {
		const knight = started(registry(), { requestId: 1, worldKind: "endless" }, ctx(lookup));
		expect(knight.looks).toEqual([
			{ dye: "dye.knight.teal", outline: "outline.azure", trail: "trail.jade" },
		]);
		const archer = started(
			registry(),
			{ requestId: 1, worldKind: "endless", characterId: "archer" },
			ctx(lookup),
		);
		expect(archer.looks[0].dye).toBe("dye.archer.frost");
	});

	it("party: each member's look in member order, for the lobby's picks", () => {
		const s = started(
			registry(),
			{ requestId: 1, worldKind: "endless", party: [FRIEND] },
			ctx(lookup, { partyConsent: [OWNER, FRIEND], partyCharacters: ["archer", "knight"] }),
		);
		expect(s.looks).toEqual([
			{ dye: "dye.archer.frost", outline: "outline.azure", trail: "trail.jade" },
			{ dye: "dye.knight.prismatic", spark: "spark.rose" },
		]);
	});

	it("every world carries looks (CSD12); a world without characters dresses its players as the Knight", () => {
		for (const world of ["game", "dungeonNoEncounter", "endless", "daily"]) {
			const s = started(registry(), { requestId: 1, worldKind: world }, ctx(lookup));
			expect([world, s.looks[0].dye, s.looks[0].outline]).toEqual([world, "dye.knight.teal", "outline.azure"]);
		}
	});

	it("never changes the setup: the same first hash with or without looks", () => {
		const dressed = started(registry(), { requestId: 1, worldKind: "endless" }, ctx(lookup));
		const plain = started(registry(), { requestId: 1, worldKind: "endless" }, ctx(undefined));
		expect(plain.looks).toEqual([{}]);
		expect(firstHash(dressed.seed, dressed.setup)).toBe(firstHash(plain.seed, plain.setup));
	});

	it("an unknown wallet, junk or no lookup: the default look, and the start goes through", () => {
		expect(sessionLooks([OWNER, FRIEND], ["knight", "archer"], () => undefined)).toEqual([{}, {}]);
		expect(sessionLooks([OWNER], undefined, undefined)).toEqual([{}]);
		const junk = new Map([
			["dye.knight", "outline.azure"],
			["outline", "nope"],
		]);
		expect(sessionLooks([OWNER], ["knight"], () => junk)).toEqual([{}]);
	});
});

describe("the wallet seam's looks (accessEquipped)", () => {
	it("copies the provider's string entries; none, an error or junk is undefined (the default look)", () => {
		const access: SilverAccess = { ...OPEN_SILVER_ACCESS, equippedFor: (id) => (id === OWNER ? MINE : undefined) };
		const copy = accessEquipped(access, OWNER)!;
		expect(copy.get("outline")).toBe("outline.azure");
		expect(copy).never.toBe(MINE);
		expect(accessEquipped(access, FRIEND)).toBe(undefined);
		expect(accessEquipped(OPEN_SILVER_ACCESS, OWNER)).toBe(undefined);
		expect(accessEquipped(LOCKED_SILVER_ACCESS, OWNER)).toBe(undefined);
		const broken: SilverAccess = { ...OPEN_SILVER_ACCESS, equippedFor: () => error("datastore down") };
		expect(accessEquipped(broken, OWNER)).toBe(undefined);
		const junk: SilverAccess = {
			...OPEN_SILVER_ACCESS,
			equippedFor: () => new Map<unknown, unknown>([[1, "x"], ["outline", 5], ["trail", "trail.jade"]]) as never,
		};
		expect(accessEquipped(junk, OWNER)!.get("trail")).toBe("trail.jade");
		expect(accessEquipped(junk, OWNER)!.size()).toBe(1);
	});
});
