// docs/NEW_ENEMIES.md NE2: the Bomber (`bomber`, band PORT_BAND_ENEMIES_2). The fuse (only a LIVING player within
// fuseTrigger lights it: never out of range, never on a dead solo player or a downed co-op one), the blast (exactly 12
// bullets of the port 12 @ FULL_RING row, from the fuse's end), the fizzle (shot before or during the fuse: nothing
// fires, an ordinary kill), the quiet death of a detonation (no points, no combo, no Vampire Fang, no drop roll, no
// Vengeful ring, no build procs, with every one of those configs on), breakables in blastBreakRadius, and a pinned
// determinism run. Hand-built open arenas (no dungeon).
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind, gridToWorld, worldToGrid, type BreakablePlacement } from "shared/dungeon";
import {
	AFFIXES_CONFIG,
	AiState,
	BOMBER,
	BOMBER_ATTACK_FUSE,
	BRUISER,
	BOMBER_BLAST_COUNT,
	BOMBER_DETONATED,
	BOMBER_FUSED,
	BOMBER_FUSE_LIT,
	BREAKABLES_CONFIG,
	BUILDS_CONFIG,
	COMBO_MIN,
	Boon,
	DEFAULT_BOUNDS,
	DEFAULT_SIM_CONFIG,
	DROPS_CONFIG,
	EMPTY_INPUT,
	FULL_RING,
	NOT_BROKEN,
	NO_BOOST,
	Relic,
	ScoreSource,
	SimCtx,
	archetypeIndex,
	createSimState,
	engage,
	grantRelic,
	hashState,
	partySize,
	playerAt,
	spawnActor,
	step,
	stepParty,
	type ActorState,
	type EndlessFloorWorld,
	type SimConfig,
	type SimState,
} from "shared/sim";

const SEED = 42;
const BOMBER_KIND = archetypeIndex(BOMBER.id);

/** Every player can't be hurt (bullets and bodies pass through); the run never ends. */
function ghost(s: SimState): void {
	for (let i = 0; i < partySize(s); i++) playerAt(s, i).hurtTicks = 1e6;
}

function put(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

/** An open endless arena (the greybox square, no rooms, stairs out of reach): run state, Vampire Fang, builds. */
function arena(floor: number): EndlessFloorWorld {
	return {
		floor,
		config: { bounds: DEFAULT_BOUNDS, encounter: { spawns: [], rooms: [], entranceRoom: -1, bossRoom: -1 } },
		bossFloor: false,
		spawnX: 0,
		spawnZ: 0,
		stairX: 1000,
		stairZ: 1000,
		roomSpawns: [],
		roomIdAt: () => -1,
	};
}

/** Scoring, builds, drops and affixes all on, in an endless run (so Vampire Fang runs too). */
const FULL: SimConfig = {
	endless: { runSeed: SEED, worldForFloor: arena },
	scoring: {},
	builds: BUILDS_CONFIG,
	drops: DROPS_CONFIG,
	affixes: AFFIXES_CONFIG,
};

/** The config a ctx binds to for `config` (the endless floor's world config, else `config`). */
function worldConfig(s: SimState, config: SimConfig): SimConfig {
	return config.endless !== undefined ? config.endless.worldForFloor(s.endless!.floor).config : config;
}

function ctxOf(s: SimState, config: SimConfig): SimCtx {
	return new SimCtx().bind(s, worldConfig(s, config), EMPTY_INPUT);
}

/** A Bomber at (x, z), engaged (it chases from the next tick on). */
function bomber(s: SimState, config: SimConfig, x: number, z: number, affix: number = AffixKind.NONE): ActorState {
	const a = spawnActor(ctxOf(s, config), BOMBER_KIND, x, z, affix);
	if (a === undefined) error("spawn failed", 0);
	engage(a);
	return a;
}

/** Kills `a` with player 0's damage (damageActor's kill line: score, procs, drops, Vengeful). */
function shoot(s: SimState, config: SimConfig, a: ActorState): void {
	const ctx = ctxOf(s, config);
	ctx.actingPlayer(0);
	ctx.damageActor(a, a.hp);
}

function dist(a: ActorState, x: number, z: number): number {
	return math.sqrt((a.x - x) * (a.x - x) + (a.z - z) * (a.z - z));
}

/** Steps until `done` (at most `max` ticks); returns the ticks stepped, -1 if it never happened. */
function runUntil(s: SimState, config: SimConfig, max: number, done: () => boolean): number {
	for (let t = 1; t <= max; t++) {
		step(s, EMPTY_INPUT, config);
		if (done()) return t;
	}
	return -1;
}

describe("bomber: data", () => {
	it("fuses 0.7 s within 1.6 under a 2.0 filling ring; blasts 12 @ FULL_RING from 0.6 out; breaks within 1.5", () => {
		const d = BOMBER.data;
		expect([d.fuseTrigger, d.fuseTicks, d.fuseRingRadius, d.blastBreakRadius]).toEqual([1.6, 42, 2, 1.5]);
		expect([d.blast.count, d.blast.spread, d.blast.radius]).toEqual([BOMBER_BLAST_COUNT, FULL_RING, 0.6]);
		expect(BOMBER_BLAST_COUNT).toBe(12);
		const ring = d.fx!.ring!;
		expect([ring.state, ring.radius, ring.fillTicks, ring.attack]).toEqual([
			AiState.TELEGRAPH,
			d.fuseRingRadius,
			d.fuseTicks,
			BOMBER_ATTACK_FUSE,
		]);
		expect([BOMBER_FUSE_LIT, BOMBER_DETONATED]).toEqual([1, 2]);
	});
});

describe("bomber: the fuse", () => {
	it("never lights out of range: held at fuseTrigger + 0.01 for 10 s; lights the tick it is within", () => {
		const config = DEFAULT_SIM_CONFIG;
		const s = createSimState(SEED, 0, 0, config);
		ghost(s);
		const a = bomber(s, config, 6, 0);
		const telegraphs0 = s.events.telegraphs;
		for (let t = 0; t < 600; t++) {
			put(s, 0, a.x - (BOMBER.data.fuseTrigger + 0.01), a.z);
			step(s, EMPTY_INPUT, config);
			expect([t, a.aiState, a.v[BOMBER_FUSED]]).never.toEqual([t, AiState.TELEGRAPH, a.v[BOMBER_FUSED]]);
		}
		expect([a.alive, a.v[BOMBER_FUSED], s.combat.enemySpawned]).toEqual([1, 0, 0]);
		expect(s.events.telegraphs).toBe(telegraphs0);
		// Exactly fuseTrigger away: it lights this tick.
		put(s, 0, a.x - BOMBER.data.fuseTrigger, a.z);
		step(s, EMPTY_INPUT, config);
		expect([a.aiState, a.attack, a.aiTicks, a.v[BOMBER_FUSED]]).toEqual([
			AiState.TELEGRAPH,
			BOMBER_ATTACK_FUSE,
			BOMBER.data.fuseTicks,
			BOMBER_FUSE_LIT,
		]);
		expect(s.events.telegraphs).toBe(1);
	});

	it("never lights on a dead solo player (it leashes instead)", () => {
		const config = DEFAULT_SIM_CONFIG;
		const s = createSimState(SEED, 0, 0, config);
		const a = bomber(s, config, 1, 0);
		s.player.dead = 1;
		s.player.hearts = 0;
		for (let t = 0; t < 300; t++) {
			step(s, EMPTY_INPUT, config);
			expect(a.aiState).never.toBe(AiState.TELEGRAPH);
		}
		expect([a.alive, a.v[BOMBER_FUSED], s.combat.enemySpawned]).toEqual([1, 0, 0]);
	});

	it("co-op: a downed player next to it never lights it; it runs on to the living one and fuses there", () => {
		const config: SimConfig = { ...DEFAULT_SIM_CONFIG, party: { size: 2 } };
		const s = createSimState(SEED, 0, 0, config);
		ghost(s);
		put(s, 0, 1, 0); // downed, 1 from the Bomber
		put(s, 1, -6, 0); // alive, 6 away
		const p0 = playerAt(s, 0);
		p0.dead = 1;
		p0.hearts = 0;
		const a = bomber(s, config, 0, 0);
		const inputs = [EMPTY_INPUT, EMPTY_INPUT];
		let litAt = -1;
		for (let t = 0; t < 300 && litAt < 0; t++) {
			const before = dist(a, -6, 0); // the fuse test runs on the tick-start position
			stepParty(s, inputs, config);
			if (a.aiState === AiState.TELEGRAPH) {
				litAt = t;
				expect(before <= BOMBER.data.fuseTrigger).toBe(true);
			} else expect(before > BOMBER.data.fuseTrigger).toBe(true);
		}
		expect(litAt > 0).toBe(true);
		expect(dist(a, -6, 0) <= BOMBER.data.fuseTrigger).toBe(true);
		expect(dist(a, 1, 0) > BOMBER.data.fuseTrigger).toBe(true);
	});

	it("a lit fuse is committed: the target walking away (or dying) does not stop the blast", () => {
		const config = DEFAULT_SIM_CONFIG;
		const s = createSimState(SEED, 0, 0, config);
		ghost(s);
		const a = bomber(s, config, 3, 0);
		expect(runUntil(s, config, 300, () => a.aiState === AiState.TELEGRAPH) > 0).toBe(true);
		const x = a.x;
		const z = a.z;
		put(s, 0, -20, 0);
		s.player.dead = 1;
		for (let t = 1; t < BOMBER.data.fuseTicks; t++) {
			step(s, EMPTY_INPUT, config);
			expect([t, a.alive, a.x, a.z, s.combat.enemySpawned]).toEqual([t, 1, x, z, 0]); // stands still
		}
		step(s, EMPTY_INPUT, config);
		expect([a.alive, a.v[BOMBER_FUSED], s.combat.enemySpawned]).toEqual([0, BOMBER_DETONATED, BOMBER_BLAST_COUNT]);
	});
});

describe("bomber: the blast and the quiet death", () => {
	it("fires exactly 12 bullets fuseTicks after lighting, then dies; scores 0, rolls nothing, procs nothing", () => {
		const s = createSimState(SEED, 0, 0, FULL);
		ghost(s);
		grantRelic(s, 0, Relic.VAMPIRE_FANG);
		s.builds!.players[0].levels[Boon.CHAIN_SPARK] = 1;
		const a = bomber(s, FULL, 4, 0, AffixKind.VENGEFUL);
		const drops0 = [s.drops!.rngState, s.drops!.killsSinceDrop];
		expect(runUntil(s, FULL, 300, () => a.aiState === AiState.TELEGRAPH) > 0).toBe(true);
		const litTick = s.tick;
		const blastTicks = runUntil(s, FULL, 300, () => a.alive === 0);
		expect(blastTicks).toBe(BOMBER.data.fuseTicks);
		expect(s.events.actorsKilled).toBe(1);
		expect(s.tick - litTick).toBe(BOMBER.data.fuseTicks);
		expect(s.combat.enemySpawned).toBe(BOMBER_BLAST_COUNT);
		expect(a.v[BOMBER_FUSED]).toBe(BOMBER_DETONATED);
		// Quiet: no points, no combo, no score pop; no Vampire Fang count; no drop roll; no Vengeful; no build proc.
		const sc = s.score!;
		expect([sc.total, sc.combo, sc.events.kills]).toEqual([0, COMBO_MIN, 0]);
		for (const n of sc.points) expect(n).toBe(0);
		expect(s.run!.players[0].fangKills).toBe(0);
		expect([s.drops!.rngState, s.drops!.killsSinceDrop]).toEqual(drops0);
		expect(s.affixes!.slots[s.combat.actors.indexOf(a)].vengeArmTick).toBe(-1);
		expect(s.builds!.procs.size()).toBe(0);
		expect(s.builds!.players[0].kills).toBe(0);
		// And nothing else ever fires: 3 s later still the blast's 12 (no Vengeful ring, no chain spark).
		for (let t = 0; t < 180; t++) step(s, EMPTY_INPUT, FULL);
		expect(s.combat.enemySpawned).toBe(BOMBER_BLAST_COUNT);
		expect(s.combat.playerBullets.activeCount).toBe(0);
		// (Grazes on the blast's bullets may score: the player's own points, never the kill's.)
		expect([sc.points[ScoreSource.KILLS], sc.counts[ScoreSource.KILLS], s.run!.players[0].fangKills]).toEqual([
			0, 0, 0,
		]);
	});

	it("the ring is the port's 12 @ FULL_RING with one bullet straight at the target, spawned 0.6 out", () => {
		const config = DEFAULT_SIM_CONFIG;
		const s = createSimState(SEED, 0, 0, config);
		ghost(s);
		const a = bomber(s, config, 0, 3);
		runUntil(s, config, 300, () => a.alive === 0);
		const b = s.combat.enemyBullets;
		expect(b.activeCount).toBe(BOMBER_BLAST_COUNT);
		// One flies straight at the player; every one starts blast.radius out (plus at most one tick of flight).
		const dirX = -a.x;
		const dirZ = -a.z;
		const dl = math.sqrt(dirX * dirX + dirZ * dirZ);
		let toward = 0;
		b.forEachActive((i, pos) => {
			const v = b.velocityAt(i);
			const sp = math.sqrt(v.x * v.x + v.z * v.z);
			if ((v.x * dirX + v.z * dirZ) / (sp * dl) > 1 - 1e-9) toward++;
			const r = dist(a, pos.x, pos.z);
			const r0 = BOMBER.data.blast.radius!;
			expect(r >= r0 - 1e-9 && r <= r0 + sp / 60 + 1e-9).toBe(true);
		});
		expect(toward).toBe(1);
	});

	it("a guaranteed drop room still counts a detonated member as gone (its last member pays, no roll)", () => {
		const s = createSimState(SEED, 0, 0, FULL);
		ghost(s);
		const a = bomber(s, FULL, 4, 0);
		s.drops!.guards.push({ kind: 1, ids: [a.id] });
		const roll0 = s.drops!.rngState;
		runUntil(s, FULL, 300, () => a.alive === 0);
		expect(s.drops!.guards.size()).toBe(0);
		expect(s.drops!.rngState).toBe(roll0);
		expect(s.drops!.ground.filter((g) => g.kind !== NO_BOOST).size()).toBe(1);
	});
});

describe("bomber: the fizzle (NED4)", () => {
	it("shot before the fuse: fires nothing, ever", () => {
		const config = DEFAULT_SIM_CONFIG;
		const s = createSimState(SEED, 0, 0, config);
		ghost(s);
		const a = bomber(s, config, 5, 0);
		for (let t = 0; t < 20; t++) step(s, EMPTY_INPUT, config);
		shoot(s, config, a);
		expect([a.alive, a.v[BOMBER_FUSED]]).toEqual([0, 0]);
		for (let t = 0; t < 240; t++) step(s, EMPTY_INPUT, config);
		expect(s.combat.enemySpawned).toBe(0);
	});

	it("shot mid-fuse: fires nothing, ever; the corpse keeps BOMBER_FUSE_LIT (the plain death)", () => {
		const config = DEFAULT_SIM_CONFIG;
		const s = createSimState(SEED, 0, 0, config);
		ghost(s);
		const a = bomber(s, config, 3, 0);
		runUntil(s, config, 300, () => a.aiState === AiState.TELEGRAPH);
		for (let t = 0; t < BOMBER.data.fuseTicks - 2; t++) step(s, EMPTY_INPUT, config);
		expect([a.alive, a.aiState]).toEqual([1, AiState.TELEGRAPH]);
		shoot(s, config, a);
		expect([a.alive, a.v[BOMBER_FUSED]]).toEqual([0, BOMBER_FUSE_LIT]);
		for (let t = 0; t < 240; t++) step(s, EMPTY_INPUT, config);
		expect(s.combat.enemySpawned).toBe(0);
	});

	it("a shot Bomber is an ordinary kill: points, combo, Vampire Fang, a drop roll, a build proc, Vengeful", () => {
		const s = createSimState(SEED, 0, 0, FULL);
		ghost(s);
		grantRelic(s, 0, Relic.VAMPIRE_FANG);
		s.builds!.players[0].levels[Boon.CHAIN_SPARK] = 1;
		const a = bomber(s, FULL, 4, 0, AffixKind.VENGEFUL);
		runUntil(s, FULL, 300, () => a.aiState === AiState.TELEGRAPH);
		const drops0 = [s.drops!.rngState, s.drops!.killsSinceDrop];
		shoot(s, FULL, a); // mid-fuse
		expect(a.alive).toBe(0);
		const sc = s.score!;
		expect(sc.total > 0).toBe(true);
		expect(sc.events.kills).toBe(1);
		expect(s.run!.players[0].fangKills).toBe(1);
		expect([s.drops!.rngState, s.drops!.killsSinceDrop]).never.toEqual(drops0);
		expect(s.builds!.procs.size()).toBe(1);
		expect(s.affixes!.slots[s.combat.actors.indexOf(a)].vengeArmTick).toBe(s.tick);
		for (let t = 0; t < 240; t++) step(s, EMPTY_INPUT, FULL);
		// Only Vengeful's ring ever fired (the blast never did).
		expect(s.combat.enemySpawned).toBe(BRUISER.data.ring.count);
	});
});

describe("bomber: breakables", () => {
	it("the blast breaks every intact piece within blastBreakRadius of its centre, the same tick, and no other", () => {
		// Player at the origin, Bomber coming in along +X: it lights about fuseTrigger out, on the X axis.
		// One piece next to where it stops (about (1.6, 0)), two more than blastBreakRadius from there.
		const cells: Array<[number, number]> = [
			[worldToGrid(2), worldToGrid(0)],
			[worldToGrid(4), worldToGrid(0)],
			[worldToGrid(2), worldToGrid(2.5)],
		];
		const pieces: BreakablePlacement[] = cells.map(([x, y]) => ({ x, y, kind: "crate" }));
		const config: SimConfig = { ...DEFAULT_SIM_CONFIG, breakables: { ...BREAKABLES_CONFIG, pieces } };
		const s = createSimState(SEED, 0, 0, config);
		ghost(s);
		const a = bomber(s, config, 7, 0);
		runUntil(s, config, 400, () => a.alive === 0);
		const r = BOMBER.data.blastBreakRadius;
		const blastTick = s.tick - 1; // state.tick counts up after the step
		let inside = 0;
		for (const p of s.breakables!.pieces) {
			const d = dist(a, gridToWorld(p.x), gridToWorld(p.y));
			if (d <= r) {
				inside++;
				expect([p.x, p.y, p.brokenTick]).toEqual([p.x, p.y, blastTick]);
			} else expect([p.x, p.y, p.brokenTick]).toEqual([p.x, p.y, NOT_BROKEN]);
		}
		expect(inside).toBe(1);
		expect(s.events.breakablesBroken).toBe(inside);
	});
});

describe("bomber: determinism", () => {
	interface Played {
		hashes: string[];
		/** Per death after a step: tick, actor id, v[BOMBER_FUSED], x, z. */
		deaths: number[][];
		s: SimState;
	}

	/** Three Bombers (one Swift, one shot mid-chase) at a strolling ghost player, affixes and scoring on, 12 s. */
	function play(): Played {
		const config: SimConfig = { ...DEFAULT_SIM_CONFIG, affixes: AFFIXES_CONFIG, scoring: {} };
		const s = createSimState(1234, 0, 0, config);
		ghost(s);
		bomber(s, config, 6, 2);
		bomber(s, config, -5, 5, AffixKind.SWIFT);
		const a2 = bomber(s, config, 2, -7);
		const hashes: string[] = [];
		const deaths: number[][] = [];
		for (let t = 0; t < 60 * 12; t++) {
			if (t % 120 === 60) put(s, 0, s.player.x + 2, s.player.z - 1);
			if (t === 40 && a2.alive === 1) shoot(s, config, a2);
			// A fresh one late, out of everyone's range (it idles).
			if (t === 400) spawnActor(ctxOf(s, config), BOMBER_KIND, 30, 30);
			step(s, EMPTY_INPUT, config);
			hashes.push(hashState(s));
			for (const a of s.combat.actors)
				if (a.kind === BOMBER_KIND && a.alive === 0 && a.deadTicks === 0)
					deaths.push([s.tick - 1, a.id, a.v[BOMBER_FUSED], a.x, a.z]);
		}
		return { hashes, deaths, s };
	}

	it("two runs from the same seed hash the same every tick; outcome pinned", () => {
		const one = play();
		const two = play();
		expect(one.hashes.size()).toBe(two.hashes.size());
		for (let t = 0; t < one.hashes.size(); t++)
			if (one.hashes[t] !== two.hashes[t]) expect([t, one.hashes[t]]).toEqual([t, two.hashes[t]]);
		expect(one.deaths).toEqual(two.deaths);
		// Pinned: the two unshot Bombers detonate (the Swift one later), the shot one never fires,
		// the late one idles; 24 bullets; no main-stream draw (rngState is still the seed's); the score is the shot kill
		// plus grazes on the blasts.
		const s = one.s;
		expect(one.deaths).toEqual([
			[105, 1, BOMBER_DETONATED, 2.2382843457680019, 0.55846831585994638],
			[129, 2, BOMBER_DETONATED, 0.75308397874054966, -0.13731047267090402],
		]);
		expect([s.combat.enemySpawned, s.score!.total, s.rngState]).toEqual([2 * BOMBER_BLAST_COUNT, 104, 1234]);
	});
});
