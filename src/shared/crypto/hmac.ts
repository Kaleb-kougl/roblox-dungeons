/**
 * HMAC-SHA256 (RFC 2104 with SHA-256, as in RFC 4231), pure. The key never needs to be shared code: callers pass it
 * in (the daily seed's key lives in src/server only, DSD8).
 *
 * @module
 */
import { SHA256_BLOCK_BYTES, sha256 } from "./sha256";

/** RFC 2104: the inner and outer pad bytes. */
const IPAD = 0x36;
const OPAD = 0x5c;

/** HMAC-SHA256(key, message): 32 bytes. A key longer than the block (64 bytes) is hashed first. */
export function hmacSha256(key: ReadonlyArray<number>, message: ReadonlyArray<number>): number[] {
	const k: number[] = key.size() > SHA256_BLOCK_BYTES ? sha256(key) : [...key];
	while (k.size() < SHA256_BLOCK_BYTES) k.push(0);
	const inner: number[] = [];
	const outer: number[] = [];
	for (const b of k) {
		inner.push(bit32.bxor(b, IPAD));
		outer.push(bit32.bxor(b, OPAD));
	}
	for (const b of message) inner.push(b);
	for (const b of sha256(inner)) outer.push(b);
	return sha256(outer);
}
