// The Goldling on screen (docs/FORTUNE.md FO8): the frame's collected events from a real Goldling run (appear, hits,
// catch with its boosts' landing ticks, escape with the banked coins), the run views' wiring, the timer ring (its share
// read from the config's escapeTicks, whole pieces, the last seconds' pulse / colour, reduced motion: colour only), the
// body flicker, the ring's geometry, the catch's solo freeze and nudge, the jackpot's own pop, the boosts' hop, the
// minimap blip, the sprite input, the strings and the debug label.
import { describe, expect, it } from "@rbxts/jest-globals";
import { gridToWorld } from "shared/dungeon";
import { LiveRun } from "shared/play";
import { buildDevRunConfig, buildEndlessRunConfig } from "shared/run";
import {
	BreakableSource,
	EMPTY_INPUT,
	ENDLESS_GOLDEN_CONFIG,
	GOLDEN,
	GOLDEN_TICKS_LEFT,
	GoldenStatus,
	NO_BOOST,
	SIM_HZ,
	SimCtx,
	archetypeIndex,
	createSimState,
	damageBreakable,
	simWorldConfig,
	step,
	type ActorState,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { FORTUNE_STRING_KEYS, PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { defaultJuiceSettings } from "shared/settings";
import { ACTOR_SPRITE_INPUTS } from "../sprites";
import {
	GOLDEN_NOT_ON_GROUND,
	GOLDEN_STRINGS,
	GOLDEN_VIEW,
	GoldenFrameEvents,
	NO_GOLDEN_EVENTS,
	goldenBlipSlot,
	goldenBoostHopped,
	goldenCatchFreezeMs,
	goldenCatchNudges,
	goldenDebugText,
	goldenEscapeTicks,
	goldenEscapedText,
	goldenFlickerTransparency,
	goldenFrameHitCount,
	goldenKind,
	goldenRingColourMix,
	goldenRingLook,
	goldenRingRadius,
	goldenRingSegments,
	goldenShoutText,
	goldenSpriteInput,
	goldenTicksLeft,
	goldenTimeFill,
	isGoldenKind,
	jackpotPopMask,
	newGoldenRingLook,
	screenUpHeading,
} from ".";

/** The first (run seed, floor) from floor 2 whose floor rolled a Goldling (the sim spec's search). */
function findGoldenFloor(): [number, number] {
	for (let seed = 1; seed <= 60; seed++) {
		const setup = buildEndlessRunConfig(seed);
		for (let floor = 2; floor <= 4; floor++)
			if (setup.endlessFloor(floor).golden !== undefined) return [seed, floor];
	}
	error("no Goldling floor in run seeds 1-60, floors 2-4", 0);
}

const [SEED, FLOOR] = findGoldenFloor();

interface Run {
	readonly config: SimConfig;
	readonly s: SimState;
	readonly ev: GoldenFrameEvents;
}

/** A god-mode dev run of SEED from FLOOR (the dev world sets the Goldling's config). */
function devRun(): Run {
	const dev = buildDevRunConfig(SEED, { startFloor: FLOOR, invulnerable: true });
	expect(dev.config.golden).toBe(ENDLESS_GOLDEN_CONFIG);
	return {
		config: dev.config,
		s: createSimState(SEED, dev.spawn!.x, dev.spawn!.z, dev.config),
		ev: new GoldenFrameEvents(),
	};
}

/** One tick, its Goldling events collected (a frame of one tick). */
function tick(r: Run): void {
	r.ev.reset();
	step(r.s, EMPTY_INPUT, r.config);
	r.ev.collect(r.s);
}

/**
 * Player 0 into the Goldling room (a walk-mask cell near its middle), a few ticks (nothing collected while it hides),
 * then its piece broken open (docs/GOLDLING_RUMOURS.md GR2; test surgery, player 0's swing): out on the next tick.
 */
function untilOut(r: Run): ActorState {
	const f = r.s.golden!.floor!;
	let lx = math.floor(f.w / 2);
	const ly = math.floor(f.h / 2);
	while (f.walk[ly * f.w + lx] !== 1) lx = (lx + 1) % f.w;
	const p = r.s.player;
	p.x = gridToWorld(f.x0 + lx);
	p.z = gridToWorld(f.y0 + ly);
	p.prevX = p.x;
	p.prevZ = p.z;
	const g = r.s.golden!;
	for (let k = 0; k < 30; k++) {
		tick(r);
		expect(g.status).toBe(GoldenStatus.WAITING);
		expect(r.ev.count()).toBe(0);
	}
	damageBreakable(r.s, g.piece, r.s.breakables!.pieces[g.piece].hp, BreakableSource.MELEE, 0);
	tick(r);
	expect(g.status).toBe(GoldenStatus.RUNNING);
	return r.s.combat.actors[g.actorSlot];
}

function ctxOf(r: Run): SimCtx {
	return new SimCtx().bind(r.s, simWorldConfig(r.s, r.config), EMPTY_INPUT);
}

describe("Goldling view: the frame's events from a real run", () => {
	it("collects its appearance (spot, actor id, tick), each hit, and the catch with its boosts' landing ticks", () => {
		const r = devRun();
		expect(goldenBlipSlot(r.s)).toBe(-1);
		const a = untilOut(r);
		const g = r.s.golden!;
		expect(r.ev.appeared.size()).toBe(1);
		const ap = r.ev.appeared[0];
		expect([ap.x, ap.z, ap.actorId, ap.tick]).toEqual([a.x, a.z, a.id, r.s.tick]);
		expect(goldenBlipSlot(r.s)).toBe(g.actorSlot);
		expect(goldenTicksLeft(r.s, g.actorSlot)).toBe(a.v[GOLDEN_TICKS_LEFT]);

		// Two hits on one "frame": both collected, in order, with the ladder's hit count.
		r.ev.reset();
		const ctx = ctxOf(r);
		ctx.damageActor(a, 1);
		ctx.damageActor(a, 1);
		r.ev.collect(r.s);
		expect(r.ev.hits.map((h) => [h.hits, h.points])).toEqual([
			[1, g.events.hits[0].points],
			[2, g.events.hits[1].points],
		]);
		expect(goldenFrameHitCount(r.ev)).toBe(2);
		expect(r.ev.hits[0].points > 0).toBe(true);

		// The catch: the jackpot's points, every landed boost's slot with that slot's landing tick.
		r.ev.reset();
		ctxOf(r).killActor(a);
		r.ev.collect(r.s);
		expect(r.ev.caught.size()).toBe(1);
		const c = r.ev.caught[0];
		expect([c.points, c.lost, c.x, c.z]).toEqual([g.events.caught!.points, 0, a.x, a.z]);
		expect(c.points).toBe(g.events.jackpot);
		const d = r.s.drops!;
		expect(c.boosts.size()).toBe(g.events.caught!.boosts.size());
		expect(c.boosts.size() > 0).toBe(true);
		for (const b of c.boosts) {
			expect(d.ground[b.slot].kind).never.toBe(NO_BOOST);
			expect(b.spawnTick).toBe(d.ground[b.slot].spawnTick);
			expect(goldenBoostHopped(r.ev, b.slot, b.spawnTick)).toBe(true);
			expect(goldenBoostHopped(r.ev, b.slot, b.spawnTick + 1)).toBe(false);
			expect(goldenBoostHopped(NO_GOLDEN_EVENTS, b.slot, b.spawnTick)).toBe(false);
		}
		// The jackpot's kill pop is the frame's last pop: the mask takes exactly that one out of the kill layer.
		const se = r.s.score!.events;
		const pops: Array<{ x: number; z: number; points: number }> = [];
		pops.push({ x: c.x, z: c.z, points: c.points - 1 }); // another kill on the same spot, other points
		for (let i = 0; i < se.popPoints.size(); i++)
			pops.push({ x: se.popX[i], z: se.popZ[i], points: se.popPoints[i] });
		pops.push({ x: c.x, z: c.z, points: c.points }); // a second identical pop: one catch marks one pop
		const mask = jackpotPopMask(pops, r.ev.caught, []);
		const marked: number[] = [];
		for (let i = 0; i < mask.size(); i++) if (mask[i]) marked.push(i);
		expect(marked).toEqual([pops.size() - 2]);
		expect(jackpotPopMask(pops, [], []).every((m) => !m)).toBe(true);
		// Caught: no blip, no ring.
		expect(goldenBlipSlot(r.s)).toBe(-1);
		expect(goldenDebugText(r.s)).toBe(`CAUGHT coins ${g.coins} release ${g.releaseTick}`);
	});

	it("collects the escape with the floor's banked coins", () => {
		const r = devRun();
		const a = untilOut(r);
		const g = r.s.golden!;
		ctxOf(r).damageActor(a, 1);
		const coins = g.coins;
		expect(coins > 0).toBe(true);
		let escaped = false;
		for (let k = 0; k <= ENDLESS_GOLDEN_CONFIG.escapeTicks + 2 && !escaped; k++) {
			tick(r);
			escaped = r.ev.escaped.size() > 0;
		}
		expect(escaped).toBe(true);
		expect(g.status).toBe(GoldenStatus.ESCAPED);
		const e = r.ev.escaped[0];
		expect([e.coins, e.tick]).toEqual([coins, r.s.tick]);
		expect(goldenBlipSlot(r.s)).toBe(-1);
	});

	it("reset forgets the frame; NO_GOLDEN_EVENTS is empty; no state.golden: collect does nothing", () => {
		const ev = new GoldenFrameEvents();
		ev.hits.push({ x: 0, z: 0, player: 0, points: 1, hits: 1, tick: 1 });
		ev.skipped = 1;
		expect(ev.count()).toBe(2);
		ev.reset();
		expect(ev.count()).toBe(0);
		expect(new GoldenFrameEvents().count()).toBe(0);
		const s = createSimState(1, 0, 0);
		ev.collect(s);
		expect(ev.count()).toBe(0);
		expect(NO_GOLDEN_EVENTS.hits.size() + NO_GOLDEN_EVENTS.caught.size()).toBe(0);
		expect(GOLDEN_NOT_ON_GROUND).toBe(-1);
	});

	it("LiveRun.golden is collected per tick and reset per frame", () => {
		const e = buildEndlessRunConfig(SEED);
		const run = new LiveRun({
			seed: SEED,
			spawnX: e.spawn!.x,
			spawnZ: e.spawn!.z,
			config: e.config,
			atBossDoor: false,
		});
		expect(run.state.golden).never.toBe(undefined);
		expect(run.golden.count()).toBe(0);
		run.state.golden!.events.skipped = 1;
		run.golden.collect(run.state);
		expect(run.golden.count()).toBe(1);
		run.frame(1 / 30, EMPTY_INPUT);
		expect(run.golden.skipped).toBe(0);
	});
});

describe("Goldling view: the timer ring", () => {
	const escape = ENDLESS_GOLDEN_CONFIG.escapeTicks;
	const total = GOLDEN_VIEW.ring.pieces;
	const warnTicks = GOLDEN_VIEW.warn.warnSec * SIM_HZ;

	it("reads its share from the config's escapeTicks, whole pieces, none once out of time", () => {
		const look = newGoldenRingLook();
		expect(goldenRingLook(escape, escape, 0, false, look).pieces).toBe(total);
		expect(goldenRingLook(escape / 2, escape, 0, false, look).pieces).toBe(total / 2);
		// A longer escape (another config) halves the same ticks' share.
		expect(goldenRingLook(escape, escape * 2, 0, false, look).pieces).toBe(total / 2);
		expect(goldenRingLook(1, escape, 0, false, look).pieces).toBe(1);
		expect(goldenRingLook(0, escape, 0, false, look).pieces).toBe(0);
		let prev: number = total;
		for (let t = escape; t >= 1; t--) {
			const n = goldenRingLook(t, escape, 0, false, look).pieces;
			expect(n <= prev && n >= 1).toBe(true);
			prev = n;
		}
		expect(goldenTimeFill(escape * 2, escape)).toBe(1);
		expect(goldenTimeFill(5, 0)).toBe(0);
		const s = createSimState(1, 0, 0);
		expect(goldenEscapeTicks(s)).toBe(escape);
	});

	it("calm until the last warnSec; then it pulses and blinks toward the warning colour", () => {
		const look = newGoldenRingLook();
		goldenRingLook(warnTicks + 1, escape, 0.1, false, look);
		expect([look.radiusScale, look.colourStep]).toEqual([1, 0]);
		const scales = new Set<number>();
		const steps = new Set<number>();
		for (let k = 0; k < 20; k++) {
			goldenRingLook(warnTicks, escape, k * 0.03, false, look);
			expect(look.radiusScale >= 1 && look.radiusScale <= 1 + GOLDEN_VIEW.warn.pulseAmp + 1e-9).toBe(true);
			scales.add(look.radiusScale);
			steps.add(look.colourStep);
		}
		expect(scales.size() > 3).toBe(true);
		expect(steps.has(0) && steps.has(GOLDEN_VIEW.warn.colourSteps)).toBe(true);
	});

	it("reduced motion: colour only (no pulse), held at the full warning step", () => {
		const look = newGoldenRingLook();
		for (let k = 0; k < 10; k++) {
			goldenRingLook(warnTicks - k, escape, k * 0.05, true, look);
			expect([look.radiusScale, look.colourStep]).toEqual([1, GOLDEN_VIEW.warn.colourSteps]);
		}
		goldenRingLook(warnTicks + 1, escape, 0, true, look);
		expect(look.colourStep).toBe(0);
		expect(goldenRingColourMix(0)).toBe(0);
		expect(goldenRingColourMix(GOLDEN_VIEW.warn.colourSteps)).toBe(GOLDEN_VIEW.warn.warnMix);
		expect(goldenRingColourMix(99)).toBe(GOLDEN_VIEW.warn.warnMix);
	});

	it("the body flickers only in the last warnSec, never under reduced motion", () => {
		const W = GOLDEN_VIEW.warn;
		expect(goldenFlickerTransparency(warnTicks + 1, W.flickerSec * 0.75, false)).toBe(0);
		expect(goldenFlickerTransparency(warnTicks, W.flickerSec * 0.25, false)).toBe(0);
		expect(goldenFlickerTransparency(warnTicks, W.flickerSec * 0.75, false)).toBe(W.flickerTransparency);
		expect(goldenFlickerTransparency(warnTicks, W.flickerSec * 0.75, true)).toBe(0);
		expect(goldenFlickerTransparency(0, W.flickerSec * 0.75, false)).toBe(0);
	});

	it("lays its pieces on the circle, clockwise on screen from screen-up", () => {
		const segs: Array<[number, number, number, number]> = [];
		const sink = {
			seg(x0: number, z0: number, x1: number, z1: number) {
				segs.push([x0, z0, x1, z1]);
			},
		};
		const r = goldenRingRadius(GOLDEN.data.radius);
		expect(r).toBeCloseTo(GOLDEN.data.radius + GOLDEN_VIEW.ring.marginTiles, 12);
		goldenRingSegments(sink, 10, 20, r, 3, 12, screenUpHeading(0));
		expect(segs.size()).toBe(3);
		for (const [x0, z0, x1, z1] of segs) {
			expect(math.sqrt((x0 - 10) * (x0 - 10) + (z0 - 20) * (z0 - 20))).toBeCloseTo(r, 9);
			expect(math.sqrt((x1 - 10) * (x1 - 10) + (z1 - 20) * (z1 - 20))).toBeCloseTo(r, 9);
		}
		// Yaw 0: screen-up is -z, screen-right is +x. The first point is straight up-screen, the next one to its right.
		expect(segs[0][0]).toBeCloseTo(10, 9);
		expect(segs[0][1]).toBeCloseTo(20 - r, 9);
		expect(segs[0][2] > 10).toBe(true);
		// Consecutive pieces join.
		expect(segs[1][0]).toBeCloseTo(segs[0][2], 12);
		expect(segs[1][1]).toBeCloseTo(segs[0][3], 12);
		segs.clear();
		goldenRingSegments(sink, 0, 0, r, 99, 12);
		expect(segs.size()).toBe(12);
		segs.clear();
		goldenRingSegments(sink, 0, 0, 0, 5, 12);
		expect(segs.size()).toBe(0);
	});
});

describe("Goldling view: the catch, the pops, the strings, the debug label", () => {
	it("freezes only for the view player's own catch in a solo run with the freeze frame on; nudges the catcher only", () => {
		const on = defaultJuiceSettings();
		expect(goldenCatchFreezeMs(0, 0, 1, on)).toBe(GOLDEN_VIEW.catchFreezeMs);
		expect(GOLDEN_VIEW.catchFreezeMs).toBe(40);
		expect(goldenCatchFreezeMs(1, 0, 1, on)).toBe(0);
		expect(goldenCatchFreezeMs(0, 0, 2, on)).toBe(0);
		expect(goldenCatchFreezeMs(0, 0, 1, { ...on, freezeFrame: false })).toBe(0);
		expect(goldenCatchFreezeMs(0, 0, 1, { ...on, reducedMotion: true })).toBe(0);
		expect([goldenCatchNudges(0, 0), goldenCatchNudges(1, 0)]).toEqual([true, false]);
	});

	it("its strings are Fortune's, in the placeholder pack; the escape line carries the coins", () => {
		const warnings: string[] = [];
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: (m) => warnings.push(m) });
		const str = (k: string, v?: Readonly<Record<string, string | number>>) => pack.str(k, v);
		for (const key of [GOLDEN_STRINGS.shout, GOLDEN_STRINGS.escaped])
			expect(FORTUNE_STRING_KEYS.includes(key)).toBe(true);
		expect(goldenShoutText(str)).toBe("GOLDLING!");
		const line = goldenEscapedText(str, 350);
		expect(line.find("350", 1, true)[0] !== undefined).toBe(true);
		expect(warnings).toEqual([]);
	});

	it("KV_GoldenLabel: status, ticks left and hp while it runs; room, piece, rumour phase and release while it hides", () => {
		const r = devRun();
		expect(goldenDebugText(createSimState(1, 0, 0))).toBe(undefined);
		const h = r.s.golden!;
		expect(goldenDebugText(r.s)).toBe(`WAITING room ${h.room} piece ${h.piece} rumour FLOOR release -1`);
		const a = untilOut(r);
		const g = r.s.golden!;
		expect(goldenDebugText(r.s)).toBe(
			`RUNNING t ${a.v[GOLDEN_TICKS_LEFT]}/${g.config.escapeTicks} hp ${a.hp}/${a.hpMax} hits 0`,
		);
	});
});

describe("Goldling view: kind and sprite input", () => {
	it("goldenKind is the archetype's index; the sprite input is registered and plays idle / move / hit / death", () => {
		expect(goldenKind()).toBe(archetypeIndex("golden"));
		expect(isGoldenKind(goldenKind())).toBe(true);
		expect(isGoldenKind(-1)).toBe(false);
		expect(ACTOR_SPRITE_INPUTS.get("golden")).toBe(goldenSpriteInput);
		expect(GOLDEN.data.spriteId).toBe("enemy.golden");
		const a = {
			alive: 1,
			deadTicks: 0,
			flashTicks: 3,
			x: 1,
			z: 0,
			prevX: 0.9,
			prevZ: 0,
		} as unknown as ActorState;
		const input = goldenSpriteInput(a, 0.5);
		expect([input.alive, input.flashTicks, input.attack, input.refSpeed, input.alpha]).toEqual([
			true,
			3,
			undefined,
			GOLDEN.data.speed,
			0.5,
		]);
		expect(input.speed).toBeCloseTo(0.1 * SIM_HZ, 9);
	});
});
