/**
 * R3a, the Parallel Luau facts (docs/ROLLBACK_SPIKE.md R3a; KV_RollbackSpikeMode = "facts"): the pure pieces both
 * halves use. The worker script and RollbackSpikeController run the Studio steps:
 *
 *   1. modules required in the serial phase at the worker's start, then an endless run built (serial) and stepped
 *      `facts.stepTicks` ticks desynchronized inside the Actor: its hash against the main thread's of the same steps
 *   2. `Actor:SendMessage` with a table (nested, one table referenced twice, a metatable, a list), a `buffer` and a
 *      `SharedTable`: what arrives, whether the worker's write shows on the main side (copied or shared), whether
 *      metatables and the double reference survive; the reply path back (a BindableEvent fired in the serial phase)
 *      carries a buffer too; and whether the main thread may bind to a second Actor's messages
 *   3. MicroProfiler labels from the worker (`facts.profileSec` of a labelled loop: look for `kv.rollback.facts`)
 *   4. the main thread's frame time with a busy parallel task of each `facts.taskMs` per frame, against a baseline and
 *      the same task on the main thread
 * Lines print as `[RollbackFacts] key: value`, ready to paste into the doc.
 */
import { buildWorldSetup } from "shared/run";
import {
	EMPTY_INPUT,
	createSimState,
	hashState,
	stepParty,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { ROLLBACK_SPIKE } from "../config";

const FACTS = ROLLBACK_SPIKE.probe.facts;
const MS = 1000;
export const ROLLBACK_FACTS_PREFIX = "[RollbackFacts]";

/** One facts line. */
export function factsLine(key: string, value: string): string {
	return `${ROLLBACK_FACTS_PREFIX} ${key}: ${value}`;
}

/** The facts run: an endless party run at tick 0 (built in the serial phase). */
export interface FactsRun {
	readonly state: SimState;
	readonly config: Readonly<SimConfig>;
	readonly inputs: ReadonlyArray<Readonly<InputFrame>>;
}

export function buildFactsRun(): FactsRun {
	const setup = buildWorldSetup("endless", FACTS.seed, { atBossDoor: false, partySize: FACTS.partySize });
	const spawn = setup.spawn ?? { x: 0, z: 0 };
	const inputs: InputFrame[] = [];
	for (let i = 0; i < FACTS.partySize; i++) inputs.push({ ...EMPTY_INPUT });
	return { state: createSimState(FACTS.seed, spawn.x, spawn.z, setup.config), config: setup.config, inputs };
}

/** Steps the facts run `ticks` ticks; the ms it took and the final hash. */
export function stepFactsRun(run: FactsRun, ticks: number, clock: () => number): { ms: number; hash: string } {
	const t0 = clock();
	for (let t = 0; t < ticks; t++) stepParty(run.state, run.inputs, run.config);
	return { ms: (clock() - t0) * MS, hash: hashState(run.state) };
}

/** Spins for `ms` milliseconds (a stand-in for a prediction's work). */
export function busyWait(ms: number, clock: () => number): void {
	const endAt = clock() + ms / MS;
	let spin = 0;
	while (clock() < endAt) spin++;
}

/** The table sent through SendMessage (fact 2). */
export function factsTableProbe(): Record<string, unknown> {
	const shared = { marker: FACTS.marker };
	const meta = setmetatable({}, { __index: { flag: FACTS.marker } as never });
	return {
		marker: FACTS.marker,
		nested: { marker: FACTS.marker },
		shared1: shared,
		shared2: shared,
		meta,
		list: [1, 2, 3],
	};
}

/** What the worker saw of the table (fact 2), then it writes `mutated` into `nested.marker`. */
export interface TableArrival {
	readonly arrived: boolean;
	readonly nested: boolean;
	readonly aliasKept: boolean;
	readonly metaKept: boolean;
	readonly list: boolean;
}

export function readTableProbe(v: unknown): TableArrival {
	if (!typeIs(v, "table")) return { arrived: false, nested: false, aliasKept: false, metaKept: false, list: false };
	const t = v as Record<string, unknown>;
	const nested = typeIs(t.nested, "table") && (t.nested as { marker?: unknown }).marker === FACTS.marker;
	const aliasKept = t.shared1 !== undefined && t.shared1 === t.shared2;
	const metaKept = typeIs(t.meta, "table") && getmetatable(t.meta as object) !== undefined;
	const list = typeIs(t.list, "table") && (t.list as unknown[]).size() === 3;
	if (typeIs(t.nested, "table")) (t.nested as { marker: number }).marker = FACTS.mutated;
	return { arrived: true, nested, aliasKept, metaKept, list };
}

/** After the worker's write: "shared" when the main thread's table sees it, else "copied". */
export function tableAfter(original: Record<string, unknown>): string {
	const nested = original.nested as { marker: number };
	return nested.marker === FACTS.mutated ? "shared (the worker's write shows here)" : "copied";
}

/** The buffer sent (fact 2): one byte, the marker. */
export function factsBufferProbe(): buffer {
	const b = buffer.create(1);
	buffer.writeu8(b, 0, FACTS.marker);
	return b;
}

/** What the worker saw of the buffer, then it writes `mutated` into it. */
export function readBufferProbe(v: unknown): string {
	if (!typeIs(v, "buffer")) return `not a buffer (${typeOf(v)})`;
	const ok = buffer.len(v) === 1 && buffer.readu8(v, 0) === FACTS.marker;
	buffer.writeu8(v, 0, FACTS.mutated);
	return ok ? "a buffer, content intact" : "a buffer, content changed";
}

export function bufferAfter(original: buffer): string {
	return buffer.readu8(original, 0) === FACTS.mutated ? "shared (the worker's write shows here)" : "copied";
}

/** p50 / p95 / max of frame times (ms) as one line. */
export function frameLine(samples: ReadonlyArray<number>): string {
	const sorted = [...samples];
	sorted.sort((a, b) => a < b);
	const n = sorted.size();
	if (n === 0) return "no frames";
	const at = (q: number) => sorted[math.clamp(math.ceil(q * n), 1, n) - 1];
	let sum = 0;
	for (const v of sorted) sum += v;
	const fps = sum > 0 ? (n * MS) / sum : 0;
	return string.format(
		"frame ms p50 %.2f p95 %.2f max %.2f, %.1f fps (%d frames)",
		at(0.5),
		at(0.95),
		sorted[n - 1],
		fps,
		n,
	);
}
