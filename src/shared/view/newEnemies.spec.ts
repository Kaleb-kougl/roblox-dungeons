// The second endless set on screen (docs/NEW_ENEMIES.md NE8, NE11): the strike row's geometry against the sim's own
// strike points, the Charger's unclipped lane, the aura tint only on buffed actors, the Bomber's death pick (Explode on
// a detonation, Die 1 on a fizzle) and its quick corpse, the fuse flash, the stun / dizzy marker, the sprite inputs per
// state (with death.2 / move.back), the strike pool split and flash look, and the first-sighting scan for the five.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ACTOR_SCRATCH_SLOTS,
	AiState,
	BOMBER,
	BOMBER_ATTACK_FUSE,
	BOMBER_DETONATED,
	BOMBER_FUSED,
	BOMBER_FUSE_LIT,
	BulletKind,
	BulletPayload,
	CHARGER,
	CHARGER_ATTACK_LANE,
	CHARGER_CHARGE,
	CHARGER_LEFT,
	CHARGER_RECOVER,
	CHARGER_STUN,
	CORPSE_TICKS,
	DAMAGE_CAP_BUCKETS,
	EMPTY_INPUT,
	MAX_ACTORS,
	NO_KIND,
	REAPER,
	REAPER_ATTACK_WIND,
	REAPER_DIZZY,
	REAPER_SPIN,
	STORMCALLER,
	STORMCALLER_ATTACK_CAST,
	STORMCALLER_CENTRE_X,
	STORMCALLER_CENTRE_Z,
	STORMCALLER_OFFSET_X,
	STORMCALLER_OFFSET_Z,
	STRIKE_BULLET_RADIUS,
	SWARMER,
	WARBANNER,
	WARBANNER_ATTACK_PANIC,
	archetypeAt,
	archetypeIndex,
	createSimState,
	partySize,
	playerAt,
	step,
	type ActorSpawn,
	type ActorState,
	type SimConfig,
	type SimState,
} from "shared/sim";
import {
	CHARACTER,
	ENEMY,
	listThemePacks,
	loadThemePack,
	optionalBaseAnimations,
	type SpriteAnimationDef,
} from "shared/theme";
import { SIGHTING_IDS } from "shared/onboarding";
import { actorFxMarkings, strikeRowPoint, type ActorFxHintsView, type SegmentSink } from "./markings";
import {
	AuraView,
	DetonationWatch,
	bomberDetonated,
	bomberFuseFlashOn,
	bomberFusing,
	detonationCorpseView,
	dizzyMarked,
	dizzyStarSegments,
	isStrikePayload,
	newEnemyKinds,
	strikeDecalLook,
} from "./newEnemies";
import {
	DETONATION_VIEW,
	DIZZY_VIEW,
	NEW_ENEMY_ANIM_MARKS,
	NEW_ENEMY_SPRITE_VIEW,
	STRIKE_VIEW,
} from "./newEnemiesConfig";
import { sightingsInView } from "./sighting";
import { ACTOR_SPRITE_INPUTS, chooseActorAnim, type SpriteAnimSource } from "./sprites";
import {
	bomberSpriteInput,
	chargerAttack,
	chargerSpriteInput,
	movesBack,
	reaperAttack,
	reaperSpriteInput,
	stormcallerAttack,
	stormcallerSpriteInput,
	warbannerSpriteInput,
} from "./newEnemySprites";
import { enemyBulletPool, variantLook, viewFxHints, type GooLook } from "./variants";

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

const BASE = {
	idle: anim(4, 8, true),
	move: anim(6, 10, true),
	attack: anim(9, 12, false),
	hit: anim(3, 12, false),
	death: anim(6, 10, false),
};
const PLAIN_SET = source(BASE);
const FULL_SET = source({ ...BASE, "death.2": anim(15, 14, false), "move.back": anim(6, 10, true) });

/** Every segment, as drawn. */
class Segs implements SegmentSink {
	readonly list: Array<[number, number, number, number]> = [];
	seg(x0: number, z0: number, x1: number, z1: number): void {
		this.list.push([x0, z0, x1, z1]);
	}
}

const openConfig = (spawns: ActorSpawn[]): SimConfig => ({
	encounter: { spawns, rooms: [], entranceRoom: -1, bossRoom: -1 },
});

/** Players can't be hurt. */
function ghost(s: SimState): void {
	for (let i = 0; i < partySize(s); i++) playerAt(s, i).hurtTicks = 1e6;
}

function firstOf(s: SimState, id: string): ActorState {
	for (const a of s.combat.actors) if (a.kind !== NO_KIND && archetypeAt(a.kind).id === id) return a;
	error(`no ${id}`);
}

const dist = (ax: number, az: number, bx: number, bz: number) =>
	math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));

// ---------------------------------------------------------------------------------------------

describe("strike row geometry", () => {
	const ROW = (STORMCALLER.data.fx as ActorFxHintsView).strikeRow!;

	it("strikeRowPoint: the middle circle on the centre, the others one offset either side", () => {
		const a = actor({});
		a.v[STORMCALLER_CENTRE_X] = 4;
		a.v[STORMCALLER_CENTRE_Z] = -1;
		a.v[STORMCALLER_OFFSET_X] = 0;
		a.v[STORMCALLER_OFFSET_Z] = 2.2;
		expect(ROW.count).toBe(3);
		const out: [number, number] = [0, 0];
		expect([...strikeRowPoint(ROW, a, 0, out)]).toEqual([4, -1 - 2.2]);
		expect([...strikeRowPoint(ROW, a, 1, out)]).toEqual([4, -1]);
		expect([...strikeRowPoint(ROW, a, 2, out)]).toEqual([4, -1 + 2.2]);
	});

	it("draws three rings of the strike radius, only during the cast, and no generic ring", () => {
		const a = actor({ aiState: AiState.TELEGRAPH, attack: STORMCALLER_ATTACK_CAST, aiTicks: 45, x: 9, z: 9 });
		a.v[STORMCALLER_CENTRE_X] = 1;
		a.v[STORMCALLER_CENTRE_Z] = 2;
		a.v[STORMCALLER_OFFSET_X] = 2.2;
		a.v[STORMCALLER_OFFSET_Z] = 0;
		const fx = viewFxHints(STORMCALLER.id, STORMCALLER.data.fx as ActorFxHintsView)!;
		const bright = new Segs();
		const dim = new Segs();
		expect(actorFxMarkings(bright, dim, a, fx, a.x, a.z, 0)).toBe(true);
		const centres: Array<[number, number]> = [
			[1 - 2.2, 2],
			[1, 2],
			[1 + 2.2, 2],
		];
		const hits = [0, 0, 0];
		// Every outline point lies on one circle of STRIKE_BULLET_RADIUS (the sim's hit radius) around a point.
		for (const [x0, z0] of dim.list) {
			// The rings touch (spacing 2.2 = two radii): count each point for its first matching circle.
			let k = -1;
			for (let i = 0; i < 3 && k < 0; i++) {
				if (math.abs(dist(x0, z0, centres[i][0], centres[i][1]) - STRIKE_BULLET_RADIUS) < 1e-6) k = i;
			}
			expect(k).never.toBe(-1);
			hits[k]++;
		}
		expect(hits[0] > 0 && hits[1] > 0 && hits[2] > 0).toBe(true);
		expect(hits[0] + hits[1] + hits[2]).toBe(dim.list.size());
		// Filling: inner circles on the bright layer, inside the outline.
		for (const [x0, z0] of bright.list) {
			const r = math.min(...centres.map(([cx, cz]) => dist(x0, z0, cx, cz)));
			expect(r < STRIKE_BULLET_RADIUS).toBe(true);
		}
		const keep = actor({ aiState: AiState.CUSTOM, v: a.v });
		expect(actorFxMarkings(new Segs(), new Segs(), keep, fx, 0, 0, 0)).toBe(false);
	});

	it("a real Stormcaller's strikes land exactly on the circles its cast drew", () => {
		const config = openConfig([{ kind: STORMCALLER.id, x: 0, z: 9 }]);
		const s = createSimState(5, 0, 0, config);
		ghost(s);
		const a = firstOf(s, STORMCALLER.id);
		const fx = viewFxHints(STORMCALLER.id, STORMCALLER.data.fx as ActorFxHintsView)!;
		const row = fx.strikeRow!;
		const drawn: Array<[number, number]> = [];
		let casts = 0;
		for (let t = 0; t < 1200 && casts < 2; t++) {
			step(s, EMPTY_INPUT, config);
			if (a.alive === 0) break;
			if (a.aiState === row.state && a.attack === row.attack) {
				drawn.clear();
				for (let i = 0; i < row.count; i++) {
					const p = strikeRowPoint(row, a, i, [0, 0]);
					drawn.push([p[0], p[1]]);
				}
			}
			if (s.events.strikes > 0) {
				casts++;
				const b = s.combat.enemyBullets;
				let strikes = 0;
				for (let i = 0; i < b.highWater(); i++) {
					if (!b.isVisible(i) || !isStrikePayload(b.payloadAt(i))) continue;
					strikes++;
					const p = b.positionAt(i);
					expect(drawn.some(([x, z]) => dist(p.x, p.z, x, z) < 1e-9)).toBe(true);
				}
				expect(strikes).toBe(s.events.strikes);
			}
		}
		expect(casts).toBeGreaterThanOrEqual(1);
	});
});

describe("hints of the other four", () => {
	it("the Charger's lane is never clipped by breakables (its charge breaks them); the rest keep their hints", () => {
		const fx = viewFxHints(CHARGER.id, CHARGER.data.fx as ActorFxHintsView)!;
		expect(fx.aimLine!.clip).toBe(false);
		expect(fx.aimLine!.length).toBe(CHARGER.data.chargeRange);
		expect(viewFxHints(CHARGER.id, CHARGER.data.fx as ActorFxHintsView)).toBe(fx); // cached
		const a = actor({ aiState: AiState.TELEGRAPH, attack: CHARGER_ATTACK_LANE, aiTicks: 20 });
		a.v[3] = 1; // CHARGER_DIR_X
		const bright = new Segs();
		const clip = () => 1; // a breakable one unit ahead
		expect(actorFxMarkings(bright, new Segs(), a, fx, 0, 0, 0, clip)).toBe(true);
		expect(bright.list[0][2]).toBe(CHARGER.data.chargeRange);
		for (const def of [BOMBER, REAPER]) {
			const raw = def.data.fx as ActorFxHintsView;
			expect(viewFxHints(def.id, raw)).toBe(raw);
		}
		expect((BOMBER.data.fx as ActorFxHintsView).ring!.radius).toBe(BOMBER.data.fuseRingRadius);
		expect((REAPER.data.fx as ActorFxHintsView).ring!.radius).toBe(REAPER.data.windRingRadius);
	});
});

describe("Warbanner aura tint", () => {
	it("tints only the living aura targets inside the radius: never the banner, a far or dead actor", () => {
		const r = WARBANNER.data.auraRadius;
		const config = openConfig([
			{ kind: WARBANNER.id, x: 0, z: 6 },
			{ kind: SWARMER.id, x: r - 0.5, z: 6 },
			{ kind: SWARMER.id, x: -(r + 0.5), z: 6 },
			{ kind: SWARMER.id, x: 1, z: 6 },
		]);
		const s = createSimState(1, 0, 0, config);
		const actors = s.combat.actors;
		const [banner, near, far, dead] = [actors[0], actors[1], actors[2], actors[3]];
		dead.alive = 0;
		const aura = new AuraView();
		aura.update(s);
		expect([aura.buffed(banner), aura.buffed(near), aura.buffed(far), aura.buffed(dead)]).toEqual([
			false,
			true,
			false,
			false,
		]);
		// The look: "aura" only while nothing else shows; never on a corpse.
		expect(variantLook("normal", 1, false, false, aura.buffed(near))).toBe("aura");
		expect(variantLook("normal", 1, false, false, aura.buffed(far))).toBe("normal");
		expect(variantLook("flash", 1, false, false, true)).toBe("flash");
		expect(variantLook("telegraph", 1, false, false, true)).toBe("telegraph");
		expect(variantLook("normal", 1, false, true, true)).toBe("shield");
		expect(variantLook("normal", 0, false, false, true)).toBe("normal");
		// The banner dies: nobody is buffed after the next rebuild.
		banner.alive = 0;
		aura.update(s);
		expect([aura.buffed(near), aura.size()]).toEqual([false, 0]);
		// No Warbanner at all (every older run): nothing.
		const plain = createSimState(1, 0, 0, openConfig([{ kind: SWARMER.id, x: 1, z: 6 }]));
		aura.update(plain);
		expect(aura.size()).toBe(0);
	});

	it("a stale actor object in a reused slot is not buffed (the id guard)", () => {
		const config = openConfig([
			{ kind: WARBANNER.id, x: 0, z: 6 },
			{ kind: SWARMER.id, x: 1, z: 6 },
		]);
		const s = createSimState(1, 0, 0, config);
		const aura = new AuraView();
		aura.update(s);
		const near = s.combat.actors[1];
		expect(aura.buffed(near)).toBe(true);
		near.id += 100;
		expect(aura.buffed(near)).toBe(false);
	});
});

describe("Bomber", () => {
	it("death pick: death.2 on a detonated corpse when the set has it, death otherwise and on a fizzle", () => {
		const kind = archetypeIndex(BOMBER.id);
		const blown = actor({ kind, alive: 0, deadTicks: 4 });
		blown.v[BOMBER_FUSED] = BOMBER_DETONATED;
		expect(bomberDetonated(blown)).toBe(true);
		expect(bomberSpriteInput(blown, 0).deathAnim).toBe(NEW_ENEMY_SPRITE_VIEW.anims.detonation);
		expect(chooseActorAnim(bomberSpriteInput(blown, 0), FULL_SET).anim).toBe("death.2");
		expect(chooseActorAnim(bomberSpriteInput(blown, 0), PLAIN_SET).anim).toBe("death");
		for (const fused of [0, BOMBER_FUSE_LIT]) {
			const shot = actor({ kind, alive: 0, deadTicks: 4 });
			shot.v[BOMBER_FUSED] = fused;
			expect([fused, bomberDetonated(shot), bomberSpriteInput(shot, 0).deathAnim]).toEqual([
				fused,
				false,
				undefined,
			]);
			expect(chooseActorAnim(bomberSpriteInput(shot, 0), FULL_SET).anim).toBe("death");
		}
		// A living Bomber never plays a death, whatever v says.
		const alive = actor({ kind });
		alive.v[BOMBER_FUSED] = BOMBER_DETONATED;
		expect(bomberDetonated(alive)).toBe(false);
		// The corpse: Explode keeps the normal corpse time; without it, a quick fade.
		expect(detonationCorpseView(CORPSE_TICKS, true)).toEqual({ corpseTicks: CORPSE_TICKS, fadeFrom: 0 });
		expect(detonationCorpseView(CORPSE_TICKS, false)).toEqual({
			corpseTicks: DETONATION_VIEW.quickFadeTicks,
			fadeFrom: 0,
		});
		// The contract names the optional animations (never required).
		expect(optionalBaseAnimations(ENEMY)).toContain("death.2");
		expect(optionalBaseAnimations(ENEMY)).toContain("move.back");
		expect(optionalBaseAnimations(CHARACTER)).never.toContain("death.2");
	});

	it("the fuse: attack over the fuse, a flash that only quickens; a real detonation is seen once", () => {
		const fuse = BOMBER.data.fuseTicks;
		const fusing = actor({
			kind: archetypeIndex(BOMBER.id),
			aiState: AiState.TELEGRAPH,
			attack: BOMBER_ATTACK_FUSE,
			aiTicks: fuse,
		});
		expect(bomberFusing(fusing)).toBe(true);
		const input = bomberSpriteInput(fusing, 0);
		expect([input.attack!.elapsed, input.attack!.total]).toEqual([0, fuse]);
		expect(chooseActorAnim(input, PLAIN_SET).anim).toBe("attack");
		// Toggle gaps shrink: every on -> off -> on cycle is no longer than the one before.
		const toggles: number[] = [];
		let last = bomberFuseFlashOn(fuse, 0);
		for (let t = 1; t <= fuse; t++) {
			const on = bomberFuseFlashOn(fuse - t, 0);
			if (on !== last) toggles.push(t);
			last = on;
		}
		expect(toggles.size()).toBeGreaterThan(4);
		for (let i = 3; i < toggles.size(); i++) {
			expect(toggles[i] - toggles[i - 2] <= toggles[i - 1] - toggles[i - 3] + 1).toBe(true);
		}
		expect(bomberFuseFlashOn(fuse, 0)).toBe(true); // it lights on

		const config = openConfig([{ kind: BOMBER.id, x: 0, z: 4 }]);
		const s = createSimState(2, 0, 0, config);
		ghost(s);
		const b = firstOf(s, BOMBER.id);
		const watch = new DetonationWatch(MAX_ACTORS);
		let seen = 0;
		watch.update(s, archetypeIndex(BOMBER.id));
		for (let t = 0; t < 600 && b.id !== 0 && (b.alive !== 0 || seen === 0); t++) {
			step(s, EMPTY_INPUT, config);
			const n = watch.update(s, archetypeIndex(BOMBER.id));
			for (let i = 0; i < n; i++) {
				expect(watch.at(i).actorId).toBe(b.id);
				seen++;
			}
		}
		expect([b.alive, b.v[BOMBER_FUSED], seen]).toEqual([0, BOMBER_DETONATED, 1]);
		for (let t = 0; t < 10; t++) {
			step(s, EMPTY_INPUT, config);
			expect(watch.update(s, archetypeIndex(BOMBER.id))).toBe(0);
		}
	});

	it("a shot Bomber is no detonation", () => {
		const s = createSimState(2, 0, 0, openConfig([{ kind: BOMBER.id, x: 0, z: 6 }]));
		const watch = new DetonationWatch(MAX_ACTORS);
		const kind = archetypeIndex(BOMBER.id);
		watch.update(s, kind);
		s.tick += 1;
		const b = s.combat.actors[0];
		b.alive = 0;
		b.v[BOMBER_FUSED] = BOMBER_FUSE_LIT;
		expect(watch.update(s, kind)).toBe(0);
	});
});

describe("stun and dizzy marker", () => {
	it("marks a stunned Charger and a dizzy Reaper only; stars orbit the body", () => {
		const k = newEnemyKinds();
		expect(dizzyMarked(actor({ kind: k.charger, aiState: CHARGER_STUN }))).toBe(true);
		expect(dizzyMarked(actor({ kind: k.charger, aiState: CHARGER_RECOVER }))).toBe(false);
		expect(dizzyMarked(actor({ kind: k.reaper, aiState: REAPER_DIZZY }))).toBe(true);
		expect(dizzyMarked(actor({ kind: k.reaper, aiState: REAPER_SPIN }))).toBe(false);
		expect(dizzyMarked(actor({ kind: k.charger, aiState: CHARGER_STUN, alive: 0 }))).toBe(false);
		expect(dizzyMarked(actor({ kind: k.bomber, aiState: CHARGER_STUN }))).toBe(false);
		const segs = new Segs();
		dizzyStarSegments(segs, 2, 3, 0.5, 0.25);
		expect(segs.list.size()).toBe(2 * DIZZY_VIEW.stars);
		for (let i = 0; i < segs.list.size(); i += 2) {
			const [x0, z0, x1, z1] = segs.list[i];
			expect(dist((x0 + x1) / 2, (z0 + z1) / 2, 2, 3)).toBeCloseTo(0.5 + DIZZY_VIEW.marginTiles, 9);
		}
	});
});

describe("sprite inputs per state", () => {
	it("registers the five; every bundled pack still draws them as placeholders (their sets land in NE9)", () => {
		for (const packId of listThemePacks()) {
			const pack = loadThemePack(packId, { warn: () => undefined });
			for (const def of [BOMBER, CHARGER, STORMCALLER, WARBANNER, REAPER]) {
				expect([packId, def.id, pack.sprites(def.data.spriteId)]).toEqual([packId, def.id, undefined]);
			}
		}
		expect(ACTOR_SPRITE_INPUTS.get(BOMBER.id)).toBe(bomberSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(CHARGER.id)).toBe(chargerSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(STORMCALLER.id)).toBe(stormcallerSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(WARBANNER.id)).toBe(warbannerSpriteInput);
		expect(ACTOR_SPRITE_INPUTS.get(REAPER.id)).toBe(reaperSpriteInput);
	});

	it("charger: rear back over the lane, the rush looped while charging, hit over the whole stun, idle on recover", () => {
		const d = CHARGER.data;
		const lane = chargerAttack(
			actor({ aiState: AiState.TELEGRAPH, attack: CHARGER_ATTACK_LANE, aiTicks: d.laneTicks }),
			0,
		)!;
		expect([lane.elapsed, lane.total, lane.segment!.to]).toEqual([
			0,
			d.laneTicks,
			NEW_ENEMY_ANIM_MARKS.charger.lane,
		]);
		const charging = actor({ aiState: CHARGER_CHARGE });
		charging.v[CHARGER_LEFT] = d.chargeRange - 2 * d.chargeSpeed * (1 / 60);
		const rush = chargerAttack(charging, 0)!;
		expect([rush.loop, rush.segment!.from]).toEqual([true, NEW_ENEMY_ANIM_MARKS.charger.lane]);
		expect(rush.elapsed).toBeCloseTo(2, 9);
		const stun = chargerAttack(actor({ aiState: CHARGER_STUN, aiTicks: d.stunTicks }), 0)!;
		expect([stun.anim, stun.elapsed, stun.total]).toEqual([NEW_ENEMY_SPRITE_VIEW.anims.stun, 0, d.stunTicks]);
		expect(
			chooseActorAnim(chargerSpriteInput(actor({ aiState: CHARGER_STUN, aiTicks: 10 }), 0), PLAIN_SET).anim,
		).toBe("hit");
		expect(chargerAttack(actor({ aiState: CHARGER_RECOVER, aiTicks: 10 }), 0)).toBe(undefined);
	});

	it("stormcaller: the staff rises over the cast, then holds for its last holdTicks", () => {
		const total = STORMCALLER.data.castTicks;
		const hold = NEW_ENEMY_ANIM_MARKS.stormcaller.holdTicks;
		const start = stormcallerAttack(AiState.TELEGRAPH, STORMCALLER_ATTACK_CAST, total, 0)!;
		expect([start.elapsed, start.total, start.segment!.to]).toEqual([
			0,
			total - hold,
			NEW_ENEMY_ANIM_MARKS.stormcaller.raise,
		]);
		const late = stormcallerAttack(AiState.TELEGRAPH, STORMCALLER_ATTACK_CAST, hold, 0)!;
		expect([late.elapsed, late.total, late.segment!.from]).toEqual([
			0,
			hold,
			NEW_ENEMY_ANIM_MARKS.stormcaller.raise,
		]);
		expect(stormcallerAttack(AiState.CUSTOM, 0, 0, 0)).toBe(undefined);
	});

	it("warbanner: the panic, move.back while walking away from its facing (move without the animation)", () => {
		const panic = warbannerSpriteInput(
			actor({ aiState: AiState.TELEGRAPH, attack: WARBANNER_ATTACK_PANIC, aiTicks: 5 }),
			0,
		);
		expect(panic.attack!.total).toBe(WARBANNER.data.panicTelegraphTicks);
		const step = WARBANNER.data.speed / 60;
		const back = actor({ aiState: AiState.CUSTOM, faceX: 1, faceZ: 0, prevX: 0, x: -step });
		const fwd = actor({ aiState: AiState.CUSTOM, faceX: 1, faceZ: 0, prevX: 0, x: step });
		const side = actor({ aiState: AiState.CUSTOM, faceX: 1, faceZ: 0, prevZ: 0, z: step });
		expect([movesBack(0, 0, -1, 0, 1, 0), movesBack(0, 0, 1, 0, 1, 0), movesBack(0, 0, 0, 1, 1, 0)]).toEqual([
			true,
			false,
			false,
		]);
		expect(movesBack(0, 0, 0, 0, 1, 0)).toBe(false); // standing
		expect(chooseActorAnim(warbannerSpriteInput(back, 0), FULL_SET).anim).toBe("move.back");
		expect(chooseActorAnim(warbannerSpriteInput(back, 0), PLAIN_SET).anim).toBe("move");
		expect(chooseActorAnim(warbannerSpriteInput(fwd, 0), FULL_SET).anim).toBe("move");
		expect(chooseActorAnim(warbannerSpriteInput(side, 0), FULL_SET).anim).toBe("move");
	});

	it("reaper: the wind, the spin looped, the dizzy a slowed idle", () => {
		const d = REAPER.data;
		const wind = reaperAttack(AiState.TELEGRAPH, REAPER_ATTACK_WIND, d.windTicks, 0)!;
		expect([wind.total, wind.segment!.to]).toEqual([d.windTicks, NEW_ENEMY_ANIM_MARKS.reaper.spin]);
		const spin = reaperAttack(REAPER_SPIN, 0, d.spinTicks - 3, 0)!;
		expect([spin.loop, spin.elapsed, spin.segment!.from]).toEqual([true, 3, NEW_ENEMY_ANIM_MARKS.reaper.spin]);
		const dizzy = reaperSpriteInput(actor({ aiState: REAPER_DIZZY, aiTicks: 20 }), 0);
		expect(dizzy.attack).toBe(undefined);
		const choice = chooseActorAnim(dizzy, PLAIN_SET);
		expect([choice.anim, choice.rate]).toEqual(["idle", NEW_ENEMY_SPRITE_VIEW.dizzyIdleRate]);
		expect(chooseActorAnim(reaperSpriteInput(actor({}), 0), PLAIN_SET).rate).toBe(1);
	});
});

describe("strike flash", () => {
	it("splits the pool by kind and flashes in, settles and fades", () => {
		const strike = BulletPayload.pack({ damage: 2, kind: BulletKind.STRIKE });
		expect(isStrikePayload(strike)).toBe(true);
		expect(enemyBulletPool(strike, true, true)).toBe("strike");
		expect(enemyBulletPool(strike, true, false)).toBe("enemy");
		expect(enemyBulletPool(BulletPayload.pack({ damage: 2, kind: BulletKind.GOO }), true, true)).toBe("goo");
		expect(enemyBulletPool(BulletPayload.pack({ damage: 2, kind: BulletKind.ENEMY }), true, true)).toBe("enemy");
		const life = STORMCALLER.data.strike.life;
		const out: GooLook = { scale: 0, transparency: 0 };
		strikeDecalLook(life, life, out);
		expect([out.scale, out.transparency]).toEqual([STRIKE_VIEW.startScale, 0]);
		strikeDecalLook(life - STRIKE_VIEW.popSec, life, out);
		expect(out.scale).toBeCloseTo(1, 9);
		strikeDecalLook(0, life, out);
		expect(out.transparency).toBe(1);
	});
});

describe("first sighting (NE11)", () => {
	it("the five are sighting ids, found in view in canonical order", () => {
		const five = ["bomber", "charger", "stormcaller", "warbanner", "reaper"];
		for (const id of five) expect(SIGHTING_IDS).toContain(id);
		const s = createSimState(1, 0, 0, openConfig(five.map((kind, i) => ({ kind, x: i - 2, z: 3 }))));
		const found = sightingsInView(s, 0, []);
		const order = SIGHTING_IDS.filter((id) => five.includes(id));
		expect(found).toEqual(order);
	});
});
