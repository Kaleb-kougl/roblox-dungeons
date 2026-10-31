/**
 * The daily seed's mixer (docs/DAILY.md, DSD8). Pure, and deliberately keyless here: the server passes its own secret
 * (src/server/config/daily.ts `dailySeed`), which never ships to clients, so a client cannot compute a future day's
 * seed. 32-bit integer math through bit32 and the split-16 imul (shared/jsmath), identical on every machine.
 */
import { imul, u32 } from "shared/jsmath";
import { DAILY_SEED_MIX } from "./config";

/**
 * The run seed of `day` under `secret`: an integer in [0, 2^32) (valid by shared/run isValidRunSeed). For one secret,
 * different days (mod 2^32) never share a seed: `secret ^ imul(day, odd)` and fmix32 are both bijections.
 */
export function dailySeedFrom(day: number, secret: number): number {
	const m = DAILY_SEED_MIX;
	let h = bit32.bxor(u32(secret), imul(day, m.dayMultiplier));
	h = bit32.bxor(h, bit32.rshift(h, m.shiftA));
	h = imul(h, m.mulA);
	h = bit32.bxor(h, bit32.rshift(h, m.shiftB));
	h = imul(h, m.mulB);
	h = bit32.bxor(h, bit32.rshift(h, m.shiftC));
	return h;
}
