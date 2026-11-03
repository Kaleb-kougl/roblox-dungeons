// docs/NEW_ENEMIES.md NE6: the Warbanner (`warbanner`, band PORT_BAND_ENEMIES_2) and its aura (NED8: walk 125 %,
// attack cooldowns 80 %, radius 4.5, no stacking, never a telegraph). The aura mask (SimCtx.auraMask, rebuilt at the
// start of stepActors from tick-start positions; a pure function of hashed state), the actorMods combination with the
// affix percent (combinedPercent), its exclusions (bosses, turrets, the dummy, other Warbanners), telegraph ticks
// unchanged inside it, the keep-away (bands, centroid pull), the panic, and determinism. Hand-built open arenas.
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind } from "shared/dungeon";
import {
	AFFIXES_CONFIG,
	AFFIX_RULES,
	AiState,
	BRUISER,
	EMPTY_INPUT,
	NO_KIND,
	PERCENT,
	SIM_DT,
	STATE_ENGAGED,
	SWARMER,
	SimCtx,
	WARBANNER,
	WARBANNER_ATTACK_PANIC,
	WARBANNER_AURA_COOLDOWN_PERCENT,
	WARBANNER_AURA_RADIUS,
	WARBANNER_AURA_WALK_PERCENT,
	WARBANNER_BACKOFF,
	WARBANNER_KEEP,
	WARBANNER_PANIC,
	actorCooldownPercent,
	actorWalkPercent,
	archetypeAt,
	archetypeIds,
	archetypeIndex,
	auraCooldownPercent,
	auraWalkPercent,
	combinedPercent,
	createSimState,
	enemyCooldown,
	hashState,
	isWarbannerAuraTarget,
	scalePercent,
	scaleTicks,
	spawnActor,
	step,
	walkStep,
	warbannerAuraMask,
	type ActorSpawn,
	type ActorState,
	type EncounterConfig,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { stepActors } from "./combat/actors/actors";

const enc = (spawns: ActorSpawn[]): EncounterConfig => ({ spawns, rooms: [], entranceRoom: -1, bossRoom: -1 });

interface World {
	s: SimState;
	ctx: SimCtx;
	config: SimConfig;
}

function world(withAffixes = false, seed = 7): World {
	const config: SimConfig = {};
	if (withAffixes) config.affixes = AFFIXES_CONFIG;
	const s = createSimState(seed, 0, 0, config);
	const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
	return { s, ctx, config };
}

function spawn(w: World, id: string, x: number, z: number, affix: number = AffixKind.NONE): ActorState {
	const a = spawnActor(w.ctx, archetypeIndex(id), x, z, affix);
	if (a === undefined) error("spawn failed", 0);
	return a;
}

/** Re-binds (empties the mask) and rebuilds it, as stepActors does first thing. */
function rebuild(w: World): void {
	w.ctx.bind(w.s, w.config, EMPTY_INPUT);
	w.ctx.rebuildAura();
}

/** The player can't be hurt (bullets and bodies pass through). */
const ghost = (s: SimState): void => {
	s.player.hurtTicks = 1e6;
};

const firstOf = (s: SimState, id: string): ActorState => {
	const kind = archetypeIndex(id);
	for (const a of s.combat.actors) if (a.kind === kind) return a;
	error(`no ${id}`, 0);
};

/** Spec-local brute force of NED8 from the actor pool: per slot, inside a living Warbanner's 4.5 (bosses etc. out). */
function bruteAura(s: SimState): boolean[] {
	const actors = s.combat.actors;
	const banner = archetypeIndex(WARBANNER.id);
	const out: boolean[] = [];
	for (const o of actors) {
		let on = false;
		const d = o.kind === NO_KIND ? undefined : archetypeAt(o.kind).data;
		const target =
			d !== undefined &&
			o.alive !== 0 &&
			o.kind !== banner &&
			d.boss !== true &&
			(d as unknown as { roomEnemy?: boolean }).roomEnemy === true;
		if (target) {
			for (const b of actors) {
				if (b.kind !== banner || b.alive === 0) continue;
				const dx = o.x - b.x;
				const dz = o.z - b.z;
				if (dx * dx + dz * dz <= WARBANNER_AURA_RADIUS * WARBANNER_AURA_RADIUS) on = true;
			}
		}
		out.push(on);
	}
	return out;
}

const dist = (a: Readonly<ActorState>, x: number, z: number): number =>
	math.sqrt((a.x - x) * (a.x - x) + (a.z - z) * (a.z - z));

describe("warbanner: data", () => {
	it("NED8 aura numbers, the summoner's panic shape, the bruiser's ring", () => {
		const d = WARBANNER.data;
		expect([d.auraRadius, d.auraWalkPercent, d.auraCooldownPercent]).toEqual([4.5, 125, 80]);
		expect([WARBANNER_AURA_RADIUS, WARBANNER_AURA_WALK_PERCENT, WARBANNER_AURA_COOLDOWN_PERCENT]).toEqual([
			4.5, 125, 80,
		]);
		expect([d.keepMin, d.keepMax, d.panicRange, d.panicTelegraphTicks]).toEqual([5, 8, 2.5, 30]);
		expect(d.panicRing).toBe(BRUISER.data.ring);
		expect(d.allyRange > d.auraRadius).toBe(true);
	});

	it("aura targets: room enemies only, never a boss, turret, dummy or Warbanner", () => {
		const targets: string[] = [];
		for (const id of archetypeIds()) if (isWarbannerAuraTarget(archetypeIndex(id))) targets.push(id);
		expect(targets).toEqual([
			"bruiser",
			"sniper",
			"swarmer",
			"imp",
			"slime",
			"slime.small",
			"summoner",
			"bomber",
			"charger",
			"reaper",
			"stormcaller",
		]);
		expect(isWarbannerAuraTarget(NO_KIND)).toBe(false);
	});
});

describe("warbanner: the aura mask", () => {
	it("is empty on a freshly bound ctx; rebuildAura marks targets within 4.5 (inclusive), nobody else", () => {
		const w = world();
		const banner = spawn(w, WARBANNER.id, 0, 20);
		const inside = spawn(w, SWARMER.id, 4.5, 20); // exactly on the radius
		const outside = spawn(w, SWARMER.id, 0, 20 + 4.5 + 1e-9);
		w.ctx.bind(w.s, w.config, EMPTY_INPUT);
		expect([w.ctx.inAura(inside), w.ctx.inAura(outside)]).toEqual([false, false]); // not built yet
		w.ctx.rebuildAura();
		expect([w.ctx.inAura(banner), w.ctx.inAura(inside), w.ctx.inAura(outside)]).toEqual([false, true, false]);
		expect([auraWalkPercent(w.ctx, inside), auraCooldownPercent(w.ctx, inside)]).toEqual([125, 80]);
		expect([auraWalkPercent(w.ctx, outside), auraCooldownPercent(w.ctx, outside)]).toEqual([PERCENT, PERCENT]);
		expect([auraWalkPercent(w.ctx, banner), auraCooldownPercent(w.ctx, banner)]).toEqual([PERCENT, PERCENT]);
		// bind() empties it again
		w.ctx.bind(w.s, w.config, EMPTY_INPUT);
		expect(w.ctx.inAura(inside)).toBe(false);
	});

	it("bosses, turrets, the dummy and another Warbanner are never buffed; a dead target or banner counts for nothing", () => {
		const w = world();
		spawn(w, WARBANNER.id, 0, 20);
		const other = spawn(w, WARBANNER.id, 1, 20);
		const turret = spawn(w, "turret.sprayer", -1, 20);
		const dummy = spawn(w, "dummy", 0, 21);
		const corpse = spawn(w, SWARMER.id, 0, 19);
		w.ctx.killActor(corpse);
		rebuild(w);
		for (const a of [other, turret, dummy, corpse]) {
			expect([a.kind, w.ctx.inAura(a), actorWalkPercent(w.ctx, a), actorCooldownPercent(w.ctx, a)]).toEqual([
				a.kind,
				false,
				PERCENT,
				PERCENT,
			]);
		}
		for (const id of archetypeIds()) {
			if (archetypeAt(archetypeIndex(id)).data.boss === true)
				expect([id, isWarbannerAuraTarget(archetypeIndex(id))]).toEqual([id, false]);
		}
	});

	it("no stacking: two banners give the same 125 / 80 as one", () => {
		const w = world();
		spawn(w, WARBANNER.id, 0, 20);
		spawn(w, WARBANNER.id, 2, 20);
		const a = spawn(w, BRUISER.id, 1, 21);
		rebuild(w);
		expect([actorWalkPercent(w.ctx, a), actorCooldownPercent(w.ctx, a)]).toEqual([125, 80]);
		expect(walkStep(w.ctx, a)).toBe(scalePercent(BRUISER.data.speed * SIM_DT, 125));
	});

	it("ends the tick after the banner dies (next rebuild); a slot reused mid-tick reads unbuffed", () => {
		const w = world();
		const banner = spawn(w, WARBANNER.id, 0, 20);
		const a = spawn(w, SWARMER.id, 2, 20);
		rebuild(w);
		expect(w.ctx.inAura(a)).toBe(true);
		w.ctx.killActor(banner);
		expect(w.ctx.inAura(a)).toBe(true); // this tick's mask holds
		rebuild(w);
		expect(w.ctx.inAura(a)).toBe(false);
		// id guard: the same slot object carrying a new actor is not in the old mask
		const banner2 = spawn(w, WARBANNER.id, 0, 30);
		const b = spawn(w, SWARMER.id, 1, 30);
		rebuild(w);
		expect(w.ctx.inAura(b)).toBe(true);
		const oldId = b.id;
		b.id = oldId + 1000;
		expect(w.ctx.inAura(b)).toBe(false);
		b.id = oldId;
		expect(banner2.alive).toBe(1);
	});

	it("stepActors builds it first, from tick-start positions", () => {
		const w = world();
		ghost(w.s);
		// A bruiser on the player and a banner exactly 4.5 behind it: the banner backs off (inside keepMin) during the
		// tick, so it ends the tick out of range, but the mask is the tick start's.
		spawn(w, WARBANNER.id, 0, 4);
		const a = spawn(w, BRUISER.id, 0, -0.5);
		w.s.tick += 1; // not stepped on its spawn tick
		const expected = bruteAura(w.s);
		w.ctx.bind(w.s, w.config, EMPTY_INPUT);
		stepActors(w.ctx);
		const got: boolean[] = [];
		for (const o of w.s.combat.actors) got.push(w.ctx.inAura(o));
		expect(got).toEqual(expected);
		expect(w.ctx.inAura(a)).toBe(true);
		expect(bruteAura(w.s)[w.s.combat.actors.indexOf(a)]).toBe(false); // moved out: the mask is the tick start's
	});

	it("equals a recompute from state every tick of a run (packs walking in and out, a banner killed)", () => {
		const config: SimConfig = {
			encounter: enc([
				{ kind: WARBANNER.id, x: 0, z: 7 },
				{ kind: SWARMER.id, x: 2, z: 8 },
				{ kind: SWARMER.id, x: -2, z: 8 },
				{ kind: BRUISER.id, x: 3, z: 5 },
				{ kind: "sniper", x: -4, z: 9 },
				{ kind: WARBANNER.id, x: 10, z: -6 },
				{ kind: SWARMER.id, x: 9, z: -8 },
			]),
		};
		const s = createSimState(99, 0, 0, config);
		ghost(s);
		const ctx = new SimCtx();
		let inside = 0;
		let outside = 0;
		for (let t = 0; t < 60 * 12; t++) {
			if (t === 60 * 8) {
				const b = firstOf(s, WARBANNER.id);
				if (b.alive === 1) ctx.bind(s, config, EMPTY_INPUT).killActor(b);
			}
			const expected = bruteAura(s);
			ctx.bind(s, config, EMPTY_INPUT);
			ctx.rebuildAura();
			for (let i = 0; i < s.combat.actors.size(); i++) {
				const o = s.combat.actors[i];
				if (ctx.inAura(o) !== expected[i]) expect([t, i, ctx.inAura(o)]).toEqual([t, i, expected[i]]);
				if (expected[i]) inside++;
				else if (o.alive === 1) outside++;
			}
			step(s, EMPTY_INPUT, config);
		}
		expect(inside).toBeGreaterThan(0);
		expect(outside).toBeGreaterThan(0);
	});
});

describe("warbanner: actorMods (the aura combined with the affix percent)", () => {
	it("plain 125 / 80; Swift 168.75 / 60, Hulking 106.25 / 80 (combinedPercent); outside: the affix percent itself", () => {
		const w = world(true);
		spawn(w, WARBANNER.id, 0, 20);
		const plain = spawn(w, SWARMER.id, 1, 20);
		const swift = spawn(w, SWARMER.id, -1, 20, AffixKind.SWIFT);
		const hulk = spawn(w, BRUISER.id, 0, 21, AffixKind.HULKING);
		const swiftFar = spawn(w, SWARMER.id, 0, 40, AffixKind.SWIFT);
		rebuild(w);
		const sw = AFFIX_RULES.swiftWalkPercent;
		const sc = AFFIX_RULES.swiftCooldownPercent;
		const hw = AFFIX_RULES.hulkingWalkPercent;
		expect([actorWalkPercent(w.ctx, plain), actorCooldownPercent(w.ctx, plain)]).toEqual([125, 80]);
		expect([actorWalkPercent(w.ctx, swift), actorCooldownPercent(w.ctx, swift)]).toEqual([
			combinedPercent(sw, 125),
			combinedPercent(sc, 80),
		]);
		expect([actorWalkPercent(w.ctx, swift), actorCooldownPercent(w.ctx, swift)]).toEqual([168.75, 60]);
		expect([actorWalkPercent(w.ctx, hulk), actorCooldownPercent(w.ctx, hulk)]).toEqual([106.25, 80]);
		expect([actorWalkPercent(w.ctx, swiftFar), actorCooldownPercent(w.ctx, swiftFar)]).toEqual([sw, sc]);
		expect(walkStep(w.ctx, swift)).toBe(scalePercent(SWARMER.data.speed * SIM_DT, 168.75));
		expect(walkStep(w.ctx, swift)).toBe((SWARMER.data.speed * SIM_DT * 168.75) / 100);
		// The cooldown stays one draw, then scaled by the integer percent.
		const twin = world(true);
		twin.s.rngState = w.s.rngState;
		for (let k = 0; k < 10; k++) {
			const got = enemyCooldown(w.ctx, swift, 60, 144);
			expect(got).toBe(scaleTicks(twin.ctx.randomInt(60, 144), 60));
			expect(w.s.rngState).toBe(twin.s.rngState);
		}
	});

	it("drives the live walk: a chasing bruiser steps 1.25x inside the aura, 1x once the banner died", () => {
		const config: SimConfig = {
			encounter: enc([
				{ kind: BRUISER.id, x: 0, z: 7.5 },
				{ kind: WARBANNER.id, x: 0, z: 11 },
			]),
		};
		const s = createSimState(3, 0, 0, config);
		ghost(s);
		const a = firstOf(s, BRUISER.id);
		const base = BRUISER.data.speed * SIM_DT;
		let fast = 0;
		let slow = 0;
		for (let t = 0; t < 120; t++) {
			if (t === 60) new SimCtx().bind(s, config, EMPTY_INPUT).killActor(firstOf(s, WARBANNER.id));
			const on = bruteAura(s)[s.combat.actors.indexOf(a)];
			const engagedBefore = a.aiState === STATE_ENGAGED;
			const x0 = a.x;
			const z0 = a.z;
			step(s, EMPTY_INPUT, config);
			if (!engagedBefore || a.aiState !== STATE_ENGAGED) continue;
			const moved = math.sqrt((a.x - x0) * (a.x - x0) + (a.z - z0) * (a.z - z0));
			const contactLeft = dist(a, s.player.x, s.player.z) > a.radius + 0.5;
			if (!contactLeft) continue;
			expect(moved).toBeCloseTo(on ? base * 1.25 : base, 9);
			if (on) fast++;
			else slow++;
		}
		expect(fast).toBeGreaterThan(0);
		expect(slow).toBeGreaterThan(0);
	});
});

describe("warbanner: telegraphs never change (EVD9)", () => {
	/** Every bruiser telegraph's length in ticks over `ticks`, with a banner glued 2 units beside it (or none). */
	function telegraphs(withBanner: boolean, ticks: number): { lengths: number[]; inAura: number } {
		const spawns: ActorSpawn[] = [{ kind: BRUISER.id, x: 0, z: 3 }];
		if (withBanner) spawns.push({ kind: WARBANNER.id, x: 2, z: 3 });
		const config: SimConfig = { encounter: enc(spawns) };
		const s = createSimState(11, 0, 0, config);
		ghost(s);
		const a = firstOf(s, BRUISER.id);
		const lengths: number[] = [];
		let run = 0;
		let inAura = 0;
		for (let t = 0; t < ticks; t++) {
			if (withBanner) {
				const b = firstOf(s, WARBANNER.id);
				b.x = a.x + 2;
				b.z = a.z;
				b.prevX = b.x;
				b.prevZ = b.z;
			}
			const on = bruteAura(s)[0];
			step(s, EMPTY_INPUT, config);
			if (a.aiState === AiState.TELEGRAPH) {
				if (run === 0 && on) inAura++;
				run++;
			} else if (run > 0) {
				lengths.push(run);
				run = 0;
			}
		}
		return { lengths, inAura };
	}

	it("a bruiser's slam telegraph lasts the same ticks inside the aura as without one (and slams come sooner)", () => {
		const buffed = telegraphs(true, 60 * 20);
		const plain = telegraphs(false, 60 * 20);
		expect(buffed.inAura).toBeGreaterThan(1);
		expect(plain.lengths.size()).toBeGreaterThan(1);
		const want = plain.lengths[0];
		for (const n of plain.lengths) expect(n).toBe(want);
		for (const n of buffed.lengths) expect(n).toBe(want);
		expect(want).toBe(BRUISER.data.telegraphTicks);
		expect(buffed.lengths.size()).toBeGreaterThan(plain.lengths.size());
	});
});

describe("warbanner: keep-away", () => {
	it("alone, it settles within keepMin-keepMax of the player", () => {
		const config: SimConfig = { encounter: enc([{ kind: WARBANNER.id, x: 0, z: 3.5 }]) };
		const s = createSimState(4, 0, 0, config);
		ghost(s);
		const a = firstOf(s, WARBANNER.id);
		for (let t = 0; t < 60 * 3; t++) step(s, EMPTY_INPUT, config);
		const d = dist(a, s.player.x, s.player.z);
		expect(d >= WARBANNER.data.keepMin - 0.1).toBe(true);
		expect(d <= WARBANNER.data.keepMax + 0.1).toBe(true);
		expect(a.aiState).toBe(WARBANNER_KEEP);
	});

	it("backs off from a living player inside keepMin", () => {
		const w = world();
		const a = spawn(w, WARBANNER.id, 0, 4);
		a.v[0] = 1; // engaged
		a.aiState = WARBANNER_KEEP;
		a.aiTicks = 1000;
		a.cooldown = 1000; // no panic
		w.s.tick += 1;
		const z0 = a.z;
		stepActors(w.ctx.bind(w.s, w.config, EMPTY_INPUT));
		expect(a.z > z0).toBe(true); // straight away from the player at the origin (no allies, strafe sideways)
	});

	it("with allies, it is pulled toward their centroid while keeping its band", () => {
		const run = (withAllies: boolean): { start: number; end: number; player: number } => {
			const spawns: ActorSpawn[] = [{ kind: WARBANNER.id, x: 6, z: 0 }];
			// Idle bruisers out of their aggro range of the player (8), never alerted (their alertRange from the banner).
			if (withAllies) spawns.push({ kind: BRUISER.id, x: 6, z: 8 }, { kind: BRUISER.id, x: 8, z: 8 });
			const config: SimConfig = { encounter: enc(spawns) };
			const s = createSimState(5, 0, 0, config);
			ghost(s);
			const a = firstOf(s, WARBANNER.id);
			const start = dist(a, 7, 8);
			for (let t = 0; t < 30; t++) step(s, EMPTY_INPUT, config);
			return { start, end: dist(a, 7, 8), player: dist(a, s.player.x, s.player.z) };
		};
		const pulled = run(true);
		const lone = run(false);
		expect(pulled.start - pulled.end).toBeGreaterThan(0.5);
		expect(pulled.start - pulled.end).toBeGreaterThan(lone.start - lone.end);
		expect(pulled.player >= WARBANNER.data.keepMin - 1e-9).toBe(true);
		expect(pulled.player <= WARBANNER.data.keepMax + 0.2).toBe(true);
	});
});

describe("warbanner: panic", () => {
	it("a player within 2.5 -> a 30-tick telegraph, the bruiser's gapped ring, then it backs off (latched)", () => {
		const config: SimConfig = { encounter: enc([{ kind: WARBANNER.id, x: 0, z: 2.2 }]) };
		const s = createSimState(2, 0, 0, config);
		ghost(s);
		const a = firstOf(s, WARBANNER.id);
		let teleTick = -1;
		let fireTick = -1;
		for (let t = 0; t < 60 * 3 && fireTick < 0; t++) {
			s.player.x = a.x;
			s.player.z = a.z - 2.2;
			s.player.prevX = s.player.x;
			s.player.prevZ = s.player.z;
			const before = s.combat.enemySpawned;
			step(s, EMPTY_INPUT, config);
			if (teleTick < 0 && a.aiState === AiState.TELEGRAPH) {
				teleTick = t;
				expect([a.attack, a.v[WARBANNER_PANIC]]).toEqual([WARBANNER_ATTACK_PANIC, 1]);
			}
			if (s.combat.enemySpawned > before) {
				fireTick = t;
				expect(s.combat.enemySpawned - before).toBe(BRUISER.data.ring.count);
			}
		}
		expect(teleTick).toBeGreaterThanOrEqual(0);
		expect(fireTick - teleTick).toBe(WARBANNER.data.panicTelegraphTicks);
		expect([a.aiState, a.v[WARBANNER_PANIC]]).toEqual([WARBANNER_BACKOFF, 1]);
		const p = s.player;
		const d0 = dist(a, p.x, p.z);
		for (let t = 0; t < WARBANNER.data.backoffTicks; t++) step(s, EMPTY_INPUT, config);
		const d1 = dist(a, p.x, p.z);
		expect(d1 - d0).toBeCloseTo(WARBANNER.data.backoffTicks * WARBANNER.data.speed * SIM_DT, 6);
		expect([a.aiState, a.v[WARBANNER_PANIC]]).toEqual([WARBANNER_KEEP, 0]);
	});

	it("never panics with the player outside panicRange", () => {
		const config: SimConfig = { encounter: enc([{ kind: WARBANNER.id, x: 0, z: 6 }]) };
		const s = createSimState(2, 0, 0, config);
		ghost(s);
		const a = firstOf(s, WARBANNER.id);
		for (let t = 0; t < 60 * 5; t++) {
			step(s, EMPTY_INPUT, config);
			expect(a.aiState === AiState.TELEGRAPH).toBe(false);
		}
		expect(s.combat.enemySpawned).toBe(0);
	});
});

describe("warbanner: determinism", () => {
	const config: SimConfig = {
		affixes: AFFIXES_CONFIG,
		encounter: enc([
			{ kind: WARBANNER.id, x: 0, z: 8 },
			{ kind: SWARMER.id, x: 2, z: 9 },
			{ kind: SWARMER.id, x: -2, z: 9 },
			{ kind: BRUISER.id, x: 1, z: 6 },
			{ kind: "sniper", x: -3, z: 10 },
		]),
	};
	const play = (): string[] => {
		const s = createSimState(4242, 0, 0, config);
		ghost(s);
		const hashes: string[] = [];
		for (let t = 0; t < 60 * 20; t++) {
			// The player strolls toward the banner every 4 s (panic range), then back to the origin.
			if (t % 240 === 120) {
				const b = firstOf(s, WARBANNER.id);
				s.player.x = b.x + 1;
				s.player.z = b.z - 1.5;
				s.player.prevX = s.player.x;
				s.player.prevZ = s.player.z;
			}
			step(s, EMPTY_INPUT, config);
			hashes.push(hashState(s));
		}
		return hashes;
	};

	it("two runs from the same seed give identical hashes every tick, and the outcome is pinned", () => {
		const one = play();
		const two = play();
		expect(one.size()).toBe(two.size());
		for (let t = 0; t < one.size(); t++) if (one[t] !== two[t]) expect([t, one[t]]).toEqual([t, two[t]]);
		expect(one[one.size() - 1]).toBe("b12b26d3");
	});
});
