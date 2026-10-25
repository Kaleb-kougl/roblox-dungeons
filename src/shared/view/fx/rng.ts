/**
 * Render-side PRNG (port of RenderRng in project-kaleb-vale src/fx/numbers/numberPool.ts and Rng / burstSeed in
 * src/fx/particles/particles.ts @ 42897e2): mulberry32 on its OWN state word, never the sim's rng and never
 * math.random. It reuses the sim's exact mulberry32 step (rngNext), so sequences match the web build's.
 */
import { imul, u32 } from "shared/jsmath";
import { rngNext, type RngHolder } from "shared/sim";

/** The web Rng's fallback seed for 0 (`seed >>> 0 || 0x9e3779b9`). */
const ZERO_SEED = 0x9e3779b9;
const GOLDEN = 0x9e3779b1;
const MIX_A = 0x85ebca6b;
const MIX_B = 0xc2b2ae35;
const ID_OFFSET = 1;
const TICK_OFFSET = 7;
const SALT_OFFSET = 3;

export class RenderRng implements RngHolder {
	rngState = ZERO_SEED;

	constructor(seed: number = ZERO_SEED) {
		this.seed(seed);
	}

	seed(seed: number): void {
		const s = u32(seed);
		this.rngState = s !== 0 ? s : ZERO_SEED;
	}

	/** Uniform in [0, 1). */
	next(): number {
		return rngNext(this);
	}

	/** Uniform in [a, b). */
	range(a: number, b: number): number {
		return a + (b - a) * this.next();
	}

	/** Whole number in [-r, r]. */
	int(r: number): number {
		return math.floor(this.next() * (2 * r + 1)) - r;
	}
}

/** Seed for an actor's burst (distinct per actor and tick, stable for tests). */
export function burstSeed(actorId: number, tick: number, salt = 0): number {
	return bit32.bxor(
		imul(actorId + ID_OFFSET, GOLDEN),
		imul(tick + TICK_OFFSET, MIX_A),
		imul(salt + SALT_OFFSET, MIX_B),
	);
}
