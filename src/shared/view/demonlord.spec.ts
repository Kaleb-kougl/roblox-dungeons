// The Demon Lord's view (docs/BOSS_DEMONLORD.md D6) against the real sim, on forced attacks in the M1 dungeons of
// seeds 1337 / 42 / 7 (the harness of shared/sim demonlord.spec.ts, copied: specs cannot import each other):
//   - every telegraph preview shows exactly where the bullets go: the drawn lane / gap-edge headings equal the bullet
//     headings the attack fires, the cleave lanes end at the bullets' reach, the double cleave's second arc starts
//     where the lunge stops, the charge's shockwave sits on the impact point, the summon spots on the adds; the
//     preview is the same on the telegraph's first and last tick (every direction locked when it starts)
//   - the sprite animation over the same fights: each state's animation, one-shots stretched over the sim's own
//     timers (progress 0 at the wind-up's start, exactly 1 at the attack's last tick + alpha 1, never backwards)
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	KALEB_VALE_MVP_PARAMS,
	actorMover,
	bossDoorSpawn,
	bulletBlocker,
	circleMover,
	generateDungeon,
	placeEncounter,
} from "shared/dungeon";
import { hypot2, stableSort } from "shared/jsmath";
import {
	AiState,
	BOSS_DEMONLORD_ID,
	CHARGE_SHOCKWAVE,
	CLEAVE,
	DEMONLORD_DATA,
	DEMONLORD_SUMMON,
	DEMONLORD_TELEGRAPH_TICKS,
	DEMONLORD_V_AUX_X,
	DEMONLORD_V_AUX_Z,
	DEMONLORD_V_DIR_X,
	DEMONLORD_V_DIR_Z,
	DEMONLORD_V_MARK,
	DEMONLORD_V_SIGN,
	DOUBLE_CLEAVE_DELAY_TICKS,
	DOUBLE_CLEAVE_STEP,
	DemonlordAttack,
	DemonlordState,
	EMPTY_INPUT,
	HELLFIRE_ARC,
	NO_KIND,
	PLAYER_RADIUS,
	SIM_DT,
	SimCtx,
	createSimState,
	step,
	type ActorState,
	type SimConfig,
	type SimState,
} from "shared/sim";
import {
	SPRITE_VIEW,
	TELEGRAPH_VIEW,
	burstReach,
	chooseActorAnim,
	demonlordActiveMarkings,
	demonlordSpriteInput,
	demonlordTelegraphMarkings,
	enemyBulletSpeedScale,
	summonSpots,
	type DemonlordConsts,
	type SegmentSink,
	type SpriteAnimSource,
} from "shared/view";
import type { SpriteAnimationDef } from "shared/theme";

const A = DemonlordAttack;
const ANGLE_EPS = 1e-6;
const POS_EPS = 1e-6;

/** The constants client/controllers/render/demonlord.ts passes (the same names from shared/sim). */
const C: DemonlordConsts = {
	attack: DemonlordAttack,
	state: { ACTIVE: DemonlordState.ACTIVE },
	telegraphTicks: DEMONLORD_TELEGRAPH_TICKS,
	cleave: CLEAVE,
	hellfireArc: HELLFIRE_ARC,
	shockwave: CHARGE_SHOCKWAVE,
	doubleCleaveDelayTicks: DOUBLE_CLEAVE_DELAY_TICKS,
	doubleCleaveStep: DOUBLE_CLEAVE_STEP,
	summon: { count: DEMONLORD_SUMMON.count, radius: DEMONLORD_SUMMON.radius },
	slots: {
		dirX: DEMONLORD_V_DIR_X,
		dirZ: DEMONLORD_V_DIR_Z,
		auxX: DEMONLORD_V_AUX_X,
		auxZ: DEMONLORD_V_AUX_Z,
		sign: DEMONLORD_V_SIGN,
		mark: DEMONLORD_V_MARK,
	},
};

class Collect implements SegmentSink {
	readonly segs = new Array<[number, number, number, number]>();
	seg(x0: number, z0: number, x1: number, z1: number): void {
		this.segs.push([x0, z0, x1, z1]);
	}
}

/** Angle a - b wrapped to (-PI, PI]. */
function angDiff(a: number, b: number): number {
	let d = a - b;
	while (d > math.pi) d -= 2 * math.pi;
	while (d <= -math.pi) d += 2 * math.pi;
	return d;
}

/**
 * Headings (atan2(x, z) around (cx, cz)) of the segments that point straight out of (cx, cz): rays along a heading
 * (lanes, gap-edge ticks), not arc chords or lanes offset from the centre.
 */
function radialHeadings(segs: ReadonlyArray<[number, number, number, number]>, cx: number, cz: number): number[] {
	const out: number[] = [];
	for (const [x0, z0, x1, z1] of segs) {
		const ax = x0 - cx;
		const az = z0 - cz;
		const bx = x1 - cx;
		const bz = z1 - cz;
		const la = hypot2(ax, az);
		const lb = hypot2(bx, bz);
		if (la < POS_EPS || lb < POS_EPS || math.abs(la - lb) < POS_EPS) continue;
		const cross = ax * bz - az * bx;
		if (math.abs(cross) > POS_EPS * la * lb || ax * bx + az * bz <= 0) continue;
		out.push(math.atan2(bx, bz));
	}
	return out;
}

/** Every entry of `got` matches one of `want` (and vice versa), as angles. */
function sameAngles(got: ReadonlyArray<number>, want: ReadonlyArray<number>): boolean {
	if (got.size() !== want.size()) return false;
	for (const g of got) if (!want.some((w) => math.abs(angDiff(g, w)) < ANGLE_EPS)) return false;
	for (const w of want) if (!got.some((g) => math.abs(angDiff(g, w)) < ANGLE_EPS)) return false;
	return true;
}

// ---------------------------------------------------------------------------------------------
// Harness

interface Fight {
	config: SimConfig;
	state: SimState;
	boss: ActorState;
}

function setupFight(seed: number): Fight {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
	const config: SimConfig = {
		moveResolver: circleMover(d, PLAYER_RADIUS),
		isBulletBlocked: bulletBlocker(d),
		actorMover: actorMover(d),
		encounter: placeEncounter(d, { boss: BOSS_DEMONLORD_ID }),
		loadout: ["weapon.test", "weapon.test.melee"],
	};
	const spawn = bossDoorSpawn(d)!;
	const state = createSimState(seed, spawn.x, spawn.z, config);
	return { config, state, boss: state.combat.actors[0] };
}

interface Shot {
	dx: number;
	dz: number;
	heading: number;
}

/** The boss's bullets that appeared this tick (slot not live last tick, or its life went up). Updates `prevLife`. */
function newShots(state: SimState, boss: ActorState, prevLife: Map<number, number>): Shot[] {
	const snap: number[] = [];
	state.combat.enemyBullets.writeStateHash(snap);
	const cur = new Map<number, number>();
	const out: Shot[] = [];
	for (let k = 0; k < snap.size(); k += 10) {
		const idx = snap[k];
		const life = snap[k + 7];
		cur.set(idx, life);
		if (snap[k + 9] !== boss.emitterId) continue;
		const before = prevLife.get(idx);
		if (before === undefined || life > before) {
			const v = hypot2(snap[k + 4], snap[k + 6]);
			const dx = snap[k + 4] / v;
			const dz = snap[k + 6] / v;
			out.push({ dx, dz, heading: math.atan2(dx, dz) });
		}
	}
	prevLife.clear();
	for (const [i, l] of cur) prevLife.set(i, l);
	return out;
}

/** Farthest any of the boss's live bullets is from (cx, cz) this tick. */
function farthestBullet(state: SimState, boss: ActorState, cx: number, cz: number): number {
	const snap: number[] = [];
	state.combat.enemyBullets.writeStateHash(snap);
	let far = 0;
	for (let k = 0; k < snap.size(); k += 10) {
		if (snap[k + 9] !== boss.emitterId) continue;
		far = math.max(far, hypot2(snap[k + 1] - cx, snap[k + 3] - cz));
	}
	return far;
}

/** One tick of a forced fight: the boss after the step, its new bullets and the actors spawned. */
interface Tick {
	state: number;
	attack: number;
	phase: number;
	aiTicks: number;
	x: number;
	z: number;
	v: number[];
	shots: Shot[];
	spawned: number;
	/** Bright + dim telegraph markings drawn from this tick's state (TELEGRAPH) or the active ones (ACTIVE). */
	marks: Collect;
	/** The sprite's animation choice at alpha 0 and alpha 1. */
	anim0: { anim: string; progress?: number };
	anim1: { anim: string; progress?: number };
	/** Farthest live bullet of the boss from the position at this tick. */
	far: number;
}

interface Forced {
	fight: Fight;
	ticks: Tick[];
	/** Index of the first tick of the forced attack (after the intro roar). */
	start: number;
}

const DEMON_SET: SpriteAnimSource = (() => {
	const anim = (frames: number, fps: number, loop: boolean): SpriteAnimationDef => ({
		sheet: 0,
		start: 0,
		frames,
		fps,
		loop,
	});
	const anims: Record<string, SpriteAnimationDef> = {
		idle: anim(8, 8, true),
		move: anim(8, 10, true),
		attack: anim(8, 12, false),
		"attack.2": anim(8, 12, false),
		intro: anim(8, 8, false),
		taunt: anim(8, 10, false),
		death: anim(8, 10, false),
		hit: anim(1, 1, false),
	};
	return {
		animation(name: string) {
			return anims[name];
		},
	};
})();

/** Steps one tick and records it. */
function record(f: Fight, out: Tick[], prevLife: Map<number, number>, centre?: { x: number; z: number }): void {
	const { state, boss, config } = f;
	step(state, EMPTY_INPUT, config);
	state.player.hearts = state.player.heartsMax;
	const marks = new Collect();
	if (boss.aiState === AiState.TELEGRAPH) {
		demonlordTelegraphMarkings(marks, marks, boss, C, state.tick, enemyBulletSpeedScale(state));
	} else if (boss.aiState === DemonlordState.ACTIVE) {
		demonlordActiveMarkings(marks, marks, boss, C, enemyBulletSpeedScale(state));
	}
	const c = centre ?? boss;
	out.push({
		state: boss.aiState,
		attack: boss.attack,
		phase: boss.phase,
		aiTicks: boss.aiTicks,
		x: boss.x,
		z: boss.z,
		v: [...boss.v],
		shots: newShots(state, boss, prevLife),
		spawned: state.events.actorsSpawned,
		marks,
		anim0: chooseActorAnim(demonlordSpriteInput(boss, 0), DEMON_SET),
		anim1: chooseActorAnim(demonlordSpriteInput(boss, 1), DEMON_SET),
		far: farthestBullet(state, boss, c.x, c.z),
	});
}

/**
 * Engages the boss with the player `dist` units away along the boss room's wider axis, forces `attack` as the first
 * one after the intro roar (the skeleton's forced pick), then steps `ticks` ticks with the player standing still,
 * recording the intro too. `before` runs right before the forced attack starts.
 */
function forceAttack(
	seed: number,
	attack: number,
	dist: number,
	ticks: number,
	before?: (ctx: SimCtx, f: Fight) => void,
): Forced {
	const fight = setupFight(seed);
	const { state, boss, config } = fight;
	const room = config.encounter!.rooms[config.encounter!.bossRoom];
	const wide = room.maxX - room.minX >= room.maxZ - room.minZ;
	const half = (wide ? room.maxX - room.minX : room.maxZ - room.minZ) / 2;
	const r = math.min(dist, half - DEMONLORD_DATA.engageInset - 0.1);
	state.player.x = boss.x + (wide ? r : 0);
	state.player.z = boss.z + (wide ? 0 : r);
	const out: Tick[] = [];
	const prevLife = new Map<number, number>();
	record(fight, out, prevLife);
	expect(boss.aiState).toBe(DemonlordState.TRANSITION);
	boss.cooldown = attack;
	while (boss.aiState === DemonlordState.TRANSITION && boss.aiTicks > 1) record(fight, out, prevLife);
	if (before !== undefined) before(new SimCtx().bind(state, config, EMPTY_INPUT), fight);
	const start = out.size();
	for (let i = 0; i < ticks; i++) record(fight, out, prevLife);
	return { fight, ticks: out, start };
}

/** Indices of the forced attack's TELEGRAPH ticks (first, last) and the first tick with new bullets after `from`. */
function telegraphSpan(f: Forced): [number, number] {
	let first = -1;
	let last = -1;
	for (let i = f.start; i < f.ticks.size(); i++) {
		if (f.ticks[i].state === AiState.TELEGRAPH) {
			if (first < 0) first = i;
			last = i;
		} else if (first >= 0) break;
	}
	return [first, last];
}

function firstVolley(f: Forced, from: number): number {
	for (let i = from; i < f.ticks.size(); i++) if (f.ticks[i].shots.size() > 0) return i;
	return -1;
}

/** The bullet gaps wider than `min`: their edge headings (both edges of each). */
function gapEdges(shots: ReadonlyArray<Shot>, min: number): number[] {
	const angles = stableSort(
		shots.map((s) => s.heading),
		(p, q) => p - q,
	);
	const edges: number[] = [];
	for (let i = 0; i < angles.size(); i++) {
		const nxt = i + 1 < angles.size() ? angles[i + 1] : angles[0] + 2 * math.pi;
		if (nxt - angles[i] > min) edges.push(angles[i], nxt);
	}
	return edges;
}

/** True when heading h lies strictly inside one of the bullet gaps wider than `min` (beyond ANGLE_EPS). */
function inGap(shots: ReadonlyArray<Shot>, min: number, h: number): boolean {
	const e = gapEdges(shots, min);
	for (let i = 0; i < e.size(); i += 2) {
		const width = e[i + 1] - e[i];
		const into = angDiff(h, e[i]);
		const off = into < 0 ? into + 2 * math.pi : into;
		if (off > ANGLE_EPS && off < width - ANGLE_EPS) return true;
	}
	return false;
}

/** Every segment end point's heading around (cx, cz). */
function pointHeadings(segs: ReadonlyArray<[number, number, number, number]>, cx: number, cz: number): number[] {
	const out: number[] = [];
	for (const [x0, z0, x1, z1] of segs) out.push(math.atan2(x0 - cx, z0 - cz), math.atan2(x1 - cx, z1 - cz));
	return out;
}

// ---------------------------------------------------------------------------------------------
// Telegraph previews == the bullets fired

describe("Demon Lord previews show exactly where the bullets go", () => {
	it("CLEAVE: 7 lanes on the 7 bullets, ending at their reach; the same preview the whole wind-up", () => {
		const f = forceAttack(1337, A.CLEAVE, 2.5, 80);
		const [first, last] = telegraphSpan(f);
		expect(last - first + 1).toBe(DEMONLORD_TELEGRAPH_TICKS[A.CLEAVE]);
		const t = f.ticks[last];
		const lanes = radialHeadings(t.marks.segs, t.x, t.z);
		expect(sameAngles(lanes, radialHeadings(f.ticks[first].marks.segs, t.x, t.z))).toBe(true);
		const k = firstVolley(f, last);
		expect(k).toBe(last + 1);
		expect(lanes.size()).toBe(CLEAVE.count);
		expect(
			sameAngles(
				lanes,
				f.ticks[k].shots.map((s) => s.heading),
			),
		).toBe(true);
		// the lanes end where the bullets stop (within one tick of flight)
		const reach = burstReach(CLEAVE);
		let far = 0;
		for (let i = k; i < f.ticks.size(); i++) far = math.max(far, f.ticks[i].far);
		expect(math.abs(far - reach)).toBeLessThanOrEqual(CLEAVE.speed * SIM_DT + POS_EPS);
		let lane = 0;
		for (const [x0, z0, x1, z1] of t.marks.segs) {
			lane = math.max(lane, hypot2(x0 - t.x, z0 - t.z), hypot2(x1 - t.x, z1 - t.z));
		}
		expect(math.abs(lane - reach)).toBeLessThan(POS_EPS);
	});

	it("DOUBLE_CLEAVE: the second arc's lanes from where the lunge stops, on the second volley", () => {
		const f = forceAttack(1337, A.DOUBLE_CLEAVE, 2.5, 120);
		const [, last] = telegraphSpan(f);
		const t = f.ticks[last];
		const k1 = firstVolley(f, last);
		const k2 = firstVolley(f, k1 + 1);
		expect(k2 - k1).toBe(DOUBLE_CLEAVE_DELAY_TICKS);
		// the lunge ends here (the second volley's tick); the preview put the second arc there
		const fin = f.ticks[k2];
		const px = t.x + t.v[DEMONLORD_V_DIR_X] * DOUBLE_CLEAVE_STEP;
		const pz = t.z + t.v[DEMONLORD_V_DIR_Z] * DOUBLE_CLEAVE_STEP;
		expect(hypot2(fin.x - px, fin.z - pz)).toBeLessThan(POS_EPS);
		expect(
			sameAngles(
				radialHeadings(t.marks.segs, t.x, t.z),
				f.ticks[k1].shots.map((s) => s.heading),
			),
		).toBe(true);
		expect(
			sameAngles(
				radialHeadings(t.marks.segs, px, pz),
				f.ticks[k2].shots.map((s) => s.heading),
			),
		).toBe(true);
		// during the lunge (ACTIVE ticks 0..delay - 1) the second arc stays on the lunge's end
		for (let i = k1; i < k2; i++) {
			const lunge = f.ticks[i];
			expect([i, lunge.marks.segs.size() > 0]).toEqual([i, true]);
			expect(
				sameAngles(
					radialHeadings(lunge.marks.segs, fin.x, fin.z),
					fin.shots.map((s) => s.heading),
				),
			).toBe(true);
		}
		expect(f.ticks[k2].marks.segs.size()).toBe(0);
	});

	it("HELLFIRE: the gap-edge ticks on the edge bullets of its 3 gaps, the arcs never in a gap (3 seeds)", () => {
		for (const seed of [1337, 42, 7]) {
			const f = forceAttack(seed, A.HELLFIRE, 4, 80);
			const [first, last] = telegraphSpan(f);
			const t = f.ticks[last];
			const k = firstVolley(f, last);
			expect(k).toBe(last + 1);
			const shots = f.ticks[k].shots;
			expect(shots.size()).toBe(3 * HELLFIRE_ARC.count);
			const min = HELLFIRE_ARC.spread / (HELLFIRE_ARC.count - 1) + ANGLE_EPS;
			const ticks = radialHeadings(t.marks.segs, t.x, t.z);
			expect([seed, ticks.size()]).toEqual([seed, 6]);
			expect([seed, sameAngles(ticks, gapEdges(shots, min))]).toEqual([seed, true]);
			expect(sameAngles(ticks, radialHeadings(f.ticks[first].marks.segs, t.x, t.z))).toBe(true);
			for (const h of pointHeadings(t.marks.segs, t.x, t.z))
				expect([seed, h, inGap(shots, min, h)]).toEqual([seed, h, false]);
		}
	});

	it("CHARGE: the lane to the target, the shockwave's gap edges on the bullets, fired on the target", () => {
		const f = forceAttack(1337, A.CHARGE, 5, 160);
		const [first, last] = telegraphSpan(f);
		const t = f.ticks[last];
		const tx = t.v[DEMONLORD_V_AUX_X];
		const tz = t.v[DEMONLORD_V_AUX_Z];
		const ticks = radialHeadings(t.marks.segs, tx, tz);
		expect(ticks.size()).toBe(2);
		expect(sameAngles(ticks, radialHeadings(f.ticks[first].marks.segs, tx, tz))).toBe(true);
		const k = firstVolley(f, last);
		const impact = f.ticks[k];
		expect(impact.v[DEMONLORD_V_MARK]).toBeGreaterThan(0);
		// he stopped on the target (an open arena), and the ring's widest gap is where the preview ticked it
		expect(hypot2(impact.x - tx, impact.z - tz)).toBeLessThan(POS_EPS);
		const min = CHARGE_SHOCKWAVE.spread / (CHARGE_SHOCKWAVE.count - 1) + ANGLE_EPS;
		expect(sameAngles(ticks, gapEdges(impact.shots, min))).toBe(true);
		// the impact circle (his body) on the target
		let onCircle = 0;
		for (const [x0, z0] of t.marks.segs)
			if (math.abs(hypot2(x0 - tx, z0 - tz) - DEMONLORD_DATA.radius) < POS_EPS) onCircle++;
		expect(onCircle).toBeGreaterThan(4);
		// the run (ACTIVE, before the impact) keeps the same preview; the impact tick and the hold draw none
		for (let i = last + 1; i < k; i++) {
			expect(sameAngles(radialHeadings(f.ticks[i].marks.segs, tx, tz), ticks)).toBe(true);
		}
		expect(impact.marks.segs.size()).toBe(0);
	});

	it("SUMMON: a ring on each add's landing spot", () => {
		// Stop on ACTIVE tick 0, the summon's tick: the adds stand where they landed.
		const f = forceAttack(1337, A.SUMMON, 4, DEMONLORD_TELEGRAPH_TICKS[A.SUMMON] + 1);
		const [, last] = telegraphSpan(f);
		expect(last + 1).toBe(f.ticks.size() - 1);
		const t = f.ticks[last];
		expect(t.v[DEMONLORD_V_SIGN]).toBe(1);
		expect(f.ticks[last + 1].spawned).toBe(DEMONLORD_SUMMON.count);
		const spots = summonSpots(
			t.x,
			t.z,
			t.v[DEMONLORD_V_DIR_X],
			t.v[DEMONLORD_V_DIR_Z],
			DEMONLORD_SUMMON.count,
			DEMONLORD_SUMMON.radius,
		);
		const boss = f.fight.boss;
		const adds = f.fight.state.combat.actors.filter((o) => o !== boss && o.alive !== 0 && o.kind !== NO_KIND);
		expect(adds.size()).toBe(DEMONLORD_SUMMON.count);
		for (const [sx, sz] of spots) {
			expect(adds.some((o) => hypot2(o.x - sx, o.z - sz) < POS_EPS)).toBe(true);
			let ring = 0;
			for (const [x0, z0] of t.marks.segs) {
				if (math.abs(hypot2(x0 - sx, z0 - sz) - TELEGRAPH_VIEW.summonSpotRadius) < POS_EPS) ring++;
			}
			expect(ring).toBeGreaterThan(2);
		}
	});

	it("SUMMON at the cap: the hellfire ring it fires instead, gap edges on its bullets", () => {
		const f = forceAttack(1337, A.SUMMON, 4, 100, (ctx, fight) => {
			for (let i = 0; i < 3; i++) ctx.spawnActor("swarmer", fight.boss.x, fight.boss.z);
		});
		const [, last] = telegraphSpan(f);
		const t = f.ticks[last];
		expect(t.v[DEMONLORD_V_SIGN]).toBe(0);
		const k = firstVolley(f, last);
		const shots = f.ticks[k].shots;
		expect(shots.size()).toBe(3 * HELLFIRE_ARC.count);
		const min = HELLFIRE_ARC.spread / (HELLFIRE_ARC.count - 1) + ANGLE_EPS;
		expect(sameAngles(radialHeadings(t.marks.segs, t.x, t.z), gapEdges(shots, min))).toBe(true);
	});
});

// ---------------------------------------------------------------------------------------------
// The sprite animation over the same fights

/** Asserts the stretched one-shot `anim` runs 0 -> 1 over ticks [from, to] (alpha 0 at `from`, alpha 1 at `to`). */
function stretchedOver(f: Forced, anim: string, from: number, to: number): void {
	let prev = -1;
	for (let i = from; i <= to; i++) {
		const t = f.ticks[i];
		expect([i, t.anim0.anim, t.anim1.anim]).toEqual([i, anim, anim]);
		const p0 = t.anim0.progress!;
		const p1 = t.anim1.progress!;
		expect(p0).toBeGreaterThanOrEqual(prev);
		expect(p1).toBeGreaterThanOrEqual(p0);
		expect(p1).toBeLessThanOrEqual(1);
		prev = p1;
	}
	expect(f.ticks[to].anim1.progress).toBe(1);
}

/** The last index of the run of ticks starting at `from` in the same aiState / attack pair as `from`'s. */
function runEnd(f: Forced, from: number, pred: (t: Tick) => boolean): number {
	let i = from;
	while (i + 1 < f.ticks.size() && pred(f.ticks[i + 1])) i++;
	return i;
}

describe("Demon Lord sprite animation over real fights", () => {
	it("the intro roar plays `intro` over introTicks, then the attack", () => {
		const f = forceAttack(1337, A.HELLFIRE, 4, 10);
		expect(f.ticks[0].state).toBe(DemonlordState.TRANSITION);
		for (let i = 0; i < f.start; i++) expect([i, f.ticks[i].anim0.anim]).toEqual([i, "intro"]);
		expect(f.ticks[f.start - 1].anim1.progress).toBe(1);
		expect(f.start).toBe(DEMONLORD_DATA.introTicks - 1);
	});

	it("CLEAVE out of range: move while chasing, then `attack` over the telegraph + hold, then idle", () => {
		const f = forceAttack(1337, A.CLEAVE, 6, 160);
		expect(f.ticks[f.start].state).toBe(DemonlordState.CHASE);
		const chaseEnd = runEnd(f, f.start, (t) => t.state === DemonlordState.CHASE);
		// (the chase starts on the roar's last tick, standing: he walks from the next one)
		for (let i = f.start + 1; i <= chaseEnd; i++) expect([i, f.ticks[i].anim0.anim]).toEqual([i, "move"]);
		const swingEnd = runEnd(
			f,
			chaseEnd + 1,
			(t) => t.state === AiState.TELEGRAPH || t.state === DemonlordState.ACTIVE,
		);
		stretchedOver(f, "attack", chaseEnd + 1, swingEnd);
		expect(f.ticks[swingEnd + 1].state).toBe(DemonlordState.RECOVER);
		expect(f.ticks[swingEnd + 1].anim0.anim).toBe("idle");
	});

	for (const [name, attack, anim] of [
		["HELLFIRE", A.HELLFIRE, "attack.2"],
		["DOUBLE_CLEAVE", A.DOUBLE_CLEAVE, "attack"],
		["SUMMON", A.SUMMON, "intro"],
	] as Array<[string, number, string]>) {
		it(`${name}: \`${anim}\` stretched over the telegraph + the whole active span`, () => {
			const f = forceAttack(1337, attack, 2.5, 140);
			const [first] = telegraphSpan(f);
			const fin = runEnd(f, first, (t) => t.state === AiState.TELEGRAPH || t.state === DemonlordState.ACTIVE);
			stretchedOver(f, anim, first, fin);
			expect(f.ticks[fin + 1].state).toBe(DemonlordState.RECOVER);
		});
	}

	it("CHARGE: idle through the wind-up, move on the run, `attack.2` from the impact over the impact hold", () => {
		const f = forceAttack(1337, A.CHARGE, 5, 160);
		const [first, last] = telegraphSpan(f);
		for (let i = first; i <= last; i++) expect([i, f.ticks[i].anim0.anim]).toEqual([i, "idle"]);
		const k = firstVolley(f, last);
		for (let i = last + 1; i < k; i++) {
			expect([i, f.ticks[i].anim0.anim, f.ticks[i].anim0.progress]).toEqual([i, "move", undefined]);
		}
		const fin = runEnd(f, k, (t) => t.state === DemonlordState.ACTIVE);
		stretchedOver(f, SPRITE_VIEW.demonlordAnims.impact, k, fin);
		expect(f.ticks[k].anim0.progress).toBe(0);
	});
});
