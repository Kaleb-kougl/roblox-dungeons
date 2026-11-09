/**
 * Captured co-op runs for the rollback spike (docs/ROLLBACK_SPIKE.md Design 6, task R4): a run's merged input log in
 * the game's own recording codec (shared/sim encodeRecording, the party variant), with what the harness needs to
 * rebuild the run headlessly, cut into DataStore-sized text chunks.
 *
 * Format (meta version ROLLBACK_CAPTURE.version):
 *   blocks   the run in blocks of ROLLBACK_CAPTURE.blockTicks ticks (the last one shorter), each encoded on its own
 *            by encodeRecording (seed, spawn, every player's stream for those ticks). The server keeps finished blocks
 *            encoded (a few bytes a tick), never a whole run's frames.
 *   payload  every block's bytes back to back, base64 (RFC 4648, `+` `/`, `=` padding)
 *   chunks   the payload cut into strings of at most `chunkChars` characters, in order
 *   meta     RollbackCaptureMeta: version, setup (no user ids: players are indices), info (run id, time, how the run
 *            ended, the server's final hash), players, ticks, each block's tick count and byte length, chunk count
 *
 * decodeCapture checks everything against the meta (version, counts, lengths, the alphabet, every block's decode under
 * its own limits, the same seed / spawn / party in every block, the setup's seed) and never throws: anything wrong is
 * undefined. Pure and Roblox-API-free.
 */
import { decodeRecording, encodeRecording, MAX_PARTY_SIZE, type InputFrame, type Recording } from "shared/sim";
import { ROLLBACK_CAPTURE, isRollbackKeyId } from "./rollbackSpike";

/** What rebuilds the run headlessly: shared/run buildWorldSetup(worldKind, seed, { atBossDoor, partySize }). */
export interface RollbackCaptureSetup {
	/** A shared/run world kind ("endless", "daily"). */
	readonly worldKind: string;
	readonly seed: number;
	readonly partySize: number;
	readonly atBossDoor: boolean;
	/** Debug limits were in force (debug input allowed: Studio tooling). */
	readonly debug: boolean;
	/** The endless ruleset in force (shared/daily DAILY.ruleset): replays need the build that ran it. */
	readonly ruleset: number;
	/** Daily runs: the day and ruleset of the run's board. */
	readonly daily?: { readonly day: number; readonly ruleset: number };
	/** game.PlaceVersion of the server that ran it (0 in Studio). */
	readonly placeVersion: number;
}

/** How the captured run ended, from the server's lockstep session and validator. */
export interface RollbackCaptureEnd {
	/** The lockstep session's status when its part ended (running / finishing / submitted / ended), or "shutdown". */
	readonly status: string;
	/** The validator's verdict, once it had one. */
	readonly ok?: boolean;
	readonly code?: string;
	readonly reason?: string;
	/** Ticks the server replayed and verified: the harness replays these and compares `serverHash`. */
	readonly verifiedTicks: number;
	/** hashState after `verifiedTicks` in the server's replay ("" unless the run reached its final check). */
	readonly serverHash: string;
	/** Per player index: the first tick of its leave frame, or -1 (never left). */
	readonly leftFromTick: ReadonlyArray<number>;
}

/** Who and when (no user ids). */
export interface RollbackCaptureInfo {
	readonly runId: string;
	/** Unix seconds. */
	readonly capturedAt: number;
	readonly end?: RollbackCaptureEnd;
	/** The recorder stopped early (truncated at maxTicks, or frames it could not read): why. */
	readonly problem?: string;
}

export interface RollbackCaptureMeta {
	readonly v: number;
	readonly setup: RollbackCaptureSetup;
	readonly info: RollbackCaptureInfo;
	readonly players: number;
	readonly ticks: number;
	/** Ticks in each block, in order (sum = ticks). */
	readonly blockTicks: ReadonlyArray<number>;
	/** Encoded bytes of each block, in order (sum = bytes). */
	readonly blockBytes: ReadonlyArray<number>;
	readonly bytes: number;
	readonly chunks: number;
	readonly encoding: string;
}

export interface EncodedCapture {
	readonly meta: RollbackCaptureMeta;
	readonly chunks: string[];
}

export interface DecodedCapture {
	readonly setup: RollbackCaptureSetup;
	readonly info: RollbackCaptureInfo;
	readonly recording: Recording;
}

const ENCODING = "base64";
const U32_LIMIT = 4294967296;
const NOT_LEFT = -1;

// ---------------------------------------------------------------------------------------------
// Base64

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PAD = 61; // "="
const BYTE_VALUES = 256;
const SEXTET = 64;
const PAIR = SEXTET * SEXTET;
const TRIPLE = PAIR * SEXTET;
const BYTE = 256;
const WORD = BYTE * BYTE;

const ENCODE_TABLE: number[] = [];
const DECODE_TABLE: number[] = [];
for (let i = 0; i < BYTE_VALUES; i++) DECODE_TABLE.push(-1);
for (let i = 0; i < SEXTET; i++) {
	const code = string.byte(ALPHABET, i + 1)[0];
	ENCODE_TABLE.push(code);
	DECODE_TABLE[code] = i;
}

/** Characters of the base64 text of `n` bytes. */
export function base64Length(n: number): number {
	return math.ceil(n / 3) * 4;
}

/** RFC 4648 base64 of a buffer (with `=` padding). */
export function base64Encode(buf: buffer): string {
	const n = buffer.len(buf);
	const out = buffer.create(base64Length(n));
	let o = 0;
	let i = 0;
	while (i < n) {
		const b0 = buffer.readu8(buf, i);
		const b1 = i + 1 < n ? buffer.readu8(buf, i + 1) : 0;
		const b2 = i + 2 < n ? buffer.readu8(buf, i + 2) : 0;
		const v = b0 * WORD + b1 * BYTE + b2;
		buffer.writeu8(out, o, ENCODE_TABLE[math.floor(v / TRIPLE)]);
		buffer.writeu8(out, o + 1, ENCODE_TABLE[math.floor(v / PAIR) % SEXTET]);
		buffer.writeu8(out, o + 2, i + 1 < n ? ENCODE_TABLE[math.floor(v / SEXTET) % SEXTET] : PAD);
		buffer.writeu8(out, o + 3, i + 2 < n ? ENCODE_TABLE[v % SEXTET] : PAD);
		i += 3;
		o += 4;
	}
	return buffer.tostring(out);
}

/**
 * The bytes of strict base64 text (length a multiple of 4, only the alphabet, `=` only as the last one or two
 * characters, zero padding bits), or undefined.
 */
export function base64Decode(text: string): buffer | undefined {
	const src = buffer.fromstring(text);
	const len = buffer.len(src);
	if (len % 4 !== 0) return undefined;
	let pad = 0;
	if (len > 0 && buffer.readu8(src, len - 1) === PAD) pad++;
	if (len > 1 && buffer.readu8(src, len - 2) === PAD) pad++;
	const n = (len / 4) * 3 - pad;
	const out = buffer.create(n);
	let o = 0;
	let i = 0;
	while (i < len) {
		const last = i + 4 === len;
		const s: number[] = [];
		for (let k = 0; k < 4; k++) {
			const c = buffer.readu8(src, i + k);
			if (c === PAD) {
				if (!last || k < 4 - pad) return undefined;
				s.push(0);
				continue;
			}
			const d = DECODE_TABLE[c];
			if (d < 0) return undefined;
			s.push(d);
		}
		const v = s[0] * TRIPLE + s[1] * PAIR + s[2] * SEXTET + s[3];
		buffer.writeu8(out, o, math.floor(v / WORD));
		if (o + 1 < n) buffer.writeu8(out, o + 1, math.floor(v / BYTE) % BYTE);
		else if (math.floor(v / BYTE) % BYTE !== 0) return undefined;
		if (o + 2 < n) buffer.writeu8(out, o + 2, v % BYTE);
		else if (v % BYTE !== 0) return undefined;
		i += 4;
		o += 3;
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Encode

/** One block's recording: ticks [start, start + count) of every stream. */
function blockOf(rec: Readonly<Recording>, start: number, count: number): Recording {
	const frames: InputFrame[] = [];
	const last = start + count - 1;
	for (let t = start; t <= last; t++) frames.push(rec.frames[t]);
	const out: Recording = { seed: rec.seed, spawn: { x: rec.spawn.x, z: rec.spawn.z }, frames };
	if (rec.others !== undefined) {
		const others: InputFrame[][] = [];
		for (const stream of rec.others) {
			const s: InputFrame[] = [];
			for (let t = start; t <= last; t++) s.push(stream[t]);
			others.push(s);
		}
		out.others = others;
	}
	return out;
}

/**
 * Packs encoded blocks into chunks and their meta. Throws (error(msg, 0)) on no blocks or a chunk size below 4: a
 * capture always has at least one tick.
 */
export function packCapture(
	setup: Readonly<RollbackCaptureSetup>,
	info: Readonly<RollbackCaptureInfo>,
	players: number,
	blocks: ReadonlyArray<buffer>,
	blockTicks: ReadonlyArray<number>,
	chunkChars: number = ROLLBACK_CAPTURE.chunkChars,
): EncodedCapture {
	if (blocks.size() === 0 || blocks.size() !== blockTicks.size()) error("packCapture: no blocks", 0);
	if (chunkChars < 4) error("packCapture: chunkChars below 4", 0);
	let bytes = 0;
	let ticks = 0;
	const blockBytes: number[] = [];
	for (let i = 0; i < blocks.size(); i++) {
		const len = buffer.len(blocks[i]);
		blockBytes.push(len);
		bytes += len;
		ticks += blockTicks[i];
	}
	const joined = buffer.create(bytes);
	let at = 0;
	for (const b of blocks) {
		buffer.copy(joined, at, b, 0);
		at += buffer.len(b);
	}
	const text = base64Encode(joined);
	const chunks: string[] = [];
	let from = 1;
	while (from <= text.size()) {
		chunks.push(text.sub(from, from + chunkChars - 1));
		from += chunkChars;
	}
	const meta: RollbackCaptureMeta = {
		v: ROLLBACK_CAPTURE.version,
		setup,
		info,
		players,
		ticks,
		blockTicks: [...blockTicks],
		blockBytes,
		bytes,
		chunks: chunks.size(),
		encoding: ENCODING,
	};
	return { meta, chunks };
}

/**
 * A whole recording as a capture: blocks of `blockTicks`, chunks of `chunkChars`. Throws (encodeRecording's errors,
 * or an empty recording) on what no live run produces.
 */
export function encodeCapture(
	setup: Readonly<RollbackCaptureSetup>,
	recording: Readonly<Recording>,
	info: Readonly<RollbackCaptureInfo>,
	chunkChars: number = ROLLBACK_CAPTURE.chunkChars,
	blockTicks: number = ROLLBACK_CAPTURE.blockTicks,
): EncodedCapture {
	const n = recording.frames.size();
	if (n === 0) error("encodeCapture: an empty recording", 0);
	const blocks: buffer[] = [];
	const ticks: number[] = [];
	let start = 0;
	while (start < n) {
		const count = math.min(blockTicks, n - start);
		blocks.push(encodeRecording(blockOf(recording, start, count)));
		ticks.push(count);
		start += count;
	}
	const players = recording.others !== undefined ? recording.others.size() + 1 : 1;
	return packCapture(setup, info, players, blocks, ticks, chunkChars);
}

// ---------------------------------------------------------------------------------------------
// The server's recorder

/** What the recorder reads (shared/lockstep PartyRunLog has this shape). */
export interface RollbackCaptureLog {
	readonly seed: number;
	readonly spawn: { readonly x: number; readonly z: number };
	readonly players: number;
	/** Ticks logged (released ones included). */
	ticks(): number;
	/** First tick still held. */
	firstHeldTick(): number;
	/** The merged frame of a held tick. */
	frameAt(t: number): ReadonlyArray<InputFrame>;
}

/**
 * Follows a party run's merged log as it grows (`pull` after every lockstep step), encoding every `blockTicks` ticks
 * into a block so only the open block's frames are held. The log releases ticks once they are validated; `pull` after
 * every step reads them first (a step releases only ticks below what earlier steps finalized). A tick released before
 * it was read, or an encode failure, stops the recorder with `problem` set; past ROLLBACK_CAPTURE.maxTicks it stops
 * as truncated. It never throws.
 */
export class RollbackCaptureRecorder {
	private cursor = 0;
	private pending: InputFrame[][] = [];
	private pendingTicks = 0;
	private readonly blocks: buffer[] = [];
	private readonly blockTicks: number[] = [];
	private problem: string | undefined;
	private stopped = false;

	constructor(
		private readonly log: RollbackCaptureLog,
		private readonly blockSize: number = ROLLBACK_CAPTURE.blockTicks,
		private readonly maxTicks: number = ROLLBACK_CAPTURE.maxTicks,
	) {
		this.resetPending();
	}

	/** Reads every tick logged since the last pull. */
	pull(): void {
		if (this.stopped) return;
		const log = this.log;
		const last = log.ticks();
		if (this.cursor < last && this.cursor < log.firstHeldTick()) {
			this.stop(`ticks ${this.cursor}..${log.firstHeldTick() - 1} were released before the recorder read them`);
			return;
		}
		while (this.cursor < last) {
			if (this.cursor >= this.maxTicks) {
				if (this.pendingTicks > 0) this.flush();
				this.stop(`truncated at ${this.maxTicks} ticks`);
				return;
			}
			const merged = log.frameAt(this.cursor);
			for (let i = 0; i < log.players; i++) this.pending[i].push(merged[i]);
			this.pendingTicks++;
			this.cursor++;
			if (this.pendingTicks >= this.blockSize) this.flush();
			if (this.stopped) return;
		}
	}

	/** Ticks read so far. */
	ticks(): number {
		return this.cursor;
	}

	/** Why the recorder stopped early, if it did. */
	getProblem(): string | undefined {
		return this.problem;
	}

	/** Finishes the open block; the capture's chunks and meta, or undefined when it holds no tick. */
	finish(
		setup: Readonly<RollbackCaptureSetup>,
		info: Readonly<Omit<RollbackCaptureInfo, "problem">>,
		chunkChars: number = ROLLBACK_CAPTURE.chunkChars,
	): EncodedCapture | undefined {
		if (this.pendingTicks > 0) this.flush();
		this.stopped = true;
		if (this.blocks.size() === 0) return undefined;
		const full: RollbackCaptureInfo = this.problem !== undefined ? { ...info, problem: this.problem } : info;
		return packCapture(setup, full, this.log.players, this.blocks, this.blockTicks, chunkChars);
	}

	/** Stops recording and drops everything held (the switch went off mid-run): `finish` then returns undefined. */
	abandon(why: string): void {
		this.stop(why);
		this.blocks.clear();
		this.blockTicks.clear();
	}

	private resetPending(): void {
		this.pending = [];
		for (let i = 0; i < this.log.players; i++) this.pending.push([]);
		this.pendingTicks = 0;
	}

	private flush(): void {
		const log = this.log;
		const rec: Recording = { seed: log.seed, spawn: { x: log.spawn.x, z: log.spawn.z }, frames: this.pending[0] };
		if (log.players > 1) {
			const others: InputFrame[][] = [];
			for (let i = 1; i < log.players; i++) others.push(this.pending[i]);
			rec.others = others;
		}
		const count = this.pendingTicks;
		const [ok, out] = pcall(() => encodeRecording(rec));
		this.resetPending();
		if (!ok) {
			this.stop(`encode failed: ${tostring(out)}`);
			return;
		}
		this.blocks.push(out as buffer);
		this.blockTicks.push(count);
	}

	private stop(why: string): void {
		this.problem = why;
		this.stopped = true;
		this.resetPending();
	}
}

// ---------------------------------------------------------------------------------------------
// Decode

function asTable(v: unknown): Record<string, unknown> | undefined {
	return typeIs(v, "table") ? (v as Record<string, unknown>) : undefined;
}

function isInt(v: unknown, min: number, max: number): v is number {
	return typeIs(v, "number") && v === v && v >= min && v <= max && v % 1 === 0;
}

function shortString(v: unknown, max: number): v is string {
	return typeIs(v, "string") && v.size() <= max;
}

/** An array (a table with exactly 1..n keys) of integers in [min, max]; undefined otherwise. */
function intList(v: unknown, maxLen: number, min: number, max: number): number[] | undefined {
	if (!typeIs(v, "table")) return undefined;
	const list = v as ReadonlyArray<unknown>;
	const n = list.size();
	if (n > maxLen) return undefined;
	let keys = 0;
	for (const [key] of pairs(v as unknown as ReadonlyMap<unknown, unknown>)) if (key !== undefined) keys++;
	if (keys !== n) return undefined;
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const x = list[i];
		if (!isInt(x, min, max)) return undefined;
		out.push(x);
	}
	return out;
}

function readSetup(v: unknown): RollbackCaptureSetup | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	const C = ROLLBACK_CAPTURE;
	if (!shortString(t.worldKind, C.maxWorldKindChars) || t.worldKind.size() === 0) return undefined;
	if (!isInt(t.seed, 0, U32_LIMIT - 1) || !isInt(t.partySize, 1, MAX_PARTY_SIZE)) return undefined;
	if (!typeIs(t.atBossDoor, "boolean") || !typeIs(t.debug, "boolean")) return undefined;
	if (!isInt(t.ruleset, 0, U32_LIMIT) || !isInt(t.placeVersion, 0, U32_LIMIT)) return undefined;
	let daily: { day: number; ruleset: number } | undefined;
	if (t.daily !== undefined) {
		const d = asTable(t.daily);
		if (d === undefined || !isInt(d.day, 0, U32_LIMIT) || !isInt(d.ruleset, 0, U32_LIMIT)) return undefined;
		daily = { day: d.day, ruleset: d.ruleset };
	}
	const out: RollbackCaptureSetup = {
		worldKind: t.worldKind,
		seed: t.seed,
		partySize: t.partySize,
		atBossDoor: t.atBossDoor,
		debug: t.debug,
		ruleset: t.ruleset,
		placeVersion: t.placeVersion,
	};
	return daily !== undefined ? { ...out, daily } : out;
}

function readEnd(v: unknown, players: number): RollbackCaptureEnd | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	const C = ROLLBACK_CAPTURE;
	if (!shortString(t.status, C.maxWorldKindChars)) return undefined;
	if (t.ok !== undefined && !typeIs(t.ok, "boolean")) return undefined;
	if (t.code !== undefined && !shortString(t.code, C.maxWorldKindChars)) return undefined;
	if (t.reason !== undefined && !shortString(t.reason, C.maxReasonChars)) return undefined;
	if (!isInt(t.verifiedTicks, 0, C.maxTicks) || !shortString(t.serverHash, C.maxIdChars)) return undefined;
	const left = intList(t.leftFromTick, players, NOT_LEFT, C.maxTicks);
	if (left === undefined || left.size() !== players) return undefined;
	return {
		status: t.status,
		ok: t.ok,
		code: t.code as string | undefined,
		reason: t.reason as string | undefined,
		verifiedTicks: t.verifiedTicks,
		serverHash: t.serverHash,
		leftFromTick: left,
	};
}

function readInfo(v: unknown, players: number): RollbackCaptureInfo | undefined {
	const t = asTable(v);
	if (t === undefined || !isRollbackKeyId(t.runId) || !isInt(t.capturedAt, 0, U32_LIMIT * U32_LIMIT)) {
		return undefined;
	}
	if (t.problem !== undefined && !shortString(t.problem, ROLLBACK_CAPTURE.maxReasonChars)) return undefined;
	let ending: RollbackCaptureEnd | undefined;
	if (t.end !== undefined) {
		ending = readEnd(t.end, players);
		if (ending === undefined) return undefined;
	}
	return { runId: t.runId, capturedAt: t.capturedAt, end: ending, problem: t.problem as string | undefined };
}

/**
 * A capture meta re-read, or undefined: version, setup, info, encoding, players 1..MAX_PARTY_SIZE (= setup.partySize),
 * block lists of equal length (1..maxTicks entries) whose sums are `ticks` and `bytes`, ticks 1..maxTicks, chunk count
 * 1..maxChunks. Only the listed keys are kept.
 */
export function readCaptureMeta(v: unknown): RollbackCaptureMeta | undefined {
	const t = asTable(v);
	const C = ROLLBACK_CAPTURE;
	if (t === undefined || t.v !== C.version || t.encoding !== ENCODING) return undefined;
	if (!isInt(t.players, 1, MAX_PARTY_SIZE) || !isInt(t.ticks, 1, C.maxTicks)) return undefined;
	if (!isInt(t.bytes, 1, C.maxBytes) || !isInt(t.chunks, 1, C.maxChunks)) return undefined;
	const setup = readSetup(t.setup);
	if (setup === undefined || setup.partySize !== t.players) return undefined;
	const info = readInfo(t.info, t.players);
	if (info === undefined) return undefined;
	const blockTicks = intList(t.blockTicks, C.maxTicks, 1, C.maxTicks);
	const blockBytes = intList(t.blockBytes, C.maxTicks, 1, t.bytes);
	if (blockTicks === undefined || blockBytes === undefined || blockTicks.size() !== blockBytes.size()) {
		return undefined;
	}
	if (blockTicks.size() === 0) return undefined;
	let ticks = 0;
	let bytes = 0;
	for (let i = 0; i < blockTicks.size(); i++) {
		ticks += blockTicks[i];
		bytes += blockBytes[i];
	}
	if (ticks !== t.ticks || bytes !== t.bytes) return undefined;
	return {
		v: t.v,
		setup,
		info,
		players: t.players,
		ticks,
		blockTicks,
		blockBytes,
		bytes,
		chunks: t.chunks,
		encoding: ENCODING,
	};
}

function decodeUnsafe(rawMeta: unknown, rawChunks: unknown): DecodedCapture | undefined {
	const meta = readCaptureMeta(rawMeta);
	if (meta === undefined || !typeIs(rawChunks, "table")) return undefined;
	const list = rawChunks as ReadonlyArray<unknown>;
	if (list.size() !== meta.chunks) return undefined;
	const parts: string[] = [];
	for (let i = 0; i < list.size(); i++) {
		const c = list[i];
		if (!typeIs(c, "string") || c.size() === 0) return undefined;
		parts.push(c);
	}
	const text = parts.join("");
	if (text.size() !== base64Length(meta.bytes)) return undefined;
	const bytes = base64Decode(text);
	if (bytes === undefined || buffer.len(bytes) !== meta.bytes) return undefined;

	const streams: InputFrame[][] = [];
	for (let i = 0; i < meta.players; i++) streams.push([]);
	let seed: number | undefined;
	let spawn: { x: number; z: number } | undefined;
	let at = 0;
	for (let b = 0; b < meta.blockTicks.size(); b++) {
		const len = meta.blockBytes[b];
		const block = buffer.create(len);
		buffer.copy(block, 0, bytes, at, len);
		at += len;
		const r = decodeRecording(block, { maxTicks: meta.blockTicks[b], maxRecordingBytes: len });
		if (!r.ok) return undefined;
		const rec = r.recording;
		const players = rec.others !== undefined ? rec.others.size() + 1 : 1;
		if (players !== meta.players || rec.frames.size() !== meta.blockTicks[b]) return undefined;
		if (seed === undefined || spawn === undefined) {
			seed = rec.seed;
			spawn = { x: rec.spawn.x, z: rec.spawn.z };
		} else if (rec.seed !== seed || rec.spawn.x !== spawn.x || rec.spawn.z !== spawn.z) {
			return undefined;
		}
		for (const f of rec.frames) streams[0].push(f);
		if (rec.others !== undefined) {
			for (let i = 1; i < players; i++) for (const f of rec.others[i - 1]) streams[i].push(f);
		}
	}
	if (seed === undefined || spawn === undefined || seed !== meta.setup.seed) return undefined;
	const recording: Recording = { seed, spawn, frames: streams[0] };
	if (meta.players > 1) {
		const others: InputFrame[][] = [];
		for (let i = 1; i < meta.players; i++) others.push(streams[i]);
		recording.others = others;
	}
	return { setup: meta.setup, info: meta.info, recording };
}

/** The capture in `meta` + `chunks` (as stored or as the receiver wrote them), or undefined. Never throws. */
export function decodeCapture(meta: unknown, chunks: unknown): DecodedCapture | undefined {
	const [ok, out] = pcall(decodeUnsafe, meta, chunks);
	return ok ? (out as DecodedCapture | undefined) : undefined;
}
