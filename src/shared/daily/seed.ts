/**
 * The daily seed's derivation (docs/DAILY.md DSD8): HMAC-SHA256 keyed by the server's secret. Pure and keyless here:
 * the server passes its own key (src/server/config/daily.ts `dailySeed`), which never ships to clients. A client sees
 * today's `{ day, seed }` (`dailyStatus`), but a keyed one-way MAC with a >= 128-bit key cannot be inverted or brute
 * forced to the key, so no client can compute a future day's seed.
 *
 *   message  the ASCII bytes of `DAILY_SEED.messagePrefix .. day`, the day as a decimal integer (no leading zeros or
 *            "+", a "-" for days before the epoch): day 303 -> "kv-daily|303"
 *   seed     the MAC's first 4 bytes as a big-endian uint32 (shared/crypto uint32BE), in [0, 2^32) (valid by shared/run
 *            isValidRunSeed)
 *
 * @module
 */
import { hmacSha256, stringBytes, uint32BE } from "shared/crypto";
import { DAILY_SEED } from "./config";

/** The HMAC message for `day` (see the file header). Throws for a day that is not an integer. */
export function dailySeedMessage(day: number): string {
	if (day !== math.floor(day) || day === math.huge || day === -math.huge) {
		error(`dailySeedMessage: day ${day} is not an integer`, 0);
	}
	return `${DAILY_SEED.messagePrefix}${string.format("%d", day)}`;
}

/**
 * The run seed of `day` under `key` (bytes, at least DAILY_SEED.minKeyBytes long: a shorter key throws): an integer in
 * [0, 2^32). Different days give unrelated seeds (a collision of two days is a 1 in 2^32 chance per pair).
 */
export function dailySeedFrom(day: number, key: ReadonlyArray<number>): number {
	if (key.size() < DAILY_SEED.minKeyBytes) {
		error(`dailySeedFrom: the key has ${key.size()} bytes, at least ${DAILY_SEED.minKeyBytes} needed`, 0);
	}
	return uint32BE(hmacSha256(key, stringBytes(dailySeedMessage(day))), 0);
}
