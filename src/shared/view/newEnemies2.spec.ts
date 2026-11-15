// The third endless set on screen (docs/NEW_ENEMIES_2.md NX7): the guard arc only on guarding Shieldwalls and inside
// the sim's front cone, the stagger stars, the chain's target (its HOOK by emitter, the dragged player), the belly pips
// and the swallow pulse, the torch's flight to the landing cell, the pyre's flame, the sprite inputs (block held while
// guarding, the stagger as a slowed hit), the hook / flame bullet looks, the frame's burst list and its collector.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ACTOR_SCRATCH_SLOTS,
	AiState,
	BULWARK,
	BULWARK_BASH,
	BULWARK_GUARDING,
	BULWARK_RECOVER,
	BULWARK_STAGGER,
	BulletKind,
	CHAINHOOK,
	CHAINHOOK_ATTACK_THROW,
	CHAINHOOK_DRAG,
	CHAINHOOK_HOOKED,
	CHAINHOOK_THROWN,
	DAMAGE_CAP_BUCKETS,
	HookEnd,
	NO_KIND,
	PYRE,
	PYREKEEPER,
	PYREKEEPER_ATTACK_LIGHT,
	PYREKEEPER_LAND_X,
	PYREKEEPER_LAND_Z,
	SNATCHER,
	SNATCHER_ATTACK_SWALLOW,
	SNATCHER_CARRIED,
	SNIPER,
	archetypeIndex,
	createSimState,
	packPayload,
	playerAt,
	type ActorSpawn,
	type ActorState,
	type SimConfig,
} from "shared/sim";
import { ENEMY, optionalBaseAnimations, type SpriteAnimationDef } from "shared/theme";
import { EnemyBulletLook, ENEMY_BULLET_LOOK_IDS, enemyBulletLookOf } from "./bullets";
import { NewEnemy2FrameEvents } from "./fx/newEnemy2Events";
import type { SegmentSink } from "./markings";
import {
	ChainTarget,
	NEW_ENEMY_2_BURST_LOOKS,
	NewEnemy2Burst,
	bellyPipSegments,
	bellyPips,
	bellyPulse,
	bulwarkGuarding,
	chainSegments,
	chainTarget,
	guardArcSegments,
	hookBulletSlot,
	newEnemy2Bursts,
	newEnemy2Kinds,
	newTorchPoint,
	pyreFlameScale,
	snatcherSwallowing,
	staggerMarked,
	torchArcPoint,
	type HookBulletSource,
	type NewEnemy2BurstAt,
} from "./newEnemies2";
import { BELLY_VIEW, CHAIN_VIEW, GUARD_VIEW, NEW_ENEMY_2_SPRITE_VIEW, PYRE_FLAME_VIEW } from "./newEnemies2Config";
import { bulwarkSpriteInput, chainhookSpriteInput, pyreSpriteInput, snatcherSpriteInput } from "./newEnemy2Sprites";
import { ACTOR_SPRITE_INPUTS, chooseActorAnim, type SpriteAnimSource } from "./sprites";

const K = newEnemy2Kinds();

/** A live ActorState at rest (fields overridden per case). */
function actor(over: Partial<ActorState>): ActorState {
	return {
		id: 1,
		kind: 0,
		spawnTick: -1,
		x: 0,
		z: 0,
		prevX: 0,
		prevZ: 0,
		faceX: 1,
		faceZ: 0,
		hp: 3,
		hpMax: 3,
		radius: 0.4,
		alive: 1,
		deadTicks: 0,
		aiState: 0,
		aiTicks: 0,
		attack: 0,
		cooldown: 0,
		flashTicks: 0,
		emitterId: 0,
		phase: 0,
		capBucket: -1,
		capWindow: table.create(DAMAGE_CAP_BUCKETS, 0),
		v: table.create(ACTOR_SCRATCH_SLOTS, 0),
		...over,
	};
}

function withV(a: ActorState, slot: number, value: number): ActorState {
	a.v[slot] = value;
	return a;
}

/** A sink that keeps every segment's ends. */
class Collect implements SegmentSink {
	readonly ends: Array<[number, number, number, number]> = [];
	seg(x0: number, z0: number, x1: number, z1: number): void {
		this.ends.push([x0, z0, x1, z1]);
	}
}

function anim(frames: number, fps: number, loop: boolean): SpriteAnimationDef {
	return { sheet: 0, start: 0, frames, fps, loop };
}

function source(anims: Readonly<Record<string, SpriteAnimationDef>>): SpriteAnimSource {
	return {
		animation(name: string) {
			return anims[name];
		},
	};
}

const SET = source({
	idle: anim(4, 6, true),
	move: anim(4, 8, true),
	attack: anim(6, 10, false),
	hit: anim(3, 10, false),
	death: anim(4, 8, false),
	block: anim(2, 6, true),
});

describe("the Shieldwall's guard arc and stagger stars", () => {
	it("draws only for a living Shieldwall with its guard up (v[BULWARK_GUARDING] 1)", () => {
		const guarding = withV(actor({ kind: K.bulwark }), BULWARK_GUARDING, 1);
		expect(bulwarkGuarding(guarding)).toBe(true);
		expect(bulwarkGuarding(withV(actor({ kind: K.bulwark, aiState: BULWARK_RECOVER }), BULWARK_GUARDING, 0))).toBe(
			false,
		);
		expect(bulwarkGuarding(withV(actor({ kind: K.bulwark, aiState: BULWARK_STAGGER }), BULWARK_GUARDING, 0))).toBe(
			false,
		);
		expect(bulwarkGuarding(withV(actor({ kind: K.bulwark, alive: 0 }), BULWARK_GUARDING, 1))).toBe(false);
		expect(bulwarkGuarding(withV(actor({ kind: archetypeIndex(SNIPER.id) }), BULWARK_GUARDING, 1))).toBe(false);
	});

	it("spans the sim's front cone around the facing at radius + margin", () => {
		const sink = new Collect();
		const [fx, fz] = [0.6, -0.8];
		guardArcSegments(sink, 3, 4, fx, fz, 0.45);
		expect(sink.ends.size() > 2).toBe(true);
		const r = 0.45 + GUARD_VIEW.marginTiles;
		const cos = BULWARK.data.frontCos;
		for (const [x0, z0, x1, z1] of sink.ends) {
			for (const [x, z] of [
				[x0, z0],
				[x1, z1],
			]) {
				const dx = x - 3;
				const dz = z - 4;
				expect(math.sqrt(dx * dx + dz * dz)).toBeCloseTo(r, 9);
				expect((dx * fx + dz * fz) / r >= cos - 1e-9).toBe(true);
			}
		}
		// Both cone edges are reached (the arc is the whole front, not a part of it).
		const first = sink.ends[0];
		const last = sink.ends[sink.ends.size() - 1];
		expect(((first[0] - 3) * fx + (first[1] - 4) * fz) / r).toBeCloseTo(cos, 9);
		expect(((last[2] - 3) * fx + (last[3] - 4) * fz) / r).toBeCloseTo(cos, 9);
		const none = new Collect();
		guardArcSegments(none, 0, 0, 0, 0, 0.45);
		expect(none.ends.size()).toBe(0);
	});

	it("marks the stagger only (not the bash, the recovery, or another kind's state)", () => {
		expect(staggerMarked(actor({ kind: K.bulwark, aiState: BULWARK_STAGGER }))).toBe(true);
		expect(staggerMarked(actor({ kind: K.bulwark, aiState: BULWARK_BASH }))).toBe(false);
		expect(staggerMarked(actor({ kind: K.bulwark, aiState: BULWARK_RECOVER }))).toBe(false);
		expect(staggerMarked(actor({ kind: K.bulwark, aiState: BULWARK_STAGGER, alive: 0 }))).toBe(false);
		expect(staggerMarked(actor({ kind: K.chainhook, aiState: BULWARK_STAGGER }))).toBe(false);
	});
});

/** A fake bullet pool: (live, emitter, kind) per slot. */
function pool(rows: ReadonlyArray<readonly [boolean, number, number]>): HookBulletSource {
	return {
		highWater() {
			return rows.size();
		},
		isLive(i) {
			return rows[i][0];
		},
		emitterIdAt(i) {
			return rows[i][1];
		},
		payloadAt(i) {
			return packPayload(0, rows[i][2], 1);
		},
	};
}

describe("the Chainhook's chain", () => {
	it("runs to the hook in flight, to the dragged player, else nowhere", () => {
		expect(chainTarget(actor({ kind: K.chainhook, aiState: CHAINHOOK_THROWN }))).toBe(ChainTarget.HOOK);
		expect(chainTarget(withV(actor({ kind: K.chainhook, aiState: CHAINHOOK_DRAG }), CHAINHOOK_HOOKED, 2))).toBe(
			ChainTarget.PLAYER,
		);
		expect(chainTarget(actor({ kind: K.chainhook, aiState: CHAINHOOK_DRAG }))).toBe(ChainTarget.NONE);
		expect(chainTarget(actor({ kind: K.chainhook, aiState: AiState.TELEGRAPH }))).toBe(ChainTarget.NONE);
		expect(chainTarget(actor({ kind: K.chainhook, aiState: CHAINHOOK_THROWN, alive: 0 }))).toBe(ChainTarget.NONE);
		expect(chainTarget(actor({ kind: K.bulwark, aiState: CHAINHOOK_THROWN }))).toBe(ChainTarget.NONE);
	});

	it("finds its own live HOOK bullet by emitter id (not another's, not a plain bullet, not a dead slot)", () => {
		const sim = pool([
			[true, 7, BulletKind.ENEMY],
			[false, 7, BulletKind.HOOK],
			[true, 8, BulletKind.HOOK],
			[true, 7, BulletKind.HOOK],
		]);
		expect(hookBulletSlot(sim, 7)).toBe(3);
		expect(hookBulletSlot(sim, 8)).toBe(2);
		expect(hookBulletSlot(sim, 9)).toBe(-1);
	});

	it("starts at its hand and ends on the target; nothing for a target inside its hand", () => {
		const sink = new Collect();
		chainSegments(sink, 0, 0, 0.45, 4, 0);
		expect(sink.ends).toEqual([[0.45 + CHAIN_VIEW.handTiles, 0, 4, 0]]);
		const none = new Collect();
		chainSegments(none, 0, 0, 0.45, 0.2, 0);
		expect(none.ends.size()).toBe(0);
	});
});

describe("the Snatcher's belly", () => {
	it("shows its carried count up to the pips, nothing on another kind or a corpse", () => {
		expect(bellyPips(withV(actor({ kind: K.snatcher }), SNATCHER_CARRIED, 3))).toBe(3);
		expect(bellyPips(withV(actor({ kind: K.snatcher }), SNATCHER_CARRIED, 9))).toBe(BELLY_VIEW.pips);
		expect(bellyPips(withV(actor({ kind: K.snatcher, alive: 0 }), SNATCHER_CARRIED, 3))).toBe(0);
		expect(bellyPips(withV(actor({ kind: K.bulwark }), SNATCHER_CARRIED, 3))).toBe(0);
		const sink = new Collect();
		bellyPipSegments(sink, 0, 0, 0.3, 3, 1);
		expect(sink.ends.size()).toBe(3 * 2); // one cross per carried pellet
	});

	it("pulses only while it swallows, and never under reduced motion", () => {
		const swallowing = actor({ kind: K.snatcher, aiState: AiState.TELEGRAPH, attack: SNATCHER_ATTACK_SWALLOW });
		expect(snatcherSwallowing(swallowing)).toBe(true);
		expect(snatcherSwallowing(actor({ kind: K.snatcher, aiState: AiState.TELEGRAPH }))).toBe(false);
		let peak = 1;
		for (let t = 0; t < 1; t += 0.01) peak = math.max(peak, bellyPulse(true, t, 1));
		expect(peak > 1.4).toBe(true);
		expect(peak <= 1 + BELLY_VIEW.pulseAmp + 1e-9).toBe(true);
		for (let t = 0; t < 1; t += 0.1) {
			expect(bellyPulse(false, t, 1)).toBe(1);
			expect(bellyPulse(true, t, 0)).toBe(1);
		}
	});
});

describe("the Pyre-keeper's torch and the pyre's flame", () => {
	const total = PYREKEEPER.data.lightTelegraphTicks;
	function keeper(aiTicks: number): ActorState {
		const a = actor({ kind: K.pyrekeeper, aiState: AiState.TELEGRAPH, attack: PYREKEEPER_ATTACK_LIGHT, aiTicks });
		a.v[PYREKEEPER_LAND_X] = 4;
		a.v[PYREKEEPER_LAND_Z] = -2;
		return a;
	}

	it("flies over the telegraph's last share and lands on the landing point as it runs out", () => {
		const out = newTorchPoint();
		expect(torchArcPoint(keeper(total), 0, 0, 0, out).shown).toBe(false); // the telegraph's start: in hand
		const landed = torchArcPoint(keeper(0), 0, 0, 0, out);
		expect([landed.shown, landed.x, landed.z, landed.heightTiles]).toEqual([true, 4, -2, 0]);
		let peak = 0;
		for (let t = total; t >= 0; t--) peak = math.max(peak, torchArcPoint(keeper(t), 0, 0, 0, out).heightTiles);
		expect(peak > 1).toBe(true);
		expect(torchArcPoint(actor({ kind: K.pyrekeeper, aiState: AiState.TELEGRAPH }), 0, 0, 0, out).shown).toBe(
			false,
		);
	});

	it("grows while the pyre lights, flickers within its amplitude once lit, steady under reduced motion", () => {
		const lit = PYRE.data.litTicks;
		const lighting = actor({ kind: K.pyre, aiTicks: lit });
		expect(pyreFlameScale(lighting, 0, 0, 1)).toBeCloseTo(PYRE_FLAME_VIEW.lightingFrom, 9);
		const burning = actor({ kind: K.pyre, aiTicks: 0, id: 5 });
		for (let t = 0; t < 2; t += 0.05) {
			const s = pyreFlameScale(burning, 0, t, 1);
			expect(math.abs(s - 1) <= PYRE_FLAME_VIEW.flickerAmp + 1e-9).toBe(true);
			expect(pyreFlameScale(burning, 0, t, 0)).toBe(1);
		}
		expect(pyreFlameScale(actor({ kind: K.pyre, alive: 0 }), 0, 0, 1)).toBe(0);
		expect(pyreFlameScale(actor({ kind: K.pyrekeeper }), 0, 0, 1)).toBe(0);
	});
});

describe("sprite inputs", () => {
	it("registers all five; the Shieldwall holds `block` while it guards and plays `hit` over the whole stagger", () => {
		for (const id of ["bulwark", "chainhook", "snatcher", "pyrekeeper", "pyre"])
			expect([id, ACTOR_SPRITE_INPUTS.has(id)]).toEqual([id, true]);
		expect(optionalBaseAnimations(ENEMY).includes(NEW_ENEMY_2_SPRITE_VIEW.anims.block)).toBe(true);
		const guard = withV(actor({ kind: K.bulwark }), BULWARK_GUARDING, 1);
		expect(chooseActorAnim(bulwarkSpriteInput(guard, 0), SET).anim).toBe("block");
		const walking = withV(actor({ kind: K.bulwark, prevX: 0, x: BULWARK.data.speed / 60 }), BULWARK_GUARDING, 1);
		expect(chooseActorAnim(bulwarkSpriteInput(walking, 0), SET).anim).toBe("move");
		const down = withV(actor({ kind: K.bulwark, aiState: BULWARK_RECOVER }), BULWARK_GUARDING, 0);
		expect(chooseActorAnim(bulwarkSpriteInput(down, 0), SET).anim).toBe("idle");
		// a set without `block`: idle
		const plain = source({ idle: anim(4, 6, true), attack: anim(4, 6, false), death: anim(4, 6, false) });
		expect(chooseActorAnim(bulwarkSpriteInput(guard, 0), plain).anim).toBe("idle");
		const st = BULWARK.data.staggerTicks;
		const start = chooseActorAnim(
			bulwarkSpriteInput(actor({ kind: K.bulwark, aiState: BULWARK_STAGGER, aiTicks: st }), 0),
			SET,
		);
		const mid = chooseActorAnim(
			bulwarkSpriteInput(actor({ kind: K.bulwark, aiState: BULWARK_STAGGER, aiTicks: st / 2 }), 0),
			SET,
		);
		expect([start.anim, mid.anim]).toEqual(["hit", "hit"]);
		expect(mid.progress).toBeCloseTo(0.5, 9); // stretched over the whole stagger: slowed
	});

	it("the Chainhook's aim, the Snatcher's swallow and a pyre's idle", () => {
		const aim = actor({
			kind: K.chainhook,
			aiState: AiState.TELEGRAPH,
			attack: CHAINHOOK_ATTACK_THROW,
			aiTicks: CHAINHOOK.data.aimTicks,
		});
		expect(chooseActorAnim(chainhookSpriteInput(aim, 0), SET).anim).toBe("attack");
		const gulp = actor({
			kind: K.snatcher,
			aiState: AiState.TELEGRAPH,
			attack: SNATCHER_ATTACK_SWALLOW,
			aiTicks: SNATCHER.data.swallowTicks,
		});
		expect(chooseActorAnim(snatcherSpriteInput(gulp, 0), SET).anim).toBe("attack");
		expect(chooseActorAnim(pyreSpriteInput(actor({ kind: K.pyre }), 0), SET).anim).toBe("idle");
		expect(chooseActorAnim(pyreSpriteInput(actor({ kind: K.pyre, alive: 0 }), 0), SET).anim).toBe("death");
	});
});

describe("bullet looks", () => {
	it("gives the pyre's fireballs the flame (by payload source) and the hook its own look", () => {
		const pyreSource = archetypeIndex(PYRE.id) + 1;
		expect(enemyBulletLookOf(packPayload(1, BulletKind.ENEMY, pyreSource))).toBe(EnemyBulletLook.FLAME);
		expect(enemyBulletLookOf(packPayload(0, BulletKind.HOOK, archetypeIndex(CHAINHOOK.id) + 1))).toBe(
			EnemyBulletLook.HOOK,
		);
		expect(enemyBulletLookOf(packPayload(1, BulletKind.ENEMY, archetypeIndex(PYREKEEPER.id) + 1))).toBe(
			EnemyBulletLook.SMALL,
		);
		expect(enemyBulletLookOf(packPayload(1, BulletKind.SNIPER, pyreSource))).toBe(EnemyBulletLook.NEEDLE);
		expect(ENEMY_BULLET_LOOK_IDS[EnemyBulletLook.FLAME]).toBe("bullet.enemy.flame");
		expect(ENEMY_BULLET_LOOK_IDS[EnemyBulletLook.HOOK]).toBe("bullet.enemy.hook");
	});
});

const openConfig = (spawns: ActorSpawn[]): SimConfig => ({
	encounter: { spawns, rooms: [], entranceRoom: -1, bossRoom: -1 },
});

describe("the frame's events and bursts", () => {
	it("collects blocks, guard breaks, chain snaps (breaks only) and pyres going out, once each", () => {
		const s = createSimState(
			3,
			0,
			0,
			openConfig([
				{ kind: BULWARK.id, x: 2, z: 5 },
				{ kind: CHAINHOOK.id, x: 6, z: 0 },
				{ kind: PYRE.id, x: -3, z: 4 },
			]),
		);
		const [bulwark, chain, pyre] = [s.combat.actors[0], s.combat.actors[1], s.combat.actors[2]];
		expect([bulwark.kind, chain.kind, pyre.kind]).toEqual([K.bulwark, K.chainhook, K.pyre]);
		const ev = new NewEnemy2FrameEvents();
		ev.collect(s); // the first tick of a state only snapshots
		const g = s.combat.guardEvents;
		const h = s.combat.hookEvents;
		const tick = (edit: () => void) => {
			g.blockX.clear();
			g.blockZ.clear();
			g.blockSlot.clear();
			g.breakSlot.clear();
			h.endPlayer.clear();
			h.endSlot.clear();
			h.endReason.clear();
			edit();
			s.tick += 1;
			ev.collect(s);
		};
		ev.reset();
		tick(() => {
			g.blockX.push(1.5);
			g.blockZ.push(4.5);
			g.blockSlot.push(0);
			g.breakSlot.push(0);
			h.endPlayer.push(0);
			h.endSlot.push(1);
			h.endReason.push(HookEnd.ARRIVED); // an arrival: no snap
		});
		tick(() => {
			h.endPlayer.push(0);
			h.endSlot.push(1);
			h.endReason.push(HookEnd.ROLL);
			pyre.alive = 0;
		});
		tick(() => undefined); // the corpse stays dead: no second puff
		const p = playerAt(s, 0);
		expect([ev.blockX, ev.blockZ]).toEqual([[1.5], [4.5]]);
		expect([ev.breakX, ev.breakZ]).toEqual([[bulwark.x], [bulwark.z]]);
		expect([ev.snapX, ev.snapZ]).toEqual([[(chain.x + p.x) / 2], [(chain.z + p.z) / 2]]);
		expect([ev.puffX, ev.puffZ]).toEqual([[pyre.x], [pyre.z]]);
		expect(ev.count()).toBe(4);
		ev.reset();
		expect(ev.count()).toBe(0);
	});

	it("lists the bursts in a fixed order with one look per kind", () => {
		const ev = new NewEnemy2FrameEvents();
		(ev.blockX as number[]).push(1);
		(ev.blockZ as number[]).push(2);
		(ev.puffX as number[]).push(5);
		(ev.puffZ as number[]).push(6);
		const pellets = {
			stolen: [{ x: 3, z: 4 }],
			swallowed: [{ cellX: [7, 8], cellZ: [9, 10] }],
		};
		const out: NewEnemy2BurstAt[] = [];
		const n = newEnemy2Bursts(ev, pellets, out);
		const got: Array<[number, number, number]> = [];
		for (let i = 0; i < n; i++) got.push([out[i].kind, out[i].x, out[i].z]);
		expect(got).toEqual([
			[NewEnemy2Burst.BLOCK, 1, 2],
			[NewEnemy2Burst.GULP, 3, 4],
			[NewEnemy2Burst.FIZZLE, 7, 9],
			[NewEnemy2Burst.FIZZLE, 8, 10],
			[NewEnemy2Burst.PUFF, 5, 6],
		]);
		expect(NEW_ENEMY_2_BURST_LOOKS.size()).toBe(6);
		expect(newEnemy2Bursts(new NewEnemy2FrameEvents(), { stolen: [], swallowed: [] }, out)).toBe(0);
		expect(K.pyre !== NO_KIND).toBe(true);
	});
});
