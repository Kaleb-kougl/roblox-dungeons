// Floor modifier census (docs/FLOOR_MODIFIERS.md FM2, FM9's numbers): the chance draws alone over run seeds 1-60 x floors
// 2-30 (no build: the rate per band before and after the streak rule, boss floors left out), then the built floors' kind
// mix, chance hits with no eligible kind, Plunder's loaded pieces and Blood Moon's affixed members (natural vs doubled);
// printed. The built sample is small by default (runs 1-4 x floors 2-14); `--census` (censusRequested) builds runs 1-60
// x floors 2-30, solo (minutes headless).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	FLOOR_MODIFIER_WORLD_ALL,
	FloorModifier,
	MODIFIERS,
	breakableLootRooms,
	buildEndlessFloor,
	countAffixed,
	floorModifierKey,
	floorModifierPickInput,
	generateDungeon,
	isBossFloor,
	modifierChanceHit,
	modifierChancePercent,
	modifierStreakBlocked,
	type Dungeon,
	type ForgeParams,
} from "shared/dungeon";
import { censusRequested } from "shared/run/testing";

const FULL = censusRequested();
const RATE_RUNS = 60;
const FIRST = 2;
const LAST = 30;
const BUILT_RUNS = FULL ? 60 : 4;
const BUILT_LAST = FULL ? 30 : 14;

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

describe(`modifier census: built floors, runs 1-${BUILT_RUNS} x floors ${FIRST}-${BUILT_LAST}${
	FULL ? " (full)" : ""
}`, () => {
	it("kind mix, eligibility misses, Plunder pieces, Blood Moon members (printed)", () => {
		const kinds = new Map<number, number>();
		let floors = 0;
		let open = 0;
		let modifierFloors = 0;
		let misses = 0;
		let plunderLoaded = 0;
		let plunderNatural = 0;
		let moonNatural = 0;
		let moonDoubled = 0;
		let lastModifierFloor = -1;
		for (let run = 1; run <= BUILT_RUNS; run++) {
			lastModifierFloor = -1;
			for (let floor = FIRST; floor <= BUILT_LAST; floor++) {
				if (isBossFloor(floor)) continue;
				floors++;
				const input = floorModifierPickInput(run, floor);
				const l = buildEndlessFloor(run, floor, dungeonFor, 1, {
					vaults: true,
					modifiers: FLOOR_MODIFIER_WORLD_ALL,
				});
				const openHit = !modifierStreakBlocked(input) && modifierChanceHit(input.seed, floor);
				if (openHit) open++;
				if (l.modifier === FloorModifier.NONE) {
					if (openHit) misses++;
					continue;
				}
				expect(openHit).toBe(true);
				expect(lastModifierFloor).never.toBe(floor - 1); // never two in a row
				lastModifierFloor = floor;
				modifierFloors++;
				kinds.set(l.modifier, (kinds.get(l.modifier) ?? 0) + 1);
				if (l.modifier === FloorModifier.PLUNDER || l.modifier === FloorModifier.BLOOD_MOON) {
					const natural = buildEndlessFloor(run, floor, dungeonFor, 1, { vaults: true });
					if (l.modifier === FloorModifier.PLUNDER) {
						plunderLoaded += l.breakableLoot!.size();
						plunderNatural += natural.breakableLoot!.size();
						expect(l.breakableLoot!.size()).toBe(
							breakableLootRooms(natural.breakables ?? [], natural.encounter).size(),
						);
					} else {
						moonNatural += countAffixed(natural.roomAffixes!, natural.dungeon.boss);
						moonDoubled += countAffixed(l.roomAffixes!, l.dungeon.boss);
					}
				}
			}
		}
		const mix = MODIFIERS.kinds.map((k) => `${k.key} ${kinds.get(k.id) ?? 0}`).join(", ");
		print(
			`[modifiers] built: ${floors} non-boss floors, ${open} open chance hits, ${modifierFloors} modifier floors (${pct(
				modifierFloors,
				floors,
			)} %), ${misses} hits with no eligible kind; mix: ${mix}`,
		);
		print(
			`[modifiers] Plunder: ${plunderLoaded} loaded pieces on ${
				kinds.get(FloorModifier.PLUNDER) ?? 0
			} floors (natural ${plunderNatural}); Blood Moon: affixed members ${moonNatural} natural -> ${moonDoubled} doubled on ${
				kinds.get(FloorModifier.BLOOD_MOON) ?? 0
			} floors`,
		);
		expect(modifierFloors + misses).toBe(open);
		expect(modifierFloors > 0).toBe(true);
		for (const [k] of kinds) expect(floorModifierKey(k)).never.toBe(undefined);
	});
});
