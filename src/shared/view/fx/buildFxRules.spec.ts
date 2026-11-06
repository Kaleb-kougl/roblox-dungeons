// The build effects director (docs/BUILDS.md BU8 and its follow-up): beam timing and jag, forks, spark bursts and
// Phantom Step erase sparks (cap, view player first, particles off, Reduced's halved shape), nova rings per kind,
// origin flares (Momentum / Thrill Seeker / Flurry / Ricochet), the evolve / duo flare and the Lionheart pulse on the
// knight, execute flashes, the trails rule, reduced motion, the generation pitch, quiet and new-run resets; BU6: duo
// proc origin flares in boon.duo (their sparks only as the ordinary beams) and Unshaken's shield glint;
// docs/LEGENDARIES.md LG6: Overkill streaks (timeline, thickness by carry, core, Skewer, Reduced, impact flashes, cap)
// and Bastion's brace ring (crack, faint SPENT, Stone Heart's heal pulse, the frame's braces list).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BUILDS_CONFIG,
	BraceKind,
	Duo,
	FlurryKind,
	NovaKind,
	OVERFLOWING_NOVA_RADIUS,
	OVERKILL_RANGE,
	SIM_DT,
	SPARK_BEAM_TICKS,
	clearBuildEvents,
	createSimState,
	type BuildEvents,
	type SimState,
} from "shared/sim";
import { defaultJuiceSettings, type BuildFxLevel, type JuiceSettings } from "shared/settings";
import { semitonesToSpeed } from "../hud/comboConfig";
import { BUILD_FX_VIEW } from "./buildFxConfig";
import { BuildFxEvents } from "./buildFxEvents";
import {
	BEAM_SEC,
	BuildFxDirector,
	beamFade,
	braceChordShare,
	braceRingStrength,
	beamJag,
	beamJagEpoch,
	buildFxCount,
	buildGenSemitones,
	buildGenSpeed,
	buildTrailsOn,
	executePop,
	impactPop,
	buildRingBlock,
	lifeFade,
	momentumPopTiles,
	novaRole,
	phantomBurstShape,
	ringRadius,
	sparkBurstShape,
	skewerLineEnd,
	streakFade,
	streakThickness,
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

	it("a nova expands to its radius over nova.sec in its kind's role (Reduced halves its segments); an execute flashes", () => {
		const s = state();
		const e = s.builds!.events;
		e.novaX.push(1);
		e.novaZ.push(2);
		e.novaRadius.push(OVERFLOWING_NOVA_RADIUS);
		e.novaOwner.push(0);
		e.novaKind.push(NovaKind.OVERFLOWING);
		e.novaErased.push(0);
		e.execX.push(5, 9);
		e.execZ.push(6, 9);
		e.execOwner.push(0, 3); // the second's owner is outside the party: ignored
		s.tick = 1;
		const ev = new BuildFxEvents();
		ev.collect(s);
		const d = new BuildFxDirector();
		const nv = BUILD_FX_VIEW.nova;
		d.frame(ev, s, 0, false, settings("reduced"), 1);
		expect(d.out.rings.map((r) => [r.x, r.z, r.radius, r.look, r.segments, r.role])).toEqual([
			[1, 2, 0, "nova", nv.segments / 2, "fx.heal"],
		]);
		expect(d.out.flashes.map((f) => [f.x, f.z, f.scale])).toEqual([[5, 6, BUILD_FX_VIEW.execute.popScale]]);
		d.frame(EMPTY, s, 0, false, settings(), 1 + nv.sec / 2);
		expect(d.out.rings[0].radius).toBeCloseTo(ringRadius(nv.sec / 2, nv.sec, 0, OVERFLOWING_NOVA_RADIUS, false), 9);
		d.frame(EMPTY, s, 0, false, settings(), 1 + nv.sec);
		expect(d.out.rings.size()).toBe(0);
		expect(d.out.flashes.size()).toBe(0);
	});

	it("nova looks: Overflowing in fx.heal, Bulwark in build.spark, any other kind the fallback", () => {
		expect([novaRole(NovaKind.OVERFLOWING), novaRole(NovaKind.BULWARK), novaRole(9)]).toEqual([
			"fx.heal",
			"build.spark",
			BUILD_FX_VIEW.nova.fallback.role,
		]);
		expect(BUILD_FX_VIEW.nova.looks.size()).toBe(2);
		// Every ring look has its own drawing block.
		for (const look of ["nova", "flare", "heal", "pop", "glint"] as const)
			expect(buildRingBlock(look)).toBe(BUILD_FX_VIEW[look]);
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
		expect(d.out.rings.map((r) => [r.look, r.role, r.radius, r.segments])).toEqual([
			["flare", f.evolvedRole, f.r0Tiles, f.segments],
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

/** A frame source from hand-pushed BU5 entries (one tick; `fill` pushes into the state's BuildEvents). */
function bu5(s: SimState, fill: (e: BuildEvents) => void, tick = 1): BuildFxEvents {
	clearBuildEvents(s.builds!);
	fill(s.builds!.events);
	s.tick = tick;
	const ev = new BuildFxEvents();
	ev.collect(s);
	return ev;
}

describe("buildFx rules: the evolutions (BU8 follow-up)", () => {
	it("a Storm Crown fork's beam is flagged (drawn thinner), a hop's is not", () => {
		const s = state();
		const ev = bu5(s, (e) => {
			e.sparkX1.push(0, 0);
			e.sparkZ1.push(0, 0);
			e.sparkX2.push(1, 0);
			e.sparkZ2.push(0, 1);
			e.sparkOwner.push(0, 0);
			e.sparkGen.push(0, 0);
			e.sparkFork.push(0, 1);
		});
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings(), 1);
		expect(d.out.beams.map((b) => b.fork)).toEqual([false, true]);
		expect(BUILD_FX_VIEW.beam.forkThicknessShare < 1).toBe(true);
	});

	it("origin flares: Momentum (by tier), Thrill Seeker, Flurry and Ricochet pop a small ring where they left", () => {
		const s = state(2);
		const ev = bu5(s, (e) => {
			e.momentumX.push(1);
			e.momentumZ.push(1);
			e.momentumOwner.push(0);
			e.momentumTier.push(4);
			e.momentumFired.push(4);
			e.thrillX.push(2);
			e.thrillZ.push(2);
			e.thrillOwner.push(1);
			e.thrillFired.push(8);
			e.flurryX.push(3);
			e.flurryZ.push(3);
			e.flurryOwner.push(0);
			e.flurryKind.push(FlurryKind.CRESCENT);
			e.flurryFired.push(5);
			e.ricochetX.push(4);
			e.ricochetZ.push(4);
			e.ricochetOwner.push(5); // outside the party: ignored
			e.ricochetFired.push(2);
		});
		const p = BUILD_FX_VIEW.pop;
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings(), 1);
		expect(d.out.rings.map((r) => [r.look, r.x, r.z, r.radius, r.role, r.segments])).toEqual([
			["pop", 1, 1, p.r0Tiles, p.momentumRole, p.segments],
			["pop", 2, 2, p.r0Tiles, p.thrillRole, p.segments],
			["pop", 3, 3, p.r0Tiles, p.flurryRole, p.segments],
		]);
		expect(momentumPopTiles(2)).toBe(p.r1Tiles);
		expect(momentumPopTiles(4)).toBeCloseTo(p.r1Tiles + 2 * p.tierTiles, 9);
		// It grows to its end radius (Momentum's by tier) and stays put; gone after pop.sec.
		d.frame(EMPTY, s, 0, false, settings(), 1 + p.sec * 0.999);
		expect(d.out.rings[0].radius).toBeCloseTo(momentumPopTiles(4), 2);
		expect(d.out.rings[1].radius).toBeCloseTo(p.r1Tiles, 2);
		expect([d.out.rings[0].x, d.out.rings[0].z]).toEqual([1, 1]);
		d.frame(EMPTY, s, 0, false, settings(), 1 + p.sec);
		expect(d.out.rings.size()).toBe(0);
	});

	it("origin flares cap at pop.maxAlive (oldest replaced) and never evict a flare on the knight", () => {
		const s = state();
		const d = new BuildFxDirector();
		const evolve = bu5(s, (e) => {
			e.evolvedPlayer.push(0);
			e.evolvedBoon.push(0);
		});
		d.frame(evolve, s, 0, false, settings(), 1);
		const many = bu5(
			s,
			(e) => {
				for (let i = 0; i < BUILD_FX_VIEW.pop.maxAlive + 3; i++) {
					e.thrillX.push(i);
					e.thrillZ.push(0);
					e.thrillOwner.push(0);
					e.thrillFired.push(8);
				}
			},
			2,
		);
		d.frame(many, s, 0, false, settings(), 1.01);
		const pops = d.out.rings.filter((r) => r.look === "pop");
		expect(pops.size()).toBe(BUILD_FX_VIEW.pop.maxAlive);
		expect(pops[0].x).toBe(3);
		expect(d.out.rings.filter((r) => r.look === "flare").size()).toBe(1);
	});

	it("Lionheart: a heal pulse rings the healed player in heal.role, follows them, ends on death", () => {
		const s = state(2);
		const ev = bu5(s, (e) => {
			e.lionPlayer.push(1);
			e.lionHealed.push(1);
		});
		const h = BUILD_FX_VIEW.heal;
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings("reduced"), 3);
		expect(d.out.rings.map((r) => [r.look, r.role, r.radius, r.segments])).toEqual([
			["heal", h.role, h.r0Tiles, h.segments / 2],
		]);
		expect(h.role).toBe("fx.heal");
		const p1 = s.party!.players[1];
		p1.x = -4;
		p1.z = 6;
		d.frame(EMPTY, s, 0, false, settings(), 3 + h.sec / 2);
		expect([d.out.rings[0].x, d.out.rings[0].z]).toEqual([-4, 6]);
		p1.dead = 1;
		d.frame(EMPTY, s, 0, false, settings(), 3 + h.sec / 2 + 0.01);
		expect(d.out.rings.size()).toBe(0);
	});

	it("reduced motion: every ring sits at its end radius and only fades; the execute does not pop", () => {
		const s = state();
		const ev = bu5(s, (e) => {
			e.novaX.push(0);
			e.novaZ.push(0);
			e.novaRadius.push(2.5);
			e.novaOwner.push(0);
			e.novaKind.push(NovaKind.BULWARK);
			e.novaErased.push(3);
			e.flurryX.push(1);
			e.flurryZ.push(1);
			e.flurryOwner.push(0);
			e.flurryKind.push(FlurryKind.ARROWS);
			e.flurryFired.push(3);
			e.lionPlayer.push(0);
			e.lionHealed.push(1);
			e.execX.push(2);
			e.execZ.push(2);
			e.execOwner.push(0);
		});
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings("full", { reducedMotion: true }), 1);
		expect(d.out.rings.map((r) => [r.look, r.radius, r.fade, r.role])).toEqual([
			["nova", 2.5, 1, "build.spark"],
			["pop", BUILD_FX_VIEW.pop.r1Tiles, 1, BUILD_FX_VIEW.pop.flurryRole],
			["heal", BUILD_FX_VIEW.heal.r1Tiles, 1, "fx.heal"],
		]);
		expect(d.out.flashes.map((f) => f.scale)).toEqual([1]);
	});

	it("Phantom Step erase sparks: one chip burst per erase, the view player's first, capped; none with particles off", () => {
		const s = state(2);
		const ph = BUILD_FX_VIEW.phantom;
		const ev = bu5(s, (e) => {
			for (let i = 0; i < ph.perFrame; i++) {
				e.phantomX.push(i);
				e.phantomZ.push(0);
				e.phantomOwner.push(1);
			}
			e.phantomX.push(99);
			e.phantomZ.push(7);
			e.phantomOwner.push(0);
		});
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings(), 1);
		const out = d.out.phantomBursts;
		expect(out.size()).toBe(ph.perFrame);
		expect([out[0].x, out[0].z, out[0].owner]).toEqual([99, 7, 0]);
		expect(d.out.phantomShape.sparks).toBe(ph.sparks);
		d.frame(EMPTY, s, 0, false, settings(), 1.01);
		expect(d.out.phantomBursts.size()).toBe(0);
		const off = new BuildFxDirector();
		off.frame(ev, s, 0, false, settings("full", { particles: "off" }), 1);
		expect(off.out.phantomBursts.size()).toBe(0);
		const reduced = phantomBurstShape("reduced");
		expect([reduced.bits, reduced.sparks]).toEqual([
			buildFxCount(ph.bits, "reduced"),
			buildFxCount(ph.sparks, "reduced"),
		]);
		const r = new BuildFxDirector();
		r.frame(ev, s, 0, false, settings("reduced"), 1);
		expect(r.out.phantomShape.sparks).toBe(reduced.sparks);
	});

	it("quiet forgets every ring kind and puts out no phantom sparks", () => {
		const s = state();
		const ev = bu5(s, (e) => {
			e.momentumX.push(0);
			e.momentumZ.push(0);
			e.momentumOwner.push(0);
			e.momentumTier.push(2);
			e.momentumFired.push(2);
			e.phantomX.push(0);
			e.phantomZ.push(0);
			e.phantomOwner.push(0);
			e.lionPlayer.push(0);
			e.lionHealed.push(1);
		});
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, true, settings(), 1);
		expect([d.out.rings.size(), d.out.phantomBursts.size()]).toEqual([0, 0]);
		d.frame(ev, s, 0, false, settings(), 1.01);
		expect([d.out.rings.size(), d.out.phantomBursts.size()]).toEqual([2, 1]);
		d.frame(EMPTY, s, 0, true, settings(), 1.02);
		d.frame(EMPTY, s, 0, false, settings(), 1.03);
		expect(d.out.rings.size()).toBe(0);
	});
});

/** Pushes one duoProc entry (as the sim's pushDuoProc does). */
function duoProc(e: BuildEvents, duo: number, owner: number, x: number, z: number, value: number): void {
	e.duoProcDuo.push(duo);
	e.duoProcOwner.push(owner);
	e.duoProcX.push(x);
	e.duoProcZ.push(z);
	e.duoProcValue.push(value);
}

describe("buildFx rules: the duos (BU6 view)", () => {
	it("Storm Blade / Conductor / Chain Reaction / Close Call pop an origin flare in pop.duoRole; Gold Rush and Unshaken do not", () => {
		const s = state(2);
		const ev = bu5(s, (e) => {
			duoProc(e, Duo.STORM_BLADE, 0, 1, 1, 2);
			duoProc(e, Duo.CONDUCTOR, 1, 2, 2, 1);
			duoProc(e, Duo.CHAIN_REACTION, 0, 3, 3, 12);
			duoProc(e, Duo.CLOSE_CALL, 1, 4, 4, 1);
			duoProc(e, Duo.GOLD_RUSH, 0, 5, 5, 206);
			duoProc(e, Duo.CONDUCTOR, 7, 6, 6, 1); // outside the party: ignored
		});
		const p = BUILD_FX_VIEW.pop;
		expect(p.duoRole).toBe("boon.duo");
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings(), 1);
		expect(d.out.rings.map((r) => [r.look, r.x, r.z, r.radius, r.role, r.segments])).toEqual([
			["pop", 1, 1, p.r0Tiles, p.duoRole, p.segments],
			["pop", 2, 2, p.r0Tiles, p.duoRole, p.segments],
			["pop", 3, 3, p.r0Tiles, p.duoRole, p.segments],
			["pop", 4, 4, p.r0Tiles, p.duoRole, p.segments],
		]);
		// No beam of their own: a duo spark's beam is its ordinary spark segment.
		expect(d.out.beams.size()).toBe(0);
		// Reduced halves the segments; reduced motion draws the end radius.
		const r = new BuildFxDirector();
		r.frame(ev, s, 0, false, settings("reduced", { reducedMotion: true }), 1);
		expect(r.out.rings.map((g) => [g.radius, g.segments])[0]).toEqual([
			p.r1Tiles,
			buildFxCount(p.segments, "reduced"),
		]);
	});

	it("a duo spark draws one beam (its spark segment) and one flare at its origin, never a second beam", () => {
		const s = state();
		const ev = bu5(s, (e) => {
			e.sparkX1.push(1);
			e.sparkZ1.push(2);
			e.sparkX2.push(3);
			e.sparkZ2.push(2);
			e.sparkOwner.push(0);
			e.sparkGen.push(0);
			e.sparkFork.push(0);
			duoProc(e, Duo.CONDUCTOR, 0, 1, 2, 1);
		});
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings(), 1);
		expect(d.out.beams.size()).toBe(1);
		expect(d.out.sparkBursts.map((b) => [b.x, b.z])).toEqual([[3, 2]]);
		expect(d.out.rings.map((r) => [r.look, r.x, r.z])).toEqual([["pop", 1, 2]]);
	});

	it("Unshaken: a shield glint closes in on the hit player in glint.role, follows them, a newer one replaces it", () => {
		const s = state(2);
		const g = BUILD_FX_VIEW.glint;
		const ev = bu5(s, (e) => duoProc(e, Duo.UNSHAKEN, 1, 0, 0, 1));
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings(), 2);
		expect(d.out.rings.map((r) => [r.look, r.role, r.radius, r.segments])).toEqual([
			["glint", g.role, g.r0Tiles, g.segments],
		]);
		expect(g.r1Tiles < g.r0Tiles).toBe(true);
		const p1 = s.party!.players[1];
		p1.x = 3;
		p1.z = -2;
		d.frame(EMPTY, s, 0, false, settings(), 2 + g.sec * 0.999);
		expect([d.out.rings[0].x, d.out.rings[0].z]).toEqual([3, -2]);
		expect(d.out.rings[0].radius).toBeCloseTo(g.r1Tiles, 2);
		// A second hit restarts it (one glint per player); it lives glint.sec.
		const again = bu5(s, (e) => duoProc(e, Duo.UNSHAKEN, 1, 0, 0, 1), 2);
		d.frame(again, s, 0, false, settings(), 2.5);
		expect(d.out.rings.filter((r) => r.look === "glint").size()).toBe(1);
		d.frame(EMPTY, s, 0, false, settings(), 2.5 + g.sec + 0.01);
		expect(d.out.rings.size()).toBe(0);
	});

	it("the glint sits beside the evolve flare and the heal pulse (one each per player); Reduced, reduced motion, death, quiet", () => {
		const s = state(2);
		const g = BUILD_FX_VIEW.glint;
		const ev = bu5(s, (e) => {
			e.duoPlayer.push(0);
			e.duoTaken.push(Duo.UNSHAKEN);
			e.lionPlayer.push(0);
			e.lionHealed.push(1);
			duoProc(e, Duo.UNSHAKEN, 0, 0, 0, 1);
			duoProc(e, Duo.UNSHAKEN, 1, 0, 0, 1);
		});
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings("reduced", { reducedMotion: true }), 1);
		expect(d.out.rings.map((r) => [r.look, r.radius, r.segments])).toEqual([
			["flare", BUILD_FX_VIEW.flare.r1Tiles, buildFxCount(BUILD_FX_VIEW.flare.segments, "reduced")],
			["heal", BUILD_FX_VIEW.heal.r1Tiles, buildFxCount(BUILD_FX_VIEW.heal.segments, "reduced")],
			["glint", g.r1Tiles, buildFxCount(g.segments, "reduced")],
			["glint", g.r1Tiles, buildFxCount(g.segments, "reduced")],
		]);
		s.party!.players[1].dead = 1;
		d.frame(EMPTY, s, 0, false, settings(), 1.01);
		expect(d.out.rings.filter((r) => r.look === "glint").size()).toBe(1);
		d.frame(EMPTY, s, 0, true, settings(), 1.02);
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

/** One Overkill streak pushed into the sim's feed: corpse (x1, z1) -> target (x2, z2). */
function streak(
	e: BuildEvents,
	owner: number,
	x1: number,
	z1: number,
	x2: number,
	z2: number,
	carry = 1,
	gen = 0,
): void {
	e.overkillX1.push(x1);
	e.overkillZ1.push(z1);
	e.overkillX2.push(x2);
	e.overkillZ2.push(z2);
	e.overkillOwner.push(owner);
	e.overkillGen.push(gen);
	e.overkillCarry.push(carry);
}

function brace(e: BuildEvents, player: number, kind: number): void {
	e.bracePlayer.push(player);
	e.braceKind.push(kind);
}

describe("buildFx rules: Overkill streaks (LG6)", () => {
	it("a streak lives overkill.sec, opaque for its hold, then fades to 0", () => {
		const o = BUILD_FX_VIEW.overkill;
		const hold = o.sec * o.hold;
		expect([streakFade(0), streakFade(hold), streakFade(o.sec)]).toEqual([1, 1, 0]);
		expect(streakFade((hold + o.sec) / 2)).toBeCloseTo(0.5, 9);
		// Longer than the spark beam: the streak is the bigger hit.
		expect(o.sec > BEAM_SEC).toBe(true);
	});

	it("thickness: Full grows by carryStuds per carry above 1 (capped), Reduced is thin, Skewer thicker; always over the spark beam", () => {
		const o = BUILD_FX_VIEW.overkill;
		expect(streakThickness(1, "full", false)).toBe(o.thicknessStuds);
		expect(streakThickness(0.5, "full", false)).toBe(o.thicknessStuds);
		expect(streakThickness(3, "full", false)).toBeCloseTo(o.thicknessStuds + 2 * o.carryStuds, 9);
		expect(streakThickness(99, "full", false)).toBeCloseTo(o.thicknessStuds + o.maxCarrySteps * o.carryStuds, 9);
		expect(streakThickness(5, "reduced", false)).toBe(o.reducedThicknessStuds);
		expect(streakThickness(1, "full", true)).toBeCloseTo(o.thicknessStuds * o.skewerThicknessShare, 9);
		expect(streakThickness(1, "reduced", true)).toBeCloseTo(o.reducedThicknessStuds * o.skewerThicknessShare, 9);
		expect(o.thicknessStuds > BUILD_FX_VIEW.beam.thicknessStuds).toBe(true);
		expect(o.reducedThicknessStuds < o.thicknessStuds).toBe(true);
		expect(o.role).toBe("build.overkill");
	});

	it("the director draws one straight streak per strike with its core and an impact flash at the target (Full)", () => {
		const s = state(2);
		const o = BUILD_FX_VIEW.overkill;
		const ev = bu5(s, (e) => {
			streak(e, 0, 1, 2, 3, 4, 5, 0);
			streak(e, 1, 3, 4, 6, 4, 4, 1);
			streak(e, 7, 0, 0, 1, 1); // outside the party: ignored
		});
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings(), 1);
		expect(d.out.streaks.map((t) => [t.x1, t.z1, t.x2, t.z2, t.owner, t.gen, t.core, t.fade])).toEqual([
			[1, 2, 3, 4, 0, 0, true, 1],
			[3, 4, 6, 4, 1, 1, true, 1],
		]);
		expect(d.out.streaks[0].thicknessStuds).toBe(streakThickness(5, "full", false));
		expect(d.out.impacts.map((f) => [f.x, f.z, f.scale, f.fade])).toEqual([
			[3, 4, o.impact.popScale, 1],
			[6, 4, o.impact.popScale, 1],
		]);
		// No beam, ring or chip burst of its own: the streak is not a spark.
		expect([d.out.beams.size(), d.out.sparkBursts.size(), d.out.rings.size()]).toEqual([0, 0, 0]);
		// The impact pops out, then each fades and goes after its own life.
		d.frame(EMPTY, s, 0, false, settings(), 1 + o.impact.popSec);
		expect(d.out.impacts[0].scale).toBe(1);
		d.frame(EMPTY, s, 0, false, settings(), 1 + o.sec + 0.001);
		expect(d.out.streaks.size()).toBe(0);
		d.frame(EMPTY, s, 0, false, settings(), 1 + o.impact.sec + 0.001);
		expect(d.out.impacts.size()).toBe(0);
	});

	it("Reduced: a thin streak, no core, no impact flash; reduced motion: no pop", () => {
		const s = state();
		const ev = bu5(s, (e) => streak(e, 0, 0, 0, 2, 0, 3));
		const r = new BuildFxDirector();
		r.frame(ev, s, 0, false, settings("reduced"), 1);
		expect(r.out.streaks.map((t) => [t.thicknessStuds, t.core])).toEqual([
			[BUILD_FX_VIEW.overkill.reducedThicknessStuds, false],
		]);
		expect(r.out.impacts.size()).toBe(0);
		const m = new BuildFxDirector();
		m.frame(ev, s, 0, false, settings("full", { reducedMotion: true }), 1);
		expect(m.out.impacts.map((f) => f.scale)).toEqual([1]);
		expect([
			impactPop(0, false),
			impactPop(0, true),
			impactPop(BUILD_FX_VIEW.overkill.impact.popSec, false),
		]).toEqual([BUILD_FX_VIEW.overkill.impact.popScale, 1, 1]);
	});

	it("Skewer's line end: through the target to OVERKILL_RANGE from the corpse (row, diagonal, zero length)", () => {
		const p = { x: 0, z: 0 };
		// A row: corpse (1, 1), target 2 along +x -> the end OVERKILL_RANGE along +x.
		skewerLineEnd(1, 1, 3, 1, p);
		expect([p.x, p.z]).toEqual([1 + OVERKILL_RANGE, 1]);
		// A row toward -z.
		skewerLineEnd(0, 0, 0, -1, p);
		expect([p.x, p.z]).toEqual([0, -OVERKILL_RANGE]);
		// A diagonal (3, 4) from the corpse: the end at OVERKILL_RANGE along the same direction.
		skewerLineEnd(2, -1, 5, 3, p);
		expect(p.x).toBeCloseTo(2 + OVERKILL_RANGE * 0.6, 9);
		expect(p.z).toBeCloseTo(-1 + OVERKILL_RANGE * 0.8, 9);
		expect(math.sqrt((p.x - 2) ** 2 + (p.z + 1) ** 2)).toBeCloseTo(OVERKILL_RANGE, 9);
		// The target on the corpse: the segment ends at the target (no NaN).
		skewerLineEnd(4, 4, 4, 4, p);
		expect([p.x, p.z]).toEqual([4, 4]);
	});

	it("a Skewer line (a SKEWER duoProc at the streak's corpse, same tick and owner) draws thicker to the line's end, plus its duo flare", () => {
		const s = state(2);
		const ev = bu5(s, (e) => {
			streak(e, 0, 1, 1, 3, 1, 2);
			streak(e, 1, 5, 5, 6, 5, 2);
			duoProc(e, Duo.SKEWER, 0, 1, 1, 3);
		});
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings(), 1);
		expect(d.out.streaks.map((t) => t.thicknessStuds)).toEqual([
			streakThickness(2, "full", true),
			streakThickness(2, "full", false),
		]);
		// The Skewer streak runs on to the line's end; the plain one ends at its target; impacts stay at the targets.
		expect(d.out.streaks.map((t) => [t.x1, t.z1, t.x2, t.z2])).toEqual([
			[1, 1, 1 + OVERKILL_RANGE, 1],
			[5, 5, 6, 5],
		]);
		expect(d.out.impacts.map((f) => [f.x, f.z])).toEqual([
			[3, 1],
			[6, 5],
		]);
		expect(d.out.rings.map((r) => [r.look, r.role, r.x, r.z])).toEqual([["pop", BUILD_FX_VIEW.pop.duoRole, 1, 1]]);
	});

	it("caps the live streaks and impacts (oldest replaced); quiet and a new run forget them", () => {
		const s = state();
		const o = BUILD_FX_VIEW.overkill;
		const ev = bu5(s, (e) => {
			for (let i = 0; i < o.maxAlive + 3; i++) streak(e, 0, i, 0, i + 1, 0);
		});
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings(), 1);
		expect([d.out.streaks.size(), d.out.impacts.size()]).toEqual([o.maxAlive, o.impact.maxAlive]);
		expect(d.out.streaks[0].x1).toBe(3);
		d.frame(EMPTY, s, 0, true, settings(), 1.01);
		expect([d.out.streaks.size(), d.out.impacts.size()]).toEqual([0, 0]);
		d.frame(ev, s, 0, false, settings(), 2);
		d.frame(EMPTY, state(), 0, false, settings(), 2.01);
		expect([d.out.streaks.size(), d.out.impacts.size()]).toEqual([0, 0]);
	});
});

describe("buildFx rules: Bastion's brace (LG6)", () => {
	it("the crack: chords stay whole until crackAt of the ring's life, then shrink to minChordShare", () => {
		const b = BUILD_FX_VIEW.brace;
		expect([braceChordShare(0), braceChordShare(b.sec * b.crackAt), braceChordShare(b.sec)]).toEqual([
			1,
			1,
			b.minChordShare,
		]);
		const mid = b.sec * (b.crackAt + (1 - b.crackAt) / 2);
		expect(braceChordShare(mid)).toBeCloseTo((1 + b.minChordShare) / 2, 9);
		expect(b.sec).toBeCloseTo(0.3, 9);
		expect([
			braceRingStrength(BraceKind.PIP),
			braceRingStrength(BraceKind.HEAL),
			braceRingStrength(BraceKind.SPENT),
		]).toEqual([1, 1, b.spentStrength]);
	});

	it("a pip brace cracks a ring on the knight (following them, in brace.role); SPENT a faint one; HEAL adds the heal pulse", () => {
		const s = state(3);
		const b = BUILD_FX_VIEW.brace;
		const ev = bu5(s, (e) => {
			brace(e, 0, BraceKind.PIP);
			brace(e, 1, BraceKind.SPENT);
			brace(e, 2, BraceKind.HEAL);
			brace(e, 9, BraceKind.PIP); // outside the party
		});
		const d = new BuildFxDirector();
		d.frame(ev, s, 0, false, settings(), 1);
		expect(d.out.rings.map((r) => [r.look, r.role, r.radius, r.segments, r.fade, r.chordShare])).toEqual([
			["brace", b.role, b.r0Tiles, b.segments, 1, 1],
			["brace", b.role, b.r0Tiles, b.segments, b.spentStrength, 1],
			["brace", b.role, b.r0Tiles, b.segments, 1, 1],
			["heal", BUILD_FX_VIEW.heal.role, BUILD_FX_VIEW.heal.r0Tiles, BUILD_FX_VIEW.heal.segments, 1, 1],
		]);
		expect(d.out.braces.map((x) => [x.player, x.kind])).toEqual([
			[0, BraceKind.PIP],
			[1, BraceKind.SPENT],
			[2, BraceKind.HEAL],
		]);
		// The next frame lists no brace; the ring follows the knight and cracks, then goes after brace.sec.
		const p0 = s.party!.players[0];
		p0.x = 4;
		p0.z = 5;
		d.frame(EMPTY, s, 0, false, settings(), 1 + b.sec * 0.9);
		expect(d.out.braces.size()).toBe(0);
		const ring = d.out.rings.find((r) => r.look === "brace")!;
		expect([ring.x, ring.z]).toEqual([4, 5]);
		expect(ring.chordShare).toBeCloseTo(braceChordShare(b.sec * 0.9), 9);
		expect(ring.chordShare < 1).toBe(true);
		d.frame(EMPTY, s, 0, false, settings(), 1 + b.sec + 0.001);
		expect(d.out.rings.filter((r) => r.look === "brace").size()).toBe(0);
	});

	it("Reduced halves the ring's segments; reduced motion holds it at r1; a newer brace replaces the player's", () => {
		const s = state();
		const b = BUILD_FX_VIEW.brace;
		const d = new BuildFxDirector();
		d.frame(
			bu5(s, (e) => brace(e, 0, BraceKind.PIP)),
			s,
			0,
			false,
			settings("reduced", { reducedMotion: true }),
			1,
		);
		expect(d.out.rings.map((r) => [r.radius, r.segments])).toEqual([
			[b.r1Tiles, buildFxCount(b.segments, "reduced")],
		]);
		d.frame(
			bu5(s, (e) => brace(e, 0, BraceKind.SPENT), 2),
			s,
			0,
			false,
			settings(),
			1.1,
		);
		expect(d.out.rings.map((r) => [r.look, r.fade])).toEqual([["brace", b.spentStrength]]);
		expect(buildRingBlock("brace")).toBe(b);
	});
});
