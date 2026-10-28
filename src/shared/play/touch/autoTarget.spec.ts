// Headless spec for the auto-target pick (docs/MOBILE_IMPL.md MB5). The player stands at the origin facing +z unless a
// test says otherwise; each actor is a test dummy spawned at its spot (slot order = spot order).
import { describe, expect, it } from "@rbxts/jest-globals";
import { TOUCH } from "shared/config";
import { TILE_SIZE } from "shared/dungeon";
import { EMPTY_INPUT, SimCtx, createSimState, hashState, playerAt, type ActorState, type SimState } from "shared/sim";
import { TEST_DUMMY } from "shared/sim/testing";
import { pickAutoTarget, type AutoTargetQuery } from "./autoTarget";

const RANGE = TOUCH.autoTarget.rangeTiles * TILE_SIZE;

function arena(spots: ReadonlyArray<readonly [number, number]>): {
	state: SimState;
	ctx: SimCtx;
	actors: ActorState[];
} {
	const state = createSimState(1, 0, 0);
	const p = playerAt(state, 0);
	p.faceX = 0;
	p.faceZ = 1;
	const ctx = new SimCtx().bind(state, {}, EMPTY_INPUT);
	const actors = new Array<ActorState>();
	for (const spot of spots) actors.push(ctx.spawnActor(TEST_DUMMY.id, spot[0], spot[1])!);
	return { state, ctx, actors };
}

function query(state: SimState, over: Partial<AutoTargetQuery> = {}): AutoTargetQuery {
	return { state, playerIndex: 0, blocked: undefined, previousId: 0, ...over };
}

describe("pickAutoTarget", () => {
	it("the nearest of two in the open wins", () => {
		const { state, actors } = arena([
			[0, 5],
			[0, 3],
		]);
		expect(pickAutoTarget(query(state))?.id).toBe(actors[1].id);
	});

	it("out of range gives undefined; exactly at the range is in", () => {
		expect(pickAutoTarget(query(arena([[0, RANGE + TILE_SIZE]]).state))).toBe(undefined);
		expect(pickAutoTarget(query(arena([[0, RANGE]]).state))?.id).toBeGreaterThan(0);
	});

	it("a wall between: the blocked actor loses to a farther visible one", () => {
		const { state, actors } = arena([
			[2, 4],
			[0, 6],
		]);
		const wall = (x: number) => x === 2;
		expect(pickAutoTarget(query(state))?.id).toBe(actors[0].id); // open floor: the nearer one
		expect(pickAutoTarget(query(state, { blocked: wall }))?.id).toBe(actors[1].id);
	});

	it("dead actors and free slots are skipped", () => {
		const { state, ctx, actors } = arena([
			[0, 2],
			[0, 4],
			[0, 6],
		]);
		actors[0].alive = 0;
		ctx.freeActor(actors[1]);
		expect(pickAutoTarget(query(state))?.id).toBe(actors[2].id);
		ctx.freeActor(actors[2]);
		expect(pickAutoTarget(query(state))).toBe(undefined);
	});

	it("the cone bonus: slightly farther but straight ahead beats one off to the side", () => {
		// Side: d 3, outside the cone, cost 3. Ahead: d 3.5 inside the cone, cost 3.5 * coneFactor (2.625).
		const { state, actors } = arena([
			[3, 0],
			[0, 3.5],
		]);
		expect(pickAutoTarget(query(state))?.id).toBe(actors[1].id);
	});

	it("hysteresis: the current target keeps its bonus within the sticky factor", () => {
		// Without a previous target the nearer one wins (3 * coneFactor < 4 * coneFactor). With the farther one as the
		// previous target it wins too: 4 * coneFactor * stickyFactor < 3 * coneFactor.
		const { state, actors } = arena([
			[0, 3],
			[0, 4],
		]);
		expect(pickAutoTarget(query(state))?.id).toBe(actors[0].id);
		expect(pickAutoTarget(query(state, { previousId: actors[1].id }))?.id).toBe(actors[1].id);
	});

	it("an exact tie goes to the lower slot", () => {
		const { state, actors } = arena([
			[-3, 0],
			[3, 0],
		]);
		expect(pickAutoTarget(query(state))?.id).toBe(actors[0].id);
	});

	it("is read-only on the sim state", () => {
		const { state } = arena([
			[0, 3],
			[2, 4],
		]);
		const before = hashState(state);
		pickAutoTarget(query(state, { blocked: (x: number) => x === 2, previousId: 1 }));
		expect(hashState(state)).toBe(before);
	});
});
