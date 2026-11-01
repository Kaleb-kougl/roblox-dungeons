/**
 * Byte arrays for shared/crypto: an array of integers in [0, 255]. Strings are Luau byte strings, so a string's bytes
 * are its UTF-8 encoding (TypeScript string literals compile to UTF-8).
 */

const BYTE_VALUES = 256;
const HEX_DIGITS_PER_BYTE = 2;
const HEX_RADIX = 16;
const BYTES_PER_WORD = 4;
const BITS_PER_BYTE = 8;

/** The bytes of `s` (its UTF-8 encoding), first byte first. */
export function stringBytes(s: string): number[] {
	const out: number[] = [];
	for (let i = 1; i <= s.size(); i++) out.push(string.byte(s, i)[0]);
	return out;
}

/** Lowercase hex, two digits per byte. */
export function hexOf(bytes: ReadonlyArray<number>): string {
	const parts: string[] = [];
	for (const b of bytes) parts.push(string.format("%02x", b));
	return parts.join("");
}

/** The bytes of a hex string (either case, even length); throws on anything else. */
export function bytesOfHex(hex: string): number[] {
	if (hex.size() % HEX_DIGITS_PER_BYTE !== 0) error(`bytesOfHex: odd length ${hex.size()}`, 0);
	const out: number[] = [];
	for (let i = 1; i <= hex.size(); i += HEX_DIGITS_PER_BYTE) {
		const pair = string.sub(hex, i, i + 1);
		const [digits] = string.match(pair, "^%x%x$");
		const value = digits !== undefined ? tonumber(pair, HEX_RADIX) : undefined;
		if (value === undefined) error(`bytesOfHex: not hex at ${i}: "${pair}"`, 0);
		out.push(value);
	}
	return out;
}

/** The big-endian uint32 at `offset` (0-based) of `bytes`. */
export function uint32BE(bytes: ReadonlyArray<number>, offset: number): number {
	let v = 0;
	for (let i = 0; i < BYTES_PER_WORD; i++) v = v * BYTE_VALUES + bytes[offset + i];
	return v;
}

/** Appends `word` (a uint32) to `out` big-endian. */
export function pushUint32BE(out: number[], word: number): void {
	for (let i = BYTES_PER_WORD - 1; i >= 0; i--) out.push(bit32.extract(word, i * BITS_PER_BYTE, BITS_PER_BYTE));
}
