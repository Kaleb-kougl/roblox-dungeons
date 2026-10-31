// The build effects director (docs/BUILDS.md BU8): beam timing and jag, spark bursts (cap, view player first,
// particles off, Reduced's halved shape), nova rings, the evolve / duo flare on the knight, execute flashes, the
// trails rule, the generation pitch, quiet and new-run resets.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BUILDS_CONFIG, SIM_DT, SPARK_BEAM_TICKS, createSimState, type SimState } from "shared/sim";
import { defaultJuiceSettings, type BuildFxLevel, type JuiceSettings } from "shared/settings";
import { semitonesToSpeed } from "../hud/comboConfig";
import { BUILD_FX_VIEW } from "./buildFxConfig";
import { BuildFxEvents } from "./buildFxEvents";
import {
	BEAM_SEC,
	BuildFxDirector,
	beamFade,
	beamJag,
	beamJagEpoch,
	buildFxCount,
	buildGenSemitones,
	buildGenSpeed,
	buildTrailsOn,
	executePop,
	lifeFade,
	ringRadius,
	sparkBurstShape,
	type BeamPoint,
} from "./buildFxRules";

const SEED = 9;

function state(players = 1): SimState {
	return createSimState(
		SEED,
		0,
		0,
		players > 1 ? { builds: BUILDS_CONFIG, party: { size: players } } : { builds: BUILDS_CONFIG },
	);
}

function settings(buildFx: BuildFxLevel = "full", juice: Partial<JuiceSettings> = {}) {
	return { juice: { ...defaultJuiceSettings(), ...juice }, buildFx };
}

/** A frame source with `hops` sparks (owner per entry) at tick `tick`. */
function sparks(owners: ReadonlyArray<number>, tick = 1, gen = 0): BuildFxEvents {
	const s = state(4);
	const e = s.builds!.events;
	owners.forEach((o, i) => {
		e.sparkX1.push(i);
		e.sparkZ1.push(0);
		e.sparkX2.push(i + 2);
		e.sparkZ2.push(1);
		e.sparkOwner.push(o);
		e.sparkGen.push(gen);
	});
	s.tick = tick;
	const ev = new BuildFxEvents();
	ev.collect(s);
	return ev;
}

const EMPTY = new BuildFxEvents();

describe("buildFx rules: beams", () => {
	it("a beam lives the sim's SPARK_BEAM_TICKS (0.12 s), opaque for its hold, then fades to 0", () => {
		expect(BEAM_SEC).toBe(SPARK_BEAM_TICKS * SIM_DT);
		expect(BEAM_SEC).toBeCloseTo(0.12, 1);
		const hold = BEAM_SEC * BUILD_FX_VIEW.beam.hold;
		expect(beamFade(0)).toBe(1);
		expect(beamFade(hold)).toBe(1);
		expect(beamFade((hold + BEAM_SEC) / 2)).toBeCloseTo(0.5, 9);
		expect(beamFade(BEAM_SEC)).toBe(0);
	});

	it("the jag keeps the ends exact and every joint within jagTiles (and jagShare of the hop) of the line", () => {
		const out: BeamPoint[] = [];
		beamJag(0, 0, 10, 0, 123, out);
		const n = BUILD_FX_VIEW.beam.segments;
		expect(out.size()).toBe(n + 1);
		expect([out[0].x, out[0].z, out[n].x, out[n].z]).toEqual([0, 0, 10, 0]);
		for (let i = 1; i < n; i++) {
			expect(out[i].x).toBeCloseTo((10 * i) / n, 9);
			expect(math.abs(out[i].z) <= BUILD_FX_VIEW.beam.jagTiles).toBe(true);
		}
		const short: BeamPoint[] = [];
		beamJag(0, 0, 0, 0.5, 7, short);
		for (const p of short) expect(math.abs(p.x) <= BUILD_FX_VIEW.beam.jagShare * 0.5 + 1e-12).toBe(true);
		const flat: BeamPoint[] = [];
		beamJag(3, 3, 3, 3, 7, flat);
		for (const p of flat) expect([p.x, p.z]).toEqual([3, 3]);
		// Same seed, same jag.
		const again: BeamPoint[] = [];
		beamJag(0, 0, 10, 0, 123, again);
		for (let i = 0; i <= n; i++) expect(again[i].z).toBe(out[i].z);
	});

	it("the jag re-rolls every rejagSec, never under reduced motion", () => {
		const r = BUILD_FX_VIEW.beam.rejagSec;
		expect([beamJagEpoch(0, false), beamJagEpoch(r * 0.99, false), beamJagEpoch(r * 1.01, false)]).toEqual([
			0, 0, 1,
		]);
		expect(beamJagEpoch(r * 2.5, true)).toBe(0);
	});

	it("the director keeps a beam until BEAM_SEC, caps the live beams (oldest replaced) and drops outsiders", () => {
		const d = new BuildFxDirector();
		const s = state(4);
		d.frame(sparks([0, 1, 9]), s, 0, false, settings(), 10);
		expect(d.out.beams.size()).toBe(2);
		expect(d.out.beams.map((b) => [b.owner, b.fade, b.points.size()])).toEqual([
			[0, 1, BUILD_FX_VIEW.beam.segments + 1],
			[1, 1, BUILD_FX_VIEW.beam.segments + 1],
		]);
		d.frame(EMPTY, s, 0, false, settings(), 10 + BEAM_SEC * 0.9);
		expect(d.out.beams.size()).toBe(2);
		expect(d.out.beams[0].fade < 1).toBe(true);
		d.frame(EMPTY, s, 0, false, settings(), 10 + BEAM_SEC);
		expect(d.out.beams.size()).toBe(0);
		const many: number[] = [];
		for (let i = 0; i < BUILD_FX_VIEW.beam.maxAlive + 5; i++) many.push(0);
		d.frame(sparks(many, 2), s, 0, false, settings(), 20);
		expect(d.out.beams.size()).toBe(BUILD_FX_VIEW.beam.maxAlive);
	});
});

describe("buildFx rules: spark bursts and the Reduced setting", () => {
	it("one burst per new hop at its target, the view player's first, at most perFrame", () => {
		const d = new BuildFxDirector();
		const s = state(4);
		const owners: number[] = [];
		for (let i = 0; i < BUILD_FX_VIEW.sparkBurst.perFrame; i++) owners.push(1);
		owners.push(0);
		d.frame(sparks(owners), s, 0, false, settings(), 1);
		const out = d.out.sparkBursts;
		expect(out.size()).toBe(BUILD_FX_VIEW.sparkBurst.perFrame);
		expect([out[0].owner, out[0].x, out[0].z]).toEqual([0, owners.size() - 1 + 2, 1]);
		// Next frame: no new hops, no bursts (the beams still live).
		d.frame(EMPTY, s, 0, false, settings(), 1.01);
		expect(d.out.sparkBursts.size()).toBe(0);
	});

	it("no bursts with particles off; Reduced halves every count of the shape", () => {
		const d = new BuildFxDirector();
		const s = state();
		d.frame(sparks([0]), s, 0, false, settings("full", { particles: "off" }), 1);
		expect(d.out.sparkBursts.size()).toBe(0);
		expect(d.out.beams.size()).toBe(1);
		const full = sparkBurstShape("full");
		const reduced = sparkBurstShape("reduced");
		const sb = BUILD_FX_VIEW.sparkBurst;
		expect([full.bits, full.sparks, full.chunks]).toEqual([sb.bits, sb.sparks, sb.chunks]);
		expect([reduced.bits, reduced.sparks, reduced.chunks]).toEqual([sb.bits / 2, sb.sparks / 2, 0]);
		d.frame(EMPTY, s, 0, false, settings("reduced"), 2);
		expect(d.out.burstShape.sparks).toBe(sb.sparks / 2);
		expect([buildFxCount(24, "reduced"), buildFxCount(1, "reduced"), buildFxCount(0, "reduced")]).toEqual([
			12, 1, 0,
		]);
		expect(buildFxCount(24, "full")).toBe(24);
	});

	it("trails only with Full and not reduced motion", () => {
		expect([buildTrailsOn("full", false), buildTrailsOn("reduced", false), buildTrailsOn("full", true)]).toEqual([
			true,
			false,
			false,
		]);
		const d = new BuildFxDirector();
		d.frame(EMPTY, state(), 0, false, settings("reduced"), 1);
		expect(d.out.trails).toBe(false);
		d.frame(EMPTY, state(), 0, false, settings("full", { reducedMotion: true }), 1);
		expect(d.out.trails).toBe(false);
	});
});

describe("buildFx rules: rings, flares, flashes", () => {
	it("ring radius eases out to its end (at once under reduced motion); lifeFade fades the last share", () => {
		expect(ringRadius(0, 1, 0, 3, false)).toBe(0);
		expect(ringRadius(0.5, 1, 0, 3, false)).toBeCloseTo(2.25, 9);
		expect(ringRadius(1, 1, 0, 3, false)).toBe(3);
		expect(ringRadius(0, 1, 0, 3, true)).toBe(3);
		expect([lifeFade(0, 1, 0.5), lifeFade(0.5, 1, 0.5), lifeFade(0.75, 1, 0.5), lifeFade(1, 1, 0.5)]).toEqual([
			1, 1, 0.5, 0,
		]);
		expect(executePop(0, false)).toBe(BUILD_FX_VIEW.execute.popScale);
		expect(executePop(0, true)).toBe(1);
		expect(executePop(BUILD_FX_VIEW.execute.popSec, false)).toBe(1);
	});

	it("a nova expands to its radius over nova.sec (Reduced halves its segments); an execute flashes", () => {
		const s = state();
		const ev = new BuildFxEvents();
		const e = s.builds!.events as unknown as Record<string, number[]>;
		e.novaX = [1];
		e.novaZ = [2];
		e.novaRadius = [3];
		e.novaOwner = [0];
		e.novaKind = [0];
		e.execX = [5];
		e.execZ = [6];
		s.tick = 1;
		ev.collect(s);
		const d = new BuildFxDirector();
		const nv = BUILD_FX_VIEW.nova;
		d.frame(ev, s, 0, false, settings("reduced"), 1);
		expect(d.out.rings.map((r) => [r.x, r.z, r.radius, r.flare, r.segments, r.role])).toEqual([
			[1, 2, 0, false, nv.segments / 2, nv.fallback.role],
		]);
		expect(d.out.flashes.map((f) => [f.x, f.z, f.scale])).toEqual([[5, 6, BUILD_FX_VIEW.execute.popScale]]);
		d.frame(EMPTY, s, 0, false, settings(), 1 + nv.sec / 2);
		expect(d.out.rings[0].radius).toBeCloseTo(ringRadius(nv.sec / 2, nv.sec, 0, 3, false), 9);
		d.frame(EMPTY, s, 0, false, settings(), 1 + nv.sec);
		expect(d.out.rings.size()).toBe(0);
		expect(d.out.flashes.size()).toBe(0);
	});

	it("an evolve / duo flare rings the taking player (current position) in the card's role, 1 s; dead: gone", () => {
		const s = state(2);
		const e = s.builds!.events;
		e.evolvedPlayer.push(1);
		e.evolvedBoon.push(0);
		s.tick = 1;
		const ev = new BuildFxEvents();
		ev.collect(s);
		const d = new BuildFxDirector();
		const f = BUILD_FX_VIEW.flare;
		d.frame(ev, s, 0, false, settings(), 5);
		expect(d.out.rings.map((r) => [r.flare, r.role, r.radius, r.segments])).toEqual([
			[true, f.evolvedRole, f.r0Tiles, f.segments],
		]);
		const p1 = s.party!.players[1];
		p1.x = 7;
		p1.z = -3;
		d.frame(EMPTY, s, 0, false, settings(), 5 + f.sec / 2);
		expect([d.out.rings[0].x, d.out.rings[0].z]).toEqual([7, -3]);
		// A duo taken by the same player replaces the flare (its role).
		const e2 = new BuildFxEvents();
		s.builds!.events.evolvedPlayer.clear();
		s.builds!.events.evolvedBoon.clear();
		s.builds!.events.duoPlayer.push(1);
		s.builds!.events.duoTaken.push(0);
		s.tick = 2;
		e2.collect(s);
		d.frame(e2, s, 0, false, settings(), 5.6);
		expect(d.out.rings.map((r) => r.role)).toEqual([f.duoRole]);
		p1.dead = 1;
		d.frame(EMPTY, s, 0, false, settings(), 5.7);
		expect(d.out.rings.size()).toBe(0);
	});
});

describe("buildFx rules: gates and the generation pitch", () => {
	it("quiet puts nothing out and forgets what was alive; a new run forgets too", () => {
		const d = new BuildFxDirector();
		const s = state();
		d.frame(sparks([0]), s, 0, false, settings(), 1);
		expect(d.out.beams.size()).toBe(1);
		d.frame(sparks([0]), s, 0, true, settings(), 1.01);
		expect([d.out.beams.size(), d.out.sparkBursts.size()]).toEqual([0, 0]);
		d.frame(EMPTY, s, 0, false, settings(), 1.02);
		expect(d.out.beams.size()).toBe(0);
		d.frame(sparks([0]), s, 0, false, settings(), 2);
		expect(d.out.beams.size()).toBe(1);
		d.frame(EMPTY, state(), 0, false, settings(), 2.01);
		expect(d.out.beams.size()).toBe(0);
	});

	it("a build cue climbs semitoneStep per proc generation, capped at maxSemitones", () => {
		const a = BUILD_FX_VIEW.audio;
		expect([buildGenSemitones(0), buildGenSemitones(1), buildGenSemitones(2)]).toEqual([
			0,
			a.semitoneStep,
			2 * a.semitoneStep,
		]);
		expect(buildGenSemitones(10)).toBe(a.maxSemitones);
		expect(buildGenSpeed(0)).toBe(1);
		expect(buildGenSpeed(1)).toBe(semitonesToSpeed(a.semitoneStep));
	});
});
