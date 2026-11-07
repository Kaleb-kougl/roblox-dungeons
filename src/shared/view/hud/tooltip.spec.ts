// Item tooltips (docs/ITEM_TOOLTIPS.md IT1 / IT2 / IT3): the tooltip models of every owned item, the "+N" cell's,
// the sectioned Build list, the placement (menu sides, the live HUD's spot outside the clear zone) and the hover /
// focus / tap tracker. Every key a model can emit exists in both bundled packs with the vars the model fills.
import { describe, expect, it } from "@rbxts/jest-globals";
import { HUD_SCALE_PERCENTS } from "shared/settings";
import { BOONS, CURSES, DUOS, RELICS, Rarity, boonMaxLevel } from "shared/sim";
import {
	BOOST_KINDS,
	PLACEHOLDER_MANIFEST,
	REQUIRED_STRING_KEYS,
	ThemePack,
	placeholders,
	type ThemeManifest,
} from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import {
	HUD_FOOTPRINT,
	HUD_TEST_TOP_INSET,
	HUD_TEST_VIEWPORTS,
	HUD_VIEW,
	ITEM_TOOLTIP,
	HoverTracker,
	TOOLTIP_STRINGS,
	buildListRows,
	buildListSections,
	clearZoneIn,
	clearZoneRect,
	computeHudScale,
	cornerRect,
	itemNameLine,
	itemRefKey,
	itemTooltip,
	moreTooltip,
	rarityNameKey,
	rectsOverlap,
	runItemCells,
	sameTooltipTarget,
	tooltipPlacement,
	type HoverFrame,
	type HudText,
	type ItemRef,
	type ScreenRect,
	type TooltipFacts,
	type TooltipModel,
	type TooltipTargetHit,
} from "shared/view/hud";

const quiet = (): void => {};
const MANIFESTS: ReadonlyArray<ThemeManifest> = [PLACEHOLDER_MANIFEST, VALE_MANIFEST];

function facts(over: Partial<TooltipFacts>): TooltipFacts {
	return { boons: [], boonLevels: [], duos: [], relics: [], curses: [], boosts: [], ...over };
}

function indices(n: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(i);
	return out;
}

/** Everything owned at once: every boon (at `level`, or no levels), duo, relic, curse and boost. */
function everything(level: number | undefined): TooltipFacts {
	const boons = indices(BOONS.size());
	return facts({
		boons,
		boonLevels: level === undefined ? [] : boons.map((b) => math.min(level, boonMaxLevel(b))),
		duos: indices(DUOS.size()),
		relics: indices(RELICS.size()),
		curses: indices(CURSES.size()),
		boosts: BOOST_KINDS.map((_, k) => ({ kind: k, secondsLeft: 12.3 })),
	});
}

/** A HudText as the client shows it: vars as given, varKeys looked up first. */
function render(pack: ThemePack, t: HudText): string {
	const vars: Record<string, string | number> = {};
	if (t.vars !== undefined) {
		for (const [k, v] of pairs(t.vars as unknown as ReadonlyMap<string, string | number>)) vars[k] = v;
	}
	if (t.varKeys !== undefined) {
		for (const [k, v] of pairs(t.varKeys as unknown as ReadonlyMap<string, string>)) vars[k] = pack.str(v);
	}
	return pack.str(t.key, vars);
}

function texts(m: TooltipModel): HudText[] {
	const out: HudText[] = [m.title, m.kindLine.text];
	for (const l of m.lines) out.push(l.text);
	return out;
}

function sortedNames(t: HudText): string[] {
	const out: string[] = [];
	if (t.vars !== undefined) for (const [k] of pairs(t.vars as unknown as ReadonlyMap<string, unknown>)) out.push(k);
	if (t.varKeys !== undefined) {
		for (const [k] of pairs(t.varKeys as unknown as ReadonlyMap<string, unknown>)) out.push(k);
	}
	out.sort();
	return out;
}

/** Every key and varKey of `t` exists in `manifest` and its template's placeholders are exactly the filled vars. */
function checkText(manifest: ThemeManifest, pack: ThemePack, t: HudText): void {
	expect([t.key, pack.hasString(t.key)]).toEqual([t.key, true]);
	const want = placeholders(manifest.strings[t.key] ?? "");
	want.sort();
	expect([t.key, sortedNames(t)]).toEqual([t.key, want]);
	if (t.varKeys !== undefined) {
		for (const [, v] of pairs(t.varKeys as unknown as ReadonlyMap<string, string>)) {
			expect([v, pack.hasString(v)]).toEqual([v, true]);
			expect([v, placeholders(manifest.strings[v] ?? "").size()]).toEqual([v, 0]);
		}
	}
}

const BOON: ItemRef = { kind: "boon", index: 0 };

function boonIndex(id: string): number {
	return BOONS.findIndex((d) => d.id === id);
}

describe("item tooltips: models (IT1)", () => {
	it("a levelled boon at level I / II: Next, then Evolves into; evolved at its top level", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		const v = boonIndex("boon.volatile");
		expect(v >= 0).toBe(true);
		const at = (level: number) =>
			itemTooltip({ kind: "boon", index: v }, facts({ boons: [v], boonLevels: [level] }))!;
		const one = at(1);
		expect(render(pack, one.title)).toBe("Volatile");
		expect(render(pack, one.kindLine.text)).toBe(`${pack.str(rarityNameKey(BOONS[v].rarity))} boon`);
		expect(one.lines.map((l) => render(pack, l.text))).toEqual([
			"Enemies you kill burst into a ring of 8 bolts",
			"Next: 12 bolts",
		]);
		expect([one.level, one.maxLevel]).toEqual([1, 3]);
		const two = at(2);
		expect(two.lines.map((l) => render(pack, l.text))).toEqual([
			"12 bolts",
			"Evolves into Cataclysm: 16 piercing bolts",
		]);
		expect(two.lines[1].varRoles).toEqual({ evo: "boon.evolved" });
		expect([two.level, two.maxLevel]).toEqual([2, 3]);
		const three = at(3);
		expect(render(pack, three.title)).toBe("Cataclysm");
		expect(three.titleRole).toBe("boon.evolved");
		expect(render(pack, three.kindLine.text)).toBe("Evolution of Volatile");
		expect(three.kindLine.role).toBe("boon.evolved");
		expect(three.lines.map((l) => render(pack, l.text))).toEqual(["16 piercing bolts"]);
		expect([three.level, three.maxLevel]).toEqual([3, 3]);
		expect(three.key).toBe(itemRefKey({ kind: "boon", index: v }));
	});

	it("every boon at every legal level, and without levels (no builds)", () => {
		for (let b = 0; b < BOONS.size(); b++) {
			const def = BOONS[b];
			const ref: ItemRef = { kind: "boon", index: b };
			const max = boonMaxLevel(b);
			// No builds: levels empty -> its one line, no pips.
			const plain = itemTooltip(ref, facts({ boons: [b] }))!;
			expect([def.id, plain.level, plain.maxLevel, plain.lines.size()]).toEqual([def.id, 0, 0, 1]);
			expect(plain.title.key).toBe(`${def.id}.name`);
			expect(plain.lines[0].text.key).toBe(`${def.id}.desc`);
			expect(plain.kindLine.text.varKeys).toEqual({
				rarity: `boon.rarity.${["common", "rare", "legendary"][def.rarity]}`,
			});
			for (let level = 1; level <= max; level++) {
				const m = itemTooltip(ref, facts({ boons: [b], boonLevels: [level] }))!;
				expect(m).toBeDefined();
				if (max <= 1) {
					// A legendary: no levels even with builds.
					expect([def.id, m.level, m.maxLevel, m.lines.size()]).toEqual([def.id, 0, 0, 1]);
				} else if (level >= max) {
					expect([def.id, m.title.key, m.lines.size(), m.level]).toEqual([
						def.id,
						`${def.id}.evo.name`,
						1,
						max,
					]);
					expect(m.lines[0].text.key).toBe(`${def.id}.evo.desc`);
				} else {
					expect([def.id, m.lines.size(), m.level, m.maxLevel]).toEqual([def.id, 2, level, max]);
					expect(m.lines[0].text.key).toBe(level === 1 ? `${def.id}.desc` : `${def.id}.desc.${level}`);
					expect(m.lines[1].text.key).toBe(level + 1 >= max ? TOOLTIP_STRINGS.evolves : TOOLTIP_STRINGS.next);
				}
			}
		}
		// A legendary, levelled run: no pips (like the items row).
		const legendary = BOONS.findIndex((d) => d.rarity === Rarity.LEGENDARY);
		const cell = runItemCells([legendary], [1], [], [], [])[0];
		const m = itemTooltip({ kind: "boon", index: legendary }, facts({ boons: [legendary], boonLevels: [1] }))!;
		expect([m.level, m.maxLevel]).toEqual([cell.level, cell.maxLevel]);
	});

	it("level / maxLevel match the items row's pips for every boon at every level", () => {
		for (let b = 0; b < BOONS.size(); b++) {
			for (let level = 0; level <= boonMaxLevel(b); level++) {
				const cell = runItemCells([b], level > 0 ? [level] : [], [], [], [])[0];
				const m = itemTooltip(BOON_OF(b), facts({ boons: [b], boonLevels: level > 0 ? [level] : [] }))!;
				expect([b, level, m.level, m.maxLevel]).toEqual([b, level, cell.level, cell.maxLevel]);
				expect(cell.ref).toEqual(BOON_OF(b));
			}
		}
	});

	it("every duo: boon.duo, its line and its recipe in the two boons' colours", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		for (let d = 0; d < DUOS.size(); d++) {
			const duo = DUOS[d];
			const m = itemTooltip({ kind: "duo", index: d }, facts({ duos: [d] }))!;
			expect([duo.id, m.titleRole, m.kindLine.role, m.level, m.maxLevel]).toEqual([
				duo.id,
				"boon.duo",
				"boon.duo",
				0,
				0,
			]);
			expect(m.title.key).toBe(`${duo.id}.name`);
			expect(m.lines.map((l) => l.text.key)).toEqual([`${duo.id}.desc`, TOOLTIP_STRINGS.duoFrom]);
			expect(m.lines[1].text.varKeys).toEqual({ a: `${BOONS[duo.a].id}.name`, b: `${BOONS[duo.b].id}.name` });
			expect(render(pack, m.lines[1].text)).toBe(
				`From ${pack.str(`${BOONS[duo.a].id}.name`)} + ${pack.str(`${BOONS[duo.b].id}.name`)}`,
			);
			expect(m.lines[1].varRoles).toEqual({
				a: ["boon.common", "boon.rare", "boon.legendary"][BOONS[duo.a].rarity],
				b: ["boon.common", "boon.rare", "boon.legendary"][BOONS[duo.b].rarity],
			});
		}
	});

	it("every relic, curse and boost", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		for (let r = 0; r < RELICS.size(); r++) {
			const m = itemTooltip({ kind: "relic", index: r }, facts({ relics: [r] }))!;
			expect([m.titleRole, render(pack, m.kindLine.text), m.lines.size()]).toEqual(["uiAccent", "Relic", 1]);
			expect(m.lines[0].text.key).toBe(`${RELICS[r].id}.desc`);
		}
		for (let c = 0; c < CURSES.size(); c++) {
			const m = itemTooltip({ kind: "curse", index: c }, facts({ curses: [c] }))!;
			expect([m.titleRole, m.kindLine.role, render(pack, m.kindLine.text)]).toEqual([
				"uiHealth",
				"uiHealth",
				"Curse",
			]);
			expect(m.lines[0].text.key).toBe(`${CURSES[c].id}.desc`);
		}
		for (let k = 0; k < BOOST_KINDS.size(); k++) {
			const m = itemTooltip({ kind: "boost", index: k }, facts({ boosts: [{ kind: k, secondsLeft: 12.3 }] }))!;
			expect([m.titleRole, render(pack, m.kindLine.text)]).toEqual([`boost.${BOOST_KINDS[k]}`, "Boost"]);
			expect(render(pack, m.title)).toBe(pack.str(`boost.${BOOST_KINDS[k]}.name`));
			expect(m.lines.map((l) => render(pack, l.text))).toEqual([
				pack.str(`boost.${BOOST_KINDS[k]}.desc`),
				"13 s left",
			]);
		}
		// Whole seconds round up; a whole value stays.
		const at = (s: number) =>
			itemTooltip({ kind: "boost", index: 0 }, facts({ boosts: [{ kind: 0, secondsLeft: s }] }))!.lines[1].text
				.vars;
		expect([at(12), at(0.1), at(29.9)]).toEqual([{ seconds: 12 }, { seconds: 1 }, { seconds: 30 }]);
	});

	it("a ref not owned (or unknown) has no tooltip", () => {
		expect(itemTooltip({ kind: "boon", index: 0 }, facts({ boons: [1] }))).toBe(undefined);
		expect(itemTooltip({ kind: "boon", index: 99 }, facts({ boons: [99] }))).toBe(undefined);
		expect(itemTooltip({ kind: "duo", index: 0 }, facts({ duos: [1] }))).toBe(undefined);
		expect(itemTooltip({ kind: "relic", index: 0 }, facts({ relics: [1] }))).toBe(undefined);
		expect(itemTooltip({ kind: "curse", index: 0 }, facts({ curses: [1] }))).toBe(undefined);
		expect(itemTooltip({ kind: "boost", index: 0 }, facts({ boosts: [{ kind: 1, secondsLeft: 3 }] }))).toBe(
			undefined,
		);
		expect(itemTooltip({ kind: "boost", index: 9 }, facts({ boosts: [{ kind: 9, secondsLeft: 3 }] }))).toBe(
			undefined,
		);
		expect(itemTooltip(BOON, facts({}))).toBe(undefined);
		expect(itemNameLine(BOON, facts({}))).toBe(undefined);
	});

	it("the +N cell: Build, `{count} more`, the hidden names in their colours (skipping refs not owned)", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		const v = boonIndex("boon.volatile");
		const f = facts({
			boons: [v],
			boonLevels: [3],
			duos: [0],
			relics: [1],
			curses: [2],
			boosts: [{ kind: 3, secondsLeft: 4 }],
		});
		const refs: ItemRef[] = [
			{ kind: "boon", index: v },
			{ kind: "duo", index: 0 },
			{ kind: "relic", index: 1 },
			{ kind: "curse", index: 2 },
			{ kind: "boost", index: 3 },
			{ kind: "relic", index: 0 },
		];
		const m = moreTooltip(refs, f);
		expect(render(pack, m.title)).toBe("Build");
		expect(render(pack, m.kindLine.text)).toBe("6 more");
		expect(m.lines.map((l) => render(pack, l.text))).toEqual([
			"Cataclysm",
			pack.str(`${DUOS[0].id}.name`),
			pack.str(`${RELICS[1].id}.name`),
			pack.str(`${CURSES[2].id}.name`),
			"Aegis",
		]);
		expect(m.lines.map((l) => l.role)).toEqual(["boon.evolved", "boon.duo", "uiAccent", "uiHealth", "boost.aegis"]);
		expect([m.level, m.maxLevel]).toEqual([0, 0]);
		expect(moreTooltip([], f).lines.size()).toBe(0);
	});

	it("every key and varKey a model can emit exists in both packs with exactly the vars it fills", () => {
		for (const manifest of MANIFESTS) {
			const warnings: string[] = [];
			const pack = new ThemePack(manifest, { warn: (m) => warnings.push(m) });
			for (const level of [undefined, 1, 2, 3]) {
				const f = everything(level);
				const refs: ItemRef[] = [];
				for (const b of f.boons) refs.push({ kind: "boon", index: b });
				for (const d of f.duos) refs.push({ kind: "duo", index: d });
				for (const r of f.relics) refs.push({ kind: "relic", index: r });
				for (const c of f.curses) refs.push({ kind: "curse", index: c });
				for (const e of f.boosts) refs.push({ kind: "boost", index: e.kind });
				for (const ref of refs) {
					const m = itemTooltip(ref, f);
					expect([itemRefKey(ref), m !== undefined]).toEqual([itemRefKey(ref), true]);
					for (const t of texts(m!)) {
						checkText(manifest, pack, t);
						render(pack, t);
					}
				}
				for (const t of texts(moreTooltip(refs, f))) checkText(manifest, pack, t);
				for (const s of buildListSections(f, true)) {
					checkText(manifest, pack, s.title);
					for (const row of s.rows) {
						checkText(manifest, pack, row.name);
						checkText(manifest, pack, row.desc);
					}
				}
			}
			for (const [, key] of pairs(TOOLTIP_STRINGS as unknown as ReadonlyMap<string, string>)) {
				expect([key, pack.hasString(key)]).toEqual([key, true]);
			}
			expect(warnings).toEqual([]);
		}
	});

	it("every TOOLTIP_STRINGS key is required by the contract, and the strings read as intended", () => {
		const keys: string[] = [];
		for (const [, key] of pairs(TOOLTIP_STRINGS as unknown as ReadonlyMap<string, string>)) keys.push(key);
		expect(keys.size()).toBe(18);
		for (const key of keys) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(pack.str(TOOLTIP_STRINGS.kindBoon, { rarity: "Rare" })).toBe("Rare boon");
		expect(pack.str(TOOLTIP_STRINGS.kindEvolved, { boon: "Volatile" })).toBe("Evolution of Volatile");
		expect(pack.str(TOOLTIP_STRINGS.next, { desc: "12 bolts" })).toBe("Next: 12 bolts");
		expect(pack.str(TOOLTIP_STRINGS.duoFrom, { a: "A", b: "B" })).toBe("From A + B");
		expect(pack.str(TOOLTIP_STRINGS.secondsLeft, { seconds: 7 })).toBe("7 s left");
		expect(pack.str(TOOLTIP_STRINGS.more, { count: 3 })).toBe("3 more");
		expect(
			[TOOLTIP_STRINGS.sectionBoons, TOOLTIP_STRINGS.pauseBuild, TOOLTIP_STRINGS.pauseMap].map((k) =>
				pack.str(k),
			),
		).toEqual(["Boons", "Build", "Map"]);
	});
});

function BOON_OF(b: number): ItemRef {
	return { kind: "boon", index: b };
}

describe("item tooltips: Build list sections (IT1)", () => {
	it("Boons, Duos, Relics, Curses, Boosts in order; boon / duo rows exactly buildListRows'", () => {
		const f = facts({
			boons: [3, 0],
			boonLevels: [2, 3],
			duos: [1],
			relics: [2],
			curses: [0, 3],
			boosts: [{ kind: 0, secondsLeft: 5.5 }],
		});
		const s = buildListSections(f, true);
		expect(s.map((x) => x.kind)).toEqual(["boons", "duos", "relics", "curses", "boosts"]);
		expect(s.map((x) => x.title.key)).toEqual([
			"hud.build.boons",
			"hud.build.duos",
			"hud.build.relics",
			"hud.build.curses",
			"hud.build.boosts",
		]);
		const all = buildListRows(f.boons, f.boonLevels, f.duos);
		expect(s[0].rows).toEqual([all[0], all[1]]);
		expect(s[1].rows).toEqual([all[2]]);
		expect(s[2].rows).toEqual([
			{
				key: "r2",
				name: { key: `${RELICS[2].id}.name` },
				level: "",
				desc: { key: `${RELICS[2].id}.desc` },
				color: "uiAccent",
				ref: { kind: "relic", index: 2 },
			},
		]);
		expect(s[3].rows.map((r) => [r.key, r.color, r.level, r.ref.index])).toEqual([
			["c0", "uiHealth", "", 0],
			["c3", "uiHealth", "", 3],
		]);
		expect(s[4].rows).toEqual([
			{
				key: "x0",
				name: { key: "boost.fury.name" },
				level: "",
				desc: { key: TOOLTIP_STRINGS.secondsLeft, vars: { seconds: 6 } },
				color: "boost.fury",
				ref: { kind: "boost", index: 0 },
			},
		]);
		// Every row's ref has a tooltip.
		for (const sec of s)
			for (const r of sec.rows) expect([r.key, itemTooltip(r.ref, f) !== undefined]).toEqual([r.key, true]);
	});

	it("leaves empty sections out, Boosts only when asked; nothing owned is empty", () => {
		expect(buildListSections(facts({}), true)).toEqual([]);
		const f = facts({ relics: [0], boosts: [{ kind: 1, secondsLeft: 2 }] });
		expect(buildListSections(f, true).map((x) => x.kind)).toEqual(["relics", "boosts"]);
		expect(buildListSections(f, false).map((x) => x.kind)).toEqual(["relics"]);
		expect(buildListSections(facts({ curses: [1] }), false).map((x) => x.kind)).toEqual(["curses"]);
		expect(buildListSections(facts({ boons: [0] }), true).map((x) => x.kind)).toEqual(["boons"]);
	});
});

// --- Placement (IT2) ----------------------------------------------------------------------------------------------

const SAFE: ScreenRect = { x: 0, y: 0, w: 1280, h: 720 };
const SIZE = { w: 200, h: 100 };
const OFF = 8;

function menuAt(anchor: ScreenRect, size = SIZE, safe = SAFE) {
	return tooltipPlacement({ anchor, size, safe, source: "menu", offset: OFF });
}

function inside(p: { x: number; y: number }, size: { w: number; h: number }, safe: ScreenRect): boolean {
	return p.x >= safe.x && p.y >= safe.y && p.x + size.w <= safe.x + safe.w && p.y + size.h <= safe.y + safe.h;
}

describe("item tooltips: placement (IT2)", () => {
	it("menu: right of the anchor, else left, else below, else above", () => {
		expect(menuAt({ x: 100, y: 100, w: 300, h: 30 })).toEqual({ x: 408, y: 100 });
		expect(menuAt({ x: 900, y: 100, w: 300, h: 30 })).toEqual({ x: 692, y: 100 });
		const wide = { w: 600, h: 100 };
		expect(menuAt({ x: 340, y: 100, w: 600, h: 30 }, wide)).toEqual({ x: 340, y: 138 });
		expect(menuAt({ x: 340, y: 600, w: 600, h: 30 }, wide)).toEqual({ x: 340, y: 492 });
	});

	it("menu: clamps along the other axis, on every edge", () => {
		// Right side, anchor near the bottom: lifted to fit.
		expect(menuAt({ x: 100, y: 690, w: 300, h: 30 })).toEqual({ x: 408, y: 620 });
		// Left side near the top of a safe area that starts lower.
		const safe: ScreenRect = { x: 0, y: 50, w: 1280, h: 670 };
		expect(menuAt({ x: 900, y: 10, w: 300, h: 30 }, SIZE, safe)).toEqual({ x: 692, y: 50 });
		// Below, the anchor hanging past the left edge: moved right into the safe area.
		const wide = { w: 600, h: 100 };
		expect(menuAt({ x: -50, y: 100, w: 1300, h: 30 }, wide)).toEqual({ x: 0, y: 138 });
		// Above, hanging past the left edge.
		expect(menuAt({ x: -50, y: 600, w: 1300, h: 30 }, wide)).toEqual({ x: 0, y: 492 });
	});

	it("menu: nothing fits: the side needing the least move, clamped; larger than the safe area keeps its corner", () => {
		const big = { w: 700, h: 400 };
		const p = menuAt({ x: 300, y: 200, w: 600, h: 300 }, big);
		expect(inside(p, big, SAFE)).toBe(true);
		const huge = { w: 2000, h: 1000 };
		expect(menuAt({ x: 300, y: 200, w: 100, h: 30 }, huge)).toEqual({ x: 0, y: 0 });
		for (const anchor of [
			{ x: 0, y: 0, w: 10, h: 10 },
			{ x: 1270, y: 0, w: 10, h: 10 },
			{ x: 0, y: 710, w: 10, h: 10 },
			{ x: 1270, y: 710, w: 10, h: 10 },
			{ x: 600, y: 300, w: 80, h: 40 },
		]) {
			expect(inside(menuAt(anchor), SIZE, SAFE)).toBe(true);
		}
	});

	it("hud: under the panel, left-aligned with it; right of it when there is no room below", () => {
		const panel: ScreenRect = { x: 16, y: 16, w: 240, h: 160 };
		const anchor: ScreenRect = { x: 30, y: 140, w: 26, h: 26 };
		const at = (size: { w: number; h: number }, safe = SAFE) =>
			tooltipPlacement({ anchor, size, safe, source: "hud", panel, offset: OFF });
		expect(at({ w: 260, h: 120 })).toEqual({ x: 16, y: 184 });
		// No panel: the anchor is the panel.
		expect(
			tooltipPlacement({ anchor: panel, size: { w: 260, h: 120 }, safe: SAFE, source: "hud", offset: OFF }),
		).toEqual({
			x: 16,
			y: 184,
		});
		// A short screen: below would cover the clear zone, so right of the panel (above the zone).
		const short: ScreenRect = { x: 0, y: 0, w: 1280, h: 330 };
		expect(at({ w: 260, h: 60 }, short)).toEqual({ x: 16, y: 184 }); // narrow enough: left of the zone
		const p = at({ w: 320, h: 50 }, short);
		expect(p).toEqual({ x: 264, y: 16 });
		expect(rectsOverlap({ x: p.x, y: p.y, w: 320, h: 50 }, clearZoneIn(short))).toBe(false);
	});

	it("hud: never overlaps the clear zone while any strip around it can hold the tooltip", () => {
		const safe: ScreenRect = { x: 0, y: 0, w: 1024, h: 768 };
		const panel: ScreenRect = { x: 16, y: 16, w: 240, h: 160 };
		const zone = clearZoneIn(safe);
		for (const size of [
			{ w: 260, h: 140 },
			{ w: 260, h: 150 },
			{ w: 200, h: 400 },
			{ w: 300, h: 100 },
		]) {
			const p = tooltipPlacement({ anchor: panel, size, safe, source: "hud", panel, offset: OFF });
			const r = { x: p.x, y: p.y, w: size.w, h: size.h };
			expect([size.w, size.h, rectsOverlap(r, zone), inside(p, size, safe)]).toEqual([
				size.w,
				size.h,
				false,
				true,
			]);
		}
		// Too big for every strip: inside the safe area, covering the least of the zone it can.
		const huge = { w: 900, h: 700 };
		expect(
			inside(
				tooltipPlacement({ anchor: panel, size: huge, safe, source: "hud", panel, offset: OFF }),
				huge,
				safe,
			),
		).toBe(true);
	});

	it("clearZoneIn is footprint's clearZoneRect for a safe area under a top inset", () => {
		const z = clearZoneIn({ x: 0, y: HUD_TEST_TOP_INSET, w: 844, h: 390 - HUD_TEST_TOP_INSET });
		expect(z).toEqual(clearZoneRect(844, 390, HUD_TEST_TOP_INSET));
	});

	/** The tallest tooltip the spec allows for: title, kind line and `body` lines (reference px, the HUD's sizes). */
	function tooltipSize(scale: number, body: number): { w: number; h: number } {
		const slack = 4;
		const h = ITEM_TOOLTIP.pad * 2 + HUD_VIEW.textSize + slack + (HUD_VIEW.smallText + slack) * (1 + body);
		return { w: ITEM_TOOLTIP.maxWidth * scale, h: h * scale };
	}

	/** The status panel's budget box on a `vw` x `vh` screen under `inset`, a cell in it, the safe area, the zone. */
	function hudCase(vw: number, vh: number, inset: number, tenFoot: boolean, percent: number) {
		const scale = computeHudScale(vw, vh, tenFoot, percent);
		const sh = vh - inset;
		const safe: ScreenRect = { x: 0, y: inset, w: vw, h: sh };
		const b = HUD_FOOTPRINT.status;
		const c = cornerRect(b.corner, b.maxW, b.maxH, vw, sh, scale);
		const panel: ScreenRect = { x: c.x, y: c.y + inset, w: c.w, h: c.h };
		const cell = HUD_VIEW.pad * scale;
		const anchor: ScreenRect = { x: panel.x + cell, y: panel.y + panel.h - cell * 4, w: cell * 3, h: cell * 3 };
		return { scale, safe, panel, anchor, zone: clearZoneRect(vw, vh, inset) };
	}

	/** A boon with Next (4 body lines wrapped) and a "+N" cell's list of six names never enter the zone. */
	function checkHud(vw: number, vh: number, inset: number, tenFoot: boolean, percent: number): void {
		const k = hudCase(vw, vh, inset, tenFoot, percent);
		for (const body of [4, 6]) {
			const size = tooltipSize(k.scale, body);
			const p = tooltipPlacement({
				anchor: k.anchor,
				size,
				safe: k.safe,
				source: "hud",
				panel: k.panel,
				offset: ITEM_TOOLTIP.offset * k.scale,
			});
			const r = { x: p.x, y: p.y, w: size.w, h: size.h };
			const what = [vw, vh, inset, tenFoot, percent, body];
			expect([...what, rectsOverlap(r, k.zone), inside(p, size, k.safe)]).toEqual([...what, false, true]);
		}
	}

	it("hud: never in HUD_CLEAR_ZONE at every HUD scale step on the smallest landscape screen, with and without the top bar", () => {
		const smallest = HUD_TEST_VIEWPORTS[HUD_TEST_VIEWPORTS.size() - 1];
		expect([smallest.x, smallest.y]).toEqual([844, 390]);
		for (const inset of [0, HUD_TEST_TOP_INSET]) {
			for (const percent of HUD_SCALE_PERCENTS) checkHud(smallest.x, smallest.y, inset, false, percent);
		}
	});

	// Ten-foot (a console on a TV) is left out: live HUD tooltips are mouse-only (ITD9), and at its boosted scale a
	// four-line tooltip fits no strip around the zone on a 1280 x 720 screen.
	it("hud: never in HUD_CLEAR_ZONE on every test screen at HUD scales up to 100 %", () => {
		for (const vp of HUD_TEST_VIEWPORTS) {
			for (const inset of [0, HUD_TEST_TOP_INSET]) {
				for (const percent of HUD_SCALE_PERCENTS) {
					if (percent <= 100) checkHud(vp.x, vp.y, inset, false, percent);
				}
			}
		}
	});
});

// --- Tracker (IT2) ------------------------------------------------------------------------------------------------

const RECT: ScreenRect = { x: 10, y: 10, w: 20, h: 20 };
const HUD_HIT: TooltipTargetHit = {
	ref: { kind: "boon", index: 2 },
	rect: RECT,
	source: "hud",
	panel: { x: 0, y: 0, w: 240, h: 160 },
};
const HUD_HIT_2: TooltipTargetHit = {
	ref: { kind: "relic", index: 1 },
	rect: { x: 40, y: 10, w: 20, h: 20 },
	source: "hud",
};
const MENU_HIT: TooltipTargetHit = {
	ref: { kind: "boon", index: 2 },
	rect: { x: 500, y: 300, w: 300, h: 24 },
	source: "menu",
};
const MENU_HIT_2: TooltipTargetHit = {
	ref: { kind: "curse", index: 0 },
	rect: { x: 500, y: 330, w: 300, h: 24 },
	source: "menu",
};
const P = { x: 20, y: 20 };

function frame(over: Partial<HoverFrame>): HoverFrame {
	return {
		nowSec: 0,
		weaponHeld: false,
		weaponPressed: false,
		panelFaded: false,
		hudAllowed: true,
		...over,
	};
}

/** Steps `t` from `from` to `to` seconds every `dt` with the same frame fields, returning the last result. */
function run(t: HoverTracker, from: number, to: number, over: Partial<HoverFrame>, dt = 0.05) {
	let out = t.step(frame({ ...over, nowSec: from }));
	let now = from;
	while (now + dt <= to + 1e-9) {
		now += dt;
		out = t.step(frame({ ...over, nowSec: now }));
	}
	return out;
}

const T = ITEM_TOOLTIP;

describe("item tooltips: HoverTracker (IT2)", () => {
	it("menu: shows after menuDwellSec on the same target, hides at once when the pointer leaves", () => {
		const t = new HoverTracker();
		expect(t.step(frame({ nowSec: 0, pointer: P, hit: MENU_HIT }))).toBe(undefined);
		expect(t.step(frame({ nowSec: T.menuDwellSec - 0.01, pointer: P, hit: MENU_HIT }))).toBe(undefined);
		const shown = t.step(frame({ nowSec: T.menuDwellSec, pointer: P, hit: MENU_HIT }));
		expect(shown).toEqual({ target: MENU_HIT, pinned: false, shownAtSec: T.menuDwellSec });
		// Same object while nothing changes (even with the pointer moving inside the row, or a weapon held: menus ignore it).
		expect(t.step(frame({ nowSec: 1, pointer: { x: 600, y: 310 }, hit: MENU_HIT, weaponHeld: true }))).toBe(shown);
		expect(t.step(frame({ nowSec: 1.05, pointer: P }))).toBe(undefined);
		expect(t.step(frame({ nowSec: 1.06, pointer: P, hit: MENU_HIT }))).toBe(undefined);
	});

	it("changing target restarts the dwell; a new rect of the same target is a new object with the same shownAtSec", () => {
		const t = new HoverTracker();
		run(t, 0, 0.2, { pointer: P, hit: MENU_HIT });
		expect(t.step(frame({ nowSec: 0.25, pointer: P, hit: MENU_HIT_2 }))).toBe(undefined);
		expect(t.step(frame({ nowSec: 0.25 + T.menuDwellSec, pointer: P, hit: MENU_HIT_2 }))?.target).toBe(MENU_HIT_2);
		const a = t.step(frame({ nowSec: 1, pointer: P, hit: MENU_HIT_2 }))!;
		const moved: TooltipTargetHit = { ...MENU_HIT_2, rect: { x: 500, y: 360, w: 300, h: 24 } };
		const b = t.step(frame({ nowSec: 1.1, pointer: P, hit: moved }))!;
		expect(b === a).toBe(false);
		expect([b.target, b.shownAtSec]).toEqual([moved, a.shownAtSec]);
		// A copy with equal fields is the same target at the same rect: the same object.
		expect(t.step(frame({ nowSec: 1.2, pointer: P, hit: { ...moved, rect: { ...moved.rect } } }))).toBe(b);
	});

	it("no pointer (gamepad / touch aim) means no hover", () => {
		const t = new HoverTracker();
		expect(run(t, 0, 2, { hit: MENU_HIT })).toBe(undefined);
		expect(run(t, 2, 4, { hit: HUD_HIT })).toBe(undefined);
	});

	it("hud: shows after hudDwellSec with the pointer still; moving restarts the dwell; once shown moving keeps it", () => {
		const t = new HoverTracker();
		expect(run(t, 0, T.hudDwellSec - 0.05, { pointer: P, hit: HUD_HIT })).toBe(undefined);
		const shown = t.step(frame({ nowSec: T.hudDwellSec, pointer: { x: P.x + 3, y: P.y }, hit: HUD_HIT }));
		expect(shown?.target).toBe(HUD_HIT);
		expect(t.step(frame({ nowSec: 1, pointer: { x: 28, y: 28 }, hit: HUD_HIT }))).toBe(shown);

		const u = new HoverTracker();
		u.step(frame({ nowSec: 0, pointer: P, hit: HUD_HIT }));
		// Moved 4 px (hudStillPx) at 0.3 s: the dwell starts again there.
		expect(u.step(frame({ nowSec: 0.3, pointer: { x: P.x + T.hudStillPx, y: P.y }, hit: HUD_HIT }))).toBe(
			undefined,
		);
		expect(
			u.step(frame({ nowSec: T.hudDwellSec + 0.05, pointer: { x: P.x + T.hudStillPx, y: P.y }, hit: HUD_HIT })),
		).toBe(undefined);
		expect(
			u.step(
				frame({ nowSec: 0.3 + T.hudDwellSec + 0.01, pointer: { x: P.x + T.hudStillPx, y: P.y }, hit: HUD_HIT }),
			)?.target,
		).toBe(HUD_HIT);
		// Slow drift, each frame under the threshold but 4 px in all, also restarts.
		const w = new HoverTracker();
		w.step(frame({ nowSec: 0, pointer: P, hit: HUD_HIT }));
		w.step(frame({ nowSec: 0.1, pointer: { x: P.x + 2, y: P.y }, hit: HUD_HIT }));
		w.step(frame({ nowSec: 0.2, pointer: { x: P.x + 2, y: P.y + 3.5 }, hit: HUD_HIT }));
		expect(w.step(frame({ nowSec: T.hudDwellSec, pointer: { x: P.x + 2, y: P.y + 3.5 }, hit: HUD_HIT }))).toBe(
			undefined,
		);
	});

	it("hud: never while a weapon is held, nor within hudAfterPressSec of a press; hides at once", () => {
		const t = new HoverTracker();
		expect(run(t, 0, 2, { pointer: P, hit: HUD_HIT, weaponHeld: true })).toBe(undefined);
		// Released at 2: a full dwell from there.
		expect(run(t, 2.05, 2.05 + T.hudDwellSec - 0.05, { pointer: P, hit: HUD_HIT })).toBe(undefined);
		const shown = run(t, 2.05 + T.hudDwellSec, 2.6 + T.hudDwellSec, { pointer: P, hit: HUD_HIT });
		expect(shown?.target).toBe(HUD_HIT);
		// A press hides it at once and blocks for hudAfterPressSec, then a full dwell again.
		const pressAt = 4;
		expect(t.step(frame({ nowSec: pressAt, pointer: P, hit: HUD_HIT, weaponPressed: true }))).toBe(undefined);
		expect(
			run(t, pressAt + 0.05, pressAt + T.hudAfterPressSec + T.hudDwellSec - 0.06, { pointer: P, hit: HUD_HIT }),
		).toBe(undefined);
		expect(
			run(t, pressAt + T.hudAfterPressSec + T.hudDwellSec, pressAt + 1.2, { pointer: P, hit: HUD_HIT })?.target,
		).toBe(HUD_HIT);
		// Holding hides it at once.
		expect(t.step(frame({ nowSec: 6, pointer: P, hit: HUD_HIT, weaponHeld: true }))).toBe(undefined);
	});

	it("hud: never over a faded panel or while not allowed (draft, stage cover, pause, run over, setting off)", () => {
		for (const blocked of [{ panelFaded: true }, { hudAllowed: false }] as ReadonlyArray<Partial<HoverFrame>>) {
			const t = new HoverTracker();
			expect(run(t, 0, 2, { pointer: P, hit: HUD_HIT, ...blocked })).toBe(undefined);
			expect(run(t, 2.05, 3, { pointer: P, hit: HUD_HIT })?.target).toBe(HUD_HIT);
			expect(t.step(frame({ nowSec: 3.05, pointer: P, hit: HUD_HIT, ...blocked }))).toBe(undefined);
		}
		// The gates are the HUD's: a menu target ignores them.
		const m = new HoverTracker();
		expect(run(m, 0, 1, { pointer: P, hit: MENU_HIT, panelFaded: true, hudAllowed: false })?.target).toBe(MENU_HIT);
	});

	it("focus shows at once and beats hover; hover returns when focus goes", () => {
		const t = new HoverTracker();
		run(t, 0, 1, { pointer: P, hit: HUD_HIT });
		const f = t.step(frame({ nowSec: 1.05, pointer: P, hit: HUD_HIT, focus: MENU_HIT_2 }));
		expect(f).toEqual({ target: MENU_HIT_2, pinned: false, shownAtSec: 1.05 });
		expect(t.step(frame({ nowSec: 1.1, focus: MENU_HIT_2 }))).toBe(f);
		const g = new HoverTracker();
		expect(g.step(frame({ nowSec: 0, focus: MENU_HIT }))?.target).toBe(MENU_HIT);
		expect(g.step(frame({ nowSec: 0.05 }))).toBe(undefined);
	});

	it("a tap pins (no dwell); the same target again or elsewhere closes; another target moves the pin", () => {
		const t = new HoverTracker();
		const pinned = t.step(frame({ nowSec: 0, tap: MENU_HIT }));
		expect(pinned).toEqual({ target: MENU_HIT, pinned: true, shownAtSec: 0 });
		expect(run(t, 0.05, 2, {})).toBe(pinned);
		expect(t.step(frame({ nowSec: 2.05, tap: MENU_HIT }))).toBe(undefined);
		expect(t.step(frame({ nowSec: 2.1 }))).toBe(undefined);
		t.step(frame({ nowSec: 3, tap: MENU_HIT }));
		expect(t.step(frame({ nowSec: 3.05, tap: MENU_HIT_2 }))?.target).toBe(MENU_HIT_2);
		expect(t.step(frame({ nowSec: 3.1, tap: "elsewhere" }))).toBe(undefined);
		// Focus beats a pin; the pin shows again once focus goes.
		t.step(frame({ nowSec: 4, tap: MENU_HIT }));
		expect(t.step(frame({ nowSec: 4.05, focus: MENU_HIT_2 }))?.target).toBe(MENU_HIT_2);
		expect(t.step(frame({ nowSec: 4.1 }))).toEqual({ target: MENU_HIT, pinned: true, shownAtSec: 4.1 });
		// A pinned live-HUD target closes when the HUD's tooltips are not allowed.
		const h = new HoverTracker();
		expect(h.step(frame({ nowSec: 0, tap: HUD_HIT }))?.pinned).toBe(true);
		expect(h.step(frame({ nowSec: 0.05, hudAllowed: false }))).toBe(undefined);
		expect(h.step(frame({ nowSec: 0.1 }))).toBe(undefined);
	});

	it("reset forgets the pin, the dwell and the last press", () => {
		const t = new HoverTracker();
		t.step(frame({ nowSec: 0, tap: MENU_HIT }));
		t.reset();
		expect(t.step(frame({ nowSec: 0.05 }))).toBe(undefined);
		const u = new HoverTracker();
		u.step(frame({ nowSec: 0, weaponPressed: true }));
		u.reset();
		expect(run(u, 0.05, 0.15 + T.hudDwellSec, { pointer: P, hit: HUD_HIT })?.target).toBe(HUD_HIT);
	});

	it("the +N cell: compared by its hidden refs", () => {
		const a: TooltipTargetHit = {
			...HUD_HIT_2,
			more: [
				{ kind: "boon", index: 1 },
				{ kind: "relic", index: 0 },
			],
		};
		const b: TooltipTargetHit = {
			...HUD_HIT_2,
			more: [
				{ kind: "boon", index: 1 },
				{ kind: "relic", index: 0 },
			],
		};
		const c: TooltipTargetHit = { ...HUD_HIT_2, more: [{ kind: "boon", index: 1 }] };
		expect(sameTooltipTarget(a, b)).toBe(true);
		expect(sameTooltipTarget(a, c)).toBe(false);
		expect(sameTooltipTarget(a, HUD_HIT_2)).toBe(false);
		expect(sameTooltipTarget(MENU_HIT, HUD_HIT)).toBe(false);
		expect(sameTooltipTarget(undefined, undefined)).toBe(true);
		const t = new HoverTracker();
		run(t, 0, T.hudDwellSec + 0.1, { pointer: P, hit: a });
		expect(t.step(frame({ nowSec: 1, pointer: P, hit: b }))?.target).toBe(a);
		// The hidden set changed (a new item taken): the dwell starts again.
		expect(t.step(frame({ nowSec: 1.05, pointer: P, hit: c }))).toBe(undefined);
	});
});
