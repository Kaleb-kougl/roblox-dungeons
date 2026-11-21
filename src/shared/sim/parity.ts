/**
 * Parity helpers for the golden-fixture specs (tasks 4, 6, 7): compare a live SimState against the web build's
 * labelled dumps (`dumps[].fields`, `[name, value, hex]`) and per-subsystem hashes, and report the FIRST difference by
 * name so a failure points at the field that diverged. Roblox-API-free (lives in the sim so specs anywhere reuse it).
 *
 * @module
 */

import {
	ENDLESS_HASH_SUBSYSTEM,
	HASH_SUBSYSTEMS,
	PARTY_SUBSYSTEM,
	RUN_SUBSYSTEM,
	SCORE_SUBSYSTEM,
	TUTORIAL_SUBSYSTEM,
	groupValues,
	hashLayout,
	type HashGroupName,
	type HashSubsystem,
} from "./hashLayout";
import { deserializeRecording, float64Hex, hashNumbers, hashState } from "./replay";
import { createSimState, eventDefault, SIM_EVENT_FIELDS, type SimEvents, type SimState } from "./state";
import { step, type SimConfig } from "./step";

/** A dump field as exported: `[name, value, hex]` (value may be "NaN" / "Infinity" / "-0" strings; hex is exact). */
export type DumpField = ReadonlyArray<string | number>;

/**
 * The first hashed field where a live state and a fixture dump disagree, by name or by bits (see `firstFieldMismatch`).
 */
export interface FieldMismatch {
	/** Position in hash order. */
	readonly index: number;
	/** The fixture's field name at that position (or "<missing>" past its end). */
	readonly expectedName: string;
	/** The port's field name at that position (or "<missing>"). */
	readonly actualName: string;
	/** The fixture's float64 bit pattern at that position, 16 hex digits most significant first (or "<missing>"). */
	readonly expectedHex: string;
	/** The port's float64 bit pattern at that position, same format (or "<missing>"). */
	readonly actualHex: string;
	/** The port's value (NaN when missing). */
	readonly actualValue: number;
}

const MISSING = "<missing>";

/**
 * First field where the state's labelled hash differs from a fixture dump (name or bits), or undefined when every
 * field matches and the counts agree.
 */
export function firstFieldMismatch(
	state: Readonly<SimState>,
	expected: ReadonlyArray<DumpField>,
): FieldMismatch | undefined {
	const layout = hashLayout(state, true);
	const n = math.max(expected.size(), layout.values.size());
	for (let i = 0; i < n; i++) {
		const e = expected[i];
		const expectedName = e !== undefined ? tostring(e[0]) : MISSING;
		const expectedHex = e !== undefined ? tostring(e[2]) : MISSING;
		const has = i < layout.values.size();
		const actualName = has ? layout.names[i] : MISSING;
		const actualHex = has ? float64Hex(layout.values[i]) : MISSING;
		if (expectedName !== actualName || expectedHex !== actualHex) {
			return {
				index: i,
				expectedName,
				actualName,
				expectedHex,
				actualHex,
				actualValue: has ? layout.values[i] : 0 / 0,
			};
		}
	}
	return undefined;
}

/** One line for a test failure message. */
export function describeMismatch(m: FieldMismatch): string {
	return (
		`field #${m.index}: expected ${m.expectedName} = ${m.expectedHex}, ` +
		`got ${m.actualName} = ${m.actualHex} (${tostring(m.actualValue)})`
	);
}

/**
 * Per-subsystem hashes of a state (fixtures' `subsystems`; plus `endless` and `run` in endless mode, `score` in
 * scored runs, `party` in co-op runs, `tutorial` in tutorial runs).
 */
export function subsystemHashes(state: Readonly<SimState>): Record<HashSubsystem, string> & {
	[ENDLESS_HASH_SUBSYSTEM]?: string;
	[SCORE_SUBSYSTEM]?: string;
	[RUN_SUBSYSTEM]?: string;
	[PARTY_SUBSYSTEM]?: string;
	[TUTORIAL_SUBSYSTEM]?: string;
} {
	const layout = hashLayout(state);
	const out = {} as Record<HashGroupName, string>;
	for (const g of layout.groups) out[g.name] = hashNumbers(groupValues(layout, g));
	return out;
}

/** Subsystem names in hash order (re-exported for specs). */
export const SUBSYSTEMS = HASH_SUBSYSTEMS;

/**
 * A fixture number: plain JSON numbers as they are, and the exporter's strings for values JSON cannot hold
 * ("NaN", "Infinity", "-Infinity", "-0"). Prefer a `*Hex` field when there is one (exact bits).
 */
export function fixtureNumber(v: number | string): number {
	if (typeIs(v, "number")) return v;
	if (v === "NaN") return 0 / 0;
	if (v === "Infinity") return math.huge;
	if (v === "-Infinity") return -math.huge;
	if (v === "-0") return -0;
	return error(`fixtureNumber: unexpected value ${v}`, 0);
}

// ---------------------------------------------------------------------------------------------
// Whole-run parity (fixtures/run-*.json)

/** A labelled state dump from a run fixture. */
export interface RunDump {
	/** Ticks stepped when the dump was taken (0 = the fresh state). */
	readonly tick: number;
	/** `hashState` of the web build's state at that tick, 8 lowercase hex digits. */
	readonly hash: string;
	/** The hash of each of the six fixture groups at that tick, 8 hex digits each. */
	readonly subsystems: { readonly [K in HashSubsystem]: string };
	/** How many hashed numbers the state had; the port's layout must have exactly as many. */
	readonly count: number;
	/** Every hashed number with its name, in hash order. */
	readonly fields: ReadonlyArray<DumpField>;
}

/** The parts of a run fixture the checker reads (fixtures/README.md "Run fixtures"). */
export interface RunFixture {
	/** The run's seed. The checker reads the one inside `recording`; this is the same value. */
	readonly seed: number;
	/** Where the player starts, world units. Also carried inside `recording`. */
	readonly spawn: { readonly x: number; readonly z: number };
	/** Ticks the web build stepped; the checker replays at most this many frames. */
	readonly ticks: number;
	/** The exact `serializeRecording` string of the run's inputs (run-length encoded JSON). */
	readonly recording: string;
	/** `hashes[t]` is `hashState` after t ticks; index 0 is the fresh state, so there are `ticks + 1` entries. */
	readonly hashes: ReadonlyArray<string>;
	/** `hashState` after the last tick (= `hashes[ticks]`). */
	readonly finalHash: string;
	/** Per fixture group, its hash on every `subsystemsEvery`-th tick: entry k is tick k x `subsystemsEvery`. */
	readonly subsystems: { readonly [K in HashSubsystem]: ReadonlyArray<string> };
	/** Tick stride of the `subsystems` arrays (1 in every exported run). */
	readonly subsystemsEvery: number;
	/** `[t, { field: value }]`: the non-default SimEvents after stepping tick t. */
	readonly events: ReadonlyArray<ReadonlyArray<unknown>>;
}

/**
 * What `checkRunFixture` found. A run matches when `hashMismatch` is undefined and the three mismatch lists are empty.
 */
export interface RunParityReport {
	/** Hash checks that passed (ticks 0..n, including the fresh state). */
	readonly ticksMatched: number;
	/** The first tick whose full hash differed, if any; the run stops there. */
	readonly hashMismatch?: string;
	/** Subsystem hash mismatches (only up to the first mismatching tick). */
	readonly subsystemMismatches: string[];
	/** Dump mismatches: the first differing named field of each dump, and count / hash disagreements. */
	readonly dumpMismatches: string[];
	/** First few event mismatches (events are not hashed; they help locate a divergence). */
	readonly eventMismatches: string[];
	/** Dump ticks that were compared. */
	readonly dumpsChecked: number[];
}

const MAX_EVENT_REPORTS = 5;

function nonDefaultEvents(e: Readonly<SimEvents>): Map<string, number> {
	const out = new Map<string, number>();
	for (const f of SIM_EVENT_FIELDS) if (e[f] !== eventDefault(f)) out.set(f, e[f]);
	return out;
}

function expectedEventsByTick(run: RunFixture): Map<number, Map<string, number>> {
	const byTick = new Map<number, Map<string, number>>();
	for (const entry of run.events) {
		const t = entry[0] as number;
		const fields = new Map<string, number>();
		for (const [k, v] of pairs(entry[1] as object)) fields.set(k as string, v as number);
		byTick.set(t, fields);
	}
	return byTick;
}

function describeEvents(m: Map<string, number> | undefined): string {
	if (m === undefined || m.size() === 0) return "{}";
	const parts: string[] = [];
	for (const f of SIM_EVENT_FIELDS) {
		const v = m.get(f);
		if (v !== undefined) parts.push(`${f}=${v}`);
	}
	return `{${parts.join(", ")}}`;
}

function eventsEqual(a: Map<string, number>, b: Map<string, number> | undefined): boolean {
	const bSize = b === undefined ? 0 : b.size();
	if (a.size() !== bSize) return false;
	for (const [k, v] of a) if (b === undefined || b.get(k) !== v) return false;
	return true;
}

function checkDump(state: Readonly<SimState>, dump: RunDump, out: string[]): void {
	const where = `dump @${dump.tick}`;
	const values = hashLayout(state).values;
	if (values.size() !== dump.count) out.push(`${where}: ${values.size()} fields, expected ${dump.count}`);
	const m = firstFieldMismatch(state, dump.fields);
	if (m !== undefined) out.push(`${where}: ${describeMismatch(m)}`);
	const hash = hashState(state);
	if (hash !== dump.hash) out.push(`${where}: hash ${hash}, expected ${dump.hash}`);
	const subs = subsystemHashes(state);
	for (const name of HASH_SUBSYSTEMS) {
		if (subs[name] !== dump.subsystems[name]) {
			out.push(`${where}: subsystem ${name} ${subs[name]}, expected ${dump.subsystems[name]}`);
		}
	}
}

/**
 * Replays a run fixture's recording through step() with `config` (the SAME object for creation and every step) and
 * compares, tick by tick: the full hash, every subsystem hash (on `subsystemsEvery` ticks), the per-tick events, and
 * each dump field by field. Stops at the first full-hash mismatch, after recording what differs there.
 */
export function checkRunFixture(
	run: RunFixture,
	config: Readonly<SimConfig>,
	dumps: ReadonlyArray<RunDump> = [],
): RunParityReport {
	const recording = deserializeRecording(run.recording);
	const state = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, config);
	const expectedEvents = expectedEventsByTick(run);
	const dumpByTick = new Map<number, RunDump>();
	for (const d of dumps) dumpByTick.set(d.tick, d);
	const report = {
		ticksMatched: 0,
		hashMismatch: undefined as string | undefined,
		subsystemMismatches: [] as string[],
		dumpMismatches: [] as string[],
		eventMismatches: [] as string[],
		dumpsChecked: [] as number[],
	};

	const n = math.min(run.ticks, recording.frames.size());
	for (let t = 0; t <= n; t++) {
		if (t > 0) {
			step(state, recording.frames[t - 1], config);
			const actual = nonDefaultEvents(state.events);
			const expected = expectedEvents.get(t - 1);
			if (!eventsEqual(actual, expected) && report.eventMismatches.size() < MAX_EVENT_REPORTS) {
				report.eventMismatches.push(
					`tick ${t - 1}: events ${describeEvents(actual)}, expected ${describeEvents(expected)}`,
				);
			}
		}
		if (t % run.subsystemsEvery === 0) {
			const subs = subsystemHashes(state);
			const k = t / run.subsystemsEvery;
			for (const name of HASH_SUBSYSTEMS) {
				const want = run.subsystems[name][k];
				if (want !== undefined && subs[name] !== want) {
					report.subsystemMismatches.push(`tick ${t}: ${name} ${subs[name]}, expected ${want}`);
				}
			}
		}
		const dump = dumpByTick.get(t);
		if (dump !== undefined) {
			checkDump(state, dump, report.dumpMismatches);
			report.dumpsChecked.push(t);
		}
		const hash = hashState(state);
		if (hash !== run.hashes[t]) {
			report.hashMismatch = `tick ${t}: hash ${hash}, expected ${run.hashes[t]}`;
			const m = dump === undefined ? undefined : firstFieldMismatch(state, dump.fields);
			if (m !== undefined) report.hashMismatch += `; ${describeMismatch(m)}`;
			break;
		}
		report.ticksMatched = t + 1;
	}
	if (report.hashMismatch === undefined && hashState(state) !== run.finalHash) {
		report.hashMismatch = `final hash ${hashState(state)}, expected ${run.finalHash}`;
	}
	return report;
}

/** What a whole replay adds up to (the run fixtures' `totals`, `firstTick`, `hitsBySource`), plus the final state. */
export interface RunSummary {
	/** Every SimEvents field but lastHitSource, summed over the run. */
	readonly totals: Map<string, number>;
	/** First tick of playerHits, actorsKilled, playerDied, bossEngaged, bossDefeated and `bossPhase<N>`. */
	readonly firstTick: Map<string, number>;
	/** Ticks with a landed player hit, by the hitting archetype's id (lastHitSource; "unknown" for -1). */
	readonly hitsBySource: Map<string, number>;
	/** The state after the last frame. */
	readonly state: SimState;
}

const FIRST_TICK_FIELDS = ["playerHits", "actorsKilled", "playerDied", "bossEngaged", "bossDefeated"] as const;

/**
 * Replays a run fixture's recording once and sums its events the way the exporter does. `archetypeIds` maps
 * lastHitSource (an archetype index) to an id for hitsBySource.
 */
export function replaySummary(
	run: RunFixture,
	config: Readonly<SimConfig>,
	archetypeIds: ReadonlyArray<string>,
): RunSummary {
	const recording = deserializeRecording(run.recording);
	const state = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, config);
	const totals = new Map<string, number>();
	const firstTick = new Map<string, number>();
	const hitsBySource = new Map<string, number>();
	for (const f of SIM_EVENT_FIELDS) if (f !== "lastHitSource") totals.set(f, 0);
	const n = math.min(run.ticks, recording.frames.size());
	for (let t = 0; t < n; t++) {
		step(state, recording.frames[t], config);
		const e = state.events;
		for (const f of SIM_EVENT_FIELDS) if (f !== "lastHitSource") totals.set(f, totals.get(f)! + e[f]);
		for (const f of FIRST_TICK_FIELDS) if (e[f] !== 0 && !firstTick.has(f)) firstTick.set(f, t);
		if (e.bossPhase !== 0 && !firstTick.has(`bossPhase${e.bossPhase}`)) firstTick.set(`bossPhase${e.bossPhase}`, t);
		if (e.playerHits !== 0) {
			const id = e.lastHitSource >= 0 ? archetypeIds[e.lastHitSource] ?? "unknown" : "unknown";
			hitsBySource.set(id, (hitsBySource.get(id) ?? 0) + 1);
		}
	}
	return { totals, firstTick, hitsBySource, state };
}
