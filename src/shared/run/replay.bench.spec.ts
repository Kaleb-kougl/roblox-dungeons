// Server replay capacity (docs/SERVER.md "Replay capacity"): what one tick of the SERVER's replay costs on a deep
// endless floor in combat, solo and for an 8-player party. The server replays every live ranked run in real time
// (segment by segment through SegmentedValidator: stepRecorded + RunTelemetry.observe per tick, hashState at every
// SEGMENT_CHECKPOINT_TICKS checkpoint), so this per-tick cost bounds how many live players one server can verify.
//
// Setup (test-only shortcuts, none of them on the replay path being measured): debug-skip to floor 15 (each boon draft
// dismissed), Depth set to 3 before any room spawns (hp scales with it), then every player teleported onto the first
// spawn of the floor's most populated room and 600 ticks of combat measured: the room's enemies aggro and fire at full
// strength while the players strafe, roll and aim at them without killing them (so the fight never thins out), hearts
// topped up between ticks so nobody dies. Two scenarios: "room" (only that room entered: the typical fight) and
// "floor" (every room of the floor entered first, so the whole floor's enemies exist, up to MAX_ACTORS: the worst
// steady case, e.g. a party that ran through every room before turning to fight).
// The headless runner is a pessimistic host (bench.spec.ts: no Luau fast paths / native codegen in its sandbox).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AXIS_MAX,
	BOMBER,
	BOMBER_DETONATED,
	BOMBER_FUSED,
	Button,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	NO_KIND,
	START_HALF_HEARTS,
	archetypeIndex,
	countActors,
	createSimState,
	hashState,
	partySize,
	playerAt,
	step,
	stepParty,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { RunTelemetry, SEGMENT_CHECKPOINT_TICKS, buildEndlessRunConfig, type EndlessRunSetup } from "shared/run";
import { dismissDraft } from "shared/run/testing";

const SEED = 4242;
const FLOOR = 15;
const DEPTH = 3;
const WARMUP_TICKS = 120;
const MEASURE_TICKS = 600;
/** Generous on purpose (shared CI machines); the printed numbers are what docs/SERVER.md records. */
const BUDGET_MS_PER_TICK = 10;

function tickAll(s: SimState, config: Readonly<SimConfig>, frames: InputFrame[]): void {
	if (frames.size() === 1) step(s, frames[0], config);
	else stepParty(s, frames, config);
}

function same(n: number, f: InputFrame): InputFrame[] {
	const out: InputFrame[] = [];
	for (let i = 0; i < n; i++) out.push({ ...f });
	return out;
}

/** Debug-skips to `floor` (press, release), dismissing every draft. */
function skipTo(s: SimState, config: Readonly<SimConfig>, floor: number): void {
	const n = partySize(s);
	while (s.endless!.floor < floor) {
		tickAll(s, config, same(n, { ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON }));
		dismissDraft(s);
		tickAll(s, config, same(n, EMPTY_INPUT));
	}
}

/** The floor's room with the most deferred spawns. */
function busiestRoom(setup: EndlessRunSetup, floor: number): number {
	const w = setup.endlessFloor(floor);
	let best = -1;
	for (let id = 0; id < w.roomSpawns.size(); id++) {
		if (best < 0 || w.roomSpawns[id].size() > w.roomSpawns[best].size()) best = id;
	}
	return best;
}

/** Player i's frame: strafe, aim at the nearest enemy, roll now and then (no attacks: the room stays full). */
function fighter(s: SimState, i: number): InputFrame {
	const p = playerAt(s, i);
	let best = math.huge;
	let ax = 0;
	let az = 0;
	for (const a of s.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const dx = a.x - p.x;
		const dz = a.z - p.z;
		const d2 = dx * dx + dz * dz;
		if (d2 < best) {
			best = d2;
			ax = dx;
			az = dz;
		}
	}
	const len = math.sqrt(ax * ax + az * az);
	const t = s.tick + i * 17;
	return {
		moveX: math.floor(t / 30) % 2 === 0 ? 400 : -400,
		moveZ: 0,
		aimX: len > 0 ? math.round((ax / len) * AXIS_MAX) : AXIS_MAX,
		aimZ: len > 0 ? math.round((az / len) * AXIS_MAX) : 0,
		buttons: t % 90 === 0 ? Button.ROLL : 0,
	};
}

interface BenchResult {
	readonly stepUs: number;
	readonly p99Us: number;
	readonly hashUs: number;
	readonly perTickUs: number;
	readonly actors: number;
	readonly enemyBullets: number;
	readonly playerBullets: number;
}

function bench(players: number, wholeFloor: boolean): BenchResult {
	const setup = buildEndlessRunConfig(SEED, players);
	const spawn = setup.spawn!;
	const s = createSimState(SEED, spawn.x, spawn.z, setup.config);
	skipTo(s, setup.config, FLOOR);
	expect(s.endless!.floor).toBe(FLOOR);
	s.endless!.depth = DEPTH; // test-only: as if two bosses had died on the way down
	const world = setup.endlessFloor(FLOOR);
	const place = (x: number, z: number) => {
		for (let i = 0; i < players; i++) {
			const p = playerAt(s, i);
			p.x = x;
			p.z = z;
			p.prevX = x;
			p.prevZ = z;
		}
	};
	// "floor": every room entered once, so the whole floor's enemies exist (idle / leashed outside the fight).
	for (let id = 0; wholeFloor && id < world.roomSpawns.size(); id++) {
		const spawns = world.roomSpawns[id];
		if (spawns.size() === 0) continue;
		place(spawns[0].x, spawns[0].z);
		tickAll(s, setup.config, same(players, EMPTY_INPUT));
	}
	const room = busiestRoom(setup, FLOOR);
	const first = world.roomSpawns[room][0];
	place(first.x, first.z);
	const telemetry = new RunTelemetry(START_HALF_HEARTS);
	const frames = (): InputFrame[] => {
		const out: InputFrame[] = [];
		for (let i = 0; i < players; i++) out.push(fighter(s, i));
		return out;
	};
	const topUp = () => {
		for (let i = 0; i < players; i++) {
			const p = playerAt(s, i);
			p.hearts = p.heartsMax;
		}
	};
	for (let k = 0; k < WARMUP_TICKS; k++) {
		topUp();
		tickAll(s, setup.config, frames());
	}
	expect(s.endless!.roomsEntered[room]).toBe(1);
	const before = countActors(s.combat).alive;
	const startIds = s.combat.actors.map((a) => (a.kind !== NO_KIND && a.alive !== 0 ? a.id : -1));
	// Slots whose Bomber blew itself up during the measurement (docs/NEW_ENEMIES.md NE2: its blast is its own quiet
	// death, no player kill; seen on the busiest room's bombers since the merge of solid decor). Read every tick: the
	// corpse may be reaped before the end.
	const bomber = archetypeIndex(BOMBER.id);
	const detonated = new Set<number>();
	const times: number[] = [];
	let actors = 0;
	let enemyBullets = 0;
	let playerBullets = 0;
	let hashTime = 0;
	let hashes = 0;
	for (let k = 0; k < MEASURE_TICKS; k++) {
		topUp();
		const input = frames();
		const t0 = os.clock();
		tickAll(s, setup.config, input);
		telemetry.observe(s);
		times.push(os.clock() - t0);
		if (s.tick % SEGMENT_CHECKPOINT_TICKS === 0 || k === 0) {
			const h0 = os.clock();
			hashState(s);
			hashTime += os.clock() - h0;
			hashes++;
		}
		actors += countActors(s.combat).present;
		for (let i = 0; i < startIds.size(); i++) {
			const a = s.combat.actors[i];
			if (startIds[i] >= 0 && a.id === startIds[i] && a.kind === bomber && a.v[BOMBER_FUSED] === BOMBER_DETONATED)
				detonated.add(i);
		}
		enemyBullets += s.combat.enemyBullets.activeCount;
		playerBullets += s.combat.playerBullets.activeCount;
	}
	const mean = times.reduce((a, b) => a + b, 0) / times.size();
	times.sort();
	const hashUs = (hashTime / hashes) * 1e6;
	// Nobody killed: every actor alive at the start still is, so the fight stayed at full size, except a Bomber that blew
	// itself up (its own death, not a kill). The count itself may grow: a summoner (docs/ENEMY_VARIANTS.md EV4, in the
	// room pool from floor 6 since EV5) calls swarmers mid-fight. Counted alive, not present: a corpse from the warm-up
	// (a Bomber that blew itself up, docs/NEW_ENEMIES.md NE2; in the room pool since NE7) may be reaped during the
	// measurement.
	for (let i = 0; i < startIds.size(); i++) {
		if (startIds[i] < 0 || detonated.has(i)) continue;
		const a = s.combat.actors[i];
		expect([i, a.id, a.alive !== 0]).toEqual([i, startIds[i], true]);
	}
	expect(countActors(s.combat).alive + detonated.size() >= before).toBe(true);
	return {
		stepUs: mean * 1e6,
		p99Us: times[math.min(times.size() - 1, math.floor(times.size() * 0.99))] * 1e6,
		hashUs,
		perTickUs: mean * 1e6 + hashUs / SEGMENT_CHECKPOINT_TICKS,
		actors: actors / MEASURE_TICKS,
		enemyBullets: enemyBullets / MEASURE_TICKS,
		playerBullets: playerBullets / MEASURE_TICKS,
	};
}

describe("server replay cost on a deep endless floor", () => {
	for (const [players, wholeFloor] of [
		[1, false],
		[8, false],
		[1, true],
		[8, true],
	] as const) {
		const scenario = wholeFloor ? "floor" : "room";
		it(`${players} player(s), floor ${FLOOR}, Depth ${DEPTH}, ${scenario}: a populated room in combat`, () => {
			const r = bench(players, wholeFloor);
			print(
				string.format(
					"[replay bench] %s %d player(s) floor %d depth %d: %.1f actors, %.0f enemy / %.0f player bullets; " +
						"step+telemetry mean %.1f us (p99 %.1f us), hashState %.1f us every %d ticks -> %.1f us " +
						"(%.3f ms) per replayed tick, %.3f ms per player-tick",
					scenario,
					players,
					FLOOR,
					DEPTH,
					r.actors,
					r.enemyBullets,
					r.playerBullets,
					r.stepUs,
					r.p99Us,
					r.hashUs,
					SEGMENT_CHECKPOINT_TICKS,
					r.perTickUs,
					r.perTickUs / 1000,
					r.perTickUs / 1000 / players,
				),
			);
			expect(r.actors).toBeGreaterThan(0);
			expect(r.perTickUs / 1000).toBeLessThan(BUDGET_MS_PER_TICK);
		});
	}
});
