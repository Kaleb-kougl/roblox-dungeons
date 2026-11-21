import { imul } from "shared/jsmath";

/**
 * The source hash of a translation (docs/LOCALIZATION.md design 2): FNV-1a 32 over the English text's UTF-8 bytes,
 * as an unsigned 32-bit integer. A generated locale entry stores the hash of the English it was translated from; a
 * different hash means the English changed since (stale: English shows instead).
 *
 * The l10n node scripts compute the same value (`scripts/l10n`: `Buffer.from(text, "utf8")`, `Math.imul`, `>>> 0`).
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * The FNV-1a 32-bit hash of `text`'s bytes, as an unsigned integer in 0 to 2^32 - 1 (the empty string gives the offset
 * basis). Luau strings are byte strings, so the bytes hashed are the text's UTF-8. Compared against the hash stored in
 * a locale entry to tell whether the English changed since it was translated; must stay equal to what the
 * `scripts/l10n` node scripts compute.
 */
export function sourceHash(text: string): number {
	let h = FNV_OFFSET_BASIS;
	const size = text.size();
	for (let i = 1; i <= size; i++) {
		const [b] = string.byte(text, i);
		h = imul(bit32.bxor(h, b), FNV_PRIME);
	}
	return h;
}
