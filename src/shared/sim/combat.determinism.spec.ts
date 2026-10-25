// Determinism of combat (E1.6, E1.8 actors and weapons; ported from src/sim/combat.determinism.test.ts): a real dungeon
// with the default encounter (E1.8 room enemies) plus test archetypes that walk through the world, check line of sight,
// touch the player, draw from the sim rng, telegraph, change phase, spawn adds at runtime and cap their damage; the
// player walking, rolling, shooting (FIRE), swapping weapon sets (SWAP: 'game' the sword and bow, 'mixed' the
// placeholder gun and swing), drinking and using Embers on seeded random input, played live through the FixedStepLoop
// (irregular frames and hitches, one sample per frame, recorded per tick). The replay must match bit for bit, including
// both bullet simulations and every actor slot; one changed input bit must change the hash; how ticks group into frames
// must not matter.
import { describe, expect, it } from "@rbxts/jest-globals";
import { hypot2, jsRound, stableSort } from "shared/jsmath";
import {
	DEFAULT_ENCOUNTER,
	KALEB_VALE_MVP_PARAMS,
	TEST_TURRET_KINDS,
	actorMover,
	bulletBlocker,
	circleMover,
	circleOverlapsWall,
	entranceSpawn,
	generateDungeon,
	isBulletBlocked,
	placeEncounter,
	worldToGrid,
	type Dungeon,
	type EncounterOptions,
} from "shared/dungeon";
import "shared/sim/testing";
import {
	AXIS_MAX,
	Button,
	FixedStepLoop,
	PLAYER_RADIUS,
	Recorder,
	Rng,
	archetypeIndex,
	createSimState,
	hashState,
	runReplay,
	step,
	weaponIndex,
	type InputFrame,
	type Recording,
	type SimConfig,
	type SimState,
} from "shared/sim";

const TICKS = 3600;

type Scenario = "game" | "mixed";

/** The E1.6 sandbox turrets (no longer in the default encounter): anchors the 'mixed' scenario's room and spawn. */
const TURRETS: EncounterOptions = { nearest: TEST_TURRET_KINDS };

/**
 * 'game': exactly the game's run config (App.tsx: the default encounter, E1.8's room enemies).
 * 'mixed': no turrets; in the room nearest the entrance (where the first sandbox turret would stand) two test.chasers
 * on its first and last floor tiles and a test.boss on the east end of its center row.
 */
function combatConfig(d: Dungeon, scenario: Scenario): SimConfig {
	const first = placeEncounter(d, TURRETS).spawns[0];
	const firstRoom = d.roomId[worldToGrid(first.z) * d.W + worldToGrid(first.x)];
	const encounter =
		scenario === "game"
			? placeEncounter(d, DEFAULT_ENCOUNTER)
			: placeEncounter(d, {
					populate: (room, tools) => {
						if (room.id !== firstRoom) return [];
						const floor = tools.floor();
						// The boss on the room's center row, as far east as the floor goes (away from the player's start).
						const row = floor.filter((t) => t.z === room.cz);
						const east = row.size() > 0 ? row[row.size() - 1] : floor[math.floor(floor.size() / 2)];
						return [
							{ kind: "test.chaser", x: floor[0].x, z: floor[0].z },
							{ kind: "test.chaser", x: floor[floor.size() - 1].x, z: floor[floor.size() - 1].z },
							{ kind: "test.boss", x: east.x, z: east.z },
						];
					},
			  });
	return {
		moveResolver: circleMover(d, PLAYER_RADIUS),
		actorMover: actorMover(d),
		isBulletBlocked: bulletBlocker(d),
		encounter,
		// 'mixed' keeps the placeholder gun + swing (E1.6 / E1.8 prep) it was tuned with; the sword and bow (the default
		// loadout, used by 'game') get the same treatment in swordBow.determinism.spec.ts.
		loadout: scenario === "mixed" ? ["weapon.test", "weapon.test.melee"] : undefined,
	};
}

const SPAWN_OFFSETS: ReadonlyArray<readonly [number, number]> = [
	[2, 0],
	[-2, 0],
	[0, 2],
	[0, -2],
];

/**
 * Start two tiles from the first placed actor, on open floor: 'mixed' next to where the first sandbox turret would
 * stand, 'game' next to the default encounter's first enemy (inside its aggro range).
 */
function spawnNearFirst(d: Dungeon, scenario: Scenario): { x: number; z: number } {
	const t = placeEncounter(d, scenario === "game" ? DEFAULT_ENCOUNTER : TURRETS).spawns[0];
	for (const [ox, oz] of SPAWN_OFFSETS) {
		if (!circleOverlapsWall(d, t.x + ox, t.z + oz, PLAYER_RADIUS)) return { x: t.x + ox, z: t.z + oz };
	}
	return entranceSpawn(d);
}

/**
 * Seeded random input like a (twitchy) player: often aims at the nearest live actor (reading the live state, as a
 * human reads the screen; the recording, not this function, is what replays), holds FIRE most of the time, and
 * presses ROLL / FLASK / EMBER / SWAP at random. Each frame is held for 1..20 rendered frames.
 */
function makeInput(seed: number): (s: SimState) => InputFrame {
	const rng = new Rng(seed);
	let current: InputFrame = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, buttons: 0 };
	let hold = 0;
	const axis = (): number => {
		const options = [0, 707, -707, AXIS_MAX, -AXIS_MAX, rng.int(-AXIS_MAX, AXIS_MAX)];
		return options[rng.int(0, 5)];
	};
	return (s: SimState): InputFrame => {
		if (hold <= 0) {
			hold = rng.int(1, 20);
			let buttons = 0;
			if (rng.next() < 0.7) buttons = bit32.bor(buttons, Button.FIRE);
			if (rng.next() < 0.15) buttons = bit32.bor(buttons, Button.ROLL);
			if (rng.next() < 0.03) buttons = bit32.bor(buttons, Button.EMBER);
			if (rng.next() < 0.05) buttons = bit32.bor(buttons, Button.FLASK);
			if (rng.next() < 0.06) buttons = bit32.bor(buttons, Button.SWAP);
			let aimX = 0;
			let aimZ = 0;
			const p = s.player;
			const live = s.combat.actors.filter((t) => t.alive === 1);
			const target = stableSort(live, (a, b) => hypot2(a.x - p.x, a.z - p.z) - hypot2(b.x - p.x, b.z - p.z))[0];
			if (target !== undefined && rng.next() < 0.7) {
				let len = hypot2(target.x - p.x, target.z - p.z);
				if (len === 0) len = 1;
				aimX = jsRound(((target.x - p.x) / len) * AXIS_MAX);
				aimZ = jsRound(((target.z - p.z) / len) * AXIS_MAX);
			} else if (rng.next() < 0.5) {
				aimX = axis();
				aimZ = axis();
			}
			current = { moveX: axis(), moveZ: axis(), aimX, aimZ, buttons };
		}
		hold--;
		return current;
	};
}

interface Counts {
	shots: number;
	swaps: number;
	swings: number;
	deleted: number;
	runtimeSpawns: number;
	phases: number;
	telegraphs: number;
	contactOrChaserHits: number;
	actorMoves: number;
	enemyHits: number;
	kills: number;
	playerHits: number;
	cleared: number;
	bulletsInWalls: number;
	maxEnemyBullets: number;
}

interface LiveRun {
	state: SimState;
	config: SimConfig;
	recording: Recording;
	counts: Counts;
	hashes: Map<number, string>;
	frames: number;
	deathTick: number;
}

function runLive(d: Dungeon, seed: number, scenario: Scenario): LiveRun {
	const config = combatConfig(d, scenario);
	const spawn = spawnNearFirst(d, scenario);
	const deltaRng = new Rng(bit32.bxor(seed, 0xb011e7));
	const nextInput = makeInput(seed);
	const state = createSimState(seed, spawn.x, spawn.z, config);
	const recorder = new Recorder(seed, spawn.x, spawn.z);
	const loop = new FixedStepLoop();
	const chaser = archetypeIndex("test.chaser");
	const counts: Counts = {
		swaps: 0,
		swings: 0,
		deleted: 0,
		runtimeSpawns: 0,
		phases: 0,
		telegraphs: 0,
		contactOrChaserHits: 0,
		actorMoves: 0,
		shots: 0,
		enemyHits: 0,
		kills: 0,
		playerHits: 0,
		cleared: 0,
		bulletsInWalls: 0,
		maxEnemyBullets: 0,
	};
	const hashes = new Map<number, string>();
	let frames = 0;
	let deathTick = -1;
	const inWall = (_i: number, pos: { x: number; z: number }): boolean => {
		if (isBulletBlocked(d, pos.x, pos.z)) counts.bulletsInWalls++;
		return false;
	};
	while (recorder.size() < TICKS) {
		const r = deltaRng.next();
		const delta = r < 0.02 ? 0.25 + deltaRng.next() : (1 + deltaRng.next() * 7) / 240;
		const input = nextInput(state);
		loop.advance(delta, () => {
			recorder.record(input);
			step(state, input, config);
			const e = state.events;
			counts.shots += e.shotsFired;
			counts.swaps += e.weaponSwapped;
			counts.swings += e.meleeSwings;
			counts.deleted += e.bulletsDeleted;
			counts.runtimeSpawns += e.actorsSpawned;
			counts.phases += e.bossPhase > 0 ? 1 : 0;
			counts.telegraphs += e.telegraphs;
			if (e.playerHits > 0 && scenario === "mixed" && e.lastHitSource === chaser) counts.contactOrChaserHits++;
			for (const a of state.combat.actors) if (a.x !== a.prevX || a.z !== a.prevZ) counts.actorMoves++;
			if (state.player.dead !== 0 && deathTick < 0) deathTick = state.tick;
			counts.enemyHits += e.enemyHits;
			counts.kills += e.enemiesKilled;
			counts.playerHits += e.playerHits;
			counts.cleared += e.bulletsCleared;
			counts.maxEnemyBullets = math.max(counts.maxEnemyBullets, state.combat.enemyBullets.activeCount);
			state.combat.enemyBullets.forEachActive(inWall);
			state.combat.playerBullets.forEachActive(inWall);
			if (state.tick % 600 === 0) hashes.set(state.tick, hashState(state));
		});
		frames++;
	}
	return { state, config, recording: recorder.getRecording(), counts, hashes, frames, deathTick };
}

/** Feeds the recording's per-tick frames through a FixedStepLoop with another frame-delta pattern. */
function replayGrouped(recording: Recording, config: SimConfig, nextDelta: () => number): SimState {
	const s = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, config);
	const loop = new FixedStepLoop();
	let k = 0;
	while (k < recording.frames.size()) {
		loop.advance(nextDelta(), () => {
			if (k < recording.frames.size()) {
				step(s, recording.frames[k], config);
				k++;
			}
		});
	}
	return s;
}

/** Every live bullet of a simulation, as hashed (slot, position, velocity, life, payload, emitter). */
function bulletDump(s: SimState, which: "enemyBullets" | "playerBullets"): number[] {
	const out: number[] = [];
	s.combat[which].writeStateHash(out);
	return out;
}

const SCENARIOS: ReadonlyArray<readonly [number, Scenario]> = [
	[1337, "game"],
	[42, "game"],
	[1337, "mixed"],
	[42, "mixed"],
];

for (const [seed, scenario] of SCENARIOS) {
	describe(`combat replays deterministically in a dungeon (seed ${seed}, ${scenario} encounter)`, () => {
		const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
		const live = runLive(d, seed, scenario);
		const liveHash = hashState(live.state);

		it("really fights: volleys, swings, swaps, hits both ways, and no bullet ever survives a tick inside a wall", () => {
			expect(live.state.tick).toBe(live.recording.frames.size());
			expect(live.state.tick).toBeGreaterThanOrEqual(TICKS);
			expect(live.frames).never.toBe(live.state.tick); // frames and ticks really were decoupled
			const c = live.counts;
			// (The room enemies can overwhelm the random player within seconds, so the 'game' bar is lower.)
			expect(c.shots + c.swings).toBeGreaterThan(scenario === "game" ? 10 : 20);
			expect(c.swaps).toBeGreaterThan(0);
			expect(c.swings).toBeGreaterThan(0);
			expect(c.enemyHits).toBeGreaterThan(10);
			expect(c.kills).toBeGreaterThan(0);
			expect(c.playerHits).toBeGreaterThan(0);
			expect(c.bulletsInWalls).toBe(0);
			const kinds = live.config.encounter!.spawns.map((sp) => sp.kind);
			if (scenario === "game") {
				expect(kinds.size()).toBeGreaterThan(10);
				expect(kinds).toContain("swarmer");
				// Room enemies, then the boss (placeEncounter places it last, on the boss room's center tile).
				expect(kinds[kinds.size() - 1]).toBe("boss.act1");
				for (let i = 0; i < kinds.size() - 1; i++) expect(["swarmer", "sniper", "bruiser"]).toContain(kinds[i]);
				// The game's loadout (DEFAULT_LOADOUT): the sword in set 1, the bow in set 2; both really fought.
				expect(live.state.combat.weapons.sets.map((w) => w.weapon)).toEqual([
					weaponIndex("weapon.sword"),
					weaponIndex("weapon.bow"),
				]);
				expect(c.shots).toBeGreaterThan(0); // bow arrows (after a SWAP)
				expect(c.telegraphs).toBeGreaterThan(5); // lunges, sniper lines, slams
				expect(c.actorMoves).toBeGreaterThan(500);
				expect(live.state.combat.enemySpawned).toBeGreaterThan(10); // sniper lines and slam rings
			} else {
				expect(kinds).toEqual(["test.chaser", "test.chaser", "test.boss"]);
				expect(c.telegraphs).toBeGreaterThan(0);
				expect(c.actorMoves).toBeGreaterThan(0);
				expect(c.runtimeSpawns).toBeGreaterThan(0); // the boss's adds
				expect(c.phases).toBeGreaterThan(0);
				expect(c.contactOrChaserHits).toBeGreaterThan(0);
				expect(c.cleared).toBeGreaterThan(0); // Embers really clear bullets (the test boss's rings)
			}
		});

		it("the replay reproduces the live state bit for bit, bullets included", () => {
			const replayed = runReplay(
				live.recording,
				combatConfig(generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed }), scenario),
			);
			expect(hashState(replayed)).toBe(liveHash);
			expect(replayed.combat.enemyBullets.activeCount).toBe(live.state.combat.enemyBullets.activeCount);
			// Field group by field group first (a failure names the group), then the whole state like the source.
			expect([replayed.tick, replayed.rngState]).toEqual([live.state.tick, live.state.rngState]);
			expect(replayed.player).toEqual(live.state.player);
			expect(replayed.events).toEqual(live.state.events);
			expect(replayed.combat.actors).toEqual(live.state.combat.actors);
			expect(replayed.combat.weapons).toEqual(live.state.combat.weapons);
			expect(bulletDump(replayed, "enemyBullets")).toEqual(bulletDump(live.state, "enemyBullets"));
			expect(bulletDump(replayed, "playerBullets")).toEqual(bulletDump(live.state, "playerBullets"));
			expect(replayed).toEqual(live.state);
		});

		it("matches at every checkpoint partway through", () => {
			for (let t = 600; t < TICKS; t += 600) {
				expect([t, hashState(runReplay(live.recording, live.config, t))]).toEqual([t, live.hashes.get(t)]);
			}
		});

		it("frame grouping is irrelevant: the same ticks under three other frame patterns give the same hash", () => {
			const steady = (): number => 1 / 60;
			const slow = (): number => 1 / 24; // 2-3 ticks per frame
			const r = new Rng(seed);
			const jittery = (): number => (r.next() < 0.05 ? 0.2 : r.next() / 30);
			for (const pattern of [steady, slow, jittery]) {
				expect(hashState(replayGrouped(live.recording, live.config, pattern))).toBe(liveHash);
			}
		});

		it("a single changed input bit changes the hash", () => {
			// The first tick a volley went out with an analog aim (both axes non-zero, neither at full deflection).
			const frames = live.recording.frames;
			const probe = createSimState(
				live.recording.seed,
				live.recording.spawn.x,
				live.recording.spawn.z,
				live.config,
			);
			const analog = (v: number): boolean => v !== 0 && math.abs(v) !== AXIS_MAX;
			let first = -1;
			for (let t = 0; t < frames.size() && first < 0; t++) {
				step(probe, frames[t], live.config);
				if (probe.events.shotsFired !== 0 && analog(frames[t].aimX) && analog(frames[t].aimZ)) first = t;
			}
			expect(first).toBeGreaterThanOrEqual(0);
			const base = hashState(runReplay(live.recording, live.config, first + 1));

			// Its FIRE bit: that volley doesn't happen on that tick.
			const noFire = [...frames];
			noFire[first] = { ...noFire[first], buttons: bit32.bxor(noFire[first].buttons, Button.FIRE) };
			expect(hashState(runReplay({ ...live.recording, frames: noFire }, live.config, first + 1))).never.toBe(
				base,
			);
			// (Compared right after the changed tick: a run can later converge again, e.g. once the player is dead,
			// every bullet of that era has expired and the turrets have reset, which is an honest property of the game.)

			// The low bit of aimX on that same tick: the volley flies a hair differently. (aimX is a non-zero integer
			// in (-1000, 1000): JS `^ 1` on a negative int32 flips the same low bit as on its magnitude's two's
			// complement; emulate it exactly.)
			const aimed = [...frames];
			const ax = aimed[first].aimX;
			const flipped = ax >= 0 ? bit32.bxor(ax, 1) : -(bit32.bxor(-ax - 1, 1) + 1);
			aimed[first] = { ...aimed[first], aimX: flipped };
			expect(hashState(runReplay({ ...live.recording, frames: aimed }, live.config, first + 1))).never.toBe(base);
		});

		it("a different dungeon config (no encounter) diverges: the run setup is part of the sim", () => {
			const noEncounter: SimConfig = { ...live.config, encounter: undefined };
			expect(hashState(runReplay(live.recording, noEncounter))).never.toBe(liveHash);
		});
	});
}
