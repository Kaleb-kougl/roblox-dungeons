// M4 co-op in the sim (party.ts): party state and accessors, stepParty vs step for solo, nearest-living targeting
// with the index tie-break, hits on any player with per-player invulnerability, player bullet ownership through
// swap-remove, leaving, the "party" hash group, clones, party recordings and their binary codec variant.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TEST_CHASER } from "shared/sim/testing";
import {
	AXIS_MAX,
	BINARY_RECORDING_VERSION,
	Button,
	EMPTY_INPUT,
	HURT_INVULN_TICKS,
	MAX_PARTY_SIZE,
	PARTY_BINARY_RECORDING_HEADER_BYTES,
	PARTY_BINARY_RECORDING_VERSION,
	PARTY_HP_MULTIPLIERS,
	PARTY_LEFT_BUTTON,
	PARTY_SUBSYSTEM,
	Recorder,
	START_ARMOR,
	START_HALF_HEARTS,
	cloneSimState,
	createSimState,
	decodeRecording,
	encodeRecording,
	hashLayout,
	hashState,
	isPartyWiped,
	livingPlayerCount,
	nearestLivingPlayer,
	partyHpMultiplier,
	partySize,
	playerAt,
	playerBulletOwner,
	runReplay,
	step,
	stepParty,
	weaponsAt,
	writeHashFields,
	type ActorSpawn,
	type EncounterConfig,
	type InputFrame,
	type Recording,
	type SimConfig,
	type SimState,
} from "shared/sim";

const enc = (spawns: ActorSpawn[]): EncounterConfig => ({ spawns, rooms: [], entranceRoom: -1, bossRoom: -1 });
const LIMITS = { maxTicks: 100000, maxRecordingBytes: 1000000 };

function inputs(n: number, f: Readonly<InputFrame> = EMPTY_INPUT): InputFrame[] {
	const out: InputFrame[] = [];
	for (let i = 0; i < n; i++) out.push({ ...f });
	return out;
}

function frame(mx: number, mz: number, buttons = 0, ax = 0, az = 0): InputFrame {
	return { moveX: mx * AXIS_MAX, moveZ: mz * AXIS_MAX, aimX: ax * AXIS_MAX, aimZ: az * AXIS_MAX, buttons };
}

function place(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

describe("party state", () => {
	it("a solo config has no party state: one player, the M1 hash groups", () => {
		const s = createSimState(1, 0, 0, {});
		expect(s.party).toBe(undefined);
		expect(partySize(s)).toBe(1);
		expect(playerAt(s, 0)).toBe(s.player);
		expect(weaponsAt(s, 0)).toBe(s.combat.weapons);
		const solo = createSimState(1, 0, 0, { party: { size: 1 } });
		expect(solo.party).toBe(undefined);
		expect(hashState(solo)).toBe(hashState(s));
	});

	it("stepParty on a solo state is step()", () => {
		const a = createSimState(7, 0, 0, {});
		const b = createSimState(7, 0, 0, {});
		for (let t = 0; t < 120; t++) {
			const f = frame(t % 2, 0.5, t % 30 === 0 ? Button.ROLL : 0, 1, 0);
			step(a, f);
			stepParty(b, [f]);
			expect(hashState(b)).toBe(hashState(a));
		}
	});

	it("players 1..n-1 start at the spawn with their own weapons and emitter ids (player i: i + 1)", () => {
		const s = createSimState(1, 2, 3, { party: { size: 4, loadouts: [undefined, ["weapon.bow"]] } });
		expect(partySize(s)).toBe(4);
		expect(s.party!.players[0]).toBe(s.player);
		expect(s.party!.weapons[0]).toBe(s.combat.weapons);
		for (let i = 0; i < 4; i++) {
			const p = playerAt(s, i);
			expect(p.x).toBe(2);
			expect(p.z).toBe(3);
			expect(p.hearts).toBe(START_HALF_HEARTS);
			expect(weaponsAt(s, i).emitterId).toBe(i + 1);
			expect(playerBulletOwner(weaponsAt(s, i).emitterId)).toBe(i);
		}
		expect(weaponsAt(s, 1).sets.size()).toBe(2);
		expect(weaponsAt(s, 1).sets[1].weapon).toBe(-1); // ["weapon.bow"] only: set 1 empty
		expect(weaponsAt(s, 2).sets[0].weapon).toBe(weaponsAt(s, 0).sets[0].weapon); // default loadout
		expect(playerAt(s, 1)).never.toBe(playerAt(s, 2));
	});

	it("rejects bad party sizes and input counts", () => {
		expect(() => createSimState(1, 0, 0, { party: { size: MAX_PARTY_SIZE + 1 } })).toThrow();
		expect(() => createSimState(1, 0, 0, { party: { size: 0 } })).toThrow();
		const s = createSimState(1, 0, 0, { party: { size: 3 } });
		expect(() => stepParty(s, inputs(2))).toThrow();
		expect(() => step(s, EMPTY_INPUT)).toThrow();
	});

	it("the party hash group is appended last; layout values are writeHashFields, names cover them", () => {
		const s = createSimState(1, 0, 0, { party: { size: 3 } });
		stepParty(s, [frame(1, 0), frame(0, 1), frame(-1, 0, Button.ROLL)]);
		const layout = hashLayout(s, true);
		const groups = layout.groups;
		expect(groups[groups.size() - 1].name).toBe(PARTY_SUBSYSTEM);
		expect(layout.names.size()).toBe(layout.values.size());
		const plain = writeHashFields(s, []);
		expect(plain.size()).toBe(layout.values.size());
		for (let i = 0; i < plain.size(); i++) expect(layout.values[i]).toBe(plain[i]);
		const party = groups[groups.size() - 1];
		expect(layout.names[party.start]).toBe("party.size");
		expect(layout.names.includes("party.players[2].x")).toBe(true);
		expect(layout.names.includes("party.weapons[1].activeSet")).toBe(true);
		expect(layout.names.includes("party.players[0].x")).toBe(false); // player 0 is in "core"
		// Every player 1..n-1 field is hashed: moving player 2 alone changes the hash.
		const before = hashState(s);
		playerAt(s, 2).x += 1e-9;
		expect(hashState(s)).never.toBe(before);
	});

	it("cloneSimState copies the party (aliasing player 0 again) while pristine", () => {
		const s = createSimState(1, 0, 0, { party: { size: 3 } });
		stepParty(s, [frame(1, 0), frame(0, 1), frame(-1, 0)]);
		const c = cloneSimState(s);
		expect(hashState(c)).toBe(hashState(s));
		expect(c.party!.players[0]).toBe(c.player);
		expect(c.party!.weapons[0]).toBe(c.combat.weapons);
		expect(c.party!.players[1]).never.toBe(s.party!.players[1]);
		const f = [frame(0, 1), frame(1, 1), frame(0, -1)];
		stepParty(s, f);
		stepParty(c, f);
		expect(hashState(c)).toBe(hashState(s));
	});

	it("each player moves with its own input", () => {
		const s = createSimState(1, 0, 0, { party: { size: 3 } });
		stepParty(s, [frame(1, 0), frame(0, 1), EMPTY_INPUT]);
		expect(playerAt(s, 0).x > 0).toBe(true);
		expect(playerAt(s, 0).z).toBe(0);
		expect(playerAt(s, 1).x).toBe(0);
		expect(playerAt(s, 1).z > 0).toBe(true);
		expect(playerAt(s, 2).x).toBe(0);
		expect(playerAt(s, 2).z).toBe(0);
	});
});

describe("targeting: the nearest living player, ties to the lower index", () => {
	it("nearestLivingPlayer", () => {
		const s = createSimState(1, 0, 0, { party: { size: 3 } });
		place(s, 0, 3, 0);
		place(s, 1, -2, 0);
		place(s, 2, 0, 5);
		expect(nearestLivingPlayer(s, 0, 0)).toBe(1);
		place(s, 0, 2, 0);
		expect(nearestLivingPlayer(s, 0, 0)).toBe(0); // tie 0 / 1: lower index
		playerAt(s, 0).dead = 1;
		expect(nearestLivingPlayer(s, 0, 0)).toBe(1);
		playerAt(s, 1).dead = 1;
		expect(nearestLivingPlayer(s, 0, 0)).toBe(2);
		playerAt(s, 2).dead = 1;
		expect(nearestLivingPlayer(s, 0, 0)).toBe(0); // nobody alive: player 0
		const solo = createSimState(1, 0, 0, {});
		solo.player.dead = 1;
		expect(nearestLivingPlayer(solo, 9, 9)).toBe(0);
	});

	function chaserRun(p0: number, p1: number, p1Dead: boolean): number {
		const config: SimConfig = { party: { size: 2 }, encounter: enc([{ kind: TEST_CHASER.id, x: 0, z: 0 }]) };
		const s = createSimState(1, 0, 0, config);
		place(s, 0, p0, 0);
		place(s, 1, p1, 0);
		if (p1Dead) playerAt(s, 1).dead = 1;
		stepParty(s, inputs(2), config);
		return s.combat.actors[0].x;
	}

	it("an actor's hooks see the nearest living player as ctx.player", () => {
		expect(chaserRun(3, -2, false) < 0).toBe(true); // player 1 is nearer
		expect(chaserRun(-3, 2, false) > 0).toBe(true);
		expect(chaserRun(2, -2, false) > 0).toBe(true); // tie: player 0
		expect(chaserRun(3, -1, true) > 0).toBe(true); // player 1 is dead
	});
});

describe("hits on any player", () => {
	it("contact damage hurts each touching player, each with its own invulnerability", () => {
		const config: SimConfig = { party: { size: 3 }, encounter: enc([{ kind: TEST_CHASER.id, x: 0, z: 0 }]) };
		const s = createSimState(1, 0, 0, config);
		place(s, 0, 0, 0.1);
		place(s, 1, 0, -0.1);
		place(s, 2, 6, 6);
		stepParty(s, inputs(3), config);
		expect(s.events.playerHits).toBe(2);
		// START_ARMOR pips first, then hearts: each touching player lost exactly one hit's worth.
		for (const i of [0, 1])
			expect(playerAt(s, i).armor + playerAt(s, i).hearts).toBe(START_ARMOR + START_HALF_HEARTS - 1);
		expect(playerAt(s, 2).armor + playerAt(s, 2).hearts).toBe(START_ARMOR + START_HALF_HEARTS);
		expect(playerAt(s, 0).hurtTicks).toBe(HURT_INVULN_TICKS);
		expect(playerAt(s, 2).hurtTicks).toBe(0);
	});

	it("a player's death is not the run's end; the whole party down is", () => {
		const s = createSimState(1, 0, 0, { party: { size: 2 } });
		for (let i = 0; i < 2; i++) {
			const p = playerAt(s, i);
			p.armor = 0;
			p.hearts = 1;
		}
		stepParty(s, [EMPTY_INPUT, frame(0, 0, Button.DEBUG_HIT)]);
		expect(s.events.playerDied).toBe(1);
		expect(playerAt(s, 1).dead).toBe(1);
		expect(playerAt(s, 0).dead).toBe(0);
		expect(livingPlayerCount(s)).toBe(1);
		expect(isPartyWiped(s)).toBe(false);
		stepParty(s, [frame(0, 0, Button.DEBUG_HIT), EMPTY_INPUT]);
		expect(isPartyWiped(s)).toBe(true);
	});

	it("a dead player's input does nothing (no movement, no shots)", () => {
		const config: SimConfig = { party: { size: 2, loadouts: [["weapon.test"], ["weapon.test"]] } };
		const s = createSimState(1, 0, 0, config);
		playerAt(s, 1).dead = 1;
		stepParty(s, [EMPTY_INPUT, frame(1, 0, Button.FIRE, 1, 0)], config);
		expect(playerAt(s, 1).x).toBe(0);
		expect(s.combat.playerSpawned).toBe(0);
	});

	it("PARTY_LEFT_BUTTON: the player left (dead, `left` set, no death event)", () => {
		const s = createSimState(1, 0, 0, { party: { size: 3 } });
		stepParty(s, [EMPTY_INPUT, EMPTY_INPUT, frame(0, 0, PARTY_LEFT_BUTTON)]);
		expect(s.party!.left[2]).toBe(1);
		expect(playerAt(s, 2).dead).toBe(1);
		expect(playerAt(s, 2).hearts).toBe(0);
		expect(s.events.playerDied).toBe(0);
		expect(s.party!.left[1]).toBe(0);
	});
});

describe("player bullet ownership", () => {
	it("each bullet's emitter names its owner through swap-removes, and it is hashed", () => {
		const config: SimConfig = { party: { size: 2, loadouts: [["weapon.test"], ["weapon.test"]] } };
		const s = createSimState(3, 0, 0, config);
		place(s, 0, 0, -3);
		place(s, 1, 0, 3);
		let checked = 0;
		let both = 0;
		for (let t = 0; t < 240; t++) {
			// Player 0 fires +x for a while, player 1 fires -x from tick 4 on: lifetimes end out of order.
			const f0 = t < 150 ? frame(0, 0, Button.FIRE, 1, 0) : frame(0, 0, 0, 1, 0);
			const f1 = t >= 4 ? frame(0, 0, Button.FIRE, -1, 0) : frame(0, 0, 0, -1, 0);
			stepParty(s, [f0, f1], config);
			let owners = 0;
			s.combat.playerBullets.forEachActive((i, _pos, _payload, emitter) => {
				const owner = playerBulletOwner(emitter);
				const vx = s.combat.playerBullets.velocityAt(i).x;
				expect(owner === 0 ? vx > 0 : vx < 0).toBe(true);
				owners = bit32.bor(owners, owner + 1);
				checked++;
			});
			if (owners === 3) both++;
		}
		expect(checked > 500).toBe(true);
		expect(both > 100).toBe(true);
		// The emitter id is a hashed bullet field (playerBullets[slot].emitter).
		expect(
			hashLayout(s, true).names.some((n) => string.find(n, "^playerBullets%[%d+%]%.emitter$")[0] !== undefined),
		).toBe(true);
	});
});

describe("party recordings", () => {
	function partyRecording(n: number, ticks: number): Recording {
		const rec = new Recorder(5, 0, 0);
		for (let t = 0; t < ticks; t++) {
			const f: InputFrame[] = [];
			for (let i = 0; i < n; i++) {
				const phase = (t + i * 17) % 40;
				f.push(frame(phase < 20 ? 1 : -1, i % 2 === 0 ? 0.5 : -0.5, phase === 3 ? Button.ROLL : 0, 0, 1));
			}
			if (t === 100 && n > 2) f[2] = frame(0, 0, PARTY_LEFT_BUTTON);
			rec.recordParty(f);
		}
		return rec.getRecording();
	}

	it("Recorder.recordParty keeps one stream per player; runReplay steps them as a party", () => {
		const n = 3;
		const recording = partyRecording(n, 200);
		expect(recording.others!.size()).toBe(n - 1);
		const config: SimConfig = { party: { size: n } };
		const a = runReplay(recording, config);
		const b = runReplay(recording, config);
		expect(hashState(a)).toBe(hashState(b));
		expect(a.party!.left[2]).toBe(1);
		expect(() => runReplay(recording, {})).toThrow(); // a solo config cannot replay a party log
	});

	it("binary codec: party round trip; the header carries the player count", () => {
		for (const n of [2, 3, MAX_PARTY_SIZE]) {
			const recording = partyRecording(n, 300);
			const buf = encodeRecording(recording);
			expect(buffer.readu8(buf, 0)).toBe(PARTY_BINARY_RECORDING_VERSION);
			expect(buffer.readu8(buf, 1)).toBe(n);
			expect(buffer.len(buf) > PARTY_BINARY_RECORDING_HEADER_BYTES).toBe(true);
			const decoded = decodeRecording(buf, LIMITS);
			expect(decoded.ok).toBe(true);
			if (!decoded.ok) continue;
			const back = decoded.recording;
			expect(back.others!.size()).toBe(n - 1);
			expect(buffer.tostring(encodeRecording(back))).toBe(buffer.tostring(buf));
			const config: SimConfig = { party: { size: n } };
			expect(hashState(runReplay(back, config))).toBe(hashState(runReplay(recording, config)));
		}
	});

	it("binary codec: a solo recording still encodes as version 1, byte for byte the same as without party support", () => {
		const rec = new Recorder(9, 1.5, -2.25);
		for (let t = 0; t < 50; t++) rec.recordParty([frame(t < 25 ? 1 : 0, 0, t === 10 ? Button.FIRE : 0)]);
		const recording = rec.getRecording();
		expect(recording.others).toBe(undefined);
		const buf = encodeRecording(recording);
		expect(buffer.readu8(buf, 0)).toBe(BINARY_RECORDING_VERSION);
		// Version, seed 9, spawn, 50 frames, then runs: [moveX 1000 x25 incl. FIRE at 10], [moveX 0].
		const expected = buffer.create(buffer.len(buf));
		let o = 0;
		const u8 = (v: number) => {
			buffer.writeu8(expected, o, v);
			o += 1;
		};
		u8(1);
		buffer.writeu32(expected, o, 9);
		o += 4;
		buffer.writef64(expected, o, 1.5);
		o += 8;
		buffer.writef64(expected, o, -2.25);
		o += 8;
		u8(50);
		// Run 1: frames 0-9 moveX 1000 (zigzag 2000 = 0xd0 0x0f), length 10 = extended (7) + varint 2.
		u8(1 + 7 * 32);
		u8(2);
		u8(0xd0);
		u8(0x0f);
		// Run 2: frame 10, FIRE.
		u8(16);
		u8(1);
		// Run 3: frames 11-24, FIRE off, 14 frames.
		u8(16 + 7 * 32);
		u8(6);
		u8(1);
		// Run 4: frames 25-49, moveX 0 (zigzag -1000 = 1999 = 0xcf 0x0f), 25 frames.
		u8(1 + 7 * 32);
		u8(17);
		u8(0xcf);
		u8(0x0f);
		expect(o).toBe(buffer.len(buf));
		expect(buffer.tostring(buf)).toBe(buffer.tostring(expected));
	});

	it("binary codec: the leave bit is the solo forfeit bit too; unknown bits and stream shapes are checked", () => {
		// L6a: a solo stream may carry it (FORFEIT_BUTTON, the same bit); a bit nobody defines still throws (x 2 is
		// DEBUG_DROP_BUTTON, docs/BOOSTS.md; x 4 is free).
		const solo: Recording = { seed: 1, spawn: { x: 0, z: 0 }, frames: [frame(0, 0, PARTY_LEFT_BUTTON)] };
		expect(() => encodeRecording(solo)).never.toThrow();
		const unknown: Recording = { seed: 1, spawn: { x: 0, z: 0 }, frames: [frame(0, 0, PARTY_LEFT_BUTTON * 4)] };
		expect(() => encodeRecording(unknown)).toThrow();
		const uneven: Recording = { seed: 1, spawn: { x: 0, z: 0 }, frames: [EMPTY_INPUT], others: [[]] };
		expect(() => encodeRecording(uneven)).toThrow();
		const tooMany: Recording = { seed: 1, spawn: { x: 0, z: 0 }, frames: [], others: [] };
		for (let i = 0; i < MAX_PARTY_SIZE; i++) tooMany.others!.push([]);
		expect(() => encodeRecording(tooMany)).toThrow();
		// A party buffer whose count byte is out of range, or that is cut short, is malformed.
		const good = encodeRecording(partyRecording(2, 20));
		const bad = buffer.create(buffer.len(good));
		buffer.copy(bad, 0, good, 0);
		buffer.writeu8(bad, 1, MAX_PARTY_SIZE + 1);
		const r1 = decodeRecording(bad, LIMITS);
		expect(r1.ok).toBe(false);
		const short = buffer.create(buffer.len(good) - 1);
		buffer.copy(short, 0, good, 0, buffer.len(good) - 1);
		const r2 = decodeRecording(short, LIMITS);
		expect(r2.ok).toBe(false);
		if (!r2.ok) expect(r2.code).toBe("malformed");
	});
});

describe("party hp multiplier table", () => {
	it("is the M4 table, indexed by party size", () => {
		const want = [1, 1.6, 2.2, 2.8, 3.2, 3.6, 4.0, 4.4];
		for (let n = 1; n <= MAX_PARTY_SIZE; n++) expect(partyHpMultiplier(n)).toBe(want[n - 1]);
		expect(PARTY_HP_MULTIPLIERS.size()).toBe(MAX_PARTY_SIZE);
		expect(() => partyHpMultiplier(0)).toThrow();
		expect(() => partyHpMultiplier(9)).toThrow();
	});
});
