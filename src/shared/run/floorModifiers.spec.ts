// Floor modifiers in the run configs (docs/FLOOR_MODIFIERS.md FM4): endless solo and co-op, the Daily and dev build
// their floors with the modifier pick on (ENDLESS_MODIFIER_WORLD, matching what their SimConfig runs); the server's
// two paths (the registry its run sessions use, buildRunConfig("endless") its whole-run validator uses) build the same
// floors as the client; M1 and the tutorial never have a modifier; KV_FloorModifier (parseFloorModifierOverride) reaches
// the dev world's floors only.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ENDLESS_FIRST_FLOOR,
	FloorModifier,
	MODIFIERS,
	breakableLootRooms,
	buildEndlessFloor,
	type EndlessFloorLayout,
} from "shared/dungeon";
import { DAILY_WORLD_KIND } from "shared/daily";
import {
	DEV_WORLD_KIND,
	ENDLESS_MODIFIER_WORLD,
	ENDLESS_WORLD_KIND,
	FLOOR_MODIFIER_ATTRIBUTE,
	SERVER_REFUSED_WORLDS,
	TUTORIAL_WORLD_KIND,
	buildDevRunConfig,
	buildEndlessRunConfig,
	buildRunConfig,
	buildWorldSetup,
	endlessDungeon,
	parseFloorModifierOverride,
	rosterUnlockFloors,
	type RunSetup,
} from "shared/run";

const LAST = 9;
const SEEDS = [11, 12, 13];

function floors(setup: RunSetup, last = LAST): EndlessFloorLayout[] {
	const out: EndlessFloorLayout[] = [];
	for (let f = ENDLESS_FIRST_FLOOR; f <= last; f++) out.push(setup.endlessFloor!(f).layout);
	return out;
}

function modifiersOf(layouts: ReadonlyArray<EndlessFloorLayout>): number[] {
	return layouts.map((l) => l.modifier);
}

describe("floor modifiers: the endless worlds (FM4)", () => {
	it("ENDLESS_MODIFIER_WORLD is what every endless config runs (golden, pellets, loot drops, affixes)", () => {
		expect(ENDLESS_MODIFIER_WORLD).toEqual({ golden: true, pellets: true, breakableLoot: true, affixes: true });
		const setups = [
			buildEndlessRunConfig(1),
			buildEndlessRunConfig(1, 3),
			buildWorldSetup(DAILY_WORLD_KIND, 1, { atBossDoor: false, partySize: 2 }),
			buildDevRunConfig(1),
		];
		for (const s of setups) {
			const c = s.config;
			expect([
				c.golden !== undefined,
				c.pellets !== undefined,
				c.drops?.breakableLoot === true,
				c.affixes !== undefined,
			]).toEqual([true, true, true, true]);
			expect(c.treasure).never.toBe(undefined); // the vaults (Hoard)
		}
	});

	it("endless solo and co-op floors are buildEndlessFloor with the modifiers on; some floors have one; the world carries it", () => {
		let modifierFloors = 0;
		for (const seed of SEEDS)
			for (const party of [1, 3]) {
				const setup = buildEndlessRunConfig(seed, party);
				for (let f = ENDLESS_FIRST_FLOOR; f <= LAST; f++) {
					const w = setup.endlessFloor(f);
					const want = buildEndlessFloor(seed, f, endlessDungeon, party, {
						vaults: true,
						unlockFloors: rosterUnlockFloors(ENDLESS_WORLD_KIND),
						modifiers: ENDLESS_MODIFIER_WORLD,
					});
					expect(w.layout.modifier).toBe(want.modifier);
					expect(w.modifier).toBe(w.layout.modifier);
					expect(w.golden).toEqual(want.golden);
					expect(w.vault).toEqual(want.vault);
					expect(w.pellets).toEqual(want.pellets);
					expect(w.breakableLoot).toEqual(want.breakableLoot);
					expect(w.roomAffixes).toEqual(want.roomAffixes);
					if (w.modifier !== FloorModifier.NONE) modifierFloors++;
				}
			}
		expect(modifierFloors > 0).toBe(true);
	});

	it("the server builds the same floors: the registry (run sessions) and buildRunConfig (the validator)", () => {
		for (const seed of SEEDS) {
			const client = floors(buildWorldSetup(ENDLESS_WORLD_KIND, seed, { atBossDoor: false }));
			const validator = floors(buildRunConfig(seed, { world: "endless" }));
			const party = floors(buildWorldSetup(ENDLESS_WORLD_KIND, seed, { atBossDoor: false, partySize: 2 }));
			expect(modifiersOf(validator)).toEqual(modifiersOf(client));
			for (let i = 0; i < client.size(); i++) {
				expect(validator[i].golden).toEqual(client[i].golden);
				expect(validator[i].vault).toEqual(client[i].vault);
				expect(validator[i].breakableLoot).toEqual(client[i].breakableLoot);
			}
			// Co-op: the pick reads the party's floor (room spawns scale), the same on every client.
			const again = floors(buildEndlessRunConfig(seed, 2));
			expect(modifiersOf(party)).toEqual(modifiersOf(again));
		}
	});

	it("the Daily: its own roster rule, the modifiers on", () => {
		for (const seed of SEEDS) {
			const daily = floors(buildWorldSetup(DAILY_WORLD_KIND, seed, { atBossDoor: false }));
			for (const l of daily) {
				const want = buildEndlessFloor(seed, l.floor, endlessDungeon, 1, {
					vaults: true,
					modifiers: ENDLESS_MODIFIER_WORLD,
					unlockFloors: rosterUnlockFloors(DAILY_WORLD_KIND),
				});
				expect(l.modifier).toBe(want.modifier);
			}
		}
	});

	it("M1 has no endless floors; the tutorial's floors never have a modifier", () => {
		expect(buildRunConfig(1, { world: "game" }).endlessFloor).toBe(undefined);
		const tutorial = buildWorldSetup(TUTORIAL_WORLD_KIND, 1, { atBossDoor: false });
		for (let f = ENDLESS_FIRST_FLOOR; f <= 3; f++) {
			const w = tutorial.endlessFloor!(f);
			expect(w.layout.modifier).toBe(FloorModifier.NONE);
			expect(w.modifier).toBe(FloorModifier.NONE);
		}
	});
});

describe("floor modifiers: the dev world's KV_FloorModifier (FM4)", () => {
	it("parseFloorModifierOverride: a kind's key in any case (letters only) or its id; anything else undefined", () => {
		expect(FLOOR_MODIFIER_ATTRIBUTE).toBe("KV_FloorModifier");
		for (const k of MODIFIERS.kinds) {
			expect(parseFloorModifierOverride(k.key)).toEqual({ every: true, kind: k.id });
			expect(parseFloorModifierOverride(k.key.upper())).toEqual({ every: true, kind: k.id });
			expect(parseFloorModifierOverride(k.id)).toEqual({ every: true, kind: k.id });
		}
		expect(parseFloorModifierOverride(" Blood Moon ")).toEqual({ every: true, kind: FloorModifier.BLOOD_MOON });
		expect(parseFloorModifierOverride("BLOOD_MOON")).toEqual({ every: true, kind: FloorModifier.BLOOD_MOON });
		expect(parseFloorModifierOverride("bloodmoon")).toEqual({ every: true, kind: FloorModifier.BLOOD_MOON });
		for (const bad of [undefined, "", "  ", "none", "nonsense", 0, 6, -1, 1.5, true, {}])
			expect(parseFloorModifierOverride(bad)).toBe(undefined);
	});

	it("the override reaches the dev world's floors; without one they are the endless run's; never a server world", () => {
		const seed = 12;
		const forced = buildDevRunConfig(seed, {
			startFloor: 2,
			invulnerable: false,
			modifier: parseFloorModifierOverride("plunder"),
		});
		const plain = buildDevRunConfig(seed, { startFloor: 2, invulnerable: false });
		const endless = buildEndlessRunConfig(seed);
		let forcedFloors = 0;
		for (let f = MODIFIERS.fromFloor; f <= LAST; f++) {
			const w = forced.endlessFloor!(f);
			const natural = buildEndlessFloor(seed, f, endlessDungeon, 1, {
				vaults: true,
				unlockFloors: rosterUnlockFloors(DEV_WORLD_KIND),
			});
			if (w.modifier === FloorModifier.PLUNDER) {
				forcedFloors++;
				// Every room with a lootable piece holds one loaded piece (the vault's chest is never loaded).
				expect(w.breakableLoot!.size()).toBe(breakableLootRooms(natural.breakables!, natural.encounter).size());
			} else {
				expect(w.modifier).toBe(FloorModifier.NONE);
				expect(w.breakableLoot).toEqual(natural.breakableLoot);
			}
			expect(plain.endlessFloor!(f).modifier).toBe(endless.endlessFloor(f).modifier);
		}
		expect(forcedFloors > 0).toBe(true);
		expect(SERVER_REFUSED_WORLDS.has(DEV_WORLD_KIND)).toBe(true);
	});
});
