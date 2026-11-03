// The tutorial world (docs/TUTORIAL.md T2): the LOCK spec on both layouts and the lesson table, the floor-1 spawns,
// determinism, a harmless smoke run, the debug floor skip through the boss floor, scaling, the registry and the
// telemetry start-hearts baseline.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL } from "shared/config";
import {
	BOSS_ACT1_KIND,
	BRUISER_KIND,
	ENDLESS_FIRST_FLOOR,
	ENDLESS_ROOM_SCALE,
	ENDLESS_SOLID_PILLARS,
	SWARMER_KIND,
	bulletBlocker,
	endlessFloorParams,
	generateDungeon,
	lineOfSight,
	roomIdAt,
	tileAt,
	worldToGrid,
	TileType,
	type Dungeon,
} from "shared/dungeon";
import { LEADERBOARD_ELIGIBLE_WORLDS } from "shared/leaderboard";
import { dismissDraft } from "shared/run/testing";
import {
	Boost,
	DEBUG_FLOOR_BUTTON,
	DROPS_CONFIG,
	DUMMY_KIND,
	EMPTY_INPUT,
	START_HALF_HEARTS,
	TUTORIAL_START_HALF_HEARTS,
	archetypeAt,
	archetypeIndex,
	createSimState,
	guaranteedDropsConfig,
	hashNumbers,
	hashState,
	isDraftOpen,
	runStartHalfHearts,
	step,
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
	TUTORIAL_ROOMS,
	TUTORIAL_SHRINE_ROOM,
	TUTORIAL_STAIRWELL_ROOM,
	TUTORIAL_TREASURE_ROOM,
	TUTORIAL_WORLD_KIND,
	COVER_PILLAR_TILES,
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

const FLOOR1_DIGEST = "5bc337a0";
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
		// Every Forge param but seed / room count is the endless floor's (solid pillars, the room scale, ...).
		for (const f of [1, 2, 3]) {
			const p = tutorialFloorParams(f);
			expect({ ...p, seed: 0, roomCount: 0, chain: undefined }).toEqual({
				...endlessFloorParams(TUTORIAL.runSeed, f),
				seed: 0,
				roomCount: 0,
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
		// draft) and pellets (docs/PELLETS.md PL5: endless worlds only; the tutorial's own room-G pellets are PL11).
		// Drops are set, but not the endless defaults: only combat B's guaranteed Fury (docs/BOOSTS.md B9).
		const keys = configKeys(buildEndlessRunConfig(1).config).filter(
			(k) => k !== "breakables" && k !== "affixes" && k !== "builds" && k !== "pellets",
		);
		keys.push("tutorial");
		keys.sort();
		expect(configKeys(setup.config)).toEqual(keys);
		expect(setup.config.breakables).toBe(undefined);
		expect(setup.config.drops).toBe(TUTORIAL_DROPS_CONFIG);
		expect(setup.config.drops).never.toBe(DROPS_CONFIG);
		for (const f of [1, 2, 3]) expect(setup.endlessFloor(f).breakables).toBe(undefined);
		expect(setup.config.affixes).toBe(undefined);
		expect(setup.config.builds).toBe(undefined);
		for (const f of [1, 2, 3]) expect(setup.endlessFloor(f).roomAffixes).toBe(undefined);
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
			"combatE",
			"combatF",
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
		expect(pillarRooms.has(tutorialRoom("combatE").roomId)).toBe(true);
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

	it("lesson E: the turret sniper stands behind a solid pillar, out of sight of the door the player comes in by", () => {
		const d = tutorialDungeon(1);
		const room = tutorialRoom("combatE");
		expect(room.placement).toBe("cover");
		const turret = room.spawns[0];
		expect(lineOfSight(bulletBlocker(d), room.door.x, room.door.z, turret.x, turret.z)).toBe(false);
		const gx = worldToGrid(turret.x);
		const gy = worldToGrid(turret.z);
		let pillars = 0;
		for (const pr of d.props) {
			if (pr.kind !== "pillar" || tileAt(d, pr.x, pr.y) !== TileType.WALL) continue;
			if (math.max(math.abs(pr.x - gx), math.abs(pr.y - gy)) > COVER_PILLAR_TILES) continue;
			expect(d.roomId[pr.y * d.W + pr.x]).toBe(room.roomId); // a pillar of this room (it keeps its roomId)
			pillars++;
		}
		expect(pillars > 0).toBe(true);
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
			combatE: ["turret.sniper"],
			combatF: ["turret.sprayer", "turret.sprayer"],
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
		expect(spawning).toBe(6);
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

	it("floor 2 is a boss floor with Mother Bramble as its only spawn; floor 3+ is the same layout, empty and open", () => {
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
		// Depth 1 / floor 1 scaling leaves her base hp; the tutorial takes bossHpPercent of it (540 x 20 % = 108).
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
