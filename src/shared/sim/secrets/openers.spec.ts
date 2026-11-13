// The crack's openers (docs/SECRET_ROOMS.md SR3, Rules "Openers", SRD2 / SRD3 / SRD8) on the secret arena
// (shared/sim/testing secretArena.ts: the carved grid, the crack at (18, 7) / (19, 7) facing +z, the chamber behind):
// the sword's finisher opens it (from the front box with the lunge, and at its full reach from a still body), swings 1
// and 2 knock, the guard does nothing (a Riposte counter-wave neither); a Wrecker roll opens it head-on and at 45
// degrees, a roll without Wrecker does nothing; a heavy arrow opens it (stream arrows, Volatile bolts and Ballista's
// bursts knock), Siege Bolt's slam beside it opens it; a Charger lured into it opens it (credited to nobody, the toast's
// finder the nearest player), a Charger charging past it does not. One opening breaks every crack piece the same tick,
// with no breakable points, break events, smash proc or Goldling release.
import { describe, expect, it } from "@rbxts/jest-globals";
import { ARENA, arenaConfig, type ArenaOptions } from "shared/sim/testing";
import { gridToWorld } from "shared/dungeon";
import {
	AXIS_MAX,
	BOW_DATA,
	BUILDS_CONFIG,
	Boon,
	BulletKind,
	Button,
	CHARGER_CHARGE,
	CHARGER_DIR_X,
	CHARGER_DIR_Z,
	CHARGER_LEFT,
	CHARGER_STUN,
	EMPTY_INPUT,
	NOT_BROKEN,
	SECRETS_CONFIG,
	SWORD_DATA,
	ScoreSource,
	SecretHow,
	SecretStatus,
	SimCtx,
	V_AGGRO,
	createSimState,
	fireBurstRaw,
	grantCard,
	meleeHitBreakables,
	packPayload,
	secretsSlamAt,
	step,
	weaponIndex,
	weaponsAt,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const SEED = 91;
/** The crack's centre (between its two cells) and its wall's face (the room side). */
const CX = gridToWorld(ARENA.crackX) + 0.5;
const CZ = gridToWorld(ARENA.wallZ);
const FACE = CZ + 0.5;

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, aimZ: -AXIS_MAX, ...over });
const IDLE = frame();
const FIRE = frame({ buttons: Button.FIRE });
const ALT = frame({ buttons: Button.ALT });

const SECRETS: Partial<SimConfig> = { secrets: SECRETS_CONFIG, scoring: {}, builds: BUILDS_CONFIG };

function arena(o: ArenaOptions = {}): { config: SimConfig; s: SimState } {
	const config = arenaConfig(SEED, { ...o, extraConfig: { ...SECRETS, ...o.extraConfig } });
	const s = createSimState(SEED, ARENA.spawnX, ARENA.spawnZ, config);
	s.player.hurtTicks = 1e6;
	return { config, s };
}

/** Both crack pieces broken on tick `tick`, the chest intact. */
function openedOn(s: SimState, tick: number): boolean {
	const b = s.breakables!;
	const first = b.pieces.size() - 1 - ARENA.cells;
	for (let c = 0; c < ARENA.cells; c++) {
		const p = b.pieces[first + c];
		if (p.brokenTick !== tick || p.hp !== 0) return false;
	}
	return b.pieces[b.pieces.size() - 1].brokenTick === NOT_BROKEN;
}

interface Watch {
	/** Ticks a knock was reported on, before the open. */
	knockTicks: number[];
	openTick: number;
	broken: number;
}

function watch(s: SimState, config: SimConfig, input: (t: number) => InputFrame, ticks: number): Watch {
	const w: Watch = { knockTicks: [], openTick: -1, broken: 0 };
	for (let t = 0; t < ticks; t++) {
		const tick = s.tick;
		step(s, input(t), config);
		w.broken += s.events.breakablesBroken;
		if (s.breakables!.knockSlots.size() > 0 && w.openTick < 0) w.knockTicks.push(tick);
		if (s.secrets!.events.opened !== undefined) {
			expect(w.openTick).toBe(-1);
			w.openTick = tick;
		}
	}
	return w;
}

describe("openers: the sword (SRD3)", () => {
	it("holding FIRE at the crack: swings 1 and 2 knock, the finisher opens it (the lunge closing in)", () => {
		const { config, s } = arena();
		s.player.x = CX;
		s.player.z = FACE + 1.5;
		const w = watch(s, config, () => FIRE, 90);
		expect(w.knockTicks.size()).toBe(2);
		expect(w.openTick > w.knockTicks[1]).toBe(true);
		const sc = s.secrets!;
		expect([sc.status, sc.openTick, sc.openedBy, sc.openHow, sc.found]).toEqual([
			SecretStatus.OPEN,
			w.openTick,
			0,
			SecretHow.FINISHER,
			1,
		]);
		expect(sc.byHow).toEqual([1, 0, 0, 0]);
		expect(openedOn(s, w.openTick)).toBe(true);
		// Not a breakables break: no break events, no breakable points; the open's SECRET points.
		expect(w.broken).toBe(0);
		expect(s.score!.counts[ScoreSource.BREAKABLES]).toBe(0);
		expect(s.score!.counts[ScoreSource.SECRET]).toBe(1);
		expect(s.builds!.procs.size()).toBe(0);
		// Open: the player walks through into the chamber.
		for (let t = 0; t < 60; t++) step(s, frame({ moveZ: -AXIS_MAX }), config);
		expect(s.player.z < CZ - 1).toBe(true);
	});

	it("the finisher from its full reach: swings never reach, the finisher (still body) opens it", () => {
		const { s } = arena();
		const reach = SWORD_DATA.finisherReach + 0.5 - 1e-6;
		// A swing's arc from there does not reach the piece; the finisher's does.
		expect(
			meleeHitBreakables(s, CX - 0.5, CZ + reach, 0, -1, SWORD_DATA.reach, SWORD_DATA.halfAngleCos, 3, 0),
		).toBe(0);
		expect(s.breakables!.knockSlots.size()).toBe(0);
		meleeHitBreakables(
			s,
			CX - 0.5,
			CZ + reach,
			0,
			-1,
			SWORD_DATA.finisherReach,
			SWORD_DATA.finisherHalfAngleCos,
			6,
			0,
			true,
		);
		expect(s.secrets!.openHow).toBe(SecretHow.FINISHER);
		expect(openedOn(s, s.tick)).toBe(true);
	});

	it("holding FIRE from beyond the swings' reach: no knock, the lunging finisher opens it", () => {
		const { config, s } = arena();
		s.player.x = CX;
		s.player.z = CZ + SWORD_DATA.reach + 0.5 + 0.2;
		const w = watch(s, config, () => FIRE, 90);
		expect(w.knockTicks.size()).toBe(0);
		expect(s.secrets!.openHow).toBe(SecretHow.FINISHER);
	});

	it("the guard against it does nothing (no knock, no open); with Riposte its counter-wave neither", () => {
		for (const riposte of [false, true]) {
			const { config, s } = arena();
			if (riposte) s.builds!.players[0].levels[Boon.RIPOSTE] = 1;
			s.player.x = CX;
			s.player.z = FACE + 0.5;
			let knocks = 0;
			for (let t = 0; t < 120; t++) {
				step(s, t < 60 ? ALT : IDLE, config);
				knocks += s.breakables!.knockSlots.size();
			}
			expect([knocks, s.secrets!.status]).toEqual([0, SecretStatus.HIDDEN]);
		}
	});
});

describe("openers: the Wrecker roll", () => {
	it("a Wrecker owner's roll into it opens it, head-on and at 45 degrees", () => {
		for (const [ox, mx] of [
			[0, 0],
			[1.2, -AXIS_MAX],
		]) {
			const { config, s } = arena();
			s.builds!.players[0].levels[Boon.WRECKER] = 1;
			s.player.x = CX + ox;
			s.player.z = FACE + 1.2;
			const roll = frame({ buttons: Button.ROLL, moveX: mx, moveZ: -AXIS_MAX });
			const w = watch(s, config, (t) => (t < 20 ? roll : IDLE), 30);
			expect(w.openTick >= 0).toBe(true);
			expect([s.secrets!.openHow, s.secrets!.openedBy]).toEqual([SecretHow.ROLL, 0]);
			expect(openedOn(s, w.openTick)).toBe(true);
			expect(w.broken).toBe(0);
			expect(s.builds!.events.smashOwner.size()).toBe(0);
		}
	});

	it("a roll without Wrecker: nothing (no open, no knock)", () => {
		const { config, s } = arena();
		s.player.x = CX;
		s.player.z = FACE + 1.2;
		const roll = frame({ buttons: Button.ROLL, moveZ: -AXIS_MAX });
		const w = watch(s, config, (t) => (t < 20 ? roll : IDLE), 30);
		expect([w.openTick, w.knockTicks.size(), s.secrets!.status]).toEqual([-1, 0, SecretStatus.HIDDEN]);
	});
});

const BOW_SOURCE = (): number => weaponIndex("weapon.bow") + 1;

/** Fires one player bullet of `kind` at the crack from 4 tiles out (speed `speed`). */
function shot(s: SimState, kind: number, speed: number, damage = 1): void {
	const c = s.combat;
	c.playerSpawned += fireBurstRaw(
		c.playerBullets,
		weaponsAt(s, 0).emitterId,
		CX - 0.5,
		CZ + 4,
		0,
		-1,
		1,
		0,
		speed,
		2,
		packPayload(damage, kind, BOW_SOURCE(), kind === BulletKind.PLAYER ? BOW_DATA.heavyPierce : 0),
	);
}

describe("openers: the heavy arrow and Siege Bolt", () => {
	it("a charged shot opens it (HEAVY, credited to the archer)", () => {
		const { config, s } = arena({ loadout: ["weapon.bow"] });
		s.player.x = CX;
		s.player.z = CZ + 4;
		const w = watch(s, config, (t) => (t <= BOW_DATA.chargeTicks + 1 ? ALT : IDLE), BOW_DATA.chargeTicks + 40);
		expect(w.openTick >= 0).toBe(true);
		expect([s.secrets!.openHow, s.secrets!.openedBy]).toEqual([SecretHow.HEAVY, 0]);
		expect(openedOn(s, w.openTick)).toBe(true);
	});

	it("stream arrows, Volatile bolts and Ballista bursts knock, never open", () => {
		for (const [kind, speed] of [
			[BulletKind.PLAYER, 16],
			[BulletKind.BURST, BOW_DATA.heavySpeed],
			[BulletKind.SHARD, BOW_DATA.heavySpeed],
		]) {
			const { config, s } = arena({ loadout: ["weapon.bow"] });
			s.player.x = 30;
			s.player.z = 25;
			shot(s, kind, speed);
			const w = watch(s, config, () => IDLE, 30);
			expect([w.openTick, w.knockTicks.size()]).toEqual([-1, 1]);
			expect(s.secrets!.status).toBe(SecretStatus.HIDDEN);
		}
	});

	it("a raw heavy arrow (the heavy speed) opens it too", () => {
		const { config, s } = arena({ loadout: ["weapon.bow"] });
		s.player.x = 30;
		s.player.z = 25;
		shot(s, BulletKind.PLAYER, BOW_DATA.heavySpeed, BOW_DATA.heavyDamage);
		const w = watch(s, config, () => IDLE, 30);
		expect(w.openTick >= 0).toBe(true);
		expect(s.secrets!.openHow).toBe(SecretHow.HEAVY);
	});

	it("Siege Bolt's slam: on the cell in front (a 4-neighbour) opens it, on a diagonal or farther it does not", () => {
		const { s } = arena();
		expect(secretsSlamAt(s, CX + 1.5, FACE + 0.5, 0)).toBe(false); // diagonal of the second cell
		expect(secretsSlamAt(s, CX, FACE + 1.5, 0)).toBe(false); // two cells out
		expect(s.secrets!.status).toBe(SecretStatus.HIDDEN);
		expect(secretsSlamAt(s, CX - 0.5, FACE + 0.5, 0)).toBe(true);
		expect([s.secrets!.openHow, s.secrets!.openedBy]).toEqual([SecretHow.HEAVY, 0]);
		expect(openedOn(s, s.tick)).toBe(true);
		expect(secretsSlamAt(s, CX - 0.5, FACE + 0.5, 0)).toBe(false); // once
	});

	it("a pinned dummy carried into it by a Siege Bolt opens it", () => {
		const { config, s } = arena({ loadout: ["weapon.bow"] });
		for (let k = 0; k < 3; k++) grantCard(s, 0, Boon.BALLISTA);
		s.player.x = 30;
		s.player.z = 25;
		const ctx = new SimCtx().bind(s, config.endless!.worldForFloor(1).config, EMPTY_INPUT);
		const a = ctx.spawnActor("test.dummy", CX - 0.5, CZ + 5)!;
		a.hp = 100;
		a.hpMax = 100;
		a.spawnTick = -1;
		const c = s.combat;
		c.playerSpawned += fireBurstRaw(
			c.playerBullets,
			weaponsAt(s, 0).emitterId,
			CX - 0.5,
			CZ + 8,
			0,
			-1,
			1,
			0,
			BOW_DATA.heavySpeed,
			BOW_DATA.heavyLife,
			packPayload(BOW_DATA.heavyDamage, BulletKind.PLAYER, BOW_SOURCE(), BOW_DATA.heavyPierce),
		);
		const w = watch(s, config, () => IDLE, 40);
		expect(w.openTick >= 0).toBe(true);
		expect(s.secrets!.openHow).toBe(SecretHow.HEAVY);
	});
});

describe("openers: the Charger (SRD8)", () => {
	function charger(s: SimState, config: SimConfig, x: number, z: number, dirX: number, dirZ: number): void {
		const ctx = new SimCtx().bind(s, config.endless!.worldForFloor(1).config, EMPTY_INPUT);
		const c = ctx.spawnActor("charger", x, z)!;
		c.hp = 1000;
		c.hpMax = 1000;
		c.spawnTick = -1;
		c.v[V_AGGRO] = 1;
		c.aiState = CHARGER_CHARGE;
		c.v[CHARGER_DIR_X] = dirX;
		c.v[CHARGER_DIR_Z] = dirZ;
		c.v[CHARGER_LEFT] = 12;
	}

	it("lured into it: the charge opens it (credited to nobody, the finder the nearest player), and it stuns", () => {
		const { config, s } = arena();
		s.player.x = CX + 3;
		s.player.z = FACE + 1;
		charger(s, config, CX, CZ + 8, 0, -1);
		const w = watch(s, config, () => IDLE, 60);
		expect(w.openTick >= 0).toBe(true);
		expect([s.secrets!.openHow, s.secrets!.openedBy]).toEqual([SecretHow.CHARGER, -1]);
		expect(openedOn(s, w.openTick)).toBe(true);
		expect(w.knockTicks.size()).toBe(0);
		const a = s.combat.actors.find((o) => o.alive !== 0 && o.aiState === CHARGER_STUN);
		expect(a).never.toBe(undefined);
	});

	it("its finder is the nearest living player at the open", () => {
		const { config, s } = arena();
		s.player.x = CX + 3;
		s.player.z = FACE + 1;
		charger(s, config, CX, CZ + 8, 0, -1);
		let finder = -2;
		for (let t = 0; t < 60 && finder === -2; t++) {
			step(s, IDLE, config);
			const o = s.secrets!.events.opened;
			if (o !== undefined) finder = o.finder;
		}
		expect(finder).toBe(0);
	});

	it("charging past it along the wall (two cells out) does not open it", () => {
		const { config, s } = arena();
		s.player.x = 30;
		s.player.z = 25;
		charger(s, config, CX - 8, FACE + 2.2, 1, 0);
		const w = watch(s, config, () => IDLE, 80);
		expect(w.openTick).toBe(-1);
		expect(s.secrets!.status).toBe(SecretStatus.HIDDEN);
	});
});
