// The build in the HUD (docs/BUILDS.md BU10): the items row's cells (level pips, the evolved frame, joined duo chips)
// and its one-row cap, the Build list, the evolve / duo toasts from the sim's builds events and the snapshot's levels
// and duos.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BUILDS_CONFIG,
	Boon,
	CardKind,
	CURSES,
	DEBUG_FLOOR_BUTTON,
	DEFAULT_BOUNDS,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	DUOS,
	Duo,
	BOONS,
	RELICS,
	Rarity,
	createSimState,
	duoCard,
	grantCard,
	step,
	type EndlessFloorWorld,
	type SimConfig,
} from "shared/sim";
import { PLACEHOLDER_MANIFEST, ThemePack, boonIconId } from "shared/theme";
import { collectRunEvents, takeSnapshot, type RunEventRecord } from "shared/play";
import { frame, skipToFloor } from "shared/run/testing";
import {
	BUILD_HUD_VIEW,
	ITEM_ART_FILL_ROLE,
	itemCellArt,
	buildListRows,
	capBuildList,
	capItemCells,
	itemCellWidth,
	itemPipLayout,
	pauseBuildWidth,
	runItemCells,
} from "./buildHud";
import { BUILD_DUO_ROLE, BUILD_EVOLVED_ROLE, DUO_CHIP_SPAN, draftCardKinds } from "./draftCards";
import { HUD_VIEW } from "./layout";
import { PROGRESSION_STRINGS, rarityColorRole, toastFor } from "./progression";

const SEED = 42;

const arenaWorlds = new Map<number, EndlessFloorWorld>();
function arenaWorld(floor: number): EndlessFloorWorld {
	let w = arenaWorlds.get(floor);
	if (w === undefined) {
		w = {
			floor,
			config: { bounds: DEFAULT_BOUNDS, encounter: { spawns: [], rooms: [], entranceRoom: -1, bossRoom: -1 } },
			bossFloor: false,
			spawnX: 0,
			spawnZ: 0,
			stairX: 1000,
			stairZ: 1000,
			roomSpawns: [],
			roomIdAt: () => -1,
		};
		arenaWorlds.set(floor, w);
	}
	return w;
}

const ARENA: SimConfig = { endless: { runSeed: SEED, worldForFloor: arenaWorld }, scoring: {}, builds: BUILDS_CONFIG };
const PLAIN: SimConfig = { endless: { runSeed: SEED, worldForFloor: arenaWorld }, scoring: {} };

function pack(): ThemePack {
	return new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
}

describe("items row (BU10)", () => {
	it("boons with level pips and the evolved frame, then joined duo chips, relics and curses", () => {
		const cells = runItemCells(
			[Boon.SHARPENED, Boon.VOLATILE, Boon.COMPOSURE],
			[2, 3, 1],
			[Duo.FIRE_ARROWS],
			[0],
			[0],
		);
		expect(cells.map((c) => c.key)).toEqual([
			`b${Boon.SHARPENED}`,
			`b${Boon.VOLATILE}`,
			`b${Boon.COMPOSURE}`,
			"d0",
			"r0",
			"c0",
		]);
		expect(cells.map((c) => [c.level, c.maxLevel, c.frame, c.span])).toEqual([
			[2, 3, undefined, 1],
			[3, 3, BUILD_EVOLVED_ROLE, 1],
			[0, 0, undefined, 1], // a legendary has no levels
			[0, 0, undefined, DUO_CHIP_SPAN],
			[0, 0, undefined, 1],
			[0, 0, undefined, 1],
		]);
		expect(cells[0].fills).toEqual([rarityColorRole(Rarity.RARE)]);
		expect([cells[3].icons, cells[3].fills]).toEqual([
			["boon.emberWake.icon", "boon.piercingArrows.icon"],
			[BUILD_DUO_ROLE, BUILD_DUO_ROLE],
		]);
		expect([cells[4].icons, cells[5].icons, cells[5].curse, cells[4].curse]).toEqual([
			[`${RELICS[0].id}.icon`],
			[`${CURSES[0].id}.icon`],
			true,
			false,
		]);
		// Without builds (no levels): today's row, no pips or frames.
		for (const c of runItemCells([Boon.SHARPENED, Boon.VOLATILE], [], [], [], []))
			expect([c.level, c.maxLevel, c.frame]).toEqual([0, 0, undefined]);
	});

	it("boon cells and duo halves carry their icon art (docs/BUILDS.md BU11); relics and curses none", () => {
		const cells = runItemCells([Boon.SHARPENED], [], [Duo.FIRE_ARROWS], [0], [0]);
		const duo = DUOS[Duo.FIRE_ARROWS];
		expect(cells.map((c) => c.art)).toEqual([
			["ui.boon.sharpened"],
			[boonIconId(BOONS[duo.a].id), boonIconId(BOONS[duo.b].id)],
			undefined,
			undefined,
		]);
		const all = () => true;
		const none = () => false;
		expect(itemCellArt(cells[0], all)).toEqual(["ui.boon.sharpened"]);
		expect(itemCellArt(cells[0], none)).toBe(undefined);
		expect(itemCellArt(cells[1], all)?.size()).toBe(DUO_CHIP_SPAN);
		// A duo chip draws art only when both halves have it.
		expect(itemCellArt(cells[1], (id) => id === boonIconId(BOONS[duo.a].id))).toBe(undefined);
		expect(itemCellArt(cells[2], all)).toBe(undefined);
		expect(itemCellArt(cells[3], all)).toBe(undefined);
		expect(ITEM_ART_FILL_ROLE).toBe("uiPanel");
	});

	it("caps to one row with spans: all when they fit, else the newest after a +N cell", () => {
		const cell = 26;
		const gap = 6;
		expect(itemCellWidth(2, cell, gap)).toBe(58);
		expect(capItemCells([], cell, gap, 100)).toEqual({ first: 0, more: 0, width: 0 });
		expect(capItemCells([1, 2, 1], cell, gap, 200)).toEqual({ first: 0, more: 0, width: 26 + 6 + 58 + 6 + 26 });
		// 224 wide (the status row): 7 single cells fit (7 x 26 + 6 x 6 = 218); an eighth does not.
		expect(capItemCells([1, 1, 1, 1, 1, 1, 1], cell, gap, 224).more).toBe(0);
		const cap = capItemCells([1, 1, 1, 1, 1, 1, 2, 1], cell, gap, 224);
		// "+N" (26) + newest: 1 (32) + duo (64) + 1 (32) + 1 (32) = 186, one more single = 218.
		expect(cap).toEqual({ first: 3, more: 3, width: 218 });
		expect(cap.width <= 224).toBe(true);
	});

	it("pips sit inside the cell in whole px under the label (the status panel's footprint is unchanged)", () => {
		for (const size of [26, 20, 18]) {
			const p = itemPipLayout(size);
			const row = 3 * p.pip + 2 * p.gap;
			expect([size, p.pip === math.floor(p.pip), p.labelHeight + p.pip + p.bottom <= size, row <= size]).toEqual([
				size,
				true,
				true,
				true,
			]);
		}
	});
});

describe("Build list (BU10)", () => {
	it("one row per boon (name, level, its line now; evolved by its evolution) then per duo", () => {
		const rows = buildListRows(
			[Boon.SHARPENED, Boon.VOLATILE, Boon.COMPOSURE, Boon.HEARTY],
			[1, 3, 1, 2],
			[Duo.SHRAPNEL],
		);
		expect(rows.map((r) => [r.name.key, r.level, r.desc.key, r.color])).toEqual([
			["boon.sharpened.name", "I", "boon.sharpened.desc", rarityColorRole(Rarity.RARE)],
			["boon.volatile.evo.name", "III", "boon.volatile.evo.desc", BUILD_EVOLVED_ROLE],
			["boon.composure.name", "", "boon.composure.desc", rarityColorRole(Rarity.LEGENDARY)],
			["boon.hearty.name", "II", "boon.hearty.desc.2", rarityColorRole(Rarity.RARE)],
			["duo.shrapnel.name", "", "duo.shrapnel.desc", BUILD_DUO_ROLE],
		]);
		// Without builds: level-I lines, no levels.
		expect(buildListRows([Boon.VOLATILE], [], []).map((r) => [r.name.key, r.level, r.desc.key])).toEqual([
			["boon.volatile.name", "", "boon.volatile.desc"],
		]);
		expect(buildListRows([], [], []).size()).toBe(0);
		const p = pack();
		for (const r of rows) for (const k of [r.name.key, r.desc.key]) expect([k, p.hasString(k)]).toEqual([k, true]);
	});

	it("caps at maxRows with a +N line; the pause panel's width fits beside the menu", () => {
		expect(capBuildList(5, 12)).toEqual({ shown: 5, more: 0 });
		expect(capBuildList(12, 12)).toEqual({ shown: 12, more: 0 });
		expect(capBuildList(20, 12)).toEqual({ shown: 11, more: 9 });
		const V = BUILD_HUD_VIEW;
		expect(pauseBuildWidth(1920, 1.5, 16)).toBe(V.listWidth);
		expect(pauseBuildWidth(1280, 1, 16)).toBe(V.listWidth);
		expect(pauseBuildWidth(1024, 1, 16)).toBe(
			math.max(
				V.listCompactWidth,
				math.floor((1024 - HUD_VIEW.panelWidth) / 2 - HUD_VIEW.gap - HUD_VIEW.margin - 16),
			),
		);
		expect(pauseBuildWidth(600, 1, 16)).toBe(V.listCompactWidth);
	});
});

describe("the legendaries in the HUD (docs/LEGENDARIES.md LG6)", () => {
	const LEGENDARY_DUOS = [Duo.SUPERNOVA, Duo.SKEWER, Duo.CITADEL, Duo.STONE_HEART];

	it("Overkill and Bastion are legendary cells (no pips) with their icon labels; the four duos joined chips", () => {
		const cells = runItemCells([Boon.OVERKILL, Boon.BASTION], [1, 1], LEGENDARY_DUOS, [], []);
		expect(cells.map((c) => [c.key, c.icons, c.level, c.maxLevel, c.span])).toEqual([
			[`b${Boon.OVERKILL}`, ["boon.overkill.icon"], 0, 0, 1],
			[`b${Boon.BASTION}`, ["boon.bastion.icon"], 0, 0, 1],
			[`d${Duo.SUPERNOVA}`, ["boon.overkill.icon", "boon.volatile.icon"], 0, 0, DUO_CHIP_SPAN],
			[`d${Duo.SKEWER}`, ["boon.overkill.icon", "boon.piercingArrows.icon"], 0, 0, DUO_CHIP_SPAN],
			[`d${Duo.CITADEL}`, ["boon.bastion.icon", "boon.warding.icon"], 0, 0, DUO_CHIP_SPAN],
			[`d${Duo.STONE_HEART}`, ["boon.bastion.icon", "boon.hearty.icon"], 0, 0, DUO_CHIP_SPAN],
		]);
		expect(cells[0].fills).toEqual([rarityColorRole(Rarity.LEGENDARY)]);
		const p = pack();
		for (const c of cells) for (const k of c.icons) expect([k, p.hasString(k)]).toEqual([k, true]);
	});

	it("the Build list names them with their lines; the toasts name the boon / the duo", () => {
		const rows = buildListRows([Boon.OVERKILL, Boon.BASTION], [1, 1], LEGENDARY_DUOS);
		expect(rows.map((r) => [r.name.key, r.level, r.desc.key, r.color])).toEqual([
			["boon.overkill.name", "", "boon.overkill.desc", rarityColorRole(Rarity.LEGENDARY)],
			["boon.bastion.name", "", "boon.bastion.desc", rarityColorRole(Rarity.LEGENDARY)],
			["duo.supernova.name", "", "duo.supernova.desc", BUILD_DUO_ROLE],
			["duo.skewer.name", "", "duo.skewer.desc", BUILD_DUO_ROLE],
			["duo.citadel.name", "", "duo.citadel.desc", BUILD_DUO_ROLE],
			["duo.stoneHeart.name", "", "duo.stoneHeart.desc", BUILD_DUO_ROLE],
		]);
		const p = pack();
		for (const r of rows) for (const k of [r.name.key, r.desc.key]) expect([k, p.hasString(k)]).toEqual([k, true]);
		expect(toastFor("boon", Boon.BASTION)).toEqual({
			key: PROGRESSION_STRINGS.toastBoon,
			nameKey: "boon.bastion.name",
		});
		for (const d of LEGENDARY_DUOS) {
			const t = toastFor("boon", duoCard(d), "duo");
			expect([t.key, t.nameKey !== undefined && p.hasString(t.nameKey)]).toEqual([
				PROGRESSION_STRINGS.toastDuo,
				true,
			]);
		}
	});
});

describe("evolve / duo toasts and the snapshot (BU10)", () => {
	it("toastFor: an evolution names the boon and its evolution, a duo its name, anything else the boon toast", () => {
		expect(toastFor("boon", Boon.VOLATILE, "evolved")).toEqual({
			key: PROGRESSION_STRINGS.toastEvolved,
			varKeys: { boon: "boon.volatile.name", evo: "boon.volatile.evo.name" },
		});
		expect(toastFor("boon", duoCard(Duo.GOLD_RUSH), "duo")).toEqual({
			key: PROGRESSION_STRINGS.toastDuo,
			nameKey: "duo.goldRush.name",
		});
		expect(toastFor("boon", Boon.VOLATILE)).toEqual({
			key: PROGRESSION_STRINGS.toastBoon,
			nameKey: "boon.volatile.name",
		});
		expect(pack().str(PROGRESSION_STRINGS.toastEvolved, { boon: "Volatile", evo: "Cataclysm" })).toBe(
			"Volatile evolved: Cataclysm",
		);
	});

	it("the run events mark an evolution and a duo pick from the builds events; the snapshot carries levels and duos", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		skipToFloor(s, ARENA, 4);
		grantCard(s, 0, Boon.EMBER_WAKE);
		grantCard(s, 0, Boon.PIERCING_ARROWS);
		grantCard(s, 0, Boon.PIERCING_ARROWS);
		const snap = takeSnapshot(s, { paused: false, outcome: "playing", recordedTicks: 0 });
		const ember = snap.boons.indexOf(Boon.EMBER_WAKE);
		const arrows = snap.boons.indexOf(Boon.PIERCING_ARROWS);
		expect([snap.boonLevels[ember], snap.boonLevels[arrows], snap.duos]).toEqual([1, 2, []]);
		expect(snap.boonLevels.size()).toBe(snap.boons.size());
		// Pick whatever the next draft deals; the event says what the sim recorded.
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), ARENA);
		const offers = [...s.run!.players[0].draftOffers];
		const kinds = draftCardKinds(s, 0, offers);
		const events: RunEventRecord[] = [];
		while (s.run!.players[0].draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) step(s, frame(0, 0), ARENA);
		const sel = s.run!.players[0].draftSelected;
		step(s, { ...frame(0, 0), buttons: DRAFT_CONFIRM_BUTTON }, ARENA);
		collectRunEvents(s, 0, events);
		const kind = kinds[sel];
		const want = kind === CardKind.DUO ? "duo" : kind === CardKind.EVOLUTION ? "evolved" : undefined;
		expect([events[0].kind, events[0].index, events[0].build]).toEqual(["boon", offers[sel], want]);
		// A forced duo and evolution through grantCard leave the same events for collectRunEvents.
		const t = createSimState(SEED, 0, 0, ARENA);
		grantCard(t, 0, Boon.EMBER_WAKE);
		grantCard(t, 0, Boon.PIERCING_ARROWS);
		t.run!.players[0].events.draftChosen = duoCard(Duo.FIRE_ARROWS) + 1;
		grantCard(t, 0, duoCard(Duo.FIRE_ARROWS));
		const out: RunEventRecord[] = [];
		collectRunEvents(t, 0, out);
		expect(out[0].build).toBe("duo");
		const snap2 = takeSnapshot(t, { paused: false, outcome: "playing", recordedTicks: 0 });
		expect(snap2.duos).toEqual([Duo.FIRE_ARROWS]);
		// Without builds: no levels, no duos.
		const plain = takeSnapshot(createSimState(SEED, 0, 0, PLAIN), {
			paused: false,
			outcome: "playing",
			recordedTicks: 0,
		});
		expect([plain.boonLevels, plain.duos]).toEqual([[], []]);
	});
});
