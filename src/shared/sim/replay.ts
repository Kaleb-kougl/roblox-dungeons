/**
 * Input recording, replay and the determinism hash (source: `src/sim/replay.ts`).
 *
 * A Recording is everything needed to reproduce a run: the seed, the spawn point and one quantized InputFrame per
 * tick. runReplay() feeds it through step() from a fresh state; if the sim is deterministic, hashState() of the result
 * equals hashState() of the live state, and equals the web build's hash for the same recording (fixtures/run-*.json).
 *
 * Port notes: the Recorder's `length` / `recording` getters are `size()` / `getRecording()`; recordings are parsed
 * with ./json.ts (no HttpService in the sim) and printed with JS number formatting (./jsnum.ts).
 */

import { copyInput, isValidInput, type InputFrame } from "./input";
import { createSimState, type SimState } from "./state";
import { DEFAULT_SIM_CONFIG, step, stepParty, type SimConfig } from "./step";
import { writePlayerHash } from "./player";
import { writeCombatHash } from "./combat/combat";
import { writeEndlessHash } from "./endless";
import { writeScoreHash } from "./score/score";
import { writeRunHash } from "./progression/progression";
import { writePartyHash } from "./party";
import { writeTutorialHash } from "./tutorial/tutorial";
import { writeBreakablesHash } from "./breakables/breakables";
import { writeDropsHash } from "./drops/drops";
import { writeAffixesHash } from "./affixes/affixes";
import { isFiniteNumber, isIntegerNumber, numberToJsString } from "./jsnum";
import { isJsonArray, isJsonObject, jsonToJsString, parseJson, type JsonValue } from "./json";
import { jsMin } from "shared/jsmath";

export interface Recording {
	seed: number;
	spawn: { x: number; z: number };
	/** One frame per tick, index = tick number. Co-op: player 0's. */
	frames: InputFrame[];
	/**
	 * Co-op (M4) only: the other players' streams, `others[k]` = player k + 1's frames, each exactly as long as
	 * `frames`. Absent (never an empty array) for a solo recording. The tick-T merged frame is
	 * [frames[T], others[0][T], ...] (partyFrameAt).
	 */
	others?: InputFrame[][];
}

/** Players in a recording: 1 + others.size(). */
export function recordingPartySize(recording: Readonly<Recording>): number {
	return recording.others !== undefined ? recording.others.size() + 1 : 1;
}

/** The merged frame of tick `t` (player index order) written into `out` (resized to the party). */
export function partyFrameAt(
	recording: Readonly<Recording>,
	t: number,
	out: Array<Readonly<InputFrame>>,
): Array<Readonly<InputFrame>> {
	out[0] = recording.frames[t];
	const others = recording.others;
	const n = others !== undefined ? others.size() : 0;
	for (let k = 0; k < n; k++) out[k + 1] = others![k][t];
	while (out.size() > n + 1) out.pop();
	return out;
}

/** Problems with a recording's party streams (lengths), or undefined. */
export function partyStreamProblem(recording: Readonly<Recording>): string | undefined {
	const others = recording.others;
	if (others === undefined) return undefined;
	if (others.size() === 0) return "party recording without other players";
	const n = recording.frames.size();
	for (let k = 0; k < others.size(); k++) {
		if (others[k].size() !== n) return `player ${k + 1} has ${others[k].size()} frames, player 0 has ${n}`;
	}
	return undefined;
}

/** Steps `state` by recording tick `t` (solo: step; co-op: stepParty with the merged frame). */
export function stepRecorded(
	state: SimState,
	recording: Readonly<Recording>,
	t: number,
	config: Readonly<SimConfig>,
): void {
	if (recording.others === undefined) step(state, recording.frames[t], config);
	else stepParty(state, partyFrameAt(recording, t, mergedScratch), config);
}

const mergedScratch: Array<Readonly<InputFrame>> = [];

export class Recorder {
	seed: number;
	spawn: { x: number; z: number };
	frames: InputFrame[] = [];
	/** Co-op: players 1..n-1's frames (recordParty). Undefined while solo. */
	others: InputFrame[][] | undefined;

	constructor(seed: number, spawnX: number, spawnZ: number) {
		this.seed = seed;
		this.spawn = { x: spawnX, z: spawnZ };
	}

	/** Call once per tick, with the exact frame passed to step(). The frame is copied. */
	record(frame: Readonly<InputFrame>): void {
		this.frames.push(copyInput(frame));
	}

	/** Co-op: call once per tick with the merged frame passed to stepParty (player index order). Frames are copied. */
	recordParty(frames: ReadonlyArray<Readonly<InputFrame>>): void {
		if (frames.size() === 1 && this.others === undefined) {
			this.record(frames[0]);
			return;
		}
		if (this.others === undefined) {
			const others: InputFrame[][] = [];
			for (let k = 1; k < frames.size(); k++) others.push([]);
			this.others = others;
		}
		const others = this.others;
		if (others.size() + 1 !== frames.size()) {
			error(`Recorder: ${frames.size()} frames for a party of ${others.size() + 1}`, 0);
		}
		this.frames.push(copyInput(frames[0]));
		for (let k = 0; k < others.size(); k++) others[k].push(copyInput(frames[k + 1]));
	}

	/** Recorded ticks (the source's `length` getter). */
	size(): number {
		return this.frames.size();
	}

	/** Snapshot of the recording so far (frames array is copied; frames themselves are immutable once recorded). */
	getRecording(): Recording {
		const rec: Recording = { seed: this.seed, spawn: { ...this.spawn }, frames: [...this.frames] };
		if (this.others !== undefined) rec.others = this.others.map((f) => [...f]);
		return rec;
	}

	/** Starts a new recording (e.g. a new run). */
	reset(seed: number = this.seed, spawnX: number = this.spawn.x, spawnZ: number = this.spawn.z): void {
		this.seed = seed;
		this.spawn = { x: spawnX, z: spawnZ };
		this.frames = [];
		this.others = undefined;
	}
}

/**
 * Replays `recording` from a fresh state built from the same `config` the live run was created with, stepping with
 * it too. `ticks` limits how many frames are applied (default: all).
 */
export function runReplay(
	recording: Readonly<Recording>,
	config: Readonly<SimConfig> = DEFAULT_SIM_CONFIG,
	ticks: number = recording.frames.size(),
): SimState {
	const state = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, config);
	const n = jsMin(ticks, recording.frames.size());
	const problem = partyStreamProblem(recording);
	if (problem !== undefined) error(`runReplay: ${problem}`, 0);
	for (let i = 0; i < n; i++) stepRecorded(state, recording, i, config);
	return state;
}

// ---------------------------------------------------------------------------------------------
// Hash

/**
 * Writes every numeric field of the state, in a FIXED order, into `out` (fixtures/hashed-fields.md).
 * Append new SimState fields here (and only append, so old hashes stay comparable within a build).
 */
export function writeHashFields(state: Readonly<SimState>, out: number[]): number[] {
	out.push(state.tick, state.rngState);
	writePlayerHash(state, out);
	writeCombatHash(state, out);
	// Roblox port: endless mode only (absent from every web-build run, so their hashes are unchanged).
	if (state.endless !== undefined) writeEndlessHash(state.endless, out);
	// M2 scoring, only in scored runs (unscored runs hash exactly the M1 fields).
	if (state.score !== undefined) writeScoreHash(state.score, out);
	// M2 in-run progression (boons, relics, curses), endless runs only.
	if (state.run !== undefined) writeRunHash(state.run, out);
	// M4 co-op, only in party runs (players 1..n-1, their weapons, who left).
	if (state.party !== undefined) writePartyHash(state.party, out);
	// First-run tutorial, only in tutorial runs (harmless flag, harmless hits), appended after party.
	if (state.tutorial !== undefined) writeTutorialHash(state.tutorial, out);
	// Breakable barrels and crates (docs/DECOR.md D4), only when the run has them, appended after every other group.
	if (state.breakables !== undefined) writeBreakablesHash(state.breakables, out);
	// Boost drops (docs/BOOSTS.md), only when the run has them, appended after every other group (after breakables).
	if (state.drops !== undefined) writeDropsHash(state.drops, out);
	// Elite affixes (docs/ENEMY_VARIANTS.md EV7), only when the run has them, appended last (after drops).
	if (state.affixes !== undefined) writeAffixesHash(state.affixes, out);
	return out;
}

const FNV_OFFSET = 0x811c9dc5;
/** FNV prime 0x01000193 = 2^24 + 403. */
const FNV_PRIME_LOW = 403;
const TWO_POW_8 = 256;
const TWO_POW_24 = 16777216;
const TWO_POW_32 = 4294967296;
const FLOAT64_BYTES = 8;

const scratch = buffer.create(FLOAT64_BYTES);

/**
 * `Math.imul(h, 0x01000193) >>> 0` for a uint32 `h`, without splitting: h * 0x01000193 = h * 2^24 + h * 403, and
 * (h * 2^24) mod 2^32 = (h mod 2^8) * 2^24. Every intermediate is an integer below 2^42, so it is exact in a double.
 */
function fnvMultiply(h: number): number {
	return (h * FNV_PRIME_LOW + (h % TWO_POW_8) * TWO_POW_24) % TWO_POW_32;
}

/** 32-bit FNV-1a over the little-endian float64 bytes of each number (Luau `buffer`, LE like DataView). 8 hex chars. */
export function hashNumbers(values: ReadonlyArray<number>): string {
	let h = FNV_OFFSET;
	for (const v of values) {
		buffer.writef64(scratch, 0, v);
		for (let b = 0; b < FLOAT64_BYTES; b++) {
			h = fnvMultiply(bit32.bxor(h, buffer.readu8(scratch, b)));
		}
	}
	return string.format("%08x", h);
}

/** Determinism hash of the full sim state. Bit-exact: 0 and -0, or 1 ulp of drift, hash differently. */
export function hashState(state: Readonly<SimState>): string {
	return hashNumbers(writeHashFields(state, []));
}

/** IEEE-754 bit pattern of `v` as 16 hex digits, most significant first (the fixtures' `hex` fields). */
export function float64Hex(v: number): string {
	buffer.writef64(scratch, 0, v);
	let s = "";
	for (let b = FLOAT64_BYTES - 1; b >= 0; b--) s += string.format("%02x", buffer.readu8(scratch, b));
	return s;
}

/** The double whose bit pattern is `hex` (16 hex digits, most significant first). Exact for NaN payloads and -0. */
export function float64FromHex(hex: string): number {
	for (let b = 0; b < FLOAT64_BYTES; b++) {
		const at = (FLOAT64_BYTES - 1 - b) * 2 + 1;
		buffer.writeu8(scratch, b, tonumber(string.sub(hex, at, at + 1), 16) ?? 0);
	}
	return buffer.readf64(scratch, 0);
}

// ---------------------------------------------------------------------------------------------
// Serialization
//
// Compact JSON: frames are run-length encoded into one flat integer array
//   { "v": 1, "seed", "spawn": [x, z], "n": frameCount, "f": [count, moveX, moveZ, aimX, aimZ, buttons, count, ...] }
// Numbers print exactly like JSON.stringify (shortest round-trip; -0 as 0; non-finite as null).

const FORMAT_VERSION = 1;
const RUN_STRIDE = 6;

function jsonNumber(v: number): string {
	return isFiniteNumber(v) ? numberToJsString(v) : "null";
}

export function serializeRecording(recording: Readonly<Recording>): string {
	if (recording.others !== undefined) error("serializeRecording: party recordings use the binary codec only", 0);
	const f: string[] = [];
	const frames = recording.frames;
	const count = frames.size();
	let i = 0;
	while (i < count) {
		const a = frames[i];
		let j = i + 1;
		while (
			j < count &&
			frames[j].moveX === a.moveX &&
			frames[j].moveZ === a.moveZ &&
			frames[j].aimX === a.aimX &&
			frames[j].aimZ === a.aimZ &&
			frames[j].buttons === a.buttons
		) {
			j++;
		}
		for (const n of [j - i, a.moveX, a.moveZ, a.aimX, a.aimZ, a.buttons]) f.push(jsonNumber(n));
		i = j;
	}
	return (
		`{"v":${FORMAT_VERSION},"seed":${jsonNumber(recording.seed)},` +
		`"spawn":[${jsonNumber(recording.spawn.x)},${jsonNumber(recording.spawn.z)}],` +
		`"n":${count},"f":[${f.join(",")}]}`
	);
}

function fail(message: string): never {
	return error(message, 0);
}

/** Parses serializeRecording() output. Throws (with the web build's messages) on malformed or out-of-range data. */
export function deserializeRecording(text: string): Recording {
	const json = parseJson(text);
	const fields = isJsonObject(json) ? json.fields : undefined;
	const get = (key: string): JsonValue | undefined => fields?.get(key);

	const v = get("v");
	if (v !== FORMAT_VERSION) fail(`Unsupported recording version: ${jsonToJsString(v)}`);
	const seed = get("seed");
	if (!isFiniteNumber(seed)) fail("Recording: bad seed");
	const spawn = get("spawn");
	if (!isJsonArray(spawn) || spawn.items.size() !== 2 || !spawn.items.every((n) => isFiniteNumber(n))) {
		fail("Recording: bad spawn");
	}
	const fRaw = get("f");
	if (!isJsonArray(fRaw) || fRaw.items.size() % RUN_STRIDE !== 0) fail("Recording: bad frame data");

	const frames: InputFrame[] = [];
	const f = fRaw.items;
	for (let k = 0; k < f.size(); k += RUN_STRIDE) {
		const runLength = f[k];
		if (!isIntegerNumber(runLength) || runLength < 1) fail(`Recording: bad run length at ${k}`);
		// Non-number fields are rejected by isValidInput (Number.isInteger is false for them).
		const frame = {
			moveX: f[k + 1],
			moveZ: f[k + 2],
			aimX: f[k + 3],
			aimZ: f[k + 4],
			buttons: f[k + 5],
		} as unknown as InputFrame;
		if (!isValidInput(frame)) fail(`Recording: invalid frame at ${k}`);
		for (let c = 0; c < runLength; c++) frames.push(c === 0 ? frame : copyInput(frame));
	}
	const n = get("n");
	if (n !== frames.size()) fail(`Recording: expected ${jsonToJsString(n)} frames, got ${frames.size()}`);

	const items = spawn.items as number[];
	return { seed, spawn: { x: items[0], z: items[1] }, frames };
}
