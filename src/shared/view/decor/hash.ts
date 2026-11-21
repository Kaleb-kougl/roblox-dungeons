/**
 * decorHash(floorSeed, cell, salt) (docs/DECOR.md Phase 2 part 1): every choice the decor plan makes inside a band
 * (variant, facing, broken or whole, lit or out, which clutter a full room keeps) is a hash of the floor seed, the
 * cell and a per-choice salt (DECOR_SALT), never `math.random`, so every co-op client and every replay viewer draws
 * the same floor. 32-bit integer math through shared/jsmath (exact in Luau doubles).
 *
 * @module
 */
import { imul, u32 } from "shared/jsmath";

const MIX_CELL = 0x9e3779b1;
const MIX_SALT = 0x85ebca77;
const FMIX_1 = 0x85ebca6b;
const FMIX_2 = 0xc2b2ae35;
const SHIFT_1 = 16;
const SHIFT_2 = 13;
const TWO_32 = 4294967296;

/** A uint32 hash of (floor seed, cell key, salt): murmur3's fmix32 over a seed mixed with both. */
export function decorHash(floorSeed: number, cell: number, salt: number): number {
	let h = bit32.bxor(u32(floorSeed), imul(cell, MIX_CELL), imul(salt, MIX_SALT));
	h = bit32.bxor(h, bit32.rshift(h, SHIFT_1));
	h = imul(h, FMIX_1);
	h = bit32.bxor(h, bit32.rshift(h, SHIFT_2));
	h = imul(h, FMIX_2);
	return bit32.bxor(h, bit32.rshift(h, SHIFT_1));
}

/** decorHash as a fraction in [0, 1). */
export function decorHash01(floorSeed: number, cell: number, salt: number): number {
	return decorHash(floorSeed, cell, salt) / TWO_32;
}
