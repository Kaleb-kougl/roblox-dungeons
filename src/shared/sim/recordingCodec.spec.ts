// The binary recording codec (recordingCodec.ts): every golden recording round-trips exactly, the encoding is
// canonical, and hostile buffers (truncated, overlong, out of range, bombs, random bytes) come back as a reject code,
// never an error.
import { afterAll, describe, expect, it } from "@rbxts/jest-globals";
import runBoss from "shared/fixtures-generated/run-boss-1337";
import runBullets from "shared/fixtures-generated/run-bullets";
import runFull from "shared/fixtures-generated/run-full-1337";
import runPlayer from "shared/fixtures-generated/run-player";
import runPlayerDungeon from "shared/fixtures-generated/run-player-dungeon-1337";
import {
	AXIS_MAX,
	BINARY_RECORDING_HEADER_BYTES,
	BINARY_RECORDING_VERSION,
	Button,
	DEFAULT_BOUNDS,
	Rng,
	decodeRecording,
	deserializeRecording,
	encodeRecording,
	hashState,
	runReplay,
	type InputFrame,
	type Recording,
	type RecordingDecodeLimits,
	type RecordingDecodeResult,
	type SimConfig,
	WEB_SWORD_TIMINGS,
	WEB_SWARMER_HP,
	setSwordTimings,
	setSwarmerHp,
	type SwordTimings,
} from "shared/sim";

// The golden runs (and the source's measured tables) were recorded with the web build's sword; the port's is 20%
// slower (CLAUDE.md decision log), so this file replays under WEB_SWORD_TIMINGS. Set at load, not in a beforeAll:
// describe bodies may replay while the specs are collected.
const portSword: SwordTimings = setSwordTimings(WEB_SWORD_TIMINGS);
const portSwarmerHp = setSwarmerHp(WEB_SWARMER_HP); // the web swarmer's 2 hp (port: 1)
afterAll(() => {
	setSwordTimings(portSword);
	setSwarmerHp(portSwarmerHp);
});

const FIXTURES: ReadonlyArray<{ readonly name: string; readonly recording: string }> = [
	{ name: "run-player", recording: runPlayer.recording },
	{ name: "run-player-dungeon-1337", recording: runPlayerDungeon.recording },
	{ name: "run-bullets", recording: runBullets.recording },
	{ name: "run-full-1337", recording: runFull.recording },
	{ name: "run-boss-1337", recording: runBoss.recording },
];

/** Generous caps (the live ones are in shared/run limits.ts; validate.spec.ts covers them). */
const LIMITS: RecordingDecodeLimits = { maxTicks: 100000, maxRecordingBytes: 1000000 };

/** Raw little-endian bytes for hand-made buffers. */
class Bytes {
	private readonly out: number[] = [];

	header(seed = 1337, x = 0.5, z = -1.25, version = BINARY_RECORDING_VERSION): this {
		const b = buffer.create(BINARY_RECORDING_HEADER_BYTES);
		buffer.writeu8(b, 0, version);
		buffer.writeu32(b, 1, seed);
		buffer.writef64(b, 5, x);
		buffer.writef64(b, 13, z);
		for (let i = 0; i < BINARY_RECORDING_HEADER_BYTES; i++) this.out.push(buffer.readu8(b, i));
		return this;
	}

	u8(...values: number[]): this {
		for (const v of values) this.out.push(v);
		return this;
	}

	varint(v: number): this {
		let rest = v;
		while (rest >= 128) {
			this.out.push((rest % 128) + 128);
			rest = math.floor(rest / 128);
		}
		this.out.push(rest);
		return this;
	}

	build(): buffer {
		const b = buffer.create(this.out.size());
		for (let i = 0; i < this.out.size(); i++) buffer.writeu8(b, i, this.out[i]);
		return b;
	}
}

function decodeOk(b: buffer, limits: RecordingDecodeLimits = LIMITS): Recording {
	const r = decodeRecording(b, limits);
	if (!r.ok) error(`expected ok, got ${r.code}: ${r.reason}`, 0);
	return r.recording;
}

function rejectOf(b: buffer, limits: RecordingDecodeLimits = LIMITS): [string, string] {
	const r = decodeRecording(b, limits);
	return r.ok ? ["ok", ""] : [r.code, r.reason];
}

function truncated(b: buffer, size: number): buffer {
	const out = buffer.create(size);
	buffer.copy(out, 0, b, 0, size);
	return out;
}

/** Tag of a run: changed-field mask (bits 0-4) + run length code (bits 5-7). */
function tag(mask: number, lengthCode: number): number {
	return mask + lengthCode * 32;
}

describe("recording codec: golden recordings", () => {
	for (const f of FIXTURES) {
		it(`${f.name}: decode(encode(frames)) equals the JSON recording exactly, and re-encodes byte for byte`, () => {
			const parsed = deserializeRecording(f.recording);
			const bin = encodeRecording(parsed);
			const back = decodeOk(bin);
			expect(back.seed).toBe(parsed.seed);
			expect(back.spawn).toEqual(parsed.spawn);
			expect(back.frames.size()).toBe(parsed.frames.size());
			expect(back.frames).toEqual(parsed.frames);
			expect(buffer.tostring(encodeRecording(back))).toBe(buffer.tostring(bin));
		});
	}

	it("run-bullets (greybox + stress: no world validateRun builds) replays from the binary form to its final hash", () => {
		// validate.spec.ts checks the other four through validateRun; this is runBullets.spec.ts's config.
		const config: SimConfig = {
			bounds: DEFAULT_BOUNDS,
			stress: {
				bullets: runBullets.config.stress.bullets,
				x: runBullets.config.stress.x,
				z: runBullets.config.stress.z,
			},
			loadout: ["weapon.bow", "weapon.sword"],
		};
		const back = decodeOk(encodeRecording(deserializeRecording(runBullets.recording)));
		expect(hashState(runReplay(back, config))).toBe(runBullets.finalHash);
	});

	it("is much smaller than the JSON form (bytes per tick printed for docs/SERVER.md)", () => {
		const lines: string[] = [];
		for (const f of FIXTURES) {
			const parsed = deserializeRecording(f.recording);
			const bytes = buffer.len(encodeRecording(parsed));
			const ticks = parsed.frames.size();
			lines.push(
				`${f.name}: ${ticks} ticks, JSON ${f.recording.size()} chars, binary ${bytes} bytes ` +
					`(${string.format("%.3f", bytes / ticks)} bytes/tick)`,
			);
			expect(bytes).toBeLessThan(f.recording.size());
		}
		print(`[recordingCodec] ${lines.join("; ")}`);
		// The worst case on record: a bot changing all four axes on every tick.
		const boss = deserializeRecording(runBoss.recording);
		expect(buffer.len(encodeRecording(boss)) / boss.frames.size()).toBeLessThan(6);
	});

	it("an empty recording and a run longer than the inline lengths round-trip", () => {
		const empty: Recording = { seed: 0, spawn: { x: 0, z: 0 }, frames: [] };
		expect(buffer.len(encodeRecording(empty))).toBe(BINARY_RECORDING_HEADER_BYTES + 1);
		expect(decodeOk(encodeRecording(empty))).toEqual(empty);
		const frames: InputFrame[] = [];
		for (let i = 0; i < 5000; i++) {
			frames.push({ moveX: i < 2500 ? AXIS_MAX : -AXIS_MAX, moveZ: 0, aimX: 0, aimZ: 0, buttons: Button.FIRE });
		}
		const long: Recording = { seed: 4294967295, spawn: { x: -0.1, z: 1e-300 }, frames };
		const bin = encodeRecording(long);
		expect(buffer.len(bin)).toBeLessThan(BINARY_RECORDING_HEADER_BYTES + 16);
		expect(decodeOk(bin)).toEqual(long);
	});

	it("frames of one run share one frozen table", () => {
		const r = decodeOk(encodeRecording(deserializeRecording(runPlayer.recording)));
		expect(table.isfrozen(r.frames[0])).toBe(true);
		expect(r.frames[0] === r.frames[1]).toBe(true);
	});

	it("encode refuses what no live run produces", () => {
		const frames = [{ moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, buttons: 0 }];
		expect(() => encodeRecording({ seed: -1, spawn: { x: 0, z: 0 }, frames })).toThrow("seed");
		expect(() => encodeRecording({ seed: 1.5, spawn: { x: 0, z: 0 }, frames })).toThrow("seed");
		expect(() => encodeRecording({ seed: 1, spawn: { x: 0 / 0, z: 0 }, frames })).toThrow("spawn");
		const bad = [{ moveX: AXIS_MAX + 1, moveZ: 0, aimX: 0, aimZ: 0, buttons: 0 }];
		expect(() => encodeRecording({ seed: 1, spawn: { x: 0, z: 0 }, frames: bad })).toThrow("invalid frame at 0");
	});
});

describe("recording codec: hostile input is rejected, never thrown", () => {
	it("size and length caps come first: too_large before reading, too_long before building a frame", () => {
		const bin = encodeRecording(deserializeRecording(runPlayer.recording));
		expect(rejectOf(bin, { maxTicks: LIMITS.maxTicks, maxRecordingBytes: 100 })).toEqual([
			"too_large",
			`recording too large: ${buffer.len(bin)} bytes (max 100)`,
		]);
		expect(rejectOf(bin, { maxTicks: 500, maxRecordingBytes: LIMITS.maxRecordingBytes })[0]).toBe("too_long");
		// A frame count of 2^28 - 1 and no runs at all: rejected on the count, not on the missing runs.
		const bomb = new Bytes().header().varint(268435455).build();
		expect(rejectOf(bomb)).toEqual(["too_long", `run too long: 268435455 ticks (max ${LIMITS.maxTicks})`]);
	});

	it("a run may not cover more frames than the count declares (RLE bomb inside the cap)", () => {
		const b = new Bytes().header().varint(10).u8(tag(0, 7)).varint(100000000).build();
		expect(rejectOf(b)).toEqual(["malformed", "malformed recording: run at byte 22 passes frame count 10"]);
	});

	it("bad header: short, wrong version, non-finite spawn", () => {
		expect(rejectOf(new Bytes().u8(1, 2, 3).build())[1]).toBe("malformed recording: 3-byte header");
		// Version 2 is the co-op party variant (party.spec.ts); 3 is unknown.
		expect(rejectOf(new Bytes().header(1, 0, 0, 3).varint(0).build())[1]).toBe(
			"malformed recording: unsupported version 3",
		);
		const nan = 0 / 0;
		const nanSpawn = new Bytes().header(1, nan, 0).varint(0).build();
		expect(rejectOf(nanSpawn)[1]).toBe("malformed recording: spawn not finite");
		expect(rejectOf(new Bytes().header(1, 0, math.huge).varint(0).build())[0]).toBe("malformed");
	});

	it("varints: truncated, overlong (trailing zero group) and longer than 4 bytes", () => {
		expect(rejectOf(new Bytes().header().u8(0x80).build())[1]).toBe(
			"malformed recording: truncated frame count at byte 22",
		);
		expect(rejectOf(new Bytes().header().u8(0x81, 0x00).build())[1]).toBe(
			"malformed recording: overlong frame count at byte 21",
		);
		expect(rejectOf(new Bytes().header().u8(0x81, 0x80, 0x80, 0x80, 0x01).build())[1]).toBe(
			"malformed recording: frame count longer than 4 bytes at byte 21",
		);
	});

	it("values: unchanged field flagged, axis out of range, unknown button bits", () => {
		// moveX flagged with delta 0.
		expect(rejectOf(new Bytes().header().varint(1).u8(tag(1, 0)).varint(0).build())[1]).toBe(
			"malformed recording: unchanged axis flagged at byte 23",
		);
		// moveX = 0 + 1001 (zigzag 2002).
		expect(rejectOf(new Bytes().header().varint(1).u8(tag(1, 0)).varint(2002).build())[1]).toBe(
			"malformed recording: axis out of range at frame 0",
		);
		// aimZ = 1000, then -1000 - 1 (delta -2001, zigzag 4001).
		const twoStep = new Bytes().header().varint(2).u8(tag(8, 0)).varint(2000).u8(tag(8, 0)).varint(4001).build();
		expect(rejectOf(twoStep)[1]).toBe("malformed recording: axis out of range at frame 1");
		// Buttons XOR 65536 (no such button; 8192 and 32768 are the port's DEBUG_FLOOR_BUTTON / DEBUG_DROP_BUTTON,
		// SIM_BUTTONS; 16384 the leave / forfeit bit, RECORDED_BUTTONS).
		expect(rejectOf(new Bytes().header().varint(1).u8(tag(16, 0)).varint(65536).build())[1]).toBe(
			"malformed recording: unknown button bits at frame 0",
		);
		expect(rejectOf(new Bytes().header().varint(1).u8(tag(16, 0)).varint(0).build())[1]).toBe(
			"malformed recording: unchanged buttons flagged at frame 0",
		);
	});

	it("non-canonical runs and trailing bytes", () => {
		// Two runs of the same frame (the second changes nothing).
		const repeated = new Bytes().header().varint(2).u8(tag(0, 0)).u8(tag(0, 0)).build();
		expect(rejectOf(repeated)[1]).toBe("malformed recording: run at byte 23 repeats the last frame");
		const ok = new Bytes().header().varint(2).u8(tag(0, 1)).build();
		expect(decodeOk(ok).frames.size()).toBe(2);
		const trailing = new Bytes().header().varint(2).u8(tag(0, 1), 0).build();
		expect(rejectOf(trailing)[1]).toBe("malformed recording: 1 trailing bytes");
	});

	it("something that is not a buffer", () => {
		expect(rejectOf("hello" as unknown as buffer)).toEqual(["malformed", "malformed recording: not a buffer"]);
	});

	it("every truncation of a real encoding is rejected", () => {
		const bin = encodeRecording(deserializeRecording(runPlayerDungeon.recording));
		const n = buffer.len(bin);
		let rejected = 0;
		for (let size = 0; size < n; size++) {
			const [code] = rejectOf(truncated(bin, size));
			if (code === "malformed") rejected++;
		}
		expect(rejected).toBe(n);
	});

	it("random bytes and random single-byte edits never throw; anything accepted re-encodes to the same bytes", () => {
		const rng = new Rng(20261011);
		const valid = encodeRecording(deserializeRecording(runPlayer.recording));
		let accepted = 0;
		for (let trial = 0; trial < 3000; trial++) {
			let b: buffer;
			if (trial % 2 === 0) {
				// Random noise behind a valid header half the time, pure noise otherwise.
				const size = rng.int(0, 64);
				b = buffer.create(size);
				for (let i = 0; i < size; i++) buffer.writeu8(b, i, rng.int(0, 255));
				if (trial % 4 === 0 && size > BINARY_RECORDING_HEADER_BYTES) {
					buffer.copy(b, 0, valid, 0, BINARY_RECORDING_HEADER_BYTES);
				}
			} else {
				b = buffer.create(buffer.len(valid));
				buffer.copy(b, 0, valid);
				buffer.writeu8(b, rng.int(0, buffer.len(valid) - 1), rng.int(0, 255));
			}
			const [ok, result] = pcall(() => decodeRecording(b, LIMITS));
			expect(ok).toBe(true);
			const r = result as RecordingDecodeResult;
			if (r.ok) {
				accepted++;
				expect(buffer.tostring(encodeRecording(r.recording))).toBe(buffer.tostring(b));
			} else {
				expect(["too_large", "too_long", "malformed"].includes(r.code)).toBe(true);
			}
		}
		expect(accepted).toBeGreaterThan(0); // some single-byte edits stay valid (a different, legal recording)
	});
});
