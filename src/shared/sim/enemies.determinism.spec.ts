// E1.8 room enemies, determinism in the real game setup (source: src/sim/actors/archetypes/enemies.determinism.test.ts):
// the default encounter (swarmer packs, snipers, bruisers on the critical path) in seeds 1337 and 42; a seeded "player"
// walks the critical path from the entrance toward the boss room (grid BFS), stops to fight whatever engages it (aim at
// the nearest live enemy, FIRE, ROLL, FLASK, SWAP at random), for 3,600 ticks through a FixedStepLoop with irregular
// frames. The recorded run replayed with runReplay must give the identical state (hash and deep equality, both bullet
// simulations included) and match at checkpoints. Plus the source's docs/M1.md "Tuning notes" walker table.
//
// The walker is test code but its decisions feed the recording, so its JS-isms are ported exactly: Math.hypot ->
// hypot2 (V8's algorithm), Math.round -> jsRound, `^` -> bit32.bxor.
import { describe, expect, it } from "@rbxts/jest-globals";
import { hypot2, jsRound } from "shared/jsmath";
import {
	DEFAULT_ENCOUNTER,
	KALEB_VALE_MVP_PARAMS,
	actorMover,
	bulletBlocker,
	circleMover,
	entranceSpawn,
	generateDungeon,
	isWalkable,
	placeEncounter,
	worldToGrid,
	type Dungeon,
} from "shared/dungeon";
import {
	AXIS_MAX,
	AiState,
	Button,
	FixedStepLoop,
	NO_KIND,
	PLAYER_RADIUS,
	Recorder,
	Rng,
	V_AGGRO,
	archetypeAt,
	createSimState,
	hashState,
	runReplay,
	step,
	type InputFrame,
	type Recording,
	type SimConfig,
	SWORD_DATA,
	type SimState,
	WEB_SWORD_TIMINGS,
} from "shared/sim";

const TICKS = 3600;

function gameConfig(d: Dungeon, loadout?: ReadonlyArray<string | undefined>): SimConfig {
	return {
		moveResolver: circleMover(d, PLAYER_RADIUS),
		actorMover: actorMover(d),
		isBulletBlocked: bulletBlocker(d),
		encounter: placeEncounter(d, DEFAULT_ENCOUNTER),
		loadout,
	};
}

/** Tile distance to the boss room's center over walkable tiles (8-neighbour BFS, no corner cutting). */
function distanceToBoss(d: Dungeon, config: SimConfig): number[] {
	const dist: number[] = [];
	for (let i = 0; i < d.W * d.H; i++) dist.push(-1);
	const boss = config.encounter!.rooms[d.boss];
	const start = worldToGrid(boss.cz) * d.W + worldToGrid(boss.cx);
	const queue = [start];
	dist[start] = 0;
	const walk = (gx: number, gy: number): boolean =>
		gx >= 0 && gy >= 0 && gx < d.W && gy < d.H && isWalkable(d, gx, gy);
	let q = 0;
	while (q < queue.size()) {
		const c = queue[q];
		q++;
		const cx = c % d.W;
		const cy = (c - cx) / d.W;
		for (let oy = -1; oy <= 1; oy++) {
			for (let ox = -1; ox <= 1; ox++) {
				if (ox === 0 && oy === 0) continue;
				const nx = cx + ox;
				const ny = cy + oy;
				if (!walk(nx, ny) || (ox !== 0 && oy !== 0 && (!walk(cx + ox, cy) || !walk(cx, cy + oy)))) continue;
				const n = ny * d.W + nx;
				if (dist[n] >= 0) continue;
				dist[n] = dist[c] + 1;
				queue.push(n);
			}
		}
	}
	return dist;
}

/** The seeded player: walks the BFS gradient to the boss room unless an engaged enemy is near, then fights. */
function makePlayer(seed: number, d: Dungeon, toBoss: number[]): (s: SimState) => InputFrame {
	const rng = new Rng(seed);
	let current: InputFrame = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, buttons: 0 };
	let hold = 0;
	const axis = (): number => {
		// Source: `[0, 707, -707, AXIS_MAX, -AXIS_MAX, rng.int(-AXIS_MAX, AXIS_MAX)][rng.int(0, 5)]`: the analog value
		// is drawn first (array literal), then the index.
		const analog = rng.int(-AXIS_MAX, AXIS_MAX);
		const choices = [0, 707, -707, AXIS_MAX, -AXIS_MAX, analog];
		return choices[rng.int(0, 5)];
	};
	return (s: SimState): InputFrame => {
		if (hold > 0) {
			hold--;
			return current;
		}
		hold = rng.int(1, 12);
		const p = s.player;
		let nearest = -1;
		let best = math.huge;
		let engagedNear = false;
		const actors = s.combat.actors;
		for (let i = 0; i < actors.size(); i++) {
			const a = actors[i];
			if (a.kind === NO_KIND || a.alive === 0) continue;
			const dd = hypot2(a.x - p.x, a.z - p.z);
			if (dd < best) {
				best = dd;
				nearest = i;
			}
			if (a.v[V_AGGRO] === 1 && dd < 7) engagedNear = true;
		}
		let moveX = axis();
		let moveZ = axis();
		if (!engagedNear || rng.next() < 0.25) {
			// Next tile down the BFS gradient.
			const gx = worldToGrid(p.x);
			const gy = worldToGrid(p.z);
			let bx = gx;
			let by = gy;
			for (let oy = -1; oy <= 1; oy++) {
				for (let ox = -1; ox <= 1; ox++) {
					const nx = gx + ox;
					const ny = gy + oy;
					const v = nx >= 0 && ny >= 0 && nx < d.W && ny < d.H ? toBoss[ny * d.W + nx] : -1;
					if (v >= 0 && v < toBoss[by * d.W + bx]) {
						bx = nx;
						by = ny;
					}
				}
			}
			const dx = bx - p.x;
			const dz = by - p.z;
			const h = hypot2(dx, dz);
			const len = h !== 0 ? h : 1; // `Math.hypot(dx, dz) || 1` (hypot is never NaN here)
			moveX = jsRound((dx / len) * AXIS_MAX);
			moveZ = jsRound((dz / len) * AXIS_MAX);
			hold = math.min(hold, 4);
		}
		let buttons = 0;
		if (rng.next() < 0.75) buttons = bit32.bor(buttons, Button.FIRE);
		if (engagedNear && rng.next() < 0.12) buttons = bit32.bor(buttons, Button.ROLL);
		if (rng.next() < 0.04) buttons = bit32.bor(buttons, Button.FLASK);
		if (rng.next() < 0.04) buttons = bit32.bor(buttons, Button.SWAP);
		let aimX = 0;
		let aimZ = 0;
		if (nearest >= 0 && best < 12) {
			const a = actors[nearest];
			aimX = jsRound(((a.x - p.x) / best) * AXIS_MAX);
			aimZ = jsRound(((a.z - p.z) / best) * AXIS_MAX);
		}
		current = { moveX, moveZ, aimX, aimZ, buttons };
		return current;
	};
}

interface LiveRun {
	d: Dungeon;
	state: SimState;
	config: SimConfig;
	recording: Recording;
	telegraphTicks: Map<string, number>;
	hitsBy: Map<string, number>;
	kills: number;
	enemyShots: number;
	maxEnemyBullets: number;
	hashes: Map<number, string>;
	closestToBoss: number;
	startToBoss: number;
	deathTick: number;
	firstHitTick: number;
	damageDealt: number;
	bulletsDeleted: number;
	bossEngaged: boolean;
}

function runLive(seed: number, loadout?: ReadonlyArray<string | undefined>): LiveRun {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
	const config = gameConfig(d, loadout);
	const spawn = entranceSpawn(d);
	const toBoss = distanceToBoss(d, config);
	const nextInput = makePlayer(bit32.bxor(seed, 0x5eed), d, toBoss);
	const deltaRng = new Rng(bit32.bxor(seed, 0xb011e7));
	const state = createSimState(seed, spawn.x, spawn.z, config);
	const recorder = new Recorder(seed, spawn.x, spawn.z);
	const loop = new FixedStepLoop();
	const telegraphTicks = new Map<string, number>();
	const hitsBy = new Map<string, number>();
	const hashes = new Map<number, string>();
	let kills = 0;
	let enemyShots = 0;
	let maxEnemyBullets = 0;
	let closestToBoss = math.huge;
	let deathTick = -1;
	let firstHitTick = -1;
	let damageDealt = 0;
	let bulletsDeleted = 0;
	let bossEngaged = false;
	while (recorder.size() < TICKS) {
		const r = deltaRng.next();
		const delta = r < 0.02 ? 0.25 + deltaRng.next() : (1 + deltaRng.next() * 7) / 240;
		const input = nextInput(state);
		loop.advance(delta, () => {
			recorder.record(input);
			step(state, input, config);
			const e = state.events;
			kills += e.actorsKilled;
			damageDealt += e.damageDealt;
			bulletsDeleted += e.bulletsDeleted;
			if (e.bossEngaged !== 0) bossEngaged = true;
			if (e.playerDied !== 0 && deathTick < 0) deathTick = state.tick - 1;
			if (e.playerHits > 0 && firstHitTick < 0) firstHitTick = state.tick - 1;
			if (e.playerHits > 0 && e.lastHitSource >= 0) {
				const id = archetypeAt(e.lastHitSource).id;
				hitsBy.set(id, (hitsBy.get(id) ?? 0) + 1);
			}
			for (const a of state.combat.actors) {
				if (a.kind !== NO_KIND && a.alive !== 0 && a.aiState === AiState.TELEGRAPH) {
					const id = archetypeAt(a.kind).id;
					telegraphTicks.set(id, (telegraphTicks.get(id) ?? 0) + 1);
				}
			}
			enemyShots = state.combat.enemySpawned;
			maxEnemyBullets = math.max(maxEnemyBullets, state.combat.enemyBullets.activeCount);
			const p = state.player;
			const g = toBoss[worldToGrid(p.z) * d.W + worldToGrid(p.x)];
			if (g >= 0) closestToBoss = math.min(closestToBoss, g);
			if (state.tick % 600 === 0) hashes.set(state.tick, hashState(state));
		});
	}
	return {
		d,
		state,
		config,
		recording: recorder.getRecording(),
		telegraphTicks,
		hitsBy,
		kills,
		enemyShots,
		maxEnemyBullets,
		hashes,
		closestToBoss,
		startToBoss: toBoss[worldToGrid(spawn.z) * d.W + worldToGrid(spawn.x)],
		deathTick,
		firstHitTick,
		damageDealt,
		bulletsDeleted,
		bossEngaged,
	};
}

function describeMap(m: Map<string, number>): string {
	const parts: string[] = [];
	for (const [k, v] of m) parts.push(`${k}=${v}`);
	return `{${parts.join(", ")}}`;
}

for (const seed of [1337, 42]) {
	describe(`room enemies replay deterministically (seed ${seed}, default encounter, walking the path)`, () => {
		const live = runLive(seed);
		const liveHash = hashState(live.state);

		it("really meets the room enemies: telegraphs, hits both ways, kills", () => {
			let hasBruiser = false;
			for (const sp of live.config.encounter!.spawns) if (sp.kind === "bruiser") hasBruiser = true;
			expect(live.closestToBoss).toBeLessThan(live.startToBoss * 0.6); // it got well along the path
			expect(live.telegraphTicks.get("swarmer") ?? 0).toBeGreaterThan(0);
			expect(live.telegraphTicks.get("sniper") ?? 0).toBeGreaterThan(0);
			if (seed === 1337) {
				expect(hasBruiser).toBe(true);
				expect(live.telegraphTicks.get("bruiser") ?? 0).toBeGreaterThan(0);
			}
			expect(live.kills).toBeGreaterThan(3);
			let hits = 0;
			for (const [, v] of live.hitsBy) hits += v;
			expect(hits).toBeGreaterThan(0);
			expect(live.enemyShots).toBeGreaterThan(5);
			expect(live.maxEnemyBullets).toBeLessThan(1000); // far inside the bullet budget
			print(
				`[room enemies] seed ${seed}: ${live.config.encounter!.spawns.size()} placed, ${live.kills} killed, ` +
					`telegraph ticks ${describeMap(live.telegraphTicks)}, player hits by ${describeMap(
						live.hitsBy,
					)}, ` +
					`${live.enemyShots} enemy bullets (max ${live.maxEnemyBullets} alive), player ${
						live.state.player.dead !== 0 ? "died" : "alive"
					}`,
			);
		});

		it("runReplay reproduces the live state bit for bit (hash and deep equality)", () => {
			const replayed = runReplay(live.recording, gameConfig(generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed })));
			expect(hashState(replayed)).toBe(liveHash);
			expect(replayed).toEqual(live.state);
		});

		it("matches at every checkpoint partway through", () => {
			for (let t = 600; t < TICKS; t += 600) {
				expect([t, hashState(runReplay(live.recording, live.config, t))]).toEqual([t, live.hashes.get(t)]);
			}
		});
	});
}

// E1.8 integration tuning notes (docs/M1.md "Tuning notes"): the same random path-walker with ONE real weapon. Not a
// balance gate (the walker fires at random and never dodges on purpose); it records how far each weapon gets and what
// hits the player, and checks both weapons really fight the room enemies.
const WALKERS: ReadonlyArray<{ label: string; loadout: ReadonlyArray<string> }> = [
	{ label: "sword only", loadout: ["weapon.sword", "weapon.sword"] }, // both sets: its random SWAP never empties the hand
	{ label: "bow only", loadout: ["weapon.bow", "weapon.bow"] },
];
for (const { label, loadout } of WALKERS) {
	describe(`room enemies vs the walker with the ${label}`, () => {
		for (const seed of [1337, 42]) {
			it(`seed ${seed}: kills enemies and records the outcome`, () => {
				const live = runLive(seed, loadout);
				const path = live.startToBoss - live.closestToBoss;
				print(
					`[room enemies / ${label}] seed ${seed}: ${live.kills} of ${
						live.config.encounter!.spawns.size() - 1
					} killed, ` +
						`${string.format("%.0f", live.damageDealt)} hp dealt, ${
							live.bulletsDeleted
						} bullets deleted, ` +
						`path ${path}/${live.startToBoss} tiles, first hit ${string.format(
							"%.1f",
							live.firstHitTick / 60,
						)} s, ` +
						`${
							live.deathTick >= 0
								? `died at ${string.format("%.1f", live.deathTick / 60)} s`
								: "alive at 60 s"
						}, hits by ${describeMap(live.hitsBy)}`,
				);
				expect(live.kills).toBeGreaterThan(0);
				expect(live.damageDealt).toBeGreaterThan(0);
			});
		}
	});
}

// ---------------------------------------------------------------------------------------------
// docs/M1.md "Tuning notes", "Room enemies vs the real weapons" (port addition: the source prints these, the doc
// records them). The table was measured at f8db062 with the PRE-retune sword (2 / 2 / 4 damage, 14-tick swings,
// 24-tick finisher recovery, 9-tick wind-up); b598156 retuned the sword and did not re-measure it. With SWORD_DATA set
// back to those numbers (and the web reach) every row reproduces exactly; with the current sword (the port's 20% slower
// timers and 15% longer swing / finisher reach, CLAUDE.md decision log) the bow rows still do (the bow is unchanged)
// and the current numbers are pinned below.

interface Outcome {
	readonly kills: number;
	readonly roomEnemies: number;
	readonly deathTick: number;
	readonly bulletsDeleted: number;
	readonly bossEngaged: boolean;
	readonly swarmerHits: number;
	readonly reachedBossRoom: boolean;
}

function outcome(live: LiveRun): Outcome {
	return {
		kills: live.kills,
		roomEnemies: live.config.encounter!.spawns.size() - 1,
		deathTick: live.deathTick,
		bulletsDeleted: live.bulletsDeleted,
		bossEngaged: live.bossEngaged,
		swarmerHits: live.hitsBy.get("swarmer") ?? 0,
		reachedBossRoom: live.closestToBoss === 0,
	};
}

/** Runs with the pre-retune sword numbers (f8db062), restoring the current ones afterwards. */
function withPreRetuneSword<T>(f: () => T): T {
	const saved = { ...SWORD_DATA };
	SWORD_DATA.damage = 2;
	SWORD_DATA.finisherDamage = 4;
	SWORD_DATA.swingRecoveryTicks = 14;
	SWORD_DATA.finisherWindupTicks = WEB_SWORD_TIMINGS.finisherWindupTicks;
	SWORD_DATA.finisherRecoveryTicks = 24;
	SWORD_DATA.reach = WEB_SWORD_TIMINGS.reach;
	SWORD_DATA.finisherReach = WEB_SWORD_TIMINGS.finisherReach;
	try {
		return f();
	} finally {
		SWORD_DATA.damage = saved.damage;
		SWORD_DATA.finisherDamage = saved.finisherDamage;
		SWORD_DATA.swingRecoveryTicks = saved.swingRecoveryTicks;
		SWORD_DATA.finisherWindupTicks = saved.finisherWindupTicks;
		SWORD_DATA.finisherRecoveryTicks = saved.finisherRecoveryTicks;
		SWORD_DATA.reach = saved.reach;
		SWORD_DATA.finisherReach = saved.finisherReach;
	}
}

/**
 * "died at N s" in the doc: the source prints the death time to one decimal (`(tick / 60).toFixed(1)`) and the doc
 * rounds that to whole seconds (29.5 -> "30 s").
 */
const diedAt = (o: Outcome, seconds: number): boolean =>
	o.deathTick >= 0 && jsRound(jsRound(o.deathTick / 6) / 10) === seconds;

const SWORD_ONLY = ["weapon.sword", "weapon.sword"];
const BOW_ONLY = ["weapon.bow", "weapon.bow"];

describe("docs/M1.md tuning table (walker vs room enemies, 60 s)", () => {
	it("sword only (pre-retune sword): 23 of 24 killed, reached the boss room, died at 28 s / 30 of 32, died at 42 s; 12-14 bullets deleted", () => {
		const [a, b] = withPreRetuneSword(() => [outcome(runLive(1337, SWORD_ONLY)), outcome(runLive(42, SWORD_ONLY))]);
		expect([a.kills, a.roomEnemies, a.reachedBossRoom, diedAt(a, 28)]).toEqual([23, 24, true, true]);
		expect([b.kills, b.roomEnemies, diedAt(b, 42)]).toEqual([30, 32, true]);
		for (const o of [a, b]) {
			expect(o.bulletsDeleted).toBeGreaterThanOrEqual(12);
			expect(o.bulletsDeleted).toBeLessThanOrEqual(14);
			expect(o.swarmerHits).toBeGreaterThanOrEqual(4); // "Swarmers land most hits (4-9 per run, every loadout)"
			expect(o.swarmerHits).toBeLessThanOrEqual(9);
		}
	});

	it("bow only: 17 of 24 killed, died at 30 s / 29 of 32 killed, died at 26 s (same with the current sword: no sword)", () => {
		const a = outcome(runLive(1337, BOW_ONLY));
		const b = outcome(runLive(42, BOW_ONLY));
		expect([a.kills, a.roomEnemies, diedAt(a, 30)]).toEqual([17, 24, true]);
		expect([b.kills, b.roomEnemies, diedAt(b, 26)]).toEqual([29, 32, true]);
		for (const o of [a, b]) {
			expect(o.swarmerHits).toBeGreaterThanOrEqual(4);
			expect(o.swarmerHits).toBeLessThanOrEqual(9);
		}
	});

	it("default (sword + bow, random SWAP; pre-retune sword): 22 of 24 / 32 of 32 killed, engaged the boss both times, then died", () => {
		const [a, b] = withPreRetuneSword(() => [outcome(runLive(1337)), outcome(runLive(42))]);
		expect([a.kills, a.roomEnemies, a.bossEngaged, a.deathTick >= 0]).toEqual([22, 24, true, true]);
		expect([b.kills, b.roomEnemies, b.bossEngaged, b.deathTick >= 0]).toEqual([32, 32, true, true]);
		for (const o of [a, b]) {
			expect(o.swarmerHits).toBeGreaterThanOrEqual(4);
			expect(o.swarmerHits).toBeLessThanOrEqual(9);
		}
	});

	it("the current sword (3 / 3 / 6; 14, 11, 25 ticks; reach 1.955 / 2.53: the port's retune): pinned outcomes of the same walkers", () => {
		const rows = [
			outcome(runLive(1337, SWORD_ONLY)),
			outcome(runLive(42, SWORD_ONLY)),
			outcome(runLive(1337)),
			outcome(runLive(42)),
		].map((o) => [o.kills, o.roomEnemies, o.deathTick, o.bulletsDeleted, o.bossEngaged]);
		// [kills, room enemies, death tick, bullets deleted, boss engaged]: sword only 1337 / 42, default 1337 / 42.
		expect(rows).toEqual([
			[20, 24, 1767, 17, true],
			[29, 32, 2397, 20, true],
			[24, 24, 1503, 50, true],
			[32, 32, 2752, 9, true],
		]);
	});
});
