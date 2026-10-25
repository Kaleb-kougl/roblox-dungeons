// Determinism of the E1.8 sword and bow (the default loadout) in real dungeons (ported from
// src/sim/weapons/swordBow.determinism.test.ts): the sandbox turrets plus a pack of test.chasers walking at the player
// in the first turret's room (piercing targets), seeded random input with FIRE, ALT (held in streaks long enough to
// charge the bow and to guard with the sword), SWAP, ROLL and aim, played live through the FixedStepLoop with irregular
// frames and recorded per tick. The replay must match bit for bit, at the end and at checkpoints; the run must really
// use every weapon feature (combo swings and finishers, guards, stream arrows, heavy arrows that pierce, bullets
// deleted by melee).
import { describe, expect, it } from "@rbxts/jest-globals";
import { hypot2, jsRound, stableSort } from "shared/jsmath";
import {
	KALEB_VALE_MVP_PARAMS,
	TEST_TURRET_KINDS,
	actorMover,
	bulletBlocker,
	circleMover,
	circleOverlapsWall,
	entranceSpawn,
	generateDungeon,
	placeEncounter,
	worldToGrid,
	type Dungeon,
	type EncounterOptions,
} from "shared/dungeon";
import "shared/sim/testing";
import {
	AXIS_MAX,
	BOW_DATA,
	BOW_V_HEAVY_TICK,
	Button,
	BulletPayload,
	DEFAULT_LOADOUT,
	FixedStepLoop,
	PLAYER_RADIUS,
	Recorder,
	Rng,
	SWORD_DATA,
	SWORD_FINISHER,
	SWORD_V_GUARD,
	SWORD_V_LAST,
	createSimState,
	hashState,
	runReplay,
	step,
	type InputFrame,
	type Recording,
	type SimConfig,
	type SimState,
} from "shared/sim";

const TICKS = 3600;
/** Test-only: a long life, so the run keeps fighting. */
const LONG_LIFE = 60;

/**
 * Pinned to the encounter this test was tuned with (E1.8 integration): the E1.6 sandbox turrets in the three rooms
 * nearest the entrance plus four test.chasers in the first of them. The game's DEFAULT_ENCOUNTER (room enemies, the
 * boss) is exercised with the sword and bow by enemies.determinism.spec.ts and combat.determinism.spec.ts ('game').
 */
const SANDBOX: EncounterOptions = { nearest: TEST_TURRET_KINDS };
const CHASER_TILES = [0, 3, 6, 9];

function weaponConfig(d: Dungeon): SimConfig {
	const first = placeEncounter(d, SANDBOX).spawns[0];
	const firstRoom = d.roomId[worldToGrid(first.z) * d.W + worldToGrid(first.x)];
	const encounter = placeEncounter(d, {
		...SANDBOX,
		populate: (room, tools) => {
			if (room.id !== firstRoom) return [];
			const floor = tools.floor();
			return CHASER_TILES.map((k) => floor[math.min(floor.size() - 1, k)]).map((t) => ({
				kind: "test.chaser",
				x: t.x,
				z: t.z,
			}));
		},
	});
	return {
		moveResolver: circleMover(d, PLAYER_RADIUS),
		actorMover: actorMover(d),
		isBulletBlocked: bulletBlocker(d),
		encounter,
	};
}

const SPAWN_OFFSETS: ReadonlyArray<readonly [number, number]> = [
	[2, 0],
	[-2, 0],
	[0, 2],
	[0, -2],
];

function spawnNearFirstActor(d: Dungeon, config: SimConfig): { x: number; z: number } {
	const t = config.encounter!.spawns[0];
	for (const [ox, oz] of SPAWN_OFFSETS) {
		if (!circleOverlapsWall(d, t.x + ox, t.z + oz, PLAYER_RADIUS)) return { x: t.x + ox, z: t.z + oz };
	}
	return entranceSpawn(d);
}

/** A twitchy player: aims at the nearest live actor most of the time, FIRE often, ALT in streaks, SWAP / ROLL now and then. */
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
			let buttons = 0;
			const alt = rng.next() < 0.3;
			hold = alt ? rng.int(10, 50) : rng.int(1, 20); // ALT streaks long enough to fully charge (36 ticks) sometimes
			if (alt) buttons = bit32.bor(buttons, Button.ALT);
			else if (rng.next() < 0.7) buttons = bit32.bor(buttons, Button.FIRE);
			if (rng.next() < 0.1) buttons = bit32.bor(buttons, Button.ROLL);
			if (rng.next() < 0.08) buttons = bit32.bor(buttons, Button.SWAP);
			if (rng.next() < 0.03) buttons = bit32.bor(buttons, Button.FLASK);
			let aimX = 0;
			let aimZ = 0;
			const p = s.player;
			const live = s.combat.actors.filter((t) => t.alive === 1);
			const target = stableSort(live, (a, b) => hypot2(a.x - p.x, a.z - p.z) - hypot2(b.x - p.x, b.z - p.z))[0];
			if (target !== undefined && rng.next() < 0.75) {
				let len = hypot2(target.x - p.x, target.z - p.z);
				if (len === 0) len = 1;
				aimX = jsRound(((target.x - p.x) / len) * AXIS_MAX);
				aimZ = jsRound(((target.z - p.z) / len) * AXIS_MAX);
			} else if (rng.next() < 0.5) {
				aimX = axis();
				aimZ = axis();
			}
			const moveX = rng.next() < 0.5 ? 0 : axis();
			const moveZ = rng.next() < 0.5 ? 0 : axis();
			current = { moveX, moveZ, aimX, aimZ, buttons };
		}
		hold--;
		return current;
	};
}

interface Counts {
	shots: number;
	heavy: number;
	pierced: number;
	swings: number;
	finishers: number;
	guards: number;
	deleted: number;
	swaps: number;
	enemyHits: number;
	kills: number;
}

interface LiveRun {
	state: SimState;
	config: SimConfig;
	recording: Recording;
	counts: Counts;
	hashes: Map<number, string>;
}

function runLive(d: Dungeon, seed: number): LiveRun {
	const config = weaponConfig(d);
	const spawn = spawnNearFirstActor(d, config);
	const deltaRng = new Rng(bit32.bxor(seed, 0x5b0e));
	const nextInput = makeInput(seed);
	const state = createSimState(seed, spawn.x, spawn.z, config);
	state.player.hearts = LONG_LIFE; // test-only: a long life, so the run keeps fighting
	state.player.heartsMax = LONG_LIFE;
	const recorder = new Recorder(seed, spawn.x, spawn.z);
	const loop = new FixedStepLoop();
	const c: Counts = {
		shots: 0,
		heavy: 0,
		pierced: 0,
		swings: 0,
		finishers: 0,
		guards: 0,
		deleted: 0,
		swaps: 0,
		enemyHits: 0,
		kills: 0,
	};
	const hashes = new Map<number, string>();
	const sword = state.combat.weapons.sets[0];
	const bow = state.combat.weapons.sets[1];
	const countPierced = (_i: number, _p: unknown, payload: number): boolean => {
		const pierce = BulletPayload.get(payload, "pierce");
		if (BulletPayload.get(payload, "lastHit") > 0 && pierce < BOW_DATA.heavyPierce) c.pierced++;
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
			c.shots += e.shotsFired;
			c.swings += e.meleeSwings;
			if (e.meleeSwings !== 0 && sword.v[SWORD_V_LAST] === SWORD_FINISHER) c.finishers++;
			if (sword.v[SWORD_V_GUARD] === SWORD_DATA.guardTicks - 1 && state.combat.weapons.activeSet === 0)
				c.guards++;
			if (bow.v[BOW_V_HEAVY_TICK] === state.tick) c.heavy++;
			c.deleted += e.bulletsDeleted;
			c.swaps += e.weaponSwapped;
			c.enemyHits += e.enemyHits;
			c.kills += e.enemiesKilled;
			state.combat.playerBullets.forEachActive(countPierced);
			if (state.tick % 600 === 0) hashes.set(state.tick, hashState(state));
		});
	}
	return { state, config, recording: recorder.getRecording(), counts: c, hashes };
}

/** runReplay with the same test-only poke the live run made at its start (hearts), applied before the first tick. */
function replay(recording: Recording, config: SimConfig, ticks = recording.frames.size()): SimState {
	const s = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, config);
	s.player.hearts = LONG_LIFE;
	s.player.heartsMax = LONG_LIFE;
	for (let t = 0; t < ticks; t++) step(s, recording.frames[t], config);
	return s;
}

/** Every live bullet of a simulation, as hashed (slot, position, velocity, life, payload, emitter). */
function bulletDump(s: SimState, which: "enemyBullets" | "playerBullets"): number[] {
	const out: number[] = [];
	s.combat[which].writeStateHash(out);
	return out;
}

for (const seed of [1337, 42]) {
	describe(`sword and bow replay deterministically in a dungeon (seed ${seed})`, () => {
		const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
		const live = runLive(d, seed);

		it("uses every feature: combos with finishers, guards, stream and heavy arrows, pierces, deleted bullets", () => {
			expect([...DEFAULT_LOADOUT]).toEqual(["weapon.sword", "weapon.bow"]);
			const c = live.counts;
			expect(live.state.tick).toBe(live.recording.frames.size());
			expect(live.state.tick).toBeGreaterThanOrEqual(TICKS);
			expect(c.swaps).toBeGreaterThan(3);
			expect(c.swings).toBeGreaterThan(10);
			expect(c.finishers).toBeGreaterThan(0);
			expect(c.guards).toBeGreaterThan(0);
			expect(c.shots).toBeGreaterThan(10);
			expect(c.heavy).toBeGreaterThan(0);
			expect(c.pierced).toBeGreaterThan(0); // tick-bullets of heavy arrows flying on after a hit
			expect(c.deleted).toBeGreaterThan(0);
			expect(c.enemyHits).toBeGreaterThan(10);
			expect(c.kills).toBeGreaterThan(0);
		});

		it("the replay reproduces the live state bit for bit (and at every 600-tick checkpoint)", () => {
			const fresh = weaponConfig(generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed }));
			const replayed = replay(live.recording, fresh);
			expect(hashState(replayed)).toBe(hashState(live.state));
			// Field group by field group first (a failure names the group), then the whole state like the source.
			expect([replayed.tick, replayed.rngState]).toEqual([live.state.tick, live.state.rngState]);
			expect(replayed.player).toEqual(live.state.player);
			expect(replayed.events).toEqual(live.state.events);
			expect(replayed.combat.actors).toEqual(live.state.combat.actors);
			expect(replayed.combat.weapons).toEqual(live.state.combat.weapons);
			expect(bulletDump(replayed, "enemyBullets")).toEqual(bulletDump(live.state, "enemyBullets"));
			expect(bulletDump(replayed, "playerBullets")).toEqual(bulletDump(live.state, "playerBullets"));
			expect(replayed).toEqual(live.state);
			for (let t = 600; t < TICKS; t += 600) {
				expect([t, hashState(replay(live.recording, live.config, t))]).toEqual([t, live.hashes.get(t)]);
			}
		});

		it("runReplay (no pokes) is deterministic too: two replays agree, and one ALT bit changes the outcome", () => {
			const a = runReplay(live.recording, live.config);
			const b = runReplay(live.recording, weaponConfig(generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed })));
			expect(hashState(a)).toBe(hashState(b));
			// Drop ALT on every tick: no heavy arrows / guards -> a different run.
			const noAlt: Recording = {
				...live.recording,
				frames: live.recording.frames.map((f) => ({
					...f,
					buttons: bit32.band(f.buttons, bit32.bnot(Button.ALT)),
				})),
			};
			expect(hashState(runReplay(noAlt, live.config))).never.toBe(hashState(a));
		});
	});
}
