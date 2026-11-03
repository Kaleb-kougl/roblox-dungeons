// Pellets on screen (docs/PELLETS.md PL7): the frame's collected events, each pellet's look (dormant hidden, the pop-in
// wave, the last-few and power pulses, the shrink at the clear, reduced-motion variants), the merged pellet pops, the
// power pellet's fly-in and freeze, the first-sighting check, the debug label, the theme accessor and the run views'
// wiring.
import { describe, expect, it } from "@rbxts/jest-globals";
import { NO_POWER_PELLET, type FloorPellets } from "shared/dungeon";
import { LiveRun } from "shared/play";
import { buildEndlessRunConfig } from "shared/run";
import { EMPTY_INPUT, PELLETS_CONFIG, PelletPhase, SIM_HZ, createSimState, type SimState } from "shared/sim";
import { PELLET_KINDS, PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { defaultJuiceSettings } from "shared/settings";
import {
	PELLETS_VIEW,
	PelletFlyIns,
	PelletFrameEvents,
	PelletViewTracker,
	deflectedBullets,
	livePowerPellet,
	mergePelletPops,
	newPelletLook,
	pelletDebugText,
	pelletGoneLook,
	pelletPopAlpha,
	pelletPopInScale,
	pelletPopRise,
	pelletPowerErased,
	pelletPowerFreezeMs,
	pelletWaveDelay,
	pulse01,
	tickDeflectedBullets,
	type PelletPop,
} from ".";

const V = PELLETS_VIEW;
const quiet = (): void => {};

/**
 * A sandbox state with `n` pellets in a row (x = 1..n, z = 0), the last one the power pellet when `power`, all in ONE
 * hand-made room record (a sandbox has no score records); its phase DORMANT.
 */
function sandbox(n: number, power = false): SimState {
	const tiles: { x: number; z: number }[] = [];
	const room: number[] = [];
	for (let i = 0; i < n; i++) {
		tiles.push({ x: i + 1, z: 0 });
		room.push(0);
	}
	const floor: FloorPellets = { tiles, room, power: power ? n - 1 : NO_POWER_PELLET };
	const s = createSimState(1, 0, 0, { pellets: { ...PELLETS_CONFIG, floor } });
	const p = s.pellets!;
	for (let i = 0; i < n; i++) p.rec[i] = 0;
	const regular = power ? n - 1 : n;
	p.rooms.push({ first: 0, span: n, count: regular, left: regular, phase: PelletPhase.DORMANT, swept: 0 });
	return s;
}

function eventsWith(fill: (e: PelletFrameEvents) => void): PelletFrameEvents {
	const e = new PelletFrameEvents();
	fill(e);
	return e;
}

describe("pellets view: config", () => {
	it("matches the plan: 0.4 s wave, hint at 3, 0.3 s shrink and fly-in, pops at 60 % for 0.4 s, a 30 ms freeze", () => {
		expect([V.popIn.waveSec, V.lastFewHint, V.shrinkSec, V.flyIn.sec]).toEqual([0.4, 3, 0.3, 0.3]);
		expect([V.pop.scale, V.pop.lifeSec, V.freezeMs]).toEqual([0.6, 0.4, 30]);
		expect([V.artTiles.normal, V.artTiles.power]).toEqual([0.25, 0.45]);
		expect(V.poolSize).toBe(64);
		expect(V.debugAttribute).toBe("KV_PelletDebug");
		expect(V.audio.eatSpeeds.size()).toBe(2);
		expect(V.audio.eatMinIntervalSec).toBe(0.06);
		// Floor art sits over the floor effects (0.02) and under every floor marking (0.04 tiles = 0.16 studs).
		expect(V.artLiftStuds > 0.02 && V.artLiftStuds < 0.16).toBe(true);
	});
});

describe("PelletFrameEvents", () => {
	it("collects every tick's events (copies, with their tick), resets per frame, no-op without pellets", () => {
		const s = sandbox(3);
		const ev = new PelletFrameEvents();
		const se = s.pellets!.events;
		se.eaten.push({ index: 1, x: 2, z: 0, player: 0, points: 5 });
		se.live.push(0);
		s.tick = 7;
		ev.collect(s);
		se.eaten.clear();
		se.live.clear();
		se.gone.push(0);
		se.swept.push(0);
		se.power = { player: 0, x: [4, 5], z: [6, 7], points: 10 };
		s.tick = 8;
		ev.collect(s);
		se.power.x.push(99); // the sim's arrays are reused: the frame keeps its copy
		expect(ev.eaten.map((e) => [e.index, e.points])).toEqual([[1, 5]]);
		expect(ev.live).toEqual([{ rec: 0, tick: 7 }]);
		expect(ev.gone).toEqual([{ rec: 0, tick: 8 }]);
		expect([...ev.swept]).toEqual([0]);
		expect(ev.power.size()).toBe(1);
		expect([[...ev.power[0].x], [...ev.power[0].z], ev.power[0].points, ev.power[0].tick]).toEqual([
			[4, 5],
			[6, 7],
			10,
			8,
		]);
		expect(ev.count()).toBe(5);
		ev.reset();
		expect(ev.count()).toBe(0);
		ev.collect(createSimState(1, 0, 0));
		expect(ev.count()).toBe(0);
	});
});

describe("pellet curves", () => {
	it("the wave delay: 0 at the room's centre, waveSec at a corner, clamped beyond it", () => {
		expect(pelletWaveDelay(5, 4, 0, 10, 0, 8)).toBe(0);
		expect(pelletWaveDelay(10, 8, 0, 10, 0, 8)).toBeCloseTo(V.popIn.waveSec, 9);
		expect(pelletWaveDelay(50, 50, 0, 10, 0, 8)).toBe(V.popIn.waveSec);
		expect(pelletWaveDelay(1, 1, 3, 3, 3, 3)).toBe(0); // a degenerate room
	});

	it("the pop-in: 0 before its turn, overshoots, 1 after popSec; reduced motion 1 at once", () => {
		expect(pelletPopInScale(0.1, 0.2, 1)).toBe(0);
		let peak = 0;
		for (let k = 1; k < 20; k++) peak = math.max(peak, pelletPopInScale(0.2 + (k / 20) * V.popIn.popSec, 0.2, 1));
		expect(peak > 1).toBe(true);
		expect(pelletPopInScale(0.2 + V.popIn.popSec, 0.2, 1)).toBe(1);
		expect(pelletPopInScale(0, 0.3, 0)).toBe(1);
	});

	it("pulse01 runs 0 -> 1 -> 0 over its period", () => {
		expect(pulse01(0, 1)).toBeCloseTo(0, 9);
		expect(pulse01(0.5, 1)).toBeCloseTo(1, 9);
		expect(pulse01(1, 1)).toBeCloseTo(0, 9);
		expect(pulse01(3, 0)).toBe(0);
	});

	it("the shrink: scale 1 -> 0 over shrinkSec; reduced motion fades instead; hidden after", () => {
		const out = newPelletLook();
		pelletGoneLook(V.shrinkSec / 2, 1, out);
		expect([out.shown, out.transparency]).toEqual([true, 0]);
		expect(out.scale).toBeCloseTo(0.5, 9);
		pelletGoneLook(V.shrinkSec / 2, 0, out);
		expect([out.shown, out.scale]).toEqual([true, 1]);
		expect(out.transparency).toBeCloseTo(0.5, 9);
		expect(pelletGoneLook(V.shrinkSec, 1, out).shown).toBe(false);
	});
});

describe("PelletViewTracker", () => {
	const look = newPelletLook();

	it("dormant rooms are hidden; a live room seen going live pops in as a wave; unseen it is simply there", () => {
		const s = sandbox(5);
		const t = new PelletViewTracker();
		expect(t.sync(s, new PelletFrameEvents())).toBe(true);
		expect(t.look(s, 0, 0, 1, look).shown).toBe(false);
		s.pellets!.rooms[0].phase = PelletPhase.LIVE;
		// Not seen going live (a late join, a spectator's first frame): full size at once.
		expect([t.look(s, 0, 0, 1, look).shown, look.scale]).toEqual([true, 1]);
		const at = 60;
		expect(
			t.sync(
				s,
				eventsWith((e) => e.live.push({ rec: 0, tick: at })),
			),
		).toBe(false);
		const live = at / SIM_HZ;
		// No score records: every pellet starts at once (delay 0); scale 0 = hidden on its first instant.
		expect(t.look(s, 2, live, 1, look).shown).toBe(false);
		expect(t.look(s, 2, live + V.popIn.popSec, 1, look).scale).toBe(1);
		// Reduced motion: no pop.
		expect([t.look(s, 2, live, 0, look).shown, look.scale]).toEqual([true, 1]);
		// Taken pellets are gone at once.
		s.pellets!.taken[2] = 1;
		expect(t.look(s, 2, live + 1, 1, look).shown).toBe(false);
		// Out of range / no pellets: hidden.
		expect(t.look(s, 99, live + 1, 1, look).shown).toBe(false);
		expect(t.look(createSimState(1, 0, 0), 0, 0, 1, look).shown).toBe(false);
	});

	it("the wave follows the score record's bounds in a scored run (centre first, corners last)", () => {
		const s = sandbox(3);
		const t = new PelletViewTracker();
		t.sync(
			s,
			eventsWith((e) => e.live.push({ rec: 0, tick: 0 })),
		);
		s.pellets!.rooms[0].phase = PelletPhase.LIVE;
		// A fake score record spanning x 0..4, z -1..1: pellet 1 (x 2) is at the centre, pellet 0 (x 1) further out.
		(s as unknown as { score: unknown }).score = { rooms: [{ minX: 0, maxX: 4, minZ: -1, maxZ: 1 }] };
		const early = V.popIn.popSec / 2;
		const centre = t.look(s, 1, early, 1, look).scale;
		const out = t.look(s, 0, early, 1, look).shown ? look.scale : 0;
		expect(centre > out).toBe(true);
	});

	it("the last few pulse (glow) with lastFewHint or fewer left; reduced motion: a steady glow, no scale", () => {
		const s = sandbox(5);
		const t = new PelletViewTracker();
		t.sync(s, new PelletFrameEvents());
		const room = s.pellets!.rooms[0];
		room.phase = PelletPhase.LIVE;
		const half = V.lastFew.periodSec / 2;
		expect(t.look(s, 0, half, 1, look).glow).toBe(0); // 5 left
		room.left = V.lastFewHint;
		t.look(s, 0, half, 1, look);
		expect(look.glow).toBeCloseTo(V.lastFew.glowMax, 9);
		expect(look.scale).toBeCloseTo(1 + V.lastFew.scaleAmp, 9);
		t.look(s, 0, half, 0, look);
		expect([look.glow, look.scale]).toEqual([V.lastFew.glowMax, 1]);
		room.left = 0;
		expect(t.look(s, 0, half, 1, look).glow).toBe(0);
	});

	it("the power pellet pulses slowly (never the last-few hint); reduced motion: still", () => {
		const s = sandbox(3, true);
		const t = new PelletViewTracker();
		t.sync(s, new PelletFrameEvents());
		const room = s.pellets!.rooms[0];
		room.phase = PelletPhase.LIVE;
		room.left = 1;
		const half = V.power.periodSec / 2;
		t.look(s, 2, half, 1, look);
		expect(look.scale).toBeCloseTo(1 + V.power.scaleAmp, 9);
		expect(look.glow).toBeCloseTo(V.power.glowMax, 9);
		t.look(s, 2, half, 0, look);
		expect([look.shown, look.scale, look.glow]).toEqual([true, 1, 0]);
	});

	it("gone: shrinks from the clear seen; unseen it is hidden; a new floor forgets everything", () => {
		const s = sandbox(3);
		const t = new PelletViewTracker();
		t.sync(s, new PelletFrameEvents());
		const room = s.pellets!.rooms[0];
		room.phase = PelletPhase.GONE;
		expect(t.look(s, 0, 1, 1, look).shown).toBe(false);
		t.sync(
			s,
			eventsWith((e) => e.gone.push({ rec: 0, tick: 60 })),
		);
		expect(t.goneTime(0)).toBe(1);
		t.look(s, 0, 1 + V.shrinkSec / 2, 1, look);
		expect(look.shown).toBe(true);
		expect(look.scale).toBeCloseTo(0.5, 9);
		expect(t.look(s, 0, 1 + V.shrinkSec, 1, look).shown).toBe(false);
		// A new floor (more pellets): the times are forgotten.
		const later = sandbox(4);
		expect(t.isNewFloor(later)).toBe(true);
		expect(t.sync(later, new PelletFrameEvents())).toBe(true);
		expect(t.goneTime(0)).toBe(PelletViewTracker.NOT_SEEN);
		// An event for a record past the floor's is ignored.
		t.sync(
			later,
			eventsWith((e) => e.live.push({ rec: 5, tick: 1 })),
		);
		expect(t.liveTime(5)).toBe(PelletViewTracker.NOT_SEEN);
		t.reset();
		expect(t.isNewFloor(later)).toBe(true);
	});
});

describe("pellets on the floor: clears inside the wave, restarts", () => {
	it("a room that clears inside its pop-in wave shrinks from the size reached; one never shown stays hidden", () => {
		const look = newPelletLook();
		const s = sandbox(3);
		const t = new PelletViewTracker();
		// A fake score record spanning x 0..4, z -1..1: pellet 1 (x 2) at the centre (no delay), pellet 0 later.
		(s as unknown as { score: unknown }).score = { rooms: [{ minX: 0, maxX: 4, minZ: -1, maxZ: 1 }] };
		// A quarter of the pop (ease-out-back has not overshot yet), on a whole tick.
		const ticks = math.floor((V.popIn.popSec / 4) * SIM_HZ);
		const goneAt = ticks / SIM_HZ;
		t.sync(
			s,
			eventsWith((e) => {
				e.live.push({ rec: 0, tick: 0 });
				e.gone.push({ rec: 0, tick: ticks });
			}),
		);
		s.pellets!.rooms[0].phase = PelletPhase.GONE;
		const reached = pelletPopInScale(goneAt, 0, 1);
		expect(reached > 0 && reached < 1).toBe(true);
		t.look(s, 1, goneAt, 1, look);
		expect(look.shown).toBe(true);
		expect(look.scale).toBeCloseTo(reached, 9);
		t.look(s, 1, goneAt + V.shrinkSec / 2, 1, look);
		expect(look.scale).toBeCloseTo(reached * 0.5, 9);
		// Pellet 0's turn in the wave had not come: it never showed, so it does not shrink either.
		expect(pelletWaveDelay(1, 0, 0, 4, -1, 1) > goneAt).toBe(true);
		expect(t.look(s, 0, goneAt, 1, look).shown).toBe(false);
		// Live and gone on ONE tick (a clear on its engagement tick): nothing to shrink.
		const same = new PelletViewTracker();
		same.sync(
			s,
			eventsWith((e) => {
				e.live.push({ rec: 0, tick: 30 });
				e.gone.push({ rec: 0, tick: 30 });
			}),
		);
		expect(same.look(s, 1, 0.5, 1, look).shown).toBe(false);
		// Reduced motion: no wave, so every pellet fades from full size.
		t.look(s, 0, goneAt + V.shrinkSec / 2, 0, look);
		expect([look.shown, look.scale]).toEqual([true, 1]);
		expect(look.transparency).toBeCloseTo(0.5, 9);
	});

	it("the tick going back (a new run on the same floor) forgets the times", () => {
		const s = sandbox(3);
		const t = new PelletViewTracker();
		s.tick = 100;
		t.sync(
			s,
			eventsWith((e) => e.live.push({ rec: 0, tick: 90 })),
		);
		expect(t.liveTime(0)).toBe(90 / SIM_HZ);
		expect(t.isNewFloor(s)).toBe(false);
		s.tick = 5;
		expect(t.isNewFloor(s)).toBe(true);
		expect(t.sync(s, new PelletFrameEvents())).toBe(true);
		expect(t.liveTime(0)).toBe(PelletViewTracker.NOT_SEEN);
	});
});

describe("the power pellet's erases are no deflect", () => {
	it("deflectedBullets takes the frame's power erases out of bulletsDeleted (never below 0)", () => {
		const ev = new PelletFrameEvents();
		expect([pelletPowerErased(ev), deflectedBullets(4, ev)]).toEqual([0, 4]);
		ev.power.push({ player: 0, px: 0, pz: 0, x: [1, 2, 3], z: [1, 2, 3], points: 15, tick: 1 });
		expect([pelletPowerErased(ev), deflectedBullets(3, ev), deflectedBullets(5, ev)]).toEqual([3, 0, 2]);
		expect(deflectedBullets(1, ev)).toBe(0);
	});

	it("tickDeflectedBullets reads one tick's SimEvents and pellet events", () => {
		const s = sandbox(3, true);
		s.events.bulletsDeleted = 5;
		expect(tickDeflectedBullets(s)).toBe(5);
		s.pellets!.events.power = { player: 0, x: [1, 2, 3, 4], z: [1, 2, 3, 4], points: 20 };
		expect(tickDeflectedBullets(s)).toBe(1);
		expect(tickDeflectedBullets(createSimState(1, 0, 0))).toBe(0);
	});

	it("PelletFrameEvents.collect records the power pellet's own spot", () => {
		const s = sandbox(3, true);
		s.pellets!.events.power = { player: 0, x: [7], z: [8], points: 5 };
		const ev = new PelletFrameEvents();
		ev.collect(s);
		expect([ev.power[0].px, ev.power[0].pz, ev.power[0].x[0], ev.power[0].points]).toEqual([3, 0, 7, 5]);
	});
});

describe("pellet pops (PD11)", () => {
	it("merge per player per frame: summed points at the player's last pellet, first-eaten order", () => {
		const out: PelletPop[] = [];
		mergePelletPops(
			[
				{ index: 0, x: 1, z: 0, player: 1, points: 5 },
				{ index: 1, x: 2, z: 0, player: 0, points: 5 },
				{ index: 2, x: 3, z: 0, player: 1, points: 7 },
			],
			out,
		);
		expect(out.map((p) => [p.player, p.x, p.points, p.count])).toEqual([
			[1, 3, 12, 2],
			[0, 2, 5, 1],
		]);
		expect(mergePelletPops([], out).size()).toBe(0);
	});

	it("the power pellet's points join its picker's pop, or pop at the power pellet; nothing paid, no pop", () => {
		const out: PelletPop[] = [];
		const power = (player: number, points: number) => ({
			player,
			px: 9,
			pz: 4,
			x: [1],
			z: [1],
			points,
			tick: 1,
		});
		mergePelletPops([{ index: 0, x: 1, z: 0, player: 0, points: 5 }], out, [power(0, 20), power(1, 15)]);
		expect(out.map((p) => [p.player, p.x, p.z, p.points, p.count])).toEqual([
			[0, 1, 0, 25, 1],
			[1, 9, 4, 15, 0],
		]);
		expect(mergePelletPops([], out, [power(0, 0)]).size()).toBe(0);
	});

	it("live pop.lifeSec, fade at the end, rise risePx; reduced motion: no rise, a fade over the whole life", () => {
		const P = V.pop;
		expect(pelletPopAlpha(0, 1)).toBe(1);
		expect(pelletPopAlpha(P.lifeSec - P.fadeSec / 2, 1)).toBeCloseTo(0.5, 9);
		expect(pelletPopAlpha(P.lifeSec, 1)).toBe(0);
		expect(pelletPopAlpha(-1, 1)).toBe(0);
		expect(pelletPopAlpha(P.lifeSec / 2, 0)).toBeCloseTo(0.5, 9);
		expect(pelletPopRise(P.lifeSec, 1)).toBe(P.risePx);
		expect(pelletPopRise(P.lifeSec / 2, 0)).toBe(0);
		expect(pelletPopRise(0, 1)).toBe(0);
	});
});

describe("the power pellet", () => {
	it("freezes only for the view player's own pickup in a solo run with the freeze frame on", () => {
		const on = defaultJuiceSettings();
		expect([on.freezeFrame, on.reducedMotion]).toEqual([true, false]);
		expect(pelletPowerFreezeMs(0, 0, 1, on)).toBe(V.freezeMs);
		expect(pelletPowerFreezeMs(1, 0, 1, on)).toBe(0);
		expect(pelletPowerFreezeMs(0, 0, 2, on)).toBe(0);
		expect(pelletPowerFreezeMs(0, 0, 1, { ...on, reducedMotion: true })).toBe(0);
		expect(pelletPowerFreezeMs(0, 0, 1, { ...on, freezeFrame: false })).toBe(0);
	});

	it("livePowerPellet: only untaken in a live room", () => {
		const s = sandbox(3, true);
		expect(livePowerPellet(s)).toBe(-1);
		s.pellets!.rooms[0].phase = PelletPhase.LIVE;
		expect(livePowerPellet(s)).toBe(2);
		s.pellets!.taken[2] = 1;
		expect(livePowerPellet(s)).toBe(-1);
		expect(livePowerPellet(sandbox(3))).toBe(-1);
		expect(livePowerPellet(createSimState(1, 0, 0))).toBe(-1);
	});

	it("the fly-in: a cube per bullet flying into the (moving) picker over flyIn.sec, capped; reduced: fade in place", () => {
		const f = new PelletFlyIns();
		const pushed: number[][] = [];
		const writer = {
			push(x: number, z: number, hop: number, size: number, color: number, alpha: number) {
				pushed.push([x, z, hop, size, color, alpha]);
			},
		};
		f.add({ player: 0, px: 0, pz: 0, x: [10, 0], z: [0, 10], points: 10, tick: 1 }, 1);
		expect(f.size()).toBe(2);
		f.update(V.flyIn.sec / 2);
		const target = { x: 2, z: 2 };
		f.draw(writer, 7, () => target);
		// Ease-in: a quarter of the way at half time.
		expect(pushed[0][0]).toBeCloseTo(10 + (2 - 10) * 0.25, 9);
		expect(pushed[0][1]).toBeCloseTo(0.5, 9);
		expect([pushed[0][3], pushed[0][4], pushed[0][5]]).toEqual([V.flyIn.sizePx, 7, 1]);
		expect(pushed[0][2]).toBeCloseTo(V.flyIn.hopPx, 9);
		// No target (the picker left the party): the cube stays put.
		pushed.clear();
		f.draw(writer, 7, () => undefined);
		expect([pushed[1][0], pushed[1][1]]).toEqual([0, 10]);
		f.update(V.flyIn.sec);
		expect(f.size()).toBe(0);
		// Reduced motion: in place, fading.
		f.add({ player: 0, px: 0, pz: 0, x: [3], z: [4], points: 5, tick: 2 }, 0);
		f.update(V.flyIn.sec / 2);
		pushed.clear();
		f.draw(writer, 7, () => target);
		expect([pushed[0][0], pushed[0][1], pushed[0][2]]).toEqual([3, 4, 0]);
		expect(pushed[0][5]).toBeCloseTo(0.5, 9);
		// The cap.
		f.clear();
		const many: number[] = [];
		for (let i = 0; i < V.flyIn.maxCubes + 10; i++) many.push(i);
		f.add({ player: 0, px: 0, pz: 0, x: many, z: many, points: 0, tick: 3 }, 1);
		expect(f.size()).toBe(V.flyIn.maxCubes);
	});
});

describe("pellets view: debug label, theme and wiring", () => {
	it("the debug label reads left / count", () => {
		expect(pelletDebugText(3, 12)).toBe("pellets 3 / 12");
	});

	it("ThemePack.pellet: both kinds in both bundled packs, the colour role's colour, a placeholder cube", () => {
		for (const manifest of [PLACEHOLDER_MANIFEST, VALE_MANIFEST]) {
			const pack = new ThemePack(manifest, { warn: quiet });
			for (const kind of PELLET_KINDS) {
				const p = pack.pellet(kind);
				expect(p.id).toBe(`pellet.${kind}`);
				expect(p.color).toEqual(pack.color(`pellet.${kind}`));
				if (p.art === undefined) expect(p.placeholder.shape).toBe("Block");
				expect(pack.pellet(kind)).toBe(p); // cached
			}
		}
	});

	it("LiveRun.pellets is collected per tick and reset per frame", () => {
		const e = buildEndlessRunConfig(4242);
		const config = { ...e.config, pellets: PELLETS_CONFIG };
		const run = new LiveRun({ seed: 4242, spawnX: e.spawn!.x, spawnZ: e.spawn!.z, config, atBossDoor: false });
		expect(run.state.pellets).never.toBe(undefined);
		expect(run.pellets.count()).toBe(0);
		// An event left by a tick is collected; the next frame starts empty.
		run.state.pellets!.events.swept.push(0);
		run.pellets.collect(run.state);
		expect(run.pellets.count()).toBe(1);
		run.frame(1 / 30, EMPTY_INPUT);
		expect(run.pellets.swept.size()).toBe(0);
	});
});
