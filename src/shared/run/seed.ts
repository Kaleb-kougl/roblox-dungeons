/** Run seed validation, shared by the M1 run config (config.ts) and the endless one (endless.ts). */

const UINT32_MAX = 4294967295;

/** A seed the web build can produce: an integer in [0, 2^32) (seedFromQuery returns `parseInt(raw) >>> 0`). */
export function isValidRunSeed(seed: unknown): seed is number {
	return typeIs(seed, "number") && seed === seed && seed >= 0 && seed <= UINT32_MAX && math.floor(seed) === seed;
}
