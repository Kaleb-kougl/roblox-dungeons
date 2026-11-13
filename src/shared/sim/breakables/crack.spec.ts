// A secret room's cracked wall in the sim (docs/SECRET_ROOMS.md SR2, Design 2): BreakableKind.CRACKED_WALL 3 is inert
// like the chest (inertPiece): it takes no damage from any source (every bullet kind, the sword's melee pass, slams, a
// Bomber's radius, Demolition, Siege's shock), and every contact that reaches damageBreakable is ONE knock in the
// per-tick feed (knockSlots / knockSources / knockPlayers, unhashed); a bullet stops on it; bodies (players, actors on
// the plain mover) stop on it. The clutter kinds and the chest keep their behaviour (breakables.spec.ts). The arena is
// shared/sim/testing secretArena.ts (the carved grid: the crack's cells are FLOOR, blocked by their pieces).
import { describe, expect, it } from "@rbxts/jest-globals";
import { ARENA, arenaConfig, type ArenaOptions } from "shared/sim/testing";
import { gridToWorld } from "shared/dungeon";
import {
	AXIS_MAX,
	BUILDS_CONFIG,
	Boon,
	BreakableKind,
	BreakableSource,
	BulletKind,
	Button,
	CHEST_HP,
	CRACKED_WALL_HP,
	EMPTY_INPUT,
	NOT_BROKEN,
	PLAYER_RADIUS,
	SimCtx,
	cloneSimState,
	createSimState,
	damageBreakable,
	fireBurstRaw,
	hashState,
	inertPiece,
	meleeHitBreakables,
	moveActor,
	packPayload,
	slamBreakables,
	step,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const SEED = 77;
const CRACK = 0; // the crack's first slot without extra pieces
const CX = gridToWorld(ARENA.crackX) + 0.5; // between the two crack cells
const CZ = gridToWorld(ARENA.wallZ);

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, aimZ: -AXIS_MAX, ...over });
const IDLE = frame();
const FIRE = frame({ buttons: Button.FIRE });
const TOWARD = frame({ moveZ: -AXIS_MAX });

function arena(o: ArenaOptions = {}): { config: SimConfig; s: SimState } {
	const config = arenaConfig(SEED, o);
	return { config, s: createSimState(SEED, ARENA.spawnX, ARENA.spawnZ, config) };
}

function knocks(s: SimState): Array<[number, number, number]> {
	const b = s.breakables!;
	const out: Array<[number, number, number]> = [];
	for (let k = 0; k < b.knockSlots.size(); k++) out.push([b.knockSlots[k], b.knockSources[k], b.knockPlayers[k]]);
	return out;
}

function crackIntact(s: SimState): boolean {
	// The crack's slots are the last pieces but the chest.
	const b = s.breakables!;
	const first = b.pieces.size() - 1 - ARENA.cells;
	for (let c = 0; c < ARENA.cells; c++) {
		const p = b.pieces[first + c];
		if (p.kind !== BreakableKind.CRACKED_WALL || p.hp !== CRACKED_WALL_HP || p.brokenTick !== NOT_BROKEN)
			return false;
	}
	return true;
}

function enemyShot(s: SimState, emitter: number, x: number, z: number, dirX: number, dirZ: number): void {
	const payload = packPayload(1, BulletKind.ENEMY, 1);
	s.combat.enemySpawned += fireBurstRaw(s.combat.enemyBullets, emitter, x, z, dirX, dirZ, 1, 0, 6, 2, payload);
}

describe("cracked wall: an inert piece", () => {
	it("BreakableKind.CRACKED_WALL 3 with CRACKED_WALL_HP; inertPiece is the chest and the crack only", () => {
		expect(BreakableKind.CRACKED_WALL).toBe(3);
		expect([0, 1, 2, 3].map((k) => inertPiece(k))).toEqual([false, false, true, true]);
		const { s } = arena();
		const b = s.breakables!;
		expect(b.pieces.map((p) => [p.kind, p.x, p.y, p.hp, p.brokenTick])).toEqual([
			[BreakableKind.CRACKED_WALL, ARENA.crackX, ARENA.wallZ, CRACKED_WALL_HP, NOT_BROKEN],
			[BreakableKind.CRACKED_WALL, ARENA.crackX + 1, ARENA.wallZ, CRACKED_WALL_HP, NOT_BROKEN],
			[BreakableKind.CHEST, ARENA.chestX, ARENA.chestY, CHEST_HP, NOT_BROKEN],
		]);
		expect(b.intact).toBe(3);
		expect(knocks(s)).toEqual([]);
	});

	it("damageBreakable, every source: false, no hit / break event or slot, one knock each (source and owner)", () => {
		const { s } = arena();
		const sources = [
			BreakableSource.MELEE,
			BreakableSource.PLAYER_BULLET,
			BreakableSource.ENEMY_BULLET,
			BreakableSource.SLAM,
			BreakableSource.ROLL,
			BreakableSource.BUILD,
		];
		for (const src of sources) expect(damageBreakable(s, CRACK + 1, 1000, src, src === 2 ? -1 : 0)).toBe(false);
		expect([s.events.breakableHits, s.events.breakablesBroken]).toEqual([0, 0]);
		expect([s.breakables!.hitSlots.size(), s.breakables!.brokenSlots.size()]).toEqual([0, 0]);
		expect(knocks(s)).toEqual(sources.map((src) => [CRACK + 1, src, src === 2 ? -1 : 0]));
		expect(crackIntact(s)).toBe(true);
		// The chest stays silent.
		expect(damageBreakable(s, CRACK + ARENA.cells, 1000, BreakableSource.MELEE, 0)).toBe(false);
		expect(knocks(s).size()).toBe(sources.size());
	});

	it("the knock feed is per tick (cleared by step), copied by clone and never hashed", () => {
		const { config, s } = arena();
		const twin = cloneSimState(s);
		damageBreakable(s, CRACK, 1, BreakableSource.MELEE, 0);
		expect(cloneSimState(s).breakables!.knockSlots).toEqual([CRACK]);
		expect(hashState(s)).toBe(hashState(twin));
		step(s, IDLE, config);
		expect(knocks(s)).toEqual([]);
	});

	it("the melee pass: a swing's arc over the crack knocks each piece in it, damages nothing", () => {
		const { s } = arena();
		meleeHitBreakables(s, CX, CZ + 1.2, 0, -1, 1.955, 0.5, 3, 0);
		expect(knocks(s)).toEqual([
			[CRACK, BreakableSource.MELEE, 0],
			[CRACK + 1, BreakableSource.MELEE, 0],
		]);
		expect(crackIntact(s)).toBe(true);
	});

	it("the Knight's swings at the wall: knocks, never a hit, the crack intact", () => {
		const { config, s } = arena();
		s.player.x = CX;
		s.player.z = CZ + 0.5 + PLAYER_RADIUS + 0.4;
		let k = 0;
		for (let t = 0; t < 30; t++) {
			step(s, FIRE, config);
			k += knocks(s).size();
			expect(s.events.breakableHits).toBe(0);
		}
		expect(k > 0).toBe(true);
		expect(crackIntact(s)).toBe(true);
	});

	it("stream arrows stop on it: one knock per arrow, none flies into the chamber", () => {
		const { config, s } = arena({ loadout: ["weapon.bow"] });
		s.player.x = CX;
		s.player.z = CZ + 3;
		let k = 0;
		let deepest = math.huge;
		for (let t = 0; t < 120; t++) {
			step(s, FIRE, config);
			for (const [, src] of knocks(s)) {
				expect(src).toBe(BreakableSource.PLAYER_BULLET);
				k++;
			}
			s.combat.playerBullets.forEachActive((i) => {
				deepest = math.min(deepest, s.combat.playerBullets.positionAt(i).z);
				return false;
			});
		}
		expect(k > 3).toBe(true);
		expect(deepest > CZ - 0.5).toBe(true);
		expect(crackIntact(s)).toBe(true);
	});

	it("enemy bullets: consumed on it, one knock each (no player), no damage", () => {
		const { config, s } = arena();
		s.player.x = 30;
		s.player.z = 25;
		const em = s.combat.enemyBullets.acquireEmitter();
		s.combat.enemyEmitters += 1;
		let k = 0;
		for (let shot = 0; shot < 5; shot++) {
			enemyShot(s, em, CX, CZ + 3, 0, -1);
			for (let t = 0; t < 40; t++) {
				step(s, IDLE, config);
				for (const [, src, who] of knocks(s)) {
					expect([src, who]).toEqual([BreakableSource.ENEMY_BULLET, -1]);
					k++;
				}
			}
			expect(s.combat.enemyBullets.activeCount).toBe(0);
		}
		expect(k).toBe(5);
		expect(crackIntact(s)).toBe(true);
	});

	it("slams (the boss's radius, a Bomber's / Charger's radius): never broken, one knock per piece in reach", () => {
		const barrel = { x: ARENA.crackX - 2, y: ARENA.wallZ + 1, kind: "barrel" as const };
		const { s } = arena({ extra: [barrel] });
		expect(slamBreakables(s, CX, CZ + 1, 1.3)).toBe(0);
		expect(knocks(s)).toEqual([
			[1, BreakableSource.SLAM, -1],
			[2, BreakableSource.SLAM, -1],
		]);
		expect(slamBreakables(s, CX, CZ + 1)).toBe(1); // the boss's radius: the barrel breaks, the crack knocks
		expect(s.breakables!.pieces[0].brokenTick).toBe(s.tick);
		expect(knocks(s).size()).toBe(4);
		expect([s.breakables!.pieces[1].brokenTick, s.breakables!.pieces[2].brokenTick]).toEqual([
			NOT_BROKEN,
			NOT_BROKEN,
		]);
	});

	it("Demolition (Wrecker III): the blast beside it knocks it, the crate breaks", () => {
		const crate = { x: ARENA.crackX, y: ARENA.wallZ + 1, kind: "crate" as const };
		const { config, s } = arena({ extra: [crate], extraConfig: { builds: BUILDS_CONFIG, scoring: {} } });
		s.builds!.players[0].levels[Boon.WRECKER] = 3;
		damageBreakable(s, 0, 100, BreakableSource.MELEE, 0, 0);
		let builds = 0;
		for (let t = 0; t < 3; t++) {
			step(s, IDLE, config);
			for (const [slot, src, who] of knocks(s)) {
				expect(slot === 1 || slot === 2).toBe(true);
				expect([src, who]).toEqual([BreakableSource.BUILD, 0]);
				builds++;
			}
		}
		expect(builds).toBe(ARENA.cells);
		expect(s.breakables!.pieces[0].brokenTick).never.toBe(NOT_BROKEN);
		expect(crackIntact(s)).toBe(true);
	});

	it("bodies stop on it: the player walking into it, an actor on the plain mover", () => {
		const { config, s } = arena();
		s.player.x = CX;
		s.player.z = CZ + 2;
		for (let t = 0; t < 90; t++) {
			step(s, TOWARD, config);
			expect(s.player.z >= CZ + 0.5 + PLAYER_RADIUS - 1e-9).toBe(true);
		}
		const ctx = new SimCtx().bind(s, config.endless!.worldForFloor(1).config, EMPTY_INPUT);
		const a = ctx.spawnActor("test.dummy", CX, CZ + 2)!;
		for (let t = 0; t < 30; t++) moveActor(ctx, a, 0, -0.2);
		expect(a.z >= CZ + 0.5 + a.radius - 1e-9).toBe(true);
		expect(crackIntact(s)).toBe(true);
	});
});
