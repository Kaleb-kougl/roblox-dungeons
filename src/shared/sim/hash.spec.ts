import { describe, expect, it } from "@rbxts/jest-globals";
import hashFixture from "shared/fixtures-generated/hash";
import { buildVaultRunConfig } from "shared/run/testing";
import {
	AFFIXES_CONFIG,
	AFFIXES_SUBSYSTEM,
	BREAKABLES_SUBSYSTEM,
	BUILDS_SUBSYSTEM,
	DEV_SUBSYSTEM,
	DROPS_SUBSYSTEM,
	GOLDEN_SUBSYSTEM,
	ENDLESS_HASH_SUBSYSTEM,
	HASH_SUBSYSTEMS,
	PACTS_SUBSYSTEM,
	PARTY_SUBSYSTEM,
	PELLETS_SUBSYSTEM,
	RUN_SUBSYSTEM,
	SCORE_SUBSYSTEM,
	TREASURE_SUBSYSTEM,
	TUTORIAL_SUBSYSTEM,
	stepParty,
	type InputFrame,
	AFFIX_SLOT_HASH_FIELDS,
	BRUISER,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	SNIPER,
	SWARMER,
	createSimState,
	float64FromHex,
	float64Hex,
	hashLayout,
	hashNumbers,
	hashState,
	step,
	writeHashFields,
	type SimConfig,
} from "shared/sim";

describe("hashNumbers parity (fixtures/hash.json)", () => {
	it("matches every vector (values decoded from their exact bits, NaN and -0 included)", () => {
		for (const vector of hashFixture.vectors) {
			const values = vector.hex.map((h) => float64FromHex(h));
			expect(values.size()).toBe(vector.values.size());
			for (let i = 0; i < values.size(); i++) expect(float64Hex(values[i])).toBe(vector.hex[i]);
			expect(`${vector.name}: ${hashNumbers(values)}`).toBe(`${vector.name}: ${vector.hash}`);
		}
	});

	it("matches the numeric literals too (the generated fixture keeps them bit-exact)", () => {
		for (const vector of hashFixture.vectors) {
			const literal = vector.values.every((v) => typeIs(v, "number"));
			if (!literal) continue;
			expect(hashNumbers(vector.values as ReadonlyArray<number>)).toBe(vector.hash);
		}
	});

	it("freshState: writeHashFields(createSimState(1337, 0, 0)) field by field, and its hash", () => {
		const state = createSimState(1337, 0, 0);
		const values = writeHashFields(state, []);
		const fresh = hashFixture.freshState;
		expect(values.size()).toBe(fresh.hex.size());
		for (let i = 0; i < values.size(); i++) {
			expect(`#${i} ${float64Hex(values[i])}`).toBe(`#${i} ${fresh.hex[i]}`);
		}
		expect(hashNumbers(values)).toBe(fresh.hash);
		expect(hashState(state)).toBe(fresh.hashState);
	});
});

describe("float64 hex helpers", () => {
	it("round-trip -0, NaN payloads and subnormals", () => {
		for (const hex of [
			"8000000000000000", // check-asset-ids: allow (float64 bits)
			"7ff8000000000000",
			"fff8000000000000",
			"0000000000000001", // check-asset-ids: allow (float64 bits)
			"3ff0000000000000",
		]) {
			expect(float64Hex(float64FromHex(hex))).toBe(hex);
		}
		expect(float64Hex(-0)).toBe("8000000000000000"); // check-asset-ids: allow (float64 bits)
		expect(float64Hex(1)).toBe("3ff0000000000000");
	});
});

describe("elite affixes are opt-in (docs/ENEMY_VARIANTS.md EV7)", () => {
	const encounter = {
		spawns: [
			{ kind: SWARMER.id, x: 3, z: 3 },
			{ kind: SNIPER.id, x: -4, z: 4 },
			{ kind: BRUISER.id, x: 4, z: -4 },
		],
		rooms: [],
		entranceRoom: -1,
		bossRoom: -1,
	};
	const plainConfig: SimConfig = { ...DEFAULT_SIM_CONFIG, encounter };
	const affixConfig: SimConfig = { ...plainConfig, affixes: AFFIXES_CONFIG };

	it("without SimConfig.affixes the layout has no affixes group; with it, ONLY an appended last group differs", () => {
		const plain = createSimState(1337, 0, 0, plainConfig);
		const withAffixes = createSimState(1337, 0, 0, affixConfig);
		expect(plain.affixes).toBe(undefined);
		for (let t = 0; t <= 120; t++) {
			const a = hashLayout(plain, true);
			const b = hashLayout(withAffixes, true);
			expect(a.groups.map((g) => g.name).includes(AFFIXES_SUBSYSTEM)).toBe(false);
			expect(b.groups.size()).toBe(a.groups.size() + 1);
			const last = b.groups[b.groups.size() - 1];
			expect([last.name, last.start]).toEqual([AFFIXES_SUBSYSTEM, a.values.size()]);
			const prefix: number[] = [];
			for (let i = 0; i < last.start; i++) prefix.push(b.values[i]);
			expect(prefix).toEqual(a.values);
			// One slot per actor slot, every slot unaffixed (initial spawns never carry an affix).
			const slots = withAffixes.combat.actors.size();
			expect(b.values[last.start]).toBe(slots);
			expect(last.finish - last.start).toBe(1 + slots * AFFIX_SLOT_HASH_FIELDS.size());
			expect(b.names[last.start]).toBe("affixes.slots.length");
			expect(b.values).toEqual(writeHashFields(withAffixes, []));
			step(plain, EMPTY_INPUT, plainConfig);
			step(withAffixes, EMPTY_INPUT, affixConfig);
		}
	});
});

describe("hash group order with every port group (docs/TREASURE.md TR2, docs/FORTUNE.md PS2 / GE2)", () => {
	it("the six fixture groups, then endless .. pellets, treasure, pacts, golden LAST; the values are writeHashFields'", () => {
		const setup = buildVaultRunConfig(4242, 2, { override: { every: true }, startFloor: 2 });
		const config: SimConfig = { ...setup.config, tutorial: { harmless: false }, dev: { invulnerable: false } };
		const s = createSimState(4242, setup.spawn!.x, setup.spawn!.z, config);
		const want: string[] = [
			...HASH_SUBSYSTEMS,
			ENDLESS_HASH_SUBSYSTEM,
			SCORE_SUBSYSTEM,
			RUN_SUBSYSTEM,
			PARTY_SUBSYSTEM,
			TUTORIAL_SUBSYSTEM,
			BREAKABLES_SUBSYSTEM,
			DROPS_SUBSYSTEM,
			AFFIXES_SUBSYSTEM,
			DEV_SUBSYSTEM,
			BUILDS_SUBSYSTEM,
			PELLETS_SUBSYSTEM,
			TREASURE_SUBSYSTEM,
			PACTS_SUBSYSTEM,
			GOLDEN_SUBSYSTEM,
		];
		const frames: InputFrame[] = [EMPTY_INPUT, EMPTY_INPUT];
		for (let t = 0; t < 30; t++) {
			const l = hashLayout(s, true);
			expect(l.groups.map((g) => g.name)).toEqual(want);
			expect(l.groups[l.groups.size() - 1].finish).toBe(l.values.size());
			expect(l.names.size()).toBe(l.values.size());
			expect(l.values).toEqual(writeHashFields(s, []));
			stepParty(s, frames, config);
		}
	});
});
