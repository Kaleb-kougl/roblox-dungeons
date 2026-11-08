// BV11b (docs/BUILDS_V2.md, "BV11 (as built: guard visuals)"): counterWaveStrip, the band / glow geometry the client's
// CounterWaveController draws for every CounterWaveView:
//   - the band ends at the edge (the sim's strike radius) and runs bandTiles behind it; the glow is glowTiles wider,
//     half each side, never inside the origin, one thickness under the band
//   - a crescent spans its cone around the facing; a ring the full turn; the chord is the outer edge's
//   - transparency: the band 1 - fade, the glow 1 - glowOpacity x fade (a teammate's fade carries teammateOpacity)
//   - nothing to draw at radius 0 or with no segments
//   - end to end through CounterWaveFx: Full has a glow, Reduced a thinner band and no glow
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BUILDS_CONFIG,
	NOVA_HALF_ANGLE_COS,
	RIPOSTE_WAVE_HALF_ANGLE_COS,
	RIPOSTE_WAVE_RANGE,
	RIPOSTE_WAVE_SPEED,
	WaveKind,
	clearBuildEvents,
	createSimState,
	type BuildEvents,
	type SimState,
} from "shared/sim";
import { defaultJuiceSettings, type BuildFxLevel } from "shared/settings";
import { BuildFxEvents } from "./buildFxEvents";
import { BUILDS_V2_FX } from "./buildsV2FxConfig";
import { FULL_RING_HALF_ANGLE } from "./buildsV2Fx";
import { CounterWaveFx, counterWaveStrip, newCounterWaveStrip, type CounterWaveView } from "./counterWaveFx";

const C = BUILDS_V2_FX.counter;

function view(over: Partial<CounterWaveView> = {}): CounterWaveView {
	return {
		x: 0,
		z: 0,
		dirX: 1,
		dirZ: 0,
		radius: 3,
		range: RIPOSTE_WAVE_RANGE,
		halfCos: RIPOSTE_WAVE_HALF_ANGLE_COS,
		halfAngleRad: math.pi / 3,
		fullRing: false,
		kind: WaveKind.FORWARD,
		count: 4,
		owner: 0,
		mine: true,
		fade: 1,
		bandTiles: C.bandTiles,
		glow: true,
		segments: 11,
		role: C.role,
		ageSec: 0.1,
		...over,
	};
}

function state(): SimState {
	return createSimState(5, 0, 0, { builds: BUILDS_CONFIG });
}

function pushWave(e: BuildEvents, kind: number): void {
	e.waveX.push(2);
	e.waveZ.push(3);
	e.waveDirX.push(0);
	e.waveDirZ.push(1);
	e.waveHalfCos.push(kind === WaveKind.FORWARD ? RIPOSTE_WAVE_HALF_ANGLE_COS : NOVA_HALF_ANGLE_COS);
	e.waveRange.push(RIPOSTE_WAVE_RANGE);
	e.waveSpeed.push(RIPOSTE_WAVE_SPEED);
	e.waveOwner.push(0);
	e.waveDamage.push(4);
	e.waveKind.push(kind);
	e.counterCount.push(4);
}

describe("counterWaveStrip (BV11b)", () => {
	it("the band ends at the edge and runs bandTiles behind it, at liftStuds, 1 - fade", () => {
		const s = counterWaveStrip(view({ fade: 0.8 }), false, newCounterWaveStrip());
		expect(s.outerTiles).toBe(3);
		expect(s.innerTiles).toBeCloseTo(3 - C.bandTiles, 9);
		expect(s.widthTiles).toBeCloseTo(C.bandTiles, 9);
		expect(s.midTiles).toBeCloseTo(3 - C.bandTiles / 2, 9);
		expect(s.liftStuds).toBe(C.liftStuds);
		expect(s.transparency).toBeCloseTo(0.2, 9);
	});

	it("the glow is glowTiles wider, half each side, one thickness under the band, at glowOpacity", () => {
		const s = counterWaveStrip(view({ fade: 0.5 }), true, newCounterWaveStrip());
		expect(s.outerTiles).toBeCloseTo(3 + C.glowTiles / 2, 9);
		expect(s.innerTiles).toBeCloseTo(3 - C.bandTiles - C.glowTiles / 2, 9);
		expect(s.widthTiles).toBeCloseTo(C.bandTiles + C.glowTiles, 9);
		expect(s.liftStuds).toBeCloseTo(C.liftStuds - C.thicknessStuds, 9);
		expect(s.liftStuds).toBeGreaterThan(0);
		expect(s.transparency).toBeCloseTo(1 - C.glowOpacity * 0.5, 9);
	});

	it("a young wave: the band is the whole radius and the glow never reaches inside the origin", () => {
		const v = view({ radius: 0.2, bandTiles: 0.2 });
		const band = counterWaveStrip(v, false, newCounterWaveStrip());
		expect(band.innerTiles).toBe(0);
		expect(band.outerTiles).toBeCloseTo(0.2, 9);
		const glow = counterWaveStrip(v, true, newCounterWaveStrip());
		expect(glow.innerTiles).toBe(0);
		expect(glow.outerTiles).toBeCloseTo(0.2 + C.glowTiles / 2, 9);
	});

	it("a crescent spans its cone around the facing; a ring the full turn; the chord is the outer edge's", () => {
		const arc = counterWaveStrip(view({ dirX: 0, dirZ: 1, segments: 11 }), false, newCounterWaveStrip());
		expect(arc.startRad).toBeCloseTo(math.pi / 2 - math.pi / 3, 9);
		expect(arc.stepRad * 11).toBeCloseTo((2 * math.pi) / 3, 9);
		expect(arc.chordTiles).toBeCloseTo(2 * 3 * math.sin(arc.stepRad / 2), 9);
		const ring = counterWaveStrip(
			view({ halfAngleRad: FULL_RING_HALF_ANGLE, fullRing: true, segments: 32, dirX: 0, dirZ: 0 }),
			false,
			newCounterWaveStrip(),
		);
		expect(ring.stepRad * 32).toBeCloseTo(2 * math.pi, 9);
		expect(ring.startRad).toBeCloseTo(-math.pi, 9);
	});

	it("a teammate's fade carries teammateOpacity into both strips", () => {
		const v = view({ mine: false, owner: 1, fade: BUILDS_V2_FX.teammateOpacity });
		expect(counterWaveStrip(v, false, newCounterWaveStrip()).transparency).toBeCloseTo(
			1 - BUILDS_V2_FX.teammateOpacity,
			9,
		);
		expect(counterWaveStrip(v, true, newCounterWaveStrip()).transparency).toBeCloseTo(
			1 - C.glowOpacity * BUILDS_V2_FX.teammateOpacity,
			9,
		);
	});

	it("nothing to draw at radius 0 or with no segments", () => {
		expect(counterWaveStrip(view({ radius: 0, bandTiles: 0 }), false, newCounterWaveStrip()).chordTiles).toBe(0);
		expect(counterWaveStrip(view({ segments: 0 }), false, newCounterWaveStrip()).chordTiles).toBe(0);
	});

	it("end to end: Full has a glow and the wide band, Reduced a thinner band and no glow", () => {
		const levels: BuildFxLevel[] = ["full", "reduced"];
		for (const level of levels) {
			const s = state();
			const ev = new BuildFxEvents();
			ev.reset();
			clearBuildEvents(s.builds!);
			pushWave(s.builds!.events, WaveKind.FORWARD);
			pushWave(s.builds!.events, WaveKind.REBUKE);
			s.tick += 1;
			ev.collect(s);
			s.tick += 4;
			const out = new CounterWaveFx().frame(
				ev,
				s,
				0,
				false,
				{ juice: defaultJuiceSettings(), buildFx: level },
				0,
			);
			expect(out.waves.size()).toBe(2);
			for (const w of out.waves) {
				const band = counterWaveStrip(w, false, newCounterWaveStrip());
				expect(band.outerTiles).toBeCloseTo(w.radius, 9);
				expect(band.widthTiles).toBeCloseTo(level === "full" ? C.bandTiles : C.reducedBandTiles, 9);
				expect(band.chordTiles).toBeGreaterThan(0);
				expect(w.glow).toBe(level === "full");
			}
			expect(out.waves[1].fullRing).toBe(true);
		}
	});
});
