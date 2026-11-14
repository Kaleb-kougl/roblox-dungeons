// The tutorial world (docs/TUTORIAL.md T2): the LOCK spec on both layouts and the lesson table, the floor-1 spawns,
// determinism, a harmless smoke run, the debug floor skip through the boss floor, scaling, the registry and the
// telemetry start-hearts baseline. The pellet lesson (docs/PELLETS.md PL11 / PL12): combat G's pellets (floor cells
// only, reachable, none elsewhere), the sweep lock in the real world (held under the Knight's sword while pellets
// remain, released on the last pickup, the last pickup and a lethal hit on one tick), and its Sweep.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL } from "shared/config";
import {
	BOSS_ACT1_KIND,
	BRUISER_KIND,
	ENDLESS_FIRST_FLOOR,
	ENDLESS_ROOM_SCALE,
	ENDLESS_SOLID_PILLARS,
	NO_POWER_PELLET,
	SNIPER_KIND,
	SWARMER_KIND,
	cellKey,
	endlessFloorParams,
	generateDungeon,
	roomIdAt,
	tileAt,
	worldToGrid,
	TileType,
	reachableFloor,
	type Dungeon,
} from "shared/dungeon";
import { LEADERBOARD_ELIGIBLE_WORLDS } from "shared/leaderboard";
import { dismissDraft } from "shared/run/testing";
import {
	AXIS_MAX,
	Boost,
	Button,
	DEBUG_FLOOR_BUTTON,
	DROPS_CONFIG,
	DUMMY_KIND,
	EMPTY_INPUT,
	PELLETS_CONFIG,
	PELLET_LOCK_ARMED,
	PELLET_LOCK_RELEASED,
	PelletPhase,
	START_HALF_HEARTS,
	ScoreSource,
	TUTORIAL_GUARD_HOLD_HP,
	TUTORIAL_START_HALF_HEARTS,
	archetypeAt,
	archetypeIndex,
	createSimState,
	guaranteedDropsConfig,
	hashNumbers,
	hashState,
	isDraftOpen,
	isTutorialPelletHolding,
	isTutorialPelletReleased,
	runStartHalfHearts,
	step,
	type ActorState,
	type InputFrame,
	type SimState,
} from "shared/sim";
import {
	RunTelemetry,
	SERVER_REFUSED_WORLDS,
	TUTORIAL_BOOST_KIND,
	TUTORIAL_BOOST_LESSON,
	TUTORIAL_BOOST_ROOM,
	TUTORIAL_DROPS_CONFIG,
	TUTORIAL_ENTRANCE_ROOM,
	TUTORIAL_GUARD_LESSON,
	TUTORIAL_GUARD_LOCK,
	TUTORIAL_GUARD_ROOM,
	TUTORIAL_PELLET_LESSON,
	TUTORIAL_PELLET_LOCK,
	TUTORIAL_PELLET_ROOM,
	TUTORIAL_ROOMS,
	TUTORIAL_SHRINE_ROOM,
	TUTORIAL_STAIRWELL_ROOM,
	TUTORIAL_TREASURE_ROOM,
	TUTORIAL_WORLD_KIND,
	buildEndlessRunConfig,
	buildTutorialRunConfig,
	buildWorldSetup,
	isRunWorldKind,
	isServerRunWorld,
	runWorldKinds,
	checkTutorialChain,
	tutorialChain,
	tutorialDungeon,
	tutorialFloorParams,
	tutorialForgeParams,
	tutorialRoom,
	tutorialRooms,
	type EndlessRunSetup,
	type TutorialLessonId,
} from "shared/run";
import { decorInputOfLayout, planDecor } from "shared/view/decor";

/** Layout digest: grid, room ids, corridors, doorways, then every room's geometry, type and depth, then the graph. */
function layoutDigest(d: Dungeon): string {
	const v: number[] = [d.W, d.H, d.seed, d.entrance, d.boss, d.maxDepth, d.rooms.size(), d.edges.size()];
	for (const arr of [d.grid, d.roomId, d.corridor, d.doorway]) for (const x of arr) v.push(x);
	const types = ["entrance", "combat", "elite", "treasure", "shrine", "boss"];
	for (const r of d.rooms) v.push(r.id, r.cx, r.cy, r.w, r.h, types.indexOf(r.type), r.depth);
	for (const e of d.edges) v.push(e.a, e.b, e.isLoop ? 1 : 0, e.isCritical ? 1 : 0);
	return hashNumbers(v);
}

const FLOOR1_DIGEST = "e526f3cb";
/** Floor 1's tour (tutorialTour over TUTORIAL_ROOMS: centre to centre, round the solid pillars), in tiles. */
const FLOOR1_TOUR_TILES = 198;
const FLOOR2_DIGEST = "c0fd5b19";

const press = (buttons: number): InputFrame => ({ ...EMPTY_INPUT, buttons });

/** The keys a SimConfig sets (sorted), through a ReadonlyMap view. */
function configKeys(config: object): string[] {
	const out: string[] = [];
	for (const [k] of config as unknown as ReadonlyMap<string, unknown>) out.push(k);
	out.sort();
	return out;
}

function runOf(setup: EndlessRunSetup): SimState {
	const spawn = setup.spawn!;
	return createSimState(TUTORIAL.runSeed, spawn.x, spawn.z, setup.config);
}

/** Puts the player on `(x, z)` (both positions, so no move is interpolated) and steps one idle tick. */
function teleport(s: SimState, x: number, z: number, setup: EndlessRunSetup): void {
	s.player.x = x;
	s.player.z = z;
	s.player.prevX = x;
	s.player.prevZ = z;
	step(s, EMPTY_INPUT, setup.config);
}

describe("tutorial world: the lock", () => {
	it("tutorial floors are endless floors: the endless Forge options and the endless floor world, only the seed fixed", () => {
		// Every Forge param but seed / room count is the endless floor's (solid pillars, the room scale, ...), except solid
		// decor: the lessons keep their rooms clear (docs/DECOR.md "Solid decor").
		for (const f of [1, 2, 3]) {
			const p = tutorialFloorParams(f);
			expect(p.solidDecor).toBe(false);
			expect({ ...p, seed: 0, roomCount: 0, chain: undefined }).toEqual({
				...endlessFloorParams(TUTORIAL.runSeed, f),
				seed: 0,
				roomCount: 0,
				solidDecor: false,
			});
		}
		// Floor 1 is the lesson chain; floor 2 (and every later floor) a rolled Forge floor.
		expect(tutorialFloorParams(1).chain).toBe(tutorialChain());
		expect(tutorialFloorParams(2).chain).toBe(undefined);
		expect(tutorialFloorParams(3).chain).toBe(undefined);
		expect(endlessFloorParams(TUTORIAL.runSeed, 1).chain).toBe(undefined);
		expect(tutorialForgeParams(7, 9)).toEqual({
			...endlessFloorParams(TUTORIAL.runSeed, 1),
			seed: 7,
			roomCount: 9,
			solidDecor: false,
		});
		expect(tutorialFloorParams(1).solidPillars).toBe(ENDLESS_SOLID_PILLARS);
		expect(tutorialFloorParams(1).roomScale).toBe(ENDLESS_ROOM_SCALE);
		// The floor worlds set exactly the SimConfig fields an endless floor sets (movers, steering, encounter, ...).
		const endless = buildEndlessRunConfig(1).endlessFloor(1);
		const setup = buildTutorialRunConfig();
		for (const f of [1, 2, 3]) {
			expect([f, configKeys(setup.endlessFloor(f).config)]).toEqual([f, configKeys(endless.config)]);
		}
		expect(setup.endlessFloor(1).config.actorSteerMover).never.toBe(undefined);
		// And the run config the same top-level fields as an endless run's, plus the tutorial's own, minus breakables
		// (docs/DECOR.md B7: the tutorial's lessons are tuned to rooms without barrels and crates) and elite affixes
		// (docs/ENEMY_VARIANTS.md: never in the tutorial) and builds (docs/BUILDS.md BUD8: the tutorial keeps today's
		// draft). Drops are set, but not the endless defaults: only combat B's guaranteed Fury (docs/BOOSTS.md B9).
		// Pellets are the endless rules (docs/PELLETS.md PL11), but only combat G's floor-1 pellets lie anywhere. No
		// treasure rooms (docs/TREASURE.md: never in the tutorial; its floors carry no vault). Pacts (docs/FORTUNE.md):
		// never in the tutorial, which keeps the classic shrine (no altars on its floors either). No Goldling
		// (docs/FORTUNE.md: endless only, the tutorial never sets SimConfig.golden). No secret rooms (docs/SECRET_ROOMS.md
		// SR5: endless only).
		const keys = configKeys(buildEndlessRunConfig(1).config).filter(
			(k) =>
				k !== "breakables" &&
				k !== "affixes" &&
				k !== "builds" &&
				k !== "treasure" &&
				k !== "pacts" &&
				k !== "golden" &&
				k !== "secrets",
		);
		keys.push("tutorial");
		// docs/ARCHER.md AR4: the tutorial is the Knight: his loadout and (neutral) traits are set; a tool's
		// buildEndlessRunConfig without characters sets neither.
		keys.push("loadout", "traits");
		keys.sort();
		expect(configKeys(setup.config)).toEqual(keys);
		expect(setup.config.breakables).toBe(undefined);
		expect(setup.config.golden).toBe(undefined);
		expect(setup.config.secrets).toBe(undefined);
		expect(setup.config.drops).toBe(TUTORIAL_DROPS_CONFIG);
		expect(setup.config.drops).never.toBe(DROPS_CONFIG);
		for (const f of [1, 2, 3]) expect(setup.endlessFloor(f).breakables).toBe(undefined);
		expect(setup.config.affixes).toBe(undefined);
		expect(setup.config.builds).toBe(undefined);
		for (const f of [1, 2, 3]) expect(setup.endlessFloor(f).roomAffixes).toBe(undefined);
		expect(setup.config.pellets).toBe(PELLETS_CONFIG);
		expect(setup.config.treasure).toBe(undefined);
		for (const f of [1, 2, 3]) expect(setup.endlessFloor(f).vault).toBe(undefined);
		expect(setup.config.pacts).toBe(undefined);
		for (const f of [1, 2, 3]) expect(setup.endlessFloor(f).pactAltars).toBe(undefined);
	});

	it("floor layouts are the chosen Forge seeds, byte for byte (layout digest)", () => {
		expect(tutorialFloorParams(1).seed).toBe(TUTORIAL.floor1.seed);
		expect(tutorialFloorParams(1).roomCount).toBe(TUTORIAL_ROOMS.size());
		expect(tutorialFloorParams(2).seed).toBe(TUTORIAL.floor2.seed);
		expect(tutorialFloorParams(3).seed).toBe(TUTORIAL.floor2.seed);
		const d1 = tutorialDungeon(1);
		const d2 = tutorialDungeon(2);
		expect(d1.valid).toBe(true);
		expect(d2.valid).toBe(true);
		expect(layoutDigest(d1)).toBe(FLOOR1_DIGEST);
		expect(layoutDigest(d2)).toBe(FLOOR2_DIGEST);
		// A fresh generation matches the cached one.
		expect(layoutDigest(generateDungeon(tutorialFloorParams(1)))).toBe(FLOOR1_DIGEST);
		expect(tutorialDungeon(3)).toBe(d2);
	});

	it("drops: only the guaranteed Fury from combat B (floor 1, room 2: three swarmers); no random drops, no pity", () => {
		expect(TUTORIAL_BOOST_LESSON).toBe("combatB");
		expect(TUTORIAL_BOOST_ROOM).toBe(2);
		expect(TUTORIAL_BOOST_KIND).toBe(Boost.FURY);
		const room = TUTORIAL_ROOMS.find((r) => r.roomId === TUTORIAL_BOOST_ROOM)!;
		expect([room.lesson, room.roomType, room.kinds]).toEqual([
			"combatB",
			"combat",
			[SWARMER_KIND, SWARMER_KIND, SWARMER_KIND],
		]);
		const d = tutorialDungeon(ENDLESS_FIRST_FLOOR);
		expect(d.rooms[TUTORIAL_BOOST_ROOM].type).toBe("combat");
		expect(TUTORIAL_DROPS_CONFIG).toEqual(
			guaranteedDropsConfig([{ floor: ENDLESS_FIRST_FLOOR, room: TUTORIAL_BOOST_ROOM, kind: Boost.FURY }]),
		);
		expect([TUTORIAL_DROPS_CONFIG.chancePercent, TUTORIAL_DROPS_CONFIG.pityKills]).toEqual([0, 0]);
		expect(TUTORIAL_DROPS_CONFIG.chanceByArchetype.size()).toBe(0);
		// The ground tunables are the game's.
		expect([
			TUTORIAL_DROPS_CONFIG.groundTicks,
			TUTORIAL_DROPS_CONFIG.pickupRadius,
			TUTORIAL_DROPS_CONFIG.maxOnGround,
		]).toEqual([DROPS_CONFIG.groundTicks, DROPS_CONFIG.pickupRadius, DROPS_CONFIG.maxOnGround]);
		// The run's state carries the drops group (hashed last); floor-1 spawns put combat B's three swarmers in it.
		const setup = buildTutorialRunConfig();
		const st = createSimState(TUTORIAL.runSeed, setup.spawn!.x, setup.spawn!.z, setup.config);
		expect(st.drops !== undefined).toBe(true);
		expect(setup.endlessFloor(1).roomSpawns[TUTORIAL_BOOST_ROOM].size()).toBe(3);
	});

	it("guard lock: combat D (floor 1, room 4: one bruiser) is the block lesson's room", () => {
		expect(TUTORIAL_GUARD_LESSON).toBe("combatD");
		expect(TUTORIAL_GUARD_ROOM).toBe(4);
		expect(TUTORIAL_GUARD_LOCK).toEqual({ floor: ENDLESS_FIRST_FLOOR, room: TUTORIAL_GUARD_ROOM });
		const room = TUTORIAL_ROOMS.find((r) => r.roomId === TUTORIAL_GUARD_ROOM)!;
		expect([room.lesson, room.kinds]).toEqual(["combatD", [BRUISER_KIND]]);
		const setup = buildTutorialRunConfig();
		expect(setup.config.tutorial!.guardLock).toBe(TUTORIAL_GUARD_LOCK);
		const st = createSimState(TUTORIAL.runSeed, setup.spawn!.x, setup.spawn!.z, setup.config);
		expect([st.tutorial!.guardLockFloor, st.tutorial!.guardLockRoom]).toEqual([1, 4]);
	});

	it("the lesson table: rooms, types and order", () => {
		const d = tutorialDungeon(1);
		const lessons = TUTORIAL_ROOMS.map((r) => r.lesson);
		expect(lessons).toEqual([
			"entrance",
			"combatA",
			"combatB",
			"combatC",
			"combatD",
			"combatF",
			"combatG",
			"treasure",
			"shrine",
			"stairwell",
		]);
		for (const r of TUTORIAL_ROOMS) expect([r.lesson, d.rooms[r.roomId].type]).toEqual([r.lesson, r.roomType]);
		expect(TUTORIAL_ROOMS.map((r) => `${r.roomId}:${r.roomType}`)).toEqual([
			"0:entrance",
			"1:combat",
			"2:combat",
			"3:combat",
			"4:elite",
			"5:combat",
			"6:combat",
			"7:treasure",
			"8:shrine",
			"9:boss",
		]);
		// Only combat G lays pellets (a ring).
		expect(TUTORIAL_ROOMS.filter((r) => r.pellets !== undefined).map((r) => [r.lesson, r.pellets])).toEqual([
			["combatG", "ring"],
		]);
		// The chain is the table: room id = place in the chain, its type, size, shape and side.
		const chain = tutorialChain();
		expect(chain.size()).toBe(TUTORIAL_ROOMS.size());
		for (let i = 0; i < TUTORIAL_ROOMS.size(); i++) {
			const r = TUTORIAL_ROOMS[i];
			expect([r.lesson, r.roomId]).toEqual([r.lesson, i]);
			expect(chain[i]).toEqual({
				type: r.roomType,
				w: r.w,
				h: r.h,
				shape: r.shape,
				next: r.next,
				gap: i < TUTORIAL_ROOMS.size() - 1 ? TUTORIAL.floor1.corridorTiles : undefined,
			});
		}
		expect(TUTORIAL_ENTRANCE_ROOM).toBe(d.entrance);
		expect(TUTORIAL_STAIRWELL_ROOM).toBe(d.boss);
		expect(d.rooms[TUTORIAL_TREASURE_ROOM].type).toBe("treasure");
		expect(d.rooms[TUTORIAL_SHRINE_ROOM].type).toBe("shrine");
		// Every room id at most once.
		const seen = new Set<number>();
		for (const r of TUTORIAL_ROOMS) {
			expect(seen.has(r.roomId)).toBe(false);
			seen.add(r.roomId);
		}
	});

	it("floor 1 is a strict chain: one corridor from each lesson room to the next, nothing else, every room one floor", () => {
		const d = tutorialDungeon(1);
		const order = TUTORIAL_ROOMS.map((r) => r.roomId);
		const report = checkTutorialChain(d, order);
		const legs = report.tour.legs.map((l) => l.tiles);
		print(
			`[tutorial floor 1] ${d.params.themeKey} ${d.W}x${d.H}: tour ${report.tour.tiles} tiles, legs ${legs.join(
				",",
			)}; ` + `corridors ${report.legCorridors.join(",")}`,
		);
		expect(report.problems).toEqual([]);
		// Nine corridors, one per pair, each TUTORIAL.floor1.corridorTiles long (one more where it meets the ellipse
		// treasure room's rim off its centre row); no loop edge, no extra room.
		expect(report.corridors.size()).toBe(TUTORIAL_ROOMS.size() - 1);
		for (const c of report.corridors) expect(c.rooms.size()).toBe(2);
		for (const len of report.legCorridors) {
			expect(len >= TUTORIAL.floor1.corridorTiles && len <= TUTORIAL.floor1.corridorTiles + 1).toBe(true);
		}
		expect(d.edges.size()).toBe(TUTORIAL_ROOMS.size() - 1);
		for (const e of d.edges) expect([e.a, e.b, e.isLoop]).toEqual([e.a, e.a + 1, false]);
		expect(d.rooms.size()).toBe(TUTORIAL_ROOMS.size());
		expect(report.tour.earlyRooms).toBe(0);
		expect(report.tour.tiles).toBe(FLOOR1_TOUR_TILES);
		// The doors the lessons use are the tour's (the marker's targets).
		for (let i = 1; i < TUTORIAL_ROOMS.size(); i++) {
			expect(tutorialRooms()[i].door).toEqual(report.tour.legs[i - 1].door);
		}
	});

	it("the chain check catches a floor that is not a chain (a rolled endless floor: loops, side rooms)", () => {
		const rolled = generateDungeon(tutorialForgeParams(TUTORIAL.floor1.seed, TUTORIAL_ROOMS.size()));
		const order: number[] = [];
		for (let i = 0; i < rolled.rooms.size(); i++) order.push(i);
		expect(checkTutorialChain(rolled, order).problems.size() > 0).toBe(true);
		// And the right floor in the wrong order.
		const d = tutorialDungeon(1);
		const swapped = TUTORIAL_ROOMS.map((r) => r.roomId);
		swapped[1] = 2;
		swapped[2] = 1;
		expect(checkTutorialChain(d, swapped).problems.size() > 0).toBe(true);
	});

	it("floor 1 looks like a real floor: the theme's solid pillars stand in its combat rooms, and it gets decor", () => {
		const d = tutorialDungeon(1);
		let solid = 0;
		const pillarRooms = new Set<number>();
		for (const pr of d.props) {
			if (pr.kind !== "pillar" || tileAt(d, pr.x, pr.y) !== TileType.WALL) continue;
			solid++;
			pillarRooms.add(d.roomId[pr.y * d.W + pr.x]);
		}
		expect(solid > 0).toBe(true);
		expect(d.torches.size() > 0).toBe(true);
		expect(d.arches.size() >= TUTORIAL_ROOMS.size() - 1).toBe(true);
		// The client's decor plan (DecorController: decorInputOfLayout on the floor's layout) has every layer.
		const plan = planDecor(decorInputOfLayout(buildTutorialRunConfig().endlessFloor(1).layout));
		print(
			`[tutorial floor 1] decor: ${plan.entries.size()} pieces (flat ${plan.counts.flat}, low ${
				plan.counts.low
			}, ` + `tall ${plan.counts.tall}, wall ${plan.counts.wall})`,
		);
		expect(plan.counts.flat > 0).toBe(true);
		expect(plan.counts.wall > 0).toBe(true);
		expect(plan.counts.tall + plan.counts.low > 0).toBe(true);
	});

	it("lesson spawns: the planned kinds, each on a distinct floor tile of its own room and among its spawn tiles", () => {
		const d = tutorialDungeon(1);
		const setup = buildTutorialRunConfig();
		const w = setup.endlessFloor!(1);
		const rooms = tutorialRooms();
		expect(rooms.size()).toBe(TUTORIAL_ROOMS.size());
		const kinds: Record<string, ReadonlyArray<string>> = {
			combatA: [DUMMY_KIND, DUMMY_KIND],
			combatB: ["swarmer", "swarmer", "swarmer"],
			combatC: ["sniper"],
			combatD: ["bruiser"],
			combatF: ["turret.sprayer", "turret.sprayer"],
			combatG: ["sniper"],
		};
		for (const r of rooms) {
			const want = kinds[r.lesson] ?? [];
			expect([r.lesson, r.spawns.map((s) => s.kind)]).toEqual([r.lesson, want]);
			expect(w.roomSpawns[r.roomId]).toEqual(r.spawns);
			const tiles = w.roomSpawnTiles![r.roomId];
			const used = new Set<string>();
			for (const s of r.spawns) {
				expect(tileAt(d, worldToGrid(s.x), worldToGrid(s.z))).toBe(TileType.FLOOR);
				expect([r.lesson, roomIdAt(d, s.x, s.z)]).toEqual([r.lesson, r.roomId]);
				expect(tiles.some((t) => t.x === s.x && t.z === s.z)).toBe(true);
				const key = `${s.x},${s.z}`;
				expect(used.has(key)).toBe(false);
				used.add(key);
			}
			// The marker's door is a floor tile next to the room (or the spawn, for the entrance).
			expect(tileAt(d, worldToGrid(r.door.x), worldToGrid(r.door.z))).toBe(TileType.FLOOR);
			expect(r.center.x).toBe(w.config.encounter!.rooms[r.roomId].cx);
			expect(r.center.z).toBe(w.config.encounter!.rooms[r.roomId].cz);
		}
		expect(tutorialRoom("entrance").door).toEqual({ x: w.spawnX, z: w.spawnZ });
		// Only lesson rooms have deferred spawns.
		let spawning = 0;
		for (let id = 0; id < w.roomSpawns.size(); id++) if (w.roomSpawns[id].size() > 0) spawning++;
		expect(spawning).toBe(6); // combat A-D, F, G (no combat E since docs/ARCHER.md AR6)
		expect(rooms).toBe(tutorialRooms()); // cached
	});

	it("floor 1: the stairwell is open from the start in the boss room; treasure pedestal and shrine as in a real run", () => {
		const setup = buildTutorialRunConfig();
		const w = setup.endlessFloor!(1);
		expect(w.bossFloor).toBe(false);
		expect(w.config.encounter!.spawns.size()).toBe(0);
		const stair = tutorialRoom("stairwell").center;
		expect([w.stairX, w.stairZ]).toEqual([stair.x, stair.z]);
		const s = runOf(setup);
		expect(s.endless!.stairsOpen).toBe(1);
		expect(s.run!.pedestalRooms).toEqual([TUTORIAL_TREASURE_ROOM]);
		expect(s.run!.shrineRoom).toBe(TUTORIAL_SHRINE_ROOM);
	});

	it("floor 2 is a boss floor with Mother Mayhem as its only spawn; floor 3+ is the same layout, empty and open", () => {
		const setup = buildTutorialRunConfig();
		const f2 = setup.endlessFloor!(2);
		expect(f2.bossFloor).toBe(true);
		expect(f2.config.encounter!.spawns.map((sp) => sp.kind)).toEqual([BOSS_ACT1_KIND]);
		for (const list of f2.roomSpawns) expect(list.size()).toBe(0);
		const f3 = setup.endlessFloor!(3);
		expect(f3.floor).toBe(3);
		expect(f3.bossFloor).toBe(false);
		expect(f3.dungeon).toBe(f2.dungeon);
		expect(f3.config.encounter!.spawns.size()).toBe(0);
		for (const list of f3.roomSpawns) expect(list.size()).toBe(0);
		expect(setup.endlessFloor!(4).floor).toBe(4);
		expect(TUTORIAL.lastFloor).toBe(2);
	});
});

/** The run's actors of archetype `id` that are alive. */
function living(s: SimState, id: string): ActorState[] {
	const kind = archetypeIndex(id);
	return s.combat.actors.filter((a) => a.kind === kind && a.alive !== 0);
}

/** The score record index of floor-1 room `roomId` (-1 none). */
function recordOf(s: SimState, roomId: number): number {
	const rooms = s.score!.rooms;
	for (let k = 0; k < rooms.size(); k++) if (rooms[k].room === roomId) return k;
	return -1;
}

/** The untaken pellets of score record `rec`, in index order. */
function untaken(s: SimState, rec: number): number[] {
	const p = s.pellets!;
	const out: number[] = [];
	for (let k = 0; k < p.taken.size(); k++) if (p.rec[k] === rec && p.taken[k] === 0) out.push(k);
	return out;
}

/** Puts the player `dist` from actor `a`, on the side of room `lesson`'s centre (both positions: no interpolated move). */
function standOff(s: SimState, a: ActorState, dist: number, lesson: TutorialLessonId): void {
	const c = tutorialRoom(lesson).center;
	const dx = c.x - a.x;
	const dz = c.z - a.z;
	const len = math.max(math.sqrt(dx * dx + dz * dz), 1e-6);
	s.player.x = a.x + (dx / len) * dist;
	s.player.z = a.z + (dz / len) * dist;
	s.player.prevX = s.player.x;
	s.player.prevZ = s.player.z;
}

/** A frame aiming from the player at `a`, pressing `buttons`. */
function aimAt(s: SimState, a: ActorState, buttons: number): InputFrame {
	const dx = a.x - s.player.x;
	const dz = a.z - s.player.z;
	const len = math.max(math.sqrt(dx * dx + dz * dz), 1e-6);
	return { ...EMPTY_INPUT, aimX: (dx / len) * AXIS_MAX, aimZ: (dz / len) * AXIS_MAX, buttons };
}

describe("tutorial world: the pellet lesson (combat G, docs/PELLETS.md PL11 / PL12)", () => {
	it("combat G (floor 1, room 6: one sniper) is the pellet lesson; the guard lock stays on combat D (room 4)", () => {
		expect(TUTORIAL_PELLET_LESSON).toBe("combatG");
		expect(TUTORIAL_PELLET_ROOM).toBe(6);
		expect(TUTORIAL_PELLET_LOCK).toEqual({ floor: ENDLESS_FIRST_FLOOR, room: TUTORIAL_PELLET_ROOM });
		const plan = TUTORIAL_ROOMS.find((r) => r.roomId === TUTORIAL_PELLET_ROOM)!;
		expect([plan.lesson, plan.roomType, plan.kinds, plan.placement, plan.pellets]).toEqual([
			"combatG",
			"combat",
			[SNIPER_KIND],
			"far",
			"ring",
		]);
		expect([TUTORIAL_GUARD_ROOM, TUTORIAL_GUARD_LOCK.room]).toEqual([4, 4]);
		const setup = buildTutorialRunConfig();
		expect(setup.config.tutorial!.pelletLock).toBe(TUTORIAL_PELLET_LOCK);
		const st = runOf(setup);
		expect([st.tutorial!.pelletLockFloor, st.tutorial!.pelletLockRoom]).toEqual([1, 6]);
		expect([st.tutorial!.guardLockFloor, st.tutorial!.guardLockRoom]).toEqual([1, 4]);
	});

	it("its ring: TUTORIAL.pellets.max pellets on combat G's own floor cells, reachable, off the spawn; none elsewhere", () => {
		const setup = buildTutorialRunConfig();
		const w = setup.endlessFloor(1);
		const d = w.dungeon;
		const pellets = w.pellets!;
		expect(pellets).never.toBe(undefined);
		expect(TUTORIAL.pellets.max).toBe(12);
		expect(pellets.tiles.size()).toBe(TUTORIAL.pellets.max);
		expect(pellets.room.size()).toBe(pellets.tiles.size());
		expect(pellets.power).toBe(NO_POWER_PELLET); // PD16
		const reach = reachableFloor(d, w.spawnX, w.spawnZ, new Set());
		const sniper = tutorialRoom("combatG").spawns[0];
		const cells = new Set<number>();
		for (let i = 0; i < pellets.tiles.size(); i++) {
			const t = pellets.tiles[i];
			const gx = worldToGrid(t.x);
			const gy = worldToGrid(t.z);
			expect([i, pellets.room[i]]).toEqual([i, TUTORIAL_PELLET_ROOM]);
			expect([i, tileAt(d, gx, gy)]).toEqual([i, TileType.FLOOR]);
			expect([i, roomIdAt(d, t.x, t.z)]).toEqual([i, TUTORIAL_PELLET_ROOM]);
			expect([i, reach[gy * d.W + gx]]).toEqual([i, true]);
			expect(cellKey(gx, gy)).never.toBe(cellKey(worldToGrid(sniper.x), worldToGrid(sniper.z)));
			expect(cells.has(cellKey(gx, gy))).toBe(false);
			cells.add(cellKey(gx, gy));
		}
		// Floor 2 (and later) has none; floor 1's state: one live-able record (combat G), every other record empty.
		for (const f of [2, 3]) expect(setup.endlessFloor(f).pellets).toBe(undefined);
		const s = runOf(setup);
		const p = s.pellets!;
		expect(p.taken.size()).toBe(TUTORIAL.pellets.max);
		const g = recordOf(s, TUTORIAL_PELLET_ROOM);
		for (let k = 0; k < p.rooms.size(); k++) {
			const r = p.rooms[k];
			expect([k, r.phase, r.count]).toEqual([k, PelletPhase.DORMANT, k === g ? TUTORIAL.pellets.max : 0]);
		}
		print(
			`[tutorial floor 1] combat G pellets: ${pellets.tiles
				.map((t) => `${worldToGrid(t.x)},${worldToGrid(t.z)}`)
				.join(" ")}`,
		);
	});

	it("the sweep lock: the sword stops at 1 hp while pellets remain; the last pickup releases it", () => {
		/**
		 * The scripted run up to the lethal swing (every step deterministic, the surgery too): enter combat G, hold the
		 * sniper with the Knight's sword (the tutorial's only weapon, docs/ARCHER.md AR6), take every pellet but the last.
		 * Run twice: BulletSimulations cannot be cloned.
		 */
		const scenario = () => {
			const setup = buildTutorialRunConfig();
			const config = setup.config;
			const s = runOf(setup);
			const room = tutorialRoom("combatG");
			teleport(s, room.center.x, room.center.z, setup);
			expect(s.endless!.roomsEntered[TUTORIAL_PELLET_ROOM]).toBe(1);
			const [sniper] = living(s, SNIPER_KIND);
			expect(sniper).never.toBe(undefined);
			const t = s.tutorial!;
			expect([t.pelletLock, t.pelletLockFirstId, t.pelletLockEndId]).toEqual([
				PELLET_LOCK_ARMED,
				sniper.id,
				sniper.id + 1,
			]);
			const rec = recordOf(s, TUTORIAL_PELLET_ROOM);
			expect(s.pellets!.rooms[rec].phase).toBe(PelletPhase.LIVE);

			// The sword: hits land (enemyHits) but the sniper never falls below the hold.
			const hitsWith = (ticks: number, dist: number, buttons: (n: number) => number): number => {
				let hits = 0;
				for (let n = 0; n < ticks; n++) {
					standOff(s, sniper, dist, "combatG");
					step(s, aimAt(s, sniper, buttons(n)), config);
					hits += s.events.enemyHits;
					expect([n, sniper.alive, sniper.hp >= TUTORIAL_GUARD_HOLD_HP]).toEqual([n, 1, true]);
				}
				return hits;
			};
			const swordHits = hitsWith(240, 1, () => Button.FIRE);
			expect(swordHits > 0).toBe(true);
			expect(sniper.hp).toBe(TUTORIAL_GUARD_HOLD_HP);
			expect([isTutorialPelletHolding(s), isTutorialPelletReleased(s)]).toEqual([true, false]);
			expect([sniper.alive, sniper.hp]).toEqual([1, TUTORIAL_GUARD_HOLD_HP]);
			const left = untaken(s, rec);
			expect(left.size() > 1).toBe(true);

			// Every pellet but the last: walked over (teleported onto), the lock still holds.
			for (let i = 0; i < left.size() - 1; i++) {
				const k = left[i];
				teleport(s, s.pellets!.x[k], s.pellets!.z[k], setup);
				expect([k, s.pellets!.taken[k]]).toEqual([k, 1]);
				expect(t.pelletLock).toBe(PELLET_LOCK_ARMED);
			}
			const last = left[left.size() - 1];

			// Ready to swing the lethal blow from 1 tile (the player stays put until it lands).
			standOff(s, sniper, 1, "combatG");
			const fire = aimAt(s, sniper, Button.FIRE);
			return { s, setup, config, sniper, t, rec, last, fire, swordHits, left };
		};
		const { s, config, sniper, t, rec, last, fire, swordHits, left } = scenario();
		print(`[pellet lock] sword ${swordHits} hits held; ${left.size()} pellets left`);

		// The last pickup and a lethal swing on ONE tick: a dry run of the same scenario (FIRE held) finds the tick the
		// swing lands, then the real run moves the last pellet under the player for exactly that tick (test-only surgery:
		// pellets never affect combat, so the hit lands on the same tick).
		const dry = scenario();
		let hitTick = -1;
		for (let n = 0; n < 60 && hitTick < 0; n++) {
			step(dry.s, dry.fire, dry.config);
			if (dry.s.events.enemyHits > 0) hitTick = n;
		}
		expect(hitTick > 0).toBe(true);
		for (let n = 0; n < hitTick; n++) step(s, fire, config);
		expect(s.events.enemyHits).toBe(0);
		expect(s.pellets!.taken[last]).toBe(0);
		const p = s.pellets!;
		p.byCell.delete(cellKey(worldToGrid(p.x[last]), worldToGrid(p.z[last])));
		p.x[last] = s.player.x;
		p.z[last] = s.player.z;
		p.byCell.set(cellKey(worldToGrid(s.player.x), worldToGrid(s.player.z)), last);
		step(s, fire, config);
		expect(s.events.enemyHits > 0).toBe(true); // the swing landed this tick ...
		expect([p.taken[last], p.rooms[rec].left]).toEqual([1, 0]); // ... with the last pickup ...
		expect([t.pelletLock, isTutorialPelletReleased(s), isTutorialPelletHolding(s)]).toEqual([
			PELLET_LOCK_RELEASED,
			true,
			false,
		]);
		expect([sniper.alive, sniper.hp]).toEqual([1, TUTORIAL_GUARD_HOLD_HP]); // ... and stopped at the hold: combat ran first
		expect(s.score!.rooms[rec].cleared).toBe(0);

		// Released: the next hit kills; the room clears with its Sweep.
		const sweepsBefore = s.score!.counts[ScoreSource.SWEEP];
		for (let n = 0; n < 240 && s.score!.rooms[rec].cleared === 0; n++) {
			standOff(s, sniper, 1, "combatG");
			step(s, aimAt(s, sniper, Button.FIRE), config);
		}
		expect([sniper.alive, s.score!.rooms[rec].cleared]).toEqual([0, 1]);
		expect(s.score!.counts[ScoreSource.SWEEP]).toBe(sweepsBefore + 1);
		expect([p.rooms[rec].swept, p.rooms[rec].phase]).toEqual([1, PelletPhase.GONE]);
	});
});

describe("tutorial world: determinism and runs", () => {
	it("both floors build identically twice, and the run config is the tutorial's", () => {
		const a = buildTutorialRunConfig();
		const b = buildTutorialRunConfig();
		expect(a.spawn).toEqual(b.spawn);
		for (const f of [1, 2, 3]) {
			const wa = a.endlessFloor!(f);
			const wb = b.endlessFloor!(f);
			expect(wa).never.toBe(wb);
			expect(wa.roomSpawns).toEqual(wb.roomSpawns);
			expect(wa.roomSpawnTiles).toEqual(wb.roomSpawnTiles);
			expect(wa.config.encounter).toEqual(wb.config.encounter);
			expect([wa.spawnX, wa.spawnZ, wa.stairX, wa.stairZ]).toEqual([wb.spawnX, wb.spawnZ, wb.stairX, wb.stairZ]);
			expect(a.endlessFloor!(f)).toBe(wa); // cached per setup
		}
		expect(a.config.endless!.runSeed).toBe(TUTORIAL.runSeed);
		expect(a.config.tutorial).toEqual({
			harmless: true,
			startHalfHearts: TUTORIAL_START_HALF_HEARTS,
			bossHpPercent: TUTORIAL.bossHpPercent,
			guardLock: { floor: ENDLESS_FIRST_FLOOR, room: TUTORIAL_GUARD_ROOM },
			pelletLock: { floor: ENDLESS_FIRST_FLOOR, room: TUTORIAL_PELLET_ROOM },
		});
		expect(TUTORIAL.startHalfHearts).toBe(TUTORIAL_START_HALF_HEARTS);
		expect(a.config.scoring).never.toBe(undefined);
		expect(a.config.party).toBe(undefined);
	});

	it("smoke: a few hundred idle ticks, harmless and wounded; two runs hash the same", () => {
		const a = runOf(buildTutorialRunConfig());
		const b = runOf(buildTutorialRunConfig());
		const config = buildTutorialRunConfig().config;
		for (let t = 0; t < 400; t++) {
			step(a, EMPTY_INPUT, config);
			step(b, EMPTY_INPUT, config);
		}
		expect(a.tutorial).never.toBe(undefined);
		expect(a.tutorial!.harmless).toBe(1);
		expect(a.player.hearts).toBe(TUTORIAL_START_HALF_HEARTS);
		expect(a.player.dead).toBe(0);
		expect(a.endless!.floor).toBe(1);
		expect(hashState(a)).toBe(hashState(b));
	});

	it("the dummy has its 8 hp on floor 1 (scaling as endless floor 1 / Depth 1)", () => {
		const setup = buildTutorialRunConfig();
		const s = runOf(setup);
		const room = tutorialRoom("combatA");
		teleport(s, room.center.x, room.center.z, setup);
		expect(s.endless!.roomsEntered[room.roomId]).toBe(1);
		const dummy = archetypeIndex(DUMMY_KIND);
		const dummies = s.combat.actors.filter((x) => x.kind === dummy);
		expect(dummies.size()).toBe(2);
		for (const x of dummies) expect(x.hp).toBe(8);
		expect(archetypeAt(dummy).data.hp).toBe(8);
	});

	it("debug floor skip: floor 1 -> 2 (the boss at TUTORIAL.bossHpPercent of her Depth 1 hp) -> 3 without throwing", () => {
		const setup = buildTutorialRunConfig();
		const s = runOf(setup);
		const config = setup.config;
		const boss = archetypeIndex(BOSS_ACT1_KIND);
		step(s, EMPTY_INPUT, config);
		step(s, press(DEBUG_FLOOR_BUTTON), config);
		expect(s.events.floorChanged).toBe(2);
		expect(s.endless!.floor).toBe(2);
		expect(s.endless!.stairsOpen).toBe(0);
		const bosses = s.combat.actors.filter((x) => x.kind === boss);
		expect(bosses.size()).toBe(1);
		// Depth 1 / floor 1 scaling leaves her base hp; the tutorial takes bossHpPercent of it (270 x 20 % = 54).
		expect(bosses[0].hp).toBe((archetypeAt(boss).data.hp * TUTORIAL.bossHpPercent) / 100);
		expect(bosses[0].hpMax).toBe(bosses[0].hp);
		expect(TUTORIAL.bossHpPercent < 100).toBe(true);
		expect(s.tutorial!.bossHpPercent).toBe(TUTORIAL.bossHpPercent);
		expect(s.player.hearts).toBe(TUTORIAL_START_HALF_HEARTS);
		// The real boon draft opens (and freezes the world until resolved).
		expect(isDraftOpen(s)).toBe(true);
		dismissDraft(s);
		for (let t = 0; t < 60; t++) step(s, EMPTY_INPUT, config);
		step(s, press(DEBUG_FLOOR_BUTTON), config);
		expect(s.events.floorChanged).toBe(3);
		expect(s.endless!.stairsOpen).toBe(1);
		expect(s.combat.actors.filter((x) => x.kind === boss && x.alive !== 0).size()).toBe(0);
		for (let t = 0; t < 60; t++) step(s, EMPTY_INPUT, config);
		expect(s.endless!.floor).toBe(3);
		expect(s.player.hearts).toBe(TUTORIAL_START_HALF_HEARTS);
	});
});

describe("tutorial world: registry and telemetry", () => {
	it('is registered as "tutorial", ignores the seed, is solo only, never leaderboard-eligible, refused by the server', () => {
		expect(TUTORIAL_WORLD_KIND).toBe("tutorial");
		expect(runWorldKinds().includes("tutorial")).toBe(true);
		const a = buildWorldSetup("tutorial", 1, { atBossDoor: false });
		const b = buildWorldSetup("tutorial", 999, { atBossDoor: false, partySize: 1 });
		expect(a.spawn).toEqual(b.spawn);
		expect(a.config.tutorial).never.toBe(undefined);
		expect(() => buildWorldSetup("tutorial", 1, { atBossDoor: false, partySize: 2 })).toThrow("solo only");
		expect(() => buildTutorialRunConfig(2)).toThrow("solo only");
		expect(LEADERBOARD_ELIGIBLE_WORLDS.includes("tutorial")).toBe(false);
		// Registered for the client's local build, refused by the server (session starts, party invites).
		expect(isRunWorldKind(TUTORIAL_WORLD_KIND)).toBe(true);
		expect(SERVER_REFUSED_WORLDS.has(TUTORIAL_WORLD_KIND)).toBe(true);
		expect(isServerRunWorld(TUTORIAL_WORLD_KIND)).toBe(false);
		for (const kind of ["game", "dungeonNoEncounter", "greybox", "endless"]) {
			expect([kind, isServerRunWorld(kind)]).toEqual([kind, true]);
		}
		expect(isServerRunWorld("nowhere")).toBe(false);
		expect(isServerRunWorld(7)).toBe(false);
	});

	it("telemetry starts from the run's own hearts: a wounded start is not logged as hearts lost", () => {
		const setup = buildTutorialRunConfig();
		expect(runStartHalfHearts(setup.config)).toBe(TUTORIAL_START_HALF_HEARTS);
		expect(runStartHalfHearts({})).toBe(START_HALF_HEARTS);
		const s = runOf(setup);
		const telemetry = new RunTelemetry(runStartHalfHearts(setup.config));
		for (let t = 0; t < 30; t++) {
			step(s, EMPTY_INPUT, setup.config);
			telemetry.observe(s);
		}
		expect(telemetry.finish().heartsLostTotal).toBe(0);
	});
});

// Keep ENDLESS_FIRST_FLOOR the tutorial's first floor (the sim starts every endless run there).
describe("tutorial world: first floor", () => {
	it("starts on endless floor 1", () => {
		expect(ENDLESS_FIRST_FLOOR).toBe(1);
		expect(runOf(buildTutorialRunConfig()).endless!.floor).toBe(ENDLESS_FIRST_FLOOR);
	});
});
