import { describe, expect, it } from "@rbxts/jest-globals";
import rngFixture from "shared/fixtures-generated/rng";
import { float64FromHex, Rng, rngInt, rngNext, seedToState } from "shared/sim";

const TWO_POW_32 = 4294967296;

describe("sim rng parity (fixtures/rng.json)", () => {
	it("reproduces every sequence, u32 and state bit for bit", () => {
		for (const seq of rngFixture.sim) {
			const h = { rngState: seedToState(seq.seed) };
			expect(h.rngState).toBe(seq.initialState);
			for (let i = 0; i < seq.next.size(); i++) {
				const v = rngNext(h);
				if (v !== seq.next[i]) {
					expect(`seed ${seq.seed} next[${i}] = ${v}`).toBe(`seed ${seq.seed} next[${i}] = ${seq.next[i]}`);
				}
				expect(v * TWO_POW_32).toBe(seq.u32[i]);
				if (i < seq.statesAfterFirst20.size()) expect(h.rngState).toBe(seq.statesAfterFirst20[i]);
			}
		}
	});

	it("reproduces every int(min, max) sample and the state after it", () => {
		for (const seq of rngFixture.sim) {
			const r = new Rng(seq.seed);
			for (const sample of seq.int) {
				expect(r.int(sample.min, sample.max)).toBe(sample.value);
				expect(r.getState()).toBe(sample.stateAfter);
			}
		}
	});

	it("normalizes edge seeds like JS ToUint32 (negative, fractional, > 2^32, NaN, Infinity, -0)", () => {
		for (const entry of rngFixture.seedToState) {
			const seed = float64FromHex(entry.seedHex);
			expect(seedToState(seed)).toBe(entry.state);
		}
	});

	it("is the same arithmetic as the Dungeon Forge mulberry32 (identicalToSim)", () => {
		for (const forge of rngFixture.forge) {
			expect(forge.identicalToSim).toBe(true);
			expect(rngFixture.sim.some((s) => s.seed === forge.seed)).toBe(true);
		}
	});
});

// Ported from src/sim/step.test.ts ("rng").
describe("rng", () => {
	it("is reproducible and restorable from its state", () => {
		const a = new Rng(7);
		const b = new Rng(7);
		const seqA: number[] = [];
		const seqB: number[] = [];
		for (let i = 0; i < 100; i++) seqA.push(a.next());
		for (let i = 0; i < 100; i++) seqB.push(b.next());
		expect(seqA).toEqual(seqB);
		for (const v of seqA) {
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
		const saved = a.getState();
		const next5: number[] = [];
		for (let i = 0; i < 5; i++) next5.push(a.next());
		const c = new Rng(0);
		c.setState(saved);
		const again: number[] = [];
		for (let i = 0; i < 5; i++) again.push(c.next());
		expect(again).toEqual(next5);
	});

	it("int(min, max) is inclusive and in range", () => {
		const r = new Rng(3);
		const seen = new Set<number>();
		for (let i = 0; i < 2000; i++) {
			const v = r.int(-2, 2);
			expect(math.floor(v)).toBe(v);
			expect(v).toBeGreaterThanOrEqual(-2);
			expect(v).toBeLessThanOrEqual(2);
			seen.add(v);
		}
		expect(seen.size()).toBe(5);
	});

	it("rngInt works on any holder", () => {
		const h = { rngState: 1 };
		const v = rngInt(h, 0, 9);
		expect(v >= 0 && v <= 9).toBe(true);
		expect(h.rngState).never.toBe(1);
	});
});
