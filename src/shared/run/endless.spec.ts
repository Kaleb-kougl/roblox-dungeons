// Endless mode end to end (shared/run endless.ts + shared/sim endless.ts): the run config from a seed, floor
// transitions (the stairwell and the debug skip), Depth after a boss kill, hp / bullet speed scaling, deferred room
// spawns, the appended `endless` hash group, and a recorded run across floors that replays (and validates) exactly
// (the bot and the recorded run: shared/run/testing endlessBot.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOSS_ACT1_ID,
	BOSS_HP,
	BulletKind,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	AFFIXES_CONFIG,
	AFFIXES_SUBSYSTEM,
	BUILDS_CONFIG,
	BUILDS_SUBSYSTEM,
	BREAKABLES_SUBSYSTEM,
	DROPS_CONFIG,
	DROPS_SUBSYSTEM,
	PELLETS_CONFIG,
	ENDLESS_TREASURE_CONFIG,
	TREASURE_SUBSYSTEM,
	PELLETS_SUBSYSTEM,
	ENDLESS_PACTS_CONFIG,
	PACTS_SUBSYSTEM,
	ENDLESS_GOLDEN_CONFIG,
	GOLDEN_SUBSYSTEM,
	ENDLESS_DROPS_CONFIG,
	ENDLESS_HASH_SUBSYSTEM,
	RUN_SUBSYSTEM,
	SCORE_SUBSYSTEM,
	STAIRWELL_RADIUS,
	ScoreSource,
	type SimConfig,
	SimCtx,
	archetypeAt,
	archetypeIndex,
	createSimState,
	encodeRecording,
	endlessActorHp,
	enemyBulletSpeedMultiplier,
	floorHpMultiplier,
	depthHpMultiplier,
	hashLayout,
	hashState,
	runReplay,
	step,
	subsystemHashes,
	writeHashFields,
	NO_KIND,
	NO_BOOST,
} from "shared/sim";
import { BOSS_DEMONLORD_KIND, bossKindFor, floorSeed, isBossFloor } from "shared/dungeon";
import {
	DEFAULT_RUN_LIMITS,
	ENDLESS_DUNGEON_CACHE_SIZE,
	LIVE_RUN_LIMITS,
	buildEndlessRunConfig,
	buildRunConfig,
	cachedEndlessDungeonKeys,
	validateRun,
	type RunLimits,
	type RunSubmission,
} from "shared/run";
import { dismissDraft, frame, recordEndlessRun, skipToFloor } from "shared/run/testing";

// ---------------------------------------------------------------------------------------------

describe("buildEndlessRunConfig", () => {
	const setup = buildEndlessRunConfig(1337);

	it("starts on floor 1 at its entrance, Depth 1, through buildRunConfig's 'endless' world too", () => {
		const f1 = setup.endlessFloor(1);
		expect(setup.spawn).toEqual({ x: f1.spawnX, z: f1.spawnZ });
		expect(f1.layout.seed).toBe(floorSeed(1337, 1));
		expect(setup.dungeon).toBe(f1.dungeon);
		const viaWorld = buildRunConfig(1337, { world: "endless" });
		expect(viaWorld.spawn).toEqual(setup.spawn);
		const s = createSimState(1337, f1.spawnX, f1.spawnZ, setup.config);
		expect(s.endless).toEqual({
			floor: 1,
			depth: 1,
			stairsOpen: 1,
			floorStartTick: 0,
			roomsEntered: f1.layout.roomSpawns.map(() => 0),
		});
		expect(s.combat.actors.size()).toBe(0); // room enemies are deferred; floor 1 has no boss
		expect(LIVE_RUN_LIMITS.world).toBe("endless");
		expect(DEFAULT_RUN_LIMITS.world).toBe("game");
	});

	it("hashes appended `endless`, `score` (endless runs are scored), `run`, `breakables`, `drops` and `affixes` groups only in endless runs", () => {
		const f1 = setup.endlessFloor(1);
		const s = createSimState(1337, f1.spawnX, f1.spawnZ, setup.config);
		const layout = hashLayout(s, true);
		expect(layout.groups.size()).toBe(17);
		expect(layout.groups[9].name).toBe(BREAKABLES_SUBSYSTEM);
		expect(layout.names[layout.groups[9].start]).toBe("breakables.length");
		expect(layout.values[layout.groups[9].start]).toBe(f1.breakables!.size());
		// docs/BOOSTS.md B4: endless runs drop boosts (DROPS_CONFIG plus boosts from breakables: ENDLESS_DROPS_CONFIG,
		// docs/BREAKABLE_DROPS.md BL4), hashed after breakables; the group ends with floor 1's loot, one per piece.
		expect(setup.config.drops).toBe(ENDLESS_DROPS_CONFIG);
		expect({ ...setup.config.drops, breakableLoot: undefined }).toEqual({ ...DROPS_CONFIG });
		const dg = layout.groups[10];
		expect(dg.name).toBe(DROPS_SUBSYSTEM);
		expect(layout.names[dg.start]).toBe("drops.rngState");
		const lootAt = dg.finish - 1 - f1.breakables!.size();
		expect([layout.names[lootAt], layout.values[lootAt]]).toEqual([
			"drops.pieceLoot.length",
			f1.breakables!.size(),
		]);
		expect(layout.names[lootAt - 1]).toBe("drops.players[0].aegisPips");
		let loaded = 0;
		for (let i = lootAt + 1; i < dg.finish; i++) if (layout.values[i] !== NO_BOOST) loaded++;
		expect(loaded).toBe(f1.breakableLoot!.size());
		// docs/ENEMY_VARIANTS.md EV7: endless runs have elite affixes (AFFIXES_CONFIG), hashed after drops (last).
		expect(setup.config.affixes).toBe(AFFIXES_CONFIG);
		expect(layout.groups[11].name).toBe(AFFIXES_SUBSYSTEM);
		expect(layout.names[layout.groups[11].start]).toBe("affixes.slots.length");
		// docs/BUILDS.md BU1: endless runs have builds (BUILDS_CONFIG), hashed after affixes (last).
		expect(setup.config.builds).toBe(BUILDS_CONFIG);
		expect(layout.groups[12].name).toBe(BUILDS_SUBSYSTEM);
		expect(layout.names[layout.groups[12].start]).toBe("builds.players.length");
		// docs/PELLETS.md PL5: endless runs have pellets (PELLETS_CONFIG), hashed after builds.
		expect(setup.config.pellets).toBe(PELLETS_CONFIG);
		expect(layout.groups[13].name).toBe(PELLETS_SUBSYSTEM);
		expect(layout.names[layout.groups[13].start]).toBe("pellets.length");
		// docs/TREASURE.md TR5: endless runs have treasure rooms (ENDLESS_TREASURE_CONFIG), hashed after pellets.
		expect(setup.config.treasure).toBe(ENDLESS_TREASURE_CONFIG);
		expect(layout.groups[14].name).toBe(TREASURE_SUBSYSTEM);
		expect(layout.names[layout.groups[14].start]).toBe("treasure.rngState");
		// docs/FORTUNE.md PS5: endless runs have pacts (ENDLESS_PACTS_CONFIG), hashed after treasure.
		expect(setup.config.pacts).toBe(ENDLESS_PACTS_CONFIG);
		expect(layout.groups[15].name).toBe(PACTS_SUBSYSTEM);
		expect(layout.names[layout.groups[15].start]).toBe("pacts.room");
		// docs/FORTUNE.md GE3: endless runs have the Goldling (ENDLESS_GOLDEN_CONFIG), hashed after pacts (last).
		expect(setup.config.golden).toBe(ENDLESS_GOLDEN_CONFIG);
		expect(layout.groups[16].name).toBe(GOLDEN_SUBSYSTEM);
		expect(layout.names[layout.groups[16].start]).toBe("golden.rngState");
		const g = layout.groups[6];
		expect(g.name).toBe(ENDLESS_HASH_SUBSYSTEM);
		expect(layout.groups[7].name).toBe(SCORE_SUBSYSTEM);
		expect(layout.names[layout.groups[7].start]).toBe("score.total");
		expect(layout.groups[8].name).toBe(RUN_SUBSYSTEM);
		expect(layout.names[layout.groups[8].start]).toBe("run.players.length");
		expect(subsystemHashes(s).run).never.toBe(undefined);
		expect(layout.names[g.start]).toBe("endless.floor");
		expect(g.finish - g.start).toBe(5 + f1.layout.roomSpawns.size());
		expect(subsystemHashes(s).endless).never.toBe(undefined);
		expect(layout.values).toEqual(writeHashFields(s, []));
		const m1 = buildRunConfig(1337);
		const plain = createSimState(1337, m1.spawn!.x, m1.spawn!.z, m1.config);
		expect(hashLayout(plain).groups.size()).toBe(6);
		expect(plain.endless).toBe(undefined);
		expect(plain.run).toBe(undefined);
		expect(plain.breakables).toBe(undefined);
		expect(plain.drops).toBe(undefined);
		expect(plain.affixes).toBe(undefined);
		expect(subsystemHashes(plain).endless).toBe(undefined);
		expect(subsystemHashes(plain).run).toBe(undefined);
	});

	it("caches floors per run and dungeons server-wide (LRU)", () => {
		expect(setup.endlessFloor(2)).toBe(setup.endlessFloor(2));
		for (let f = 1; f <= ENDLESS_DUNGEON_CACHE_SIZE + 2; f++) setup.endlessFloor(f);
		expect(cachedEndlessDungeonKeys().size()).toBe(ENDLESS_DUNGEON_CACHE_SIZE);
	});
});

describe("fortune: pacts and the Goldling together (docs/FORTUNE.md)", () => {
	it("solo and co-op configs carry both; the hash ends pellets, treasure, pacts, golden; score sources TREASURE 12, HORDE 13, GOLDEN 14", () => {
		for (const n of [1, 3]) {
			const run = buildEndlessRunConfig(1337, n);
			expect(run.config.pacts).toBe(ENDLESS_PACTS_CONFIG);
			expect(run.config.golden).toBe(ENDLESS_GOLDEN_CONFIG);
			const f1 = run.endlessFloor(1);
			const s = createSimState(1337, f1.spawnX, f1.spawnZ, run.config);
			const layout = hashLayout(s, true);
			const names = layout.groups.map((g) => g.name);
			expect([
				names[names.size() - 4],
				names[names.size() - 3],
				names[names.size() - 2],
				names[names.size() - 1],
			]).toEqual([PELLETS_SUBSYSTEM, TREASURE_SUBSYSTEM, PACTS_SUBSYSTEM, GOLDEN_SUBSYSTEM]);
			expect(layout.values).toEqual(writeHashFields(s, []));
			expect([ScoreSource.TREASURE, ScoreSource.HORDE, ScoreSource.GOLDEN]).toEqual([12, 13, 14]);
			expect(s.score!.points.size()).toBe(ScoreSource.GOLDEN + 1);
			expect(s.score!.counts.size()).toBe(ScoreSource.GOLDEN + 1);
			expect(layout.names.includes("score.points.treasure")).toBe(true);
			expect(layout.names.includes("score.points.horde")).toBe(true);
			expect(layout.names.includes("score.points.golden")).toBe(true);
		}
	});

	it("any subset of treasure / pacts / golden pads up to its last gated source (12 entries with none)", () => {
		const run = buildEndlessRunConfig(1337);
		const f1 = run.endlessFloor(1);
		const sources = (config: SimConfig) => {
			const s = createSimState(1337, f1.spawnX, f1.spawnZ, config);
			const names = hashLayout(s, true).groups.map((g) => g.name);
			return [s.score!.points.size(), s.score!.counts.size(), names[names.size() - 1]];
		};
		const c = run.config;
		expect(sources(c)).toEqual([15, 15, GOLDEN_SUBSYSTEM]);
		expect(sources({ ...c, golden: undefined })).toEqual([14, 14, PACTS_SUBSYSTEM]);
		expect(sources({ ...c, pacts: undefined })).toEqual([15, 15, GOLDEN_SUBSYSTEM]);
		expect(sources({ ...c, pacts: undefined, golden: undefined })).toEqual([13, 13, TREASURE_SUBSYSTEM]);
		expect(sources({ ...c, treasure: undefined })).toEqual([15, 15, GOLDEN_SUBSYSTEM]);
		expect(sources({ ...c, treasure: undefined, golden: undefined })).toEqual([14, 14, PACTS_SUBSYSTEM]);
		expect(sources({ ...c, treasure: undefined, pacts: undefined })).toEqual([15, 15, GOLDEN_SUBSYSTEM]);
		expect(sources({ ...c, treasure: undefined, pacts: undefined, golden: undefined })).toEqual([
			12,
			12,
			PELLETS_SUBSYSTEM,
		]);
		// The padded sources stay 0 and still hash (under their own names).
		const goldenOnly = createSimState(1337, f1.spawnX, f1.spawnZ, { ...c, treasure: undefined, pacts: undefined });
		expect([goldenOnly.score!.points[ScoreSource.TREASURE], goldenOnly.score!.points[ScoreSource.HORDE]]).toEqual([
			0, 0,
		]);
		const goldenNames = hashLayout(goldenOnly, true).names;
		expect(goldenNames.includes("score.points.treasure")).toBe(true);
		expect(goldenNames.includes("score.points.horde")).toBe(true);
		const pactsOnly = createSimState(1337, f1.spawnX, f1.spawnZ, { ...c, treasure: undefined, golden: undefined });
		expect(pactsOnly.score!.points[ScoreSource.TREASURE]).toBe(0);
		expect(hashLayout(pactsOnly, true).names.includes("score.points.treasure")).toBe(true);
	});
});

describe("endless scaling", () => {
	it("hp: base x (1 + 0.08 (floor - 1)) x 1.5^(depth - 1); bosses by Depth only (exact)", () => {
		expect([floorHpMultiplier(1), floorHpMultiplier(2), floorHpMultiplier(6), floorHpMultiplier(26)]).toEqual([
			1, 1.08, 1.4, 3,
		]);
		expect([depthHpMultiplier(1), depthHpMultiplier(2), depthHpMultiplier(3), depthHpMultiplier(4)]).toEqual([
			1, 1.5, 2.25, 3.375,
		]);
		expect(endlessActorHp(2, false, 6, 2)).toBe(4.199999999999999);
		expect(endlessActorHp(10, false, 11, 3)).toBe(40.5);
		expect(endlessActorHp(4, false, 2, 1)).toBe(4.32);
		expect(endlessActorHp(540, true, 9, 2)).toBe(810);
		expect(endlessActorHp(540, true, 5, 1)).toBe(540);
	});

	it("bullet speed: x min(1 + 0.02 (floor - 1), 1.4) (exact)", () => {
		expect([1, 2, 6, 11, 21, 26, 40].map(enemyBulletSpeedMultiplier)).toEqual([1, 1.02, 1.1, 1.2, 1.4, 1.4, 1.4]);
	});

	it("room enemies spawn on first entry with floor-scaled hp, and fire floor-scaled bullets", () => {
		const setup = buildEndlessRunConfig(42);
		const spawn = setup.spawn!;
		const s = createSimState(42, spawn.x, spawn.z, setup.config);
		// Debug-skip to floor 3 (two presses, the boon drafts dismissed), then stand in the first room with enemies.
		skipToFloor(s, setup.config, 3);
		expect(s.endless!.floor).toBe(3);
		const w = setup.endlessFloor(3);
		let room = -1;
		for (let id = 0; id < w.roomSpawns.size() && room < 0; id++) if (w.roomSpawns[id].size() > 0) room = id;
		expect(room).toBeGreaterThanOrEqual(0);
		const first = w.roomSpawns[room][0];
		s.player.x = first.x;
		s.player.z = first.z;
		step(s, EMPTY_INPUT, setup.config);
		expect(s.events.roomEntered).toBe(room + 1);
		expect(s.events.actorsSpawned).toBe(w.roomSpawns[room].size());
		expect(s.endless!.roomsEntered[room]).toBe(1);
		for (const a of s.combat.actors) {
			if (a.kind === NO_KIND) continue;
			expect(a.hpMax).toBe(archetypeAt(a.kind).data.hp * floorHpMultiplier(3));
		}
		// An enemy's shot on floor 3 flies at spec speed x 1.04; its shape (one bullet) is the spec's.
		const shooter = s.combat.actors.find((a) => a.kind !== NO_KIND && a.alive !== 0)!;
		const ctx = new SimCtx().bind(s, w.config, EMPTY_INPUT);
		s.combat.enemyBullets.clear();
		const spec = { count: 1, spread: 0, speed: 5, life: 1, damage: 1, kind: BulletKind.ENEMY };
		expect(ctx.fireEnemy(shooter, 0, 1, spec)).toBe(1);
		const speeds: number[] = [];
		s.combat.enemyBullets.forEachActive((i) => {
			speeds.push(s.combat.enemyBullets.velocityAt(i).z);
			return false;
		});
		expect(enemyBulletSpeedMultiplier(3)).toBe(1.04);
		expect(speeds).toEqual([5 * 1.04]);
	});
});

describe("floor transitions", () => {
	it("the debug skip ends a floor: bullets cleared, actors freed, the next floor's entrance, flask / armor refilled", () => {
		const setup = buildEndlessRunConfig(7);
		const spawn = setup.spawn!;
		const s = createSimState(7, spawn.x, spawn.z, setup.config);
		// Floors 1-4 skipped (the boon drafts dismissed), floor 5 has the boss.
		skipToFloor(s, setup.config, 5);
		expect(s.endless!.floor).toBe(5);
		expect(isBossFloor(5)).toBe(true);
		expect(s.endless!.stairsOpen).toBe(0);
		const w5 = setup.endlessFloor(5);
		expect([s.player.x, s.player.z]).toEqual([w5.spawnX, w5.spawnZ]);
		const boss = s.combat.actors.find((a) => a.kind === archetypeIndex(BOSS_ACT1_ID));
		expect(boss).never.toBe(undefined);
		expect(boss!.hpMax).toBe(BOSS_HP); // Depth 1: her base hp (270, half the web build's 540)
		s.player.flask = 0;
		s.player.armor = 0;
		s.player.hearts = 3;
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), setup.config);
		expect(s.events.floorChanged).toBe(6);
		expect(s.endless!.depth).toBe(1); // skipped, not killed
		expect(s.endless!.floorStartTick).toBe(s.tick);
		expect([s.player.flask, s.player.armor, s.player.hearts]).toEqual([s.player.flaskMax, s.player.armorMax, 3]);
		for (const a of s.combat.actors) expect(a.kind).toBe(NO_KIND);
		expect(s.combat.enemyBullets.activeCount + s.combat.playerBullets.activeCount).toBe(0);
		// Held, not pressed: nothing more (and the boon draft the change opened freezes the world until resolved).
		dismissDraft(s);
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), setup.config);
		expect(s.endless!.floor).toBe(6);
	});

	it("a closed stairwell does nothing; an open one ends the floor; the dead never descend", () => {
		const setup = buildEndlessRunConfig(7);
		const spawn = setup.spawn!;
		const s = createSimState(7, spawn.x, spawn.z, setup.config);
		const w1 = setup.endlessFloor(1);
		s.player.x = w1.stairX + STAIRWELL_RADIUS * 0.5;
		s.player.z = w1.stairZ;
		s.player.dead = 1;
		step(s, EMPTY_INPUT, setup.config);
		expect(s.endless!.floor).toBe(1);
		s.player.dead = 0;
		step(s, EMPTY_INPUT, setup.config);
		expect(s.endless!.floor).toBe(2);
		expect(s.events.floorChanged).toBe(2);
	});
});

describe("a recorded endless run", () => {
	const { seed, setup, drv, recording, finalHash, depthAfterBoss, afterWalk, log } = recordEndlessRun(1337);

	it("crosses 7 floors: two by walking into the stairwell, Depth 2 after the boss kill", () => {
		print(
			`[endless] ${recording.frames.size()} ticks, floor ${drv.floor()}, depth ${drv.state.endless!.depth}, ` +
				`most actors ${drv.maxActors}, floors at ${drv.floorTicks.join(",")}; ${log.join("; ")}`,
		);
		expect(afterWalk).toBe(7);
		expect(drv.state.player.dead).toBe(0);
		expect(drv.floor()).toBe(8);
		expect(drv.floorTicks.size()).toBe(7);
		expect(drv.bossKills).toBe(1);
		expect(depthAfterBoss).toBe(2);
		expect(drv.state.endless!.depth).toBe(2);
		expect(drv.depthTicks.size()).toBe(1);
		expect(drv.stairwellEntries).toEqual([5, 6]);
		expect(drv.maxActors <= 64).toBe(true);
	});

	it("fights the Demon Lord on floor 5 (the seeded pick, docs/BOSS_DEMONLORD.md D5)", () => {
		expect(bossKindFor(floorSeed(seed, 5))).toBe(BOSS_DEMONLORD_KIND);
		expect(setup.endlessFloor(5).layout.bossKind).toBe(BOSS_DEMONLORD_KIND);
		expect(setup.endlessFloor(5).layout.encounter.spawns.map((sp) => sp.kind)).toEqual([BOSS_DEMONLORD_KIND]);
	});

	it("replays to the identical hash, tick by tick", () => {
		const n = recording.frames.size();
		expect(hashState(runReplay(recording, buildEndlessRunConfig(seed).config))).toBe(finalHash);
		for (const [t, h] of drv.hashes) expect([t, hashState(runReplay(recording, setup.config, t))]).toEqual([t, h]);
		expect(n).toBe(drv.state.tick);
	});

	it("validates on a server in the endless world (with debug input allowed), and is rejected live for the debug skip", () => {
		const submission: RunSubmission = {
			seed,
			atBossDoor: false,
			recording: encodeRecording(recording),
			claimedHash: finalHash,
			claimed: { ticks: drv.state.tick, kills: 0, bossDefeated: true, died: false },
		};
		const dev: RunLimits = { ...LIVE_RUN_LIMITS, allowDebugInput: true };
		const probe = validateRun(submission, dev);
		expect(probe.serverHash).toBe(finalHash);
		const ok = validateRun({ ...submission, claimed: probe.summary }, dev);
		expect([ok.ok, ok.code]).toEqual([true, undefined]);
		expect(ok.summary.bossDefeated).toBe(true);
		const live = validateRun({ ...submission, claimed: probe.summary }, LIVE_RUN_LIMITS);
		expect(live.code).toBe("debug_input");
		// One flipped skip press changes the run.
		const frames = [...recording.frames];
		const k = frames.findIndex((f) => bit32.band(f.buttons, DEBUG_FLOOR_BUTTON) !== 0);
		frames[k] = { ...frames[k], buttons: 0 };
		expect(hashState(runReplay({ ...recording, frames }, setup.config))).never.toBe(finalHash);
	});
});

export {};
