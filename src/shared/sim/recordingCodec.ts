/**
 * Compact binary form of a Recording, carried as a Luau `buffer` over the `submitRun` remote (shared/network.ts). The
 * JSON form (replay.ts `serializeRecording`) stays the fixtures' format; the server only accepts this one.
 *
 * Why: the JSON form costs ~21.6 characters per tick once the mouse moves (aim changes almost every tick), so a
 * 20-minute run would be ~1.5 MB. This costs 1 byte per run of identical frames plus 1-2 bytes per changed field
 * (docs/SERVER.md has the measured bytes per tick).
 *
 * Layout (little-endian, like `buffer.write*`):
 *
 *   byte 0      format version (BINARY_RECORDING_VERSION)
 *   bytes 1-4   seed, u32
 *   bytes 5-12  spawn x, f64 (exact: no decimal round trip)
 *   bytes 13-20 spawn z, f64
 *   varint      n = frame count
 *   runs        until they cover exactly n frames, then the buffer must end:
 *     u8 tag    bits 0-4: which fields differ from the previous run's frame (moveX, moveZ, aimX, aimZ, buttons; the
 *               frame before the first run is EMPTY_INPUT). bits 5-7: run length code c: c < 7 means c + 1 frames,
 *               c = 7 means RUN_LENGTH_EXTENDED + a varint.
 *     per set bit, in field order: an axis is a zigzag varint of (value - previous); buttons is a varint of
 *               (value XOR previous).
 *
 * Varints are unsigned LEB128, 7 bits per byte, low group first, at most VARINT_MAX_BYTES bytes, minimal (no trailing
 * zero group). Zigzag maps 0, -1, 1, -2, ... to 0, 1, 2, 3, ...
 *
 * Plain delta was picked over a linear predictor (value - 2 * prev + prevprev): the predictor only wins on the
 * scripted bot's perfectly smooth sweeps (run-boss-1337: 3.8 vs 5.1 bytes per tick) and loses on keyboard movement
 * and every other fixture, where axes jump between a few fixed values.
 *
 * The encoding is canonical: identical consecutive frames are always one run and a flagged field always changes, so a
 * recording has exactly one encoding and the decoder rejects anything else. Decoding is written for hostile input:
 * every read is bounds-checked, the frame count is checked against `maxTicks` before a single frame is built, a run
 * may never cover more frames than `n` declares, and every value is range-checked. It never throws.
 *
 * Co-op party variant (M4; `recording.others` present): the same runs, one stream per player, back to back:
 *
 *   byte 0      PARTY_BINARY_RECORDING_VERSION
 *   byte 1      player count n (2 .. MAX_PARTY_SIZE)
 *   bytes 2-21  seed u32, spawn x f64, spawn z f64 (as above)
 *   varint      frame count (per player: every stream covers exactly this many frames)
 *   n streams   player 0's runs, then player 1's, ...: each exactly the solo run encoding above (its own previous
 *               frame, starting from EMPTY_INPUT)
 *
 * Buttons (both variants): SIM_BUTTONS plus PARTY_LEFT_BUTTON = FORFEIT_BUTTON (RECORDED_BUTTONS): the server's leave
 * mark in a party stream, the player's "Leave run" in a solo one (L6a). Allowing it changed no encoding: a solo
 * recording (no `others`) encodes byte for byte as version 1, as before. Per-player streams compress far
 * better than interleaved frames (each player's input is smooth on its own).
 *
 * Pure and deterministic (integer arithmetic and the `buffer` library only); it lives in src/shared/sim, under the
 * headless runner's determinism guard.
 *
 * @module
 */
import { AXIS_MAX, EMPTY_INPUT, SIM_BUTTONS, isValidSimInput, type InputFrame } from "./input";
import { isFiniteNumber, isIntegerNumber } from "./jsnum";
import type { Recording } from "./replay";
import { FORFEIT_BUTTON, MAX_PARTY_SIZE, PARTY_LEFT_BUTTON } from "./partyData";

/** Byte 0 of every (solo) binary recording. */
export const BINARY_RECORDING_VERSION = 1;
/** Byte 0 of a co-op party recording (byte 1 = player count). */
export const PARTY_BINARY_RECORDING_VERSION = 2;
/** Party header: version (1) + player count (1) + seed (4) + spawn x (8) + spawn z (8). */
export const PARTY_BINARY_RECORDING_HEADER_BYTES = 22;
/** Every bit a party stream's buttons may carry: SIM_BUTTONS plus the leave mark. */
export const PARTY_SIM_BUTTONS = bit32.bor(SIM_BUTTONS, PARTY_LEFT_BUTTON);
/**
 * Every bit a recorded frame may carry, solo or party: SIM_BUTTONS plus FORFEIT_BUTTON (= PARTY_LEFT_BUTTON, so this
 * equals PARTY_SIM_BUTTONS; one bit, one meaning: the player leaves the run for good).
 */
export const RECORDED_BUTTONS = bit32.bor(SIM_BUTTONS, FORFEIT_BUTTON, PARTY_LEFT_BUTTON);
/** The recorded bits beyond SIM_BUTTONS (the one leave / forfeit bit). */
const LEAVE_BITS = bit32.bor(FORFEIT_BUTTON, PARTY_LEFT_BUTTON);
const MIN_PARTY_STREAMS = 2;

const OFFSET_SEED = 1;
const OFFSET_SPAWN_X = 5;
const OFFSET_SPAWN_Z = 13;
/** Fixed header: version (1) + seed (4) + spawn x (8) + spawn z (8). */
export const BINARY_RECORDING_HEADER_BYTES = 21;
const U32_BYTES = 4;
const F64_BYTES = 8;
const TWO_POW_32 = 4294967296;

/** Tag bits 0-4: one per field, in this order. */
const FIELD_MOVE_X = 1;
const FIELD_MOVE_Z = 2;
const FIELD_AIM_X = 4;
const FIELD_AIM_Z = 8;
const FIELD_BUTTONS = 16;
/** Tag value of one step of the run length code (bits 5-7). */
const RUN_CODE_UNIT = 32;
/** Run length code meaning "RUN_LENGTH_EXTENDED + varint". Codes below it store `length - 1` inline. */
const RUN_CODE_EXTENDED = 7;
const RUN_LENGTH_EXTENDED = RUN_CODE_EXTENDED + 1;

/** Varint: 7 payload bits per byte; a byte at or above VARINT_CONTINUE has more bytes after it. */
const VARINT_CONTINUE = 128;
/** At most 4 bytes (values below 2^28): far above any frame count or field this format carries. */
const VARINT_MAX_BYTES = 4;

const INITIAL_WRITER_BYTES = 256;

export type RecordingDecodeError = "too_large" | "too_long" | "malformed";

export type RecordingDecodeResult =
	| { readonly ok: true; readonly recording: Recording }
	| { readonly ok: false; readonly code: RecordingDecodeError; readonly reason: string };

/** The caps decodeRecording enforces (RunLimits satisfies this). */
export interface RecordingDecodeLimits {
	/** Reject more frames than this, before any frame is built. */
	readonly maxTicks: number;
	/** Reject buffers longer than this, before reading anything. */
	readonly maxRecordingBytes: number;
}

// ---------------------------------------------------------------------------------------------
// Encode

function zigzag(d: number): number {
	return d >= 0 ? d * 2 : -d * 2 - 1;
}

function unzigzag(z: number): number {
	return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
}

/** A growable byte buffer (doubles when full); `finish()` returns an exact-size copy. */
class ByteWriter {
	private buf = buffer.create(INITIAL_WRITER_BYTES);
	private size = 0;

	private ensure(extra: number): void {
		const need = this.size + extra;
		let cap = buffer.len(this.buf);
		if (need <= cap) return;
		while (cap < need) cap *= 2;
		const grown = buffer.create(cap);
		buffer.copy(grown, 0, this.buf, 0, this.size);
		this.buf = grown;
	}

	u8(v: number): void {
		this.ensure(1);
		buffer.writeu8(this.buf, this.size, v);
		this.size += 1;
	}

	u32(v: number): void {
		this.ensure(U32_BYTES);
		buffer.writeu32(this.buf, this.size, v);
		this.size += U32_BYTES;
	}

	f64(v: number): void {
		this.ensure(F64_BYTES);
		buffer.writef64(this.buf, this.size, v);
		this.size += F64_BYTES;
	}

	varint(v: number): void {
		let rest = v;
		while (rest >= VARINT_CONTINUE) {
			this.u8((rest % VARINT_CONTINUE) + VARINT_CONTINUE);
			rest = math.floor(rest / VARINT_CONTINUE);
		}
		this.u8(rest);
	}

	finish(): buffer {
		const out = buffer.create(this.size);
		buffer.copy(out, 0, this.buf, 0, this.size);
		return out;
	}
}

function encodeFail(message: string): never {
	return error(`encodeRecording: ${message}`, 0);
}

function sameFrame(a: Readonly<InputFrame>, b: Readonly<InputFrame>): boolean {
	return (
		a.moveX === b.moveX && a.moveZ === b.moveZ && a.aimX === b.aimX && a.aimZ === b.aimZ && a.buttons === b.buttons
	);
}

/** A valid recorded frame (solo or party stream): isValidSimInput, with FORFEIT_BUTTON / PARTY_LEFT_BUTTON allowed. */
function isValidRecordedFrame(frame: Readonly<InputFrame>): boolean {
	if (isValidSimInput(frame)) return true;
	const b = frame.buttons;
	if (!isIntegerNumber(b) || b < 0 || bit32.band(b, LEAVE_BITS) === 0) return false;
	return isValidSimInput({ ...frame, buttons: bit32.band(b, bit32.bnot(LEAVE_BITS)) });
}

/**
 * The binary form of `recording` (see the file comment). Throws on what no live run produces: a seed outside
 * [0, 2^32), a non-finite spawn, or an invalid frame (shared/sim `isValidSimInput`: the web bits plus PORT_BUTTONS,
 * plus the leave / forfeit bit: RECORDED_BUTTONS), or party streams of the wrong count / length.
 */
export function encodeRecording(recording: Readonly<Recording>): buffer {
	const seed = recording.seed;
	if (!isIntegerNumber(seed) || seed < 0 || seed >= TWO_POW_32) encodeFail("seed must be an integer in [0, 2^32)");
	if (!isFiniteNumber(recording.spawn.x) || !isFiniteNumber(recording.spawn.z)) encodeFail("spawn must be finite");
	const frames = recording.frames;
	const count = frames.size();
	const others = recording.others;
	const w = new ByteWriter();
	if (others === undefined) {
		w.u8(BINARY_RECORDING_VERSION);
	} else {
		const n = others.size() + 1;
		if (n < MIN_PARTY_STREAMS || n > MAX_PARTY_SIZE) encodeFail(`party of ${n} players`);
		for (let k = 0; k < others.size(); k++) {
			if (others[k].size() !== count) encodeFail(`player ${k + 1} has ${others[k].size()} frames, not ${count}`);
		}
		w.u8(PARTY_BINARY_RECORDING_VERSION);
		w.u8(n);
	}
	w.u32(seed);
	w.f64(recording.spawn.x);
	w.f64(recording.spawn.z);
	w.varint(count);
	if (others === undefined) {
		encodeRuns(w, frames, "");
	} else {
		encodeRuns(w, frames, "player 0 ");
		for (let k = 0; k < others.size(); k++) encodeRuns(w, others[k], `player ${k + 1} `);
	}
	return w.finish();
}

/** One stream of runs (the solo encoding) for `frames`, from EMPTY_INPUT. */
function encodeRuns(w: ByteWriter, frames: ReadonlyArray<InputFrame>, who: string): void {
	const count = frames.size();
	let prev: Readonly<InputFrame> = EMPTY_INPUT;
	let i = 0;
	while (i < count) {
		const a = frames[i];
		if (!isValidRecordedFrame(a)) encodeFail(`invalid ${who}frame at ${i}`);
		let j = i + 1;
		while (j < count && sameFrame(frames[j], a)) j++;
		const length = j - i;

		let mask = 0;
		if (a.moveX !== prev.moveX) mask += FIELD_MOVE_X;
		if (a.moveZ !== prev.moveZ) mask += FIELD_MOVE_Z;
		if (a.aimX !== prev.aimX) mask += FIELD_AIM_X;
		if (a.aimZ !== prev.aimZ) mask += FIELD_AIM_Z;
		if (a.buttons !== prev.buttons) mask += FIELD_BUTTONS;
		const code = length < RUN_LENGTH_EXTENDED ? length - 1 : RUN_CODE_EXTENDED;
		w.u8(mask + code * RUN_CODE_UNIT);
		if (code === RUN_CODE_EXTENDED) w.varint(length - RUN_LENGTH_EXTENDED);
		if (a.moveX !== prev.moveX) w.varint(zigzag(a.moveX - prev.moveX));
		if (a.moveZ !== prev.moveZ) w.varint(zigzag(a.moveZ - prev.moveZ));
		if (a.aimX !== prev.aimX) w.varint(zigzag(a.aimX - prev.aimX));
		if (a.aimZ !== prev.aimZ) w.varint(zigzag(a.aimZ - prev.aimZ));
		if (a.buttons !== prev.buttons) w.varint(bit32.bxor(a.buttons, prev.buttons));

		prev = a;
		i = j;
	}
}

// ---------------------------------------------------------------------------------------------
// Decode

interface DecodeFailure {
	readonly code: RecordingDecodeError;
	readonly reason: string;
}

/** Aborts the decode (caught in decodeRecording, which turns it into a result). */
function fail(code: RecordingDecodeError, reason: string): never {
	const failure: DecodeFailure = { code, reason };
	return error(failure, 0);
}

function isDecodeFailure(v: unknown): v is DecodeFailure {
	return typeIs(v, "table") && typeIs((v as DecodeFailure).code, "string");
}

/** Bounds-checked reads over one buffer. */
class ByteReader {
	pos = 0;
	readonly len: number;

	constructor(private readonly buf: buffer) {
		this.len = buffer.len(buf);
	}

	private need(bytes: number, what: string): void {
		if (this.pos + bytes > this.len)
			fail("malformed", `malformed recording: truncated ${what} at byte ${this.pos}`);
	}

	u8(what: string): number {
		this.need(1, what);
		const v = buffer.readu8(this.buf, this.pos);
		this.pos += 1;
		return v;
	}

	u32(what: string): number {
		this.need(U32_BYTES, what);
		const v = buffer.readu32(this.buf, this.pos);
		this.pos += U32_BYTES;
		return v;
	}

	f64(what: string): number {
		this.need(F64_BYTES, what);
		const v = buffer.readf64(this.buf, this.pos);
		this.pos += F64_BYTES;
		return v;
	}

	/** Unsigned LEB128: at most VARINT_MAX_BYTES bytes, minimal (a multi-byte varint never ends in a zero group). */
	varint(what: string): number {
		const start = this.pos;
		let value = 0;
		let scale = 1;
		for (let i = 0; i < VARINT_MAX_BYTES; i++) {
			const byte = this.u8(what);
			if (byte < VARINT_CONTINUE) {
				if (byte === 0 && i > 0) fail("malformed", `malformed recording: overlong ${what} at byte ${start}`);
				return value + byte * scale;
			}
			value += (byte - VARINT_CONTINUE) * scale;
			scale *= VARINT_CONTINUE;
		}
		return fail("malformed", `malformed recording: ${what} longer than ${VARINT_MAX_BYTES} bytes at byte ${start}`);
	}
}

/** prev + the zigzag delta read next, which must change the axis and keep it in [-AXIS_MAX, AXIS_MAX]. */
function readAxis(r: ByteReader, prev: number, frame: number): number {
	const at = r.pos;
	const delta = unzigzag(r.varint("axis delta"));
	if (delta === 0) fail("malformed", `malformed recording: unchanged axis flagged at byte ${at}`);
	const v = prev + delta;
	if (v < -AXIS_MAX || v > AXIS_MAX) fail("malformed", `malformed recording: axis out of range at frame ${frame}`);
	return v;
}

function decodeUnsafe(buf: buffer, limits: RecordingDecodeLimits): Recording {
	const r = new ByteReader(buf);
	if (r.len > limits.maxRecordingBytes) {
		fail("too_large", `recording too large: ${r.len} bytes (max ${limits.maxRecordingBytes})`);
	}
	if (r.len < BINARY_RECORDING_HEADER_BYTES) fail("malformed", `malformed recording: ${r.len}-byte header`);
	const version = r.u8("version");
	let players = 1;
	if (version === PARTY_BINARY_RECORDING_VERSION) {
		if (r.len < PARTY_BINARY_RECORDING_HEADER_BYTES) fail("malformed", `malformed recording: ${r.len}-byte header`);
		players = r.u8("player count");
		if (players < MIN_PARTY_STREAMS || players > MAX_PARTY_SIZE) {
			fail("malformed", `malformed recording: party of ${players} players`);
		}
	} else if (version !== BINARY_RECORDING_VERSION) {
		fail("malformed", `malformed recording: unsupported version ${version}`);
	}
	const seed = r.u32("seed");
	const spawnX = r.f64("spawn");
	const spawnZ = r.f64("spawn");
	if (!isFiniteNumber(spawnX) || !isFiniteNumber(spawnZ)) fail("malformed", "malformed recording: spawn not finite");

	// The frame count is bounded BEFORE a single frame is built; runs may never cover more than it.
	const n = r.varint("frame count");
	if (n > limits.maxTicks) fail("too_long", `run too long: ${n} ticks (max ${limits.maxTicks})`);

	if (players === 1) {
		const frames = decodeRuns(r, n, RECORDED_BUTTONS, "");
		if (r.pos !== r.len) fail("malformed", `malformed recording: ${r.len - r.pos} trailing bytes`);
		return { seed, spawn: { x: spawnX, z: spawnZ }, frames };
	}
	const frames = decodeRuns(r, n, RECORDED_BUTTONS, "player 0 ");
	const others: InputFrame[][] = [];
	for (let k = 1; k < players; k++) others.push(decodeRuns(r, n, RECORDED_BUTTONS, `player ${k} `));
	if (r.pos !== r.len) fail("malformed", `malformed recording: ${r.len - r.pos} trailing bytes`);
	return { seed, spawn: { x: spawnX, z: spawnZ }, frames, others };
}

/** One stream of runs covering exactly `n` frames (buttons within `buttonMask`). */
function decodeRuns(r: ByteReader, n: number, buttonMask: number, who: string): InputFrame[] {
	const frames: InputFrame[] = [];
	let prev: Readonly<InputFrame> = EMPTY_INPUT;
	let total = 0;
	while (total < n) {
		const at = r.pos;
		const tag = r.u8("run tag");
		const mask = tag % RUN_CODE_UNIT;
		const code = (tag - mask) / RUN_CODE_UNIT;
		const length = code === RUN_CODE_EXTENDED ? RUN_LENGTH_EXTENDED + r.varint("run length") : code + 1;
		if (length > n - total) {
			fail("malformed", `malformed recording: ${who}run at byte ${at} passes frame count ${n}`);
		}
		if (mask === 0 && total > 0) fail("malformed", `malformed recording: run at byte ${at} repeats the last frame`);

		const frame: InputFrame = {
			moveX: bit32.band(mask, FIELD_MOVE_X) !== 0 ? readAxis(r, prev.moveX, total) : prev.moveX,
			moveZ: bit32.band(mask, FIELD_MOVE_Z) !== 0 ? readAxis(r, prev.moveZ, total) : prev.moveZ,
			aimX: bit32.band(mask, FIELD_AIM_X) !== 0 ? readAxis(r, prev.aimX, total) : prev.aimX,
			aimZ: bit32.band(mask, FIELD_AIM_Z) !== 0 ? readAxis(r, prev.aimZ, total) : prev.aimZ,
			buttons: prev.buttons,
		};
		if (bit32.band(mask, FIELD_BUTTONS) !== 0) {
			const flipped = r.varint("buttons");
			if (flipped === 0) fail("malformed", `malformed recording: unchanged buttons flagged at frame ${total}`);
			if (bit32.band(flipped, bit32.bnot(buttonMask)) !== 0) {
				fail("malformed", `malformed recording: unknown button bits at ${who}frame ${total}`);
			}
			frame.buttons = bit32.bxor(prev.buttons, flipped);
		}
		// One frozen table per run, shared by its frames: replay only reads them.
		table.freeze(frame);
		for (let c = 0; c < length; c++) frames.push(frame);
		total += length;
		prev = frame;
	}
	return frames;
}

/**
 * Parses encodeRecording() output under `limits`. Never throws: too long a buffer is `too_large`, more frames than
 * `limits.maxTicks` is `too_long`, anything else wrong (truncation, overlong or out-of-range values, trailing bytes,
 * a non-canonical encoding) is `malformed`. Frames of one run share one frozen table.
 */
export function decodeRecording(buf: buffer, limits: RecordingDecodeLimits): RecordingDecodeResult {
	if (!typeIs(buf, "buffer")) return { ok: false, code: "malformed", reason: "malformed recording: not a buffer" };
	const [ok, result] = pcall(decodeUnsafe, buf, limits);
	if (ok) return { ok: true, recording: result as Recording };
	if (isDecodeFailure(result)) return { ok: false, code: result.code, reason: result.reason };
	// Unreachable unless the decoder has a bug: still a reject, never an error.
	return { ok: false, code: "malformed", reason: `malformed recording: ${tostring(result)}` };
}
