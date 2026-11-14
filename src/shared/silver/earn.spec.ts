import { describe, expect, it } from "@rbxts/jest-globals";
import { ScoreSource, type SimConfig, type SimState } from "shared/sim";
import {
	SILVER,
	SILVER_ROWS,
	crateSilverOf,
	emptySilverRunInput,
	runSilver,
	silverRowOf,
	silverRunInputOf,
	type SilverRunInput,
} from "shared/silver";

function input(patch: Partial<SilverRunInput>): SilverRunInput {
	return { ...emptySilverRunInput(), ...patch };
}

/** A minimal replayed state with only the fields the earn rows read. */
function fakeState(o: {
	rooms?: number;
	floor?: number;
	depth?: number;
	opened?: number;
	caught?: number;
	found?: number;
	taken?: number;
	secretCount?: number;
}): SimState {
	const counts: number[] = [];
	for (let i = 0; i <= ScoreSource.ROOMS; i++) counts.push(0);
	counts[ScoreSource.ROOMS] = o.rooms ?? 0;
	return {
		score: { counts },
		endless: o.floor !== undefined ? { floor: o.floor, depth: o.depth ?? 1 } : undefined,
		treasure: o.opened !== undefined ? { opened: o.opened } : undefined,
		golden: o.caught !== undefined ? { caught: o.caught } : undefined,
		secrets: o.found !== undefined ? { found: o.found, taken: o.taken ?? 0, byHow: [0, 0, 0, 0] } : undefined,
	} as unknown as SimState;
}

describe("runSilver: the earn rows (docs/SILVER.md Earn table)", () => {
	it("an idle run pays 0 (no rows, no minimum)", () => {
		const r = runSilver(emptySilverRunInput());
		expect(r.sum).toBe(0);
		expect(r.amount).toBe(0);
		expect(r.qualifies).toBe(false);
		expect(r.topUp).toBe(0);
		expect(r.rows.map((x) => x.row)).toEqual([...SILVER_ROWS]);
		for (const row of r.rows) expect([row.count, row.silver]).toEqual([0, 0]);
	});

	it("rooms: roomPay each", () => {
		const r = runSilver(input({ roomsCleared: 7 }));
		expect(silverRowOf(r, "rooms")).toBe(7 * SILVER.roomPay);
		expect(r.rows[0]).toEqual({ row: "rooms", count: 7, silver: 14 });
	});

	it("crates: the stacks as they are", () => {
		expect(silverRowOf(runSilver(input({ crateSilver: 23 })), "crates")).toBe(23);
	});

	it("floors: descending from floor n pays floorBase + n", () => {
		// floors 1, 2, 3 cleared: (5 + 1) + (5 + 2) + (5 + 3) = 21
		const r = runSilver(input({ floor: 4 }));
		expect(silverRowOf(r, "floors")).toBe(21);
		expect(r.rows.find((x) => x.row === "floors")!.count).toBe(3);
		// a dev run from floor 10 that reached 12: (5 + 10) + (5 + 11)
		expect(silverRowOf(runSilver(input({ startFloor: 10, floor: 12 })), "floors")).toBe(31);
		// floor 1 alone: nothing descended
		expect(silverRowOf(runSilver(input({ floor: 1 })), "floors")).toBe(0);
	});

	it("bosses: the k-th kill pays bossPerDepth x the Depth it reached", () => {
		// Depth 1 -> 3: kills reaching Depth 2 and 3
		expect(silverRowOf(runSilver(input({ depth: 3 })), "bosses")).toBe(40 * 2 + 40 * 3);
		// from Depth 4 (a dev run) to 5: one kill at Depth 5
		expect(silverRowOf(runSilver(input({ startDepth: 4, depth: 5 })), "bosses")).toBe(200);
		expect(runSilver(input({ depth: 3 })).rows.find((x) => x.row === "bosses")!.count).toBe(2);
	});

	it("vaults, secrets, goldlings and kills", () => {
		const r = runSilver(input({ vaultsOpened: 2, secretsFound: 1, goldlingsCaught: 3, kills: 59 }));
		expect(silverRowOf(r, "vaults")).toBe(30);
		expect(silverRowOf(r, "secrets")).toBe(25);
		expect(silverRowOf(r, "goldlings")).toBe(90);
		expect(silverRowOf(r, "kills")).toBe(5); // 1 per 10, floored
		expect(r.sum).toBe(150);
	});

	it("the minimum applies at exactly minimumRooms rooms and never below", () => {
		const one = runSilver(input({ roomsCleared: SILVER.minimumRooms - 1, kills: 9 }));
		expect([one.qualifies, one.topUp, one.amount]).toEqual([false, 0, one.sum]);
		const two = runSilver(input({ roomsCleared: SILVER.minimumRooms }));
		expect(two.qualifies).toBe(true);
		expect(two.sum).toBe(4);
		expect(two.topUp).toBe(SILVER.runMinimum - 4);
		expect(two.amount).toBe(SILVER.runMinimum);
		// above the minimum: no top-up
		const rich = runSilver(input({ roomsCleared: 3, floor: 3 }));
		expect(rich.sum).toBe(6 + 6 + 7);
		expect([rich.topUp, rich.amount]).toEqual([1, 20]);
		const richer = runSilver(input({ roomsCleared: 5, floor: 3 }));
		expect([richer.topUp, richer.amount]).toEqual([0, richer.sum]);
	});

	it("junk counts read as 0 (never negative, never fractional)", () => {
		const r = runSilver(input({ roomsCleared: -3, kills: 0 / 0, crateSilver: 2.7, floor: -1 }));
		expect(r.sum).toBe(2);
	});
});

describe("silverRunInputOf: reads from the replayed state (SV0 findings)", () => {
	it("reads counts[ROOMS], the floor and Depth, vaults, secrets, Goldlings and the summary's kills", () => {
		const s = fakeState({ rooms: 5, floor: 6, depth: 2, opened: 1, caught: 2, found: 1, taken: 1 });
		const i = silverRunInputOf(s, { kills: 44 });
		expect(i).toEqual({
			roomsCleared: 5,
			crateSilver: 0,
			startFloor: 1,
			floor: 6,
			startDepth: 1,
			depth: 2,
			vaultsOpened: 1,
			secretsFound: 1,
			goldlingsCaught: 2,
			kills: 44,
		});
	});

	it("a secret pays once whether or not its chest is taken", () => {
		const untaken = runSilver(silverRunInputOf(fakeState({ found: 1, taken: 0 }), { kills: 0 }));
		const taken = runSilver(silverRunInputOf(fakeState({ found: 1, taken: 1 }), { kills: 0 }));
		expect(silverRowOf(untaken, "secrets")).toBe(SILVER.secretFound);
		expect(silverRowOf(taken, "secrets")).toBe(SILVER.secretFound);
	});

	it("a dev run's start floor and Depth come from the config", () => {
		const config = { endless: { startFloor: 8, startDepth: 2 } } as unknown as SimConfig;
		const i = silverRunInputOf(fakeState({ floor: 9, depth: 3 }), { kills: 0 }, config);
		expect([i.startFloor, i.floor, i.startDepth, i.depth]).toEqual([8, 9, 2, 3]);
		expect(runSilver(i).sum).toBe(5 + 8 + 40 * 3);
	});

	it("a state without endless mode (M1) descends nothing and kills no boss", () => {
		const i = silverRunInputOf(fakeState({}), { kills: 3 });
		expect([i.startFloor, i.floor, i.startDepth, i.depth]).toEqual([1, 1, 1, 1]);
		expect(runSilver(i).sum).toBe(0);
	});

	it("crates read 0 until track SC adds state.silver (the SC2 seam)", () => {
		expect(crateSilverOf(fakeState({ rooms: 3 }))).toBe(0);
	});
});
