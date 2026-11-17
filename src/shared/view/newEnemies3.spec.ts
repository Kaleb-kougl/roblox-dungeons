// The fourth endless set on screen (docs/NEW_ENEMIES_3.md NT7): a Mortar's shell is told from lightning by its payload
// source in every strike reader (isShellPayload / isLightningPayload / enemyBulletPool: never the lightning's pool, art
// or scorch; real shells and real lightning), the shrapnel draws the small look and the Mender's bolt the medium one,
// the shell's arc (ShellArcs: from where it left, to the ring, a new origin per lob), a dead Mortar's ring and arc while
// its shell flies (NTD5), the heal tether only while a link or channel is live and only to a living ally (tetherShare /
// tetherPulse / tetherSegments), the `+` marks, the Jackal's stagger stars, the sprite inputs (crouch / lunge / hop /
// stagger with their fallbacks, the Mender's channel loop, the Mortar's draw and release), the frame feed
// (NewEnemy3FrameEvents: impacts at the shells, heals at the ally, snaps on cuts only, a corpse's impact), and that a
// Jackal's guard stop is exactly one parry group for the near-miss director (NTD9).
import { describe, expect, it } from "@rbxts/jest-globals";
import { defaultJuiceSettings } from "shared/settings";
import {
	ACTOR_SCRATCH_SLOTS,
	AiState,
	BRUISER,
	BulletKind,
	BulletPayload,
	DAMAGE_CAP_BUCKETS,
	EMPTY_INPUT,
	JACKAL,
	JACKAL_ATTACK_LUNGE,
	JACKAL_HOP,
	JACKAL_LUNGE,
	JACKAL_PHASE,
	JACKAL_RECOVER,
	JACKAL_STAGGER,
	MENDER,
	MENDER_ALLY,
	MENDER_ATTACK_BOLT,
	MENDER_ATTACK_HEAL,
	MENDER_CHANNEL,
	MENDER_CHANNEL_TICKS,
	MENDER_FLINCH,
	MENDER_KEEP,
	MENDER_PULSE,
	MORTAR,
	MORTAR_ATTACK_LOB,
	MORTAR_FLIGHT,
	MORTAR_FLIGHT_TICKS,
	MORTAR_KEEP,
	MORTAR_LAND_X,
	MORTAR_LAND_Z,
	STORMCALLER,
	SWORD_V_GUARD,
	SimCtx,
	activeWeaponSlot,
	archetypeIndex,
	createSimState,
	engage,
	healEndCuts,
	playerAt,
	spawnActor,
	step,
	weaponsAt,
	type ActorSpawn,
	type ActorState,
	type SimConfig,
	type SimState,
} from "shared/sim";
import type { SpriteAnimationDef } from "shared/theme";
import { EnemyBulletLook, enemyBulletLookOf } from "./bullets";
import { NearMissDirector, NearMissEvents, NewEnemy3FrameEvents } from "./fx";
import { HEAL_PLUS_VIEW, HEAL_TETHER_VIEW, NEW_ENEMY_3_SPRITE_VIEW, SHELL_ARC_VIEW } from "./newEnemies3Config";
import {
	HealPlusMarks,
	NewEnemy3Burst,
	ShellArcs,
	isLightningPayload,
	isShellPayload,
	jackalStaggered,
	menderTetherAlly,
	mortarCorpseFlying,
	mortarFlying,
	newEnemy3Bursts,
	newEnemy3Kinds,
	newShellPoint,
	tetherPulse,
	tetherSegments,
	tetherShare,
	type NewEnemy3BurstAt,
} from "./newEnemies3";
import { jackalSpriteInput, menderSpriteInput, mortarSpriteInput } from "./newEnemy3Sprites";
import { ACTOR_SPRITE_INPUTS, chooseActorAnim, type SpriteAnimSource } from "./sprites";
import { enemyBulletPool } from "./variants";

const K = newEnemy3Kinds();
const near = (a: number, b: number, eps = 1e-6) => math.abs(a - b) < eps;

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

class Segs {
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

/** A set with NT8's optional animations, and one without them. */
const FULL = source({
	idle: anim(4, 6, true),
	move: anim(4, 8, true),
	attack: anim(6, 10, false),
	"attack.2": anim(5, 10, false),
	hit: anim(3, 10, false),
	death: anim(4, 8, false),
	crouch: anim(3, 10, false),
	hop: anim(4, 12, false),
});
const PLAIN = source({
	idle: anim(4, 6, true),
	move: anim(4, 8, true),
	attack: anim(6, 10, false),
	hit: anim(3, 10, false),
	death: anim(4, 8, false),
});

const openConfig = (spawns: ActorSpawn[], extra: Partial<SimConfig> = {}): SimConfig => ({
	encounter: { spawns, rooms: [], entranceRoom: -1, bossRoom: -1 },
	...extra,
});

function ghost(s: SimState): void {
	playerAt(s, 0).hurtTicks = 1e6;
}

function firstOf(s: SimState, kind: number): ActorState {
	for (const a of s.combat.actors) if (a.kind === kind) return a;
	return error("missing kind", 0);
}

/** Every live enemy bullet's payload and position this tick. */
function liveBullets(s: SimState): Array<{ payload: number; x: number; z: number }> {
	const out: Array<{ payload: number; x: number; z: number }> = [];
	const b = s.combat.enemyBullets;
	for (let i = 0; i < b.highWater(); i++) {
		if (!b.isLive(i)) continue;
		const p = b.positionAt(i);
		out.push({ payload: b.payloadAt(i), x: p.x, z: p.z });
	}
	return out;
}

describe("strikes: shells vs lightning (every strike reader)", () => {
	it("a real Mortar's shells are shells, never lightning; its shrapnel draws small; the pools split", () => {
		const config = openConfig([{ kind: MORTAR.id, x: 0, z: 7 }]);
		const s = createSimState(5, 0, 0, config);
		ghost(s);
		let shells = 0;
		let shrapnel = 0;
		for (let t = 0; t < 900; t++) {
			step(s, EMPTY_INPUT, config);
			for (const b of liveBullets(s)) {
				const kind = BulletPayload.get(b.payload, "kind");
				if (kind === BulletKind.STRIKE) {
					expect([isShellPayload(b.payload), isLightningPayload(b.payload)]).toEqual([true, false]);
					expect(enemyBulletPool(b.payload)).toBe("shell");
					shells++;
				} else {
					expect(kind).toBe(BulletKind.ENEMY);
					expect(enemyBulletLookOf(b.payload)).toBe(EnemyBulletLook.SMALL);
					expect(enemyBulletPool(b.payload)).toBe("enemy");
					shrapnel++;
				}
			}
		}
		expect(shells).toBeGreaterThan(0);
		expect(shrapnel).toBeGreaterThan(0);
	});

	it("a real Stormcaller's strikes are lightning, never shells", () => {
		const config = openConfig([{ kind: STORMCALLER.id, x: 0, z: 6 }]);
		const s = createSimState(6, 0, 0, config);
		ghost(s);
		let strikes = 0;
		for (let t = 0; t < 900; t++) {
			step(s, EMPTY_INPUT, config);
			for (const b of liveBullets(s)) {
				if (BulletPayload.get(b.payload, "kind") !== BulletKind.STRIKE) continue;
				expect([isShellPayload(b.payload), isLightningPayload(b.payload)]).toEqual([false, true]);
				expect(enemyBulletPool(b.payload)).toBe("strike");
				strikes++;
			}
		}
		expect(strikes).toBeGreaterThan(0);
	});

	it("the payload test: a STRIKE with the Mortar's source is a shell; another kind with it is neither", () => {
		const source = K.mortar + 1;
		const shell = BulletPayload.pack({ kind: BulletKind.STRIKE, source });
		const bolt = BulletPayload.pack({ kind: BulletKind.ENEMY, source });
		const lightning = BulletPayload.pack({ kind: BulletKind.STRIKE, source: archetypeIndex(STORMCALLER.id) + 1 });
		expect([isShellPayload(shell), isLightningPayload(shell)]).toEqual([true, false]);
		expect([isShellPayload(bolt), isLightningPayload(bolt)]).toEqual([false, false]);
		expect([isShellPayload(lightning), isLightningPayload(lightning)]).toEqual([false, true]);
		// with the strike decal off, a shell is an ordinary enemy bullet like lightning
		expect(enemyBulletPool(shell, true, false)).toBe("enemy");
	});

	it("the Mender's bolt (BulletKind.CASTER) draws the medium look", () => {
		const config = openConfig([{ kind: MENDER.id, x: 0, z: 6 }]);
		const s = createSimState(7, 0, 0, config);
		ghost(s);
		let bolts = 0;
		for (let t = 0; t < 600; t++) {
			step(s, EMPTY_INPUT, config);
			for (const b of liveBullets(s)) {
				expect(BulletPayload.get(b.payload, "kind")).toBe(BulletKind.CASTER);
				expect(enemyBulletLookOf(b.payload)).toBe(EnemyBulletLook.MEDIUM);
				bolts++;
			}
		}
		expect(bolts).toBeGreaterThan(0);
	});
});

describe("the Mortar's shell arc and its corpse", () => {
	it("starts at the hand where it left, ends on the floor at the ring, and keeps its origin while the Mortar walks", () => {
		const arcs = new ShellArcs();
		const out = newShellPoint();
		const total = MORTAR.data.flightTicks;
		const a = withV(
			withV(withV(actor({ kind: K.mortar, aiState: MORTAR_FLIGHT, attack: MORTAR_ATTACK_LOB }), MORTAR_FLIGHT_TICKS, total), MORTAR_LAND_X, 6),
			MORTAR_LAND_Z,
			2,
		);
		arcs.point(0, a, 1, 1, 0, out);
		expect([out.shown, out.x, out.z]).toEqual([true, 1, 1]);
		expect(near(out.heightTiles, SHELL_ARC_VIEW.handTiles)).toBe(true);
		// half way, the Mortar has walked on: the shell is half way from the hand it left, at the arc's top
		a.v[MORTAR_FLIGHT_TICKS] = total / 2;
		arcs.point(0, a, 4, -3, 0, out);
		expect([near(out.x, 3.5), near(out.z, 1.5)]).toEqual([true, true]);
		expect(near(out.heightTiles, SHELL_ARC_VIEW.handTiles / 2 + SHELL_ARC_VIEW.arcTiles)).toBe(true);
		a.v[MORTAR_FLIGHT_TICKS] = 1;
		arcs.point(0, a, 4, -3, 1, out);
		expect([near(out.x, 6), near(out.z, 2), near(out.heightTiles, 0)]).toEqual([true, true, true]);
		// landed: none; a new lob starts from where the Mortar is then
		a.aiState = MORTAR_KEEP;
		a.v[MORTAR_FLIGHT_TICKS] = 0;
		expect(arcs.point(0, a, 4, -3, 0, out).shown).toBe(false);
		a.aiState = MORTAR_FLIGHT;
		a.v[MORTAR_FLIGHT_TICKS] = total;
		arcs.point(0, a, 4, -3, 0, out);
		expect([out.x, out.z]).toEqual([4, -3]);
		// a corpse's flight is drawn (NTD5); any other actor in the state never
		a.alive = 0;
		expect([mortarFlying(a), mortarCorpseFlying(a), arcs.point(0, a, 4, -3, 0, out).shown]).toEqual([true, true, true]);
		const other = withV(actor({ kind: K.jackal, aiState: MORTAR_FLIGHT }), MORTAR_FLIGHT_TICKS, 30);
		expect([mortarFlying(other), arcs.point(1, other, 0, 0, 0, out).shown]).toEqual([false, false]);
		// a living one in flight is no corpse
		a.alive = 1;
		expect(mortarCorpseFlying(a)).toBe(false);
	});

	it("a Mortar killed mid-flight: its corpse flies until the shell lands, and the impact is fed at the ring", () => {
		const config = openConfig([{ kind: MORTAR.id, x: 0, z: 7 }]);
		const s = createSimState(5, 0, 0, config);
		ghost(s);
		const m = firstOf(s, K.mortar);
		const ev = new NewEnemy3FrameEvents();
		ev.collect(s);
		let killed = false;
		let corpseTicks = 0;
		const impacts: Array<[number, number]> = [];
		let landX = 0;
		let landZ = 0;
		for (let t = 0; t < 900 && impacts.size() === 0; t++) {
			ev.reset();
			step(s, EMPTY_INPUT, config);
			ev.collect(s);
			if (!killed && m.aiState === MORTAR_FLIGHT && m.v[MORTAR_FLIGHT_TICKS] === MORTAR.data.flightTicks - 10) {
				landX = m.v[MORTAR_LAND_X];
				landZ = m.v[MORTAR_LAND_Z];
				new SimCtx().bind(s, config, EMPTY_INPUT).killActor(m);
				killed = true;
			}
			if (killed && mortarCorpseFlying(m)) corpseTicks++;
			for (let i = 0; i < ev.impactX.size(); i++) impacts.push([ev.impactX[i], ev.impactZ[i]]);
		}
		expect(killed).toBe(true);
		expect(corpseTicks).toBe(MORTAR.data.flightTicks - 10);
		expect(impacts).toEqual([[landX, landZ]]);
	});

	it("impacts: one per shell, at the shell's spot, never on a tick without one", () => {
		const config = openConfig([{ kind: MORTAR.id, x: 0, z: 7 }]);
		const s = createSimState(9, 0, 0, config);
		ghost(s);
		const ev = new NewEnemy3FrameEvents();
		ev.collect(s);
		let shells = 0;
		let impacts = 0;
		for (let t = 0; t < 1200; t++) {
			ev.reset();
			step(s, EMPTY_INPUT, config);
			ev.collect(s);
			shells += s.events.shells;
			impacts += ev.impactX.size();
			expect(ev.impactX.size()).toBe(s.events.shells);
			for (let i = 0; i < ev.impactX.size(); i++) {
				const at = liveBullets(s).filter(
					(b) => isShellPayload(b.payload) && near(b.x, ev.impactX[i]) && near(b.z, ev.impactZ[i]),
				);
				expect(at.size()).toBe(1);
			}
		}
		expect(shells).toBeGreaterThanOrEqual(2);
		expect(impacts).toBe(shells);
	});
});

describe("the Mender's heal tether", () => {
	/** A Mender and a wounded bruiser beside it, both engaged, the player a ghost at the origin. */
	function healWorld(): { s: SimState; config: SimConfig; m: ActorState; ally: ActorState } {
		const config = openConfig([], { bounds: { minX: -24, maxX: 24, minZ: -24, maxZ: 24 } });
		const s = createSimState(11, 0, 0, config);
		ghost(s);
		const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
		const m = spawnActor(ctx, K.mender, 0, 6)!;
		const ally = spawnActor(ctx, archetypeIndex(BRUISER.id), 3, 7)!;
		for (const a of [m, ally]) {
			a.spawnTick = -1;
			engage(a);
		}
		m.cooldown = 0;
		ally.hp = 1;
		return { s, config, m, ally };
	}

	it("only while a link or channel is live and only to a living ally (real ticks): forms over the link, pulses after heals", () => {
		const { s, config, m, ally } = healWorld();
		let linked = 0;
		let pulses = 0;
		let lastShare = -1;
		for (let t = 0; t < 400; t++) {
			ally.spawnTick = s.tick; // held still: only the Mender acts
			step(s, EMPTY_INPUT, config);
			const shown = menderTetherAlly(s.combat.actors, m);
			const live =
				m.alive !== 0 &&
				(m.aiState === MENDER_CHANNEL || (m.aiState === AiState.TELEGRAPH && m.attack === MENDER_ATTACK_HEAL));
			expect(shown !== undefined).toBe(live && ally.alive !== 0 && m.v[MENDER_ALLY] === ally.id);
			if (shown !== undefined) {
				expect(shown).toBe(ally);
				linked++;
				const share = tetherShare(m, 0);
				if (m.aiState === MENDER_CHANNEL) expect(share).toBe(1);
				else expect(share >= lastShare || lastShare === 1).toBe(true);
				lastShare = share;
			}
			if (s.combat.healEvents.healSlot.size() > 0) {
				pulses++;
				if (m.aiState === MENDER_CHANNEL) expect(tetherPulse(m, 0)).toBe(1);
			}
		}
		expect(linked).toBeGreaterThan(MENDER.data.linkTicks);
		expect(pulses).toBeGreaterThan(0);
	});

	it("never to a dead ally, from a dead Mender, or outside the link / channel (state by hand)", () => {
		const { s, m, ally } = healWorld();
		const actors = s.combat.actors;
		m.v[MENDER_ALLY] = ally.id;
		m.aiState = MENDER_CHANNEL;
		expect(menderTetherAlly(actors, m)).toBe(ally);
		m.aiState = AiState.TELEGRAPH;
		m.attack = MENDER_ATTACK_HEAL;
		m.aiTicks = MENDER.data.linkTicks;
		expect([menderTetherAlly(actors, m), tetherShare(m, 0)]).toEqual([ally, 0]);
		m.aiTicks = MENDER.data.linkTicks / 2;
		expect(tetherShare(m, 0)).toBe(0.5);
		for (const st of [MENDER_KEEP, MENDER_FLINCH]) {
			m.aiState = st;
			expect(menderTetherAlly(actors, m)).toBeUndefined();
		}
		m.aiState = AiState.TELEGRAPH;
		m.attack = MENDER_ATTACK_BOLT;
		expect(menderTetherAlly(actors, m)).toBeUndefined();
		m.aiState = MENDER_CHANNEL;
		ally.alive = 0;
		expect(menderTetherAlly(actors, m)).toBeUndefined();
		ally.alive = 1;
		m.alive = 0;
		expect(menderTetherAlly(actors, m)).toBeUndefined();
		m.alive = 1;
		m.v[MENDER_ALLY] = 0;
		expect(menderTetherAlly(actors, m)).toBeUndefined();
		// any other kind with the same numbers
		const j = withV(actor({ kind: K.jackal, aiState: MENDER_CHANNEL }), MENDER_ALLY, ally.id);
		expect(menderTetherAlly(actors, j)).toBeUndefined();
	});

	it("the pulse: none before the first heal, full on the heal's tick, gone after pulseSec", () => {
		const P = MENDER.data.pulseTicks;
		const m = actor({ kind: K.mender, aiState: MENDER_CHANNEL });
		m.v[MENDER_CHANNEL_TICKS] = 5;
		m.v[MENDER_PULSE] = P - 5;
		expect(tetherPulse(m, 0)).toBe(0);
		m.v[MENDER_CHANNEL_TICKS] = P;
		m.v[MENDER_PULSE] = P;
		expect(tetherPulse(m, 0)).toBe(1);
		m.v[MENDER_PULSE] = P - math.ceil(HEAL_TETHER_VIEW.pulseSec * 60);
		expect(tetherPulse(m, 0)).toBe(0);
		m.aiState = MENDER_KEEP;
		m.v[MENDER_PULSE] = P;
		expect(tetherPulse(m, 0)).toBe(0);
	});

	it("tetherSegments: from the hands to the ally's rim, the share's part of it, nothing when they overlap", () => {
		const segs = new Segs();
		tetherSegments(segs, 0, 0, 0.35, 5, 0, 0.5, 1);
		const hand = 0.35 + HEAL_TETHER_VIEW.handTiles;
		const rim = 5 - 0.5 - HEAL_TETHER_VIEW.allyGapTiles;
		expect(segs.ends).toEqual([[hand, 0, rim, 0]]);
		tetherSegments(segs, 0, 0, 0.35, 5, 0, 0.5, 0.5);
		expect(near(segs.ends[1][2], hand + (rim - hand) / 2)).toBe(true);
		tetherSegments(segs, 0, 0, 0.35, 0.5, 0, 0.5, 1);
		tetherSegments(segs, 0, 0, 0.35, 5, 0, 0.5, 0);
		expect(segs.ends.size()).toBe(2);
	});

	it("the feed: a heal at the ally per pulse; a body on the beam snaps it at the beam's middle; other ends no snap", () => {
		const { s, config, m, ally } = healWorld();
		const ev = new NewEnemy3FrameEvents();
		ev.collect(s);
		let heals = 0;
		let snaps = 0;
		let cut = false;
		for (let t = 0; t < 600 && !cut; t++) {
			ally.spawnTick = s.tick;
			const blocking = m.aiState === MENDER_CHANNEL && m.v[MENDER_CHANNEL_TICKS] > MENDER.data.pulseTicks;
			const mid: [number, number] = [(m.x + ally.x) / 2, (m.z + ally.z) / 2];
			if (blocking) {
				// the ghost steps onto the beam: the Mender's next tick cuts it (HealEnd.BLOCKED)
				const p = playerAt(s, 0);
				p.x = mid[0];
				p.z = mid[1];
				p.prevX = mid[0];
				p.prevZ = mid[1];
			}
			ev.reset();
			step(s, EMPTY_INPUT, config);
			ev.collect(s);
			heals += ev.healX.size();
			for (let i = 0; i < ev.healX.size(); i++) expect([ev.healX[i], ev.healZ[i]]).toEqual([ally.x, ally.z]);
			let cuts = 0;
			for (const r of s.combat.healEvents.endReason) if (healEndCuts(r)) cuts++;
			expect([ev.snapX.size(), s.events.healCuts]).toEqual([cuts, cuts]);
			snaps += ev.snapX.size();
			if (blocking) {
				expect(cuts).toBe(1);
				expect([near(ev.snapX[0], mid[0]), near(ev.snapZ[0], mid[1])]).toEqual([true, true]);
				expect(menderTetherAlly(s.combat.actors, m)).toBeUndefined();
				cut = true;
			}
		}
		expect([cut, snaps]).toEqual([true, 1]);
		expect(heals).toBeGreaterThan(0);
	});
});

describe("HealPlusMarks", () => {
	it("each `+` shows for plusSec (sim seconds) as a growing cross screen-up of the spot; the oldest is reused", () => {
		const marks = new HealPlusMarks();
		marks.push(1, 2, 10);
		expect(marks.live(10)).toBe(1);
		const segs = new Segs();
		marks.segments(segs, 10, 0, 1);
		const half = HEAL_PLUS_VIEW.fromTiles / 2;
		const cz = 2 + HEAL_PLUS_VIEW.offsetTiles;
		expect(segs.ends).toEqual([
			[1 - half, cz, 1 + half, cz],
			[1, cz - half, 1, cz + half],
		]);
		expect(marks.live(10 + HEAL_PLUS_VIEW.plusSec)).toBe(0);
		for (let i = 0; i < HEAL_PLUS_VIEW.max + 3; i++) marks.push(i, 0, 20);
		expect(marks.live(20)).toBe(HEAL_PLUS_VIEW.max);
		marks.reset();
		expect(marks.live(20)).toBe(0);
	});
});

describe("bursts", () => {
	it("impacts, heals and snaps in that order, each its own kind", () => {
		const out: NewEnemy3BurstAt[] = [];
		const n = newEnemy3Bursts(
			{ impactX: [1], impactZ: [2], healX: [3, 4], healZ: [5, 6], snapX: [7], snapZ: [8] },
			out,
		);
		expect(n).toBe(4);
		const got: Array<[number, number, number]> = [];
		for (let i = 0; i < n; i++) got.push([out[i].kind, out[i].x, out[i].z]);
		expect(got).toEqual([
			[NewEnemy3Burst.IMPACT, 1, 2],
			[NewEnemy3Burst.HEAL, 3, 5],
			[NewEnemy3Burst.HEAL, 4, 6],
			[NewEnemy3Burst.SNAP, 7, 8],
		]);
	});
});

describe("sprite inputs", () => {
	it("are registered for the three (through withNewEnemy2SpriteInputs)", () => {
		expect(ACTOR_SPRITE_INPUTS.get(MORTAR.id)).toBe(mortarSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(MENDER.id)).toBe(menderSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(JACKAL.id)).toBe(jackalSpriteInput);
	});

	it("the Jackal: crouch over the wind-up (absent: attack), attack over the lunge, hop (absent: its move), hit over the stagger", () => {
		const d = JACKAL.data;
		const windup = actor({ kind: K.jackal, aiState: AiState.TELEGRAPH, attack: JACKAL_ATTACK_LUNGE, aiTicks: d.windupTicks });
		expect(chooseActorAnim(jackalSpriteInput(windup, 0), FULL).anim).toBe("crouch");
		expect(chooseActorAnim(jackalSpriteInput(windup, 0), PLAIN).anim).toBe("attack");
		const lunge = actor({ kind: K.jackal, aiState: JACKAL_LUNGE, aiTicks: d.lungeTicks / 2 });
		const lungeAnim = chooseActorAnim(jackalSpriteInput(lunge, 0), FULL);
		expect([lungeAnim.anim, near(lungeAnim.progress ?? -1, 0.5)]).toEqual(["attack", true]);
		const hop = withV(actor({ kind: K.jackal, aiState: JACKAL_HOP }), JACKAL_PHASE, d.hopTicks);
		expect(chooseActorAnim(jackalSpriteInput(hop, 0), FULL).anim).toBe("hop");
		// without `hop` the hop is skipped: never the attack (it moves back: the move loop)
		hop.prevX = -d.hopDistance / d.hopTicks;
		expect(chooseActorAnim(jackalSpriteInput(hop, 0), PLAIN).anim).toBe("move");
		const reel = withV(actor({ kind: K.jackal, aiState: JACKAL_STAGGER }), JACKAL_PHASE, d.staggerTicks / 2);
		const staggered = chooseActorAnim(jackalSpriteInput(reel, 0), FULL);
		expect([staggered.anim, near(staggered.progress ?? -1, 0.5)]).toEqual([NEW_ENEMY_3_SPRITE_VIEW.anims.stagger, true]);
		expect(jackalStaggered(reel)).toBe(true);
		const recover = withV(actor({ kind: K.jackal, aiState: JACKAL_RECOVER }), JACKAL_PHASE, 10);
		expect([jackalSpriteInput(recover, 0).attack, jackalStaggered(recover)]).toEqual([undefined, false]);
		// a corpse plays its death, never the stagger or the hop
		reel.alive = 0;
		expect([chooseActorAnim(jackalSpriteInput(reel, 0), FULL).anim, jackalStaggered(reel)]).toEqual(["death", false]);
	});

	it("the Mender: link stretched, channel looped, bolt as attack.2 (absent: attack), flinch as hit", () => {
		const d = MENDER.data;
		const link = actor({ kind: K.mender, aiState: AiState.TELEGRAPH, attack: MENDER_ATTACK_HEAL, aiTicks: d.linkTicks });
		expect(menderSpriteInput(link, 0).attack).toEqual({ elapsed: 0, total: d.linkTicks });
		const channel = withV(actor({ kind: K.mender, aiState: MENDER_CHANNEL }), MENDER_CHANNEL_TICKS, 40);
		expect(menderSpriteInput(channel, 0).attack).toEqual({ elapsed: 40, total: d.channelTicks, loop: true });
		const bolt = actor({ kind: K.mender, aiState: AiState.TELEGRAPH, attack: MENDER_ATTACK_BOLT, aiTicks: 1 });
		expect(chooseActorAnim(menderSpriteInput(bolt, 0), FULL).anim).toBe("attack.2");
		expect(chooseActorAnim(menderSpriteInput(bolt, 0), PLAIN).anim).toBe("attack");
		const flinch = actor({ kind: K.mender, aiState: MENDER_FLINCH, aiTicks: d.flinchTicks });
		expect(chooseActorAnim(menderSpriteInput(flinch, 0), FULL).anim).toBe("hit");
		expect(menderSpriteInput(actor({ kind: K.mender, aiState: MENDER_KEEP }), 0).attack).toBeUndefined();
	});

	it("the Mortar: the draw then the release as one attack; the rest of the flight none", () => {
		const d = MORTAR.data;
		const R = NEW_ENEMY_3_SPRITE_VIEW.mortarReleaseTicks;
		const draw = actor({ kind: K.mortar, aiState: AiState.TELEGRAPH, attack: MORTAR_ATTACK_LOB, aiTicks: d.drawTicks });
		expect(mortarSpriteInput(draw, 0).attack).toEqual({ elapsed: 0, total: d.drawTicks + R });
		const released = withV(
			actor({ kind: K.mortar, aiState: MORTAR_FLIGHT, attack: MORTAR_ATTACK_LOB }),
			MORTAR_FLIGHT_TICKS,
			d.flightTicks - 2,
		);
		expect(mortarSpriteInput(released, 0).attack).toEqual({ elapsed: d.drawTicks + 2, total: d.drawTicks + R });
		released.v[MORTAR_FLIGHT_TICKS] = d.flightTicks - R;
		expect(mortarSpriteInput(released, 0).attack).toBeUndefined();
	});
});

describe("the Jackal's guard stop and the near-miss director (NTD9)", () => {
	it("each stop is exactly one parry group (one erase), on its own frame; nothing else is a parry", () => {
		const config: SimConfig = { bounds: { minX: -24, maxX: 24, minZ: -24, maxZ: 24 }, scoring: {} };
		const s = createSimState(11, 0, 0, config);
		const p = playerAt(s, 0);
		const j = spawnActor(new SimCtx().bind(s, config, EMPTY_INPUT), K.jackal, 0, -3.3)!;
		j.spawnTick = -1;
		engage(j);
		j.cooldown = 0;
		const events = new NearMissEvents();
		const director = new NearMissDirector();
		const settings = defaultJuiceSettings();
		let stops = 0;
		let groups = 0;
		let erases = 0;
		for (let t = 0; t < 900; t++) {
			p.hearts = p.heartsMax;
			p.armor = 0;
			// turned across it (90 degrees off), the guard held up: the jackal.spec stop scenario
			const dx = j.x - p.x;
			const dz = j.z - p.z;
			const len = math.sqrt(dx * dx + dz * dz);
			if (len > 1e-9) {
				p.faceX = -dz / len;
				p.faceZ = dx / len;
			}
			activeWeaponSlot(weaponsAt(s, 0)).v[SWORD_V_GUARD] = 3;
			const was = j.aiState;
			events.reset();
			step(s, EMPTY_INPUT, config);
			events.collect(s);
			const stopped = j.aiState === JACKAL_STAGGER && was !== JACKAL_STAGGER;
			if (stopped) stops++;
			const out = director.frame(events, s, 0, false, settings, t / 60);
			expect(out.parryGroups.size()).toBe(stopped ? 1 : 0);
			expect(events.erases.size()).toBe(stopped ? 1 : 0);
			groups += out.parryGroups.size();
			erases += events.erases.size();
		}
		expect(stops).toBeGreaterThanOrEqual(2);
		expect([groups, erases]).toEqual([stops, stops]);
	});
});
