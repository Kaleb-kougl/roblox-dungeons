// Draft cards with builds (docs/BUILDS.md BU9): card kinds (the Upgrade card's delta and "was" lines per level, the
// Evolution and Duo cards' names, banners, colours and chips), the reveal's beat per card kind, the boss double draft's
// re-deal flag on a live draft, and every key a card reads in the placeholder pack.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOONS,
	BOON_COUNT,
	BUILDS_CONFIG,
	Boon,
	CardKind,
	DEBUG_FLOOR_BUTTON,
	DEFAULT_BOUNDS,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	DUOS,
	DUO_COUNT,
	Duo,
	Rarity,
	SOLO_PLAYER,
	boonMaxLevel,
	createSimState,
	duoCard,
	grantCard,
	step,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { PLACEHOLDER_MANIFEST, ThemePack, boonIconId, duoIconId } from "shared/theme";
import { PactKind, pactDraftKind } from "shared/sim";
import { altarFloor, frame, pactsSetup, pressPact, skipToFloor } from "shared/run/testing";
import {
	BUILD_DUO_ROLE,
	BUILD_EVOLVED_ROLE,
	draftBeatFor,
	draftCardKinds,
	draftCardModel,
	draftChipArt,
	draftChipCells,
	draftRedealt,
	draftToneRole,
	type DraftCardModel,
	type HudText,
} from "./draftCards";
import { DraftBeat, DraftReveal, revealOrder, type DraftBeatId } from "./draftReveal";
import { PROGRESSION_STRINGS, progressionStringKeys, rarityColorRole, rarityNameKey } from "./progression";

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

/** Every key a HudText reads (its own and its varKeys). */
function keysOf(t: HudText | undefined): string[] {
	if (t === undefined) return [];
	const out = [t.key];
	if (t.varKeys !== undefined) for (const [, v] of pairs(t.varKeys as unknown as Map<string, string>)) out.push(v);
	return out;
}

function modelKeys(m: DraftCardModel): string[] {
	return [...keysOf(m.name), ...keysOf(m.banner), ...keysOf(m.desc), ...keysOf(m.was), ...m.chipIcons];
}

/** Holds `stick` until the solo draft may be confirmed, then one FIRE press on it. */
function confirmSolo(s: SimState, config: SimConfig, stick: InputFrame = frame(0, 0)): void {
	while (s.run!.players[SOLO_PLAYER].draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) step(s, stick, config);
	step(s, { ...stick, buttons: DRAFT_CONFIRM_BUTTON }, config);
}

describe("draft cards by kind (BU9)", () => {
	it("a New card is today's card: name, rarity, level-I line, its rarity's beat and colour, no pips", () => {
		const m = draftCardModel(Boon.SHARPENED, CardKind.NEW)!;
		expect([m.kind, m.boon, m.duo, m.beat, m.tone]).toEqual([
			CardKind.NEW,
			Boon.SHARPENED,
			-1,
			DraftBeat.RARE,
			"rare",
		]);
		expect([m.name.key, m.banner.key, m.desc.key, m.was]).toEqual([
			"boon.sharpened.name",
			rarityNameKey(Rarity.RARE),
			"boon.sharpened.desc",
			undefined,
		]);
		expect([m.level, m.maxLevel, m.chipIcons.size()]).toEqual([0, 0, 0]);
		// A legendary (no levels) and a kind of -1 (no builds) are New cards too.
		expect(draftCardModel(Boon.COMPOSURE, CardKind.NEW)!.beat).toBe(DraftBeat.LEGENDARY);
		expect(draftCardModel(Boon.VOLATILE, -1)!.kind).toBe(CardKind.NEW);
		expect([draftCardModel(-1, CardKind.NEW), draftCardModel(BOON_COUNT, CardKind.NEW)]).toEqual([
			undefined,
			undefined,
		]);
	});

	it("an Upgrade card shows Level II with 2 of 3 pips and only the change: <id>.desc.2, was <id>.desc", () => {
		for (let b = 0; b < BOON_COUNT; b++) {
			if (boonMaxLevel(b) <= 1) continue;
			const id = BOONS[b].id;
			const m = draftCardModel(b, CardKind.UPGRADE)!;
			expect([id, m.kind, m.level, m.maxLevel, m.tone, m.beat]).toEqual([
				id,
				CardKind.UPGRADE,
				2,
				3,
				BOONS[b].rarity === Rarity.RARE ? "rare" : "common",
				draftBeatFor(CardKind.NEW, BOONS[b].rarity),
			]);
			expect([m.name.key, m.banner.key, m.banner.vars, m.desc.key]).toEqual([
				`${id}.name`,
				PROGRESSION_STRINGS.draftLevel,
				{ level: "II" },
				`${id}.desc.2`,
			]);
			expect([m.was!.key, m.was!.varKeys]).toEqual([PROGRESSION_STRINGS.draftWas, { desc: `${id}.desc` }]);
		}
	});

	it("an Evolution card shows the evolved name and line, EVOLVE + the boon, 3 of 3 pips, boon.evolved, the legendary beat", () => {
		for (let b = 0; b < BOON_COUNT; b++) {
			if (boonMaxLevel(b) <= 1) continue;
			const id = BOONS[b].id;
			const m = draftCardModel(b, CardKind.EVOLUTION)!;
			expect([id, m.name.key, m.desc.key, m.banner.key, m.banner.varKeys, m.was]).toEqual([
				id,
				`${id}.evo.name`,
				`${id}.evo.desc`,
				PROGRESSION_STRINGS.draftEvolve,
				{ boon: `${id}.name` },
				undefined,
			]);
			expect([m.level, m.maxLevel, m.tone, m.beat]).toEqual([3, 3, "evolved", DraftBeat.LEGENDARY]);
		}
		expect(draftToneRole("evolved")).toBe(BUILD_EVOLVED_ROLE);
		expect(BUILD_EVOLVED_ROLE).toBe("boon.evolved");
	});

	it("a Duo card shows both boons' icons joined, boon.duo, DUO and the legendary beat (whatever kind is passed)", () => {
		for (let d = 0; d < DUO_COUNT; d++) {
			const duo = DUOS[d];
			const m = draftCardModel(duoCard(d), CardKind.NEW)!;
			expect([m.kind, m.duo, m.boon, m.tone, m.beat, m.level, m.maxLevel]).toEqual([
				CardKind.DUO,
				d,
				-1,
				"duo",
				DraftBeat.LEGENDARY,
				0,
				0,
			]);
			expect([m.name.key, m.desc.key, m.banner.key]).toEqual([
				`${duo.id}.name`,
				`${duo.id}.desc`,
				PROGRESSION_STRINGS.draftDuo,
			]);
			expect(m.chipIcons).toEqual([`${BOONS[duo.a].id}.icon`, `${BOONS[duo.b].id}.icon`]);
			expect(m.chipRoles).toEqual([rarityColorRole(BOONS[duo.a].rarity), rarityColorRole(BOONS[duo.b].rarity)]);
			expect(m.chipArt).toEqual([boonIconId(BOONS[duo.a].id), boonIconId(BOONS[duo.b].id)]);
		}
		expect(draftToneRole("duo")).toBe(BUILD_DUO_ROLE);
		expect(BUILD_DUO_ROLE).toBe("boon.duo");
	});

	it("every key a card of any kind reads exists in the placeholder pack (and the progression keys list them)", () => {
		const p = pack();
		const listed = progressionStringKeys();
		const keys: string[] = [];
		for (let b = 0; b < BOON_COUNT; b++) {
			for (const kind of [CardKind.NEW, CardKind.UPGRADE, CardKind.EVOLUTION]) {
				if (kind !== CardKind.NEW && boonMaxLevel(b) <= 1) continue;
				for (const k of modelKeys(draftCardModel(b, kind)!)) keys.push(k);
			}
		}
		for (let d = 0; d < DUO_COUNT; d++)
			for (const k of modelKeys(draftCardModel(duoCard(d), CardKind.DUO)!)) keys.push(k);
		for (const k of keys) expect([k, p.hasString(k), listed.includes(k)]).toEqual([k, true, true]);
		for (const k of [
			PROGRESSION_STRINGS.draftAgain,
			PROGRESSION_STRINGS.buildTitle,
			PROGRESSION_STRINGS.toastEvolved,
		])
			expect([k, p.hasString(k), listed.includes(k)]).toEqual([k, true, true]);
		// The placeholder's lines read as the plan's: "12 bolts", "was: ... 8 bolts", "EVOLVE · Volatile".
		expect(p.str("boon.volatile.desc.2")).toBe("12 bolts");
		expect(p.str(PROGRESSION_STRINGS.draftWas, { desc: p.str("boon.volatile.desc") })).toBe(
			"was: Enemies you kill burst into a ring of 8 bolts",
		);
		expect(p.str(PROGRESSION_STRINGS.draftEvolve, { boon: p.str("boon.volatile.name") })).toBe("EVOLVE · Volatile");
		expect(p.str(PROGRESSION_STRINGS.draftLevel, { level: "II" })).toBe("Level II");
	});
});

describe("the reveal's beat per card kind (BU9)", () => {
	it("draftBeatFor: Evolution and Duo play the legendary beat; New and Upgrade their rarity's", () => {
		const rows: [number, number, DraftBeatId][] = [
			[CardKind.NEW, Rarity.COMMON, DraftBeat.COMMON],
			[CardKind.NEW, Rarity.RARE, DraftBeat.RARE],
			[CardKind.NEW, Rarity.LEGENDARY, DraftBeat.LEGENDARY],
			[CardKind.UPGRADE, Rarity.COMMON, DraftBeat.COMMON],
			[CardKind.UPGRADE, Rarity.RARE, DraftBeat.RARE],
			[CardKind.EVOLUTION, Rarity.COMMON, DraftBeat.LEGENDARY],
			[CardKind.EVOLUTION, Rarity.RARE, DraftBeat.LEGENDARY],
			[CardKind.DUO, Rarity.COMMON, DraftBeat.LEGENDARY],
			[-1, Rarity.RARE, DraftBeat.RARE],
		];
		for (const [kind, rarity, want] of rows)
			expect([kind, rarity, draftBeatFor(kind as never, rarity as never)]).toEqual([kind, rarity, want]);
	});

	it("a draft of New common, Evolution (of a common boon) and Duo: the common flips alone, then both in ONE legendary beat", () => {
		const models = [
			draftCardModel(Boon.SWIFT_STRIKES, CardKind.NEW)!,
			draftCardModel(Boon.VOLATILE, CardKind.EVOLUTION)!,
			draftCardModel(duoCard(Duo.CHAIN_REACTION), CardKind.DUO)!,
		];
		const beats = models.map((m) => m.beat);
		expect(beats).toEqual([DraftBeat.COMMON, DraftBeat.LEGENDARY, DraftBeat.LEGENDARY]);
		expect(revealOrder(beats)).toEqual([[0], [1, 2]]);
		const reveal = new DraftReveal();
		reveal.begin(beats, false);
		let haloed = false;
		let commonHalo = false;
		let ladder = 0;
		for (let i = 0; i < 600 && !reveal.frame.settled; i++) {
			const f = reveal.step(1 / 60);
			for (const c of f.cues) if (c.id === "sfx.draft.charge") ladder++;
			if (f.cards[1].haloAlpha > 0 && f.cards[2].haloAlpha > 0) haloed = true;
			if (f.cards[0].haloAlpha > 0) commonHalo = true;
		}
		expect([reveal.frame.settled, haloed, commonHalo, ladder > 0]).toEqual([true, true, false, true]);
		expect([reveal.frame.cards[0].beat, reveal.frame.cards[1].beat, reveal.frame.cards[2].beat]).toEqual(beats);
	});

	it("an Upgrade of a rare boon chimes like a rare (no charge)", () => {
		const reveal = new DraftReveal();
		reveal.begin([draftCardModel(Boon.SHARPENED, CardKind.UPGRADE)!.beat], false);
		const ids: string[] = [];
		for (let i = 0; i < 600 && !reveal.frame.settled; i++) for (const c of reveal.step(1 / 60).cues) ids.push(c.id);
		expect([ids.includes("sfx.draft.rare"), ids.includes("sfx.draft.charge")]).toEqual([true, false]);
	});
});

describe("the boss double draft and the card kinds on a live draft (BU9)", () => {
	it("kinds per player at the deal; the re-deal after a boss floor's first pick shows Pick again", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		skipToFloor(s, ARENA, 5);
		grantCard(s, 0, Boon.EMBER_WAKE);
		grantCard(s, 0, Boon.PIERCING_ARROWS);
		grantCard(s, 0, Boon.PIERCING_ARROWS);
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), ARENA);
		const offers = s.run!.players[0].draftOffers;
		const kinds = draftCardKinds(s, 0, offers);
		expect([offers[0], kinds[0], draftRedealt(s, 0)]).toEqual([duoCard(Duo.FIRE_ARROWS), CardKind.DUO, false]);
		for (let i = 0; i < offers.size(); i++) {
			const b = offers[i];
			if (b === Boon.PIERCING_ARROWS) expect(kinds[i]).toBe(CardKind.EVOLUTION);
		}
		confirmSolo(s, ARENA, frame(-0.8, 0.8));
		expect([s.run!.players[0].draftOpen, draftRedealt(s, 0)]).toEqual([1, true]);
		confirmSolo(s, ARENA, frame(-0.8, 0.8));
		expect([s.run!.players[0].draftOpen, draftRedealt(s, 0)]).toEqual([0, false]);
		// A normal floor's single deal never shows it; neither does a run without builds.
		step(s, frame(0, 0), ARENA);
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), ARENA);
		expect([s.run!.players[0].draftOpen, draftRedealt(s, 0)]).toEqual([1, false]);
		const plain = createSimState(SEED, 0, 0, PLAIN);
		step(plain, frame(0, 0, DEBUG_FLOOR_BUTTON), PLAIN);
		expect([plain.run!.players[0].draftOpen, draftRedealt(plain, 0)]).toEqual([1, false]);
		expect(draftCardKinds(plain, 0, plain.run!.players[0].draftOffers).every((k) => k === CardKind.NEW)).toBe(true);
	});
});

describe("a pact's mid-floor draft (docs/FORTUNE.md FO0)", () => {
	it("Greed's one-deal Legendary deal on the floor after a boss floor is never a re-deal (no Pick again)", () => {
		let checked = 0;
		for (let seed = 1; seed <= 40 && checked === 0; seed++) {
			const setup = pactsSetup(seed);
			if (altarFloor(setup, 6, 6) !== 6) continue;
			const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, setup.config);
			skipToFloor(s, setup.config, 6);
			pressPact(setup, s, PactKind.GREED);
			expect(s.run!.players[0].draftOpen).toBe(1);
			expect(s.builds!.players[0].draftsLeft).toBe(1); // 1 < bossFloorDrafts: read alone it would say "re-deal"
			expect(pactDraftKind(s, 0)).toBe(PactKind.GREED);
			expect(draftRedealt(s, 0)).toBe(false);
			checked++;
		}
		expect(checked).toBe(1);
	});
});

describe("draft card icon art (docs/BUILDS.md BU11)", () => {
	const all = () => true;
	const none = () => false;

	it("a boon card of every kind carries its own icon and shows a one-cell chip only with the art", () => {
		for (let b = 0; b < BOON_COUNT; b++) {
			for (const kind of [CardKind.NEW, CardKind.UPGRADE, CardKind.EVOLUTION]) {
				const m = draftCardModel(b, kind)!;
				expect([b, kind, m.chipArt]).toEqual([b, kind, [boonIconId(BOONS[b].id)]]);
				expect([b, kind, m.chipIcons.size()]).toEqual([b, kind, 0]);
				expect([b, kind, draftChipCells(m, draftChipArt(m, all))]).toEqual([b, kind, 1]);
				expect([b, kind, draftChipCells(m, draftChipArt(m, none))]).toEqual([b, kind, 0]);
			}
		}
	});

	it("a Duo card's chip is its own icon in one cell; else two cells, the boons' art only when both halves have it", () => {
		for (let d = 0; d < DUO_COUNT; d++) {
			const m = draftCardModel(duoCard(d), CardKind.NEW)!;
			expect([d, m.duoArt]).toEqual([d, duoIconId(DUOS[d].id)]);
			// the duo's own icon wins (BU11, the duo part): one cell
			expect([d, draftChipArt(m, all), draftChipCells(m, draftChipArt(m, all))]).toEqual([d, [m.duoArt], 1]);
			// without it, the two boons' halves as before
			const boonsOnly = (id: string) => id !== m.duoArt;
			const halves = draftChipArt(m, boonsOnly);
			expect([d, halves.size(), draftChipCells(m, halves)]).toEqual([d, 2, 2]);
			expect([d, draftChipArt(m, none).size(), draftChipCells(m, draftChipArt(m, none))]).toEqual([d, 0, 2]);
			const half = (id: string) => id === m.chipArt[0];
			expect([d, draftChipArt(m, half).size()]).toEqual([d, 0]);
		}
		expect(draftChipArt(undefined, all)).toEqual([]);
		expect(draftChipCells(undefined, [])).toBe(0);
	});
});
