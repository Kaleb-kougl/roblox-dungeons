// Floor modifier census (docs/FLOOR_MODIFIERS.md FM2 / FM9, numbers recorded there): the chance draws alone over run
// seeds 1-60 x floors 2-30 (no build: the rate per band before and after the streak rule, boss floors left out), then
// the built floors, solo and party 3: modifier floors per run, the kind mix, chance hits with no eligible kind, how often
// the drawn start kind was not eligible (the pick moved on), each kind's eligibility on the hit floors, and each kind's
// effect against the same floor built without modifiers (Gilded / Hoard / Feast: the Goldling / vault / power pellet
// added; Plunder: loaded pieces; Blood Moon: affixed planned members outside the boss room). Printed, with a raw line
// per party size ([modifiers:raw]) so slices can be summed. The built sample is small by default (runs 1-3 x floors
// 2-14, every floor built); `--census` (censusRequested) takes runs 1-60 x floors 2-30, building only the open chance
// hits (any other floor has no modifier by the pick's first rules, pinned by the default sample): ~3 minutes headless,
// so run it in slices of BUILT_FROM / BUILT_TO (edit the compiled out/ spec) on a short shell.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	EncounterRng,
	FLOOR_MODIFIER_WORLD_ALL,
	FloorModifier,
	MODIFIERS,
	NO_POWER_PELLET,
	breakableLootRooms,
	buildEndlessFloor,
	countAffixed,
	floorModifierEligible,
	floorModifierKey,
	floorModifierPickInput,
	generateDungeon,
	isBossFloor,
	modifierChanceHit,
	modifierChancePercent,
	modifierSeed,
	modifierStreakBlocked,
	type Dungeon,
	type EndlessFloorLayout,
	type FloorModifierFloor,
	type ForgeParams,
} from "shared/dungeon";
import { censusRequested } from "shared/run/testing";

const FULL = censusRequested();
const RATE_RUNS = 60;
const FIRST = 2;
const LAST = 30;
const BUILT_FROM = 1;
const BUILT_TO = FULL ? 60 : 3;
const BUILT_LAST = FULL ? 30 : 14;
const PARTIES = [1, 3];

const dungeons = new Map<string, Dungeon>();
function dungeonFor(params: ForgeParams): Dungeon {
	const key = `${params.seed}/${params.roomCount}`;
	let d = dungeons.get(key);
	if (d === undefined) {
		d = generateDungeon(params);
		dungeons.set(key, d);
	}
	return d;
}

function pct(n: number, of: number): string {
	return of > 0 ? string.format("%.1f", (n * 100) / of) : "-";
}

const BANDS = MODIFIERS.bands;
function bandOf(floor: number): number {
	let out = 0;
	for (let i = 0; i < BANDS.size(); i++) if (floor >= BANDS[i].fromFloor) out = i;
	return out;
}

describe(`modifier census: chance draws, runs 1-${RATE_RUNS} x floors ${FIRST}-${LAST}`, () => {
	it("rate per band, before and after the streak rule (printed)", () => {
		const floors = BANDS.map(() => 0);
		const hits = BANDS.map(() => 0);
		const open = BANDS.map(() => 0);
		const openHits = BANDS.map(() => 0);
		let twoInARow = 0;
		for (let run = 1; run <= RATE_RUNS; run++) {
			let prevOpenHit = false;
			for (let floor = FIRST; floor <= LAST; floor++) {
				if (isBossFloor(floor)) {
					prevOpenHit = false;
					continue;
				}
				const b = bandOf(floor);
				const input = floorModifierPickInput(run, floor);
				const hit = modifierChanceHit(input.seed, floor);
				floors[b]++;
				if (hit) hits[b]++;
				const blocked = modifierStreakBlocked(input);
				if (!blocked) {
					open[b]++;
					if (hit) openHits[b]++;
				}
				const openHit = hit && !blocked;
				if (openHit && prevOpenHit) twoInARow++;
				prevOpenHit = openHit;
			}
		}
		for (let b = 0; b < BANDS.size(); b++) {
			const band = BANDS[b];
			print(
				`[modifiers] band from ${band.fromFloor} (${band.chancePercent} %): ${
					floors[b]
				} non-boss floors, chance hits ${pct(hits[b], floors[b])} %, after the streak rule ${pct(
					openHits[b],
					floors[b],
				)} % (${openHits[b]})`,
			);
			// The draw lands near its band's percent (binomial, n >= 180: a wide band).
			expect(math.abs((hits[b] * 100) / floors[b] - modifierChancePercent(band.fromFloor)) < 10).toBe(true);
			expect(openHits[b] <= hits[b]).toBe(true);
		}
		expect(twoInARow).toBe(0);
	});
});

const PARTS = { ...FLOOR_MODIFIER_WORLD_ALL, vaults: true };
const KIND_COUNT = MODIFIERS.kinds.size();

/** The kind the pick tries first on a chance hit (./modifiers.ts kindStart: the stream's second draw), its index. */
function startKindIndex(seed: number): number {
	const rng = new EncounterRng(modifierSeed(seed));
	rng.int(0, MODIFIERS.percentRange - 1);
	let total = 0;
	for (const k of MODIFIERS.kinds) total += k.weight;
	let roll = rng.int(0, total - 1);
	for (let i = 0; i < KIND_COUNT; i++) {
		if (roll < MODIFIERS.kinds[i].weight) return i;
		roll -= MODIFIERS.kinds[i].weight;
	}
	return KIND_COUNT - 1;
}

/** What eligibility reads of a floor built without modifiers. */
function naturalFloor(l: EndlessFloorLayout): FloorModifierFloor {
	return {
		seed: l.seed,
		dungeon: l.dungeon,
		encounter: l.encounter,
		roomSpawns: l.roomSpawns,
		spawn: l.spawn,
		stairwell: l.stairwell,
		floor: l.floor,
		breakables: l.breakables ?? [],
		roomAffixes: l.roomAffixes ?? [],
		pellets: l.pellets!,
		vault: l.vault,
		golden: l.golden,
	};
}

interface PartyCensus {
	floors: number;
	open: number;
	modifierFloors: number;
	misses: number;
	runMin: number;
	runMax: number;
	/** Per kind index (MODIFIERS.kinds order). */
	picked: number[];
	startDrawn: number[];
	startIneligible: number[];
	eligibleOnHits: number[];
	/** Gilded / Hoard / Feast floors whose Goldling / vault / power pellet the natural floor lacked. */
	added: number[];
	plunderLoaded: number;
	plunderNatural: number;
	plunderMin: number;
	plunderMax: number;
	moonNatural: number;
	moonDoubled: number;
}

function newCensus(): PartyCensus {
	const zeros = () => MODIFIERS.kinds.map(() => 0);
	return {
		floors: 0,
		open: 0,
		modifierFloors: 0,
		misses: 0,
		runMin: math.huge,
		runMax: 0,
		picked: zeros(),
		startDrawn: zeros(),
		startIneligible: zeros(),
		eligibleOnHits: zeros(),
		added: zeros(),
		plunderLoaded: 0,
		plunderNatural: 0,
		plunderMin: math.huge,
		plunderMax: 0,
		moonNatural: 0,
		moonDoubled: 0,
	};
}

function kindIndex(id: number): number {
	for (let i = 0; i < KIND_COUNT; i++) if (MODIFIERS.kinds[i].id === id) return i;
	return -1;
}

describe(`modifier census: built floors, runs ${BUILT_FROM}-${BUILT_TO} x floors ${FIRST}-${BUILT_LAST}, party ${PARTIES.join(
	" / ",
)}${FULL ? " (full)" : ""}`, () => {
	it("modifier floors per run, kind mix, eligibility, each kind's effect against the natural floor (printed)", () => {
		const census = PARTIES.map(() => newCensus());
		for (let run = BUILT_FROM; run <= BUILT_TO; run++) {
			dungeons.clear(); // one run's dungeons at a time (the two party sizes share them)
			const perRun = PARTIES.map(() => 0);
			const lastModifierFloor = PARTIES.map(() => -1);
			for (let floor = FIRST; floor <= BUILT_LAST; floor++) {
				if (isBossFloor(floor)) continue;
				const input = floorModifierPickInput(run, floor);
				const openHit = !modifierStreakBlocked(input) && modifierChanceHit(input.seed, floor);
				for (let p = 0; p < PARTIES.size(); p++) {
					const party = PARTIES[p];
					const c = census[p];
					c.floors++;
					if (!openHit) {
						if (!FULL) {
							const l = buildEndlessFloor(run, floor, dungeonFor, party, {
								vaults: true,
								modifiers: FLOOR_MODIFIER_WORLD_ALL,
							});
							expect(l.modifier).toBe(FloorModifier.NONE);
						}
						continue;
					}
					c.open++;
					const l = buildEndlessFloor(run, floor, dungeonFor, party, {
						vaults: true,
						modifiers: FLOOR_MODIFIER_WORLD_ALL,
					});
					const natural = buildEndlessFloor(run, floor, dungeonFor, party, { vaults: true });
					const nf = naturalFloor(natural);
					for (let k = 0; k < KIND_COUNT; k++)
						if (floorModifierEligible(MODIFIERS.kinds[k].id, nf, PARTS)) c.eligibleOnHits[k]++;
					const start = startKindIndex(input.seed);
					c.startDrawn[start]++;
					const startEligible = floorModifierEligible(MODIFIERS.kinds[start].id, nf, PARTS);
					if (!startEligible) c.startIneligible[start]++;
					if (l.modifier === FloorModifier.NONE) {
						c.misses++;
						continue;
					}
					if (startEligible) expect(l.modifier).toBe(MODIFIERS.kinds[start].id);
					expect(lastModifierFloor[p]).never.toBe(floor - 1); // never two in a row
					lastModifierFloor[p] = floor;
					c.modifierFloors++;
					perRun[p]++;
					const k = kindIndex(l.modifier);
					c.picked[k]++;
					if (l.modifier === FloorModifier.GILDED) {
						if (natural.golden === undefined && l.golden !== undefined) c.added[k]++;
					} else if (l.modifier === FloorModifier.HOARD) {
						if (natural.vault === undefined && l.vault !== undefined) c.added[k]++;
					} else if (l.modifier === FloorModifier.FEAST) {
						if (natural.pellets!.power === NO_POWER_PELLET && l.pellets!.power !== NO_POWER_PELLET)
							c.added[k]++;
					} else if (l.modifier === FloorModifier.PLUNDER) {
						const loaded = l.breakableLoot!.size();
						c.plunderLoaded += loaded;
						c.plunderNatural += natural.breakableLoot!.size();
						c.plunderMin = math.min(c.plunderMin, loaded);
						c.plunderMax = math.max(c.plunderMax, loaded);
						expect(loaded).toBe(breakableLootRooms(natural.breakables ?? [], natural.encounter).size());
					} else {
						c.moonNatural += countAffixed(natural.roomAffixes!, natural.dungeon.boss);
						c.moonDoubled += countAffixed(l.roomAffixes!, l.dungeon.boss);
					}
				}
			}
			for (let p = 0; p < PARTIES.size(); p++) {
				census[p].runMin = math.min(census[p].runMin, perRun[p]);
				census[p].runMax = math.max(census[p].runMax, perRun[p]);
			}
		}
		const list = (xs: number[]) => MODIFIERS.kinds.map((k, i) => `${k.key} ${xs[i]}`).join(", ");
		for (let p = 0; p < PARTIES.size(); p++) {
			const c = census[p];
			const runs = BUILT_TO - BUILT_FROM + 1;
			const plunderFloors = c.picked[kindIndex(FloorModifier.PLUNDER)];
			const moonFloors = c.picked[kindIndex(FloorModifier.BLOOD_MOON)];
			print(
				`[modifiers] party ${PARTIES[p]}: ${c.floors} non-boss floors, ${c.open} open chance hits, ${
					c.modifierFloors
				} modifier floors (${pct(c.modifierFloors, c.floors)} %; ${string.format(
					"%.2f",
					c.modifierFloors / runs,
				)} per run, ${c.runMin}-${c.runMax}), ${c.misses} hits with no eligible kind`,
			);
			print(`[modifiers] party ${PARTIES[p]} mix: ${list(c.picked)}`);
			print(
				`[modifiers] party ${PARTIES[p]} start kind drawn: ${list(c.startDrawn)}; not eligible: ${list(
					c.startIneligible,
				)}; eligible on the ${c.open} hit floors: ${list(c.eligibleOnHits)}`,
			);
			print(
				`[modifiers] party ${PARTIES[p]} effects: Gilded / Hoard / Feast added ${
					c.added[kindIndex(FloorModifier.GILDED)]
				} / ${c.added[kindIndex(FloorModifier.HOARD)]} / ${c.added[kindIndex(FloorModifier.FEAST)]}; Plunder ${
					c.plunderLoaded
				} loaded pieces on ${plunderFloors} floors (${
					plunderFloors > 0 ? string.format("%.2f", c.plunderLoaded / plunderFloors) : "-"
				} per floor, ${plunderFloors > 0 ? c.plunderMin : 0}-${c.plunderMax}; natural ${
					c.plunderNatural
				}); Blood Moon affixed members ${c.moonNatural} natural -> ${
					c.moonDoubled
				} doubled on ${moonFloors} floors`,
			);
			print(
				`[modifiers:raw] party=${PARTIES[p]} floors=${c.floors} open=${c.open} mod=${c.modifierFloors} miss=${
					c.misses
				} runMin=${c.runMin} runMax=${c.runMax} picked=${c.picked.join("/")} start=${c.startDrawn.join(
					"/",
				)} startNo=${c.startIneligible.join("/")} elig=${c.eligibleOnHits.join("/")} added=${c.added.join(
					"/",
				)} plL=${c.plunderLoaded} plN=${c.plunderNatural} plMin=${c.plunderMin} plMax=${c.plunderMax} moonN=${
					c.moonNatural
				} moonD=${c.moonDoubled}`,
			);
			expect(c.modifierFloors + c.misses).toBe(c.open);
			// Honesty (FMD3 / FMD7): a Gilded / Hoard / Feast floor always adds the thing the natural floor lacked.
			for (const id of [FloorModifier.GILDED, FloorModifier.HOARD, FloorModifier.FEAST])
				expect(c.added[kindIndex(id)]).toBe(c.picked[kindIndex(id)]);
			if (moonFloors > 0)
				expect(c.moonDoubled - c.moonNatural >= moonFloors * MODIFIERS.bloodMoon.minExtra).toBe(true);
		}
		expect(census[0].modifierFloors > 0).toBe(true);
		for (const k of MODIFIERS.kinds) expect(floorModifierKey(k.id)).never.toBe(undefined);
	});
});
