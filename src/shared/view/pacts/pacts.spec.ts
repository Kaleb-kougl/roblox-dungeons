// The pacts on screen (docs/FORTUNE.md FO7): the frame's collected pact events; each altar's flame and dimming and its
// floor card (Greed's exact curse and effect, the dim lines, the accept key, touch) for the view player; the HUD hint,
// draft title and Horde chip (its width beside a boost cell, the status row's height); the horde room's edges / pops /
// spawn rings; Greed's deal gap and take pulse; the debug label; the theme accessor; the snapshot's pact fields; and
// a whole Horde room through the run view's collectors: the room clear tally's rows at their un-doubled values and
// its last `horde` segment the doubled half (pellets included), slamming in.
import { describe, expect, it } from "@rbxts/jest-globals";
import type { ActorSpawn } from "shared/dungeon";
import { takeSnapshot } from "shared/play";
import type { EndlessRunFloor, EndlessRunSetup } from "shared/run";
import { altarFloor, frame, pactsSetup, pressPact, skipToFloorAny, stepWith, teleport } from "shared/run/testing";
import {
	CURSES,
	EMPTY_INPUT,
	HORDE_WAVE_PENDING,
	HordePhase,
	NO_KIND,
	NO_PACT,
	PactDim,
	SHRINE_BUTTON,
	PactKind,
	ScoreSource,
	SimCtx,
	TILE_SIZE,
	createSimState,
	greedCurseFor,
	hordePhase,
	pactDraftKind,
	playerAt,
	step,
	stepParty,
	type ActorState,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { PLACEHOLDER_MANIFEST, ThemeCore, ThemePack, type StringVars } from "shared/theme";
import { BOOST_VIEW } from "shared/view/boosts";
import {
	ROOM_CLEAR,
	RoomClearEvents,
	RoomClearSequence,
	ScorePopTone,
	roomClearBonus,
	roomClearSegments,
	type RoomClear,
} from "shared/view/fx";
import {
	FLOOR_SHOUT_PRIORITY,
	HUD_FOOTPRINT,
	HUD_VIEW,
	floorAxes,
	roomClearTallyText,
	statusEstimate,
	statusRowMaxWidth,
} from "shared/view/hud";
import {
	AltarFlame,
	GreedDealGap,
	HORDE_CHIP,
	PACTS_VIEW,
	PACT_HINT_SEPARATOR,
	PACT_STRINGS,
	PactFrameEvents,
	altarFlameScale,
	draftTitleKey,
	greedPulseAt,
	hordeChipShown,
	hordeChipWidth,
	hordeLiveRoom,
	hordeRingFillOpacity,
	hordeRingRadiusShare,
	hordeWaveFill,
	inHordeRoom,
	newAltarLook,
	pactAltarLook,
	pactCard,
	pactCardCanvasSize,
	pactCardCentre,
	pactCardOpacity,
	pactCardsEqual,
	pactCardsNear,
	pactDebugText,
	pactDimKey,
	pactHintText,
	pactRole,
} from ".";

const SEED = 1337;
const quiet = (): void => {};
/** A fake string table: `key` or `key|a=1|b=2` (vars sorted). */
const str = (key: string, vars?: StringVars): string => {
	if (vars === undefined) return key;
	const parts: string[] = [];
	for (const [k, v] of vars as unknown as ReadonlyMap<string, string | number>) parts.push(`${k}=${v}`);
	parts.sort();
	return [key, ...parts].join("|");
};

/** A pacts run skipped to its first altar floor (solo or a party). */
function altarRun(party = 1): { setup: EndlessRunSetup; s: SimState; floor: number } {
	const setup = pactsSetup(SEED, party);
	const floor = altarFloor(setup);
	expect(floor > 0).toBe(true);
	const s = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
	skipToFloorAny(s, setup.config, floor);
	return { setup, s, floor };
}

describe("pacts view: the altars and their cards (FO7)", () => {
	it("Greed is lit while it is the view player's, dimmed once taken; the Horde an ember, ARMED red once taken", () => {
		const { setup, s } = altarRun();
		const look = newAltarLook();
		expect(pactAltarLook(s, setup.config, 0, PactKind.GREED, look).flame).toBe(AltarFlame.LIT);
		expect([look.placed, look.dim, look.availability]).toEqual([true, false, PactDim.NONE]);
		expect(pactAltarLook(s, setup.config, 0, PactKind.HORDE, look).flame).toBe(AltarFlame.EMBER);
		pressPact(setup, s, PactKind.HORDE);
		expect(hordePhase(s)).toBe(HordePhase.ARMED);
		pactAltarLook(s, setup.config, 0, PactKind.HORDE, look);
		expect([look.flame, look.dim, look.availability]).toEqual([AltarFlame.ARMED, true, PactDim.TAKEN]);
		expect(hordeChipShown(s)).toBe(true);
		pressPact(setup, s, PactKind.GREED);
		pactAltarLook(s, setup.config, 0, PactKind.GREED, look);
		expect([look.flame, look.dim, look.availability]).toEqual([AltarFlame.OFF, true, PactDim.TAKEN]);
	});

	it("the frame collector copies a Greed take: the player, the altar, the curse the card showed", () => {
		const { setup, s } = altarRun();
		const a = s.pacts!;
		const shown = greedCurseFor(s, 0);
		teleport(s, 0, a.altarX[PactKind.GREED], a.altarZ[PactKind.GREED]);
		const ev = new PactFrameEvents();
		stepWith(s, setup.config, 0, SHRINE_BUTTON);
		ev.collect(s);
		expect(ev.taken).toEqual([
			{
				kind: PactKind.GREED,
				player: 0,
				x: a.altarX[PactKind.GREED],
				z: a.altarZ[PactKind.GREED],
				curse: shown,
				tick: s.tick,
			},
		]);
		ev.reset();
		expect(ev.count()).toBe(0);
	});

	it("no altars: nothing placed, no card", () => {
		const s = createSimState(SEED, 0, 0, {});
		const look = pactAltarLook(s, {}, 0, PactKind.GREED, newAltarLook());
		expect([look.placed, look.flame, look.dim]).toEqual([false, AltarFlame.OFF, true]);
		expect(pactCard(s, {}, 0, PactKind.GREED, str, "1")).toBe(undefined);
		expect(pactCardsNear(s, 0)).toBe(false);
	});

	it("Greed's card names the exact curse greedCurseFor gives the view player, its effect, the gain and the key", () => {
		const { setup, s } = altarRun();
		const curse = CURSES[greedCurseFor(s, 0)].id;
		const card = pactCard(s, setup.config, 0, PactKind.GREED, str, "1")!;
		expect(card.dim).toBe(false);
		expect(card.lines.map((l) => [l.text, l.role])).toEqual([
			["pact.greed.title", "pact.greed"],
			[`pact.greed.take|curse=${curse}.name`, "uiText"],
			[`${curse}.desc`, "uiTextDim"],
			["pact.greed.gain", "uiText"],
			["pact.accept|key=1", "pact.greed"],
		]);
		// every line's share fits the card's depth
		let total = 0;
		for (const l of card.lines) total += l.share;
		expect(total <= 1).toBe(true);
		// touch: no accept line (the shrine button reads Accept)
		expect(pactCard(s, setup.config, 0, PactKind.GREED, str, undefined)!.lines.size()).toBe(4);
		const horde = pactCard(s, setup.config, 0, PactKind.HORDE, str, "1")!;
		expect(horde.lines.map((l) => l.text)).toEqual([
			"pact.horde.title",
			"pact.horde.take",
			"pact.horde.gain",
			"pact.accept|key=1",
		]);
		expect(pactCardsEqual(card, pactCard(s, setup.config, 0, PactKind.GREED, str, "1"))).toBe(true);
		expect(pactCardsEqual(card, horde)).toBe(false);
		expect(pactCardsEqual(undefined, undefined)).toBe(true);
	});

	it("a taken altar's card is the title and its dim line, at the dim opacity", () => {
		const { setup, s } = altarRun();
		pressPact(setup, s, PactKind.GREED);
		const card = pactCard(s, setup.config, 0, PactKind.GREED, str, "1")!;
		expect(card.dim).toBe(true);
		expect(card.lines.map((l) => l.text)).toEqual(["pact.greed.title", "pact.dim.taken"]);
		expect(pactCardOpacity(0.55, true)).toBeCloseTo(0.55 * PACTS_VIEW.card.dimOpacity);
		expect(pactCardOpacity(0.55, false)).toBe(0.55);
		expect(pactDimKey(PactDim.NONE)).toBe(undefined);
		expect(pactDimKey(PactDim.NO_ROOM)).toBe("pact.dim.noRoom");
	});

	it("co-op: Greed is per player (the view player's card), the Horde party-wide", () => {
		const { setup, s } = altarRun(2);
		pressPact(setup, s, PactKind.HORDE, 1);
		for (const v of [0, 1]) expect(pactCard(s, setup.config, v, PactKind.HORDE, str, "1")!.dim).toBe(true);
		pressPact(setup, s, PactKind.GREED, 0);
		expect(pactCard(s, setup.config, 0, PactKind.GREED, str, "1")!.dim).toBe(true);
		expect(pactCard(s, setup.config, 1, PactKind.GREED, str, "1")!.dim).toBe(false);
	});

	it("the card stands screen-down of its altar; its canvas keeps glyphs unsquashed; near the altars only", () => {
		const axes = floorAxes();
		const c = pactCardCentre(10, 20, axes);
		const d = PACTS_VIEW.card.offsetTiles * TILE_SIZE;
		expect(c.x).toBeCloseTo(10 - axes.upX * d);
		expect(c.z).toBeCloseTo(20 - axes.upZ * d);
		const [w, h] = pactCardCanvasSize(55);
		expect(w).toBe(PACTS_VIEW.card.widthTiles * PACTS_VIEW.card.canvasPxPerTile);
		expect(h).toBe(
			math.round((w * PACTS_VIEW.card.depthTiles * math.sin(math.rad(55))) / PACTS_VIEW.card.widthTiles),
		);
		const { setup, s } = altarRun();
		const a = s.pacts!;
		teleport(s, 0, a.altarX[0], a.altarZ[0]);
		expect(pactCardsNear(s, 0)).toBe(true);
		teleport(s, 0, a.altarX[0] + 100, a.altarZ[0] + 100);
		expect(pactCardsNear(s, 0)).toBe(false);
		expect(setup).toBeDefined();
	});

	it("the flame flickers only with motion, larger when armed, none when off", () => {
		expect(altarFlameScale(AltarFlame.OFF, 1, 1)).toBe(0);
		expect(altarFlameScale(AltarFlame.LIT, 0.1, 0)).toBe(1);
		expect(altarFlameScale(AltarFlame.ARMED, 0.1, 0)).toBe(PACTS_VIEW.armedScale);
		let moved = false;
		for (let t = 0; t < 1; t += 0.05) if (altarFlameScale(AltarFlame.LIT, t, 1) !== 1) moved = true;
		expect(moved).toBe(true);
	});

	it("the debug label names the pact, the view player's availability and the Horde phase", () => {
		const { setup, s } = altarRun();
		expect(pactDebugText(s, setup.config, 0, PactKind.GREED)).toBe(
			`greed p0: offered curse ${greedCurseFor(s, 0)}\nhorde idle`,
		);
		pressPact(setup, s, PactKind.HORDE);
		expect(pactDebugText(s, setup.config, 0, PactKind.HORDE)).toBe("horde p0: taken\nhorde armed");
	});
});

describe("pacts view: the HUD (FO7)", () => {
	it("the hint: the pact's title and its accept line (the title alone on touch)", () => {
		expect(pactHintText(PactKind.GREED, "1", str)).toBe(`pact.greed.title${PACT_HINT_SEPARATOR}pact.accept|key=1`);
		expect(pactHintText(PactKind.HORDE, undefined, str)).toBe("pact.horde.title");
		expect([pactRole(PactKind.GREED), pactRole(PactKind.HORDE)]).toEqual(["pact.greed", "pact.horde"]);
	});

	it("the draft title: Greed's deal reads PACT OF GREED, every other draft the usual", () => {
		expect(draftTitleKey(PactKind.GREED)).toBe("hud.draft.title.greed");
		expect(draftTitleKey(NO_PACT)).toBe("hud.draft.title");
		const { setup, s } = altarRun();
		pressPact(setup, s, PactKind.GREED);
		expect(draftTitleKey(pactDraftKind(s, 0))).toBe(PACT_STRINGS.draftTitleGreed);
	});

	it("the Horde chip shares the boost row: chip + one boost cell fit the status row, at the row's height", () => {
		const cell = BOOST_VIEW.iconSize + BOOST_VIEW.iconBarGap + BOOST_VIEW.barWidth;
		const w = hordeChipWidth(statusRowMaxWidth(), cell, HUD_VIEW.gap);
		expect(w + HUD_VIEW.gap + cell).toBe(statusRowMaxWidth());
		expect(w > cell).toBe(true);
		// the row is the boost row's height, so the status estimate (one boost row) and its budget are unchanged
		const e = statusEstimate(BOOST_VIEW.iconSize);
		expect(e.h).toBeLessThanOrEqual(HUD_FOOTPRINT.status.maxH);
		expect(HORDE_CHIP.textSize <= HUD_VIEW.smallText).toBe(true);
		expect(hordeChipWidth(10, 20, 6)).toBe(0);
	});

	it("the snapshot: the altar offered under the local player, the Greed draft, the Horde armed", () => {
		const { setup, s } = altarRun();
		const snap = () =>
			takeSnapshot(s, { paused: false, outcome: "playing", recordedTicks: 0, config: setup.config });
		const a = s.pacts!;
		teleport(s, 0, a.altarX[PactKind.HORDE], a.altarZ[PactKind.HORDE]);
		expect([snap().atShrine, snap().shrinePact, snap().hordeArmed]).toEqual([true, PactKind.HORDE, false]);
		pressPact(setup, s, PactKind.HORDE);
		expect([snap().atShrine, snap().shrinePact, snap().hordeArmed]).toEqual([false, -1, true]);
		pressPact(setup, s, PactKind.GREED);
		expect(snap().draftPact).toBe(PactKind.GREED);
		teleport(s, 0, a.altarX[PactKind.GREED] + 50, a.altarZ[PactKind.GREED] + 50);
		expect(snap().shrinePact).toBe(-1);
	});

	it("the floor shout ranks: new best > the Horde > rank threshold > combo tier", () => {
		const P = FLOOR_SHOUT_PRIORITY;
		expect(P.newBest > P.horde && P.horde > P.rankThreshold && P.rankThreshold > P.comboTier).toBe(true);
	});
});

describe("pacts view: Greed's deal gap and take pulse (FO7)", () => {
	it("a Greed draft begins its reveal after dealDelaySec of unpaused time; an ordinary one at once", () => {
		const g = new GreedDealGap();
		expect(g.step(false, true, 0.1)).toBe(false);
		expect(g.step(true, true, 0.1)).toBe(false);
		expect(g.step(true, true, 0)).toBe(false); // paused: no time passes
		expect(g.step(true, true, PACTS_VIEW.greed.dealDelaySec * 0.6)).toBe(false);
		expect(g.step(true, true, PACTS_VIEW.greed.dealDelaySec * 0.6)).toBe(true);
		expect(g.step(true, true, 0.01)).toBe(true);
		g.step(false, false, 0);
		expect(g.step(true, false, 0)).toBe(true);
	});

	it("the pulse grows and fades over its life; reduced motion fades in place", () => {
		const P = PACTS_VIEW.greed.pulse;
		const a = greedPulseAt(0, 1)!;
		const b = greedPulseAt(P.sec / 2, 1)!;
		expect([a.radiusTiles, a.opacity]).toEqual([P.startTiles, P.maxOpacity]);
		expect(b.radiusTiles > a.radiusTiles && b.opacity < a.opacity).toBe(true);
		expect(greedPulseAt(P.sec / 2, 0)!.radiusTiles).toBe(P.endTiles);
		expect(greedPulseAt(P.sec, 1)).toBe(undefined);
	});
});

describe("pacts view: the theme accessor", () => {
	it("pact.altar: no art in the placeholder pack, the plinth placeholder, cached in the pack", () => {
		const core = new ThemeCore(PLACEHOLDER_MANIFEST, { warn: quiet });
		const t = core.pactAltar();
		expect([t.id, t.art, t.placeholder.shape]).toEqual(["pact.altar", undefined, "Block"]);
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(pack.pactAltar()).toBe(pack.pactAltar());
		expect(pack.pactAltar().art).toBe(undefined);
		expect(typeIs(pack.str(PACT_STRINGS.popHorde, { points: 240 }), "string")).toBe(true);
		expect(pack.str(PACT_STRINGS.popHorde, { points: 240 })).toBe("+240 x2");
	});
});

// ---------------------------------------------------------------------------------------------
// A Horde room through the run view's collectors (horde.spec's set-up: an altar floor's room with planned spawns,
// pellets and >= 12 spawn tiles, its spawns replaced by n swarmers).

interface Horde {
	readonly setup: EndlessRunSetup;
	readonly s: SimState;
	readonly room: number;
	readonly world: EndlessRunFloor;
	readonly pacts: PactFrameEvents;
	readonly clears: RoomClearEvents;
	/** Every horde clear the collectors saw. */
	readonly seen: RoomClear[];
	/** Every pact event the frame collectors saw (one frame per tick here). */
	readonly log: Array<{ roused: number; telegraphed: number; spawned: number; cleared: number; taken: number }>;
}

function hordeRun(n: number): Horde {
	const base = pactsSetup(SEED);
	const floor = altarFloor(base);
	const w = base.endlessFloor(floor);
	let room = -1;
	for (let id = 0; id < w.roomSpawns.size() && room < 0; id++) {
		if (w.roomSpawns[id].size() === 0 || (w.roomSpawnTiles?.[id].size() ?? 0) < 12) continue;
		if (w.pellets === undefined || !w.pellets.room.includes(id)) continue;
		room = id;
	}
	expect(room >= 0).toBe(true);
	const tiles = w.roomSpawnTiles![room];
	const spawns: ActorSpawn[] = [];
	for (let k = 0; k < n; k++) spawns.push({ kind: "swarmer", x: tiles[k].x, z: tiles[k].z });
	const roomSpawns = w.roomSpawns.map((l, id) => (id === room ? spawns : l));
	const roomAffixes = w.roomAffixes!.map((l, id) => (id === room ? spawns.map(() => 0) : l));
	const world: EndlessRunFloor = { ...w, roomSpawns, roomAffixes };
	const endlessFloor = (f: number) => (f === floor ? world : base.endlessFloor(f));
	const setup: EndlessRunSetup = {
		...base,
		config: { ...base.config, endless: { ...base.config.endless!, worldForFloor: endlessFloor } },
		endlessFloor,
	};
	const s = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
	skipToFloorAny(s, setup.config, floor);
	const h: Horde = {
		setup,
		s,
		room,
		world,
		pacts: new PactFrameEvents(),
		clears: new RoomClearEvents(),
		seen: [],
		log: [],
	};
	h.clears.collect(s); // the baseline
	return h;
}

/** One tick (input `buttons` for player 0) as a frame: reset, step, collect, log. */
function tick(h: Horde, mx = 0, mz = 0): void {
	h.pacts.reset();
	h.clears.reset();
	if (h.s.party === undefined) step(h.s, frame(mx, mz), h.setup.config);
	else {
		const inputs: InputFrame[] = [];
		for (let i = 0; i < h.s.party.size; i++) inputs.push(frame(0, 0));
		stepParty(h.s, inputs, h.setup.config);
	}
	h.pacts.collect(h.s);
	h.clears.collect(h.s);
	for (const c of h.clears.clears) h.seen.push(c);
	h.log.push({
		roused: h.pacts.roused.size(),
		telegraphed: h.pacts.telegraphed.size(),
		spawned: h.pacts.spawned.size(),
		cleared: h.pacts.hordeCleared,
		taken: h.pacts.taken.size(),
	});
}

function living(h: Horde): ActorState[] {
	const r = h.s.score!.rooms[h.s.pacts!.horde.record];
	const out: ActorState[] = [];
	for (let m = 0; m < r.memberSlots.size(); m++) {
		const a = h.s.combat.actors[r.memberSlots[m]];
		if (a !== undefined && a.kind !== NO_KIND && a.id === r.memberIds[m] && a.alive !== 0) out.push(a);
	}
	return out;
}

const kctx = new SimCtx();
function kill(h: Horde, a: ActorState): void {
	kctx.bind(h.s, h.world.config, EMPTY_INPUT);
	kctx.killActor(a);
}

function sum(log: Horde["log"], f: "roused" | "telegraphed" | "spawned" | "cleared" | "taken"): number {
	let n = 0;
	for (const e of log) n += e[f];
	return n;
}

describe("pacts view: a Horde room through the run view (FO7 / FO9)", () => {
	it("collects every pact event once; the tally's rows are un-doubled and its last segment the doubled half", () => {
		const h = hordeRun(4);
		const s = h.s;
		// The take, through the frame collector.
		const a = s.pacts!;
		const hx = a.altarX[PactKind.HORDE];
		const hz = a.altarZ[PactKind.HORDE];
		teleport(s, 0, hx, hz);
		h.pacts.reset();
		stepWith(s, h.setup.config, 0, SHRINE_BUTTON);
		h.pacts.collect(s);
		expect(h.pacts.taken).toEqual([{ kind: PactKind.HORDE, player: 0, x: hx, z: hz, curse: -1, tick: s.tick }]);
		expect(h.pacts.count()).toBe(1);
		stepWith(s, h.setup.config, 0, 0);
		expect(hordePhase(s)).toBe(HordePhase.ARMED);
		h.clears.collect(s);

		// Rouse the room: into its centre and back.
		const r = h.world.config.encounter!.rooms[h.room];
		teleport(s, 0, r.cx, r.cz);
		tick(h);
		expect(hordeLiveRoom(s)).toBe(h.room);
		expect(sum(h.log, "roused")).toBe(1);
		teleport(s, 0, h.world.spawnX, h.world.spawnZ);
		tick(h);
		const rec = s.score!.rooms[a.horde.record];
		expect(rec.engageTick >= 0).toBe(true);
		// a kill pop inside the room's bounds is a horde pop
		expect(inHordeRoom(s, (rec.minX + rec.maxX) / 2, (rec.minZ + rec.maxZ) / 2)).toBe(true);
		expect(inHordeRoom(s, rec.maxX + 50, rec.maxZ + 50)).toBe(false);
		expect(ScorePopTone.HORDE).toBe(2);

		// Eat a few of the room's own pellets (doubled), then the first wave down to the trigger.
		const p = s.pellets!;
		let eaten = 0;
		for (let k = 0; k < p.x.size() && eaten < 3; k++) {
			if (p.rec[k] !== a.horde.record || p.taken[k] !== 0 || k === p.power) continue;
			teleport(s, 0, p.x[k], p.z[k]);
			tick(h);
			if (p.taken[k] !== 0) eaten++;
		}
		expect(eaten).toBe(3);
		teleport(s, 0, h.world.spawnX, h.world.spawnZ);
		for (const e of living(h)) kill(h, e);
		tick(h);
		expect(sum(h.log, "telegraphed")).toBe(1);
		expect(hordePhase(s)).toBe(HordePhase.TELEGRAPH);
		const f0 = hordeWaveFill(s, 0);
		expect(f0 >= 0 && f0 < 1).toBe(true);
		tick(h);
		expect(hordeWaveFill(s, 0.5) > f0).toBe(true);
		expect(hordeRingRadiusShare(0, 1)).toBe(PACTS_VIEW.horde.ring.fillFrom);
		expect(hordeRingRadiusShare(0, 0)).toBe(1);
		expect(hordeRingFillOpacity(1)).toBe(PACTS_VIEW.horde.ring.fillOpacity);
		for (let k = 0; k < 200 && a.horde.spawned === HORDE_WAVE_PENDING; k++) tick(h);
		expect(sum(h.log, "spawned")).toBe(1);
		expect(hordeWaveFill(s, 0)).toBe(-1);
		expect(h.seen.size()).toBe(0); // no clear between the waves

		// Wave 2 down: the clear.
		const sc = s.score!;
		for (const e of living(h)) kill(h, e);
		tick(h);
		expect(sum(h.log, "cleared")).toBe(1);
		expect(hordePhase(s)).toBe(HordePhase.CLEARED);
		expect(hordeLiveRoom(s)).toBe(-1);
		expect(h.seen.size()).toBe(1);
		const c = h.seen[0];
		// rows: what the room pays without the pact; the horde segment: every HORDE point of the room
		expect(c.hordePoints).toBe(sc.points[ScoreSource.HORDE]);
		expect(c.hordePoints > 0 && c.hordeBonusPoints > 0).toBe(true);
		expect(c.pelletPoints).toBe(sc.points[ScoreSource.PELLETS]);
		const rows = c.killPoints + c.pelletPoints + c.clearPoints + c.perfectPoints + c.fastPoints + c.sweepPoints;
		const segs = roomClearSegments(c);
		expect(segs[segs.size() - 1]).toEqual({ kind: "horde", value: c.hordePoints });
		let shown = 0;
		for (const e of segs) shown += e.value;
		expect(shown).toBe(rows + c.hordePoints);
		// the bonus that flies carries the clear tick's doubled half
		expect(roomClearBonus(c)).toBe(
			c.clearPoints + c.perfectPoints + c.fastPoints + c.sweepPoints + c.hordeBonusPoints,
		);
		expect(playerAt(s, 0).dead).toBe(0);
	});
});

describe("pacts view: the tally's Horde segment (FO7)", () => {
	const clear = (over: Partial<RoomClear>): RoomClear => ({
		room: 1,
		rooms: 1,
		perfect: true,
		killPoints: 300,
		clearPoints: 250,
		perfectPoints: 500,
		fastPoints: 0,
		pelletPoints: 0,
		sweepPoints: 0,
		hordePoints: 1050,
		hordeBonusPoints: 750,
		x: 0,
		z: 0,
		slot: -1,
		actorId: 0,
		minX: 0,
		maxX: 1,
		minZ: 0,
		maxZ: 1,
		tick: 1,
		...over,
	});
	const STEP = 1 / 60;

	function run(seq: RoomClearSequence, sec: number, each: (t: number) => void): void {
		for (let t = 0; t < sec; t += STEP) {
			seq.beginFrame();
			seq.frame(STEP);
			each(t);
		}
	}

	it("slams in at its full value after the row, once (the cue), scaled; the sequence runs extraSec longer", () => {
		const seq = new RoomClearSequence();
		seq.beginFrame();
		seq.start(clear({}), "full", 1);
		const H = ROOM_CLEAR.horde;
		let slams = 0;
		let maxScale = 1;
		let totalBefore = 0;
		let totalAfter = 0;
		let flewAt = -1;
		let endedAt = -1;
		run(seq, ROOM_CLEAR.totalSec + H.extraSec + 0.2, (t) => {
			const L = seq.look;
			if (L.hordeSlammed) {
				slams++;
				totalAfter = L.total;
			} else if (slams === 0) totalBefore = L.total;
			if (L.tallyScale > maxScale) maxScale = L.tallyScale;
			if (flewAt < 0 && L.flyProgress >= 0) flewAt = t;
			if (endedAt < 0 && !L.active) endedAt = t;
		});
		expect(slams).toBe(1);
		expect(totalBefore).toBe(1050);
		expect(totalAfter).toBe(2100); // doubled at once
		expect(maxScale > 1).toBe(true);
		expect(flewAt).toBeGreaterThanOrEqual(ROOM_CLEAR.fly.startSec + H.extraSec - STEP);
		expect(endedAt).toBeGreaterThanOrEqual(ROOM_CLEAR.totalSec + H.extraSec - STEP);
		expect(seq.look.tallyScale).toBe(1);
	});

	it("reduced motion: no slam motion (colour and text only); a collapse shows it without the cue", () => {
		const seq = new RoomClearSequence();
		seq.beginFrame();
		seq.start(clear({}), "full", 0);
		let maxScale = 1;
		let shown = false;
		run(seq, 1.5, () => {
			maxScale = math.max(maxScale, seq.look.tallyScale);
			if (seq.look.hordeShown) shown = true;
		});
		expect([maxScale, shown]).toEqual([1, true]);
		const b = new RoomClearSequence();
		b.beginFrame();
		b.start(clear({}), "full", 1);
		b.collapse();
		b.frame(STEP);
		expect([b.look.hordeSlammed, b.look.hordeShown, b.look.total]).toEqual([false, true, 2100]);
	});

	it("a clear without the pact keeps today's timeline and segments", () => {
		const c = clear({ hordePoints: 0, hordeBonusPoints: 0 });
		expect(roomClearSegments(c).map((e) => e.kind)).toEqual(["kills", "clear", "perfect"]);
		const seq = new RoomClearSequence();
		seq.beginFrame();
		seq.start(c, "full", 1);
		let endedAt = -1;
		run(seq, 2, (t) => {
			if (endedAt < 0 && !seq.look.active) endedAt = t;
		});
		expect(endedAt).toBeLessThan(ROOM_CLEAR.totalSec + STEP);
	});

	it("the tally row as RichText: every part escaped, the Horde segment in its colour", () => {
		const look = {
			segments: [
				{ kind: "kills" as const, value: 1, shown: 1, started: true },
				{ kind: "horde" as const, value: 2, shown: 2, started: true },
			],
			segmentCount: 2,
			total: 3,
		};
		const s = (key: string, vars?: StringVars) => `<${key}:${vars?.points}>`;
		expect(roomClearTallyText(look, s, "#ff0040")).toBe(
			"&lt;room.clear.line.kills:1&gt;   " +
				'<font color="#ff0040">&lt;room.clear.line.horde:2&gt;</font>   &lt;room.clear.total:3&gt;',
		);
		expect(roomClearTallyText(look, s)).toBe(
			"<room.clear.line.kills:1>   <room.clear.line.horde:2>   <room.clear.total:3>",
		);
	});
});
