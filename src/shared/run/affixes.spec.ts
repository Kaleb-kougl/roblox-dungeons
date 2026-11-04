// Elite affixes end to end (docs/ENEMY_VARIANTS.md EV7): every endless world sets SimConfig.affixes (solo and co-op),
// floors carry roomAffixes, the `affixes` hash group is appended last, the affix par is in the room records from floor
// start, and an honest recorded run that fights an affixed elite room deep in the descent replays to the identical hash
// twice (determinism), survives the binary recording round trip, and validates through the server's
// SegmentedValidator segment by segment.
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind, encounterCost, type ActorSpawn } from "shared/dungeon";
import {
	AFFIXES_CONFIG,
	AFFIXES_SUBSYSTEM,
	BUILDS_SUBSYSTEM,
	AFFIX_PAR_COST,
	Button,
	DROPS_SUBSYSTEM,
	GOLDEN_SUBSYSTEM,
	PELLETS_SUBSYSTEM,
	TREASURE_SUBSYSTEM,
	PACTS_SUBSYSTEM,
	NO_KIND,
	ROOM_PAR_BASE_TICKS,
	ROOM_PAR_TICKS_PER_COST,
	SIM_DT,
	archetypeAt,
	createSimState,
	decodeRecording,
	encodeRecording,
	hashLayout,
	hashState,
	runReplay,
	type ActorState,
	type InputFrame,
} from "shared/sim";
import { LiveRun, RANKED_WORLD_KIND } from "shared/play";
import {
	DEFAULT_RUN_LIMITS,
	DEFAULT_SEGMENT_LIMITS,
	SegmentedValidator,
	buildEndlessRunConfig,
	buildWorldSetup,
	type RunSegment,
	type SegmentVerdict,
	type SegmentedRunResult,
} from "shared/run";
import { Driver, distanceField, frame, walkDir, type Field } from "shared/run/testing";

describe("endless worlds carry affixes", () => {
	it("solo and co-op configs set AFFIXES_CONFIG; floors carry roomAffixes; the group is hashed before builds, pellets, treasure, pacts, golden", () => {
		for (const n of [1, 3]) {
			const setup = buildEndlessRunConfig(1337, n);
			expect(setup.config.affixes).toBe(AFFIXES_CONFIG);
			const f1 = setup.endlessFloor(1);
			expect(f1.roomAffixes).toBe(f1.layout.roomAffixes);
			const s = createSimState(1337, f1.spawnX, f1.spawnZ, setup.config);
			const names = hashLayout(s).groups.map((g) => g.name);
			// docs/BUILDS.md BU1: builds is appended after it; docs/PELLETS.md PL5: pellets after builds; docs/TREASURE.md
			// TR5: treasure after pellets; docs/FORTUNE.md PS5 / GE3: pacts after treasure, then golden (last).
			expect(names[names.size() - 1]).toBe(GOLDEN_SUBSYSTEM);
			expect(names[names.size() - 2]).toBe(PACTS_SUBSYSTEM);
			expect(names[names.size() - 3]).toBe(TREASURE_SUBSYSTEM);
			expect(names[names.size() - 4]).toBe(PELLETS_SUBSYSTEM);
			expect(names[names.size() - 5]).toBe(BUILDS_SUBSYSTEM);
			expect(names[names.size() - 6]).toBe(AFFIXES_SUBSYSTEM);
			expect(names[names.size() - 7]).toBe(DROPS_SUBSYSTEM);
		}
	});

	it("par: + ROOM_PAR_TICKS_PER_COST x AFFIX_PAR_COST per affixed planned member, fixed at floor start", () => {
		const setup = buildEndlessRunConfig(4242);
		const f = setup.endlessFloor(12);
		// Room records as createSimState / the floor transition build them, on a state that starts on floor 12.
		const live = createSimState(4242, f.spawnX, f.spawnZ, {
			...setup.config,
			endless: { runSeed: 4242, worldForFloor: () => f },
		});
		let affixed = 0;
		for (const r of live.score!.rooms) {
			const spawns: ReadonlyArray<ActorSpawn> = f.roomSpawns[r.room];
			let par = ROOM_PAR_BASE_TICKS;
			for (let i = 0; i < spawns.size(); i++) {
				par += ROOM_PAR_TICKS_PER_COST * encounterCost(spawns[i].kind);
				if (f.roomAffixes![r.room][i] !== AffixKind.NONE) {
					par += ROOM_PAR_TICKS_PER_COST * AFFIX_PAR_COST;
					affixed++;
				}
			}
			expect([r.room, r.parTicks]).toEqual([r.room, par]);
		}
		expect(affixed > 0).toBe(true);
	});
});

// ---------------------------------------------------------------------------------------------
// An honest affixed run

/** The deepest floor the bot skips to (every affix is unlocked there) and how long it fights. */
const FLOOR = 9;
const FIGHT_TICKS = 2400;
const WALK_TICKS = 3000;
const MELEE_RANGE = 1.2;
const SEGMENT_TICKS = 900;

function unit(dx: number, dz: number): [number, number] {
	const len = math.sqrt(dx * dx + dz * dz);
	return len > 1e-9 ? [dx / len, dz / len] : [0, 0];
}

/** -0 axes as 0, like every real client's quantizeAxis (the binary codecs carry integers). */
function clean(f: InputFrame): InputFrame {
	const o = { ...f };
	if (o.moveX === 0) o.moveX = 0;
	if (o.moveZ === 0) o.moveZ = 0;
	if (o.aimX === 0) o.aimX = 0;
	if (o.aimZ === 0) o.aimZ = 0;
	return o;
}

/** The first run seed whose floor FLOOR has an elite room holding an affix of each of `kinds` (searching 1..). */
function pickSeed(kinds: ReadonlyArray<number>): [number, number] {
	for (let seed = 1; seed <= 200; seed++) {
		const f = buildEndlessRunConfig(seed).endlessFloor(FLOOR);
		const rooms = f.config.encounter!.rooms;
		for (let id = 0; id < f.roomSpawns.size(); id++) {
			if (rooms[id].type !== "elite") continue;
			const row = f.roomAffixes![id];
			if (kinds.every((k) => row.includes(k))) return [seed, id];
		}
	}
	error("no seed", 0);
}

interface AffixRun {
	readonly seed: number;
	readonly drv: Driver;
	readonly stamped: number;
	readonly affixedKills: number;
	readonly shieldHits: number;
	readonly vengefulFired: number;
	readonly finalHash: string;
}

function playAffixRun(): AffixRun {
	const [seed, roomId] = pickSeed([AffixKind.SHIELDED]);
	const setup = buildEndlessRunConfig(seed);
	const drv = new Driver(setup, seed);
	const send = (f: InputFrame) => drv.tick(clean(f));
	while (drv.floor() < FLOOR && drv.state.player.dead === 0) {
		drv.skipFloor();
	}
	const w = drv.world();
	const target = w.roomSpawns[roomId][0];
	const field: Field = distanceField(w.dungeon, target.x, target.z);
	let n = 0;
	while (n < WALK_TICKS && drv.state.endless!.roomsEntered[roomId] === 0 && drv.state.player.dead === 0) {
		const p = drv.state.player;
		const [mx, mz] = walkDir(field, p.x, p.z);
		send(frame(mx, mz, drv.assisted(0)));
		n++;
	}
	let stamped = 0;
	let affixedKills = 0;
	let shieldHits = 0;
	let vengefulFired = 0;
	for (const x of drv.state.affixes!.slots) if (x.affix !== AffixKind.NONE) stamped++;
	n = 0;
	while (n < FIGHT_TICKS && drv.state.player.dead === 0 && drv.floor() === FLOOR) {
		const p = drv.state.player;
		let best: ActorState | undefined;
		let bestD = math.huge;
		for (const a of drv.state.combat.actors) {
			if (a.kind === NO_KIND || a.alive === 0 || archetypeAt(a.kind).data.boss === true) continue;
			const d = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
			if (d < bestD) {
				bestD = d;
				best = a;
			}
		}
		if (best === undefined) break;
		const [ax, az] = unit(best.x - p.x, best.z - p.z);
		const near = bestD <= MELEE_RANGE * MELEE_RANGE;
		const [mx, mz] = near ? [0, 0] : walkDir(distanceField(w.dungeon, best.x, best.z), p.x, p.z);
		const affixedBefore = drv.state.affixes!.slots.map((x, i) =>
			x.affix !== AffixKind.NONE && drv.state.combat.actors[i].alive !== 0 ? 1 : 0,
		);
		send(frame(mx, mz, drv.assisted(Button.FIRE), ax, az));
		const ev = drv.state.affixes!.events;
		shieldHits += ev.shieldHits.size();
		vengefulFired += ev.vengefulFired.size();
		for (let i = 0; i < affixedBefore.size(); i++) {
			const a = drv.state.combat.actors[i];
			if (affixedBefore[i] === 1 && a !== undefined && a.alive === 0) affixedKills++;
		}
		n++;
	}
	return {
		seed,
		drv,
		stamped,
		affixedKills,
		shieldHits,
		vengefulFired,
		finalHash: hashState(drv.state),
	};
}

/** Drains the validator's queue; returns the segment verdicts and the run's result (if decided). */
function drain(v: SegmentedValidator): { verdicts: SegmentVerdict[]; result?: SegmentedRunResult } {
	const verdicts: SegmentVerdict[] = [];
	let result: SegmentedRunResult | undefined = v.getResult();
	while (v.hasWork()) {
		const r = v.advance(500);
		for (const x of r.verdicts) verdicts.push(x);
		result = r.result ?? result;
	}
	return { verdicts, result: result ?? v.getResult() };
}

describe("an honest endless run through an affixed elite room", () => {
	const run = playAffixRun();
	const recording = run.drv.recorder.getRecording();
	print(
		`[affixes] seed ${run.seed} floor ${run.drv.floor()} tick ${run.drv.state.tick}: ${
			run.stamped
		} affixed spawns, ` +
			`${run.affixedKills} affixed kills, ${run.shieldHits} shield hits, ${run.vengefulFired} vengeful rings; ` +
			`dead ${run.drv.state.player.dead}, score ${run.drv.state.score!.total}`,
	);

	it("stamped affixes on the room's planned spawns", () => {
		expect(run.stamped > 0).toBe(true);
	});

	it("replays twice to the live hash (deterministic)", () => {
		const a = runReplay(recording, buildEndlessRunConfig(run.seed).config);
		const b = runReplay(recording, buildEndlessRunConfig(run.seed).config);
		expect([hashState(a), hashState(b)]).toEqual([run.finalHash, run.finalHash]);
		expect(a.score!.total).toBe(run.drv.state.score!.total);
	});

	it("survives the binary recording round trip", () => {
		const decoded = decodeRecording(encodeRecording(recording), DEFAULT_RUN_LIMITS);
		expect(decoded.ok).toBe(true);
		if (!decoded.ok) return;
		expect(decoded.recording.frames.size()).toBe(recording.frames.size());
		expect(hashState(runReplay(decoded.recording, buildEndlessRunConfig(run.seed).config))).toBe(run.finalHash);
	});

	it("validates segment by segment (SegmentedValidator, debug input allowed for the floor skips)", () => {
		const world = buildWorldSetup(RANKED_WORLD_KIND, run.seed, { atBossDoor: false });
		const live = new LiveRun({
			seed: run.seed,
			spawnX: world.spawn!.x,
			spawnZ: world.spawn!.z,
			config: world.config,
			atBossDoor: false,
			runId: "affix-run",
			segmentCutAfterTick: (s) => s.tick % SEGMENT_TICKS === 0,
		});
		const v = new SegmentedValidator({
			runId: "affix-run",
			seed: run.seed,
			worldKind: RANKED_WORLD_KIND,
			setup: buildWorldSetup(RANKED_WORLD_KIND, run.seed, { atBossDoor: false }),
			createdAt: 0,
			limits: { ...DEFAULT_SEGMENT_LIMITS, allowDebugInput: true },
		});
		const verdicts: SegmentVerdict[] = [];
		let sent = 0;
		const late = 1e9;
		const pump = () => {
			for (const seg of live.takeSegments()) {
				const offered: RunSegment = seg;
				sent++;
				expect(v.offer(offered, late).ok).toBe(true);
			}
			for (const x of drain(v).verdicts) {
				verdicts.push(x);
				if (x.ok) live.releaseVerifiedFrames(x.endTick);
			}
		};
		for (const f of recording.frames) {
			live.frame(SIM_DT, f);
			pump();
		}
		expect(hashState(live.state)).toBe(run.finalHash);
		const final = live.final()!;
		pump();
		const result = v.finish(final, late) ?? drain(v).result;
		expect(sent > 1).toBe(true);
		for (const x of verdicts) expect([x.index, x.ok, x.code]).toEqual([x.index, true, undefined]);
		expect(result?.reason).toBe(undefined);
		expect(result?.ok).toBe(true);
		expect(result?.serverHash).toBe(run.finalHash);
	});
});
