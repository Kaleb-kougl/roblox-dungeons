/**
 * SHA-256 (FIPS 180-4), pure: 32-bit words through bit32 and exact float64 sums reduced mod 2^32, so every Roblox
 * client, server and Lune computes the same digest. Not fast (about 64 rounds of a dozen bit32 calls per 64-byte block):
 * meant for short messages such as the daily seed's HMAC (shared/daily dailySeedFrom).
 */
import { pushUint32BE } from "./bytes";

const TWO_32 = 4294967296;
const BLOCK_BYTES = 64;
const ROUNDS = 64;
const SCHEDULE_FROM_BLOCK = 16;
const BYTES_PER_WORD = 4;
const BITS_PER_BYTE = 8;
/** The padding's first byte (a single 1 bit) and the 64-bit message length at the end of the last block. */
const PAD_MARKER = 0x80;
const LENGTH_BYTES = 8;
const BYTE_VALUES = 256;

/** FIPS 180-4 section 5.3.3: the initial hash value (first 32 bits of the fractional square roots of the first 8 primes). */
const H0: ReadonlyArray<number> = [
	0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/** FIPS 180-4 section 4.2.2: the round constants (first 32 bits of the fractional cube roots of the first 64 primes). */
const K: ReadonlyArray<number> = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
	0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
	0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
	0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
	0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
	0xc67178f2,
];

/** FIPS 180-4 section 4.1.2: the rotate / shift amounts of the four sigma functions. */
const SIGMA = {
	big0: [2, 13, 22],
	big1: [6, 11, 25],
	small0: [7, 18, 3],
	small1: [17, 19, 10],
} as const;

/** FIPS 180-4 section 6.2.2 step 1: the message schedule's taps, W[t] = s1(W[t-2]) + W[t-7] + s0(W[t-15]) + W[t-16]. */
const TAP = { s1: 2, plain: 7, s0: 15, last: 16 } as const;

/** SHA-256's block size in bytes (HMAC pads its key to it). */
export const SHA256_BLOCK_BYTES = BLOCK_BYTES;
/** A digest's size in bytes. */
export const SHA256_DIGEST_BYTES = 32;

/** The SHA-256 digest (32 bytes) of `message` (bytes in [0, 255]). */
export function sha256(message: ReadonlyArray<number>): number[] {
	const bytes: number[] = [...message];
	const bitLength = message.size() * BITS_PER_BYTE;
	bytes.push(PAD_MARKER);
	while (bytes.size() % BLOCK_BYTES !== BLOCK_BYTES - LENGTH_BYTES) bytes.push(0);
	pushUint32BE(bytes, math.floor(bitLength / TWO_32));
	pushUint32BE(bytes, bitLength % TWO_32);

	const h: number[] = [...H0];
	const w: number[] = [];
	for (let i = 0; i < ROUNDS; i++) w.push(0);
	const blocks = bytes.size() / BLOCK_BYTES;
	for (let block = 0; block < blocks; block++) {
		const base = block * BLOCK_BYTES;
		for (let t = 0; t < SCHEDULE_FROM_BLOCK; t++) {
			let word = 0;
			for (let j = 0; j < BYTES_PER_WORD; j++) word = word * BYTE_VALUES + bytes[base + t * BYTES_PER_WORD + j];
			w[t] = word;
		}
		for (let t = SCHEDULE_FROM_BLOCK; t < ROUNDS; t++) {
			const x = w[t - TAP.s0];
			const y = w[t - TAP.s1];
			const s0 = bit32.bxor(
				bit32.rrotate(x, SIGMA.small0[0]),
				bit32.rrotate(x, SIGMA.small0[1]),
				bit32.rshift(x, SIGMA.small0[2]),
			);
			const s1 = bit32.bxor(
				bit32.rrotate(y, SIGMA.small1[0]),
				bit32.rrotate(y, SIGMA.small1[1]),
				bit32.rshift(y, SIGMA.small1[2]),
			);
			w[t] = (w[t - TAP.last] + s0 + w[t - TAP.plain] + s1) % TWO_32;
		}
		let a = h[0];
		let b = h[1];
		let c = h[2];
		let d = h[3];
		let e = h[4];
		let f = h[5];
		let g = h[6];
		let hh = h[7];
		for (let t = 0; t < ROUNDS; t++) {
			const S1 = bit32.bxor(
				bit32.rrotate(e, SIGMA.big1[0]),
				bit32.rrotate(e, SIGMA.big1[1]),
				bit32.rrotate(e, SIGMA.big1[2]),
			);
			const ch = bit32.bxor(bit32.band(e, f), bit32.band(bit32.bnot(e), g));
			const temp1 = (hh + S1 + ch + K[t] + w[t]) % TWO_32;
			const S0 = bit32.bxor(
				bit32.rrotate(a, SIGMA.big0[0]),
				bit32.rrotate(a, SIGMA.big0[1]),
				bit32.rrotate(a, SIGMA.big0[2]),
			);
			const maj = bit32.bxor(bit32.band(a, b), bit32.band(a, c), bit32.band(b, c));
			const temp2 = (S0 + maj) % TWO_32;
			hh = g;
			g = f;
			f = e;
			e = (d + temp1) % TWO_32;
			d = c;
			c = b;
			b = a;
			a = (temp1 + temp2) % TWO_32;
		}
		h[0] = (h[0] + a) % TWO_32;
		h[1] = (h[1] + b) % TWO_32;
		h[2] = (h[2] + c) % TWO_32;
		h[3] = (h[3] + d) % TWO_32;
		h[4] = (h[4] + e) % TWO_32;
		h[5] = (h[5] + f) % TWO_32;
		h[6] = (h[6] + g) % TWO_32;
		h[7] = (h[7] + hh) % TWO_32;
	}
	const out: number[] = [];
	for (const word of h) pushUint32BE(out, word);
	return out;
}
