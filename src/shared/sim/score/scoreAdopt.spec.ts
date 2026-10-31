// docs/ENEMY_VARIANTS.md EV1: adoptScoreRoomMember. A runtime child (a slime's split, a summoner's summons) joins the
// room record holding its parent's slot and id: the room stays open until the child is down too; a cleared room, a
// parent in no record, or an unscored run ignore it; par never changes; the score hash covers the new member.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	ScoreSource,
	SimCtx,
	adoptScoreRoomMember,
	archetypeAt,
	clearEvents,
	clearScoreEvents,
	createSimState,
	hashLayout,
	hashState,
	stepScore,
	type ActorSpawn,
	type ActorState,
	type EncounterConfig,
	type EncounterRoom,
	type ScoreState,
	type SimConfig,
	type SimState,
} from "shared/sim";

const SCORED: SimConfig = { ...DEFAULT_SIM_CONFIG, scoring: {} };

function room(id: number, minX: number, maxX: number, minZ: number, maxZ: number): EncounterRoom {
	return {
		id,
		type: "combat",
		depth: id,
		cx: (minX + maxX) / 2,
		cz: (minZ + maxZ) / 2,
		minX,
		maxX,
		minZ,
		maxZ,
		floorTiles: 1,
	};
}

/** Room 0 (south-west, empty) and room 1 (north-east) of the greybox arena (score.spec.ts's). */
const ROOMS = [room(0, -7, -3, -7, -3), room(1, 3, 7, 3, 7)];

function encounter(spawns: ActorSpawn[]): EncounterConfig {
	return { spawns, rooms: ROOMS, entranceRoom: 0, bossRoom: -1 };
}

/** A swarmer and a sniper in room 1, one swarmer outside every room; the player in room 0. */
const SPAWNS: ActorSpawn[] = [
	{ kind: "swarmer", x: 5, z: 5 },
	{ kind: "sniper", x: 6, z: 6 },
	{ kind: "swarmer", x: 0, z: 0 },
];

function scored(config: SimConfig = SCORED): SimState {
	return createSimState(1, -6, -6, { ...config, encounter: encounter(SPAWNS) });
}

function sc(s: SimState): ScoreState {
	return s.score!;
}

/** One tick of the scoring pass only (score.spec.ts's tick): clear events, run `during`, then stepScore. */
function tick(s: SimState, during?: (ctx: SimCtx) => void): void {
	clearEvents(s.events);
	if (s.score !== undefined) clearScoreEvents(s.score);
	if (during !== undefined) during(new SimCtx().bind(s, SCORED, EMPTY_INPUT));
	if (s.score !== undefined) stepScore(s);
	s.tick += 1;
}

function actorOf(s: SimState, id: string, nth = 0): ActorState {
	let seen = 0;
	for (const a of s.combat.actors) {
		if (a.kind >= 0 && archetypeAt(a.kind).id === id) {
			if (seen === nth) return a;
			seen++;
		}
	}
	return error(`no ${id} #${nth}`);
}

/** Spawns a swarmer child at (x, z) and adopts it under `parent`. */
function spawnChild(ctx: SimCtx, s: SimState, parent: ActorState, x: number, z: number): ActorState {
	const child = ctx.spawnActor("swarmer", x, z)!;
	adoptScoreRoomMember(s, parent, child);
	return child;
}

describe("adoptScoreRoomMember", () => {
	it("a room stays open until an adopted child dies (adopted on its parent's death tick), par unchanged", () => {
		const s = scored();
		const r = sc(s).rooms[0];
		const par = r.parTicks;
		tick(s, (ctx) => ctx.killActor(actorOf(s, "swarmer")));
		let child: ActorState | undefined;
		tick(s, (ctx) => {
			const parent = actorOf(s, "sniper");
			ctx.killActor(parent); // the split runs in onDeath: the parent is a corpse in its slot
			child = spawnChild(ctx, s, parent, 5.5, 5.5);
		});
		expect(r.cleared).toBe(0);
		expect(r.memberSlots.size()).toBe(3);
		expect(r.memberIds[2]).toBe(child!.id);
		expect(r.memberSlots[2]).toBe(s.combat.actors.indexOf(child!));
		expect(r.parTicks).toBe(par);
		for (let k = 0; k < 10; k++) tick(s);
		expect(r.cleared).toBe(0);
		tick(s, (ctx) => ctx.killActor(child!));
		expect(r.cleared).toBe(1);
		expect(sc(s).counts[ScoreSource.ROOMS]).toBe(1);
	});

	it("a child of an adopted child joins the same room; adopting twice adds it once", () => {
		const s = scored();
		const r = sc(s).rooms[0];
		tick(s, (ctx) => {
			const first = spawnChild(ctx, s, actorOf(s, "sniper"), 5.5, 5.5);
			const second = spawnChild(ctx, s, first, 4.5, 4.5);
			adoptScoreRoomMember(s, first, second);
		});
		expect(r.memberSlots.size()).toBe(4);
	});

	it("a cleared room ignores adoption", () => {
		const s = scored();
		const r = sc(s).rooms[0];
		const parent = actorOf(s, "sniper");
		tick(s, (ctx) => {
			ctx.killActor(actorOf(s, "swarmer"));
			ctx.killActor(parent);
		});
		expect(r.cleared).toBe(1);
		const slots = [...r.memberSlots];
		const ids = [...r.memberIds];
		tick(s, (ctx) => spawnChild(ctx, s, parent, 5.5, 5.5));
		expect(r.memberSlots).toEqual(slots);
		expect(r.memberIds).toEqual(ids);
		expect(sc(s).counts[ScoreSource.ROOMS]).toBe(1);
	});

	it("a parent in no record adopts nothing; neither does an unscored run", () => {
		const s = scored();
		const before = sc(s).rooms.map((r) => r.memberSlots.size());
		tick(s, (ctx) => spawnChild(ctx, s, actorOf(s, "swarmer", 1), 0.5, 0.5));
		expect(sc(s).rooms.map((r) => r.memberSlots.size())).toEqual(before);

		const plain = scored(DEFAULT_SIM_CONFIG);
		const h0 = hashState(plain);
		const ctx = new SimCtx().bind(plain, DEFAULT_SIM_CONFIG, EMPTY_INPUT);
		const child = ctx.spawnActor("swarmer", 5.5, 5.5)!;
		const h1 = hashState(plain);
		adoptScoreRoomMember(plain, actorOf(plain, "sniper"), child);
		expect(plain.score).toBe(undefined);
		expect(hashState(plain)).toBe(h1);
		expect(h1).never.toBe(h0);
	});

	it("the score hash includes the adopted member (named like every member)", () => {
		const s = scored();
		const ctx = new SimCtx().bind(s, SCORED, EMPTY_INPUT);
		const child = ctx.spawnActor("swarmer", 5.5, 5.5)!;
		const before = hashState(s);
		adoptScoreRoomMember(s, actorOf(s, "sniper"), child);
		expect(hashState(s)).never.toBe(before);
		const layout = hashLayout(s, true);
		const at = layout.names.indexOf("score.rooms[0].members[2].id");
		expect(at >= 0).toBe(true);
		expect(layout.values[at]).toBe(child.id);
		expect(layout.values[layout.names.indexOf("score.rooms[0].members[2].slot")]).toBe(
			s.combat.actors.indexOf(child),
		);
	});
});
