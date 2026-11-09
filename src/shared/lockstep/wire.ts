/**
 * Lockstep wire formats (M4), both Luau `buffer`s (little-endian):
 *
 * Input batch (client -> server, `lockstepInput(runId, firstTick, data)`): INPUT_FRAME_BYTES per frame, frames for
 * consecutive ticks: moveX i16, moveZ i16, aimX i16, aimZ i16, buttons u16. Raw, because a client sends 1-2 frames
 * per call and a delta would need state the server cannot trust.
 *
 * Merged batch (server -> clients, `lockstepFrames(runId, firstTick, data, hashAck, echo)`): every party member gets the
 * same bytes (only the trailing echo is each member's own).
 *   u8 players, u8 ticks, then per tick, per player (index order): u8 field mask (moveX, moveZ, aimX, aimZ, buttons:
 *   bits 0-4) of what differs from THAT player's previous merged frame (EMPTY_INPUT before tick 0), then per set bit
 *   a zigzag varint delta (axes) or a varint XOR (buttons). Reliable ordered delivery (RemoteEvents) keeps encoder and
 *   decoder in step: both start at EMPTY_INPUT and see every batch in order. Typical cost: 1 byte per idle player and
 *   2-4 per moving one per tick (8 players moving: ~25 bytes per tick, ~1.5 KB/s).
 *
 * Input echo (server -> one client, the trailing `echo` of `lockstepFrames`; docs/FRAME_PACING.md Design 9): how early
 * that member's own input that waited longest since the last echo (lowest slack) reached the server, INPUT_ECHO_BYTES:
 * u8 flags (bit 0: has a tick; bit 1: the server was catching up a backlog during the echo's window, so its slack and
 * lates measure the server, not the network), i32 the tick as an offset from the batch's firstTick, i16 slack in 1 / INPUT_ECHO_SLACK_SCALE tick (rounded, saturating), u8 late
 * frames since the last echo (saturating). Without a tick (no input received since the last echo) the offset and
 * slack are 0; the lates may still be counted. Never enters the log, the validator or a hash.
 *
 * Decoders never throw: a malformed buffer is `undefined`.
 */
import { AXIS_MAX, EMPTY_INPUT, PARTY_SIM_BUTTONS, SIM_BUTTONS, copyInput, type InputFrame } from "shared/sim";
import { INPUT_ECHO_BYTES, INPUT_ECHO_SLACK_SCALE } from "./config";

/** Bytes per frame in an input batch. */
export const INPUT_FRAME_BYTES = 10;
const I16_BYTES = 2;
const MERGED_HEADER_BYTES = 2;
const U8_MAX = 255;
const FIELD_MOVE_X = 1;
const FIELD_MOVE_Z = 2;
const FIELD_AIM_X = 4;
const FIELD_AIM_Z = 8;
const FIELD_BUTTONS = 16;
const FIELD_MASK_ALL = 31;
const VARINT_CONTINUE = 128;
const VARINT_MAX_BYTES = 4;
const MERGED_INITIAL_BYTES = 64;
const I16_MIN = -32768;
const I16_MAX = 32767;
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
const ECHO_HAS_TICK = 1;
const ECHO_CATCHING_UP = 2;
const ECHO_FLAGS_ALL = bit32.bor(ECHO_HAS_TICK, ECHO_CATCHING_UP);
const ECHO_OFFSET_AT = 1;
const ECHO_SLACK_AT = 5;
const ECHO_LATES_AT = 7;

// ---------------------------------------------------------------------------------------------
// Input batches

/** frames -> an input batch buffer. */
export function encodeInputBatch(frames: ReadonlyArray<Readonly<InputFrame>>): buffer {
	const b = buffer.create(frames.size() * INPUT_FRAME_BYTES);
	for (let k = 0; k < frames.size(); k++) {
		const f = frames[k];
		const o = k * INPUT_FRAME_BYTES;
		buffer.writei16(b, o, f.moveX);
		buffer.writei16(b, o + I16_BYTES, f.moveZ);
		buffer.writei16(b, o + 2 * I16_BYTES, f.aimX);
		buffer.writei16(b, o + 3 * I16_BYTES, f.aimZ);
		buffer.writeu16(b, o + 4 * I16_BYTES, f.buttons);
	}
	return b;
}

function axisOk(v: number): boolean {
	return v >= -AXIS_MAX && v <= AXIS_MAX;
}

/** An input batch -> frames, or undefined (not a buffer, ragged, over `maxFrames`, an axis or button out of range). */
export function decodeInputBatch(data: unknown, maxFrames: number): InputFrame[] | undefined {
	if (!typeIs(data, "buffer")) return undefined;
	const len = buffer.len(data);
	if (len === 0 || len % INPUT_FRAME_BYTES !== 0 || len / INPUT_FRAME_BYTES > maxFrames) return undefined;
	const out: InputFrame[] = [];
	for (let o = 0; o < len; o += INPUT_FRAME_BYTES) {
		const f: InputFrame = {
			moveX: buffer.readi16(data, o),
			moveZ: buffer.readi16(data, o + I16_BYTES),
			aimX: buffer.readi16(data, o + 2 * I16_BYTES),
			aimZ: buffer.readi16(data, o + 3 * I16_BYTES),
			buttons: buffer.readu16(data, o + 4 * I16_BYTES),
		};
		if (!axisOk(f.moveX) || !axisOk(f.moveZ) || !axisOk(f.aimX) || !axisOk(f.aimZ)) return undefined;
		if (bit32.band(f.buttons, bit32.bnot(SIM_BUTTONS)) !== 0) return undefined;
		out.push(f);
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Merged batches

function zigzag(d: number): number {
	return d >= 0 ? d * 2 : -d * 2 - 1;
}

function unzigzag(z: number): number {
	return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
}

class Writer {
	buf = buffer.create(MERGED_INITIAL_BYTES);
	size = 0;

	u8(v: number): void {
		if (this.size + 1 > buffer.len(this.buf)) {
			const grown = buffer.create(buffer.len(this.buf) * 2);
			buffer.copy(grown, 0, this.buf, 0, this.size);
			this.buf = grown;
		}
		buffer.writeu8(this.buf, this.size, v);
		this.size += 1;
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

/** Server side: encodes merged frames against each player's previous merged frame. */
export class MergedEncoder {
	private readonly prev: InputFrame[] = [];

	constructor(readonly players: number) {
		for (let i = 0; i < players; i++) this.prev.push(copyInput(EMPTY_INPUT));
	}

	/** `ticks[t][i]` = player i's frame of the t-th tick in the batch (at most 255 ticks). */
	encode(ticks: ReadonlyArray<ReadonlyArray<Readonly<InputFrame>>>): buffer {
		if (ticks.size() > U8_MAX) error(`MergedEncoder: ${ticks.size()} ticks in one batch (max ${U8_MAX})`, 0);
		const w = new Writer();
		w.u8(this.players);
		w.u8(ticks.size());
		for (const frames of ticks) {
			if (frames.size() !== this.players) error(`MergedEncoder: ${frames.size()} frames, not ${this.players}`, 0);
			for (let i = 0; i < this.players; i++) {
				const a = frames[i];
				const p = this.prev[i];
				let mask = 0;
				if (a.moveX !== p.moveX) mask += FIELD_MOVE_X;
				if (a.moveZ !== p.moveZ) mask += FIELD_MOVE_Z;
				if (a.aimX !== p.aimX) mask += FIELD_AIM_X;
				if (a.aimZ !== p.aimZ) mask += FIELD_AIM_Z;
				if (a.buttons !== p.buttons) mask += FIELD_BUTTONS;
				w.u8(mask);
				if (a.moveX !== p.moveX) w.varint(zigzag(a.moveX - p.moveX));
				if (a.moveZ !== p.moveZ) w.varint(zigzag(a.moveZ - p.moveZ));
				if (a.aimX !== p.aimX) w.varint(zigzag(a.aimX - p.aimX));
				if (a.aimZ !== p.aimZ) w.varint(zigzag(a.aimZ - p.aimZ));
				if (a.buttons !== p.buttons) w.varint(bit32.bxor(a.buttons, p.buttons));
				copyInput(a, p);
			}
		}
		return w.finish();
	}
}

/** Client side: decodes merged batches in order. A malformed batch returns undefined and leaves the state as it was. */
export class MergedDecoder {
	private readonly prev: InputFrame[] = [];

	constructor(readonly players: number) {
		for (let i = 0; i < players; i++) this.prev.push(copyInput(EMPTY_INPUT));
	}

	decode(data: unknown): InputFrame[][] | undefined {
		if (!typeIs(data, "buffer")) return undefined;
		const [ok, out] = pcall(() => this.decodeUnsafe(data));
		if (!ok || out === undefined) return undefined;
		// Commit the new "previous" frames only once the whole batch decoded.
		const ticks = out as InputFrame[][];
		if (ticks.size() > 0) {
			const lastTick = ticks[ticks.size() - 1];
			for (let i = 0; i < this.players; i++) copyInput(lastTick[i], this.prev[i]);
		}
		return ticks;
	}

	private decodeUnsafe(b: buffer): InputFrame[][] | undefined {
		const len = buffer.len(b);
		if (len < MERGED_HEADER_BYTES) return undefined;
		if (buffer.readu8(b, 0) !== this.players) return undefined;
		const count = buffer.readu8(b, 1);
		let pos = MERGED_HEADER_BYTES;
		const readVarint = (): number | undefined => {
			let value = 0;
			let scale = 1;
			for (let k = 0; k < VARINT_MAX_BYTES; k++) {
				if (pos >= len) return undefined;
				const byte = buffer.readu8(b, pos);
				pos++;
				if (byte < VARINT_CONTINUE) return value + byte * scale;
				value += (byte - VARINT_CONTINUE) * scale;
				scale *= VARINT_CONTINUE;
			}
			return undefined;
		};
		const readAxis = (prev: number): number | undefined => {
			const z = readVarint();
			if (z === undefined) return undefined;
			const v = prev + unzigzag(z);
			return axisOk(v) ? v : undefined;
		};
		const prev: InputFrame[] = this.prev.map((f) => copyInput(f));
		const out: InputFrame[][] = [];
		for (let t = 0; t < count; t++) {
			const frames: InputFrame[] = [];
			for (let i = 0; i < this.players; i++) {
				if (pos >= len) return undefined;
				const mask = buffer.readu8(b, pos);
				pos++;
				if (bit32.band(mask, bit32.bnot(FIELD_MASK_ALL)) !== 0) return undefined;
				const p = prev[i];
				const f = copyInput(p);
				if (bit32.band(mask, FIELD_MOVE_X) !== 0) {
					const v = readAxis(p.moveX);
					if (v === undefined) return undefined;
					f.moveX = v;
				}
				if (bit32.band(mask, FIELD_MOVE_Z) !== 0) {
					const v = readAxis(p.moveZ);
					if (v === undefined) return undefined;
					f.moveZ = v;
				}
				if (bit32.band(mask, FIELD_AIM_X) !== 0) {
					const v = readAxis(p.aimX);
					if (v === undefined) return undefined;
					f.aimX = v;
				}
				if (bit32.band(mask, FIELD_AIM_Z) !== 0) {
					const v = readAxis(p.aimZ);
					if (v === undefined) return undefined;
					f.aimZ = v;
				}
				if (bit32.band(mask, FIELD_BUTTONS) !== 0) {
					const x = readVarint();
					if (x === undefined) return undefined;
					f.buttons = bit32.bxor(p.buttons, x);
					if (bit32.band(f.buttons, bit32.bnot(PARTY_SIM_BUTTONS)) !== 0) return undefined;
				}
				frames.push(f);
				prev[i] = f;
			}
			out.push(frames);
		}
		return pos === len ? out : undefined;
	}
}

// ---------------------------------------------------------------------------------------------
// Input echo

/** How early a player's input reached the server (docs/FRAME_PACING.md Design 9): the lowest-slack one since the last echo. */
export interface InputEcho {
	/** The tick of the frame received with the lowest slack since the last echo; undefined: nothing received since. */
	readonly tick: number | undefined;
	/** Ticks before its deadline it arrived (X + 1 - the receipt position); <= 0 when late. 0 without a tick. */
	readonly slack: number;
	/** Frames of this player's that arrived late since the last echo. */
	readonly lates: number;
	/**
	 * The server was catching up a backlog (finalizing maxTicksPerStep a step) during this echo's window. Absent on a
	 * decoded echo without the flag.
	 */
	readonly catchingUp?: boolean;
}

function finite(v: number): boolean {
	return v === v && v !== math.huge && v !== -math.huge;
}

/** `echo` against the batch starting at `firstTick` -> INPUT_ECHO_BYTES (undefined: no tick, no lates). */
export function encodeInputEcho(echo: InputEcho | undefined, firstTick: number): buffer {
	const b = buffer.create(INPUT_ECHO_BYTES);
	const lates = echo === undefined || !finite(echo.lates) ? 0 : math.clamp(math.floor(echo.lates), 0, U8_MAX);
	buffer.writeu8(b, ECHO_LATES_AT, lates);
	const catchUp = echo?.catchingUp === true ? ECHO_CATCHING_UP : 0;
	buffer.writeu8(b, 0, catchUp);
	const tick = echo?.tick;
	if (echo === undefined || tick === undefined) return b;
	buffer.writeu8(b, 0, bit32.bor(ECHO_HAS_TICK, catchUp));
	const offset = math.floor(tick - firstTick);
	buffer.writei32(b, ECHO_OFFSET_AT, finite(offset) ? math.clamp(offset, I32_MIN, I32_MAX) : 0);
	const raw = echo.slack * INPUT_ECHO_SLACK_SCALE;
	const slack = raw !== raw ? 0 : math.clamp(math.floor(raw + 0.5), I16_MIN, I16_MAX);
	buffer.writei16(b, ECHO_SLACK_AT, slack);
	return b;
}

/**
 * An input echo of the batch starting at `firstTick`, or undefined (not a buffer of INPUT_ECHO_BYTES, unknown flag
 * bits, a "none" echo with a nonzero offset or slack, a tick that is not finite).
 */
export function decodeInputEcho(data: unknown, firstTick: number): InputEcho | undefined {
	if (!typeIs(data, "buffer") || buffer.len(data) !== INPUT_ECHO_BYTES) return undefined;
	const flags = buffer.readu8(data, 0);
	if (bit32.band(flags, bit32.bnot(ECHO_FLAGS_ALL)) !== 0) return undefined;
	const offset = buffer.readi32(data, ECHO_OFFSET_AT);
	const slack = buffer.readi16(data, ECHO_SLACK_AT) / INPUT_ECHO_SLACK_SCALE;
	const lates = buffer.readu8(data, ECHO_LATES_AT);
	const catchingUp = bit32.band(flags, ECHO_CATCHING_UP) !== 0;
	if (bit32.band(flags, ECHO_HAS_TICK) === 0) {
		if (offset !== 0 || slack !== 0) return undefined;
		return catchingUp ? { tick: undefined, slack: 0, lates, catchingUp } : { tick: undefined, slack: 0, lates };
	}
	if (!typeIs(firstTick, "number")) return undefined;
	const tick = firstTick + offset;
	if (!finite(tick) || !finite(slack)) return undefined;
	return catchingUp ? { tick, slack, lates, catchingUp } : { tick, slack, lates };
}
