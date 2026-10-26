// Endless room spawns never land on (or next to) a player: shared/sim endless.ts safeRoomSpawns (SPAWN_SAFE_RADIUS),
// fed by the floor layout's candidate tiles (shared/dungeon endless.ts endlessRoomSpawnTiles). Unit rules on a
// hand-made room, a sweep over real floors with the player standing at every room entry tile, the sim path (first
// entry spawns the moved enemies, deterministically, in solo and in a party; the cached layout is never changed;
// scoring tracks the moved enemies), and a walked-in recording that replays and validates on the server only with
// the same rule.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	EMPTY_INPUT,
	NO_KIND,
	encodeRecording,
	runReplay,
	type EndlessFloorWorld,
	type SimConfig,
	SPAWN_SAFE_RADIUS,
	createSimState,
	hashState,
	playerAt,
	safeRoomSpawns,
	step,
	stepParty,
	type ActorSpawn,
	type SimState,
	type SpawnTile,
} from "shared/sim";
import { roomDoorways, roomFloorTiles } from "shared/dungeon";
import { LIVE_RUN_LIMITS, buildEndlessRunConfig, validateRun, type RunSubmission } from "shared/run";
import { Driver } from "shared/run/testing";

const R2 = SPAWN_SAFE_RADIUS * SPAWN_SAFE_RADIUS;

function d2(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx;
	const dz = az - bz;
	return dx * dx + dz * dz;
}

/** An n x n grid of tiles at integer centers 0..n-1, row order (z, then x). */
function grid(n: number): SpawnTile[] {
	const out: SpawnTile[] = [];
	for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) out.push({ x, z });
	return out;
}

function soloAt(x: number, z: number): SimState {
	const s = createSimState(1, 0, 0);
	s.player.x = x;
	s.player.z = z;
	return s;
}

function distinct(spawns: ReadonlyArray<ActorSpawn>): boolean {
	for (let i = 0; i < spawns.size(); i++)
		for (let j = i + 1; j < spawns.size(); j++)
			if (spawns[i].x === spawns[j].x && spawns[i].z === spawns[j].z) return false;
	return true;
}

describe("safeRoomSpawns (rules)", () => {
	const tiles = grid(12);

	it("keeps every spawn that is already SPAWN_SAFE_RADIUS or more from the player", () => {
		const s = soloAt(0, 0);
		const spawns: ActorSpawn[] = [
			{ kind: "swarmer", x: 10, z: 10 },
			{ kind: "sniper", x: 4, z: 0 }, // exactly the radius: kept
		];
		expect(safeRoomSpawns(s, spawns, tiles)).toEqual(spawns);
	});

	it("moves a spawn on the player to the nearest free tile outside the radius; the others stay", () => {
		const s = soloAt(5, 5);
		const spawns: ActorSpawn[] = [
			{ kind: "bruiser", x: 5, z: 5 }, // on top of the player
			{ kind: "swarmer", x: 6, z: 5 }, // next to the player
			{ kind: "sniper", x: 11, z: 11 },
		];
		const out = safeRoomSpawns(s, spawns, tiles);
		expect(out.size()).toBe(3);
		expect(out[2]).toEqual(spawns[2]);
		for (let i = 0; i < out.size(); i++) {
			expect(out[i].kind).toBe(spawns[i].kind);
			expect(d2(out[i].x, out[i].z, 5, 5) >= R2).toBe(true);
		}
		expect(distinct(out)).toBe(true);
		// Nearest safe tile to (5, 5) in row order: (5, 1) is the first tile at distance 4.
		expect(out[0]).toEqual({ kind: "bruiser", x: 5, z: 1 });
		// Nearest safe tile to (6, 5): (9, 5), distance^2 9 (every closer tile is inside the radius).
		expect(out[1]).toEqual({ kind: "swarmer", x: 9, z: 5 });
	});

	it("is deterministic", () => {
		const s = soloAt(3, 7);
		const spawns: ActorSpawn[] = [];
		for (let i = 0; i < 10; i++) spawns.push({ kind: "swarmer", x: 3 + (i % 3), z: 6 + math.floor(i / 3) });
		expect(safeRoomSpawns(s, spawns, tiles)).toEqual(safeRoomSpawns(s, spawns, tiles));
	});

	it("a room too small for the radius uses the free tile farthest from the player", () => {
		const small = grid(4); // no tile is 4 from (1, 1): the farthest, (3, 3), is sqrt(8) away
		const s = soloAt(1, 1);
		const out = safeRoomSpawns(
			s,
			[
				{ kind: "swarmer", x: 1, z: 1 },
				{ kind: "swarmer", x: 2, z: 1 },
			],
			small,
		);
		// (3, 3) is the farthest tile (distance^2 8); the next farthest free ones are at distance^2 5, and row order
		// (z, then x) picks (3, 0) first.
		expect(out[0]).toEqual({ kind: "swarmer", x: 3, z: 3 });
		expect(out[1]).toEqual({ kind: "swarmer", x: 3, z: 0 });
	});

	it("dead players are ignored; with nobody alive nothing moves", () => {
		const s = soloAt(5, 5);
		s.player.dead = 1;
		const spawns: ActorSpawn[] = [{ kind: "bruiser", x: 5, z: 5 }];
		expect(safeRoomSpawns(s, spawns, tiles)).toEqual(spawns);
	});

	it("keeps clear of every living party member", () => {
		const setup = buildEndlessRunConfig(1337, 3);
		const s = createSimState(1337, setup.spawn!.x, setup.spawn!.z, setup.config);
		const at = [
			[2, 2],
			[9, 9],
			[2, 9],
		];
		for (let i = 0; i < 3; i++) {
			playerAt(s, i).x = at[i][0];
			playerAt(s, i).z = at[i][1];
		}
		const spawns: ActorSpawn[] = [
			{ kind: "swarmer", x: 2, z: 3 },
			{ kind: "swarmer", x: 9, z: 8 },
			{ kind: "sniper", x: 3, z: 9 },
		];
		for (const sp of safeRoomSpawns(s, spawns, tiles))
			for (const [x, z] of at) expect(d2(sp.x, sp.z, x, z) >= R2).toBe(true);
	});
});

describe("endless floors: no spawn near a player entering a room", () => {
	it("from every entry tile of every populated room (seeds 1337, 42, 7; floors 1-6)", () => {
		let entries = 0;
		let tooCloseBefore = 0;
		let cramped = 0;
		for (const seed of [1337, 42, 7]) {
			const setup = buildEndlessRunConfig(seed);
			const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, setup.config);
			for (let floor = 1; floor <= 6; floor++) {
				const w = setup.endlessFloor(floor);
				const d = w.dungeon;
				for (let id = 0; id < w.roomSpawns.size(); id++) {
					const planned = w.roomSpawns[id];
					if (planned.size() === 0) continue;
					const tiles = w.layout.roomSpawnTiles[id];
					expect(tiles.size() >= planned.size()).toBe(true);
					const doors = roomDoorways(d, id);
					// Entry tiles: the room's floor tiles touching (8-neighbour) one of its doorways.
					const entry = roomFloorTiles(d, id).filter((t) =>
						doors.some((door) => math.abs(door.x - t.x) <= 1 && math.abs(door.z - t.z) <= 1),
					);
					for (const t of entry) {
						entries++;
						s.player.x = t.x;
						s.player.z = t.z;
						for (const sp of planned) if (d2(sp.x, sp.z, t.x, t.z) < R2) tooCloseBefore++;
						const out = safeRoomSpawns(s, planned, tiles);
						expect(out.size()).toBe(planned.size());
						expect(distinct(out)).toBe(true);
						const safeTiles = tiles.filter((c) => d2(c.x, c.z, t.x, t.z) >= R2).size();
						if (safeTiles < planned.size()) cramped++;
						let minNow = math.huge;
						let minPlanned = math.huge;
						for (let i = 0; i < out.size(); i++) {
							expect(out[i].kind).toBe(planned[i].kind);
							const now = d2(out[i].x, out[i].z, t.x, t.z);
							minNow = math.min(minNow, now);
							minPlanned = math.min(minPlanned, d2(planned[i].x, planned[i].z, t.x, t.z));
							// A room with enough safe tiles keeps everyone out of the radius.
							if (safeTiles >= planned.size()) expect(now >= R2).toBe(true);
						}
						// A cramped room never brings the closest enemy nearer than planned.
						expect(minNow >= minPlanned).toBe(true);
					}
				}
			}
		}
		print(
			`[endlessSpawn] ${entries} room entries, ${tooCloseBefore} planned spawns were too close, ${cramped} cramped`,
		);
		expect(entries > 0).toBe(true);
		// The old placement put enemies inside the radius from some entry tiles (what this fix is for).
		expect(tooCloseBefore > 0).toBe(true);
	});
});

describe("endless sim: first entry spawns the moved enemies", () => {
	function firstRoom(setup: ReturnType<typeof buildEndlessRunConfig>): number {
		const w = setup.endlessFloor(1);
		for (let id = 0; id < w.roomSpawns.size(); id++) if (w.roomSpawns[id].size() > 0) return id;
		return -1;
	}

	it("solo: standing exactly on a planned spawn tile, every enemy appears at least SPAWN_SAFE_RADIUS away", () => {
		const run = () => {
			const setup = buildEndlessRunConfig(42);
			const s = createSimState(42, setup.spawn!.x, setup.spawn!.z, setup.config);
			const room = firstRoom(setup);
			const w = setup.endlessFloor(1);
			s.player.x = w.roomSpawns[room][0].x;
			s.player.z = w.roomSpawns[room][0].z;
			step(s, EMPTY_INPUT, setup.config);
			expect(s.events.roomEntered).toBe(room + 1);
			expect(s.events.actorsSpawned).toBe(w.roomSpawns[room].size());
			for (const a of s.combat.actors) {
				if (a.kind === NO_KIND) continue;
				expect(d2(a.x, a.z, s.player.x, s.player.z) >= R2).toBe(true);
			}
			return hashState(s);
		};
		expect(run()).toBe(run());
	});

	it("party of 2: clear of both players", () => {
		const setup = buildEndlessRunConfig(42, 2);
		const s = createSimState(42, setup.spawn!.x, setup.spawn!.z, setup.config);
		const room = firstRoom(setup);
		const planned = setup.endlessFloor(1).roomSpawns[room];
		s.player.x = planned[0].x;
		s.player.z = planned[0].z;
		const p1 = playerAt(s, 1);
		p1.x = planned[planned.size() - 1].x;
		p1.z = planned[planned.size() - 1].z;
		stepParty(s, [EMPTY_INPUT, EMPTY_INPUT], setup.config);
		expect(s.events.roomEntered).toBe(room + 1);
		for (const a of s.combat.actors) {
			if (a.kind === NO_KIND) continue;
			for (let i = 0; i < 2; i++) {
				const p = playerAt(s, i);
				// Both players stand inside the room; the room is big enough on this seed for the full radius.
				expect(d2(a.x, a.z, p.x, p.z) >= R2).toBe(true);
			}
		}
	});
});

describe("safeRoomSpawns (edge cases)", () => {
	const tiles = grid(12);

	it("a spawn just inside the radius is moved; one exactly on it is kept", () => {
		const s = soloAt(0.05, 0);
		const out = safeRoomSpawns(s, [{ kind: "swarmer", x: 4, z: 0 }], tiles); // 3.95 away
		expect(d2(out[0].x, out[0].z, 0.05, 0) >= R2).toBe(true);
		expect(out[0]).never.toEqual({ kind: "swarmer", x: 4, z: 0 });
		const kept = soloAt(0, 0);
		expect(safeRoomSpawns(kept, [{ kind: "swarmer", x: 4, z: 0 }], tiles)).toEqual([
			{ kind: "swarmer", x: 4, z: 0 },
		]);
	});

	it("a moved spawn never takes the tile of a spawn that stays", () => {
		const s = soloAt(5, 5);
		const out = safeRoomSpawns(
			s,
			[
				{ kind: "sniper", x: 5, z: 1 }, // safe (exactly 4 away): stays, and holds the nearest safe tile
				{ kind: "bruiser", x: 5, z: 5 }, // on the player
			],
			tiles,
		);
		expect(out[0]).toEqual({ kind: "sniper", x: 5, z: 1 });
		// The next nearest safe tiles are (1, 5), (9, 5) and (5, 9), all 4 away; row order picks (1, 5).
		expect(out[1]).toEqual({ kind: "bruiser", x: 1, z: 5 });
	});

	it("never changes its inputs (the layout is cached and shared by every run)", () => {
		const s = soloAt(5, 5);
		const spawns: ActorSpawn[] = [
			{ kind: "bruiser", x: 5, z: 5 },
			{ kind: "swarmer", x: 6, z: 5 },
		];
		const spawnsBefore = spawns.map((sp) => ({ kind: sp.kind, x: sp.x, z: sp.z }));
		const tilesBefore = tiles.map((t) => ({ x: t.x, z: t.z }));
		const out = safeRoomSpawns(s, spawns, tiles);
		expect(out).never.toBe(spawns);
		expect(spawns).toEqual(spawnsBefore);
		expect(tiles).toEqual(tilesBefore);
	});

	it("no spawns gives none; no candidate tiles leaves the spawns where they are", () => {
		const s = soloAt(5, 5);
		expect(safeRoomSpawns(s, [], tiles)).toEqual([]);
		const spawns: ActorSpawn[] = [{ kind: "bruiser", x: 5, z: 5 }];
		expect(safeRoomSpawns(s, spawns, [])).toEqual(spawns);
	});

	it("a party member who left is ignored; the others are still kept clear of", () => {
		const setup = buildEndlessRunConfig(1337, 2);
		const s = createSimState(1337, setup.spawn!.x, setup.spawn!.z, setup.config);
		s.player.x = 0;
		s.player.z = 0;
		const gone = playerAt(s, 1);
		gone.x = 8;
		gone.z = 8;
		s.party!.left[1] = 1;
		const out = safeRoomSpawns(
			s,
			[
				{ kind: "swarmer", x: 8, z: 8 }, // on the player who left: stays
				{ kind: "swarmer", x: 0, z: 1 }, // next to player 0: moves
			],
			tiles,
		);
		expect(out[0]).toEqual({ kind: "swarmer", x: 8, z: 8 });
		expect(d2(out[1].x, out[1].z, 0, 0) >= R2).toBe(true);
	});
});

/** `config` with every floor's candidate tiles removed: the sim then spawns room enemies exactly as planned. */
function withoutSpawnTiles(config: Readonly<SimConfig>): SimConfig {
	const endless = config.endless!;
	const bare = new Map<number, EndlessFloorWorld>();
	return {
		...config,
		endless: {
			runSeed: endless.runSeed,
			worldForFloor: (f) => {
				let world = bare.get(f);
				if (world === undefined) {
					world = { ...endless.worldForFloor(f), roomSpawnTiles: undefined };
					bare.set(f, world);
				}
				return world;
			},
		},
	};
}

/** The populated rooms of `w`, most candidate tiles first (ties: lower id). */
function roomsBySize(w: Readonly<EndlessFloorWorld>): number[] {
	const ids: number[] = [];
	for (let id = 0; id < w.roomSpawns.size(); id++) if (w.roomSpawns[id].size() > 0) ids.push(id);
	const size = (id: number) => w.roomSpawnTiles![id].size();
	ids.sort((a, b) => (size(a) !== size(b) ? size(a) > size(b) : a < b));
	return ids;
}

describe("endless sim: room entry details", () => {
	it("the cached floor layout is never changed by entering rooms", () => {
		const setup = buildEndlessRunConfig(42);
		const s = createSimState(42, setup.spawn!.x, setup.spawn!.z, setup.config);
		const w = setup.endlessFloor(1);
		const snapshot = w.roomSpawns.map((r) => r.map((sp) => ({ kind: sp.kind, x: sp.x, z: sp.z })));
		for (const id of roomsBySize(w)) {
			s.player.x = w.roomSpawns[id][0].x;
			s.player.z = w.roomSpawns[id][0].z;
			step(s, EMPTY_INPUT, setup.config);
			expect(s.endless!.roomsEntered[id]).toBe(1);
		}
		expect(w.roomSpawns).toEqual(snapshot);
		expect(setup.endlessFloor(1).roomSpawns).toEqual(snapshot);
	});

	it("scoring attaches the moved enemies to the room and engages it on the entry tick", () => {
		const setup = buildEndlessRunConfig(42);
		const s = createSimState(42, setup.spawn!.x, setup.spawn!.z, setup.config);
		const w = setup.endlessFloor(1);
		const id = roomsBySize(w)[0];
		s.player.x = w.roomSpawns[id][0].x;
		s.player.z = w.roomSpawns[id][0].z;
		const tick = s.tick;
		step(s, EMPTY_INPUT, setup.config);
		const rec = s.score!.rooms.find((r) => r.room === id)!;
		expect(rec.memberSlots.size()).toBe(w.roomSpawns[id].size());
		expect(rec.engageTick).toBe(tick);
		for (const slot of rec.memberSlots) {
			const a = s.combat.actors[slot];
			expect(d2(a.x, a.z, s.player.x, s.player.z) >= R2).toBe(true);
		}
	});

	it("two party members opening two rooms on the same tick: every enemy is clear of both", () => {
		const setup = buildEndlessRunConfig(42, 2);
		const s = createSimState(42, setup.spawn!.x, setup.spawn!.z, setup.config);
		const w = setup.endlessFloor(1);
		const [a, b] = roomsBySize(w);
		s.player.x = w.roomSpawns[a][0].x;
		s.player.z = w.roomSpawns[a][0].z;
		const p1 = playerAt(s, 1);
		p1.x = w.roomSpawns[b][0].x;
		p1.z = w.roomSpawns[b][0].z;
		stepParty(s, [EMPTY_INPUT, EMPTY_INPUT], setup.config);
		expect([s.endless!.roomsEntered[a], s.endless!.roomsEntered[b]]).toEqual([1, 1]);
		expect(s.events.actorsSpawned).toBe(w.roomSpawns[a].size() + w.roomSpawns[b].size());
		for (const actor of s.combat.actors) {
			if (actor.kind === NO_KIND) continue;
			for (let i = 0; i < 2; i++) {
				const p = playerAt(s, i);
				expect(d2(actor.x, actor.z, p.x, p.z) >= R2).toBe(true);
			}
		}
	});

	it("a world without candidate tiles (hand-built test worlds) spawns exactly as planned", () => {
		const setup = buildEndlessRunConfig(42);
		const config = withoutSpawnTiles(setup.config);
		const s = createSimState(42, setup.spawn!.x, setup.spawn!.z, config);
		const w = setup.endlessFloor(1);
		const id = roomsBySize(w)[0];
		s.player.x = w.roomSpawns[id][0].x;
		s.player.z = w.roomSpawns[id][0].z;
		step(s, EMPTY_INPUT, config);
		const at: string[] = [];
		for (const actor of s.combat.actors) if (actor.kind !== NO_KIND) at.push(`${actor.x},${actor.z}`);
		expect(at).toEqual(w.roomSpawns[id].map((sp) => `${sp.x},${sp.z}`));
	});
});

describe("a walked-in endless run (no debug input)", () => {
	/**
	 * Walks the bot toward each populated room of floor 1 (largest first) on a few seeds until the first room it
	 * enters had a planned spawn within SPAWN_SAFE_RADIUS of where it stepped in, i.e. a run where the rule fired.
	 */
	function walkedEntry() {
		// Endless rooms are large (ENDLESS_ROOM_SCALE), so a spawn near the door is rare: 17 is the first seed that has one.
		for (const seed of [17, 42, 1337, 7, 99, 2024]) {
			const setup = buildEndlessRunConfig(seed);
			for (const target of roomsBySize(setup.endlessFloor(1))) {
				const drv = new Driver(setup, seed);
				const room = drv.world().config.encounter!.rooms[target];
				// Stop on the first entry into a room with enemies (the entrance room is entered on the first tick).
				const enteredPopulated = () => {
					const r = drv.state.events.roomEntered;
					return r !== 0 && drv.world().roomSpawns[r - 1].size() > 0;
				};
				drv.walkTo(room.cx, room.cz, enteredPopulated, 3000);
				if (!enteredPopulated()) continue;
				const id = drv.state.events.roomEntered - 1;
				const p = drv.state.player;
				const planned = drv.world().roomSpawns[id];
				if (planned.some((sp) => d2(sp.x, sp.z, p.x, p.z) < R2)) return { seed, setup, drv, id, planned };
			}
		}
		error("no walked room entry moved a spawn", 0);
	}
	const { seed, setup, drv, id, planned } = walkedEntry();
	const recording = drv.recorder.getRecording();
	const liveHash = hashState(drv.state);

	it("the player walked into a room whose plan had an enemy too close, and no enemy appeared there", () => {
		print(
			`[endlessSpawn] seed ${seed}: walked into room ${id} on tick ${drv.state.tick - 1}, ` +
				`${planned.size()} enemies planned`,
		);
		const p = drv.state.player;
		const safe = drv
			.world()
			.roomSpawnTiles![id].filter((t) => d2(t.x, t.z, p.x, p.z) >= R2)
			.size();
		expect(safe >= planned.size()).toBe(true);
		let n = 0;
		for (const a of drv.state.combat.actors) {
			if (a.kind === NO_KIND) continue;
			n++;
			expect(d2(a.x, a.z, p.x, p.z) >= R2).toBe(true);
		}
		expect(n).toBe(planned.size());
	});

	it("replays to the live hash, twice, from a fresh config", () => {
		expect(hashState(runReplay(recording, buildEndlessRunConfig(seed).config))).toBe(liveHash);
		expect(hashState(runReplay(recording, buildEndlessRunConfig(seed).config))).toBe(liveHash);
	});

	it("validates on a live server", () => {
		const submission: RunSubmission = {
			seed,
			atBossDoor: false,
			recording: encodeRecording(recording),
			claimedHash: liveHash,
			claimed: { ticks: drv.state.tick, kills: 0, bossDefeated: false, died: false },
		};
		const probe = validateRun(submission, LIVE_RUN_LIMITS);
		expect(probe.serverHash).toBe(liveHash);
		const ok = validateRun({ ...submission, claimed: probe.summary }, LIVE_RUN_LIMITS);
		expect([ok.ok, ok.code]).toEqual([true, undefined]);
	});

	it("the moved positions are part of the replayed state: a replay without the rule diverges", () => {
		const oldRule = withoutSpawnTiles(setup.config);
		expect(hashState(runReplay(recording, oldRule))).never.toBe(liveHash);
	});
});
