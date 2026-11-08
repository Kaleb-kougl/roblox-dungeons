// Builds (docs/BUILDS.md BU1 / BU2): the data (three on-kill boons appended, level tables, duos, card ids, effect
// sources and bullet kinds), the opt-in state and its "builds" hash group (appended last), and the card draft: offers
// (pools, type roll, fall-through, pity, no duplicates, the boss double draft's guaranteed duo), grantCard (levels,
// one-off steps, duos), the level values through computeRunMods (Sharpened x Fury / Swift x Frenzy stay exact), the team
// Lingering rule, the boss double draft's re-deal, determinism and co-op. Effects (procs, evolutions, duo rules) are
// BU3+ and not here.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES_SUBSYSTEM,
	BASTION_ARMOR_PIPS,
	BOONS,
	BOON_COUNT,
	BOON_MAX_LEVEL,
	BUILDS_CONFIG,
	BUILDS_SUBSYSTEM,
	GOLDEN_SUBSYSTEM,
	PELLETS_SUBSYSTEM,
	PACTS_SUBSYSTEM,
	BUILD_PLAYER_SCALARS,
	BUILD_PROC_FIELDS,
	BUILD_RULES,
	BUILD_SOURCE_BASE,
	BULLET_KIND_COUNT,
	Boon,
	BulletKind,
	BulletPayload,
	CLASSIC_BOON_COUNT,
	COMBO_WINDOW_TICKS,
	CardKind,
	DEBUG_FLOOR_BUTTON,
	DEFAULT_BOUNDS,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_OFFER_COUNT,
	DUOS,
	DUO_CARD_BASE,
	DUO_COUNT,
	Duo,
	FRENZY_ATTACK_TICKS_PERCENT,
	FURY_DAMAGE_PERCENT,
	GRAZE_MARGIN,
	LEGENDARY_MAX_LEVEL,
	PERCENT,
	PLAYER_BULLET_CAPACITY,
	SCORE_HASH_FIELDS,
	SCORE_SOURCE_COUNT,
	SCORE_SUBSYSTEM,
	Rarity,
	Rng,
	SOLO_PLAYER,
	acceptCurse,
	boonMaxLevel,
	buildSource,
	cardBoon,
	cardDisplay,
	cardDuo,
	cardKind,
	cloneSimState,
	combinedPercent,
	computeRunMods,
	createSimState,
	drawBoonOffers,
	drawCardOffers,
	drawLegendaryOffers,
	duoAvailable,
	duoCard,
	duoPercent,
	grantBoon,
	grantCard,
	grantRelic,
	groupValues,
	hashLayout,
	hashState,
	isBuildSource,
	isDraftOpen,
	legendaryPool,
	playerAt,
	runMods,
	scalePercent,
	scaleTicks,
	sourceEffect,
	sourceGen,
	step,
	stepParty,
	teamComboWindowTicks,
	writeHashFields,
	BALLISTA_BOLT_COUNTS,
	BALLISTA_CHARGE_PERCENT,
	BALLISTA_FANS,
	BALLISTA_RINGS,
	BOW_DATA,
	BUILD_PIN_FIELDS,
	BUILD_WAVE_FIELDS,
	BUILD_WORLD_SCALARS,
	BreakableSource,
	BuildEffect,
	OVERCAP_POINTS,
	ProcKind,
	RIPOSTE_MAX_COUNT,
	STILL_NONE,
	ScoreSource,
	WRECKER_SPLINTERS,
	bowChargeTicks,
	buildsHashNames,
	clearBuildProcs,
	createTreasureState,
	ENDLESS_TREASURE_CONFIG,
	TREASURE_SUBSYSTEM,
	type BuildRules,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig, buildTutorialRunConfig } from "shared/run";
import { frame, skipToFloor } from "shared/run/testing";

const SEED = 42;

// ---------------------------------------------------------------------------------------------
// An open endless arena (every floor the same greybox square, no rooms; floors end by the debug skip only), with or
// without builds, solo or a party.

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
const PLAIN_ARENA: SimConfig = { endless: { runSeed: SEED, worldForFloor: arenaWorld }, scoring: {} };
const PARTY_ARENA: SimConfig = { ...ARENA, scoring: { partySize: 2 }, party: { size: 2 } };

const rp = (s: SimState, i = SOLO_PLAYER) => s.run!.players[i];
const bp = (s: SimState, i = SOLO_PLAYER) => s.builds!.players[i];

function zeros(): number[] {
	const out: number[] = [];
	for (let b = 0; b < BOON_COUNT; b++) out.push(0);
	return out;
}

/** Levels with `owned` boons at the given levels. */
function levelsOf(owned: ReadonlyArray<readonly [number, number]>): number[] {
	const out = zeros();
	for (const [b, l] of owned) out[b] = l;
	return out;
}

/** Holds `stick` until the solo draft may be confirmed, then one FIRE press on it. */
function confirmSolo(s: SimState, config: SimConfig, stick: InputFrame = frame(0, 0)): void {
	while (rp(s).draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) step(s, stick, config);
	step(s, { ...stick, buttons: DRAFT_CONFIRM_BUTTON }, config);
}

// ---------------------------------------------------------------------------------------------

describe("builds data (BU1)", () => {
	it("appends Chain Spark (rare), Volatile (common) and Soul Shards (rare) at 12 / 13 / 14; the classic draft keeps 12", () => {
		expect([Boon.CHAIN_SPARK, Boon.VOLATILE, Boon.SOUL_SHARDS]).toEqual([12, 13, 14]);
		expect([BOON_COUNT, CLASSIC_BOON_COUNT]).toEqual([20, 12]);
		const rows = [12, 13, 14].map((b) => [BOONS[b].id, BOONS[b].rarity, BOONS[b].category]);
		expect(rows).toEqual([
			["boon.chainSpark", Rarity.RARE, "offense"],
			["boon.volatile", Rarity.COMMON, "offense"],
			["boon.soulShards", Rarity.RARE, "offense"],
		]);
		// BUD1: legendaries stay level I, everything else goes to III.
		for (let b = 0; b < BOON_COUNT; b++) {
			const want = BOONS[b].rarity === Rarity.LEGENDARY ? LEGENDARY_MAX_LEVEL : BOON_MAX_LEVEL;
			expect([b, boonMaxLevel(b)]).toEqual([b, want]);
		}
		expect([LEGENDARY_MAX_LEVEL, BOON_MAX_LEVEL, boonMaxLevel(BOON_COUNT)]).toEqual([1, 3, 0]);
		// The classic draft never offers an on-kill boon.
		const rng = new Rng(3);
		for (let i = 0; i < 400; i++) for (const b of drawBoonOffers(rng, [], 1 + (i % 12))) expect(b < 12).toBe(true);
	});

	it("appends the legendaries Overkill (offense) and Bastion (defense) at 15 / 16 (docs/LEGENDARIES.md LG1), level I only", () => {
		expect([Boon.OVERKILL, Boon.BASTION]).toEqual([15, 16]);
		const rows = [15, 16].map((b) => [BOONS[b].id, BOONS[b].rarity, BOONS[b].category, boonMaxLevel(b)]);
		expect(rows).toEqual([
			["boon.overkill", Rarity.LEGENDARY, "offense", LEGENDARY_MAX_LEVEL],
			["boon.bastion", Rarity.LEGENDARY, "defense", LEGENDARY_MAX_LEVEL],
		]);
		// Four legendaries in all: Ember Wake, Composure, Overkill, Bastion.
		const legendaries: number[] = [];
		for (let b = 0; b < BOON_COUNT; b++) if (BOONS[b].rarity === Rarity.LEGENDARY) legendaries.push(b);
		expect(legendaries).toEqual([Boon.EMBER_WAKE, Boon.COMPOSURE, Boon.OVERKILL, Boon.BASTION]);
		// The tutorial's draft (drawBoonOffers, no builds) draws from the classic 12 only, at every floor's rarity.
		const rng = new Rng(17);
		for (let i = 0; i < 2000; i++) {
			for (const b of drawBoonOffers(rng, [], 1 + (i % 20))) {
				expect(b < CLASSIC_BOON_COUNT).toBe(true);
				expect(b !== Boon.OVERKILL && b !== Boon.BASTION).toBe(true);
			}
		}
	});

	it("twenty duos (append only): two distinct boons each, no pair twice; every boon in 1-4", () => {
		expect(DUO_COUNT).toBe(20);
		expect([Duo.FIRE_ARROWS, Duo.UNSHAKEN]).toEqual([0, 8]);
		// docs/LEGENDARIES.md LG1: each new legendary anchors two duos; Stone Heart is Hearty's first.
		expect([Duo.SUPERNOVA, Duo.SKEWER, Duo.CITADEL, Duo.STONE_HEART]).toEqual([9, 10, 11, 12]);
		expect([9, 10, 11, 12].map((d) => [DUOS[d].id, DUOS[d].a, DUOS[d].b])).toEqual([
			["duo.supernova", Boon.OVERKILL, Boon.VOLATILE],
			["duo.skewer", Boon.OVERKILL, Boon.PIERCING_ARROWS],
			["duo.citadel", Boon.BASTION, Boon.WARDING],
			["duo.stoneHeart", Boon.BASTION, Boon.HEARTY],
		]);
		const seen = new Set<string>();
		const uses = zeros();
		for (const d of DUOS) {
			expect([d.id, d.a !== d.b, BOONS[d.a] !== undefined, BOONS[d.b] !== undefined]).toEqual([
				d.id,
				true,
				true,
				true,
			]);
			const key = d.a < d.b ? `${d.a}:${d.b}` : `${d.b}:${d.a}`;
			expect(seen.has(key)).toBe(false);
			seen.add(key);
			uses[d.a] += 1;
			uses[d.b] += 1;
			expect(d.id.sub(1, 4)).toBe("duo.");
		}
		// docs/BUILDS_V2.md "Duos": after wave 1 every boon has a duo (Deep Flask's first is Happy Hour); the anchors.
		expect([uses[Boon.HEARTY], uses[Boon.DEEP_FLASK]]).toEqual([2, 1]);
		expect([uses[Boon.OVERKILL], uses[Boon.BASTION]]).toEqual([2, 3]);
		expect([uses[Boon.RIPOSTE], uses[Boon.BALLISTA], uses[Boon.WRECKER], uses[Boon.EMBER_WAKE]]).toEqual([
			3, 1, 1, 3,
		]);
		for (let b = 0; b < BOON_COUNT; b++) expect([b, uses[b] >= 1 && uses[b] <= 4]).toEqual([b, true]);
		// Chain Spark and Volatile are the hubs (Storm Blade, Conductor, Chain Reaction, Thunder Guard; Shrapnel, Chain
		// Reaction, Supernova, Powder Keg).
		expect([uses[Boon.CHAIN_SPARK], uses[Boon.VOLATILE]]).toEqual([4, 4]);
		expect([DUOS[Duo.FIRE_ARROWS].a, DUOS[Duo.FIRE_ARROWS].b]).toEqual([Boon.EMBER_WAKE, Boon.PIERCING_ARROWS]);
		expect([DUOS[Duo.CHAIN_REACTION].a, DUOS[Duo.CHAIN_REACTION].b]).toEqual([Boon.VOLATILE, Boon.CHAIN_SPARK]);
	});

	it("card ids: a boon is its index, a duo DUO_CARD_BASE + its index; the decoders and the display", () => {
		expect(DUO_CARD_BASE).toBe(64);
		for (let b = 0; b < BOON_COUNT; b++) expect([cardBoon(b), cardDuo(b)]).toEqual([b, -1]);
		for (let d = 0; d < DUO_COUNT; d++) {
			const card = duoCard(d);
			expect([card, cardBoon(card), cardDuo(card)]).toEqual([64 + d, -1, d]);
			expect(cardDisplay(card)).toEqual({ id: DUOS[d].id, rarity: Rarity.LEGENDARY });
		}
		for (const bad of [-1, BOON_COUNT, DUO_CARD_BASE - 1, DUO_CARD_BASE + DUO_COUNT, 0.5]) {
			expect([bad, cardBoon(bad), cardDuo(bad), cardDisplay(bad)]).toEqual([bad, -1, -1, undefined]);
		}
		expect(cardDisplay(Boon.VOLATILE)).toBe(BOONS[Boon.VOLATILE]);
		// Card kinds follow the player's level; without builds every boon card is NEW.
		const s = createSimState(SEED, 0, 0, ARENA);
		expect(cardKind(s, 0, Boon.VOLATILE)).toBe(CardKind.NEW);
		grantCard(s, 0, Boon.VOLATILE);
		expect(cardKind(s, 0, Boon.VOLATILE)).toBe(CardKind.UPGRADE);
		grantCard(s, 0, Boon.VOLATILE);
		expect(cardKind(s, 0, Boon.VOLATILE)).toBe(CardKind.EVOLUTION);
		expect([cardKind(s, 0, duoCard(0)), cardKind(s, 0, 40)]).toEqual([CardKind.DUO, -1]);
		expect(cardKind(createSimState(SEED, 0, 0, PLAIN_ARENA), 0, Boon.SHARPENED)).toBe(CardKind.NEW);
	});

	it("effect bullets: four new kinds in the payload's 4 bits; effect sources 128..255 carry effect and generation", () => {
		const kinds = [BulletKind.BURST, BulletKind.SHARD, BulletKind.EMBER, BulletKind.SPARK_BOLT];
		expect(kinds).toEqual([8, 9, 10, 11]);
		for (const k of kinds) expect(k < BULLET_KIND_COUNT).toBe(true);
		expect(BUILD_SOURCE_BASE).toBe(128);
		const maxSource = BulletPayload.max("source");
		expect(buildSource(31, 3)).toBe(maxSource);
		for (let e = 0; e < 32; e++) {
			for (let g = 0; g < 4; g++) {
				const src = buildSource(e, g);
				expect([src, isBuildSource(src), sourceEffect(src), sourceGen(src)]).toEqual([src, true, e, g]);
			}
		}
		// A weapon's source (1..127) is the player's own shot: no effect, generation 0.
		for (const src of [0, 1, 4, 127])
			expect([isBuildSource(src), sourceEffect(src), sourceGen(src)]).toEqual([false, -1, 0]);
	});

	it("the rules: offer percents, GEN_MAX 3, 24 procs per tick, 160 effect bullets of the 512 player slots", () => {
		const r = BUILD_RULES;
		expect([r.upgradePercent, r.evolutionWeight, r.duoPercentBase, r.duoPercentPerFloor, r.duoPercentMax]).toEqual([
			35, 2, 20, 2, 40,
		]);
		expect([r.upgradePityCards, r.bossFloorDrafts, r.floorDrafts]).toEqual([3, 2, 1]);
		expect([r.genMax, r.procsPerTick, r.effectBulletsMax]).toEqual([3, 24, 160]);
		expect(r.effectBulletsMax < PLAYER_BULLET_CAPACITY).toBe(true);
		expect(BUILDS_CONFIG).toBe(BUILD_RULES);
		// duoPercent: 20 + 2 per floor cleared, at most 40.
		expect([1, 5, 9, 10, 11, 30].map((f) => duoPercent(r, f))).toEqual([22, 30, 38, 40, 40, 40]);
	});
});

// ---------------------------------------------------------------------------------------------

describe("opt-in state and the builds hash group (BU1)", () => {
	it("endless worlds set BUILDS_CONFIG (solo and co-op); the tutorial does not", () => {
		for (const n of [1, 2]) expect(buildEndlessRunConfig(1337, n).config.builds).toBe(BUILDS_CONFIG);
		expect(buildTutorialRunConfig().config.builds).toBe(undefined);
		const t = buildTutorialRunConfig();
		const f1 = t.endlessFloor(1);
		expect(createSimState(1, f1.spawnX, f1.spawnZ, t.config).builds).toBe(undefined);
	});

	it("an endless run hashes a builds group after affixes (pellets, treasure, pacts, then golden after it), a name per value, = writeHashFields", () => {
		for (const n of [1, 3]) {
			const setup = buildEndlessRunConfig(1337, n);
			const f1 = setup.endlessFloor(1);
			const s = createSimState(1337, f1.spawnX, f1.spawnZ, setup.config);
			const layout = hashLayout(s, true);
			const names = layout.groups.map((g) => g.name);
			expect([
				names[names.size() - 6],
				names[names.size() - 5],
				names[names.size() - 4],
				names[names.size() - 3],
				names[names.size() - 2],
				names[names.size() - 1],
			]).toEqual([
				AFFIXES_SUBSYSTEM,
				BUILDS_SUBSYSTEM,
				PELLETS_SUBSYSTEM,
				TREASURE_SUBSYSTEM,
				PACTS_SUBSYSTEM,
				GOLDEN_SUBSYSTEM,
			]);
			const g = layout.groups[layout.groups.size() - 5];
			expect([layout.names[g.start], layout.values[g.start]]).toEqual(["builds.players.length", n]);
			expect(layout.names[g.start + 1]).toBe("builds.players[0].levels.length");
			expect(layout.values[g.start + 1]).toBe(BOON_COUNT);
			expect(layout.names.size()).toBe(layout.values.size());
			// docs/BUILDS_V2.md BV1: after the procs, the pins and waves (empty) and the world's two Stillwater scalars.
			expect([
				layout.names[g.finish - 5],
				layout.names[g.finish - 4],
				layout.names[g.finish - 3],
				layout.names[g.finish - 2],
				layout.names[g.finish - 1],
			]).toEqual([
				"builds.procs.length",
				"builds.pins.length",
				"builds.waves.length",
				"builds.stillCombo",
				"builds.stillTick",
			]);
			expect(layout.values[g.finish - 1]).toBe(STILL_NONE);
			expect(layout.values).toEqual(writeHashFields(s, []));
			// 1 + per player (1 + 20 levels + 1 duos length + 14 scalars: BU5 appended bulwarkPending, BU6 closeGrazes,
			// docs/LEGENDARIES.md LG1 braceCount and braceReady, the owner's tuning braceCooldown, docs/BUILDS_V2.md BV1
			// riposteCount, overcap, happyHourTicks, BV6 rebukePending) + procs, pins and waves lengths + 2 world scalars.
			expect(g.finish - g.start).toBe(1 + n * (1 + BOON_COUNT + 1 + 14) + 3 + 2);
			const scalars = layout.names.filter((name) => name.sub(1, 19) === "builds.players[0].b");
			expect(scalars).toEqual([
				"builds.players[0].bigHits",
				"builds.players[0].bulwarkPending",
				"builds.players[0].braceCount",
				"builds.players[0].braceReady",
				"builds.players[0].braceCooldown",
			]);
		}
	});

	it("without SimConfig.builds nothing is created or hashed; with it only the appended last group and the score's build-only source differ", () => {
		const setup = buildEndlessRunConfig(SEED);
		const spawn = setup.spawn!;
		// Pellets (docs/PELLETS.md PL5), treasure (docs/TREASURE.md TR5), pacts (docs/FORTUNE.md PS5) and the Goldling
		// (docs/FORTUNE.md GE3) left out of both: they would pad the Jackpot source without builds too.
		const withConfig: SimConfig = {
			...setup.config,
			pellets: undefined,
			treasure: undefined,
			pacts: undefined,
			golden: undefined,
		};
		const without: SimConfig = {
			...setup.config,
			builds: undefined,
			pellets: undefined,
			treasure: undefined,
			pacts: undefined,
			golden: undefined,
		};
		const a = createSimState(SEED, spawn.x, spawn.z, without);
		const b = createSimState(SEED, spawn.x, spawn.z, withConfig);
		expect(a.builds).toBe(undefined);
		for (let t = 0; t <= 120; t++) {
			const la = hashLayout(a);
			const lb = hashLayout(b);
			expect(la.groups.map((g) => g.name).includes(BUILDS_SUBSYSTEM)).toBe(false);
			const last = lb.groups[lb.groups.size() - 1];
			expect(last.name).toBe(BUILDS_SUBSYSTEM);
			expect(lb.groups.size()).toBe(la.groups.size() + 1);
			// BU5: a builds run's score group also holds the build-only sources (Jackpot) after the points and after
			// the counts (0 here); every other group is identical.
			for (let gi = 0; gi < la.groups.size(); gi++) {
				const ga = la.groups[gi];
				const gb = lb.groups[gi];
				const va = groupValues(la, ga);
				const want: number[] = [];
				if (ga.name === SCORE_SUBSYSTEM) {
					const f = SCORE_HASH_FIELDS.size();
					const c = SCORE_SOURCE_COUNT;
					for (let i = 0; i < va.size(); i++) {
						want.push(va[i]);
						if (i === f + c - 1 || i === f + 2 * c - 1) want.push(0);
					}
				} else for (const v of va) want.push(v);
				expect([t, gb.name, ...groupValues(lb, gb)]).toEqual([t, ga.name, ...want]);
			}
			const input = frame(t % 40 < 20 ? 1 : -1, 0.3);
			step(a, input, without);
			step(b, input, withConfig);
		}
	});

	it("clone: an independent copy, mods rebuilt at the clone's levels", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		grantCard(s, 0, Boon.SHARPENED);
		grantCard(s, 0, Boon.SHARPENED);
		const c = cloneSimState(s);
		expect(hashState(c)).toBe(hashState(s));
		expect(runMods(c, 0).damagePercent).toBe(150);
		grantCard(c, 0, Boon.SHARPENED);
		expect([bp(s).levels[Boon.SHARPENED], bp(c).levels[Boon.SHARPENED]]).toEqual([2, 3]);
		expect([runMods(s, 0).damagePercent, runMods(c, 0).damagePercent]).toEqual([150, 175]);
	});
});

// ---------------------------------------------------------------------------------------------

describe("card offers (BU2 drawCardOffers)", () => {
	/** A random build for seed `k`: some boons at random levels, some duos taken. */
	function randomBuild(k: number): [number[], number[]] {
		const rng = new Rng(k * 7919 + 1);
		const levels = zeros();
		for (let b = 0; b < BOON_COUNT; b++) {
			const roll = rng.int(0, 3);
			levels[b] = roll === 0 ? 0 : roll > boonMaxLevel(b) ? boonMaxLevel(b) : roll;
		}
		const duos: number[] = [];
		for (let d = 0; d < DUO_COUNT; d++) if (duoAvailable(levels, [], d) && rng.int(0, 1) === 0) duos.push(d);
		return [levels, duos];
	}

	it("never offers a maxed boon, a taken duo or a duo with a boon missing; no duplicates; at most one duo", () => {
		for (let k = 0; k < 600; k++) {
			const [levels, duos] = randomBuild(k);
			const floor = 1 + (k % 15);
			const offers = drawCardOffers(new Rng(k), BUILD_RULES, levels, duos, floor, k % 4 === 0);
			expect(new Set(offers).size()).toBe(offers.size());
			let duoCards = 0;
			for (const card of offers) {
				const b = cardBoon(card);
				const d = cardDuo(card);
				if (d >= 0) {
					duoCards += 1;
					expect([k, card, duoAvailable(levels, duos, d)]).toEqual([k, card, true]);
				} else {
					expect([k, card, b >= 0, levels[b] < boonMaxLevel(b)]).toEqual([k, card, true, true]);
				}
			}
			expect([k, duoCards <= 1]).toEqual([k, true]);
		}
	});

	it("a fresh build is offered three new boons (the on-kill boons included); a full build none", () => {
		const seen = new Set<number>();
		for (let k = 0; k < 300; k++) {
			const offers = drawCardOffers(new Rng(k), BUILD_RULES, zeros(), [], 1 + (k % 10));
			expect(offers.size()).toBe(DRAFT_OFFER_COUNT);
			for (const c of offers) seen.add(c);
		}
		for (const b of [Boon.CHAIN_SPARK, Boon.VOLATILE, Boon.SOUL_SHARDS]) expect(seen.has(b)).toBe(true);
		const full = zeros();
		for (let b = 0; b < BOON_COUNT; b++) full[b] = boonMaxLevel(b);
		const allDuos: number[] = [];
		for (let d = 0; d < DUO_COUNT; d++) allDuos.push(d);
		const rng = new Rng(5);
		const before = rng.getState();
		expect(drawCardOffers(rng, BUILD_RULES, full, allDuos, 7)).toEqual([]);
		// One draw: the first type roll found nothing to give.
		expect(rng.getState()).never.toBe(before);
		// Only two duos left and nothing else: one duo per draft, so one card.
		const twoLeft = allDuos.filter((d) => d > 1);
		expect(drawCardOffers(new Rng(5), BUILD_RULES, full, twoLeft, 7).size()).toBe(1);
	});

	it("upgrade pity: an owned upgradable boon always shows up in a full draft, as the last card when no roll gave it", () => {
		const noUpgrades: BuildRules = { ...BUILD_RULES, upgradePercent: 0, duoPercentBase: 0, duoPercentPerFloor: 0 };
		const levels = levelsOf([[Boon.VOLATILE, 1]]);
		for (let k = 0; k < 300; k++) {
			const offers = drawCardOffers(new Rng(k), noUpgrades, levels, [], 3);
			expect([k, offers.size(), offers[2]]).toEqual([k, 3, Boon.VOLATILE]);
			expect([offers[0] === Boon.VOLATILE, offers[1] === Boon.VOLATILE]).toEqual([false, false]);
		}
		// With the game's rules too: every full draft has an upgrade or evolution card.
		const owned = levelsOf([
			[Boon.SHARPENED, 2],
			[Boon.EMBER_WAKE, 1],
		]);
		for (let k = 0; k < 300; k++) {
			const offers = drawCardOffers(new Rng(k), BUILD_RULES, owned, [], 1 + (k % 9));
			expect([k, offers.includes(Boon.SHARPENED)]).toEqual([k, true]);
			// The legendary at level I is maxed: never offered again.
			expect(offers.includes(Boon.EMBER_WAKE)).toBe(false);
		}
	});

	it("an evolution weighs EVOLUTION_WEIGHT against an upgrade in the upgrade pick", () => {
		const onlyUpgrades: BuildRules = {
			...BUILD_RULES,
			upgradePercent: 100,
			duoPercentBase: 0,
			duoPercentPerFloor: 0,
		};
		const levels = levelsOf([
			[Boon.SWIFT_STRIKES, 1],
			[Boon.SLIPPERY, 2],
		]);
		let evolutionFirst = 0;
		const n = 6000;
		const rng = new Rng(11);
		for (let i = 0; i < n; i++)
			if (drawCardOffers(rng, onlyUpgrades, levels, [], 2)[0] === Boon.SLIPPERY) evolutionFirst++;
		const share = evolutionFirst / n;
		print(`[builds] evolution picked first ${"%.3f".format(share)} (want ${"%.3f".format(2 / 3)})`);
		expect(math.abs(share - 2 / 3) < 0.03).toBe(true);
	});

	it("duos: offered only with both boons owned; the boss draft's first deal guarantees one as card 0", () => {
		const one = levelsOf([[Boon.EMBER_WAKE, 1]]);
		const both = levelsOf([
			[Boon.EMBER_WAKE, 1],
			[Boon.PIERCING_ARROWS, 3],
		]);
		let duoSeen = 0;
		for (let k = 0; k < 400; k++) {
			for (const c of drawCardOffers(new Rng(k), BUILD_RULES, one, [], 10)) expect(cardDuo(c)).toBe(-1);
			const offers = drawCardOffers(new Rng(k), BUILD_RULES, both, [], 10);
			if (offers.includes(duoCard(Duo.FIRE_ARROWS))) duoSeen++;
			const boss = drawCardOffers(new Rng(k), BUILD_RULES, both, [], 10, true);
			expect([k, boss[0], boss.size()]).toEqual([k, duoCard(Duo.FIRE_ARROWS), 3]);
			// A taken duo is never offered, guaranteed or not.
			for (const c of drawCardOffers(new Rng(k), BUILD_RULES, both, [Duo.FIRE_ARROWS], 10, true)) {
				expect(cardDuo(c)).toBe(-1);
			}
		}
		// The duo band after floor 10 is 40 % per card (at most one per draft): seen in well over a third of drafts.
		print(`[builds] Fire Arrows offered in ${duoSeen} / 400 drafts after floor 10`);
		expect(duoSeen > 150).toBe(true);
	});

	it("is deterministic: the same rng state and build give the same offers and leave the same state", () => {
		for (let k = 0; k < 100; k++) {
			const [levels, duos] = randomBuild(k);
			const a = new Rng(k);
			const b = new Rng(k);
			expect(drawCardOffers(a, BUILD_RULES, levels, duos, 6, k % 2 === 0)).toEqual(
				drawCardOffers(b, BUILD_RULES, levels, duos, 6, k % 2 === 0),
			);
			expect(a.getState()).toBe(b.getState());
		}
	});
});

// ---------------------------------------------------------------------------------------------

describe("legendaries Overkill and Bastion (docs/LEGENDARIES.md LG1)", () => {
	it("the appended hashed fields: per player braceCount / braceReady after closeGrazes, per proc excess after id", () => {
		expect(BUILD_PLAYER_SCALARS).toEqual([
			"grazes",
			"kills",
			"arrows",
			"bigHits",
			"draftsLeft",
			"bulwarkPending",
			"closeGrazes",
			"braceCount",
			"braceReady",
			"braceCooldown",
			"riposteCount",
			"overcap",
			"happyHourTicks",
			"rebukePending",
		]);
		expect(BUILD_PROC_FIELDS).toEqual(["x", "z", "owner", "gen", "slot", "id", "excess", "kind"]);
		const s = createSimState(SEED, 0, 0, ARENA);
		expect([bp(s).braceCount, bp(s).braceReady, bp(s).levels.size()]).toEqual([0, 0, BOON_COUNT]);
		const c = cloneSimState(s);
		c.builds!.players[0].braceReady = 1;
		expect([bp(s).braceReady, hashState(c) !== hashState(s)]).toEqual([0, true]);
		// Citadel's cooldown (the owner's tuning, LGD14): appended last, hashed, cloned.
		expect(bp(s).braceCooldown).toBe(0);
		const d = cloneSimState(s);
		d.builds!.players[0].braceCooldown = 5;
		expect([
			bp(s).braceCooldown,
			hashState(d) !== hashState(s),
			cloneSimState(d).builds!.players[0].braceCooldown,
		]).toEqual([0, true, 5]);
	});

	it("a fresh build is dealt both as New cards; once owned (level I is their only level) neither comes back", () => {
		const seen = new Set<number>();
		for (let k = 0; k < 1500; k++) {
			// Floor 11+: the legendary band is at its 15 % cap.
			for (const c of drawCardOffers(new Rng(k), BUILD_RULES, zeros(), [], 11 + (k % 5))) seen.add(c);
		}
		expect([seen.has(Boon.OVERKILL), seen.has(Boon.BASTION)]).toEqual([true, true]);
		const owned = levelsOf([
			[Boon.OVERKILL, 1],
			[Boon.BASTION, 1],
			[Boon.SHARPENED, 1],
			[Boon.WARDING, 2],
		]);
		for (let k = 0; k < 600; k++) {
			const offers = drawCardOffers(new Rng(k), BUILD_RULES, owned, [], 1 + (k % 15), k % 3 === 0);
			expect([k, offers.includes(Boon.OVERKILL), offers.includes(Boon.BASTION)]).toEqual([k, false, false]);
		}
	});

	it("granting: New, then nothing (never an Upgrade or Evolution); Bastion adds its pip once (LG3)", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		const pl = playerAt(s, 0);
		const armor = [pl.armor, pl.armorMax];
		for (const b of [Boon.OVERKILL, Boon.BASTION]) {
			expect(cardKind(s, 0, b)).toBe(CardKind.NEW);
			expect(grantCard(s, 0, b)).toBe(CardKind.NEW);
			// Owned at its only level: grantCard refuses it (and no draw deals it, above).
			expect(grantCard(s, 0, b)).toBe(-1);
			expect(bp(s).levels[b]).toBe(1);
		}
		expect(rp(s).boons).toEqual([Boon.OVERKILL, Boon.BASTION]);
		expect([pl.armor, pl.armorMax]).toEqual([armor[0] + BASTION_ARMOR_PIPS, armor[1] + BASTION_ARMOR_PIPS]);
		expect(s.builds!.events.evolvedBoon).toEqual([]);
		// grantBoon in a builds run goes through grantCard: level I too.
		const t = createSimState(SEED, 0, 0, ARENA);
		grantBoon(t, 0, Boon.BASTION);
		expect([bp(t).levels[Boon.BASTION], rp(t).boons]).toEqual([1, [Boon.BASTION]]);
	});

	it("the four duos become available once both of their boons are owned, and are dealt then", () => {
		for (const d of [Duo.SUPERNOVA, Duo.SKEWER, Duo.CITADEL, Duo.STONE_HEART]) {
			const def = DUOS[d];
			const one = levelsOf([[def.a, 1]]);
			const other = levelsOf([[def.b, 1]]);
			const both = levelsOf([
				[def.a, 1],
				[def.b, 2],
			]);
			expect([d, duoAvailable(one, [], d), duoAvailable(other, [], d), duoAvailable(both, [], d)]).toEqual([
				d,
				false,
				false,
				true,
			]);
			expect(duoAvailable(both, [d], d)).toBe(false);
			// A boss deal's guaranteed duo: the only available one is card 0.
			for (let k = 1; k <= 20; k++) {
				const boss = drawCardOffers(new Rng(k), BUILD_RULES, both, [], 5, true);
				expect([d, k, boss[0]]).toEqual([d, k, duoCard(d)]);
			}
			// Granted once, through grantCard.
			const s = createSimState(SEED, 0, 0, ARENA);
			expect(grantCard(s, 0, duoCard(d))).toBe(-1);
			grantCard(s, 0, def.a);
			grantCard(s, 0, def.b);
			expect([grantCard(s, 0, duoCard(d)), grantCard(s, 0, duoCard(d)), bp(s).duos]).toEqual([
				CardKind.DUO,
				-1,
				[d],
			]);
		}
	});

	it("Greed's deal (drawLegendaryOffers) picks both up: unowned legendaries first, then the duos", () => {
		expect(legendaryPool(zeros(), [])).toEqual([Boon.EMBER_WAKE, Boon.COMPOSURE, Boon.OVERKILL, Boon.BASTION]);
		const levels = levelsOf([
			[Boon.EMBER_WAKE, 1],
			[Boon.COMPOSURE, 1],
			[Boon.OVERKILL, 1],
			[Boon.VOLATILE, 1],
		]);
		expect(legendaryPool(levels, [])).toEqual([Boon.BASTION, duoCard(Duo.SUPERNOVA)]);
		const seen = new Set<number>();
		for (let k = 0; k < 200; k++) for (const c of drawLegendaryOffers(new Rng(k), zeros(), [], 1)) seen.add(c);
		expect([seen.has(Boon.OVERKILL), seen.has(Boon.BASTION), seen.size()]).toEqual([true, true, 4]);
	});
});

// ---------------------------------------------------------------------------------------------

describe("builds v2, wave 1 (docs/BUILDS_V2.md BV1): data and scaffolding, no rules", () => {
	const V2_BOONS = [Boon.RIPOSTE, Boon.BALLISTA, Boon.WRECKER];
	const V2_DUOS = [
		Duo.THUNDER_GUARD,
		Duo.STILLWATER,
		Duo.REBUKE,
		Duo.DRAGON_BOLT,
		Duo.POWDER_KEG,
		Duo.FULL_HEART,
		Duo.HAPPY_HOUR,
	];

	it("appends Riposte (rare), Ballista (rare) and Wrecker (common) at 17 / 18 / 19, offense, levels I-III", () => {
		expect(V2_BOONS).toEqual([17, 18, 19]);
		expect(V2_BOONS.map((b) => [BOONS[b].id, BOONS[b].rarity, BOONS[b].category, boonMaxLevel(b)])).toEqual([
			["boon.riposte", Rarity.RARE, "offense", BOON_MAX_LEVEL],
			["boon.ballista", Rarity.RARE, "offense", BOON_MAX_LEVEL],
			["boon.wrecker", Rarity.COMMON, "offense", BOON_MAX_LEVEL],
		]);
		// The per-level tables (Design): caps, bolts, the charge, splinters; Ballista's ring and fan per level.
		expect([RIPOSTE_MAX_COUNT, BALLISTA_BOLT_COUNTS, BALLISTA_CHARGE_PERCENT, WRECKER_SPLINTERS]).toEqual([
			[6, 10, 10],
			[6, 10, 10],
			[100, 75, 75],
			[3, 5, 5],
		]);
		expect(BALLISTA_RINGS.map((r) => r.count)).toEqual(BALLISTA_BOLT_COUNTS);
		expect(BALLISTA_FANS.map((r) => r.count)).toEqual(BALLISTA_BOLT_COUNTS);
		for (const r of [...BALLISTA_RINGS, ...BALLISTA_FANS]) expect(r.kind).toBe(BulletKind.BURST);
		// The tutorial's draft (drawBoonOffers, no builds) never deals them.
		const rng = new Rng(29);
		for (let i = 0; i < 1000; i++) for (const b of drawBoonOffers(rng, [], 1 + (i % 20))) expect(b < 12).toBe(true);
	});

	it("seven duos at 13-19 (card ids 77-83) with the plan's pairs", () => {
		expect(V2_DUOS).toEqual([13, 14, 15, 16, 17, 18, 19]);
		expect(V2_DUOS.map((d) => [DUOS[d].id, DUOS[d].a, DUOS[d].b, duoCard(d)])).toEqual([
			["duo.thunderGuard", Boon.RIPOSTE, Boon.CHAIN_SPARK, 77],
			["duo.stillwater", Boon.COMPOSURE, Boon.RIPOSTE, 78],
			["duo.rebuke", Boon.BASTION, Boon.RIPOSTE, 79],
			["duo.dragonBolt", Boon.BALLISTA, Boon.EMBER_WAKE, 80],
			["duo.powderKeg", Boon.WRECKER, Boon.VOLATILE, 81],
			["duo.fullHeart", Boon.HEARTY, Boon.SHARPENED, 82],
			["duo.happyHour", Boon.DEEP_FLASK, Boon.BOUNTY, 83],
		]);
	});

	it("the other indices: BuildEffect 9-11, ProcKind, BreakableSource 4 / 5, ScoreSource.OVERCAP 15 (no run holds it yet)", () => {
		expect([BuildEffect.BALLISTA, BuildEffect.WRECKER, BuildEffect.RIPOSTE]).toEqual([9, 10, 11]);
		for (const e of [9, 10, 11]) expect(sourceEffect(buildSource(e, 2))).toBe(e);
		expect([ProcKind.KILL, ProcKind.SMASH]).toEqual([0, 1]);
		expect([BreakableSource.ROLL, BreakableSource.BUILD]).toEqual([4, 5]);
		expect([ScoreSource.OVERCAP, OVERCAP_POINTS]).toEqual([15, 10]);
		// BV9 adds the source; until then an endless run's points / counts end at GOLDEN (15 entries, 0..14).
		const setup = buildEndlessRunConfig(SEED);
		const s = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
		expect([s.score!.points.size(), s.score!.counts.size()]).toEqual([
			ScoreSource.GOLDEN + 1,
			ScoreSource.GOLDEN + 1,
		]);
	});

	it("a fresh build is dealt each as a New card; each reaches II and III (the evolution) through grantCard", () => {
		const seen = new Set<number>();
		for (let k = 0; k < 600; k++)
			for (const c of drawCardOffers(new Rng(k), BUILD_RULES, zeros(), [], 1 + (k % 15))) seen.add(c);
		for (const b of V2_BOONS) expect([b, seen.has(b)]).toEqual([b, true]);
		const s = createSimState(SEED, 0, 0, ARENA);
		for (const b of V2_BOONS) {
			expect([b, cardKind(s, 0, b), grantCard(s, 0, b)]).toEqual([b, CardKind.NEW, CardKind.NEW]);
			expect([b, cardKind(s, 0, b), grantCard(s, 0, b)]).toEqual([b, CardKind.UPGRADE, CardKind.UPGRADE]);
			expect([b, cardKind(s, 0, b), grantCard(s, 0, b)]).toEqual([b, CardKind.EVOLUTION, CardKind.EVOLUTION]);
			expect([b, grantCard(s, 0, b), bp(s).levels[b]]).toEqual([b, -1, 3]);
		}
		expect(s.builds!.events.evolvedBoon).toEqual(V2_BOONS);
		expect(rp(s).boons).toEqual(V2_BOONS);
	});

	it("each of the seven duos is available exactly when both of its boons are owned, dealt then, granted once", () => {
		for (const d of V2_DUOS) {
			const def = DUOS[d];
			const one = levelsOf([[def.a, 1]]);
			const other = levelsOf([[def.b, 1]]);
			const both = levelsOf([
				[def.a, 2],
				[def.b, 1],
			]);
			expect([d, duoAvailable(one, [], d), duoAvailable(other, [], d), duoAvailable(both, [], d)]).toEqual([
				d,
				false,
				false,
				true,
			]);
			expect(duoAvailable(both, [d], d)).toBe(false);
			// Never dealt without both boons (600 drafts each with one of them at level II, boss deals included).
			for (let k = 0; k < 300; k++) {
				const a = drawCardOffers(
					new Rng(k),
					BUILD_RULES,
					levelsOf([[def.a, 2]]),
					[],
					1 + (k % 15),
					k % 2 === 0,
				);
				const b = drawCardOffers(
					new Rng(k),
					BUILD_RULES,
					levelsOf([[def.b, 2]]),
					[],
					1 + (k % 15),
					k % 2 === 0,
				);
				expect([d, k, a.includes(duoCard(d)), b.includes(duoCard(d))]).toEqual([d, k, false, false]);
			}
			// A boss deal's guaranteed duo: the only available one is card 0.
			for (let k = 1; k <= 10; k++) {
				const boss = drawCardOffers(new Rng(k), BUILD_RULES, both, [], 5, true);
				expect([d, k, boss[0]]).toEqual([d, k, duoCard(d)]);
			}
			const s = createSimState(SEED, 0, 0, ARENA);
			expect(grantCard(s, 0, duoCard(d))).toBe(-1);
			grantCard(s, 0, def.a);
			grantCard(s, 0, def.b);
			expect([grantCard(s, 0, duoCard(d)), grantCard(s, 0, duoCard(d)), bp(s).duos]).toEqual([
				CardKind.DUO,
				-1,
				[d],
			]);
		}
	});

	it("the appended hashed state: per player riposteCount / overcap / happyHourTicks, proc kind, pins, waves, Stillwater", () => {
		expect(BUILD_PIN_FIELDS).toEqual(["bullet", "owner", "slot", "id", "x0", "z0", "slam"]);
		expect(BUILD_WAVE_FIELDS).toEqual([
			"owner",
			"x",
			"z",
			"dirX",
			"dirZ",
			"halfCos",
			"radius",
			"range",
			"speed",
			"damage",
			"kind",
		]);
		expect(BUILD_WORLD_SCALARS).toEqual(["stillCombo", "stillTick"]);
		const s = createSimState(SEED, 0, 0, ARENA);
		const b = s.builds!;
		expect([bp(s).riposteCount, bp(s).overcap, bp(s).happyHourTicks]).toEqual([0, 0, 0]);
		expect([b.pins.size(), b.waves.size(), b.stillCombo, b.stillTick]).toEqual([0, 0, 0, STILL_NONE]);
		// Each new field moves the hash, is cloned and is named in the dump in writeHashFields' order.
		const c = cloneSimState(s);
		const cb = c.builds!;
		cb.players[0].riposteCount = 3;
		cb.procs.push({ x: 1, z: 2, owner: 0, gen: 0, slot: -1, id: -1, excess: 0, kind: ProcKind.SMASH });
		cb.pins.push({ bullet: 5, owner: 0, slot: 2, id: 9, x0: 1.5, z0: -2, slam: 0 });
		cb.waves.push({
			owner: 0,
			x: 1,
			z: 2,
			dirX: 0,
			dirZ: 1,
			halfCos: 0.5,
			radius: 0.4,
			range: 7,
			speed: 24,
			damage: 4,
			kind: 0,
			hits: [7, 11],
		});
		cb.stillCombo = 25;
		cb.stillTick = 40;
		expect(hashState(c) !== hashState(s)).toBe(true);
		const d = cloneSimState(c);
		expect(hashState(d)).toBe(hashState(c));
		d.builds!.waves[0].hits.push(13);
		d.builds!.pins[0].slam = 1;
		expect([cb.waves[0].hits, cb.pins[0].slam, hashState(d) !== hashState(c)]).toEqual([[7, 11], 0, true]);
		const layout = hashLayout(c, true);
		const g = layout.groups.find((x) => x.name === BUILDS_SUBSYSTEM)!;
		const names: string[] = [];
		buildsHashNames(cb, names);
		expect(names.size()).toBe(g.finish - g.start);
		for (let k = 0; k < names.size(); k++) expect(layout.names[g.start + k]).toBe(names[k]);
		const tail: string[] = [];
		for (let k = names.size() - 26; k < names.size(); k++) tail.push(names[k]);
		expect(tail).toEqual([
			"builds.procs[0].kind",
			"builds.pins.length",
			"builds.pins[0].bullet",
			"builds.pins[0].owner",
			"builds.pins[0].slot",
			"builds.pins[0].id",
			"builds.pins[0].x0",
			"builds.pins[0].z0",
			"builds.pins[0].slam",
			"builds.waves.length",
			"builds.waves[0].owner",
			"builds.waves[0].x",
			"builds.waves[0].z",
			"builds.waves[0].dirX",
			"builds.waves[0].dirZ",
			"builds.waves[0].halfCos",
			"builds.waves[0].radius",
			"builds.waves[0].range",
			"builds.waves[0].speed",
			"builds.waves[0].damage",
			"builds.waves[0].kind",
			"builds.waves[0].hits.length",
			"builds.waves[0].hits[0]",
			"builds.waves[0].hits[1]",
			"builds.stillCombo",
			"builds.stillTick",
		]);
		expect(layout.values).toEqual(writeHashFields(c, []));
		// The floor change drops the pins and waves with the procs, and Stillwater's record (and, BV2, Riposte's count).
		clearBuildProcs(cb);
		expect([cb.procs.size(), cb.pins.size(), cb.waves.size(), cb.stillCombo, cb.stillTick]).toEqual([
			0,
			0,
			0,
			0,
			STILL_NONE,
		]);
		// BV2: the floor change discards every player's Riposte count (a guard running across it fires nothing).
		expect(cb.players[0].riposteCount).toBe(0);
	});

	it("the new event lists exist, are cloned, and are cleared every tick", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		const e = s.builds!.events;
		const lists = [
			e.waveX,
			e.waveKind,
			e.counterCount,
			e.ballistaWall,
			e.pinStartSlot,
			e.pinEndSlam,
			e.slamStruck,
			e.smashGen,
			e.demolitionOwner,
			e.beamStruck,
			e.happyPlayer,
			e.overcapPoints,
		];
		for (const l of lists) {
			expect(l.size()).toBe(0);
			l.push(1);
		}
		expect(cloneSimState(s).builds!.events.overcapPoints).toEqual([1]);
		step(s, frame(0, 0), ARENA);
		for (const l of lists) expect(l.size()).toBe(0);
	});

	it("bowChargeTicks: BOW_DATA.chargeTicks (36) without Ballista and at Ballista I (100 %)", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		expect(bowChargeTicks(s, 0)).toBe(BOW_DATA.chargeTicks);
		grantCard(s, 0, Boon.BALLISTA);
		expect([bowChargeTicks(s, 0), BOW_DATA.chargeTicks]).toEqual([36, 36]);
		expect(bowChargeTicks(createSimState(SEED, 0, 0, PLAIN_ARENA), 0)).toBe(36);
	});
});

// ---------------------------------------------------------------------------------------------

describe("levels (BU2 grantCard, computeRunMods)", () => {
	it("a boon card: level I (into boons once), II, III (the evolution), then maxed; a legendary stops at I", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		expect(grantCard(s, 0, Boon.VOLATILE)).toBe(CardKind.NEW);
		expect(grantCard(s, 0, Boon.VOLATILE)).toBe(CardKind.UPGRADE);
		expect(s.builds!.events.evolvedBoon).toEqual([]);
		expect(grantCard(s, 0, Boon.VOLATILE)).toBe(CardKind.EVOLUTION);
		expect([s.builds!.events.evolvedPlayer, s.builds!.events.evolvedBoon]).toEqual([[0], [Boon.VOLATILE]]);
		expect(grantCard(s, 0, Boon.VOLATILE)).toBe(-1);
		expect([bp(s).levels[Boon.VOLATILE], rp(s).boons]).toEqual([3, [Boon.VOLATILE]]);
		expect(grantCard(s, 0, Boon.COMPOSURE)).toBe(CardKind.NEW);
		expect(grantCard(s, 0, Boon.COMPOSURE)).toBe(-1);
		expect([bp(s).levels[Boon.COMPOSURE], rp(s).boons]).toEqual([1, [Boon.VOLATILE, Boon.COMPOSURE]]);
		// grantBoon in a builds run is level I through grantCard (and a no-op once owned).
		grantBoon(s, 0, Boon.BOUNTY);
		grantBoon(s, 0, Boon.BOUNTY);
		expect(bp(s).levels[Boon.BOUNTY]).toBe(1);
		// Without builds there is nothing to grant.
		expect(grantCard(createSimState(SEED, 0, 0, PLAIN_ARENA), 0, Boon.VOLATILE)).toBe(-1);
	});

	it("Hearty / Deep Flask / Warding: each level gained applies its step once (+1 / +2 / +3 hearts; +1 / +2 / +2)", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		const pl = playerAt(s, 0);
		const h0 = pl.heartsMax;
		const f0 = pl.flaskMax;
		const a0 = pl.armorMax;
		const hearts: number[] = [];
		const flask: number[] = [];
		const armor: number[] = [];
		for (let l = 0; l < 3; l++) {
			grantCard(s, 0, Boon.HEARTY);
			grantCard(s, 0, Boon.DEEP_FLASK);
			grantCard(s, 0, Boon.WARDING);
			hearts.push(pl.heartsMax - h0);
			flask.push(pl.flaskMax - f0);
			armor.push(pl.armorMax - a0);
		}
		expect([hearts, flask, armor]).toEqual([
			[2, 4, 6],
			[1, 2, 2],
			[1, 2, 2],
		]);
		expect([pl.hearts, pl.flask, pl.armor]).toEqual([pl.heartsMax, pl.flaskMax, pl.armorMax]);
	});

	it("per-level values through runMods (legendaries keep their one level); relics and curses keep the levels", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		const rows: number[][] = [];
		for (let l = 1; l <= 3; l++) {
			for (const b of [
				Boon.SHARPENED,
				Boon.SWIFT_STRIKES,
				Boon.PIERCING_ARROWS,
				Boon.SLIPPERY,
				Boon.LINGERING,
				Boon.DAREDEVIL,
				Boon.BOUNTY,
			])
				grantCard(s, 0, b);
			const m = runMods(s, 0);
			rows.push([
				m.damagePercent,
				m.attackTicksPercent,
				m.bowPierce,
				m.rollIframePercent,
				m.comboWindowTicks,
				m.grazeMargin,
				m.killPointsPercent,
			]);
		}
		expect(rows).toEqual([
			[125, 80, 1, 150, 540, 0.75, 110],
			[150, 70, 2, 175, 660, 0.875, 120],
			[175, 60, 2, 200, 720, 1, 130],
		]);
		// A relic or a curse rebuilds the mods at the same levels (not back to level I).
		grantRelic(s, 0, 0);
		acceptCurse(s, 0, 0);
		expect([runMods(s, 0).damagePercent, runMods(s, 0).bowPierce]).toEqual([175, 2]);
		expect(runMods(s, 0)).toEqual(computeRunMods(rp(s), bp(s)));
		// Without a build, an owned boon is level I: exactly the classic numbers.
		const plain = createSimState(SEED, 0, 0, PLAIN_ARENA);
		grantBoon(plain, 0, Boon.SHARPENED);
		grantBoon(plain, 0, Boon.DAREDEVIL);
		expect([runMods(plain, 0).damagePercent, runMods(plain, 0).grazeMargin]).toEqual([125, 0.75]);
		expect(computeRunMods({ boons: [], relics: [], curses: [] }, { levels: zeros() }).grazeMargin).toBe(
			GRAZE_MARGIN,
		);
	});

	it("every level x Fury damage is a multiple of 1/8 and every level x Frenzy an integer percent (exact)", () => {
		for (let l = 1; l <= 3; l++) {
			const s = createSimState(SEED, 0, 0, ARENA);
			for (let k = 0; k < l; k++) {
				grantCard(s, 0, Boon.SHARPENED);
				grantCard(s, 0, Boon.SWIFT_STRIKES);
			}
			const m = runMods(s, 0);
			for (let amount = 1; amount <= 63; amount++) {
				const v = scalePercent(scalePercent(amount, m.damagePercent), FURY_DAMAGE_PERCENT);
				expect([l, amount, (v * 8) % 1]).toEqual([l, amount, 0]);
				expect(v).toBe((amount * m.damagePercent * FURY_DAMAGE_PERCENT) / (PERCENT * PERCENT));
			}
			const swift = combinedPercent(m.attackTicksPercent, FRENZY_ATTACK_TICKS_PERCENT);
			expect([l, swift % 1]).toEqual([l, 0]);
			for (let ticks = 1; ticks <= 60; ticks++) expect(scaleTicks(ticks, swift) % 1).toBe(0);
		}
		expect([80, 70, 60].map((p) => combinedPercent(p, FRENZY_ATTACK_TICKS_PERCENT))).toEqual([56, 49, 42]);
	});

	it("Lingering's team window takes the highest level among counted owners", () => {
		const s = createSimState(SEED, 0, 0, PARTY_ARENA);
		expect(teamComboWindowTicks(s)).toBe(COMBO_WINDOW_TICKS);
		grantCard(s, 0, Boon.LINGERING);
		expect(teamComboWindowTicks(s)).toBe(540);
		for (let l = 0; l < 3; l++) grantCard(s, 1, Boon.LINGERING);
		expect(teamComboWindowTicks(s)).toBe(720);
		playerAt(s, 1).dead = 1; // the level III owner is not counted while someone lives
		expect(teamComboWindowTicks(s)).toBe(540);
		playerAt(s, 0).dead = 1; // nobody alive: everyone counts
		expect(teamComboWindowTicks(s)).toBe(720);
	});

	it("a duo card: only with both boons owned (any level), once", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		expect(grantCard(s, 0, duoCard(Duo.SHRAPNEL))).toBe(-1);
		grantCard(s, 0, Boon.VOLATILE);
		expect(grantCard(s, 0, duoCard(Duo.SHRAPNEL))).toBe(-1);
		grantCard(s, 0, Boon.SHARPENED);
		expect(grantCard(s, 0, duoCard(Duo.SHRAPNEL))).toBe(CardKind.DUO);
		expect([s.builds!.events.duoPlayer, s.builds!.events.duoTaken]).toEqual([[0], [Duo.SHRAPNEL]]);
		expect(grantCard(s, 0, duoCard(Duo.SHRAPNEL))).toBe(-1);
		expect(bp(s).duos).toEqual([Duo.SHRAPNEL]);
		expect(rp(s).boons).toEqual([Boon.VOLATILE, Boon.SHARPENED]);
	});
});

// ---------------------------------------------------------------------------------------------

describe("the draft with builds (BU2)", () => {
	it("deals cards from the sim rng on a floor change; a confirm takes the card at its level", () => {
		const setup = buildEndlessRunConfig(SEED);
		const spawn = setup.spawn!;
		const s = createSimState(SEED, spawn.x, spawn.z, setup.config);
		const before = s.rngState;
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), setup.config);
		expect(s.endless!.floor).toBe(2);
		const want = drawCardOffers({ rngState: before }, BUILD_RULES, zeros(), [], 1);
		expect(rp(s).draftOffers).toEqual(want);
		expect(bp(s).draftsLeft).toBe(1);
		confirmSolo(s, setup.config);
		expect(isDraftOpen(s)).toBe(false);
		const card = want[1];
		expect([rp(s).boons, bp(s).levels[card], bp(s).draftsLeft]).toEqual([[card], 1, 0]);
		expect(s.run!.events.draftChosen).toBe(card + 1);
	});

	it("after a boss floor the draft is dealt twice: a guaranteed duo first, a confirm re-deals, the second closes", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		skipToFloor(s, ARENA, 5);
		grantCard(s, 0, Boon.EMBER_WAKE);
		grantCard(s, 0, Boon.PIERCING_ARROWS);
		const before = s.rngState;
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), ARENA);
		expect(s.endless!.floor).toBe(6);
		const first = drawCardOffers({ rngState: before }, BUILD_RULES, bp(s).levels, [], 5, true);
		expect(rp(s).draftOffers).toEqual(first);
		expect([first[0], bp(s).draftsLeft]).toEqual([duoCard(Duo.FIRE_ARROWS), 2]);
		// Take the duo (left card): the draft stays open with new offers, its timer back at 0.
		const left = frame(-0.8, 0.8);
		const beforeDeal = { rngState: 0 };
		while (rp(s).draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) step(s, left, ARENA);
		beforeDeal.rngState = s.rngState;
		step(s, { ...left, buttons: DRAFT_CONFIRM_BUTTON }, ARENA);
		expect(bp(s).duos).toEqual([Duo.FIRE_ARROWS]);
		expect([isDraftOpen(s), rp(s).draftTicks, bp(s).draftsLeft]).toEqual([true, 0, 1]);
		const second = drawCardOffers(beforeDeal, BUILD_RULES, bp(s).levels, bp(s).duos, 5, false);
		expect(rp(s).draftOffers).toEqual(second);
		expect([s.run!.events.draftChosen, s.run!.events.draftOpened]).toEqual([first[0] + 1, second.size()]);
		// A held FIRE does not confirm the new deal; a fresh press once it has been open long enough does.
		step(s, { ...left, buttons: DRAFT_CONFIRM_BUTTON }, ARENA);
		expect(isDraftOpen(s)).toBe(true);
		confirmSolo(s, ARENA, left);
		expect([isDraftOpen(s), bp(s).draftsLeft]).toEqual([false, 0]);
		expect(bp(s).levels[cardBoon(second[0])] >= 1).toBe(true);
		// A normal floor after it deals once.
		step(s, frame(0, 0), ARENA);
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), ARENA);
		expect([s.endless!.floor, bp(s).draftsLeft]).toEqual([7, 1]);
	});

	it("a treasure bonus deal (docs/TREASURE.md TR4): one more deal, so the first guarantees a duo; taken once", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		s.treasure = createTreasureState(ENDLESS_TREASURE_CONFIG, SEED, 1);
		skipToFloor(s, ARENA, 2);
		grantCard(s, 0, Boon.EMBER_WAKE);
		grantCard(s, 0, Boon.PIERCING_ARROWS);
		s.treasure.bonusDeals[0] = 1;
		const before = s.rngState;
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), ARENA);
		const first = drawCardOffers({ rngState: before }, BUILD_RULES, bp(s).levels, [], 2, true);
		expect(rp(s).draftOffers).toEqual(first);
		expect([first[0], bp(s).draftsLeft, s.treasure.bonusDeals[0]]).toEqual([duoCard(Duo.FIRE_ARROWS), 2, 0]);
		confirmSolo(s, ARENA, frame(-0.8, 0.8));
		expect([isDraftOpen(s), bp(s).draftsLeft]).toEqual([true, 1]);
		confirmSolo(s, ARENA);
		expect([isDraftOpen(s), bp(s).draftsLeft]).toEqual([false, 0]);
		step(s, frame(0, 0), ARENA);
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), ARENA);
		expect(bp(s).draftsLeft).toBe(1);
	});

	it("replays identically: two runs with the same inputs hash the same through a double draft", () => {
		const play = () => {
			const s = createSimState(SEED, 0, 0, ARENA);
			for (let f = 1; f < 7; f++) {
				step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), ARENA);
				for (let deal = 0; deal < 2 && isDraftOpen(s); deal++) {
					confirmSolo(s, ARENA, frame(0.8, -0.8));
					step(s, frame(0, 0), ARENA);
				}
			}
			return s;
		};
		const a = play();
		const b = play();
		expect(hashState(a)).toBe(hashState(b));
		expect(bp(a).levels).toEqual(bp(b).levels);
		// Six drafts, the floor 5 one dealt twice: seven picks.
		let picks = bp(a).duos.size();
		for (const l of bp(a).levels) picks += l;
		expect(picks).toBe(7);
	});

	it("co-op: each player's cards from their own build, drawn in index order; the world waits for both", () => {
		const s = createSimState(SEED, 0, 0, PARTY_ARENA);
		grantCard(s, 1, Boon.VOLATILE);
		const twin = { rngState: s.rngState };
		const want0 = drawCardOffers(twin, BUILD_RULES, zeros(), [], 1);
		const want1 = drawCardOffers(twin, BUILD_RULES, bp(s, 1).levels, [], 1);
		const idle = frame(0, 0);
		stepParty(s, [frame(0, 0, DEBUG_FLOOR_BUTTON), idle], PARTY_ARENA);
		expect([rp(s, 0).draftOffers, rp(s, 1).draftOffers]).toEqual([want0, want1]);
		expect(s.rngState).toBe(twin.rngState);
		while (rp(s, 0).draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) stepParty(s, [idle, idle], PARTY_ARENA);
		stepParty(s, [{ ...idle, buttons: DRAFT_CONFIRM_BUTTON }, idle], PARTY_ARENA);
		expect([rp(s, 0).draftOpen, rp(s, 1).draftOpen, isDraftOpen(s)]).toEqual([0, 1, true]);
		stepParty(s, [idle, { ...idle, buttons: DRAFT_CONFIRM_BUTTON }], PARTY_ARENA);
		expect(isDraftOpen(s)).toBe(false);
		expect(bp(s, 0).levels[want0[1]]).toBe(1);
		expect(bp(s, 1).levels[want1[1]]).toBe(want1[1] === Boon.VOLATILE ? 2 : 1);
		expect(bp(s, 0).levels[Boon.VOLATILE]).toBe(want0[1] === Boon.VOLATILE ? 1 : 0);
	});
});
