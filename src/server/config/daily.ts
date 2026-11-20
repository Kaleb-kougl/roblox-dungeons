/**
 * The daily seed's key (docs/DAILY.md DSD8). SERVER ONLY: src/server maps to ServerScriptService
 * (default.project.json / publish.project.json "ServerScriptService.TS" <- out/server), which never replicates to
 * clients, so no client can compute tomorrow's seed and practise it in a dev world. Never move or import this from
 * shared/ or client/; the derivation is shared/daily dailySeedFrom (HMAC-SHA256, keyless: the message is
 * `"kv-daily|" .. day`, the seed the MAC's first 4 bytes as a big-endian uint32), and only today's seed is sent
 * (`dailyStatus`). A 256-bit key behind a one-way MAC: a client holding today's `{ day, seed }` (or every past one)
 * can neither invert it nor brute-force the key.
 *
 * Changing the key changes every day's seed, so it must not change while a day's boards are live. The key is not
 * exported: only `dailySeed` leaves this module.
 *
 * @module
 */
import { Workspace } from "@rbxts/services";
import { bytesOfHex } from "shared/crypto";
import { dailySeedFrom } from "shared/daily";

/** 32 random bytes (256 bits; shared/daily DAILY_SEED.minKeyBytes asks for at least 16), as hex. */
const DAILY_KEY_HEX = "fc50e93f03316b900bf48494d23fd615c8bbfa909741f744f45ceb6cf913ceb4";
const DAILY_KEY: ReadonlyArray<number> = bytesOfHex(DAILY_KEY_HEX);

/** The run seed of day `day` (shared/daily dailyDay): valid by shared/run isValidRunSeed. */
export function dailySeed(day: number): number {
	return dailySeedFrom(day, DAILY_KEY);
}

/**
 * The server's wall clock for the Daily, unix seconds UTC (fractional): Workspace:GetServerTimeNow(), the clock the
 * client compares `resetsAt` with, so the server's day and the client's countdown agree. RunSessionService (a daily
 * start's day) and DailyService (the status, the midnight push) both read it.
 */
export function dailyClockNow(): number {
	return Workspace.GetServerTimeNow();
}
