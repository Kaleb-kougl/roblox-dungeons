/**
 * Dungeon Forge building blocks against fixtures/rng.json (Forge rng streams, AUTO theme, per-room encounter seeds,
 * the reroll chain), fixtures/math-trace.json + arc-table.json (the deterministic sin / cos), plus the logic parts of
 * the web build's forge.parity.test.ts (mulberry32 / makeRng / delaunay invariants).
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import arcTable from "shared/fixtures-generated/arc-table";
import mathTrace from "shared/fixtures-generated/math-trace";
import rngFixture from "shared/fixtures-generated/rng";
import {
	EncounterRng,
	THEME_KEYS,
	dcos,
	delaunay,
	dsin,
	encounterRoomSeed,
	forgeRerollSeed,
	makeRng,
	mulberry32,
	resolveAutoTheme,
} from "shared/dungeon";
import { f64Hex, hexF64 } from "../fixtureDiff";

interface ForgeCall {
	call: "f" | "i" | "pick" | "chance" | "raw";
	a?: number;
	b?: number;
	p?: number;
	length?: number;
	index?: number;
	value?: number | boolean;
}

interface ForgeEntry {
	seed: number;
	identicalToSim: boolean;
	makeRngCalls: ReadonlyArray<ForgeCall>;
}

interface SimEntry {
	seed: number;
	initialState: number;
	next: ReadonlyArray<number>;
}

const forge = rngFixture.forge as unknown as ReadonlyArray<ForgeEntry>;
const sim = rngFixture.sim as unknown as ReadonlyArray<SimEntry>;

/** Fixture numbers that JSON cannot hold are strings ("-0", "NaN", "Infinity"). */
/** The bits of the NaN the web build exports (JavaScript's canonical NaN). */
const CANONICAL_NAN_HEX = "7ff8000000000000";

function num(v: unknown): number {
	if (typeIs(v, "number")) return v;
	if (v === "-0") return -0;
	// The fixture's NaN is the canonical quiet NaN. `0 / 0` is a NaN whose sign bit depends on the CPU (set on
	// x86-64, clear on arm64), so it is built from its bits (docs/CI.md CI1).
	if (v === "NaN") return hexF64(CANONICAL_NAN_HEX);
	if (v === "Infinity") return math.huge;
	if (v === "-Infinity") return -math.huge;
	error(`not a fixture number: ${tostring(v)}`);
}

describe("Forge rng (mulberry32 / makeRng)", () => {
	it("is the sim's mulberry32: the first 1000 values equal rng.json sim[].next", () => {
		let checked = 0;
		for (const f of forge) {
			expect(f.identicalToSim).toBe(true);
			const s = sim.find((e) => e.seed === f.seed);
			if (!s) continue;
			const r = mulberry32(f.seed);
			for (let i = 0; i < s.next.size(); i++) {
				const v = r();
				if (v !== s.next[i])
					expect(`seed ${f.seed} call ${i}: ${v}`).toBe(`seed ${f.seed} call ${i}: ${s.next[i]}`);
			}
			checked++;
		}
		expect(checked).toBe(forge.size());
	});

	it("reproduces every makeRng call (f, i, pick, chance, raw) in order", () => {
		for (const f of forge) {
			const rng = makeRng(f.seed);
			const pickArr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
			f.makeRngCalls.forEach((c, k) => {
				const where = `seed ${f.seed} call ${k} (${c.call})`;
				if (c.call === "f") expect([where, rng.f(c.a!, c.b!)]).toEqual([where, c.value]);
				else if (c.call === "i") expect([where, rng.i(c.a!, c.b!)]).toEqual([where, c.value]);
				else if (c.call === "pick") {
					const arr: number[] = [];
					for (let j = 0; j < c.length!; j++) arr.push(pickArr[j]);
					expect([where, rng.pick(arr)]).toEqual([where, c.index]);
				} else if (c.call === "chance") expect([where, rng.chance(c.p!)]).toEqual([where, c.value]);
				else expect([where, rng.raw()]).toEqual([where, c.value]);
			});
		}
	});

	it("EncounterRng is the sim's new Rng(seed): seedToState vectors and streams", () => {
		const vectors = rngFixture.seedToState as unknown as ReadonlyArray<{
			seed: unknown;
			seedHex: string;
			state: number;
		}>;
		for (const v of vectors) {
			const seed = hexF64(v.seedHex);
			expect(f64Hex(num(v.seed))).toBe(v.seedHex);
			expect([v.seedHex, new EncounterRng(seed).getState()]).toEqual([v.seedHex, v.state]);
		}
		for (const s of sim) {
			const r = new EncounterRng(s.seed);
			expect(r.getState()).toBe(s.initialState);
			for (let i = 0; i < 100; i++) expect(r.next()).toBe(s.next[i]);
		}
	});
});

describe("seed formulas", () => {
	it("resolveAutoTheme matches the demo's AUTO chip", () => {
		expect([...THEME_KEYS]).toEqual([...(rngFixture.themeKeys as unknown as ReadonlyArray<string>)]);
		const cases = rngFixture.resolveAutoTheme as unknown as ReadonlyArray<{ seed: number; theme: string }>;
		for (const c of cases) expect([c.seed, resolveAutoTheme(c.seed)]).toEqual([c.seed, c.theme]);
	});

	it("encounterRoomSeed = ((seed >>> 0) ^ imul(roomId + 1, 0x9e3779b1)) >>> 0", () => {
		const cases = rngFixture.encounterRoomSeed as unknown as ReadonlyArray<{
			dungeonSeed: number;
			roomId: number;
			seed: number;
		}>;
		expect(cases.size()).toBeGreaterThan(0);
		for (const c of cases) expect(encounterRoomSeed(c.dungeonSeed, c.roomId)).toBe(c.seed);
	});

	it("forgeRerollChain: seed = (imul(seed, 9301) + 49297) >>> 0", () => {
		const chain = rngFixture.forgeRerollChain as unknown as { from: number; seeds: ReadonlyArray<number> };
		let s = chain.from;
		expect(chain.seeds[0]).toBe(s);
		for (let i = 1; i < chain.seeds.size(); i++) {
			s = forgeRerollSeed(s);
			expect(s).toBe(chain.seeds[i]);
		}
	});
});

interface TraceCall {
	fn: string;
	args: ReadonlyArray<number>;
	result: number;
}

/**
 * V8's Math.sin / Math.cos results in the fixtures that are NOT the correctly rounded value (1 ulp off). The port's
 * dsin / dcos are correctly rounded, so exactly these differ. Key: `fn argHex`.
 */
const V8_MISROUNDED = new Set([
	"cos 400dc600e51a1c07", // dungeon:42 scatter angle (sx0 still matches after * radius + offset)
	"cos 3fddf72b23c9dfa2", // dungeon:7 scatter angle (idem)
	"sin 400c463abeccb2bb", // run arcs
	"sin 4010c152382d7365",
	"cos bfe34feb374d5be3",
	"sin 4001c06279fbd3f6",
]);

describe("deterministic dsin / dcos", () => {
	it("matches every V8 sin / cos the dungeon fixtures and runs traced, except the 6 calls V8 misrounds", () => {
		const contexts = mathTrace.contexts as unknown as ReadonlyMap<string, { calls: ReadonlyArray<TraceCall> }>;
		let checked = 0;
		const differing: string[] = [];
		for (const [, ctx] of contexts)
			for (const call of ctx.calls) {
				if (call.fn !== "sin" && call.fn !== "cos") continue;
				const x = call.args[0];
				const got = call.fn === "sin" ? dsin(x) : dcos(x);
				checked++;
				if (got === call.result) continue;
				const key = `${call.fn} ${f64Hex(x)}`;
				// 1 ulp at most, and only on the known list
				expect([
					key,
					V8_MISROUNDED.has(key),
					math.abs(got - call.result) <= math.abs(call.result) * 2.3e-16,
				]).toEqual([key, true, true]);
				if (!differing.includes(key)) differing.push(key);
			}
		expect(checked).toBeGreaterThan(300);
		expect(differing.size()).toBe(V8_MISROUNDED.size());
	});

	it("matches arc-table.json in 270 of 276 values (the 6 others are V8's misroundings)", () => {
		let same = 0;
		let total = 0;
		for (const shape of arcTable.shapes)
			shape.angleHex.forEach((a, i) => {
				const x = hexF64(a);
				for (const [fn, want] of [
					["sin", shape.sinHex[i]],
					["cos", shape.cosHex[i]],
				] as const) {
					total++;
					const got = f64Hex(fn === "sin" ? dsin(x) : dcos(x));
					if (got === want) same++;
					else expect(V8_MISROUNDED.has(`${fn} ${a}`)).toBe(true);
				}
			});
		expect([same, total]).toEqual([270, 276]);
	});

	it("handles signs, zero and the quadrant boundaries", () => {
		expect(1 / dsin(-0)).toBe(-math.huge);
		expect(dsin(0)).toBe(0);
		expect(dcos(0)).toBe(1);
		expect(dsin(math.pi / 2)).toBe(1);
		expect(dcos(math.pi)).toBe(-1);
		expect(dsin(-1)).toBe(-dsin(1));
		expect(dcos(-1)).toBe(dcos(1));
		const nan = dsin(0 / 0);
		expect(nan !== nan).toBe(true);
		const nan2 = dcos(math.huge);
		expect(nan2 !== nan2).toBe(true);
	});
});

describe("delaunay (logic checks from forge.parity.test.ts)", () => {
	it("returns unique undirected edges [lo, hi] over valid indices for random point sets", () => {
		const r = mulberry32(7);
		for (let t = 0; t < 30; t++) {
			const n = 3 + math.floor(r() * 60);
			const pts: Array<{ x: number; y: number }> = [];
			for (let i = 0; i < n; i++)
				pts.push({ x: math.floor((r() - 0.5) * 80 + 0.5), y: math.floor((r() - 0.5) * 80 + 0.5) });
			const edges = delaunay(pts);
			const seen = new Set<number>();
			for (const [a, b] of edges) {
				expect(a < b && a >= 0 && b < n).toBe(true);
				expect(seen.has(a * 4096 + b)).toBe(false);
				seen.add(a * 4096 + b);
			}
			// planar triangulation: at most 3n - 6 edges
			expect(edges.size() <= 3 * n - 6 || n < 3).toBe(true);
		}
		expect(delaunay([])).toEqual([]);
		expect(
			delaunay([
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			]),
		).toEqual([[0, 1]]);
	});
});
